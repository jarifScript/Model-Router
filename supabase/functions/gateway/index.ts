import { createClient } from 'npm:@supabase/supabase-js@2'
import {
  decryptGatewaySecret,
  GatewayCryptoError,
  hashGatewayRouterKey,
  type GatewayEncryptedSecret,
} from '../../../src/core/gateway-crypto.ts'
import { AllTargetsFailed, RouterRequestError } from '../../../src/core/errors.ts'
import { route, type RouterEvent } from '../../../src/core/router.ts'
import { ProviderHealth } from '../../../src/core/health.ts'
import { getProviderConfig, PROVIDER_CONFIGS, type ProviderId } from '../../../src/core/providers.ts'
import { parseAutoBackupPlan } from '../../../src/core/auto-backup-plan.ts'
import type { RouteTarget } from '../../../src/core/route-types.ts'
import type { ProviderErrorClass } from '../../../src/core/adapters/types.ts'
import { getGatewayAdapter } from './adapter-registry.ts'
import {
  countGatewayOutputBytes,
  GatewayOutputLimitError,
  isWithinGatewayLimits,
} from './limits.ts'
import { createGatewayLogRow } from './gateway-logging.ts'
import type { GatewayClient, GatewayDatabase } from './database.ts'
import {
  MAX_GATEWAY_BODY_BYTES,
  applyGatewayGenerationOptions,
  parseGatewayChatRequest,
  readGatewayBody,
} from './request-guards.ts'
import {
  completionCreatedAt,
  completionId,
  encodeServerSentEvent,
  encodeServerSentEventDone,
  estimateTokens,
  makeCompletionChunk,
  makeCompletionResponse,
} from './responses.ts'

const ALLOWED_PROVIDER_HOSTS = new Set(
  PROVIDER_CONFIGS.map(({ baseUrl }) => new URL(baseUrl).hostname),
)
const providerHealth = new ProviderHealth()

type GatewayUsageRecord = {
  router_key_id: string
  user_id: string
  minute_count: number
  day_count: number
  minute_limit: number
  day_limit: number
}

type SharedGatewayKey = {
  provider_key_id: string
  provider: ProviderId
  ciphertext: string
  iv: string
}

