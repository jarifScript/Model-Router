import { describe, expect, it } from 'vitest'
import { classifyHttpError, getRetryAfterMs } from './errors'

describe('provider error classification', () => {
  it('distinguishes retryable, needs-attention, and immediate-stop classes', () => {
    expect(classifyHttpError(429)).toBe('rate_limit')
    expect(classifyHttpError(503)).toBe('server')
    expect(classifyHttpError(504)).toBe('timeout')
    expect(classifyHttpError(401)).toBe('auth')
    expect(classifyHttpError(402)).toBe('quota')
    expect(classifyHttpError(404)).toBe('model_not_found')
    expect(classifyHttpError(400, 'The model was not found or is not available to this key.')).toBe('model_not_found')
    expect(classifyHttpError(400, 'No endpoints found for model openrouter/free.')).toBe('model_not_found')
    expect(classifyHttpError(400)).toBe('bad_request')
    expect(classifyHttpError(400, 'request blocked by content filter')).toBe('content_filter')
  })

  it('parses Retry-After values and caps waits at five seconds', () => {
    expect(getRetryAfterMs(new Headers({ 'retry-after': '2' }), 0)).toBe(2000)
    expect(getRetryAfterMs(new Headers({ 'retry-after': '30' }), 0)).toBe(5000)
    expect(getRetryAfterMs(new Headers({ 'retry-after': 'invalid' }), 0)).toBeUndefined()
  })
})
