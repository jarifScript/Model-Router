import { useEffect, useState, type FormEvent } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { isProviderId, PROVIDER_CONFIGS, type ProviderId } from '../core/providers'
import { copy } from '../lib/copy'
import { getPriceOverrideKey, type PriceOverrides } from '../lib/pricing'
import { flushRequestLogs } from '../lib/requestLogger'
import { useUserSettings } from '../hooks/useUserSettings'
import { supabase } from '../lib/supabase'
import useAuth from '../hooks/useAuth'
import SecuritySettings from '../components/settings/SecuritySettings'
import GatewaySettings from '../components/settings/GatewaySettings'

type PriceDraft = {
  id: string
  provider: ProviderId
  model: string
  inputPrice: string
  outputPrice: string
}

const SETTINGS_VALIDATION_MESSAGES: string[] = [
  copy.settings.priceNeedsModel,
  copy.settings.priceMustBeNumber,
  copy.settings.duplicatePrice,
  copy.settings.compareNeedsPair,
]

function priceDrafts(overrides: PriceOverrides): PriceDraft[] {
  return Object.entries(overrides).flatMap(([key, price]) => {
    const separator = key.indexOf(':')
    if (separator < 0) return []
    const provider = key.slice(0, separator)
    if (!isProviderId(provider)) return []
    return [{
      id: key,
      provider,
      model: key.slice(separator + 1),
      inputPrice: String(price.inputPricePerM),
      outputPrice: String(price.outputPricePerM),
    }]
  })
}

function buildPriceOverrides(rows: PriceDraft[]): PriceOverrides {
  const overrides: PriceOverrides = {}
  for (const row of rows) {
    const model = row.model.trim()
    if (!model && !row.inputPrice && !row.outputPrice) continue
    if (!model) throw new Error(copy.settings.priceNeedsModel)
    const inputPricePerM = Number(row.inputPrice)
    const outputPricePerM = Number(row.outputPrice)
    if (!row.inputPrice || !row.outputPrice
      || !Number.isFinite(inputPricePerM) || inputPricePerM < 0
      || !Number.isFinite(outputPricePerM) || outputPricePerM < 0) {
      throw new Error(copy.settings.priceMustBeNumber)
    }
    const key = getPriceOverrideKey(row.provider, model)
    if (Object.hasOwn(overrides, key)) throw new Error(copy.settings.duplicatePrice)
    overrides[key] = { inputPricePerM, outputPricePerM }
  }
  return overrides
}

