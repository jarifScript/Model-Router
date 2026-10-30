import { useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import AddKeyModal from '../components/providers/AddKeyModal'
import { PROVIDER_CONFIGS, isProviderId } from '../core/providers'
import { getTargetHealthKey } from '../core/health'
import type { ProviderErrorClass } from '../core/adapters/types'
import type { RouteTarget } from '../core/route-types'
import { copy } from '../lib/copy'
import { formatEstimatedMoney } from '../lib/pricing'
import useStats from '../hooks/useStats'
import { useVaultStore } from '../store/vault'
import { useUserSettings } from '../hooks/useUserSettings'
import { useRouteHealth } from '../store/route-health'

const BAR_HEIGHTS = ['h-1', 'h-1/4', 'h-2/5', 'h-1/2', 'h-3/5', 'h-3/4', 'h-4/5', 'h-full']

export default function DashboardPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const { isUnlocked, providerKeys } = useVaultStore()
  const { compareWithModel, showAdvancedFeatures } = useUserSettings()
  const [days, setDays] = useState<7 | 30>(7)
  const stats = useStats(days)
  const [addingKey, setAddingKey] = useState(false)
  const health = useRouteHealth((state) => state.health)
  const healthRevision = useRouteHealth((state) => state.revision)
  const hasSavedKey = isUnlocked && providerKeys.length > 0
  const hasActivity = (stats.data?.messagesSent ?? 0) > 0
  const needsOnboarding = !hasSavedKey
  const notice = typeof location.state === 'object' && location.state !== null
    && 'notice' in location.state && typeof location.state.notice === 'string'
    ? location.state.notice
    : null
  const starterServices = PROVIDER_CONFIGS.filter(({ id }) => (
    id === 'openrouter' || id === 'groq' || id === 'gemini'
  ))
  const healthSnapshot = health.snapshot()
  const attentionTargets = Object.entries(healthSnapshot.byTarget).flatMap(([identity, metrics]) => {
    if (!metrics.needsAttention) return []
    const firstSeparator = identity.indexOf(':')
    const secondSeparator = identity.indexOf(':', firstSeparator + 1)
    if (firstSeparator < 0 || secondSeparator < 0) return []
    const provider = identity.slice(0, firstSeparator)
    const keyId = identity.slice(firstSeparator + 1, secondSeparator)
    const model = identity.slice(secondSeparator + 1)
    const key = providerKeys.find((item) => item.id === keyId && item.provider === provider)
    if (!isProviderId(provider) || !key) return []
    return [{
      target: { provider, keyId, model } satisfies RouteTarget,
      reason: metrics.attentionReason,
    }]
  })
  void healthRevision

  function startAddingKey() {
    if (!isUnlocked) {
      navigate('/unlock', { state: { returnTo: '/dashboard' } })
      return
    }
    setAddingKey(true)
  }

  return (
    <section className="mx-auto max-w-6xl space-y-6">
      {notice && <p role="status" className="rounded-xl border border-indigo-200 bg-indigo-50 p-4 text-base text-indigo-950 dark:border-indigo-800 dark:bg-indigo-950 dark:text-indigo-100">{notice}</p>}
      {needsOnboarding ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900 sm:p-8">
          <h1 className="text-3xl font-bold text-slate-950 dark:text-white">{copy.home.title}</h1>
          <p className="mt-2 text-lg text-slate-700 dark:text-slate-200">{copy.home.subtitle}</p>
          <ol className="mt-7 space-y-6">
            <li className="rounded-xl bg-slate-50 p-4 dark:bg-slate-950">
              <h2 className="flex items-center gap-2 text-xl font-semibold"><StepMarker checked={false} /><span className="text-base font-medium text-slate-700 dark:text-slate-300">{copy.home.chooseAiStep}</span>{copy.home.getKey}</h2>
              <p className="mt-1 text-base text-slate-700 dark:text-slate-300">{copy.home.getKeyHelp}</p>
              <ul className="mt-3 grid gap-3 sm:grid-cols-3">
                {starterServices.map((service) => (
                  <li key={service.id} className="rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900">
                    <a href={service.keyHelpUrl} target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center font-semibold text-indigo-800 underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-600 dark:text-indigo-300">
                      {copy.keys.serviceNames[service.id]}
                    </a>
                    <p className="mt-1 text-base text-slate-700 dark:text-slate-300">{copy.home.getKeyHelpByService[service.id]}</p>
                  </li>
                ))}
              </ul>
            </li>
            <li className="rounded-xl bg-slate-50 p-4 dark:bg-slate-950">
              <h2 className="flex items-center gap-2 text-xl font-semibold"><StepMarker checked={false} /><span className="text-base font-medium text-slate-700 dark:text-slate-300">{copy.home.addKeyStep}</span>{copy.home.pasteKey}</h2>
              <p className="mt-1 text-base text-slate-700 dark:text-slate-300">{copy.home.pasteKeyHelp}</p>
              <button type="button" onClick={startAddingKey} className="mt-3 min-h-12 rounded-xl bg-indigo-700 px-5 text-base font-semibold text-white hover:bg-indigo-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-700">
                {copy.home.addFirstKey}
              </button>
            </li>
            <li className="rounded-xl bg-slate-50 p-4 dark:bg-slate-950">
              <h2 className="flex items-center gap-2 text-xl font-semibold"><StepMarker checked={false} /><span className="text-base font-medium text-slate-700 dark:text-slate-300">{copy.home.chatStep}</span>{copy.home.sayHi}</h2>
              <p className="mt-1 text-base text-slate-700 dark:text-slate-300">{copy.home.sayHiHelp}</p>
              <Link to="/playground" className="mt-3 inline-flex min-h-12 items-center rounded-xl border border-slate-400 px-5 text-base font-semibold text-slate-900 hover:bg-slate-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-600 dark:border-slate-600 dark:text-white dark:hover:bg-slate-800">
                {copy.nav.chat}
              </Link>
            </li>
          </ol>
        </div>
      ) : (
        <>
          <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h1 className="text-3xl font-bold text-slate-950 dark:text-white">{copy.home.title}</h1>
              <p className="mt-1 text-base text-slate-700 dark:text-slate-300">{copy.home.setupDone}</p>
            </div>
            <label className="block w-full sm:w-52">
              <span className="text-sm font-semibold">{copy.home.dateRange}</span>
              <select value={days} onChange={(event) => setDays(Number(event.target.value) === 30 ? 30 : 7)} className="mt-1 min-h-11 w-full rounded-lg border border-slate-400 bg-white px-3 text-base focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-700 dark:border-slate-600 dark:bg-slate-950">
                <option value={7}>{copy.home.last7Days}</option>
                <option value={30}>{copy.home.last30Days}</option>
              </select>
            </label>
          </header>

          {stats.isError && (
            <div role="alert" className="rounded-xl bg-red-50 p-4 text-base text-red-950 dark:bg-red-950 dark:text-red-100">
              <p>{copy.home.statsError}</p>
              <button type="button" onClick={() => { void stats.refetch() }} className="mt-2 min-h-11 font-semibold underline">{copy.app.retry}</button>
            </div>
          )}

          {stats.isLoading && <p role="status" className="text-base">{copy.app.loading}</p>}

          {!stats.isLoading && !stats.isError && !hasActivity && (
            <div className="rounded-2xl border border-dashed border-indigo-400 bg-indigo-50 p-8 text-center dark:border-indigo-800 dark:bg-indigo-950">
              <h2 className="text-2xl font-bold text-slate-950 dark:text-white">{copy.home.noActivityTitle}</h2>
              <p className="mx-auto mt-2 max-w-xl text-base text-slate-700 dark:text-slate-200">{copy.home.noActivityText}</p>
              <Link to="/playground" className="mt-5 inline-flex min-h-12 items-center rounded-xl bg-indigo-700 px-6 text-base font-bold text-white hover:bg-indigo-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-700">{copy.nav.chat}</Link>
            </div>
          )}

          {hasActivity && (
            <>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                <StatCard title={copy.home.messagesSent} value={stats.data?.messagesSent.toLocaleString() ?? '0'} />
                <StatCard title={copy.home.workedPercent} value={`${stats.data?.workedPercent ?? 0}%`} />
                {compareWithModel
                  ? <StatCard title={copy.home.moneySaved} value={stats.data?.estimatedSaved === null || stats.data?.estimatedSaved === undefined
                    ? copy.app.unknown
                    : formatEstimatedMoney(stats.data.estimatedSaved)} />
                  : <Link to="/settings" className="flex min-h-32 flex-col justify-center rounded-xl border border-dashed border-indigo-400 p-5 text-base font-semibold text-indigo-900 underline dark:text-indigo-200">{copy.home.setThisUp}</Link>}
              </div>

              {showAdvancedFeatures && stats.data && (
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  <StatCard title={copy.home.gatewayRequests} value={stats.data.gatewayRequests.toLocaleString()} />
                  <StatCard title={copy.home.averageSpeed} value={stats.data.averageSpeedMs === null
                    ? copy.app.unknown
                    : copy.home.speedValue.replace('{count}', Math.round(stats.data.averageSpeedMs).toLocaleString())} />
                  <StatCard title={copy.home.backupsUsed} value={stats.data.fallbacks.toLocaleString()} />
                  <StatCard title={copy.home.wordsUsed} value={stats.data.inputTokens === null || stats.data.outputTokens === null
                    ? copy.app.unknown
                    : `~${Math.round((stats.data.inputTokens + stats.data.outputTokens) * 0.75).toLocaleString()}`} />
                  <DailyChart days={stats.data.daily} />
                  <ServiceTable services={stats.data.byService} />
                </div>
              )}
            </>
          )}

          <AttentionBox targets={attentionTargets} />
        </>
      )}
      {addingKey && <AddKeyModal isOpen initialProvider="openrouter" onClose={() => setAddingKey(false)} />}
    </section>
  )
}

