import { describe, expect, it } from 'vitest'
import { getModelCatalogRequests } from './modelCatalogRequests'

describe('model catalog requests', () => {
  it('does not request catalogs without a saved provider key', () => {
    expect(getModelCatalogRequests([])).toEqual([])
  })

  it('uses the public OpenRouter catalog only while an OpenRouter key exists', () => {
    expect(getModelCatalogRequests([
      { id: 'openrouter-key', provider: 'openrouter' },
    ])).toEqual([{ providerId: 'openrouter' }])
    expect(getModelCatalogRequests([
      { id: 'openai-key', provider: 'openai' },
    ])).toEqual([{ providerId: 'openai', keyId: 'openai-key' }])
  })

  it('keeps remaining provider key catalogs and removes only deleted key scopes', () => {
    expect(getModelCatalogRequests([
      { id: 'openai-key-2', provider: 'openai' },
      { id: 'gemini-key', provider: 'gemini' },
    ])).toEqual([
      { providerId: 'openai', keyId: 'openai-key-2' },
      { providerId: 'gemini', keyId: 'gemini-key' },
    ])
  })

  it('requests one public catalog when multiple OpenRouter keys exist', () => {
    expect(getModelCatalogRequests([
      { id: 'openrouter-key-1', provider: 'openrouter' },
      { id: 'openrouter-key-2', provider: 'openrouter' },
    ])).toEqual([{ providerId: 'openrouter' }])
  })
})
