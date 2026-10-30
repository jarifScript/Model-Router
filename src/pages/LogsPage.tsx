import { useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import type { ProviderErrorClass } from '../core/adapters/types'
import { isProviderId, PROVIDER_CONFIGS, type ProviderId } from '../core/providers'
import type { RequestLogSource, RequestLogStatus } from '../lib/requestLogger'
import { formatEstimatedMoney } from '../lib/pricing'
import { copy } from '../lib/copy'
import { supabase } from '../lib/supabase'
import useAuth from '../hooks/useAuth'

const PAGE_SIZE = 25
const EXPORT_PAGE_SIZE = 1_000

type HistoryFilters = {
  result: RequestLogStatus | ''
  provider: ProviderId | ''
  source: RequestLogSource | ''
}

type HistoryItem = {
  id: string
  created_at: string
  source: RequestLogSource
  route_alias: string | null
  provider: ProviderId
  model: string
  latency_ms: number
  ttfb_ms: number | null
  input_tokens: number | null
  output_tokens: number | null
  tokens_estimated: boolean
  status: RequestLogStatus
  http_status: number | null
  error_class: ProviderErrorClass | null
  fallback_count: number
  est_cost_usd: number | null
  est_baseline_cost_usd: number | null
  est_saved_usd: number | null
}

type HistoryPage = { items: HistoryItem[]; count: number | null }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function nullableNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function parseHistoryItems(value: unknown): HistoryItem[] {
  if (!Array.isArray(value)) throw new Error('The saved activity could not be read.')
  return value.map((item) => {
    if (!isRecord(item)
      || typeof item.id !== 'string'
      || typeof item.created_at !== 'string'
      || typeof item.source !== 'string'
      || !['single', 'auto', 'route', 'gateway'].includes(item.source)
      || typeof item.provider !== 'string'
      || !isProviderId(item.provider)
      || typeof item.model !== 'string'
      || typeof item.latency_ms !== 'number'
      || typeof item.status !== 'string'
      || !['success', 'error', 'aborted'].includes(item.status)
      || typeof item.tokens_estimated !== 'boolean'
      || typeof item.fallback_count !== 'number') {
      throw new Error('The saved activity has an unexpected format.')
    }
    return {
      id: item.id,
      created_at: item.created_at,
      source: item.source as RequestLogSource,
      route_alias: typeof item.route_alias === 'string' ? item.route_alias : null,
      provider: item.provider,
      model: item.model,
      latency_ms: item.latency_ms,
      ttfb_ms: nullableNumber(item.ttfb_ms),
      input_tokens: nullableNumber(item.input_tokens),
      output_tokens: nullableNumber(item.output_tokens),
      tokens_estimated: item.tokens_estimated,
      status: item.status as RequestLogStatus,
      http_status: nullableNumber(item.http_status),
      error_class: typeof item.error_class === 'string'
        && ['rate_limit', 'server', 'timeout', 'auth', 'quota', 'model_not_found', 'bad_request', 'content_filter', 'network', 'stream_interrupted'].includes(item.error_class)
        ? item.error_class as ProviderErrorClass
        : null,
      fallback_count: item.fallback_count,
      est_cost_usd: nullableNumber(item.est_cost_usd),
      est_baseline_cost_usd: nullableNumber(item.est_baseline_cost_usd),
      est_saved_usd: nullableNumber(item.est_saved_usd),
    }
  })
}

function csvCell(value: string): string {
  const safeValue = /^[\t\r ]*[=+\-@]/.test(value) ? `'${value}` : value
  return `"${safeValue.replaceAll('"', '""')}"`
}

function wordEstimate(item: HistoryItem): string {
  if (item.input_tokens === null || item.output_tokens === null) return copy.app.unknown
  return `~${Math.round((item.input_tokens + item.output_tokens) * 0.75)}`
}

function statusLabel(status: RequestLogStatus): string {
  return copy.history.resultNames[status]
}

async function fetchHistoryPage(
  filters: HistoryFilters,
  from: number,
  to: number,
): Promise<HistoryPage> {
  if (!supabase) throw new Error('Sign in to load history.')
  let query = supabase
    .from('request_logs')
    .select('id, created_at, source, route_alias, provider, model, latency_ms, ttfb_ms, input_tokens, output_tokens, tokens_estimated, status, http_status, error_class, fallback_count, est_cost_usd, est_baseline_cost_usd, est_saved_usd', { count: 'exact' })
    .order('created_at', { ascending: false })
  if (filters.result) query = query.eq('status', filters.result)
  if (filters.provider) query = query.eq('provider', filters.provider)
  if (filters.source) query = query.eq('source', filters.source)
  const { data, error, count } = await query.range(from, to)
  if (error) throw error
  return { items: parseHistoryItems(data), count }
}

async function fetchAllFilteredHistory(filters: HistoryFilters): Promise<HistoryItem[]> {
  const items: HistoryItem[] = []
  for (let offset = 0; ; offset += EXPORT_PAGE_SIZE) {
    const page = await fetchHistoryPage(filters, offset, offset + EXPORT_PAGE_SIZE - 1)
    items.push(...page.items)
    if (page.items.length < EXPORT_PAGE_SIZE
      || (page.count !== null && items.length >= page.count)) return items
  }
}

function exportHistory(items: HistoryItem[]) {
  const rows = [
    [copy.history.time, copy.history.source, copy.history.service, copy.history.model, copy.history.status, copy.history.speed, copy.history.wordsUsed, copy.history.cost, copy.history.comparisonCost, copy.history.savings, copy.history.backups, copy.history.errorClass],
    ...items.map((item) => [
      new Date(item.created_at).toLocaleString(),
      copy.history.sourceNames[item.source],
      copy.keys.serviceNames[item.provider],
      item.model,
      statusLabel(item.status),
      copy.history.speedValue.replace('{count}', String(item.latency_ms)),
      wordEstimate(item),
      item.est_cost_usd === null ? copy.history.unknownCost : formatEstimatedMoney(item.est_cost_usd),
      item.est_baseline_cost_usd === null ? copy.history.unknownCost : formatEstimatedMoney(item.est_baseline_cost_usd),
      item.est_saved_usd === null ? copy.history.unknownCost : formatEstimatedMoney(Math.max(item.est_saved_usd, 0)),
      String(item.fallback_count),
      item.error_class ? copy.history.errorClassNames[item.error_class] : '',
    ]),
  ]
  const csv = `\uFEFF${rows.map((row) => row.map(csvCell).join(',')).join('\r\n')}`
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
  const link = document.createElement('a')
  link.href = url
  link.download = copy.history.downloadName
  document.body.append(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 0)
}

export default function LogsPage() {
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const [filters, setFilters] = useState<HistoryFilters>({ result: '', provider: '', source: '' })
  const [page, setPage] = useState(0)
  const [selectedItem, setSelectedItem] = useState<HistoryItem | null>(null)
  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState(false)
  const selectedRowTriggerRef = useRef<HTMLButtonElement | null>(null)
  const dialogCloseButtonRef = useRef<HTMLButtonElement | null>(null)
  const history = useQuery({
    queryKey: ['history', user?.id, filters, page],
    enabled: Boolean(user && supabase),
    staleTime: 30_000,
    queryFn: () => fetchHistoryPage(filters, page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1),
  })
  const rowCount = history.data?.count ?? 0
  const totalPages = Math.max(1, Math.ceil(rowCount / PAGE_SIZE))
  const hasFilters = Boolean(filters.result || filters.provider || filters.source)

  useEffect(() => {
    if (!selectedItem) return

    dialogCloseButtonRef.current?.focus()
    function handleDialogKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setSelectedItem(null)
        window.requestAnimationFrame(() => {
          if (selectedRowTriggerRef.current?.isConnected) selectedRowTriggerRef.current.focus()
        })
      } else if (event.key === 'Tab') {
        event.preventDefault()
        dialogCloseButtonRef.current?.focus()
      }
    }

    window.addEventListener('keydown', handleDialogKeyDown)
    return () => window.removeEventListener('keydown', handleDialogKeyDown)
  }, [selectedItem])

  function closeDetails() {
    setSelectedItem(null)
    window.requestAnimationFrame(() => {
      if (selectedRowTriggerRef.current?.isConnected) selectedRowTriggerRef.current.focus()
    })
  }

  useEffect(() => {
    const refresh = () => {
      void queryClient.invalidateQueries({ queryKey: ['history', user?.id] })
    }
    window.addEventListener('request-logs-updated', refresh)
    return () => window.removeEventListener('request-logs-updated', refresh)
  }, [queryClient, user?.id])

  function updateFilter<K extends keyof HistoryFilters>(key: K, value: HistoryFilters[K]) {
    setPage(0)
    setFilters((current) => ({ ...current, [key]: value }))
  }

  async function handleExport() {
    setExporting(true)
    setExportError(false)
    try {
      const allRows = await fetchAllFilteredHistory(filters)
      exportHistory(allRows)
    } catch {
      setExportError(true)
    } finally {
      setExporting(false)
    }
  }

  return (
    <section className="mx-auto max-w-7xl space-y-5">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold">{copy.history.title}</h1>
          <p className="mt-1 text-base text-slate-700 dark:text-slate-300">{copy.history.subtitle}</p>
          <p className="mt-2 text-base font-semibold">{copy.history.privacy}</p>
        </div>
        {!!rowCount && (
          <button type="button" onClick={() => { void handleExport() }} disabled={exporting} className="min-h-11 shrink-0 rounded-lg border border-slate-400 px-4 text-base font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-700 disabled:opacity-60 dark:border-slate-600">
            {exporting ? copy.history.exportLoading : copy.history.exportCsv}
          </button>
        )}
      </header>

      <div className="grid gap-3 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900 sm:grid-cols-3">
        <label className="text-sm font-semibold">
          {copy.history.resultFilter}
          <select value={filters.result} onChange={(event) => updateFilter('result', event.target.value as HistoryFilters['result'])} className="mt-1 min-h-11 w-full rounded-lg border border-slate-400 bg-white px-3 text-base focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-700 dark:border-slate-600 dark:bg-slate-950">
            <option value="">{copy.history.allResults}</option>
            <option value="success">{copy.history.resultNames.success}</option>
            <option value="error">{copy.history.resultNames.error}</option>
            <option value="aborted">{copy.history.resultNames.aborted}</option>
          </select>
        </label>
        <label className="text-sm font-semibold">
          {copy.history.serviceFilter}
          <select value={filters.provider} onChange={(event) => updateFilter('provider', event.target.value as HistoryFilters['provider'])} className="mt-1 min-h-11 w-full rounded-lg border border-slate-400 bg-white px-3 text-base focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-700 dark:border-slate-600 dark:bg-slate-950">
            <option value="">{copy.history.allServices}</option>
            {PROVIDER_CONFIGS.map(({ id }) => <option key={id} value={id}>{copy.keys.serviceNames[id]}</option>)}
          </select>
        </label>
        <label className="text-sm font-semibold">
          {copy.history.sourceFilter}
          <select value={filters.source} onChange={(event) => updateFilter('source', event.target.value as HistoryFilters['source'])} className="mt-1 min-h-11 w-full rounded-lg border border-slate-400 bg-white px-3 text-base focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-700 dark:border-slate-600 dark:bg-slate-950">
            <option value="">{copy.history.allSources}</option>
            {(['single', 'auto', 'route', 'gateway'] as const).map((source) => <option key={source} value={source}>{copy.history.sourceNames[source]}</option>)}
          </select>
        </label>
      </div>

      {exportError && <p role="alert" className="rounded-lg bg-red-50 p-3 text-base text-red-900 dark:bg-red-950 dark:text-red-100">{copy.history.exportError}</p>}
      {history.isLoading && <p role="status" className="text-base">{copy.history.loading}</p>}
      {history.isError && <div role="alert" className="rounded-xl bg-red-50 p-4 text-base text-red-900 dark:bg-red-950 dark:text-red-100">
        <p>{copy.history.error}</p>
        <button type="button" onClick={() => { void history.refetch() }} className="mt-3 min-h-11 rounded-lg border border-red-700 px-4 font-semibold underline">{copy.app.retry}</button>
      </div>}
      {!history.isLoading && !history.isError && rowCount === 0 && (
        <div className="rounded-2xl border border-dashed border-slate-400 p-8 text-center">
          <p className="text-lg">{hasFilters ? copy.history.noMatches : copy.history.empty}</p>
          {!hasFilters && <Link to="/playground" className="mt-4 inline-flex min-h-12 items-center rounded-xl bg-indigo-700 px-5 font-semibold text-white">{copy.nav.chat}</Link>}
        </div>
      )}
      {!!history.data?.items.length && (
        <>
          <div className="min-w-0 overflow-hidden rounded-xl border border-slate-300 dark:border-slate-700">
            <table className="w-full table-fixed text-left text-sm">
              <thead className="bg-slate-100 dark:bg-slate-900">
                <tr>
                  <th scope="col" className="w-[52%] p-2 font-semibold sm:p-3">{copy.history.model}</th>
                  <th scope="col" className="w-[24%] p-2 font-semibold sm:p-3">{copy.history.service}</th>
                  <th scope="col" className="w-[24%] p-2 font-semibold sm:p-3">{copy.history.moreInfo}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                {history.data.items.map((item) => (
                  <tr key={item.id} className="align-middle">
                    <td className="p-2 sm:p-3">
                      <div className="flex min-w-0 items-center gap-2">
                        <ResultStatusIcon status={item.status} model={item.model} />
                        <span className="min-w-0 break-all font-medium">{item.model}</span>
                      </div>
                    </td>
                    <td className="break-words p-2 sm:p-3">{copy.keys.serviceNames[item.provider]}</td>
                    <td className="p-2 sm:p-3">
                      <button
                        type="button"
                        onClick={(event) => {
                          selectedRowTriggerRef.current = event.currentTarget
                          setSelectedItem(item)
                        }}
                        className="min-h-10 w-full rounded-lg border border-indigo-700 px-1.5 py-1 font-semibold text-indigo-800 underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-700 dark:text-indigo-300 sm:px-3"
                      >
                        {copy.history.moreInfo}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <nav aria-label={copy.history.title} className="flex flex-wrap items-center justify-between gap-3">
            <span className="text-sm text-slate-700 dark:text-slate-300">{copy.history.page.replace('{current}', String(page + 1)).replace('{total}', String(totalPages))}</span>
            <div className="flex gap-2">
              <button type="button" disabled={page === 0} onClick={() => setPage((current) => Math.max(0, current - 1))} className="min-h-11 rounded-lg border border-slate-400 px-4 text-sm font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-700 disabled:opacity-50 dark:border-slate-600">{copy.history.previousPage}</button>
              <button type="button" disabled={page + 1 >= totalPages} onClick={() => setPage((current) => current + 1)} className="min-h-11 rounded-lg border border-slate-400 px-4 text-sm font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-700 disabled:opacity-50 dark:border-slate-600">{copy.history.nextPage}</button>
            </div>
          </nav>
        </>
      )}
      {selectedItem && (
        <div
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeDetails()
          }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-3 sm:p-6"
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="history-details-title"
            className="max-h-[90dvh] w-full max-w-xl overflow-y-auto rounded-2xl border border-slate-300 bg-white p-5 shadow-2xl dark:border-slate-700 dark:bg-slate-900 sm:p-6"
          >
            <header className="flex items-start justify-between gap-4">
              <h2 id="history-details-title" className="text-xl font-bold">{copy.history.detailsTitle}</h2>
              <button
                ref={dialogCloseButtonRef}
                type="button"
                onClick={closeDetails}
                className="min-h-11 shrink-0 rounded-lg border border-slate-400 px-3 font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-700 dark:border-slate-600"
              >
                {copy.history.closeDetails}
              </button>
            </header>
            <dl className="mt-5 grid gap-4 sm:grid-cols-2">
              <MetaRow label={copy.history.time} value={new Date(selectedItem.created_at).toLocaleString()} />
              <MetaRow label={copy.history.source} value={copy.history.sourceNames[selectedItem.source]} />
              <MetaRow label={copy.history.service} value={copy.keys.serviceNames[selectedItem.provider]} />
              <MetaRow label={copy.history.model} value={selectedItem.model} />
              <MetaRow label={copy.history.status} value={statusLabel(selectedItem.status)} />
              {selectedItem.route_alias && <MetaRow label={copy.history.sourceNames.route} value={selectedItem.route_alias} />}
              <MetaRow label={copy.history.speed} value={copy.history.speedValue.replace('{count}', selectedItem.latency_ms.toLocaleString())} />
              {selectedItem.ttfb_ms !== null && <MetaRow label={copy.history.firstResponse} value={copy.history.speedValue.replace('{count}', selectedItem.ttfb_ms.toLocaleString())} />}
              <MetaRow label={copy.history.wordsUsed} value={wordEstimate(selectedItem)} />
              <MetaRow label={copy.history.cost} value={selectedItem.est_cost_usd === null ? copy.history.unknownCost : formatEstimatedMoney(selectedItem.est_cost_usd)} />
              {selectedItem.est_baseline_cost_usd !== null && <MetaRow label={copy.history.comparisonCost} value={formatEstimatedMoney(selectedItem.est_baseline_cost_usd)} />}
              {selectedItem.est_saved_usd !== null && <MetaRow label={copy.history.savings} value={formatEstimatedMoney(Math.max(selectedItem.est_saved_usd, 0))} />}
              <MetaRow label={copy.history.backups} value={String(selectedItem.fallback_count)} />
              {selectedItem.http_status !== null && <MetaRow label={copy.history.responseCode} value={String(selectedItem.http_status)} />}
              {selectedItem.error_class && <MetaRow label={copy.history.errorClass} value={copy.history.errorClassNames[selectedItem.error_class]} />}
            </dl>
            {selectedItem.tokens_estimated && <p className="mt-4 text-sm text-slate-600 dark:text-slate-300">{copy.history.approximateWords}</p>}
          </section>
        </div>
      )}
    </section>
  )
}

function MetaRow({ label, value }: { label: string; value: string }) {
  return <div className="min-w-0"><dt className="font-semibold">{label}</dt><dd className="break-words">{value}</dd></div>
}

function ResultStatusIcon({ status, model }: { status: RequestLogStatus; model: string }) {
  const styles = status === 'success'
    ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200'
    : status === 'error'
      ? 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200'
      : 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200'

  return (
    <span
      role="img"
      aria-label={`${statusLabel(status)}: ${model}`}
      title={statusLabel(status)}
      className={`inline-flex size-6 shrink-0 items-center justify-center rounded-full text-sm font-bold ${styles}`}
    >
      <svg aria-hidden="true" viewBox="0 0 16 16" className="size-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        {status === 'success'
          ? <path d="m3 8 3.2 3.2L13 4.5" />
          : status === 'error'
            ? <path d="m4 4 8 8m0-8-8 8" />
            : <path d="M4.5 4.5h7v7h-7z" fill="currentColor" stroke="none" />}
      </svg>
    </span>
  )
}
