import type { ProviderId } from '../../../src/core/providers.ts'
import type { ProviderErrorClass } from '../../../src/core/adapters/types.ts'
type RequestLogStatus = 'success' | 'error' | 'aborted'
import { estimateTokens } from './responses.ts'

export type GatewayLogInput = {
  userId: string
  createdAt: string
  provider: ProviderId
  model: string
  keyId: string | null
  latencyMs: number
  ttfbMs: number | null
  inputTokens: number | null
  outputTokens: number | null
  inputCharacters: number
  outputCharacters: number
  status: RequestLogStatus
  httpStatus: number | null
  errorClass: ProviderErrorClass | null
  fallbackCount: number
}

export type GatewayLogRow = {
  user_id: string
  created_at: string
  source: 'gateway'
  route_alias: string
  provider: ProviderId
  model: string
  key_id: string | null
  latency_ms: number
  ttfb_ms: number | null
  input_tokens: number
  output_tokens: number
  tokens_estimated: boolean
  status: RequestLogStatus
  http_status: number | null
  error_class: ProviderErrorClass | null
  fallback_count: number
  est_cost_usd: number | null
  est_baseline_cost_usd: number | null
  est_saved_usd: number | null
}

export function createGatewayLogRow(input: GatewayLogInput): GatewayLogRow {
  const inputEstimated = input.inputTokens === null
  const outputEstimated = input.outputTokens === null
  return {
    user_id: input.userId,
    created_at: input.createdAt,
    source: 'gateway',
    route_alias: 'External gateway',
    provider: input.provider,
    model: input.model,
    key_id: input.keyId,
    latency_ms: Math.max(0, Math.round(input.latencyMs)),
    ttfb_ms: input.ttfbMs === null ? null : Math.max(0, Math.round(input.ttfbMs)),
    input_tokens: input.inputTokens ?? estimateTokens(input.inputCharacters),
    output_tokens: input.outputTokens ?? estimateTokens(input.outputCharacters),
    tokens_estimated: inputEstimated || outputEstimated,
    status: input.status,
    http_status: input.httpStatus,
    error_class: input.errorClass,
    fallback_count: Math.max(0, Math.round(input.fallbackCount)),
    est_cost_usd: null,
    est_baseline_cost_usd: null,
    est_saved_usd: null,
  }
}
