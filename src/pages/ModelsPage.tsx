import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import type { ModelInfo } from '../core/models'
import { type ModelListEntry, type ModelSort, type ModelStatusFilter, filterModelEntries, sortModelEntries } from '../core/modelList'
import { buildModelChatSearch } from '../core/modelChatLink'
import { MAX_BATCH_MODELS, type BatchModel, requiresPaidTestConfirmation, runModelTestBatch } from '../core/modelTestBatch'
import { testModel } from '../core/modelTest'
import { ProviderHealth } from '../core/health'
import { createBrowserRouterDependencies } from '../core/transport'
import type { ProviderId } from '../core/providers'
import { useModels } from '../lib/modelCatalog'
import { useFavoriteModels } from '../lib/favorites'
import { useAutoBackupPlan } from '../lib/autoBackupPlan'
import { getModelTestKey, useModelTestStore } from '../store/model-tests'
import { useVaultStore } from '../store/vault'
import useAuth from '../hooks/useAuth'
import { copy } from '../lib/copy'
import { formatRelativeTime } from '../lib/relativeTime'
import { isProviderId } from '../core/providers'
import { useUserSettings } from '../hooks/useUserSettings'
import type { StoredModelTest } from '../store/model-tests'

type CatalogState = {
  providerId: ProviderId
  keyId?: string
  models: ModelInfo[]
  isLoading: boolean
  error: string | null
}

function catalogKey(providerId: ProviderId, keyId?: string): string {
  return `${providerId}:${keyId ?? 'public'}`
}

function ProviderCatalog({
  providerId,
  keyId,
  onChange,
}: {
  providerId: ProviderId
  keyId?: string
  onChange: (key: string, state: CatalogState) => void
}) {
  const query = useModels(providerId, keyId)
  const key = catalogKey(providerId, keyId)
  const error = query.error ? copy.models.catalogError : null

  useEffect(() => {
    onChange(key, {
      providerId,
      keyId,
      models: query.data ?? [],
      isLoading: query.isLoading || query.isFetching,
      error,
    })
  }, [error, key, onChange, providerId, keyId, query.data, query.isFetching, query.isLoading])

  return null
}

function statusText(entry: ModelListEntry): { label: string; style: string } {
  if (!entry.test) return { label: copy.models.statusNotTested, style: 'bg-slate-100 text-slate-900 dark:bg-slate-800 dark:text-slate-100' }
  if (entry.test.status === 'working') return { label: copy.models.statusWorking, style: 'bg-emerald-100 text-emerald-950 dark:bg-emerald-950 dark:text-emerald-100' }
  if (entry.test.status === 'rate_limited') return { label: copy.models.statusRateLimited, style: 'bg-amber-100 text-amber-950 dark:bg-amber-950 dark:text-amber-100' }
  const labels: Record<string, string> = {
    auth_failed: copy.models.statusAuthFailed,
    no_credits: copy.models.statusNoCredits,
    model_not_found: copy.models.statusModelMissing,
    timeout: copy.models.statusTimeout,
    server_error: copy.models.statusServer,
    network_error: copy.models.statusNetwork,
  }
  return { label: labels[entry.test.status] ?? copy.models.failing, style: 'bg-red-100 text-red-950 dark:bg-red-950 dark:text-red-100' }
}

function isStale(entry: ModelListEntry, now: number): boolean {
  return Boolean(entry.test && now - entry.test.testedAt > 30 * 60 * 1000)
}

function ModelStatusBadge({
  entry,
  now,
  onTest,
  isTesting,
  disabled,
}: {
  entry: ModelListEntry
  now: number
  onTest: () => void
  isTesting: boolean
  disabled: boolean
}) {
  const status = statusText(entry)
  const label = isTesting ? copy.models.checking : status.label
  const staleLabel = isStale(entry, now) ? ` · ${copy.models.stale}` : ''
  const className = `inline-flex min-h-8 max-w-full items-center gap-1 rounded-full px-2 py-0.5 text-sm font-medium ${status.style}`

  if (entry.test?.status === 'working') {
    return <span className={className}>{label}{staleLabel}</span>
  }

  return (
    <button
      type="button"
      aria-label={`${isTesting ? copy.models.checking : copy.models.test}: ${entry.model.name}`}
      title={disabled ? copy.models.noKeyToTest : copy.models.test}
      disabled={disabled || isTesting}
      onClick={onTest}
      className={`${className} cursor-pointer hover:brightness-95 focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-700 disabled:cursor-not-allowed disabled:opacity-60`}
    >
      {isTesting ? (
        <svg aria-hidden="true" className="size-4 shrink-0 animate-spin" viewBox="0 0 24 24" fill="none">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-80" fill="currentColor" d="M4 12a8 8 0 0 1 8-8V0C5.37 0 0 5.37 0 12h4Zm2 5.3A7.96 7.96 0 0 1 4 12H0c0 3.04 1.13 5.82 3 7.94l3-2.64Z" />
        </svg>
      ) : (
        <svg aria-hidden="true" className="size-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M20 7v5h-5" />
          <path d="M19 12a7 7 0 1 1-2-5" />
        </svg>
      )}
      <span className="min-w-0 break-words">{label}{staleLabel}</span>
    </button>
  )
}