function StepMarker({ checked }: { checked: boolean }) {
  return (
    <>
      <span aria-hidden="true" className={`text-2xl font-bold ${checked ? 'text-emerald-800 dark:text-emerald-300' : 'text-slate-500 dark:text-slate-400'}`}>{checked ? '✓' : '□'}</span>
      <span className="sr-only">{checked ? copy.home.done : copy.home.notDone}</span>
    </>
  )
}

function StatCard({ title, value }: { title: string; value: string }) {
  return (
    <article className="min-h-32 rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
      <h2 className="text-base font-medium text-slate-700 dark:text-slate-300">{title}</h2>
      <p className="mt-3 break-words text-2xl font-bold text-slate-950 dark:text-white sm:text-3xl">{value}</p>
    </article>
  )
}

function DailyChart({ days }: { days: { day: string; requests: number }[] }) {
  const maxRequests = Math.max(1, ...days.map(({ requests }) => requests))
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900 sm:col-span-2">
      <h2 className="text-base font-semibold">{copy.home.dailyMessages}</h2>
      <div className="mt-4 grid grid-cols-7 gap-2 sm:grid-cols-10 lg:grid-cols-[repeat(15,minmax(0,1fr))]">
        {days.map(({ day, requests }) => {
          const ratio = requests / maxRequests
          const heightIndex = requests === 0 ? 0 : Math.min(BAR_HEIGHTS.length - 1, Math.ceil(ratio * (BAR_HEIGHTS.length - 1)))
          return (
            <div key={day} className="flex min-w-0 flex-col items-center gap-2" title={`${day}: ${requests} ${copy.home.messages.toLowerCase()}`}>
              <div role="img" aria-label={`${day}: ${requests} ${copy.home.messages.toLowerCase()}`} className="flex h-24 w-full items-end rounded bg-slate-100 px-1 dark:bg-slate-800">
                <div aria-hidden="true" className={`w-full rounded-t bg-indigo-600 ${BAR_HEIGHTS[heightIndex]}`} />
              </div>
              <span className="text-xs text-slate-600 dark:text-slate-300">{new Date(`${day}T12:00:00Z`).toLocaleDateString(undefined, { month: 'numeric', day: 'numeric', timeZone: 'UTC' })}</span>
            </div>
          )
        })}
      </div>
    </section>
  )
}

