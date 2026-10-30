import { isProviderId, type ProviderId } from './providers.ts'
import type { ChatMessage } from './adapters/types.ts'

export type RouteStrategy =
  | 'priority'
  | 'round_robin'
  | 'weighted'
  | 'lowest_latency'
  | 'lowest_cost'

export type RouteTarget = {
  provider: ProviderId
  model: string
  keyId: string
  weight?: number
  timeoutMs?: number
  maxAttempts?: number
}

export type RoutingRule = {
  id?: string
  alias: string
  strategy: RouteStrategy
  timeoutMs: number
  firstTokenTimeoutMs?: number
  maxAttempts: number
  maxCycles?: number
  failoverOnQuota?: boolean
  targets: RouteTarget[]
}

export type RouterRequest = {
  messages: ChatMessage[]
  signal?: AbortSignal
  isTest?: boolean
  simulateFailures?: Partial<Record<string, 'rate_limit' | 'server' | 'timeout' | 'auth'>>
}

const ROUTE_STRATEGIES = new Set<RouteStrategy>([
  'priority',
  'round_robin',
  'weighted',
  'lowest_latency',
  'lowest_cost',
])

export function parseRoutingRule(value: unknown): RoutingRule | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  const row = value as Record<string, unknown>
  if (
    typeof row.id !== 'string'
    || typeof row.alias !== 'string'
    || typeof row.strategy !== 'string'
    || !ROUTE_STRATEGIES.has(row.strategy as RouteStrategy)
    || typeof row.timeout_ms !== 'number'
    || typeof row.max_attempts !== 'number'
    || !Array.isArray(row.targets)
  ) return null
  const targets: RouteTarget[] = []
  for (const item of row.targets) {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) return null
    const target = item as Record<string, unknown>
    if (
      typeof target.provider !== 'string'
      || !isProviderId(target.provider)
      || typeof target.model !== 'string'
      || target.model.length > 180
      || typeof target.keyId !== 'string'
      || (target.weight !== undefined
        && (typeof target.weight !== 'number' || !Number.isFinite(target.weight) || target.weight < 1 || target.weight > 100))
      || (target.timeoutMs !== undefined
        && (typeof target.timeoutMs !== 'number' || !Number.isInteger(target.timeoutMs) || target.timeoutMs < 1000 || target.timeoutMs > 120_000))
      || (target.maxAttempts !== undefined
        && (typeof target.maxAttempts !== 'number' || !Number.isInteger(target.maxAttempts) || target.maxAttempts < 1 || target.maxAttempts > 20))
    ) return null
    targets.push({
      provider: target.provider,
      model: target.model,
      keyId: target.keyId,
      ...(typeof target.weight === 'number' ? { weight: target.weight } : {}),
      ...(typeof target.timeoutMs === 'number' ? { timeoutMs: target.timeoutMs } : {}),
      ...(typeof target.maxAttempts === 'number' ? { maxAttempts: target.maxAttempts } : {}),
    })
  }
  return {
    id: row.id,
    alias: row.alias,
    strategy: row.strategy as RouteStrategy,
    timeoutMs: row.timeout_ms,
    maxAttempts: row.max_attempts,
    targets,
  }
}