function ModelDetails({
  entry,
  now,
  onTest,
  isTesting,
  disabled,
  actions,
}: {
  entry: ModelListEntry
  now: number
  onTest: () => void
  isTesting: boolean
  disabled: boolean
  actions: ReactNode
}) {
  const price = entry.model.priceKnown
    && entry.model.inputPricePerM !== undefined
    && entry.model.outputPricePerM !== undefined
    ? `$${entry.model.inputPricePerM} / $${entry.model.outputPricePerM} ${copy.models.perMillionWords}`
    : copy.models.unknownPrice
  return (
    <div className="space-y-3">
      <div className="flex min-w-0 items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="break-words text-base font-semibold text-slate-950 dark:text-white">{entry.model.name}</p>
          <p className="mt-0.5 break-all text-sm text-slate-700 dark:text-slate-300">{entry.model.id}</p>
        </div>
        <div className="shrink-0">{actions}</div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-full bg-slate-100 px-3 py-1 text-sm font-medium text-slate-900 dark:bg-slate-800 dark:text-slate-100">{copy.keys.serviceNames[entry.model.providerId]}</span>
        <span className="rounded-full bg-indigo-50 px-3 py-1 text-sm font-medium text-indigo-950 dark:bg-indigo-950 dark:text-indigo-100">{copy.models.listed}</span>
        <ModelStatusBadge
          entry={entry}
          now={now}
          onTest={onTest}
          isTesting={isTesting}
          disabled={disabled}
        />
      </div>
      <dl className="grid grid-cols-2 gap-3 border-t border-slate-200 pt-3 text-sm dark:border-slate-700">
        <div>
          <dt className="text-slate-600 dark:text-slate-400">{copy.models.tableContext}</dt>
          <dd className="mt-0.5 font-medium text-slate-950 dark:text-white">{entry.model.contextLength?.toLocaleString() ?? copy.app.unknown}</dd>
        </div>
        <div>
          <dt className="text-slate-600 dark:text-slate-400">{copy.models.price}</dt>
          <dd className="mt-0.5 break-words font-medium text-slate-950 dark:text-white">{price}</dd>
        </div>
        <div className="col-span-2">
          <dt className="text-slate-600 dark:text-slate-400">{copy.models.lastTested}</dt>
          <dd className="mt-0.5 font-medium text-slate-950 dark:text-white">{entry.test ? formatRelativeTime(entry.test.testedAt, now) : copy.app.notTested}</dd>
        </div>
      </dl>
    </div>
  )
}

