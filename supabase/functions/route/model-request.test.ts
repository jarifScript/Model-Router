import { describe, expect, it } from 'vitest'
import { isModelsRequest } from './model-request'

const providerIds = ['openai', 'openrouter', 'gemini']

describe('Edge Function model request validation', () => {
  it('rejects unknown provider IDs', () => {
    expect(isModelsRequest({ action: 'models', providerId: 'unknown' }, providerIds)).toBe(false)
  })

  it('rejects client-supplied URLs', () => {
    expect(isModelsRequest({
      action: 'models',
      providerId: 'openrouter',
      url: 'https://example.invalid/models',
    }, providerIds)).toBe(false)
  })

  it('accepts only the provider ID and models action', () => {
    expect(isModelsRequest({ action: 'models', providerId: 'openrouter' }, providerIds)).toBe(true)
  })
})
