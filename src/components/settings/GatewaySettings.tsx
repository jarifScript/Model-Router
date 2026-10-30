import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { isProviderId, type ProviderId } from '../../core/providers'
import { generateGatewayRouterKey, hashGatewayRouterKey } from '../../core/gateway-crypto'
import { copy } from '../../lib/copy'
import { supabase } from '../../lib/supabase'
import useAuth from '../../hooks/useAuth'
import { useVaultStore } from '../../store/vault'

type SharedGatewayKey = {
  providerKeyId: string
  provider: ProviderId
  label: string
  createdAt: string
  updatedAt: string
}

type GatewayRouterKey = {
  id: string
  label: string
  requestsPerMinute: number
  requestsPerDay: number
  createdAt: string
  lastUsedAt: string | null
  revokedAt: string | null
}

type GatewayKeyUsage = {
  routerKeyId: string
  period: 'minute' | 'day'
  periodStart: string
  requestCount: number
}

type OneTimeRouterKey = {
  id: string
  label: string
  token: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseSharedKeys(value: unknown): SharedGatewayKey[] {
  if (!Array.isArray(value)) throw new Error(copy.settings.gatewayUsageError)
  return value.flatMap((item) => {
    if (!isRecord(item)
      || typeof item.provider_key_id !== 'string'
      || typeof item.provider !== 'string'
      || !isProviderId(item.provider)
      || typeof item.label !== 'string'
      || typeof item.created_at !== 'string'
      || typeof item.updated_at !== 'string') return []
    return [{
      providerKeyId: item.provider_key_id,
      provider: item.provider,
      label: item.label,
      createdAt: item.created_at,
      updatedAt: item.updated_at,
    }]
  })
}

function parseRouterKeys(value: unknown): GatewayRouterKey[] {
  if (!Array.isArray(value)) throw new Error(copy.settings.gatewayUsageError)
  return value.flatMap((item) => {
    if (!isRecord(item)
      || typeof item.id !== 'string'
      || typeof item.label !== 'string'
      || typeof item.requests_per_minute !== 'number'
      || typeof item.requests_per_day !== 'number'
      || typeof item.created_at !== 'string') return []
    return [{
      id: item.id,
      label: item.label,
      requestsPerMinute: item.requests_per_minute,
      requestsPerDay: item.requests_per_day,
      createdAt: item.created_at,
      lastUsedAt: typeof item.last_used_at === 'string' ? item.last_used_at : null,
      revokedAt: typeof item.revoked_at === 'string' ? item.revoked_at : null,
    }]
  })
}

function parseUsageRows(value: unknown): GatewayKeyUsage[] {
  if (!Array.isArray(value)) throw new Error(copy.settings.gatewayUsageError)
  return value.flatMap((item) => {
    if (!isRecord(item)
      || typeof item.router_key_id !== 'string'
      || (item.period !== 'minute' && item.period !== 'day')
      || typeof item.period_start !== 'string'
      || typeof item.request_count !== 'number') return []
    return [{
      routerKeyId: item.router_key_id,
      period: item.period,
      periodStart: item.period_start,
      requestCount: item.request_count,
    }]
  })
}

function currentCount(
  usageRows: GatewayKeyUsage[],
  routerKeyId: string,
  period: GatewayKeyUsage['period'],
): number {
  const now = Date.now()
  const windowMs = period === 'minute' ? 60_000 : 86_400_000
  return usageRows.find((row) => row.routerKeyId === routerKeyId
    && row.period === period
    && now - Date.parse(row.periodStart) >= 0
    && now - Date.parse(row.periodStart) < windowMs)?.requestCount ?? 0
}

export default function GatewaySettings() {
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const { providerKeys, isUnlocked } = useVaultStore()
  const [selectedProviderKeyId, setSelectedProviderKeyId] = useState('')
  const [routerLabel, setRouterLabel] = useState('')
  const [requestsPerMinute, setRequestsPerMinute] = useState(30)
  const [requestsPerDay, setRequestsPerDay] = useState(1000)
  const [oneTimeKey, setOneTimeKey] = useState<OneTimeRouterKey | null>(null)
  const [keyCopied, setKeyCopied] = useState(false)
  const [keyCopyError, setKeyCopyError] = useState('')
  const [busy, setBusy] = useState(false)
  const [testing, setTesting] = useState(false)
  const [actionError, setActionError] = useState('')
  const [message, setMessage] = useState('')
  const routerKeyInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!oneTimeKey) return
    routerKeyInputRef.current?.focus()
    routerKeyInputRef.current?.select()
  }, [oneTimeKey])

  const enabled = Boolean(user && supabase)
  const sharedQuery = useQuery({
    queryKey: ['gateway-shared-keys', user?.id],
    enabled,
    queryFn: async () => {
      if (!supabase) throw new Error(copy.settings.gatewayUsageError)
      const { data, error } = await supabase.rpc('list_my_gateway_shared_keys')
      if (error) throw error
      return parseSharedKeys(data)
    },
  })
  const routerKeysQuery = useQuery({
    queryKey: ['gateway-router-keys', user?.id],
    enabled,
    queryFn: async () => {
      if (!supabase || !user) throw new Error(copy.settings.gatewayUsageError)
      const { data, error } = await supabase
        .from('gateway_router_keys')
        .select('id, label, requests_per_minute, requests_per_day, created_at, last_used_at, revoked_at')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
      if (error) throw error
      return parseRouterKeys(data)
    },
  })
  const usageQuery = useQuery({
    queryKey: ['gateway-key-usage', user?.id],
    enabled,
    refetchInterval: 30_000,
    queryFn: async () => {
      if (!supabase || !user) throw new Error(copy.settings.gatewayUsageError)
      const { data, error } = await supabase
        .from('gateway_key_usage')
        .select('router_key_id, period, period_start, request_count')
        .eq('user_id', user.id)
        .gte('period_start', new Date(Date.now() - 86_400_000).toISOString())
      if (error) throw error
      return parseUsageRows(data)
    },
  })

  const sharedKeys = sharedQuery.data ?? []
  const routerKeys = routerKeysQuery.data ?? []
  const usageRows = usageQuery.data ?? []
  const sharedIds = useMemo(() => new Set(sharedKeys.map(({ providerKeyId }) => providerKeyId)), [sharedKeys])
  const unsharedProviderKeys = providerKeys.filter((key) => !sharedIds.has(key.id))
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL?.replace(/\/$/, '')
  const gatewayBaseUrl = supabaseUrl ? `${supabaseUrl}/functions/v1/gateway/v1` : ''
  const isLoading = sharedQuery.isLoading || routerKeysQuery.isLoading || usageQuery.isLoading
  const hasError = sharedQuery.isError || routerKeysQuery.isError || usageQuery.isError

  async function refreshGatewayData() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['gateway-shared-keys', user?.id] }),
      queryClient.invalidateQueries({ queryKey: ['gateway-router-keys', user?.id] }),
      queryClient.invalidateQueries({ queryKey: ['gateway-key-usage', user?.id] }),
    ])
  }

  async function shareProviderKey() {
    setActionError('')
    setMessage('')
    if (!isUnlocked) {
      setActionError(copy.settings.gatewayUnlockFirst)
      return
    }
    const key = providerKeys.find((item) => item.id === selectedProviderKeyId)
    if (!supabase || !key) {
      setActionError(copy.settings.gatewayShareError)
      return
    }
    setBusy(true)
    try {
      const { data, error } = await supabase.functions.invoke('gateway-admin', {
        body: { providerKeyId: key.id, apiKey: key.apiKey },
      })
      if (error || !isRecord(data) || data.ok !== true) throw new Error('Gateway sharing failed.')
      await refreshGatewayData()
      setSelectedProviderKeyId('')
      setMessage(copy.settings.gatewayShareSuccess)
    } catch {
      setActionError(copy.settings.gatewayShareError)
    } finally {
      setBusy(false)
    }
  }

  async function stopSharing(providerKeyId: string) {
    setActionError('')
    setMessage('')
    if (!supabase) {
      setActionError(copy.settings.gatewayShareError)
      return
    }
    setBusy(true)
    try {
      const { error } = await supabase.rpc('unshare_my_gateway_key', {
        p_provider_key_id: providerKeyId,
      })
      if (error) throw error
      await refreshGatewayData()
      setMessage(copy.settings.gatewayUnshareSuccess)
    } catch {
      setActionError(copy.settings.gatewayShareError)
    } finally {
      setBusy(false)
    }
  }

  async function createRouterKey(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setActionError('')
    setMessage('')
    const label = routerLabel.trim()
    if (!supabase || label.length < 1 || label.length > 60
      || !Number.isInteger(requestsPerMinute) || requestsPerMinute < 1 || requestsPerMinute > 60
      || !Number.isInteger(requestsPerDay) || requestsPerDay < 1 || requestsPerDay > 10_000) {
      setActionError(copy.settings.gatewayCreateRouterKeyError)
      return
    }

    setBusy(true)
    try {
      const token = generateGatewayRouterKey()
      const keyHash = await hashGatewayRouterKey(token)
      const { data, error } = await supabase.rpc('create_my_gateway_router_key', {
        p_key_hash: keyHash,
        p_label: label,
        p_requests_per_minute: requestsPerMinute,
        p_requests_per_day: requestsPerDay,
      })
      if (error) throw error
      const created = Array.isArray(data) ? data[0] as unknown : null
      if (!isRecord(created) || typeof created.id !== 'string') {
        throw new Error('The gateway key was not created.')
      }
      setOneTimeKey({ id: created.id, label, token })
      setKeyCopied(false)
      setKeyCopyError('')
      setRouterLabel('')
      await refreshGatewayData()
    } catch {
      setActionError(copy.settings.gatewayCreateRouterKeyError)
    } finally {
      setBusy(false)
    }
  }

  async function revokeRouterKey(key: GatewayRouterKey) {
    setActionError('')
    setMessage('')
    if (!supabase || !window.confirm(`${copy.settings.gatewayRevoke} “${key.label}”?`)) return
    setBusy(true)
    try {
      const { error } = await supabase.rpc('revoke_my_gateway_router_key', { p_key_id: key.id })
      if (error) throw error
      if (oneTimeKey?.id === key.id) setOneTimeKey(null)
      await refreshGatewayData()
      setMessage(copy.settings.gatewayRevoked)
    } catch {
      setActionError(copy.settings.gatewayUsageError)
    } finally {
      setBusy(false)
    }
  }

  async function copyRouterKey() {
    if (!oneTimeKey) return
    setKeyCopyError('')
    try {
      await navigator.clipboard.writeText(oneTimeKey.token)
      setKeyCopied(true)
    } catch {
      setKeyCopyError(copy.settings.gatewayRouterKeyCopyError)
    }
  }

  function dismissRouterKey() {
    if (!oneTimeKey) return
    if (!keyCopied && !window.confirm(copy.settings.gatewayRouterKeyDismissConfirm)) return
    setOneTimeKey(null)
    setKeyCopied(false)
    setKeyCopyError('')
  }

  async function testGateway() {
    if (!oneTimeKey || !gatewayBaseUrl) {
      setActionError(copy.settings.gatewayTestNoKey)
      return
    }
    if (!window.confirm(copy.settings.gatewayTestConfirm)) return
    setActionError('')
    setMessage('')
    setTesting(true)
    const controller = new AbortController()
    const timer = window.setTimeout(() => controller.abort(), 125_000)
    try {
      const response = await fetch(`${gatewayBaseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${oneTimeKey.token}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: 'auto',
          messages: [{ role: 'user', content: 'Reply with the single word OK.' }],
          stream: false,
          max_tokens: 16,
        }),
        signal: controller.signal,
      })
      if (!response.ok) {
        await response.body?.cancel()
        throw new Error('Gateway test failed.')
      }
      await response.body?.cancel()
      setMessage(copy.settings.gatewayTestSuccess)
      window.dispatchEvent(new Event('request-logs-updated'))
    } catch {
      setActionError(copy.settings.gatewayTestError)
    } finally {
      window.clearTimeout(timer)
      setTesting(false)
      await usageQuery.refetch()
    }
  }

  const integrationExample = gatewayBaseUrl
    ? `curl.exe "${gatewayBaseUrl}/chat/completions" -H "Authorization: Bearer $env:ROUTER_KEY" -H "Content-Type: application/json" -d '{"model":"auto","messages":[{"role":"user","content":"Hello"}]}'`
    : copy.settings.gatewayDisabledHint

  return (
    <section className="space-y-5 rounded-2xl border border-indigo-200 bg-white p-5 dark:border-indigo-900 dark:bg-slate-900 sm:p-6">
      <header>
        <h2 className="text-xl font-semibold">{copy.settings.gatewayTitle}</h2>
        <p className="mt-1 text-sm text-slate-700 dark:text-slate-300">{copy.settings.gatewayHint}</p>
        <p className="mt-2 rounded-lg bg-amber-50 p-3 text-sm text-amber-950 dark:bg-amber-950 dark:text-amber-100">{copy.settings.gatewaySharingWarning}</p>
      </header>

      <section className="space-y-3 border-t border-slate-200 pt-4 dark:border-slate-800">
        <h3 className="font-semibold">{copy.settings.gatewaySharedKeys}</h3>
        {isUnlocked ? (
          <div className="flex flex-col gap-2 sm:flex-row">
            <label className="min-w-0 flex-1 text-sm font-medium">
              {copy.settings.gatewayShareKey}
              <select
                value={selectedProviderKeyId}
                onChange={(event) => setSelectedProviderKeyId(event.target.value)}
                disabled={unsharedProviderKeys.length === 0 || busy}
                className="mt-1 min-h-11 w-full rounded-lg border border-slate-400 bg-white px-3 text-base dark:border-slate-600 dark:bg-slate-950"
              >
                <option value="">{copy.settings.gatewayNoProviderKeys}</option>
                {unsharedProviderKeys.map((key) => (
                  <option key={key.id} value={key.id}>
                    {key.label} · {copy.keys.serviceNames[key.provider]}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              onClick={() => { void shareProviderKey() }}
              disabled={!selectedProviderKeyId || busy || unsharedProviderKeys.length === 0}
              className="min-h-11 self-end rounded-lg bg-indigo-700 px-4 font-semibold text-white disabled:opacity-50"
            >
              {busy ? copy.secretPassword.working : copy.settings.gatewayShareKey}
            </button>
          </div>
        ) : (
          <p className="text-sm text-slate-700 dark:text-slate-300">{copy.settings.gatewayUnlockFirst}</p>
        )}
        {sharedKeys.length === 0
          ? <p className="text-sm text-slate-700 dark:text-slate-300">{copy.settings.gatewayNoSharedKeys}</p>
          : <ul className="divide-y divide-slate-200 rounded-xl border border-slate-200 dark:divide-slate-800 dark:border-slate-800">
            {sharedKeys.map((key) => (
              <li key={key.providerKeyId} className="flex flex-wrap items-center justify-between gap-3 p-3">
                <span className="min-w-0 break-words text-sm">
                  <strong>{key.label}</strong> · {copy.keys.serviceNames[key.provider]}
                </span>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => { void stopSharing(key.providerKeyId) }}
                  className="min-h-10 rounded-lg border border-slate-400 px-3 text-sm font-semibold underline disabled:opacity-50 dark:border-slate-600"
                >
                  {copy.settings.gatewayUnshare}
                </button>
              </li>
            ))}
          </ul>}
      </section>

      <section className="space-y-3 border-t border-slate-200 pt-4 dark:border-slate-800">
        <h3 className="font-semibold">{copy.settings.gatewayRouterKeys}</h3>
        <p className="text-sm text-slate-700 dark:text-slate-300">{copy.settings.gatewayMaxKeys}</p>
        <form onSubmit={(event) => { void createRouterKey(event) }} className="grid gap-3 sm:grid-cols-2">
          <label className="text-sm font-medium">
            {copy.settings.gatewayRouterKeyLabel}
            <input
              required
              maxLength={60}
              autoComplete="off"
              value={routerLabel}
              onChange={(event) => setRouterLabel(event.target.value)}
              placeholder={copy.settings.gatewayRouterKeyNamePlaceholder}
              className="mt-1 min-h-11 w-full rounded-lg border border-slate-400 bg-white px-3 text-base dark:border-slate-600 dark:bg-slate-950"
            />
          </label>
          <label className="text-sm font-medium">
            {copy.settings.gatewayRequestsPerMinute}
            <input
              type="number"
              min={1}
              max={60}
              value={requestsPerMinute}
              onChange={(event) => setRequestsPerMinute(Number(event.target.value))}
              className="mt-1 min-h-11 w-full rounded-lg border border-slate-400 bg-white px-3 text-base dark:border-slate-600 dark:bg-slate-950"
            />
          </label>
          <label className="text-sm font-medium">
            {copy.settings.gatewayRequestsPerDay}
            <input
              type="number"
              min={1}
              max={10_000}
              value={requestsPerDay}
              onChange={(event) => setRequestsPerDay(Number(event.target.value))}
              className="mt-1 min-h-11 w-full rounded-lg border border-slate-400 bg-white px-3 text-base dark:border-slate-600 dark:bg-slate-950"
            />
          </label>
          <button
            type="submit"
            disabled={busy || routerKeys.filter((key) => key.revokedAt === null).length >= 10}
            className="min-h-11 self-end rounded-lg bg-indigo-700 px-4 font-semibold text-white disabled:opacity-50"
          >
            {busy ? copy.secretPassword.working : copy.settings.gatewayCreateRouterKey}
          </button>
        </form>

        {isLoading && <p role="status" className="text-sm">{copy.settings.gatewayUsageLoading}</p>}
        {hasError && (
          <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-900 dark:bg-red-950 dark:text-red-100">
            {copy.settings.gatewayUsageError}
          </p>
        )}
        {routerKeys.length === 0
          ? <p className="text-sm text-slate-700 dark:text-slate-300">{copy.settings.gatewayNoRouterKeys}</p>
          : <ul className="divide-y divide-slate-200 rounded-xl border border-slate-200 dark:divide-slate-800 dark:border-slate-800">
            {routerKeys.map((key) => (
              <li key={key.id} className="flex flex-wrap items-start justify-between gap-3 p-3">
                <div className="min-w-0">
                  <p className="break-words font-semibold">{key.label}</p>
                  <p className="mt-1 text-sm text-slate-700 dark:text-slate-300">
                    {copy.settings.gatewayUsed}: {currentCount(usageRows, key.id, 'minute')}/{key.requestsPerMinute} per minute · {currentCount(usageRows, key.id, 'day')}/{key.requestsPerDay} per day
                  </p>
                  <p className="text-sm text-slate-700 dark:text-slate-300">
                    {copy.settings.gatewayLastUsed}: {key.lastUsedAt ? new Date(key.lastUsedAt).toLocaleString() : copy.settings.gatewayNeverUsed}
                  </p>
                </div>
                {key.revokedAt
                  ? <span className="rounded-full bg-slate-200 px-3 py-1 text-sm dark:bg-slate-800">{copy.settings.gatewayRevoked}</span>
                  : <button
                    type="button"
                    disabled={busy}
                    onClick={() => { void revokeRouterKey(key) }}
                    className="min-h-10 rounded-lg border border-red-700 px-3 text-sm font-semibold text-red-800 underline disabled:opacity-50 dark:text-red-200"
                  >
                    {copy.settings.gatewayRevoke}
                  </button>}
              </li>
            ))}
          </ul>}
      </section>

      <section className="space-y-2 border-t border-slate-200 pt-4 dark:border-slate-800">
        <h3 className="font-semibold">{copy.settings.gatewayIntegration}</h3>
        <p className="text-sm text-slate-700 dark:text-slate-300">{copy.settings.gatewayIntegrationHint}</p>
        {gatewayBaseUrl && <p className="break-all rounded-lg bg-slate-100 p-3 font-mono text-sm dark:bg-slate-950">{gatewayBaseUrl}</p>}
        <pre className="overflow-x-auto rounded-lg bg-slate-950 p-3 text-sm text-slate-100"><code>{integrationExample}</code></pre>
      </section>

      {actionError && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-900 dark:bg-red-950 dark:text-red-100">{actionError}</p>}
      {message && <p role="status" className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-900 dark:bg-emerald-950 dark:text-emerald-100">{message}</p>}

      {oneTimeKey && (
        <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-slate-950/70 p-4">
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="gateway-router-key-title"
            aria-describedby="gateway-router-key-warning"
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.preventDefault()
                dismissRouterKey()
                return
              }
              if (event.key !== 'Tab') return
              const focusable = event.currentTarget.querySelectorAll<HTMLElement>(
                'button:not(:disabled), input:not(:disabled)',
              )
              const first = focusable[0]
              const last = focusable[focusable.length - 1]
              if (!first || !last) return
              if (event.shiftKey && document.activeElement === first) {
                event.preventDefault()
                last.focus()
              } else if (!event.shiftKey && document.activeElement === last) {
                event.preventDefault()
                first.focus()
              }
            }}
            className="my-auto w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl dark:border-slate-700 dark:bg-slate-900 sm:p-6"
          >
            <h2 id="gateway-router-key-title" className="text-xl font-semibold">
              {copy.settings.gatewayRouterKeyCreated}
            </h2>
            <p
              id="gateway-router-key-warning"
              className="mt-3 rounded-lg border border-amber-400 bg-amber-50 p-3 text-sm font-medium text-amber-950 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100"
            >
              {copy.settings.gatewayRouterKeyOneTimeWarning}
            </p>
            <label className="mt-4 block text-sm font-medium">
              {oneTimeKey.label}
              <input
                ref={routerKeyInputRef}
                readOnly
                autoComplete="off"
                spellCheck={false}
                value={oneTimeKey.token}
                onFocus={(event) => event.currentTarget.select()}
                className="mt-1 min-h-11 w-full select-all rounded-lg border border-slate-400 bg-white px-3 font-mono text-sm dark:border-slate-600 dark:bg-slate-950"
              />
            </label>
            {keyCopied && (
              <p role="status" className="mt-2 text-sm text-emerald-800 dark:text-emerald-200">
                {copy.settings.gatewayRouterKeyCopied}
              </p>
            )}
            {keyCopyError && (
              <p role="alert" className="mt-2 text-sm text-red-800 dark:text-red-200">
                {keyCopyError}
              </p>
            )}
            <div className="mt-5 flex flex-wrap justify-end gap-2">
              <button
                type="button"
                onClick={() => { void copyRouterKey() }}
                className="min-h-11 rounded-lg border border-slate-400 px-4 font-semibold dark:border-slate-600"
              >
                {copy.settings.gatewayRouterKeyCopy}
              </button>
              <button
                type="button"
                disabled={testing || !gatewayBaseUrl}
                onClick={() => { void testGateway() }}
                className="min-h-11 rounded-lg bg-indigo-700 px-4 font-semibold text-white disabled:opacity-50"
              >
                {testing ? copy.secretPassword.working : copy.settings.gatewayTestRequest}
              </button>
              <button
                type="button"
                onClick={dismissRouterKey}
                className="min-h-11 rounded-lg bg-slate-200 px-4 font-semibold text-slate-950 dark:bg-slate-700 dark:text-white"
              >
                {copy.settings.gatewayRouterKeyDone}
              </button>
            </div>
          </section>
        </div>
      )}
    </section>
  )
}
