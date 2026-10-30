import type { ModelInfo } from './models'
import type { ModelTestRecord } from './modelTest'

export type ModelStatusFilter = 'all' | 'working' | 'failing' | 'not_tested'
export type ModelSort = 'priority' | 'name' | 'context' | 'price' | 'recent'

export type ModelListEntry = {
  model: ModelInfo
  test?: ModelTestRecord
  favorite: boolean
  keyId?: string
}

function price(model: ModelInfo): number | undefined {
  if (!model.priceKnown || model.inputPricePerM === undefined || model.outputPricePerM === undefined) {
    return undefined
  }
  return model.inputPricePerM + model.outputPricePerM
}

function isFailedStatus(status: ModelTestRecord['status']): boolean {
  return status !== 'working' && status !== 'rate_limited'
}

export function filterModelEntries(
  entries: readonly ModelListEntry[],
  filters: {
    search?: string
    providers?: ReadonlySet<string>
    freeOnly?: boolean
    status?: ModelStatusFilter
    favoritesOnly?: boolean
  },
): ModelListEntry[] {
  const search = filters.search?.trim().toLocaleLowerCase() ?? ''
  return entries.filter(({ model, test, favorite }) => {
    if (filters.providers && !filters.providers.has(model.providerId)) return false
    if (filters.freeOnly && model.isFree !== true) return false
    if (filters.favoritesOnly && !favorite) return false
    if (search && !model.name.toLocaleLowerCase().includes(search)
      && !model.id.toLocaleLowerCase().includes(search)) return false
    if (filters.status === 'working' && test?.status !== 'working') return false
    if (filters.status === 'failing' && (!test || !isFailedStatus(test.status))) return false
    if (filters.status === 'not_tested' && test) return false
    return true
  })
}

export function sortModelEntries(
  entries: readonly ModelListEntry[],
  sort: ModelSort,
  routeOrder: readonly string[] = [],
): ModelListEntry[] {
  const priorityByIdentity = new Map(routeOrder.map((identity, index) => [identity, index]))
  return [...entries].sort((left, right) => {
    if (sort === 'priority') {
      const leftPriority = priorityByIdentity.get(`${left.model.providerId}:${left.model.id}`)
      const rightPriority = priorityByIdentity.get(`${right.model.providerId}:${right.model.id}`)
      if (leftPriority === undefined && rightPriority !== undefined) return 1
      if (leftPriority !== undefined && rightPriority === undefined) return -1
      if (leftPriority !== undefined && rightPriority !== undefined && leftPriority !== rightPriority) {
        return leftPriority - rightPriority
      }
    } else if (sort === 'context') {
      const contextDiff = (right.model.contextLength ?? -1) - (left.model.contextLength ?? -1)
      if (contextDiff !== 0) return contextDiff
    } else if (sort === 'price') {
      const leftPrice = price(left.model)
      const rightPrice = price(right.model)
      if (leftPrice === undefined && rightPrice !== undefined) return 1
      if (leftPrice !== undefined && rightPrice === undefined) return -1
      if (leftPrice !== undefined && rightPrice !== undefined && leftPrice !== rightPrice) {
        return leftPrice - rightPrice
      }
    } else if (sort === 'recent') {
      const testDiff = (right.test?.testedAt ?? -1) - (left.test?.testedAt ?? -1)
      if (testDiff !== 0) return testDiff
    }
    return left.model.name.localeCompare(right.model.name)
  })
}
