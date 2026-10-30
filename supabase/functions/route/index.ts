// Authenticated, origin-restricted provider proxy with a hardcoded host allowlist.
import { createClient } from 'npm:@supabase/supabase-js@2'
import { isModelsRequest } from './model-request.ts'
import {
  APP_ORIGIN_HEADER,
  PROVIDER_CONFIGS,
  type ProviderConfig,
  type ProviderId,
} from './provider-config.ts'
import {
  filterAllowedClientHeaders,
  isAllowedJsonContentType,
  limitStreamBytes,
  readBodyWithinLimit,
} from './request-guards.ts'
import { getRouteRateLimit } from './rate-limit.ts'

type ChatRole = 'system' | 'user' | 'assistant'
type ChatMessage = { role: ChatRole; content: string }

const ALLOWED_PROVIDER_HOSTS = new Set(PROVIDER_CONFIGS.map(({ baseUrl }) => new URL(baseUrl).hostname))
const MAX_BODY_BYTES = 256_000
const MAX_MESSAGES = 24
const MAX_MESSAGE_LENGTH = 12_000
const MAX_TOTAL_MESSAGE_LENGTH = 48_000
const MAX_OUTPUT_TOKENS = 4_096
const MAX_OUTPUT_BYTES = 512_000

function corsHeaders(origin: string): Headers {
  return new Headers({
    'access-control-allow-origin': origin,
    'access-control-allow-headers': 'authorization, apikey, x-client-info, content-type, x-provider-api-key',
    'access-control-allow-methods': 'POST, OPTIONS',
    'access-control-expose-headers': 'retry-after',
    vary: 'Origin',
  })
}

