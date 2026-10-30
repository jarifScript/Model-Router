import { describe, expect, it } from 'vitest'
import { getAuthErrorMessage } from './authErrorMessage'
import { copy } from './copy'

describe('authentication error messages', () => {
  it('explains sign-in rejection without exposing Supabase error details', () => {
    const message = getAuthErrorMessage(
      { status: 400, message: 'Invalid login credentials for private@example.com' },
      'sign-in',
    )

    expect(message).toBe(copy.login.credentialsError)
    expect(message).not.toContain('private@example.com')
    expect(message).not.toContain('Invalid login credentials')
  })

  it('explains rate limiting for sign-up and sign-in', () => {
    expect(getAuthErrorMessage({ status: 429 }, 'sign-up')).toBe(copy.login.rateLimited)
    expect(getAuthErrorMessage({ status: 429 }, 'sign-in')).toBe(copy.login.rateLimited)
  })

  it('keeps other authentication errors generic', () => {
    expect(getAuthErrorMessage(new Error('private provider details'), 'sign-up')).toBe(copy.login.authError)
    expect(getAuthErrorMessage({ status: 503, message: 'internal details' }, 'oauth'))
      .toBe(copy.login.serviceUnavailable)
  })
})
