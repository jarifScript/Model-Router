import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import type { ModelInfo } from '../core/models'
import { autoTargetIdentity, mergeAutoBackupTargets } from '../core/auto-backup-plan'
import type { RouteTarget } from '../core/route-types'
import type { ProviderId } from '../core/providers'
import { useModels } from '../lib/modelCatalog'
import { useAutoBackupPlan } from '../lib/autoBackupPlan'
import { copy } from '../lib/copy'
import { useVaultStore } from '../store/vault'
import type { DecryptedProviderKey } from '../types'

type CatalogState = {
  models: ModelInfo[]
  isLoading: boolean
  error: boolean
}

function catalogKey(providerId: ProviderId, keyId: string): string {
  return `${providerId}:${keyId}`
}

function CatalogLoader({
  providerKey,
  onChange,
}: {
  providerKey: DecryptedProviderKey
  onChange: (key: string, state: CatalogState) => void
}) {
  const query = useModels(providerKey.provider, providerKey.id)
  const key = catalogKey(providerKey.provider, providerKey.id)
  const hasError = Boolean(query.error)

  useEffect(() => {
    onChange(key, {
      models: query.data ?? [],
      isLoading: query.isLoading || query.isFetching,
      error: hasError,
    })
  }, [hasError, key, onChange, query.data, query.isFetching, query.isLoading])

  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900">
      <div>
        <p className="font-semibold text-slate-950 dark:text-white">{copy.keys.serviceNames[providerKey.provider]}</p>
        <p className="text-sm text-slate-700 dark:text-slate-300">{copy.backupPlans.modelKey.replace('{name}', providerKey.label)}</p>
      </div>
      {query.isLoading || query.isFetching
        ? <span role="status" className="text-sm text-slate-700 dark:text-slate-300">{copy.backupPlans.loadingModels}</span>
        : query.error
          ? <button type="button" onClick={() => { void query.refetch() }} className="min-h-11 px-3 font-semibold text-indigo-800 underline dark:text-indigo-300">{copy.app.retry}</button>
          : <div className="flex items-center gap-2">
            <span className="text-sm text-slate-700 dark:text-slate-300">{copy.backupPlans.listedModels.replace('{count}', String(query.data?.length ?? 0))}</span>
            <button type="button" onClick={() => { void query.refetch() }} className="min-h-11 px-2 text-sm font-semibold text-indigo-800 underline dark:text-indigo-300">{copy.models.refresh}</button>
          </div>}
      {query.error && <p role="alert" className="w-full text-sm text-amber-950 dark:text-amber-100">{copy.backupPlans.modelCatalogError}</p>}
    </div>
  )
}

