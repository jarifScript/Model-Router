import { describe, expect, it } from 'vitest'
import anthropicAdapter from './anthropic'
import geminiAdapter from './gemini'
import { getProviderConfig } from '../providers'
import { createOpenAICompatibleAdapter } from './openai-compatible'
import type { ProviderStreamEvent } from './types'

async function readChunks(adapter: { parseStream(response: Response): AsyncIterable<string> }, fixture: string) {
  const chunks: string[] = []
  for await (const chunk of adapter.parseStream(new Response(fixture, {
    headers: { 'content-type': 'text/event-stream' },
  }))) chunks.push(chunk)
  return chunks
}

describe('provider adapters (fixture-based, not live-tested)', () => {
  it('requests streaming usage only from OpenAI and reads the usage event', async () => {
    const openai = createOpenAICompatibleAdapter(getProviderConfig('openai'), 'http://localhost:5173')
    const groq = createOpenAICompatibleAdapter(getProviderConfig('groq'), 'http://localhost:5173')
    const openAiBody = openai.buildRequest('gpt-test', [{ role: 'user', content: 'Hi' }]).body
    const groqBody = groq.buildRequest('groq-test', [{ role: 'user', content: 'Hi' }]).body
    expect(openAiBody).toMatchObject({ stream_options: { include_usage: true } })
    expect(groqBody).not.toHaveProperty('stream_options')

    const events: ProviderStreamEvent[] = []
    const response = new Response([
      'data: {"choices":[],"usage":{"prompt_tokens":12,"completion_tokens":7}}',
      '',
      'data: [DONE]',
      '',
    ].join('\n'), { headers: { 'content-type': 'text/event-stream' } })
    const parseUsage = openai.parseStreamEvents
    if (!parseUsage) throw new Error('The OpenAI adapter does not expose usage events.')
    for await (const event of parseUsage(response)) events.push(event)
    expect(events).toEqual([{ type: 'usage', inputTokens: 12, outputTokens: 7 }])
  })

  it('configures DeepSeek at the documented OpenAI-compatible endpoint', async () => {
    const deepseek = getProviderConfig('deepseek')
    const adapter = createOpenAICompatibleAdapter(deepseek, 'http://localhost:5173')
    const request = adapter.buildRequest('deepseek-flash', [{ role: 'user', content: 'Hi' }])
    expect(request.url).toBe('https://api.deepseek.com/chat/completions')
    expect(deepseek.authStyle).toBe('bearer')
    expect(await readChunks(adapter, [
      'data: {"choices":[{"delta":{"content":"Hello"}}]}',
      '',
      'data: [DONE]',
      '',
    ].join('\n'))).toEqual(['Hello'])
  })

  it('builds Anthropic Messages requests and normalizes text_delta SSE fixtures', async () => {
    expect(getProviderConfig('anthropic').authStyle).toBe('x-api-key')
    const request = anthropicAdapter.buildRequest('claude-test', [
      { role: 'system', content: 'Be concise.' },
      { role: 'user', content: 'Hello.' },
      { role: 'assistant', content: 'Hi.' },
    ])
    expect(request.url).toBe('https://api.anthropic.com/v1/messages')
    expect(request.headers).toMatchObject({ 'anthropic-version': '2023-06-01' })
    expect(request.body).toEqual({
      model: 'claude-test',
      max_tokens: 1024,
      stream: true,
      system: 'Be concise.',
      messages: [{ role: 'user', content: 'Hello.' }, { role: 'assistant', content: 'Hi.' }],
    })
    expect(await readChunks(anthropicAdapter, [
      'event: content_block_delta',
      'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hello"}}',
      '',
      'event: message_stop',
      'data: {"type":"message_stop"}',
      '',
    ].join('\n'))).toEqual(['Hello'])
  })

  it('builds Gemini native streaming requests with key-free URLs and maps model roles', async () => {
    expect(getProviderConfig('gemini').authStyle).toBe('x-goog-api-key')
    const request = geminiAdapter.buildRequest('gemini-test', [
      { role: 'system', content: 'Be concise.' },
      { role: 'user', content: 'Hello.' },
      { role: 'assistant', content: 'Hi.' },
    ])
    expect(request.url).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-test:streamGenerateContent?alt=sse')
    expect(request.url).not.toContain('key=')
    expect(request.body).toEqual({
      systemInstruction: { parts: [{ text: 'Be concise.' }] },
      contents: [
        { role: 'user', parts: [{ text: 'Hello.' }] },
        { role: 'model', parts: [{ text: 'Hi.' }] },
      ],
      generationConfig: { maxOutputTokens: 1024 },
    })
    expect(await readChunks(geminiAdapter, [
      'data: {"candidates":[{"content":{"role":"model","parts":[{"text":"Hello"}]},"finishReason":"STOP"}]}',
      '',
    ].join('\n'))).toEqual(['Hello'])
  })
})
