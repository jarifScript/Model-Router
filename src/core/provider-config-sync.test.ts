import { describe, expect, it } from 'vitest'
import { PROVIDER_CONFIGS as clientProviders } from './providers'
import { PROVIDER_CONFIGS as edgeProviders } from '../../supabase/functions/route/provider-config'

describe('Edge Function provider allowlist', () => {
  it('matches the app provider IDs and exact HTTPS hosts', () => {
    const client = clientProviders
      .map(({ id, baseUrl }) => [id, new URL(baseUrl).hostname])
      .sort(([leftId], [rightId]) => leftId.localeCompare(rightId))
    const edge = edgeProviders
      .map(({ id, baseUrl }) => [id, new URL(baseUrl).hostname])
      .sort(([leftId], [rightId]) => leftId.localeCompare(rightId))

    expect(edge).toEqual(client)
  })
})