export default function RoutesPage() {
  const providerKeys = useVaultStore((state) => state.providerKeys)
  const { plan, isLoading: planLoading, error: planError, savePlan, isSaving } = useAutoBackupPlan()
  const [catalogs, setCatalogs] = useState<Record<string, CatalogState>>({})
  const [targets, setTargets] = useState<RouteTarget[]>([])
  const [maxAttempts, setMaxAttempts] = useState(plan.maxAttempts)
  const [firstTokenTimeoutSeconds, setFirstTokenTimeoutSeconds] = useState(
    Math.round(plan.firstTokenTimeoutMs / 1000),
  )
  const [initialized, setInitialized] = useState(false)
  const [pageError, setPageError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [visibleCount, setVisibleCount] = useState(100)

  const onCatalogChange = useCallback((key: string, state: CatalogState) => {
    setCatalogs((current) => {
      const previous = current[key]
      if (previous && previous.models === state.models && previous.isLoading === state.isLoading && previous.error === state.error) {
        return current
      }
      return { ...current, [key]: state }
    })
  }, [])

  useEffect(() => {
    if (planLoading || initialized) return
    setTargets(plan.targets)
    setMaxAttempts(plan.maxAttempts)
    setFirstTokenTimeoutSeconds(Math.round(plan.firstTokenTimeoutMs / 1000))
    setInitialized(true)
  }, [initialized, plan, planError, planLoading])

  const validKeyIds = useMemo(() => new Set(providerKeys.map((key) => key.id)), [providerKeys])
  const catalogsLoading = providerKeys.some((key) => catalogs[catalogKey(key.provider, key.id)]?.isLoading !== false)

  useEffect(() => {
    if (!initialized || providerKeys.length === 0) return
    const discovered = providerKeys.flatMap((key) => {
      const catalog = catalogs[catalogKey(key.provider, key.id)]
      return (catalog?.models ?? []).map((model) => ({
        provider: key.provider,
        model: model.id,
        keyId: key.id,
        timeoutMs: 30_000,
        maxAttempts: 1,
      }))
    })
    if (discovered.length === 0) return
    setTargets((current) => mergeAutoBackupTargets(current, discovered, validKeyIds))
  }, [catalogs, initialized, providerKeys, validKeyIds])

  const modelInfoByIdentity = useMemo(() => {
    const entries = new Map<string, ModelInfo>()
    for (const key of providerKeys) {
      for (const model of catalogs[catalogKey(key.provider, key.id)]?.models ?? []) {
        entries.set(autoTargetIdentity({ provider: key.provider, model: model.id, keyId: key.id }), model)
      }
    }
    return entries
  }, [catalogs, providerKeys])

  const catalogErrorCount = providerKeys.filter((key) => catalogs[catalogKey(key.provider, key.id)]?.error).length

  function moveTarget(index: number, direction: -1 | 1) {
    setTargets((current) => {
      const nextIndex = index + direction
      if (nextIndex < 0 || nextIndex >= current.length) return current
      const next = [...current]
      ;[next[index], next[nextIndex]] = [next[nextIndex], next[index]]
      return next
    })
    setSaved(false)
  }

  function updateTimeout(index: number, seconds: number) {
    const timeoutMs = Math.min(120, Math.max(1, seconds)) * 1000
    setTargets((current) => current.map((target, itemIndex) => itemIndex === index
      ? { ...target, timeoutMs }
      : target))
    setSaved(false)
  }

  async function handleSave() {
    setPageError(null)
    setSaved(false)
    try {
      await savePlan({
        targets,
        maxAttempts,
        firstTokenTimeoutMs: firstTokenTimeoutSeconds * 1000,
      })
      setSaved(true)
    } catch {
      setPageError(copy.backupPlans.saveAutoPlanError)
    }
  }

  const visibleTargets = targets.slice(0, visibleCount)
  const modelsRemaining = Math.max(0, targets.length - visibleTargets.length)

  return (
    <section className="space-y-5">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold text-slate-950 dark:text-white">{copy.backupPlans.title}</h1>
          <p className="mt-1 text-base text-slate-700 dark:text-slate-300">{copy.backupPlans.subtitle}</p>
        </div>
        <Link to="/playground" className="inline-flex min-h-11 items-center rounded-lg border border-slate-400 px-4 text-base font-medium text-slate-900 dark:border-slate-600 dark:text-slate-100">{copy.nav.chat}</Link>
      </header>

      <p className="rounded-lg bg-indigo-50 p-4 text-base text-indigo-950 dark:bg-indigo-950 dark:text-indigo-100">{copy.backupPlans.orderHint}</p>

      {providerKeys.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-400 p-6 text-center dark:border-slate-600">
          <p className="text-base text-slate-800 dark:text-slate-200">{copy.backupPlans.noModels}</p>
          <Link to="/providers" className="mt-4 inline-flex min-h-12 items-center rounded-lg bg-indigo-700 px-5 text-base font-semibold text-white">{copy.backupPlans.noModelsButton}</Link>
        </div>
      ) : (
        <>
          <div className="grid gap-2 sm:grid-cols-2">
            {providerKeys.map((providerKey) => (
              <CatalogLoader
                key={catalogKey(providerKey.provider, providerKey.id)}
                providerKey={providerKey}
                onChange={onCatalogChange}
              />
            ))}
          </div>

          {planError && <p role="alert" className="rounded-lg bg-red-50 p-3 text-base text-red-950 dark:bg-red-950 dark:text-red-100">{copy.backupPlans.invalidPlan}</p>}
          {pageError && <p role="alert" className="rounded-lg bg-red-50 p-3 text-base text-red-950 dark:bg-red-950 dark:text-red-100">{pageError}</p>}
          {catalogErrorCount > 0 && <p className="text-sm text-amber-900 dark:text-amber-100">{copy.models.otherListsOkay}</p>}

          <div className="flex flex-wrap items-end justify-between gap-4 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block text-base font-medium text-slate-900 dark:text-white">
                {copy.backupPlans.stopAfter}
                <input
                  type="number"
                  min={2}
                  max={12}
                  step={1}
                  value={maxAttempts}
                  onChange={(event) => {
                    const value = Number(event.target.value)
                    if (Number.isInteger(value) && value >= 2 && value <= 12) {
                      setMaxAttempts(value)
                      setSaved(false)
                    }
                  }}
                  className="mt-1 block min-h-11 w-36 rounded-lg border border-slate-400 bg-white px-3 py-2 text-base dark:border-slate-600 dark:bg-slate-950"
                />
                <span className="mt-1 block max-w-sm text-sm font-normal text-slate-700 dark:text-slate-300">{copy.backupPlans.stopAfterHint}</span>
              </label>
              <label className="block text-base font-medium text-slate-900 dark:text-white">
                {copy.backupPlans.firstTokenTimeout}
                <input
                  type="number"
                  min={1}
                  max={120}
                  step={1}
                  value={firstTokenTimeoutSeconds}
                  onChange={(event) => {
                    const value = Number(event.target.value)
                    if (Number.isInteger(value) && value >= 1 && value <= 120) {
                      setFirstTokenTimeoutSeconds(value)
                      setSaved(false)
                    }
                  }}
                  className="mt-1 block min-h-11 w-36 rounded-lg border border-slate-400 bg-white px-3 py-2 text-base dark:border-slate-600 dark:bg-slate-950"
                />
                <span className="mt-1 block max-w-sm text-sm font-normal text-slate-700 dark:text-slate-300">{copy.backupPlans.firstTokenTimeoutHint}</span>
              </label>
            </div>
            <button
              type="button"
              onClick={() => { void handleSave() }}
              disabled={isSaving || catalogsLoading || !initialized || Boolean(planError)}
              className="min-h-12 rounded-lg bg-indigo-700 px-5 text-base font-semibold text-white disabled:opacity-50"
            >
              {isSaving ? copy.app.loading : copy.backupPlans.saveAutoPlan}
            </button>
            {saved && <p role="status" className="w-full text-base text-emerald-800 dark:text-emerald-200">{copy.backupPlans.saveAutoPlanSuccess}</p>}
          </div>

          {planLoading || !initialized ? (
            <p role="status" className="text-base text-slate-700 dark:text-slate-300">{copy.backupPlans.loading}</p>
          ) : (
            <ol className="space-y-2">
              {visibleTargets.map((target, index) => {
                const model = modelInfoByIdentity.get(autoTargetIdentity(target))
                const key = providerKeys.find((item) => item.id === target.keyId)
                const timeoutSeconds = (target.timeoutMs ?? 30_000) / 1000
                return (
                  <li key={autoTargetIdentity(target)} className="rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-900">
                    <div className="flex items-start gap-3">
                      <span aria-label={copy.backupPlans.priorityLabel.replace('{number}', String(index + 1))} className="flex size-9 shrink-0 items-center justify-center rounded-full bg-indigo-100 text-sm font-bold text-indigo-950 dark:bg-indigo-950 dark:text-indigo-100">{index + 1}</span>
                      <div className="min-w-0 flex-1">
                        <p className="break-words text-base font-semibold text-slate-950 dark:text-white">{model?.name ?? target.model}</p>
                        <p className="break-all text-sm text-slate-700 dark:text-slate-300">{target.model}</p>
                        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-slate-700 dark:text-slate-300">
                          <span>{copy.keys.serviceNames[target.provider]}</span>
                          {key && <span>{copy.backupPlans.modelKey.replace('{name}', key.label)}</span>}
                          {model?.isFree === true && <span className="font-semibold text-emerald-800 dark:text-emerald-200">{copy.models.freeBadge}</span>}
                        </div>
                        <details className="mt-2">
                          <summary className="min-h-11 inline-flex cursor-pointer items-center font-medium text-indigo-800 underline dark:text-indigo-300">{copy.backupPlans.moreOptions}</summary>
                          <label className="mt-2 block max-w-xs text-sm font-medium text-slate-900 dark:text-white">
                            {copy.backupPlans.giveUpAfterModel}
                            <input
                              type="number"
                              min={1}
                              max={120}
                              step={1}
                              value={timeoutSeconds}
                              onChange={(event) => updateTimeout(index, Number(event.target.value) || 1)}
                              className="mt-1 block min-h-11 w-full rounded-lg border border-slate-400 bg-white px-3 py-2 text-base dark:border-slate-600 dark:bg-slate-950"
                            />
                          </label>
                        </details>
                      </div>
                      <div className="flex shrink-0 flex-col gap-1 sm:flex-row">
                        <button type="button" aria-label={`${copy.backupPlans.moveUp}: ${model?.name ?? target.model}`} disabled={index === 0} onClick={() => moveTarget(index, -1)} className="min-h-11 min-w-11 rounded-lg border border-slate-400 text-xl disabled:opacity-40 dark:border-slate-600">↑</button>
                        <button type="button" aria-label={`${copy.backupPlans.moveDown}: ${model?.name ?? target.model}`} disabled={index === targets.length - 1} onClick={() => moveTarget(index, 1)} className="min-h-11 min-w-11 rounded-lg border border-slate-400 text-xl disabled:opacity-40 dark:border-slate-600">↓</button>
                      </div>
                    </div>
                  </li>
                )
              })}
            </ol>
          )}
          {modelsRemaining > 0 && <button type="button" onClick={() => setVisibleCount((count) => count + 100)} className="min-h-11 rounded-lg border border-slate-400 px-4 text-base font-medium dark:border-slate-600">{copy.backupPlans.showMore.replace('{count}', String(modelsRemaining))}</button>}
          {targets.length === 0 && !catalogsLoading && (
            <p className="rounded-lg border border-dashed border-slate-400 p-4 text-base dark:border-slate-600">{copy.backupPlans.noCatalogModels}</p>
          )}
        </>
      )}
    </section>
  )
}
