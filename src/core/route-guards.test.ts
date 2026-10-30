import { describe, expect, it } from 'vitest'
import {
  filterAllowedClientHeaders,
  isAllowedJsonContentType,
  limitStreamBytes,
  readBodyWithinLimit,
  requestBodyIsWithinLimit,
} from '../../supabase/functions/route/request-guards'

describe('Edge Function request guards', () => {
  it('measures body size in UTF-8 bytes', () => {
    expect(requestBodyIsWithinLimit('hello', 5)).toBe(true)
    expect(requestBodyIsWithinLimit('é', 1)).toBe(false)
  })

  it('stops reading request bodies as soon as the byte cap is exceeded', async () => {
    expect(await readBodyWithinLimit(new Response('hello').body, 5)).toBe('hello')
    expect(await readBodyWithinLimit(new Response('é').body, 1)).toBeNull()
    expect(await readBodyWithinLimit(new Response('123456').body, 5)).toBeNull()
  })

  it('accepts JSON content types and rejects other content types', () => {
    expect(isAllowedJsonContentType('application/json; charset=utf-8')).toBe(true)
    expect(isAllowedJsonContentType('text/plain')).toBe(false)
    expect(isAllowedJsonContentType(null)).toBe(false)
  })

  it('keeps only the small client header allowlist', () => {
    const received = new Headers({
      authorization: 'Bearer session',
      'x-provider-api-key': 'provider-key',
      'x-forwarded-host': 'attacker.example',
      cookie: 'secret',
    })

    const allowed = filterAllowedClientHeaders(received)
    expect([...allowed.keys()].sort()).toEqual(['authorization', 'x-provider-api-key'])
    expect(allowed.has('x-forwarded-host')).toBe(false)
    expect(allowed.has('cookie')).toBe(false)
  })

  it('errors when the upstream stream exceeds the output cap', async () => {
    const source = new Response('123456').body
    if (!source) throw new Error('Test stream could not be created.')

    await expect(new Response(limitStreamBytes(source, 5)).text()).rejects.toThrow()
  })
})