export default function SettingsPage() {
  const {
    showAdvancedFeatures,
    baselineProvider,
    baselineModel,
    priceOverrides,
    isSettingsLoading,
    settingsError,
    updateSettings,
  } = useUserSettings()
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const [advanced, setAdvanced] = useState(showAdvancedFeatures)
  const [compareProvider, setCompareProvider] = useState<ProviderId | ''>(baselineProvider ?? '')
  const [compareModel, setCompareModel] = useState(baselineModel)
  const [overrideRows, setOverrideRows] = useState<PriceDraft[]>(() => priceDrafts(priceOverrides))
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)

  useEffect(() => {
    setAdvanced(showAdvancedFeatures)
    setCompareProvider(baselineProvider ?? '')
    setCompareModel(baselineModel)
    setOverrideRows(priceDrafts(priceOverrides))
  }, [showAdvancedFeatures, baselineProvider, baselineModel, priceOverrides])

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSaving(true)
    setError('')
    setMessage('')
    try {
      const trimmedModel = compareModel.trim()
      if ((!compareProvider && trimmedModel) || (compareProvider && !trimmedModel)) {
        throw new Error(copy.settings.compareNeedsPair)
      }
      await updateSettings({
        showAdvancedFeatures: advanced,
        baselineProvider: compareProvider || null,
        baselineModel: trimmedModel || null,
        priceOverrides: buildPriceOverrides(overrideRows),
      })
      setMessage(copy.app.saved)
    } catch (caughtError) {
      setError(caughtError instanceof Error
        && SETTINGS_VALIDATION_MESSAGES.includes(caughtError.message)
        ? caughtError.message
        : copy.errors.unknown)
    } finally {
      setSaving(false)
    }
  }

  async function deleteActivity() {
    if (!window.confirm(copy.settings.deleteConfirm)) return
    if (!supabase || !user) {
      setError(copy.settings.deleteError)
      return
    }
    setDeleting(true)
    setError('')
    setMessage('')
    try {
      await flushRequestLogs()
      const { error: deleteError } = await supabase.rpc('delete_my_activity')
      if (deleteError) throw deleteError
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['home-stats', user.id] }),
        queryClient.invalidateQueries({ queryKey: ['history', user.id] }),
      ])
      setMessage(copy.settings.deleteSuccess)
    } catch {
      setError(copy.settings.deleteError)
    } finally {
      setDeleting(false)
    }
  }

  function updatePriceRow(id: string, updates: Partial<Omit<PriceDraft, 'id'>>) {
    setOverrideRows((current) => current.map((row) => row.id === id ? { ...row, ...updates } : row))
  }

  return (
    <section className="mx-auto max-w-3xl space-y-5">
      <header>
        <h1 className="text-3xl font-bold">{copy.settings.title}</h1>
      </header>
      <SecuritySettings />
      <GatewaySettings />
      <form onSubmit={(event) => { void save(event) }} className="space-y-6 rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900 sm:p-6">
        <label className="flex min-h-12 items-center justify-between gap-4 text-lg font-semibold">
          <span>{copy.settings.advanced}<span className="mt-1 block text-base font-normal text-slate-700 dark:text-slate-300">{copy.settings.advancedHint}</span></span>
          <input type="checkbox" checked={advanced} onChange={(event) => setAdvanced(event.target.checked)} className="size-6 accent-indigo-700" />
        </label>

        <div className="grid gap-4 border-t border-slate-200 pt-5 dark:border-slate-800 sm:grid-cols-2">
          <label className="block text-base font-medium">
            {copy.settings.compareService}
            <select value={compareProvider} onChange={(event) => {
              const provider = event.target.value as ProviderId | ''
              setCompareProvider(provider)
              if (!provider) setCompareModel('')
            }} className="mt-1 min-h-12 w-full rounded-lg border border-slate-400 bg-white px-3 text-base dark:border-slate-600 dark:bg-slate-950">
              <option value="">{copy.settings.noCompare}</option>
              {PROVIDER_CONFIGS.map(({ id }) => <option key={id} value={id}>{copy.keys.serviceNames[id]}</option>)}
            </select>
          </label>
          <label className="block text-base font-medium">
            {copy.settings.compareModel}
            <input value={compareModel} onChange={(event) => setCompareModel(event.target.value)} maxLength={180} placeholder={copy.models.modelCode} disabled={!compareProvider} className="mt-1 min-h-12 w-full rounded-lg border border-slate-400 bg-white px-3 text-base disabled:opacity-60 dark:border-slate-600 dark:bg-slate-950" />
          </label>
          <p className="text-sm text-slate-700 dark:text-slate-300 sm:col-span-2">{copy.settings.compareHint}</p>
        </div>

        <section className="border-t border-slate-200 pt-5 dark:border-slate-800">
          <h2 className="text-lg font-semibold">{copy.settings.manualPrices}</h2>
          <p className="mt-1 text-sm text-slate-700 dark:text-slate-300">{copy.settings.manualPriceHint}</p>
          <div className="mt-4 overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-700">
            <table className="w-full min-w-[48rem] text-left text-sm">
              <thead className="bg-slate-100 dark:bg-slate-800"><tr>
                <th scope="col" className="p-3">{copy.history.service}</th>
                <th scope="col" className="p-3">{copy.settings.compareModel}</th>
                <th scope="col" className="p-3">{copy.settings.inputPrice}</th>
                <th scope="col" className="p-3">{copy.settings.outputPrice}</th>
                <th scope="col" className="p-3"><span className="sr-only">{copy.settings.removePrice}</span></th>
              </tr></thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                {overrideRows.map((row, index) => (
                  <tr key={row.id}>
                    <td className="p-2">
                      <select aria-label={`${copy.history.service} ${index + 1}`} value={row.provider} onChange={(event) => updatePriceRow(row.id, { provider: event.target.value as ProviderId })} className="min-h-11 w-full rounded-lg border border-slate-400 bg-white px-2 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-700 dark:border-slate-600 dark:bg-slate-950">
                        {PROVIDER_CONFIGS.map(({ id }) => <option key={id} value={id}>{copy.keys.serviceNames[id]}</option>)}
                      </select>
                    </td>
                    <td className="p-2">
                      <input aria-label={`${copy.settings.compareModel} ${index + 1}`} value={row.model} onChange={(event) => updatePriceRow(row.id, { model: event.target.value })} maxLength={180} className="min-h-11 w-full rounded-lg border border-slate-400 bg-white px-2 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-700 dark:border-slate-600 dark:bg-slate-950" />
                    </td>
                    <td className="p-2">
                      <input aria-label={`${copy.settings.inputPrice} ${index + 1}`} type="number" min="0" step="any" value={row.inputPrice} onChange={(event) => updatePriceRow(row.id, { inputPrice: event.target.value })} className="min-h-11 w-28 rounded-lg border border-slate-400 bg-white px-2 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-700 dark:border-slate-600 dark:bg-slate-950" />
                    </td>
                    <td className="p-2">
                      <input aria-label={`${copy.settings.outputPrice} ${index + 1}`} type="number" min="0" step="any" value={row.outputPrice} onChange={(event) => updatePriceRow(row.id, { outputPrice: event.target.value })} className="min-h-11 w-28 rounded-lg border border-slate-400 bg-white px-2 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-700 dark:border-slate-600 dark:bg-slate-950" />
                    </td>
                    <td className="p-2">
                      <button type="button" aria-label={`${copy.settings.removePrice} ${index + 1}`} onClick={() => setOverrideRows((current) => current.filter((entry) => entry.id !== row.id))} className="min-h-10 whitespace-nowrap text-sm font-semibold text-red-800 underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-red-700 dark:text-red-300">{copy.settings.removePrice}</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button type="button" onClick={() => setOverrideRows((current) => [...current, {
            id: crypto.randomUUID(),
            provider: 'openrouter',
            model: '',
            inputPrice: '',
            outputPrice: '',
          }])} className="mt-3 min-h-11 rounded-lg border border-slate-400 px-4 text-sm font-semibold dark:border-slate-600">{copy.settings.addPrice}</button>
        </section>

        {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-base text-red-900 dark:bg-red-950 dark:text-red-100">{error}</p>}
        {settingsError && <p role="alert" className="rounded-lg bg-red-50 p-3 text-base text-red-900 dark:bg-red-950 dark:text-red-100">{copy.settings.loadError}</p>}
        {message && <p role="status" className="rounded-lg bg-emerald-50 p-3 text-base text-emerald-900 dark:bg-emerald-950 dark:text-emerald-100">{message}</p>}
        <button type="submit" disabled={saving || isSettingsLoading || Boolean(settingsError)} className="min-h-12 rounded-xl bg-indigo-700 px-5 text-base font-semibold text-white hover:bg-indigo-800 disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-700">
          {saving ? copy.app.loading : copy.settings.save}
        </button>
      </form>

      <section className="rounded-2xl border border-red-200 bg-white p-5 dark:border-red-900 dark:bg-slate-900 sm:p-6">
        <h2 className="text-lg font-semibold">{copy.settings.deleteActivity}</h2>
        <p className="mt-1 text-sm text-slate-700 dark:text-slate-300">{copy.settings.deleteActivityHint}</p>
        <button type="button" disabled={deleting} onClick={() => { void deleteActivity() }} className="mt-4 min-h-11 rounded-lg border border-red-700 px-4 text-sm font-semibold text-red-800 disabled:opacity-60 dark:border-red-500 dark:text-red-300">
          {deleting ? copy.app.loading : copy.settings.deleteActivity}
        </button>
      </section>
    </section>
  )
}