function jsonResponse(
  body: Record<string, unknown>,
  status: number,
  origin: string,
  additionalHeaders?: HeadersInit,
): Response {
  const headers = corsHeaders(origin)
  new Headers(additionalHeaders).forEach((value, name) => headers.set(name, value))
  headers.set('content-type', 'application/json')
  return new Response(JSON.stringify(body), { status, headers })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isProviderId(value: unknown): value is ProviderId {
  return PROVIDER_CONFIGS.some((provider) => provider.id === value)
}

function findProvider(value: unknown): ProviderConfig | undefined {
  if (!isProviderId(value)) return undefined
  return PROVIDER_CONFIGS.find((provider) => provider.id === value)
}

function isValidOrigin(requestOrigin: string | null): requestOrigin is string {
  const configuredOrigins = Deno.env.get('APP_ORIGINS') ?? Deno.env.get('APP_ORIGIN') ?? ''
  if (!requestOrigin) return false

  return configuredOrigins.split(',').some((value) => {
    const origin = value.trim()
    if (!origin || origin === '*') return false
    try {
      return new URL(origin).origin === origin && requestOrigin === origin
    } catch {
      return false
    }
  })
}

async function verifyUser(request: Request): Promise<boolean> {
  const accessToken = request.headers.get('authorization')?.match(/^Bearer\s+(.+)$/i)?.[1]
  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')
  if (!accessToken || !supabaseUrl || !supabaseAnonKey) return false

  const authClient = createClient(supabaseUrl, supabaseAnonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { data: { user }, error } = await authClient.auth.getUser(accessToken)
  return !error && user !== null
}

async function parseRequestBody(request: Request): Promise<unknown | null> {
  const contentLength = request.headers.get('content-length')
  if (contentLength && (!/^\d+$/.test(contentLength) || Number(contentLength) > MAX_BODY_BYTES)) {
    return null
  }
  try {
    const text = await readBodyWithinLimit(request.body, MAX_BODY_BYTES)
    if (text === null) return null
    return JSON.parse(text) as unknown
  } catch {
    return null
  }
}

function hasOnlyKeys(body: Record<string, unknown>, allowedKeys: string[]): boolean {
  return Object.keys(body).every((key) => allowedKeys.includes(key))
}

function isValidStreamOptions(value: unknown, provider: ProviderConfig, isModelTest: boolean): boolean {
  if (value === undefined) return true
  return provider.id === 'openai'
    && !isModelTest
    && isRecord(value)
    && hasOnlyKeys(value, ['include_usage'])
    && value.include_usage === true
}

function isValidGeminiGenerationConfig(value: unknown, isModelTest: boolean): boolean {
  if (!isRecord(value) || !hasOnlyKeys(value, ['maxOutputTokens'])) return false
  if (!Number.isSafeInteger(value.maxOutputTokens)) return false
  if (isModelTest) return value.maxOutputTokens === 5
  return Number(value.maxOutputTokens) >= 1 && Number(value.maxOutputTokens) <= MAX_OUTPUT_TOKENS
}

function isChatMessage(value: unknown): value is ChatMessage {
  return isRecord(value)
    && (value.role === 'system' || value.role === 'user' || value.role === 'assistant')
    && typeof value.content === 'string'
    && value.content.length <= MAX_MESSAGE_LENGTH
}

function getChatMessages(value: unknown): ChatMessage[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_MESSAGES) return null
  const messages: ChatMessage[] = []
  for (const message of value) {
    if (!isChatMessage(message)) return null
    messages.push(message)
  }
  const totalLength = messages.reduce((total, message) => total + message.content.length, 0)
  return totalLength <= MAX_TOTAL_MESSAGE_LENGTH ? messages : null
}

function isTextContent(value: unknown): value is { text: string } {
  return isRecord(value) && typeof value.text === 'string' && value.text.length <= MAX_MESSAGE_LENGTH
}

function isProviderPayload(
  provider: ProviderConfig,
  model: string,
  value: unknown,
  isModelTest = false,
): value is Record<string, unknown> {
  if (!isRecord(value)) return false
  if (provider.apiStyle === 'openai-compatible') {
    return hasOnlyKeys(value, [
      'model',
      'messages',
      'stream',
      'max_tokens',
      ...(provider.id === 'openai' ? ['stream_options'] : []),
    ])
      && value.model === model
      && value.stream === !isModelTest
      && typeof value.max_tokens === 'number'
      && Number.isSafeInteger(value.max_tokens)
      && value.max_tokens >= 1
      && value.max_tokens <= (isModelTest ? 5 : MAX_OUTPUT_TOKENS)
      && isValidStreamOptions(value.stream_options, provider, isModelTest)
      && (!isModelTest || value.max_tokens <= 5)
      && getChatMessages(value.messages) !== null
  }
  if (provider.apiStyle === 'anthropic') {
    if (
      !hasOnlyKeys(value, ['model', 'max_tokens', 'stream', 'system', 'messages'])
      || value.model !== model
      || typeof value.max_tokens !== 'number'
      || value.max_tokens < 1
      || !Number.isSafeInteger(value.max_tokens)
      || value.max_tokens > (isModelTest ? 5 : MAX_OUTPUT_TOKENS)
      || value.stream !== !isModelTest
      || (isModelTest && value.max_tokens > 5)
      || (value.system !== undefined && (typeof value.system !== 'string' || value.system.length > MAX_MESSAGE_LENGTH))
      || !Array.isArray(value.messages)
      || value.messages.length === 0
      || value.messages.length > MAX_MESSAGES
    ) return false
    let totalLength = typeof value.system === 'string' ? value.system.length : 0
    for (const message of value.messages as unknown[]) {
      if (
        !isRecord(message)
        || (message.role !== 'user' && message.role !== 'assistant')
        || typeof message.content !== 'string'
        || message.content.length > MAX_MESSAGE_LENGTH
      ) return false
      totalLength += message.content.length
    }
    return totalLength <= MAX_TOTAL_MESSAGE_LENGTH
  }
  if (
    !hasOnlyKeys(value, ['contents', 'systemInstruction', 'generationConfig'])
    || !Array.isArray(value.contents)
    || value.contents.length === 0
    || value.contents.length > MAX_MESSAGES
    || !isValidGeminiGenerationConfig(value.generationConfig, isModelTest)
  ) return false
  let totalLength = 0
  for (const content of value.contents as unknown[]) {
    if (!isRecord(content)
      || (content.role !== 'user' && content.role !== 'model')
      || !Array.isArray(content.parts)
      || content.parts.length === 0) return false
    for (const part of content.parts as unknown[]) {
      if (!isTextContent(part)) return false
      totalLength += part.text.length
    }
  }
  if (value.systemInstruction !== undefined) {
    const systemInstruction = value.systemInstruction
    if (!isRecord(systemInstruction) || !Array.isArray(systemInstruction.parts)
      || systemInstruction.parts.length === 0) return false
    for (const part of systemInstruction.parts as unknown[]) {
      if (!isTextContent(part)) return false
      totalLength += part.text.length
    }
  }
  return totalLength <= MAX_TOTAL_MESSAGE_LENGTH
}

function getProviderEndpoint(provider: ProviderConfig, model: string): URL | null {
  const baseUrl = new URL(provider.baseUrl)
  if (baseUrl.protocol !== 'https:' || !ALLOWED_PROVIDER_HOSTS.has(baseUrl.hostname)) return null
  const chatPath = provider.chatPath.replace('{model}', encodeURIComponent(model))
  const endpoint = new URL(
    chatPath.replace(/^\//, ''),
    `${baseUrl.origin}${baseUrl.pathname.replace(/\/?$/, '/')}`,
  )
  if (endpoint.hostname !== baseUrl.hostname || !ALLOWED_PROVIDER_HOSTS.has(endpoint.hostname)) return null
  return endpoint
}

function getProviderModelsEndpoint(provider: ProviderConfig): URL | null {
  const baseUrl = new URL(provider.baseUrl)
  if (baseUrl.protocol !== 'https:' || !ALLOWED_PROVIDER_HOSTS.has(baseUrl.hostname)) return null
  const endpoint = new URL(
    provider.modelsPath.replace(/^\//, ''),
    `${baseUrl.origin}${baseUrl.pathname.replace(/\/?$/, '/')}`,
  )
  if (endpoint.hostname !== baseUrl.hostname || !ALLOWED_PROVIDER_HOSTS.has(endpoint.hostname)) return null
  return endpoint
}

function getProviderHeaders(
  provider: ProviderConfig,
  apiKey: string,
  appOrigin: string,
): Headers {
  const headers = new Headers({
    accept: 'text/event-stream',
    'content-type': 'application/json',
  })
  headers.set(
    provider.authStyle === 'bearer' ? 'authorization' : provider.authStyle,
    provider.authStyle === 'bearer' ? `Bearer ${apiKey}` : apiKey,
  )
  for (const [name, value] of Object.entries(provider.extraHeaders)) {
    headers.set(name, value === APP_ORIGIN_HEADER ? appOrigin : value)
  }
  return headers
}

async function testProviderKey(
  provider: ProviderConfig,
  apiKey: string,
  origin: string,
): Promise<Response> {
  const baseUrl = new URL(provider.baseUrl)
  if (!ALLOWED_PROVIDER_HOSTS.has(baseUrl.hostname)) {
    return jsonResponse({ ok: false, message: 'Provider is not allowlisted.' }, 400, origin)
  }
  const url = new URL('models', `${baseUrl.origin}${baseUrl.pathname}/`)
  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: getProviderHeaders(provider, apiKey, origin),
      signal: AbortSignal.timeout(10_000),
    })
    if (response.ok) return jsonResponse({ ok: true, message: 'Key verified. Provider API is reachable.' }, 200, origin)
    if (response.status === 401 || response.status === 403) {
      return jsonResponse({ ok: false, message: 'Your key was rejected.' }, 200, origin)
    }
    if (response.status === 402) {
      return jsonResponse({ ok: false, message: 'Not enough credits.' }, 200, origin)
    }
    if (response.status === 429) {
      return jsonResponse({ ok: false, message: 'Rate limited, try again soon.' }, 200, origin)
    }
    return jsonResponse({ ok: false, message: 'Provider could not verify this key.' }, 200, origin)
  } catch {
    return jsonResponse({ ok: false, message: 'Provider could not be reached. Please try again.' }, 200, origin)
  }
}

