export type GatewayKeyLimits = {
  requestsPerMinute: number
  requestsPerDay: number
}

export type GatewayKeyUsage = {
  minuteCount: number
  dayCount: number
}

export const MAX_GATEWAY_OUTPUT_BYTES = 512_000

export class GatewayOutputLimitError extends Error {
  constructor() {
    super('Gateway output limit reached.')
    this.name = 'GatewayOutputLimitError'
  }
}

export function countGatewayOutputBytes(currentBytes: number, text: string): number {
  const nextBytes = currentBytes + new TextEncoder().encode(text).byteLength
  if (!Number.isSafeInteger(currentBytes)
    || currentBytes < 0
    || nextBytes > MAX_GATEWAY_OUTPUT_BYTES) {
    throw new GatewayOutputLimitError()
  }
  return nextBytes
}

export function isWithinGatewayLimits(usage: GatewayKeyUsage, limits: GatewayKeyLimits): boolean {
  return Number.isSafeInteger(usage.minuteCount)
    && Number.isSafeInteger(usage.dayCount)
    && usage.minuteCount >= 0
    && usage.dayCount >= 0
    && Number.isSafeInteger(limits.requestsPerMinute)
    && Number.isSafeInteger(limits.requestsPerDay)
    && usage.minuteCount <= limits.requestsPerMinute
    && usage.dayCount <= limits.requestsPerDay
}

export function isGatewayRouterKeyActive(revokedAt: string | null): boolean {
  return revokedAt === null
}
