import { createClient } from 'npm:@supabase/supabase-js@2'
import { encryptGatewaySecret } from '../../../src/core/gateway-crypto.ts'
import { isProviderId } from '../../../src/core/providers.ts'
import {
  MAX_GATEWAY_BODY_BYTES,
  readGatewayBody,
} from '../gateway/request-guards.ts'

const MAX_ADMIN_BODY_BYTES = 16_000
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function configuredOrigins(): Set<string> {
  const configured = Deno.env.get('APP_ORIGINS') ?? Deno.env.get('APP_ORIGIN') ?? ''
  const origins = new Set<string>()
  for (const candidate of configured.split(',')) {
    const origin = candidate.trim()
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
  if (origin && configuredOrigins().has(origin)) {
    headers.set('access-control-allow-origin', origin)
    headers.set('access-control-allow-headers', 'authorization, content-type, apikey, x-client-info')
    headers.set('access-control-allow-methods', 'POST, OPTIONS')
    headers.set('access-control-max-age', '600')
  }
  return headers
}

function jsonResponse(
  body: Record<string, unknown>,
  status: number,
  origin: string | null,
): Response {
  const headers = corsHeaders(origin)
  headers.set('content-type', 'application/json; charset=utf-8')
  headers.set('cache-control', 'no-store')
  headers.set('x-content-type-options', 'nosniff')
  return new Response(JSON.stringify(body), { status, headers })
}

function getServiceClient() {
  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!supabaseUrl || !serviceRoleKey) return null
  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

async function getOwnerId(request: Request): Promise<string | null> {
  const accessToken = request.headers.get('authorization')?.match(/^Bearer\s+(.+)$/i)?.[1]
  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
  if (!accessToken || !supabaseUrl || !anonKey) return null
  const authClient = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { data: { user }, error } = await authClient.auth.getUser(accessToken)
  return error || !user ? null : user.id
}

async function handleShareKey(request: Request): Promise<Response> {
  const origin = request.headers.get('origin')
  const origins = configuredOrigins()
  if (origin && !origins.has(origin)) return jsonResponse({ error: 'Origin not allowed.' }, 403, null)
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: origin && origins.has(origin) ? corsHeaders(origin) : corsHeaders(null),
    })
  }
  if (request.method !== 'POST') {
    const response = jsonResponse({ error: 'Only POST requests are supported.' }, 405, origin)
    response.headers.set('allow', 'POST, OPTIONS')
    return response
  }
  const contentType = request.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase()
  if (contentType !== 'application/json') {
    return jsonResponse({ error: 'Send a JSON request.' }, 415, origin)
  }
  const contentLength = request.headers.get('content-length')
  if (contentLength && (!/^\d+$/.test(contentLength) || Number(contentLength) > MAX_ADMIN_BODY_BYTES)) {
    return jsonResponse({ error: 'The request is too large.' }, 413, origin)
  }
  const ownerId = await getOwnerId(request)
  if (!ownerId) return jsonResponse({ error: 'Sign in to share an AI key.' }, 401, origin)
  const body = await readGatewayBody(request.body, Math.min(MAX_GATEWAY_BODY_BYTES, MAX_ADMIN_BODY_BYTES))
  if (!isRecord(body)
    || Object.keys(body).some((key) => !['providerKeyId', 'apiKey'].includes(key))
    || typeof body.providerKeyId !== 'string'
    || !UUID_PATTERN.test(body.providerKeyId)
    || typeof body.apiKey !== 'string'
    || !body.apiKey.trim()
    || body.apiKey.length > 4096) {
    return jsonResponse({ error: 'The shared AI key request is invalid.' }, 400, origin)
  }

  const masterKey = Deno.env.get('GATEWAY_MASTER_KEY')
  const client = getServiceClient()
  if (!masterKey || !client) return jsonResponse({ error: 'The gateway is not configured.' }, 503, origin)
  try {
    const { data: savedKey, error: savedKeyError } = await client
      .from('provider_keys')
      .select('id, user_id, provider, label')
      .eq('id', body.providerKeyId)
      .eq('user_id', ownerId)
      .maybeSingle()
    if (savedKeyError) return jsonResponse({ error: 'Could not load the saved AI key.' }, 503, origin)
    if (!savedKey || typeof savedKey.provider !== 'string' || !isProviderId(savedKey.provider)
      || typeof savedKey.label !== 'string') {
      return jsonResponse({ error: 'The saved AI key could not be found.' }, 404, origin)
    }

    const encrypted = await encryptGatewaySecret(
      body.apiKey,
      masterKey,
      ownerId,
      savedKey.id,
      savedKey.provider,
    )
    const { error: saveError } = await client
      .from('gateway_provider_keys')
      .upsert({
        provider_key_id: savedKey.id,
        user_id: ownerId,
        provider: savedKey.provider,
        label: savedKey.label,
        ciphertext: encrypted.ciphertext,
        iv: encrypted.iv,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'provider_key_id,user_id' })
    if (saveError) return jsonResponse({ error: 'Could not save the encrypted AI key.' }, 503, origin)
    return jsonResponse({ ok: true }, 200, origin)
  } catch {
    return jsonResponse({ error: 'Could not protect this AI key for gateway use.' }, 503, origin)
  }
}

Deno.serve(handleShareKey)