function getUpstreamError(status: number): { status: number; message: string } {
  if (status === 401 || status === 403) return { status: 401, message: 'Your key was rejected.' }
  if (status === 402) return { status: 402, message: 'Not enough credits.' }
  if (status === 429) return { status: 429, message: 'Rate limited, try again soon.' }
  if (status === 404) {
    return { status: 400, message: 'The model was not found or is not available to this key.' }
  }
  if (status === 400 || status === 422) {
    return { status: 400, message: 'The provider rejected the request. Check the model and provider access.' }
  }
  if (status === 408 || status === 504) return { status: 504, message: 'Provider request timed out.' }
  return { status: 502, message: 'Provider request failed. Please try again.' }
}

function getSafeRetryAfter(upstream: Response): string | null {
  if (upstream.status !== 429) return null
  const value = upstream.headers.get('retry-after')?.trim()
  if (!value) return null
  const seconds = /^\d+$/.test(value)
    ? Number(value)
    : Math.ceil((Date.parse(value) - Date.now()) / 1000)
  if (!Number.isFinite(seconds) || seconds <= 0) return null
  return String(Math.min(seconds, 120))
}

async function proxyChat(
  provider: ProviderConfig,
  apiKey: string,
  model: string,
  payload: Record<string, unknown>,
  origin: string,
  requestSignal: AbortSignal,
  isModelTest = false,
): Promise<Response> {
  const endpoint = getProviderEndpoint(provider, model)
  if (!endpoint) return jsonResponse({ message: 'Provider is not allowlisted.' }, 400, origin)

  let upstream: Response
  try {
    upstream = await fetch(endpoint, {
      method: 'POST',
      headers: getProviderHeaders(provider, apiKey, origin),
      body: JSON.stringify(payload),
      signal: AbortSignal.any([requestSignal, AbortSignal.timeout(120_000)]),
    })
  } catch {
    return jsonResponse({ message: 'Provider could not be reached. Please try again.' }, 502, origin)
  }

  if (!upstream.ok) {
    if (isModelTest) {
      return jsonResponse({ message: 'Model test failed.' }, upstream.status, origin)
    }
    const error = getUpstreamError(upstream.status)
    const retryAfter = getSafeRetryAfter(upstream)
    const retryHeaders = retryAfter ? { 'retry-after': retryAfter } : undefined
    return jsonResponse({ message: error.message }, error.status, origin, retryHeaders)
  }
  if (isModelTest) {
    await upstream.body?.cancel()
    return jsonResponse({ ok: true }, 200, origin)
  }
  if (!upstream.body) return jsonResponse({ message: 'Provider returned an empty stream.' }, 502, origin)

  const headers = corsHeaders(origin)
  headers.set('content-type', 'text/event-stream; charset=utf-8')
  headers.set('cache-control', 'no-cache, no-transform')
  headers.set('x-content-type-options', 'nosniff')
  return new Response(limitStreamBytes(upstream.body, MAX_OUTPUT_BYTES), { status: 200, headers })
}

