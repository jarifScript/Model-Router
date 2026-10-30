import { describe, expect, it } from 'vitest'
import { copy, glossaryAndTooltipAllowlist } from './copy'

const bannedWords = /\b(latency|tokens?|fallback|providers?|routes?|vault|passphrase|encrypt(?:ion)?|streams?|circuit|quota|baseline|payload|endpoint)\b/i

function collectStrings(value: unknown, path = ''): Array<{ path: string; value: string }> {
  if (typeof value === 'string') return [{ path, value }]
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => collectStrings(item, path ? `${path}.${index}` : String(index)))
  }
  if (typeof value !== 'object' || value === null) return []
  return Object.entries(value).flatMap(([key, item]) => collectStrings(item, path ? `${path}.${key}` : key))
}

describe('user-facing copy', () => {
  it('does not use banned technical words outside the glossary and tooltips', () => {
    const strings = collectStrings(copy)
    const allowedPaths = new Set(Object.keys(glossaryAndTooltipAllowlist))
    const violations = strings.filter(({ path, value }) => !allowedPaths.has(path) && bannedWords.test(value))

    expect(violations).toEqual([])
    for (const [path, reason] of Object.entries(glossaryAndTooltipAllowlist)) {
      expect(strings.some((entry) => entry.path === path)).toBe(true)
      expect(reason.trim()).not.toBe('')
    }
  })
})