type GatewayRequestState = {
  userId: string
  createdAt: string
  startedAt: number
  inputCharacters: number
  content: string
  outputBytes: number
  firstTokenAt: number | null
  inputTokens: number | null
  outputTokens: number | null
  answerTarget: RouteTarget | null
  lastTarget: RouteTarget | null
  status: 'success' | 'error' | 'aborted'
  httpStatus: number | null
  errorClass: ProviderErrorClass | null
  fallbackCount: number
  logWritten: boolean
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function safeConfiguredOrigins(): Set<string> {
  const configured = Deno.env.get('APP_ORIGINS') ?? Deno.env.get('APP_ORIGIN') ?? ''
  const origins = new Set<string>()
  for (const value of configured.split(',')) {
    const origin = value.trim()
    if (!origin || origin === '*') continue
    try {
      if (new URL(origin).origin === origin) origins.add(origin)
    } catch {
      continue
    }
  }
  return origins
}

function corsHeaders(origin: string | null): Headers {
  const headers = new Headers({ vary: 'Origin' })
  if (origin && safeConfiguredOrigins().has(origin)) {
    headers.set('access-control-allow-origin', origin)
    headers.set('access-control-allow-headers', 'authorization, content-type')
    headers.set('access-control-allow-methods', 'POST, OPTIONS')
    headers.set('access-control-max-age', '600')
  }
  return headers
}

function jsonResponse(
  message: string,
  status: number,
  origin: string | null,
  errorType = 'api_error',
): Response {
  const headers = corsHeaders(origin)
  headers.set('content-type', 'application/json; charset=utf-8')
  headers.set('cache-control', 'no-store')
  headers.set('x-content-type-options', 'nosniff')
  return new Response(JSON.stringify({
    error: { message, type: errorType },
  }), { status, headers })
}

function isGatewayPath(pathname: string): boolean {
  const parts = pathname.split('/').filter(Boolean)
  return parts.length >= 4
    && parts.slice(-4).join('/') === 'gateway/v1/chat/completions'
}

function getAdminClient(): GatewayClient | null {
  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!supabaseUrl || !serviceRoleKey) return null
  return createClient<GatewayDatabase>(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

function getRouterKey(request: Request): string | null {
  const authorization = request.headers.get('authorization')
  const match = authorization?.match(/^Bearer\s+(mrk_[A-Za-z0-9_-]{43})$/)
  return match?.[1] ?? null
}

function getErrorClass(error: unknown, state: GatewayRequestState): ProviderErrorClass {
  if (state.errorClass) return state.errorClass
  if (error instanceof RouterRequestError) return error.errorClass
  if (error instanceof AllTargetsFailed) return error.failures.at(-1)?.errorClass ?? 'server'
  if (error instanceof DOMException && error.name === 'AbortError') return 'timeout'
  return 'server'
}

function errorStatus(errorClass: ProviderErrorClass): number {
  switch (errorClass) {
    case 'auth': return 401
    case 'quota': return 402
    case 'rate_limit': return 429
    case 'model_not_found': return 404
    case 'bad_request':
    case 'content_filter': return 400
    case 'timeout': return 504
    case 'network':
    case 'server':
    case 'stream_interrupted': return 502
  }
}

function publicErrorMessage(errorClass: ProviderErrorClass): string {
  switch (errorClass) {
    case 'auth': return 'A saved AI key was rejected.'
    case 'quota': return 'A saved AI key has no available credits.'
    case 'rate_limit': return 'The AI service is busy. Try again shortly.'
    case 'model_not_found': return 'The requested model is not available in the backup plan.'
    case 'bad_request': return 'The request could not be sent. Check the model and messages.'
    case 'content_filter': return 'The AI service blocked this request.'
    case 'timeout': return 'The AI service did not answer in time.'
    case 'network':
    case 'server': return 'The AI service could not complete the request.'
    case 'stream_interrupted': return 'The answer stream stopped early. No other model was tried.'
  }
}

function processRouterEvent(event: RouterEvent, state: GatewayRequestState): void {
  if (event.type === 'attempt_start') {
    state.lastTarget = event.target
    state.inputTokens = null
    state.outputTokens = null
  } else if (event.type === 'chunk') {
    state.lastTarget = event.target
    if (state.firstTokenAt === null) state.firstTokenAt = performance.now()
    try {
      state.outputBytes = countGatewayOutputBytes(state.outputBytes, event.text)
    } catch (error) {
      state.errorClass = 'server'
      throw error
    }
    state.content += event.text
  } else if (event.type === 'usage') {
    state.inputTokens = event.inputTokens
    state.outputTokens = event.outputTokens
  } else if (event.type === 'fallback') {
    state.fallbackCount += 1
  } else if (event.type === 'done') {
    state.answerTarget = event.target
    state.lastTarget = event.target
    state.status = 'success'
  } else if (event.type === 'error') {
    state.lastTarget = event.target ?? state.lastTarget
    state.errorClass = event.errorClass
    state.httpStatus = event.httpStatus ?? null
    state.status = 'error'
  }
}

async function writeGatewayLog(
  client: GatewayClient,
  state: GatewayRequestState,
): Promise<void> {
  if (state.logWritten) return
  state.logWritten = true
  const target = state.answerTarget ?? state.lastTarget
  if (!target) return
  const row = createGatewayLogRow({
    userId: state.userId,
    createdAt: state.createdAt,
    provider: target.provider,
    model: target.model,
    keyId: target.keyId,
    latencyMs: performance.now() - state.startedAt,
    ttfbMs: state.firstTokenAt === null ? null : state.firstTokenAt - state.startedAt,
    inputTokens: state.inputTokens,
    outputTokens: state.outputTokens,
    inputCharacters: state.inputCharacters,
    outputCharacters: state.content.length,
    status: state.status,
    httpStatus: state.httpStatus,
    errorClass: state.errorClass,
    fallbackCount: state.fallbackCount,
  })
  const { error } = await client.from('request_logs').insert(row)
  if (error) throw new Error('Gateway activity could not be saved.')
}

async function stopGatewayRoute(
  generator: AsyncGenerator<RouterEvent>,
  controller: AbortController,
  state: GatewayRequestState,
): Promise<void> {
  controller.abort()
  try {
    await generator.return(undefined)
  } catch {
    state.status = 'error'
    state.errorClass = 'server'
  }
}

async function readPlanAndSharedKeys(
  client: GatewayClient,
  userId: string,
  requestedModel: string,
): Promise<
  | {
    ok: true
    plan: NonNullable<ReturnType<typeof parseAutoBackupPlan>>
    targets: RouteTarget[]
    keysById: Record<string, string>
  }
  | { ok: false; reason: 'database' | 'plan' | 'targets' | 'secret' | 'decryption' }
> {
  const [{ data: planData, error: planError }, { data: keyRows, error: keysError }] = await Promise.all([
    client.from('auto_backup_plans')
      .select('targets, max_attempts, first_token_timeout_ms')
      .eq('user_id', userId)
      .maybeSingle(),
    client.from('gateway_provider_keys')
      .select('provider_key_id, provider, ciphertext, iv')
      .eq('user_id', userId),
  ])
  if (planError || keysError || !Array.isArray(keyRows)) return { ok: false, reason: 'database' }
  if (!planData) return { ok: false, reason: 'plan' }
  const plan = parseAutoBackupPlan(planData)
  if (!plan) return { ok: false, reason: 'plan' }

  const sharedById = new Map<string, SharedGatewayKey>()
  for (const row of keyRows as unknown[]) {
    if (!isRecord(row)
      || typeof row.provider_key_id !== 'string'
      || typeof row.provider !== 'string'
      || typeof row.ciphertext !== 'string'
      || typeof row.iv !== 'string'
      || !PROVIDER_CONFIGS.some((provider) => provider.id === row.provider)) continue
    sharedById.set(row.provider_key_id, {
      provider_key_id: row.provider_key_id,
      provider: row.provider as ProviderId,
      ciphertext: row.ciphertext,
      iv: row.iv,
    })
  }

  const targets = plan.targets.filter((target) => (
    sharedById.get(target.keyId)?.provider === target.provider
    && (requestedModel === 'auto' || target.model === requestedModel)
  ))
  if (targets.length === 0) return { ok: false, reason: 'targets' }

  const masterKey = Deno.env.get('GATEWAY_MASTER_KEY')
  if (!masterKey) return { ok: false, reason: 'secret' }
  const keysById: Record<string, string> = {}
  for (const target of targets) {
    if (keysById[target.keyId]) continue
    const row = sharedById.get(target.keyId)
    if (!row) continue
    try {
      keysById[target.keyId] = await decryptGatewaySecret(
        row as GatewayEncryptedSecret,
        masterKey,
        userId,
        row.provider_key_id,
        row.provider,
      )
    } catch (error) {
      if (!(error instanceof GatewayCryptoError)) throw error
    }
  }

  const availableTargets = targets.filter((target) => Boolean(keysById[target.keyId]))
  if (!availableTargets.length) return { ok: false, reason: 'decryption' }
  return { ok: true, plan, targets: availableTargets, keysById }
}

function getAppOrigin(): string {
  const configured = Deno.env.get('APP_ORIGIN') ?? Deno.env.get('APP_ORIGINS') ?? ''
  return configured.split(',').map((value) => value.trim()).find(Boolean) ?? ''
}

function makeRouteDependencies(currentRequest: NonNullable<ReturnType<typeof parseGatewayChatRequest>>) {
  const appOrigin = getAppOrigin()
  const adapters = Object.fromEntries(
    PROVIDER_CONFIGS.map(({ id }) => [id, getGatewayAdapter(id, appOrigin)]),
  )
  return {
    adapters,
    health: providerHealth,
    transport: async (
      target: RouteTarget,
      adapterRequest: { url: string; headers: HeadersInit; body: unknown },
      apiKey: string,
      signal: AbortSignal,
    ) => {
      const provider = getProviderConfig(target.provider)
      const endpoint = new URL(adapterRequest.url)
      if (endpoint.protocol !== 'https:'
        || !ALLOWED_PROVIDER_HOSTS.has(endpoint.hostname)
        || endpoint.hostname !== new URL(provider.baseUrl).hostname) {
        throw new RouterRequestError('The provider destination is not allowed.', 'bad_request')
      }

      const headers = new Headers({
        accept: 'text/event-stream',
        'content-type': 'application/json',
      })
      headers.set(
        provider.authStyle === 'bearer' ? 'authorization' : provider.authStyle,
        provider.authStyle === 'bearer' ? `Bearer ${apiKey}` : apiKey,
      )
      for (const [name, value] of Object.entries(provider.extraHeaders)) {
        headers.set(name, value === '$APP_ORIGIN' ? appOrigin : value)
      }
      return fetch(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify(applyGatewayGenerationOptions(provider.apiStyle, adapterRequest.body, currentRequest)),
        signal,
        redirect: 'error',
      })
    },
  }
}

async function serveGatewayRequest(request: Request): Promise<Response> {
  const url = new URL(request.url)
  const origin = request.headers.get('origin')
  const configuredOrigins = safeConfiguredOrigins()
  if (origin && !configuredOrigins.has(origin)) {
    return jsonResponse('This app origin is not allowed.', 403, null)
  }
  if (request.method === 'OPTIONS') {
    if (!origin || !configuredOrigins.has(origin)) {
      return new Response(null, { status: 204, headers: corsHeaders(null) })
    }
    return new Response(null, { status: 204, headers: corsHeaders(origin) })
  }
  if (!isGatewayPath(url.pathname)) return jsonResponse('Gateway endpoint not found.', 404, origin)
  if (request.method !== 'POST') {
    const response = jsonResponse('Only POST requests are supported.', 405, origin)
    response.headers.set('allow', 'POST, OPTIONS')
    return response
  }
  if (request.headers.has('content-length')) {
    const contentLength = request.headers.get('content-length') ?? ''
    if (!/^\d+$/.test(contentLength) || Number(contentLength) > MAX_GATEWAY_BODY_BYTES) {
      return jsonResponse('The request is too large.', 413, origin)
    }
  }
  if (request.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase() !== 'application/json') {
    return jsonResponse('Send a JSON request.', 415, origin)
  }

  const routerKey = getRouterKey(request)
  if (!routerKey) return jsonResponse('A valid router key is required.', 401, origin, 'authentication_error')
  let keyHash: string
  try {
    keyHash = await hashGatewayRouterKey(routerKey)
  } catch {
    return jsonResponse('A valid router key is required.', 401, origin, 'authentication_error')
  }

  const client = getAdminClient()
  if (!client) return jsonResponse('The gateway is not configured.', 503, origin)
  const { data: usageData, error: usageError } = await client.rpc(
    'consume_gateway_router_key',
    { p_key_hash: keyHash },
  )
  if (usageError) return jsonResponse('The gateway is temporarily unavailable.', 503, origin)
  const usageRow = Array.isArray(usageData) ? usageData[0] as unknown : null
  if (!isRecord(usageRow)
    || typeof usageRow.user_id !== 'string'
    || typeof usageRow.minute_count !== 'number'
    || typeof usageRow.day_count !== 'number'
    || typeof usageRow.minute_limit !== 'number'
    || typeof usageRow.day_limit !== 'number') {
    return jsonResponse('A valid router key is required.', 401, origin, 'authentication_error')
  }
  const usage = usageRow as unknown as GatewayUsageRecord
  if (!isWithinGatewayLimits(
    { minuteCount: usage.minute_count, dayCount: usage.day_count },
    { requestsPerMinute: usage.minute_limit, requestsPerDay: usage.day_limit },
  )) {
    return jsonResponse('This router key has reached its request limit.', 429, origin)
  }

  const parsedBody = await readGatewayBody(request.body)
  const chatRequest = parseGatewayChatRequest(parsedBody)
  if (!chatRequest) return jsonResponse('The request is invalid or too large.', 400, origin)

  const routeData = await readPlanAndSharedKeys(client, usage.user_id, chatRequest.model)
  if (!routeData.ok) {
    if (routeData.reason === 'database') {
      return jsonResponse('The gateway is temporarily unavailable.', 503, origin)
    }
    if (routeData.reason === 'secret' || routeData.reason === 'decryption') {
      return jsonResponse('The gateway key store is not available.', 503, origin)
    }
    return jsonResponse('No shared AI in the saved backup plan is available.', 400, origin)
  }

  const controller = new AbortController()
  const abortIncoming = () => controller.abort(request.signal.reason)
  if (request.signal.aborted) abortIncoming()
  else request.signal.addEventListener('abort', abortIncoming, { once: true })
  const state: GatewayRequestState = {
    userId: usage.user_id,
    createdAt: new Date().toISOString(),
    startedAt: performance.now(),
    inputCharacters: chatRequest.messages.reduce((total, message) => total + message.content.length, 0),
    content: '',
    outputBytes: 0,
    firstTokenAt: null,
    inputTokens: null,
    outputTokens: null,
    answerTarget: null,
    lastTarget: null,
    status: 'error',
    httpStatus: null,
    errorClass: null,
    fallbackCount: 0,
    logWritten: false,
  }
  const activeRule = {
    alias: 'External gateway',
    strategy: 'priority' as const,
    timeoutMs: 120_000,
    firstTokenTimeoutMs: routeData.plan.firstTokenTimeoutMs,
    maxAttempts: routeData.plan.maxAttempts,
    maxCycles: 2,
    failoverOnQuota: true,
    targets: routeData.targets,
  }
  const generator = route(
    { messages: chatRequest.messages, keysById: routeData.keysById, signal: controller.signal },
    activeRule,
    makeRouteDependencies(chatRequest),
  )
  const id = completionId()
  const created = completionCreatedAt()
  let firstChunk: Extract<RouterEvent, { type: 'chunk' }> | null = null
  let completedWithoutContent = false
  let caughtError: unknown = null

  if (chatRequest.stream) {
    while (!firstChunk && !completedWithoutContent && !caughtError) {
      try {
        const next = await generator.next()
        if (next.done) {
          completedWithoutContent = state.status === 'success'
          break
        }
        processRouterEvent(next.value, state)
        if (next.value.type === 'chunk') firstChunk = next.value
        if (next.value.type === 'error') state.status = 'error'
      } catch (error) {
        caughtError = error
        if (error instanceof GatewayOutputLimitError) {
          state.status = 'error'
          state.errorClass = 'server'
          await stopGatewayRoute(generator, controller, state)
        }
      }
    }

    if (!firstChunk && !completedWithoutContent) {
      if (!(caughtError instanceof GatewayOutputLimitError)) {
        state.status = controller.signal.aborted ? 'aborted' : 'error'
        state.errorClass = getErrorClass(caughtError, state)
      }
      try {
        await writeGatewayLog(client, state)
      } catch {
        request.signal.removeEventListener('abort', abortIncoming)
        return jsonResponse('The gateway could not save request activity.', 503, origin)
      }
      request.signal.removeEventListener('abort', abortIncoming)
      return jsonResponse(
        publicErrorMessage(state.errorClass ?? 'server'),
        errorStatus(state.errorClass ?? 'server'),
        origin,
      )
    }

    const responseHeaders = corsHeaders(origin)
    responseHeaders.set('content-type', 'text/event-stream; charset=utf-8')
    responseHeaders.set('cache-control', 'no-cache, no-store, no-transform')
    responseHeaders.set('x-content-type-options', 'nosniff')
    let responseCancelled = false
    const stream = new ReadableStream<Uint8Array>({
      start(streamController) {
        void (async () => {
          const send = (payload: unknown) => {
            if (!responseCancelled) streamController.enqueue(encodeServerSentEvent(payload))
          }
          try {
            const target = firstChunk?.target ?? state.answerTarget ?? state.lastTarget
            const model = target?.model ?? chatRequest.model
            send(makeCompletionChunk(id, created, model, { role: 'assistant' }))
            if (firstChunk) {
              send(makeCompletionChunk(id, created, firstChunk.target.model, { content: firstChunk.text }))
            }

            while (true) {
              const next = await generator.next()
              if (next.done) break
              processRouterEvent(next.value, state)
              if (next.value.type === 'chunk') {
                send(makeCompletionChunk(id, created, next.value.target.model, { content: next.value.text }))
              }
            }
            if (state.status !== 'success' && !controller.signal.aborted) {
              state.status = 'error'
            }
            await writeGatewayLog(client, state)
            const finalTarget = state.answerTarget ?? state.lastTarget
            if (!finalTarget) throw new Error('The gateway route ended without a target.')
            const usage = {
              inputTokens: state.inputTokens ?? estimateTokens(state.inputCharacters),
              outputTokens: state.outputTokens ?? estimateTokens(state.content.length),
            }
            send(makeCompletionChunk(
              id,
              created,
              finalTarget.model,
              {},
              state.status === 'success' ? 'stop' : null,
            ))
            send({
              id,
              object: 'chat.completion.chunk',
              created,
              model: finalTarget.model,
              choices: [],
              usage: {
                prompt_tokens: usage.inputTokens,
                completion_tokens: usage.outputTokens,
                total_tokens: usage.inputTokens + usage.outputTokens,
              },
            })
            if (!responseCancelled) streamController.enqueue(encodeServerSentEventDone())
          } catch (error) {
            if (error instanceof GatewayOutputLimitError) {
              state.status = 'error'
              state.errorClass = 'server'
              await stopGatewayRoute(generator, controller, state)
            } else if (controller.signal.aborted) state.status = 'aborted'
            else {
              state.status = 'error'
              state.errorClass = getErrorClass(error, state)
            }
            try {
              await writeGatewayLog(client, state)
            } catch {
              state.errorClass = 'server'
            }
            if (!responseCancelled) {
              send({
                error: {
                  message: publicErrorMessage(state.errorClass ?? 'server'),
                  type: 'api_error',
                },
              })
            }
          } finally {
            request.signal.removeEventListener('abort', abortIncoming)
            if (!responseCancelled) streamController.close()
          }
        })()
      },
      async cancel(reason) {
        responseCancelled = true
        state.status = 'aborted'
        controller.abort(reason)
        try {
          await generator.return(undefined)
        } catch {
          state.status = 'error'
          state.errorClass = 'server'
        }
        request.signal.removeEventListener('abort', abortIncoming)
      },
    })
    return new Response(stream, { status: 200, headers: responseHeaders })
  }

  try {
    for await (const event of generator) processRouterEvent(event, state)
  } catch (error) {
    if (error instanceof GatewayOutputLimitError) {
      state.status = 'error'
      state.errorClass = 'server'
      await stopGatewayRoute(generator, controller, state)
    } else {
      state.status = controller.signal.aborted ? 'aborted' : 'error'
      state.errorClass = getErrorClass(error, state)
    }
  }
  try {
    await writeGatewayLog(client, state)
  } catch {
    request.signal.removeEventListener('abort', abortIncoming)
    return jsonResponse('The gateway could not save request activity.', 503, origin)
  }
  request.signal.removeEventListener('abort', abortIncoming)

  if (state.status !== 'success') {
    const errorClass = state.errorClass ?? 'server'
    return jsonResponse(publicErrorMessage(errorClass), errorStatus(errorClass), origin)
  }
  const target = state.answerTarget
  if (!target) return jsonResponse('The gateway could not complete the request.', 502, origin)
  const responseHeaders = corsHeaders(origin)
  responseHeaders.set('content-type', 'application/json; charset=utf-8')
  responseHeaders.set('cache-control', 'no-store')
  responseHeaders.set('x-content-type-options', 'nosniff')
  return new Response(JSON.stringify(makeCompletionResponse(
    id,
    created,
    target.model,
    state.content,
    {
      inputTokens: state.inputTokens ?? estimateTokens(state.inputCharacters),
      outputTokens: state.outputTokens ?? estimateTokens(state.content.length),
    },
  )), {
    status: 200,
    headers: responseHeaders,
  })
}

Deno.serve(serveGatewayRequest)