async function proxyModels(
  provider: ProviderConfig,
  apiKey: string | null,
  origin: string,
): Promise<Response> {
  const endpoint = getProviderModelsEndpoint(provider)
  if (!endpoint) return jsonResponse({ message: 'Provider is not allowlisted.' }, 400, origin)

  const headers = new Headers({
    accept: 'application/json',
  })
  if (apiKey) {
    headers.set(
      provider.authStyle === 'bearer' ? 'authorization' : provider.authStyle,
      provider.authStyle === 'bearer' ? 'Bearer ' + apiKey : apiKey,
    )
  }
  for (const [name, value] of Object.entries(provider.extraHeaders)) {
    headers.set(name, value === APP_ORIGIN_HEADER ? origin : value)
  }

  let upstream: Response
  try {
    upstream = await fetch(endpoint, {
      method: 'GET',
      headers,
      signal: AbortSignal.timeout(10_000),
    })
  } catch {
    return jsonResponse({ message: 'Unable to load this provider’s models.' }, 502, origin)
  }
  if (!upstream.ok) {
    if (upstream.status === 401 || upstream.status === 403) {
      return jsonResponse({ message: 'Your provider key was rejected.' }, 401, origin)
    }
    if (upstream.status === 429) {
      return jsonResponse({ message: 'The provider is rate limited. Try refreshing shortly.' }, 429, origin)
    }
    return jsonResponse({ message: 'Unable to load this provider’s models.' }, 502, origin)
  }

  let models: unknown
  try {
    models = await upstream.json()
  } catch {
    return jsonResponse({ message: 'The provider returned an invalid model list.' }, 502, origin)
  }
  if (!isRecord(models)) {
    return jsonResponse({ message: 'The provider returned an invalid model list.' }, 502, origin)
  }
  return jsonResponse(models, 200, origin)
}