function ModelActionsMenu({
  entry,
  selected,
  selectionDisabled,
  favoritesLoading,
  showAdvancedFeatures,
  onToggleSelection,
  onToggleFavorite,
}: {
  entry: ModelListEntry
  selected: boolean
  selectionDisabled: boolean
  favoritesLoading: boolean
  showAdvancedFeatures: boolean
  onToggleSelection: () => void
  onToggleFavorite: () => void
}) {
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const [isOpen, setIsOpen] = useState(false)

  useEffect(() => {
    if (!isOpen) return
    function closeOnOutsideClick(event: PointerEvent) {
      const target = event.target
      if (target instanceof Node
        && !triggerRef.current?.contains(target)
        && !menuRef.current?.contains(target)) {
        setIsOpen(false)
      }
    }
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setIsOpen(false)
        triggerRef.current?.focus()
      }
    }
    function closeOnViewportChange() {
      setIsOpen(false)
    }
    document.addEventListener('pointerdown', closeOnOutsideClick)
    document.addEventListener('keydown', closeOnEscape)
    window.addEventListener('resize', closeOnViewportChange)
    window.addEventListener('scroll', closeOnViewportChange, true)
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsideClick)
      document.removeEventListener('keydown', closeOnEscape)
      window.removeEventListener('resize', closeOnViewportChange)
      window.removeEventListener('scroll', closeOnViewportChange, true)
    }
  }, [isOpen])

  function closeMenu(action: () => void) {
    setIsOpen(false)
    action()
  }

  return (
    <div className="relative">
      <button
        ref={triggerRef}
        type="button"
        aria-label={copy.models.moreActions}
        aria-haspopup="menu"
        aria-expanded={isOpen}
        title={copy.models.moreActions}
        onClick={() => setIsOpen((open) => !open)}
        className="ml-auto flex size-10 items-center justify-center rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-700 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
      >
        <svg aria-hidden="true" className="size-5" viewBox="0 0 24 24" fill="currentColor">
          <circle cx="5" cy="12" r="1.8" />
          <circle cx="12" cy="12" r="1.8" />
          <circle cx="19" cy="12" r="1.8" />
        </svg>
      </button>
      {isOpen && (
        <div
          ref={menuRef}
          role="menu"
          aria-label={copy.models.moreActions}
          className="absolute right-0 top-full z-50 mt-1 grid w-52 max-w-[calc(100vw-1rem)] gap-1 rounded-lg border border-slate-200 bg-white p-2 shadow-xl dark:border-slate-700 dark:bg-slate-900"
        >
        {showAdvancedFeatures && (
          <button
            type="button"
            role="menuitemcheckbox"
            aria-checked={selected}
            disabled={selectionDisabled}
            onClick={() => closeMenu(onToggleSelection)}
            className="flex min-h-10 items-center gap-2 rounded-md px-2 text-left text-sm text-slate-800 hover:bg-slate-100 disabled:opacity-50 dark:text-slate-200 dark:hover:bg-slate-800"
          >
            <span aria-hidden="true" className="flex size-4 items-center justify-center rounded border border-slate-400 text-xs">{selected ? '✓' : ''}</span>
            {copy.models.selected}
          </button>
        )}
        <Link
          to={{ pathname: '/playground', search: buildModelChatSearch(entry.model.providerId, entry.model.id) }}
          role="menuitem"
          onClick={() => setIsOpen(false)}
          className="inline-flex min-h-10 items-center rounded-md px-2 text-sm font-medium text-slate-900 hover:bg-slate-100 dark:text-white dark:hover:bg-slate-800"
        >
          {copy.models.chat}
        </Link>
        <button
          type="button"
          role="menuitem"
          disabled={favoritesLoading}
          onClick={() => closeMenu(onToggleFavorite)}
          className="inline-flex min-h-10 items-center gap-2 rounded-md px-2 text-left text-sm font-medium text-slate-900 hover:bg-slate-100 disabled:opacity-50 dark:text-white dark:hover:bg-slate-800"
        >
          <span aria-hidden="true" className="text-amber-600 dark:text-amber-300">{entry.favorite ? '★' : '☆'}</span>
          {entry.favorite ? copy.models.removeFavorite : copy.models.favorite}
        </button>
        {showAdvancedFeatures && (entry.keyId
          ? <Link role="menuitem" onClick={() => setIsOpen(false)} to="/routes" state={{ newTarget: { provider: entry.model.providerId, model: entry.model.id, keyId: entry.keyId } }} className="inline-flex min-h-10 items-center rounded-md px-2 text-sm font-medium text-slate-900 hover:bg-slate-100 dark:text-white dark:hover:bg-slate-800">{copy.models.addToPlan}</Link>
          : <span title={copy.models.noKeyToPlan} className="inline-flex min-h-10 items-center rounded-md px-2 text-sm text-slate-500 dark:text-slate-400">{copy.models.addToPlan}</span>)}
        </div>
      )}
    </div>
  )
}

