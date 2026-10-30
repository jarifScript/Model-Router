import { describe, expect, it } from 'vitest'
import { filterModelEntries, sortModelEntries, type ModelListEntry } from './modelList'
import type { ModelInfo } from './models'
import { buildModelChatSearch, parseModelChatSearch } from './modelChatLink'

function entry(
  id: string,
  price: number | undefined,
  options: { providerId?: ModelInfo['providerId']; isFree?: boolean; status?: ModelListEntry['test'] } = {},
): ModelListEntry {
  const model: ModelInfo = {
    id,
    name: id,
    providerId: options.providerId ?? 'openrouter',
    priceKnown: price !== undefined,
    ...(price === undefined ? {} : { inputPricePerM: price, outputPricePerM: price }),
    ...(options.isFree === undefined ? {} : { isFree: options.isFree }),
  }
  return {
    model,
    favorite: id === 'favorite',
    ...(options.status ? { test: options.status } : {}),
  }
}

describe('models page list helpers', () => {
  it('filters free models, status, provider, and favorites', () => {
    const models = [
      entry('free', 0, { isFree: true, status: { providerId: 'openrouter', modelId: 'free', status: 'working', latencyMs: 1, testedAt: 5 } }),
      entry('paid', 2, { status: { providerId: 'openrouter', modelId: 'paid', status: 'server_error', latencyMs: 2, testedAt: 4 } }),
      entry('favorite', undefined, { providerId: 'openai' }),
    ]
    expect(filterModelEntries(models, { freeOnly: true }).map(({ model }) => model.id)).toEqual(['free'])
    expect(filterModelEntries(models, { status: 'working' }).map(({ model }) => model.id)).toEqual(['free'])
    expect(filterModelEntries(models, { favoritesOnly: true }).map(({ model }) => model.id)).toEqual(['favorite'])
    expect(filterModelEntries(models, { providers: new Set() })).toEqual([])
  })

  it('sorts known prices ahead of unknown prices', () => {
    const models = [entry('unknown', undefined), entry('expensive', 2), entry('cheap', 1)]
    expect(sortModelEntries(models, 'price').map(({ model }) => model.id)).toEqual(['cheap', 'expensive', 'unknown'])
  })

  it('keeps saved backup plan order ahead of unplanned models', () => {
    const models = [
      entry('zeta', undefined),
      entry('alpha', undefined),
      entry('gamma', undefined),
    ]
    const routeOrder = ['openrouter:gamma', 'openrouter:zeta']

    expect(sortModelEntries(models, 'priority', routeOrder).map(({ model }) => model.id))
      .toEqual(['gamma', 'zeta', 'alpha'])
  })

  it('safely builds and parses URL-encoded model selections', () => {
    const search = buildModelChatSearch('openrouter', 'vendor/model:variant')
    expect(parseModelChatSearch(search)).toEqual({ providerId: 'openrouter', modelId: 'vendor/model:variant' })
    expect(parseModelChatSearch('?provider=unknown&model=foo')).toBeNull()
    expect(parseModelChatSearch('?provider=openrouter&model=%3Cscript%3E')).toBeNull()
    expect(parseModelChatSearch('?provider=openrouter&model=%ZZ')).toBeNull()
  })
})