function ServiceTable({ services }: { services: { provider: string; requests: number; successes: number; fallbacks: number }[] }) {
  return (
    <section className="overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
      <h2 className="p-5 text-base font-semibold">{copy.home.byAiService}</h2>
      {services.length === 0 ? (
        <p className="px-5 pb-5 text-sm text-slate-700 dark:text-slate-300">{copy.home.noActivityText}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[28rem] text-left text-sm">
            <thead className="bg-slate-100 dark:bg-slate-800"><tr>
              <th className="p-3">{copy.history.service}</th>
              <th className="p-3">{copy.home.messages}</th>
              <th className="p-3">{copy.home.workedPercent}</th>
              <th className="p-3">{copy.history.backups}</th>
            </tr></thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
              {services.map((service) => (
                <tr key={service.provider}>
                  <td className="p-3">{isProviderId(service.provider) ? copy.keys.serviceNames[service.provider] : service.provider}</td>
                  <td className="p-3">{service.requests.toLocaleString()}</td>
                  <td className="p-3">{service.requests ? `${Math.round(service.successes / service.requests * 100)}%` : '0%'}</td>
                  <td className="p-3">{service.fallbacks.toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

function AttentionBox({ targets }: { targets: { target: RouteTarget; reason: Extract<ProviderErrorClass, 'auth' | 'quota' | 'model_not_found'> | undefined }[] }) {
  return (
    <section className="rounded-xl border border-amber-300 bg-amber-50 p-5 dark:border-amber-900 dark:bg-amber-950">
      <h2 className="text-lg font-semibold text-amber-950 dark:text-amber-100">{copy.home.attentionTitle}</h2>
      {targets.length === 0 ? (
        <p className="mt-2 text-sm text-amber-950 dark:text-amber-100">{copy.home.attentionEmpty}</p>
      ) : (
        <ul className="mt-3 space-y-2">
          {targets.map(({ target, reason }) => (
            <li key={getTargetHealthKey(target)} className="break-words text-sm text-amber-950 dark:text-amber-100">
              <strong>{copy.keys.serviceNames[target.provider]} · {target.model}</strong>
              <span>: {reason ? copy.errors[reason] : copy.home.attentionHelp}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
