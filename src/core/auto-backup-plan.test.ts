import { describe, expect, it } from 'vitest'
import {
  DEFAULT_AUTO_BACKUP_ATTEMPTS,
  DEFAULT_FIRST_TOKEN_TIMEOUT_MS,
  mergeAutoBackupTargets,
  parseAutoBackupPlan,
} from './auto-backup-plan'
import type { RouteTarget } from './route-types'

const first: RouteTarget = { provider: 'openrouter', model: 'model-one', keyId: 'key-a', timeoutMs: 12_000 }
const second: RouteTarget = { provider: 'openai', model: 'model-two', keyId: 'key-b', timeoutMs: 25_000 }

describe('automatic backup plan', () => {
  it('uses six attempts by default', () => {
    expect(DEFAULT_AUTO_BACKUP_ATTEMPTS).toBe(6)
  })

  it('accepts only a finite total-attempt limit from two through twelve', () => {
    expect(parseAutoBackupPlan({ targets: [first], max_attempts: 6 })).toEqual({
      targets: [{ ...first, maxAttempts: 1 }],
      maxAttempts: 6,
      firstTokenTimeoutMs: DEFAULT_FIRST_TOKEN_TIMEOUT_MS,
    })
    expect(parseAutoBackupPlan({ targets: [], max_attempts: 1 })).toBeNull()
    expect(parseAutoBackupPlan({ targets: [], max_attempts: 13 })).toBeNull()
  })

  it('parses a bounded first-token timeout', () => {
    expect(parseAutoBackupPlan({
      targets: [first],
      max_attempts: 6,
      first_token_timeout_ms: 20_000,
    })?.firstTokenTimeoutMs).toBe(20_000)
    expect(parseAutoBackupPlan({
      targets: [first],
      max_attempts: 6,
      first_token_timeout_ms: 999,
    })).toBeNull()
  })

  it('keeps saved order and timeout settings, then adds newly discovered models', () => {
    const result = mergeAutoBackupTargets(
      [first],
      [second, { ...first, timeoutMs: 30_000 }],
      new Set(['key-a', 'key-b']),
    )
    expect(result).toEqual([
      { ...first, maxAttempts: 1 },
      { ...second, maxAttempts: 1 },
    ])
  })

  it('removes entries whose saved key no longer exists', () => {
    expect(mergeAutoBackupTargets([first, second], [], new Set(['key-b']))).toEqual([
      { ...second, maxAttempts: 1 },
    ])
  })
})