export default function ModelsPage() {
  const providerKeys = useVaultStore((state) => state.providerKeys)
  const isUnlocked = useVaultStore((state) => state.isUnlocked)
  const setTestResult = useModelTestStore((state) => state.setResult)
  const loadTestResultsFromSupabase = useModelTestStore((state) => state.loadFromSupabase)
  const saveTestResultToSupabase = useModelTestStore((state) => state.saveToSupabase)
  const clearTestResults = useModelTestStore((state) => state.clearResults)
  const mergeTestResults = useModelTestStore((state) => state.mergeResults)
  const testResults = useModelTestStore((state) => state.results)
  const { favorites, isLoading: favoritesLoading, error: favoritesError, mutationError, toggleFavorite } = useFavoriteModels()
  const { plan: backupPlan, error: backupPlanError } = useAutoBackupPlan()
  const { session } = useAuth()
  const { showAdvancedFeatures } = useUserSettings()
  const queryClient = useQueryClient()
  const [catalogs, setCatalogs] = useState<Record<string, CatalogState>>({})
  const [search, setSearch] = useState('')
  const [selectedProviders, setSelectedProviders] = useState<Set<ProviderId> | null>(null)
  const [freeOnly, setFreeOnly] = useState(false)
  const [statusFilter, setStatusFilter] = useState<ModelStatusFilter>('all')
  const [sort, setSort] = useState<ModelSort>('priority')
  const [favoritesOnly, setFavoritesOnly] = useState(false)
  const [now, setNow] = useState(Date.now)
  const [visibleCount, setVisibleCount] = useState(100)
  const [selectedModels, setSelectedModels] = useState<Set<string>>(new Set())
  const [running, setRunning] = useState(false)
  const [testingModels, setTestingModels] = useState<ReadonlySet<string>>(() => new Set())
  const [batchProgress, setBatchProgress] = useState({ completed: 0, total: 0, current: 0 })
  const [batchNotice, setBatchNotice] = useState<string | null>(null)
  const [pageError, setPageError] = useState<string | null>(null)
  const batchController = useRef<AbortController | null>(null)

  const providerKeysById = useMemo(() => {
    const grouped = new Map<ProviderId, typeof providerKeys>()
    for (const key of providerKeys) {
      const current = grouped.get(key.provider) ?? []
      grouped.set(key.provider, [...current, key])
    }
    return grouped
  }, [providerKeys])
  const catalogRequests = useMemo(() => {
    const requests: Array<{ providerId: ProviderId; keyId?: string }> = []
    for (const [providerId, keys] of providerKeysById) {
      if (providerId === 'openrouter') {
        requests.push({ providerId })
      } else {
        for (const key of keys) requests.push({ providerId, keyId: key.id })
      }
    }
    if (!providerKeysById.has('openrouter')) requests.push({ providerId: 'openrouter' })
    return requests
  }, [providerKeysById])

  const onCatalogChange = useCallback((key: string, state: CatalogState) => {
    setCatalogs((current) => ({ ...current, [key]: state }))
  }, [])

  const allModels = useMemo(() => {
    const deduplicated = new Map<string, { model: ModelInfo; keyId?: string }>()
    for (const catalog of Object.values(catalogs)) {
      for (const model of catalog.models) {
        const key = `${model.providerId}:${model.id}`
        const savedKeyId = catalog.keyId
          ?? providerKeysById.get(model.providerId)?.[0]?.id
        if (!deduplicated.has(key)) deduplicated.set(key, { model, keyId: savedKeyId })
      }
    }
    const favoriteKeys = new Set(favorites.map((favorite) => `${favorite.providerId}:${favorite.modelId}`))
    return [...deduplicated.values()].map(({ model, keyId }): ModelListEntry => ({
      model,
      keyId,
      favorite: favoriteKeys.has(`${model.providerId}:${model.id}`),
      test: testResults[getModelTestKey(model.providerId, model.id)],
    }))
  }, [catalogs, favorites, providerKeysById, testResults])
  const routeOrder = useMemo(
    () => backupPlan.targets.map((target) => `${target.provider}:${target.model}`),
    [backupPlan.targets],
  )

  const availableProviders = useMemo(
    () => [...new Set(catalogRequests.map((request) => request.providerId))],
    [catalogRequests],
  )
  const selectedProviderSet = useMemo(
    () => selectedProviders === null
      ? new Set(availableProviders)
      : new Set(availableProviders.filter((providerId) => selectedProviders.has(providerId))),
    [availableProviders, selectedProviders],
  )
  const allProvidersSelected = availableProviders.length > 0
    && availableProviders.every((providerId) => selectedProviderSet.has(providerId))
  const selectedProviderHasPricing = allModels.some((entry) => (
    selectedProviderSet.has(entry.model.providerId) && entry.model.priceKnown
  ))
  const filtered = useMemo(() => sortModelEntries(filterModelEntries(allModels, {
    search,
    providers: selectedProviderSet,
    freeOnly: freeOnly && selectedProviderHasPricing,
    status: statusFilter,
    favoritesOnly,
  }), sort, routeOrder), [allModels, favoritesOnly, freeOnly, routeOrder, search, selectedProviderHasPricing, selectedProviderSet, sort, statusFilter])
  const visibleModels = filtered.slice(0, visibleCount)
  const savedProviderCount = providerKeysById.size
  const dependencies = useMemo(
    () => createBrowserRouterDependencies(session?.access_token ?? '', new ProviderHealth()),
    [session?.access_token],
  )

  useEffect(() => {
    setVisibleCount(100)
  }, [search, selectedProviderSet, freeOnly, statusFilter, sort, favoritesOnly])

  useEffect(() => () => batchController.current?.abort(), [])

  useEffect(() => {
    let active = true
    clearTestResults()
    setPageError(null)
    const userId = session?.user.id
    if (!userId) return () => { active = false }
    void loadTestResultsFromSupabase(userId)
      .then((results) => {
        if (active) mergeTestResults(results)
      })
      .catch(() => {
        if (active) setPageError(copy.models.loadTestResultsFailed)
      })
    return () => { active = false }
  }, [clearTestResults, loadTestResultsFromSupabase, mergeTestResults, session?.user.id])

  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 60_000)
    return () => window.clearInterval(interval)
  }, [])

  function toggleSelection(entry: ModelListEntry) {
    const key = getModelTestKey(entry.model.providerId, entry.model.id)
    setSelectedModels((current) => {
      if (current.has(key)) {
        const next = new Set(current)
        next.delete(key)
        return next
      }
      if (current.size >= 10) return current
      return new Set(current).add(key)
    })
  }

  async function testEntry(entry: ModelListEntry, signal?: AbortSignal) {
    const key = providerKeys.find((item) => item.id === entry.keyId)
    if (!key) throw new Error(copy.models.addKeyToTest)
    const adapter = dependencies.adapters[entry.model.providerId]
    if (!adapter) throw new Error(copy.models.testUnavailable)
    const result = await testModel(entry.model.providerId, entry.model.id, key.id, key.apiKey, {
      adapter,
      transport: dependencies.transport,
    }, signal)
    setTestResult(result)
    const userId = session?.user.id
    if (!userId) {
      setPageError(copy.models.saveTestResultFailed)
      return result
    }
    const storedResult: StoredModelTest = {
      providerId: result.providerId,
      modelId: result.modelId,
      status: result.status,
      latencyMs: result.latencyMs,
      testedAt: result.testedAt,
    }
    try {
      await saveTestResultToSupabase(userId, storedResult)
    } catch {
      setPageError(copy.models.saveTestResultFailed)
    }
    return result
  }

  async function handleTest(entry: ModelListEntry) {
    const identity = getModelTestKey(entry.model.providerId, entry.model.id)
    if (testingModels.has(identity)) return
    setTestingModels((current) => new Set(current).add(identity))
    setPageError(null)
    setBatchNotice(null)
    try {
      if (requiresPaidTestConfirmation([entry.model])
        && !window.confirm(copy.models.confirmPaid)) return
      await testEntry(entry)
    } catch {
      setPageError(copy.models.testFailed)
    } finally {
      setTestingModels((current) => {
        const next = new Set(current)
        next.delete(identity)
        return next
      })
    }
  }

  async function handleBatchTest(selected: ModelListEntry[]) {
    if (!selected.length || running) return
    if (selected.length > MAX_BATCH_MODELS) {
      setPageError(copy.models.batchLimit)
      return
    }
    if (requiresPaidTestConfirmation(selected.map((entry) => entry.model))
      && !window.confirm(copy.models.confirmPaid)) return

    const batchControllerInstance = new AbortController()
    batchController.current = batchControllerInstance
    setRunning(true)
    setPageError(null)
    setBatchNotice(null)
    setBatchProgress({ completed: 0, total: selected.length, current: 0 })
    try {
      await runModelTestBatch(
        selected.map((entry): BatchModel => ({ model: entry.model, keyId: entry.keyId ?? '' })),
        async (item, signal) => {
          const entry = selected.find((candidate) => (
            candidate.model.providerId === item.model.providerId && candidate.model.id === item.model.id
          ))
          if (!entry) throw new Error(copy.models.testFailed)
          return await testEntry(entry, signal)
        },
        batchControllerInstance.signal,
        {
          onProgress: setBatchProgress,
          onProviderPause: (providerId, milliseconds) => setBatchNotice(
            copy.models.providerPaused
              .replace('{name}', isProviderId(providerId) ? copy.keys.serviceNames[providerId] : copy.app.unknown)
              .replace('{seconds}', `${Math.ceil(milliseconds / 1000)} seconds`),
          ),
          onProviderStopped: (providerId) => setBatchNotice(
            copy.models.providerStopped.replace('{name}', isProviderId(providerId) ? copy.keys.serviceNames[providerId] : copy.app.unknown),
          ),
        },
      )
    } catch (error) {
      if (batchControllerInstance.signal.aborted) setBatchNotice(copy.models.batchStopped)
      else setPageError(copy.models.testFailed)
    } finally {
      batchController.current = null
      setRunning(false)
    }
  }

  function refreshCatalogs() {
    void queryClient.invalidateQueries({ queryKey: ['model-catalog'] })
  }

  function toggleAllProviders() {
    setSelectedProviders(allProvidersSelected ? new Set() : new Set(availableProviders))
  }

  function toggleProvider(providerId: ProviderId) {
    setSelectedProviders((current) => {
      const next = new Set(current ?? availableProviders)
      if (next.has(providerId)) next.delete(providerId)
      else next.add(providerId)
      return next
    })
  }

  function renderActions(entry: ModelListEntry) {
    const identity = getModelTestKey(entry.model.providerId, entry.model.id)
    return (
      <ModelActionsMenu
        entry={entry}
        selected={selectedModels.has(identity)}
        selectionDisabled={!entry.keyId || (selectedModels.size >= 10 && !selectedModels.has(identity))}
        favoritesLoading={favoritesLoading}
        showAdvancedFeatures={showAdvancedFeatures}
        onToggleSelection={() => toggleSelection(entry)}
        onToggleFavorite={() => toggleFavorite({ providerId: entry.model.providerId, modelId: entry.model.id })}
      />
    )
  }

  const catalogErrors = Object.values(catalogs).filter((catalog) => catalog.error)
  const catalogLoading = catalogRequests.some((request) => catalogs[catalogKey(request.providerId, request.keyId)]?.isLoading)
  const providerHasSavedKey = (providerId: ProviderId) => Boolean(providerKeysById.get(providerId)?.length)

  if (!isUnlocked) {
    return (
      <section className="mx-auto flex min-h-[50vh] max-w-2xl flex-col items-center justify-center rounded-2xl border border-slate-200 bg-white p-8 text-center dark:border-slate-800 dark:bg-slate-900">
        <h1 className="text-3xl font-bold text-slate-950 dark:text-white">{copy.models.unlockFirst}</h1>
        <p className="mt-3 max-w-lg text-base text-slate-700 dark:text-slate-300">{copy.models.unlockFirstHint}</p>
        <Link to="/unlock" className="mt-6 inline-flex min-h-14 items-center rounded-xl bg-indigo-700 px-7 text-lg font-bold text-white hover:bg-indigo-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-700">
          {copy.models.unlockFirstAction}
        </Link>
      </section>
    )
  }

  return (
    <section className="space-y-5">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-slate-950 dark:text-white">{copy.models.title}</h1>
          <p className="mt-1 text-base text-slate-700 dark:text-slate-300">{copy.models.subtitle}</p>
        </div>
        <button type="button" onClick={refreshCatalogs} className="min-h-11 rounded-lg border border-slate-400 px-4 text-base font-semibold dark:border-slate-600">{copy.models.refresh}</button>
      </header>

      <label className="block text-base font-medium text-slate-900 dark:text-white">
        {copy.app.search}
        <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={copy.models.searchPlaceholder} className="mt-1 block min-h-11 w-full rounded-lg border border-slate-400 bg-white px-3 py-2 text-base dark:border-slate-600 dark:bg-slate-950" />
      </label>

      {savedProviderCount === 0 && (
        <p className="rounded-lg bg-indigo-50 p-3 text-base text-indigo-950 dark:bg-indigo-950 dark:text-indigo-100">
          {copy.models.noProviders} <Link to="/providers" className="ml-2 inline-flex min-h-11 items-center rounded-lg bg-indigo-700 px-4 font-semibold text-white">{copy.models.addKey}</Link>
        </p>
      )}

      {catalogRequests.map((request) => (
        <ProviderCatalog key={catalogKey(request.providerId, request.keyId)} {...request} onChange={onCatalogChange} />
      ))}

      <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          <div className="min-w-0">
            <span className="block text-base font-medium text-slate-900 dark:text-white">{copy.models.filters}</span>
            <details className="relative min-w-0">
              <summary className="mt-1 flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 rounded-lg border border-slate-400 bg-white px-3 text-base text-slate-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-700 dark:border-slate-600 dark:bg-slate-950 dark:text-white [&::-webkit-details-marker]:hidden">
              <span className="truncate">
                {allProvidersSelected
                  ? copy.models.allProviders
                  : selectedProviderSet.size === 0
                    ? copy.models.noProvidersSelected
                    : copy.models.providerCount.replace('{count}', String(selectedProviderSet.size))}
                {(freeOnly || favoritesOnly) && ` · ${[freeOnly ? copy.models.freeOnly : '', favoritesOnly ? copy.models.favorites : ''].filter(Boolean).join(', ')}`}
              </span>
              <span aria-hidden="true">▾</span>
              </summary>
              <div className="absolute left-0 top-full z-30 mt-1 max-h-[min(70vh,28rem)] w-full min-w-64 overflow-y-auto rounded-xl border border-slate-200 bg-white p-3 shadow-xl dark:border-slate-700 dark:bg-slate-900">
              <fieldset className="space-y-1">
                <legend className="mb-2 text-sm font-semibold text-slate-900 dark:text-white">{copy.models.filters}</legend>
                <label className="flex min-h-10 cursor-pointer items-center gap-2 rounded-md px-2 text-sm font-medium text-slate-900 hover:bg-slate-100 dark:text-white dark:hover:bg-slate-800">
                  <input type="checkbox" checked={allProvidersSelected} onChange={toggleAllProviders} />
                  {copy.models.allProviders}
                </label>
                <div className="max-h-48 space-y-1 overflow-y-auto">
                  {availableProviders.map((providerId) => (
                    <label key={providerId} className="flex min-h-10 cursor-pointer items-center gap-2 rounded-md px-2 text-sm text-slate-800 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800">
                      <input
                        type="checkbox"
                        checked={selectedProviderSet.has(providerId)}
                        onChange={() => toggleProvider(providerId)}
                      />
                      {copy.keys.serviceNames[providerId]}
                    </label>
                  ))}
                </div>
              </fieldset>
              <div className="mt-2 border-t border-slate-200 pt-2 dark:border-slate-700">
                {selectedProviderHasPricing && (
                  <label className="flex min-h-10 cursor-pointer items-center gap-2 rounded-md px-2 text-sm text-slate-800 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800">
                    <input type="checkbox" checked={freeOnly} onChange={(event) => setFreeOnly(event.target.checked)} />
                    {copy.models.freeOnly}
                  </label>
                )}
                <label className="flex min-h-10 cursor-pointer items-center gap-2 rounded-md px-2 text-sm text-slate-800 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800">
                  <input type="checkbox" checked={favoritesOnly} onChange={(event) => setFavoritesOnly(event.target.checked)} />
                  <span aria-hidden="true" className="text-amber-600 dark:text-amber-300">★</span>
                  {copy.models.favorites}
                </label>
              </div>
              </div>
            </details>
          </div>
          <label className="text-base text-slate-900 dark:text-white">
            {copy.models.status}
            <select value={statusFilter} onChange={(event) => {
              const value = event.target.value
              if (value === 'all' || value === 'working' || value === 'failing' || value === 'not_tested') setStatusFilter(value)
            }} className="mt-1 block min-h-11 w-full rounded-lg border border-slate-400 bg-white px-2 py-2 text-base dark:border-slate-600 dark:bg-slate-950">
              <option value="all">{copy.models.all}</option><option value="working">{copy.models.statusWorking}</option><option value="failing">{copy.models.failing}</option><option value="not_tested">{copy.models.statusNotTested}</option>
            </select>
          </label>
          <label className="text-base text-slate-900 dark:text-white">
            {copy.models.sort}
            <select value={sort} onChange={(event) => {
              const value = event.target.value
              if (value === 'priority' || value === 'name' || value === 'context' || value === 'price' || value === 'recent') setSort(value)
            }} className="mt-1 block min-h-11 w-full rounded-lg border border-slate-400 bg-white px-2 py-2 text-base dark:border-slate-600 dark:bg-slate-950">
              <option value="priority">{copy.models.backupOrder}</option><option value="name">{copy.models.name}</option><option value="context">{copy.models.context}</option><option value="price">{copy.models.cheapest}</option><option value="recent">{copy.models.recent}</option>
            </select>
          </label>
        </div>
        <div className="flex flex-col gap-3 border-t border-slate-100 pt-3 dark:border-slate-800 sm:flex-row sm:items-end sm:justify-between">
          <span className="w-full text-center text-sm text-slate-700 dark:text-slate-300 sm:w-auto sm:text-left">
            {copy.models.resultsCount.replace('{count}', String(filtered.length))}
            {catalogLoading ? ` · ${copy.models.loading}` : ''}
          </span>
          {showAdvancedFeatures && <div className="flex min-w-0 flex-wrap items-end gap-2">
            {running ? (
              <>
                <span role="status" className="mr-2 text-sm text-slate-800 dark:text-slate-200">{copy.models.batchProgress.replace('{done}', String(batchProgress.completed)).replace('{total}', String(batchProgress.total)).replace('{active}', String(batchProgress.current))}</span>
                <button type="button" onClick={() => batchController.current?.abort()} className="min-h-11 rounded-lg border border-red-700 px-4 text-sm text-red-900 dark:border-red-300 dark:text-red-200">{copy.models.cancelBatch}</button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  disabled={!selectedModels.size}
                  onClick={() => {
                    void handleBatchTest(allModels.filter((entry) => selectedModels.has(
                      getModelTestKey(entry.model.providerId, entry.model.id),
                    )))
                  }}
                  className="min-h-11 rounded-lg border border-slate-400 px-3 text-sm font-semibold disabled:opacity-50 dark:border-slate-600"
                >
                  {copy.models.checkSelected.replace('{count}', String(selectedModels.size))}
                </button>
              </>
            )}
          </div>}
        </div>
      </div>

      {batchNotice && <p role="status" className="rounded-lg bg-amber-50 p-3 text-base text-amber-950 dark:bg-amber-950 dark:text-amber-100">{batchNotice}</p>}
      {pageError && <p role="alert" className="rounded-lg bg-red-50 p-3 text-base text-red-950 dark:bg-red-950 dark:text-red-100">{pageError}</p>}
      {favoritesError && <p role="alert" className="rounded-lg bg-red-50 p-3 text-base text-red-950 dark:bg-red-950 dark:text-red-100">{copy.errors.unknown}</p>}
      {mutationError && <p role="alert" className="rounded-lg bg-red-50 p-3 text-base text-red-950 dark:bg-red-950 dark:text-red-100">{copy.errors.unknown}</p>}
      {backupPlanError && <p role="alert" className="rounded-lg bg-amber-50 p-3 text-base text-amber-950 dark:bg-amber-950 dark:text-amber-100">{copy.models.backupOrderLoadFailed}</p>}
      {catalogErrors.length > 0 && (
        <p role="alert" className="rounded-lg bg-amber-50 p-3 text-base text-amber-950 dark:bg-amber-950 dark:text-amber-100">{copy.models.catalogError} {copy.models.otherListsOkay}</p>
      )}

      {visibleModels.length === 0
        ? <p className="rounded-lg border border-dashed border-slate-400 p-8 text-center text-base text-slate-800 dark:border-slate-600 dark:text-slate-200">
          {allModels.length === 0 && catalogLoading
            ? copy.models.loading
            : allModels.length === 0 && catalogErrors.length > 0
              ? copy.models.catalogError
              : allModels.length === 0
                ? copy.models.noProviders
                : favoritesOnly && favoritesLoading
                  ? copy.models.loading
                  : copy.models.noMatches}
        </p>
        : <>
          <div className="grid min-w-0 gap-3">
            {visibleModels.map((entry) => (
              <article key={getModelTestKey(entry.model.providerId, entry.model.id)} className="min-w-0 space-y-4 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
                <ModelDetails
                  entry={entry}
                  now={now}
                  onTest={() => { void handleTest(entry) }}
                  isTesting={testingModels.has(getModelTestKey(entry.model.providerId, entry.model.id))}
                  disabled={!entry.keyId || running}
                  actions={renderActions(entry)}
                />
              </article>
            ))}
          </div>
          {filtered.length > visibleCount && (
            <button type="button" onClick={() => setVisibleCount((count) => count + 100)} className="min-h-12 w-full rounded-lg border border-slate-400 px-4 py-3 text-base font-medium dark:border-slate-600">{copy.models.showMoreCount.replace('{count}', String(filtered.length - visibleCount))}</button>
          )}
        </>}

      {providerKeys.length > 0 && availableProviders.some((providerId) => !providerHasSavedKey(providerId)) && (
        <p className="text-base text-slate-700 dark:text-slate-300">{copy.models.listedHint}</p>
      )}
    </section>
  )
}
