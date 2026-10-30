import { copy } from './copy'

export type AuthOperation = 'sign-in' | 'sign-up' | 'oauth'

function getStatus(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null || !('status' in error)) return undefined
  return typeof error.status === 'number' ? error.status : undefined
}

export function getAuthErrorMessage(error: unknown, operation: AuthOperation): string {
  const status = getStatus(error)

  if (status === 429) return copy.login.rateLimited
  if (operation === 'sign-in' && status === 400) return copy.login.credentialsError
  if (status !== undefined && status >= 500) return copy.login.serviceUnavailable

  return copy.login.authError
}
