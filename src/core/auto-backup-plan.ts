import { isProviderId } from './providers.ts'
import type { RouteTarget } from './route-types.ts'

export type AutoBackupPlan = {
  targets: RouteTarget[]
  maxAttempts: number
  firstTokenTimeoutMs: number
}

export const DEFAULT_AUTO_BACKUP_ATTEMPTS = 6
export const DEFAULT_FIRST_TOKEN_TIMEOUT_MS = 15_000

export function parseAutoBackupPlan(value: unknown): AutoBackupPlan | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  const row = value as Record<string, unknown>
  if (!Number.isInteger(row.max_attempts) || (row.max_attempts as number) < 2 || (row.max_attempts as number) > 12
    || !Array.isArray(row.targets)) return null
  const firstTokenTimeoutMs = row.first_token_timeout_ms ?? DEFAULT_FIRST_TOKEN_TIMEOUT_MS
  if (!Number.isInteger(firstTokenTimeoutMs)
    || (firstTokenTimeoutMs as number) < 1000
    || (firstTokenTimeoutMs as number) > 120_000) return null

  const targets: RouteTarget[] = []
  for (const value of row.targets) {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
    const target = value as Record<string, unknown>
    if (typeof target.provider !== 'string' || !isProviderId(target.provider)
      || typeof target.model !== 'string' || !target.model.trim() || target.model.length > 180
      || typeof target.keyId !== 'string' || !target.keyId.trim()
      || (target.timeoutMs !== undefined
        && (!Number.isInteger(target.timeoutMs) || (target.timeoutMs as number) < 1000 || (target.timeoutMs as number) > 120_000))) {
      return null
    }
    targets.push({
      provider: target.provider,
      model: target.model,
      keyId: target.keyId,
      timeoutMs: typeof target.timeoutMs === 'number' ? target.timeoutMs : 30_000,
      maxAttempts: 1,
    })
  }
  return {
    targets,
    maxAttempts: row.max_attempts as number,
    firstTokenTimeoutMs: firstTokenTimeoutMs as number,
  }
}

export function autoTargetIdentity(target: Pick<RouteTarget, 'provider' | 'model' | 'keyId'>): string {
  return `${target.provider}:${target.keyId}:${target.model}`
}

export function mergeAutoBackupTargets(
  saved: RouteTarget[],
  discovered: RouteTarget[],
  validKeyIds: ReadonlySet<string>,
): RouteTarget[] {
  const merged = new Map<string, RouteTarget>()
  const seenModels = new Set<string>()
  for (const target of saved) {
    const modelIdentity = `${target.provider}:${target.model}`
    if (validKeyIds.has(target.keyId) && !seenModels.has(modelIdentity)) {
      merged.set(autoTargetIdentity(target), { ...target, maxAttempts: 1 })
      seenModels.add(modelIdentity)
    }
  }
  for (const target of discovered) {
    const modelIdentity = `${target.provider}:${target.model}`
    if (validKeyIds.has(target.keyId) && !seenModels.has(modelIdentity)) {
      merged.set(autoTargetIdentity(target), { ...target, timeoutMs: target.timeoutMs ?? 30_000, maxAttempts: 1 })
      seenModels.add(modelIdentity)
    }
  }
  return [...merged.values()]
}
