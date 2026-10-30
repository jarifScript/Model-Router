import { getCircuitKey, getTargetHealthKey, type HealthSnapshot } from './health.ts'
import type { RouteStrategy, RouteTarget } from './route-types.ts'

function skipOpenTargets(targets: RouteTarget[], health: HealthSnapshot): RouteTarget[] {
  const available = targets.filter((target) => !health.byCircuit[getCircuitKey(target)]?.open)
  if (available.length) return available
  return [...targets].sort((left, right) => {
    const leftOpened = health.byCircuit[getCircuitKey(left)]?.openedAt ?? 0
    const rightOpened = health.byCircuit[getCircuitKey(right)]?.openedAt ?? 0
    return leftOpened - rightOpened
  }).slice(0, 1)
}

export function orderTargets(
  targets: RouteTarget[],
  health: HealthSnapshot,
  strategy: RouteStrategy,
  getModelCost: (provider: RouteTarget['provider'], model: string) => number | undefined = () => undefined,
): RouteTarget[] {
  const candidates = skipOpenTargets(targets, health)
  if (strategy === 'priority') return candidates
  if (strategy === 'round_robin') {
    if (!candidates.length) return []
    const start = health.roundRobinOffset % candidates.length
    return [...candidates.slice(start), ...candidates.slice(0, start)]
  }
  if (strategy === 'weighted') {
    if (!candidates.length) return []
    const weights = candidates.map(({ weight }) => Math.max(1, Math.floor(weight ?? 1)))
    const total = weights.reduce((sum, value) => sum + value, 0)
    let selection = health.weightedCursor % total
    let first = 0
    for (; first < weights.length - 1; first += 1) {
      if (selection < weights[first]) break
      selection -= weights[first]
    }
    return [...candidates.slice(first), ...candidates.slice(0, first)]
  }
  if (strategy === 'lowest_latency') {
    return [...candidates].sort((left, right) => {
      const leftLatency = health.byTarget[getTargetHealthKey(left)]?.averageLatencyMs ?? Infinity
      const rightLatency = health.byTarget[getTargetHealthKey(right)]?.averageLatencyMs ?? Infinity
      return leftLatency - rightLatency
    })
  }
  return [...candidates].sort((left, right) => {
    const leftCost = getModelCost(left.provider, left.model) ?? Infinity
    const rightCost = getModelCost(right.provider, right.model) ?? Infinity
    return leftCost - rightCost
  })
}
