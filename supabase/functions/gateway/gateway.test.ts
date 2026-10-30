import { describe, expect, it } from 'vitest'
import { PROVIDER_CONFIGS } from '../../../src/core/providers'
import { getGatewayAdapter, GATEWAY_PROVIDER_IDS } from './adapter-registry'
import { createGatewayLogRow } from './gateway-logging'
import {
  countGatewayOutputBytes,
  GatewayOutputLimitError,
  isGatewayRouterKeyActive,
  isWithinGatewayLimits,
  MAX_GATEWAY_OUTPUT_BYTES,
} from './limits'
import {
  applyGatewayGenerationOptions,
  MAX_GATEWAY_BODY_BYTES,
  parseGatewayChatRequest,
  readGatewayBody,
} from './request-guards'
import {
  completionCreatedAt,
  completionId,
  encodeServerSentEvent,
  makeCompletionChunk,
  makeCompletionResponse,
} from './responses'

describe('gateway request guards', () => {
  it('accepts bounded OpenAI-style text requests and rejects oversized shapes', () => {
    expect(parseGatewayChatRequest({
      model: 'auto',
      messages: [{ role: 'user', content: 'hello' }],
      stream: true,
      max_tokens: 2000,
    })).toMatchObject({ model: 'auto', stream: true, maxTokens: 2000 })
    expect(parseGatewayChatRequest({
      model: 'auto',
      messages: Array.from({ length: 25 }, () => ({ role: 'user', content: 'x' })),
    })).toBeNull()
    expect(parseGatewayChatRequest({
      model: 'auto',
      messages: [{ role: 'user', content: 'x' }],
      max_tokens: 5000,
    })).toBeNull()
  })

  it('rejects request bodies that exceed the byte limit', async () => {
    const body = new TextEncoder().encode(JSON.stringify({ value: 'x'.repeat(MAX_GATEWAY_BODY_BYTES) }))
    const result = await readGatewayBody(new ReadableStream({
      start(controller) {
        controller.enqueue(body)
        controller.close()
      },
    }))
    expect(result).toBeNull()
  })

  it('maps supported generation options into each provider request format', () => {
    const request = parseGatewayChatRequest({
      model: 'auto',
      messages: [{ role: 'user', content: 'hello' }],
      temperature: 0.3,
      top_p: 0.8,
      stop: ['END'],
      max_completion_tokens: 321,
    })
    expect(request).not.toBeNull()
    expect(applyGatewayGenerationOptions('openai-compatible', { max_tokens: 1024 }, request!))
      .toMatchObject({ max_tokens: 321, temperature: 0.3, top_p: 0.8, stop: ['END'] })
    expect(applyGatewayGenerationOptions('anthropic', { max_tokens: 1024 }, request!))
      .toMatchObject({ max_tokens: 321, top_p: 0.8, stop_sequences: ['END'] })
    expect(applyGatewayGenerationOptions('gemini', { generationConfig: {} }, request!))
      .toMatchObject({ generationConfig: { maxOutputTokens: 321, topP: 0.8, stopSequences: ['END'] } })
  })
})

describe('gateway caps and provider configuration', () => {
  it('enforces both per-minute and per-day router key caps', () => {
    const limits = { requestsPerMinute: 30, requestsPerDay: 1000 }
    expect(isWithinGatewayLimits({ minuteCount: 30, dayCount: 800 }, limits)).toBe(true)
    expect(isWithinGatewayLimits({ minuteCount: 31, dayCount: 800 }, limits)).toBe(false)
    expect(isWithinGatewayLimits({ minuteCount: 10, dayCount: 1001 }, limits)).toBe(false)
    expect(isGatewayRouterKeyActive(null)).toBe(true)
    expect(isGatewayRouterKeyActive('2025-01-01T00:00:00Z')).toBe(false)
  })

  it('counts UTF-8 output bytes and rejects output beyond the cap', () => {
    expect(countGatewayOutputBytes(0, '🙂')).toBe(4)
    expect(countGatewayOutputBytes(0, 'x'.repeat(MAX_GATEWAY_OUTPUT_BYTES)))
      .toBe(MAX_GATEWAY_OUTPUT_BYTES)
    expect(() => countGatewayOutputBytes(MAX_GATEWAY_OUTPUT_BYTES, 'x'))
      .toThrow(GatewayOutputLimitError)
  })

  it('uses the core provider list and creates a fixed-host adapter for each provider', () => {
    expect([...GATEWAY_PROVIDER_IDS]).toEqual(PROVIDER_CONFIGS.map(({ id }) => id))
    for (const provider of PROVIDER_CONFIGS) {
      const request = getGatewayAdapter(provider.id, 'https://app.example').buildRequest(
        'test-model',
        [{ role: 'user', content: 'test' }],
      )
      expect(new URL(request.url).hostname).toBe(new URL(provider.baseUrl).hostname)
      expect(new URL(request.url).protocol).toBe('https:')
    }
  })
})

describe('gateway OpenAI response and metadata formats', () => {
  it('formats both stream chunks and non-stream completion responses', () => {
    const id = completionId()
    const created = completionCreatedAt()
    expect(makeCompletionChunk(id, created, 'model-x', { content: 'hello' }))
      .toMatchObject({ id, object: 'chat.completion.chunk', model: 'model-x' })
    expect(makeCompletionResponse(id, created, 'model-x', 'hello', {
      inputTokens: 3,
      outputTokens: 2,
    })).toMatchObject({
      object: 'chat.completion',
      choices: [{ message: { role: 'assistant', content: 'hello' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 },
    })
    expect(new TextDecoder().decode(encodeServerSentEvent({ ok: true })))
      .toBe('data: {"ok":true}\n\n')
  })

  it('creates metadata-only history rows', () => {
    const row = createGatewayLogRow({
      userId: 'owner-id',
      createdAt: '2025-01-01T00:00:00.000Z',
      provider: 'openrouter',
      model: 'model-x',
      keyId: 'provider-key-id',
      latencyMs: 42,
      ttfbMs: 7,
      inputTokens: null,
      outputTokens: null,
      inputCharacters: 80,
      outputCharacters: 40,
      status: 'success',
      httpStatus: 200,
      errorClass: null,
      fallbackCount: 1,
    })
    expect(row).toMatchObject({
      source: 'gateway',
      provider: 'openrouter',
      model: 'model-x',
      tokens_estimated: true,
    })
    expect(Object.keys(row)).not.toContain('prompt')
    expect(Object.keys(row)).not.toContain('response')
    expect(JSON.stringify(row)).not.toContain('provider-secret')
  })
})
