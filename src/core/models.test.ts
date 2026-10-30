import { describe, expect, it } from 'vitest'
import {
  filterFreeModels,
  parseAnthropicModels,
  parseGeminiModels,
  parseOpenAICompatibleModels,
  parseOpenRouterModels,
} from './models'
import { PROVIDER_CONFIGS, getProviderConfig } from './providers'
import { createOpenAICompatibleAdapter } from './adapters/openai-compatible'
import anthropicAdapter from './adapters/anthropic'
import geminiAdapter from './adapters/gemini'

describe('model catalog parsers (hand-written from docs, not live-tested)', () => {
  it('normalizes OpenRouter model prices, free models, context, and missing prices', () => {
    const models = parseOpenRouterModels({
      data: [
        {
          id: 'sample/free',
          name: 'Sample Free',
          context_length: 8192,
          pricing: { prompt: '0', completion: '0' },
        },
        {
          id: 'sample/paid',
          name: 'Sample Paid',
          pricing: { prompt: '0.0000002', completion: '0.0000006' },
        },
        { id: 'sample/unknown', name: 'Sample Unknown' },
        {
          id: 'sample/mixed',
          pricing: { prompt: '0', completion: '0.0000001' },
        },
      ],
    })

    expect(models[0]).toMatchObject({
      id: 'sample/free',
      providerId: 'openrouter',
      contextLength: 8192,
      inputPricePerM: 0,
      outputPricePerM: 0,
      isFree: true,
      priceKnown: true,
    })
    expect(models[1]).toMatchObject({ outputPricePerM: 0.6, isFree: false, priceKnown: true })
    expect(models[1].inputPricePerM).toBeCloseTo(0.2)
    expect(models[2]).toMatchObject({ id: 'sample/unknown', priceKnown: false })
    expect(models[2].isFree).toBeUndefined()
    expect(models[3]).toMatchObject({ inputPricePerM: 0, outputPricePerM: 0.1, isFree: false, priceKnown: true })
    expect(filterFreeModels(models).map((model) => model.id)).toEqual(['sample/free'])
  })

  it('normalizes an OpenAI-style list without inventing price data', () => {
    expect(parseOpenAICompatibleModels('openai', {
      data: [{ id: 'gpt-example', owned_by: 'sample', context_length: 8192 }],
    })).toEqual([{
      id: 'gpt-example',
      name: 'gpt-example',
      providerId: 'openai',
      contextLength: 8192,
      priceKnown: false,
    }])
  })

  it('parses Anthropic model IDs and ignores unknown fields', () => {
    expect(parseAnthropicModels({
      data: [{ id: 'claude-example', display_name: 'Claude Example', max_input_tokens: 64000, extra: true }],
      has_more: false,
    })).toMatchObject([{ id: 'claude-example', name: 'Claude Example', contextLength: 64000, priceKnown: false }])
  })

  it('keeps only Gemini models that support generateContent', () => {
    expect(parseGeminiModels({
      models: [
        { name: 'models/gemini-chat', baseModelId: 'gemini-chat', displayName: 'Gemini Chat', inputTokenLimit: 32768, supportedGenerationMethods: ['generateContent'] },
        { name: 'models/gemini-embed', displayName: 'Gemini Embed', supportedGenerationMethods: ['embedContent'] },
        { name: 'models/gemini-unknown', supportedGenerationMethods: [] },
      ],
      nextPageToken: 'ignored',
    })).toEqual([{
      id: 'gemini-chat',
      name: 'Gemini Chat',
      providerId: 'gemini',
      contextLength: 32768,
      priceKnown: false,
    }])
  })

  it('handles malformed or unexpected provider responses without throwing', () => {
    expect(parseOpenRouterModels(null)).toEqual([])
    expect(parseOpenAICompatibleModels('groq', { data: [null, {}, { id: 3 }] })).toEqual([])
    expect(parseAnthropicModels('not-json-shape')).toEqual([])
    expect(parseGeminiModels({ models: [{ supportedGenerationMethods: 'generateContent' }] })).toEqual([])
  })

  it('exposes listModels on every configured provider adapter', () => {
    for (const provider of PROVIDER_CONFIGS) {
      const adapter = provider.apiStyle === 'openai-compatible'
        ? createOpenAICompatibleAdapter(provider, '')
        : provider.id === 'anthropic'
          ? anthropicAdapter
          : geminiAdapter
      expect(adapter.listModels).toBeTypeOf('function')
      expect(provider.modelsPath.startsWith('/models')).toBe(true)
    }
    const openRouter = createOpenAICompatibleAdapter(getProviderConfig('openrouter'), '')
    expect(openRouter.listModels({ data: [{ id: 'sample/free', pricing: { prompt: '0', completion: '0' } }] })[0].isFree).toBe(true)
  })
})
