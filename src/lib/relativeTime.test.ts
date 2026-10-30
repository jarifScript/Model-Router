import { describe, expect, it } from 'vitest'
import { formatRelativeTime } from './relativeTime'

const now = Date.UTC(2026, 0, 1)

describe('formatRelativeTime', () => {
  it('describes recent checks in minutes and hours', () => {
    expect(formatRelativeTime(now - 60_000, now, 'en')).toBe('1 minute ago')
    expect(formatRelativeTime(now - 2 * 60 * 60_000, now, 'en')).toBe('2 hours ago')
  })

  it('uses larger units for older checks', () => {
    expect(formatRelativeTime(now - 2 * 24 * 60 * 60_000, now, 'en')).toBe('2 days ago')
    expect(formatRelativeTime(now - 14 * 24 * 60 * 60_000, now, 'en')).toBe('2 weeks ago')
    expect(formatRelativeTime(now - 60 * 24 * 60 * 60_000, now, 'en')).toBe('2 months ago')
    expect(formatRelativeTime(now - 730 * 24 * 60 * 60_000, now, 'en')).toBe('2 years ago')
  })

  it('labels a recent or future timestamp as just now', () => {
    expect(formatRelativeTime(now, now, 'en')).toBe('just now')
    expect(formatRelativeTime(now + 60_000, now, 'en')).toBe('just now')
  })
})
