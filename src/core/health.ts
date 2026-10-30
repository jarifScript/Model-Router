import type { ProviderErrorClass } from './adapters/types.ts'
import type { RouteTarget } from './route-types.ts'

type CircuitHealth = {
  consecutiveFailures: number
  open: boolean
  openedAt?: number
  openUntil?: number
  cooldownMs: number
  probeInFlight?: boolean
}

export type TargetHealth = CircuitHealth & {
  averageLatencyMs?: number
  lastSuccessAt?: number
  needsAttention: boolean
  attentionReason?: Extract<ProviderErrorClass, 'auth' | 'quota' | 'model_not_found'>
}

export type HealthSnapshot = {
  byTarget: Record<string, TargetHealth>
  byCircuit: Record<string, CircuitHealth>
  roundRobinOffset: number
  weightedCursor: number
}

export type Clock = { now: () => number; sleep: (ms: number, signal?: AbortSignal) => Promise<void> }

export const systemClock: Clock = {
  now: () => Date.now(),
  sleep: (ms, signal) => new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Aborted', 'AbortError'))
      return
    }
    const cleanup = () => signal?.removeEventListener('abort', abort)
    const timer = setTimeout(() => {
      cleanup()
      resolve()
    }, ms)
    const abort = () => {
      clearTimeout(timer)
      cleanup()
      reject(new DOMException('Aborted', 'AbortError'))
    }
    signal?.addEventListener('abort', abort, { once: true })
  }),
}

export function getCircuitKey(target: Pick<RouteTarget, 'provider' | 'keyId'>): string {
  return `${target.provider}:${target.keyId}`
}

export function getTargetHealthKey(target: RouteTarget): string {
  return `${getCircuitKey(target)}:${target.model}`
}

const BREAKER_FAILURES = new Set<ProviderErrorClass>(['rate_limit', 'server', 'timeout', 'network'])
const ATTENTION_FAILURES = new Set<ProviderErrorClass>(['auth', 'quota', 'model_not_found'])

function isAttentionFailure(
  errorClass: ProviderErrorClass,
): errorClass is Extract<ProviderErrorClass, 'auth' | 'quota' | 'model_not_found'> {
  return ATTENTION_FAILURES.has(errorClass)
}

export class ProviderHealth {
  private readonly circuits = new Map<string, CircuitHealth>()
  private readonly targets = new Map<string, Omit<TargetHealth, keyof CircuitHealth>>()
  private readonly targetCircuits = new Map<string, string>()
  private roundRobinOffset = 0
  private weightedCursor = 0

  constructor(private readonly clock: Clock = systemClock) {}

  private getCircuit(target: RouteTarget): CircuitHealth {
    const key = getCircuitKey(target)
    let entry = this.circuits.get(key)
    if (!entry) {
      entry = { consecutiveFailures: 0, open: false, cooldownMs: 30_000 }
      this.circuits.set(key, entry)
    }
    this.targetCircuits.set(getTargetHealthKey(target), key)
    return entry
  }

  shouldAllow(target: RouteTarget, forceOpenProbe = false): boolean {
    const entry = this.getCircuit(target)
    const now = this.clock.now()
    if (entry.open && forceOpenProbe && !entry.probeInFlight) {
      entry.probeInFlight = true
      return true
    }
    if (!entry.open || (entry.openUntil !== undefined && now >= entry.openUntil)) {
      if (entry.openUntil !== undefined && now >= entry.openUntil) {
        if (entry.probeInFlight) return false
        entry.probeInFlight = true
      }
      return true
    }
    return false
  }

  recordSuccess(target: RouteTarget, latencyMs: number): void {
    const circuit = this.getCircuit(target)
    circuit.open = false
    circuit.openedAt = undefined
    circuit.openUntil = undefined
    circuit.probeInFlight = false
    circuit.consecutiveFailures = 0
    circuit.cooldownMs = 30_000
    const targetKey = getTargetHealthKey(target)
    const metrics = this.targets.get(targetKey) ?? { needsAttention: false }
    metrics.needsAttention = false
    metrics.attentionReason = undefined
    metrics.lastSuccessAt = this.clock.now()
    metrics.averageLatencyMs = metrics.averageLatencyMs === undefined
      ? latencyMs
      : (metrics.averageLatencyMs * 0.8) + (latencyMs * 0.2)
    this.targets.set(targetKey, metrics)
  }

  cancelProbe(target: RouteTarget): void {
    const entry = this.circuits.get(getCircuitKey(target))
    if (entry) entry.probeInFlight = false
  }

  recordFailure(target: RouteTarget, errorClass: ProviderErrorClass): void {
    const entry = this.getCircuit(target)
    entry.probeInFlight = false
    if (isAttentionFailure(errorClass)) this.markNeedsAttention(target, errorClass)
    if (!BREAKER_FAILURES.has(errorClass)) {
      entry.consecutiveFailures = 0
      return
    }

    entry.consecutiveFailures += 1
    const probeFailed = entry.open && entry.openUntil !== undefined && this.clock.now() >= entry.openUntil
    if (entry.consecutiveFailures >= 3 || probeFailed) {
      if (probeFailed) entry.cooldownMs = Math.min(entry.cooldownMs * 2, 120_000)
      entry.open = true
      entry.openedAt = this.clock.now()
      entry.openUntil = entry.openedAt + entry.cooldownMs
      entry.consecutiveFailures = 0
    }
  }

  markNeedsAttention(
    target: RouteTarget,
    reason?: Extract<ProviderErrorClass, 'auth' | 'quota' | 'model_not_found'>,
  ): void {
    const key = getTargetHealthKey(target)
    const metrics = this.targets.get(key) ?? { needsAttention: false }
    metrics.needsAttention = true
    if (reason) metrics.attentionReason = reason
    this.targets.set(key, metrics)
  }

  advanceStrategy(strategy: 'round_robin' | 'weighted'): void {
    if (strategy === 'round_robin') this.roundRobinOffset += 1
    else this.weightedCursor += 1
  }

  snapshot(): HealthSnapshot {
    const now = this.clock.now()
    const byTarget: Record<string, TargetHealth> = {}
    const byCircuit: Record<string, CircuitHealth> = {}
    for (const [key, value] of this.circuits) {
      byCircuit[key] = {
        ...value,
        open: value.open && value.openUntil !== undefined && now < value.openUntil,
      }
    }
    for (const [key, metrics] of this.targets) {
      const circuitKey = this.targetCircuits.get(key)
      const circuit = circuitKey ? byCircuit[circuitKey] : undefined
      byTarget[key] = {
        consecutiveFailures: circuit?.consecutiveFailures ?? 0,
        open: circuit?.open ?? false,
        openedAt: circuit?.openedAt,
        openUntil: circuit?.openUntil,
        cooldownMs: circuit?.cooldownMs ?? 30_000,
        averageLatencyMs: metrics.averageLatencyMs,
        lastSuccessAt: metrics.lastSuccessAt,
        needsAttention: metrics.needsAttention,
        attentionReason: metrics.attentionReason,
      }
    }
    return { byTarget, byCircuit, roundRobinOffset: this.roundRobinOffset, weightedCursor: this.weightedCursor }
  }
}