Deno.serve(async (request: Request) => {
  const requestOrigin = request.headers.get('origin')
  if (!isValidOrigin(requestOrigin)) return new Response('Origin not allowed.', { status: 403 })
  const origin = requestOrigin

  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(origin) })
  if (request.method !== 'POST') return jsonResponse({ message: 'Method not allowed.' }, 405, origin)
  if (!await verifyUser(request)) {
    return jsonResponse({ message: 'A valid signed-in session is required.' }, 401, origin)
  }

  let withinRateLimit: boolean | null
  try {
    withinRateLimit = await getRouteRateLimit(request)
  } catch {
    withinRateLimit = null
  }
  if (withinRateLimit === null) {
    return jsonResponse({ message: 'The service is temporarily unavailable. Try again shortly.' }, 503, origin)
  }
  if (!withinRateLimit) {
    return jsonResponse({ message: 'You are sending requests too quickly. Wait a minute and try again.' }, 429, origin)
  }

  const clientHeaders = filterAllowedClientHeaders(request.headers)
  if (!isAllowedJsonContentType(clientHeaders.get('content-type'))) {
    return jsonResponse({ message: 'Send a JSON request.' }, 415, origin)
  }

  const body = await parseRequestBody(request)
  if (!isRecord(body)) return jsonResponse({ message: 'Invalid request.' }, 400, origin)
  const provider = findProvider(body.providerId)
  if (!provider) return jsonResponse({ message: 'Unknown provider.' }, 400, origin)

  if (body.action === 'test_key') {
    const apiKey = clientHeaders.get('x-provider-api-key')
    if (!apiKey?.trim() || apiKey.length > 512) {
      return jsonResponse({ message: 'A valid provider key is required.' }, 400, origin)
    }
    if (!hasOnlyKeys(body, ['action', 'providerId'])) {
      return jsonResponse({ message: 'Unsupported provider test request.' }, 400, origin)
    }
    return await testProviderKey(provider, apiKey, origin)
  }

  if (body.action === 'models') {
    if (!isModelsRequest(body, PROVIDER_CONFIGS.map(({ id }) => id))) {
      return jsonResponse({ message: 'Invalid model-list request.' }, 400, origin)
    }
    const apiKey = clientHeaders.get('x-provider-api-key')
    if (!apiKey?.trim() && provider.id !== 'openrouter') {
      return jsonResponse({ message: 'A provider key is required to load this model list.' }, 400, origin)
    }
    if (apiKey && apiKey.length > 512) {
      return jsonResponse({ message: 'A valid provider key is required.' }, 400, origin)
    }
    return await proxyModels(provider, apiKey?.trim() || null, origin)
  }

  const apiKey = clientHeaders.get('x-provider-api-key')
  if (!apiKey?.trim() || apiKey.length > 512) {
    return jsonResponse({ message: 'A valid provider key is required.' }, 400, origin)
  }

  const isModelTest = body.action === 'test_model'
  if (
    (body.action !== 'chat' && !isModelTest)
    || !hasOnlyKeys(body, ['action', 'providerId', 'model', 'payload', 'stream'])
    || typeof body.model !== 'string'
    || !body.model.trim()
    || body.model.length > 180
    || body.stream !== !isModelTest
  ) {
    return jsonResponse({ message: 'Invalid chat request. Check the model name.' }, 400, origin)
  }

  if (!isProviderPayload(provider, body.model.trim(), body.payload, isModelTest)) {
    return jsonResponse({ message: 'Invalid provider request.' }, 400, origin)
  }
  return await proxyChat(provider, apiKey, body.model.trim(), body.payload, origin, request.signal, isModelTest)
})
