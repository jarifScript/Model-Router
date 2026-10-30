import { useEffect, useState, type FormEvent } from 'react'
import type { RoutingRule, RouteStrategy, RouteTarget } from '../../core/route-types'
import type { DecryptedProviderKey } from '../../types'
import { getTargetHealthKey, type HealthSnapshot } from '../../core/health'
import TargetRow from './TargetRow'
import { getCheapestKnownModel } from '../../lib/modelCatalog'
import { copy } from '../../lib/copy'

const STRATEGIES: Array<{ value: RouteStrategy; label: string }> = [
  { value: 'priority', label: copy.backupPlans.priority },
  { value: 'round_robin', label: copy.backupPlans.roundRobin },
  { value: 'weighted', label: copy.backupPlans.weighted },
  { value: 'lowest_latency', label: copy.backupPlans.lowestLatency },
  { value: 'lowest_cost', label: copy.backupPlans.lowestCost },
]

const EMPTY_ROUTE: RoutingRule = {
  alias: '',
  strategy: 'priority',
  timeoutMs: 30_000,
  maxAttempts: 4,
  targets: [],
}

type RouteEditorProps = {
  route: RoutingRule | null
  keys: DecryptedProviderKey[]
  health: HealthSnapshot
  onSave: (route: RoutingRule) => Promise<void>
}

export default function RouteEditor({ route, keys, health, onSave }: RouteEditorProps) {
  const [draft, setDraft] = useState<RoutingRule>(route ?? EMPTY_ROUTE)
  const [error, setError] = useState<string | null>(null)
  const [templateNotice, setTemplateNotice] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const [dragIndex, setDragIndex] = useState<number | null>(null)

  useEffect(() => {
    setDraft(route ?? EMPTY_ROUTE)
    setError(null)
    setTemplateNotice(null)
  }, [route])

  function updateTarget(index: number, target: RouteTarget) {
    setDraft((current) => ({
      ...current,
      targets: current.targets.map((item, itemIndex) => itemIndex === index ? target : item),
    }))
  }

  function moveTarget(toIndex: number) {
    if (dragIndex === null || dragIndex === toIndex) return
    setDraft((current) => {
      const targets = [...current.targets]
      const [moved] = targets.splice(dragIndex, 1)
      targets.splice(toIndex, 0, moved)
      return { ...current, targets }
    })
    setDragIndex(null)
  }

  function validate(candidate: RoutingRule): string | null {
    if (!candidate.alias.trim()) return copy.backupPlans.errors.name
    if (!candidate.targets.length) return copy.backupPlans.errors.noTargets
    if (candidate.targets.some((target) => !target.model.trim())) return copy.backupPlans.errors.model
    if (candidate.targets.some((target) => !keys.some((key) => key.id === target.keyId && key.provider === target.provider))) {
      return copy.backupPlans.errors.key
    }
    if (candidate.timeoutMs < 1000 || candidate.timeoutMs > 120_000) return copy.backupPlans.errors.timeout
    if (candidate.maxAttempts < 1 || candidate.maxAttempts > 20) return copy.backupPlans.errors.attempts
    return null
  }

  async function save(candidate: RoutingRule) {
    const validationError = validate(candidate)
    setError(validationError)
    setTemplateNotice(null)
    if (validationError) return
    setIsSaving(true)
    try {
      await onSave(candidate)
    } catch {
      setError(copy.backupPlans.notFound)
    } finally {
      setIsSaving(false)
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    void save(draft)
  }

  function applyTemplate(strategy: RouteStrategy, alias: string) {
    let pricedTargetCount = 0
    const targets = strategy === 'lowest_cost'
      ? draft.targets.map((target) => {
        const cheapest = getCheapestKnownModel(target.provider, target.keyId)
        if (cheapest) pricedTargetCount += 1
        return cheapest ? { ...target, model: cheapest.id } : target
      })
      : draft.targets
    setDraft({ ...draft, strategy, alias, targets })
    setError(null)
    setTemplateNotice(strategy === 'lowest_cost' && draft.targets.length > 0 && pricedTargetCount === 0
      ? copy.backupPlans.errors.priceUnavailable
      : copy.backupPlans.errors.savedTemplate)
  }

  function addTarget() {
    const firstKey = keys[0]
    if (!firstKey) {
      setError(copy.backupPlans.errors.noKey)
      return
    }
    setError(null)
    setDraft((current) => ({
      ...current,
      targets: [...current.targets, { provider: firstKey.provider, model: '', keyId: firstKey.id, weight: 1 }],
    }))
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5 rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xl font-semibold text-slate-950 dark:text-white">{draft.id ? copy.backupPlans.edit : copy.backupPlans.create}</h2>
        <div className="flex flex-wrap gap-2">
          {[
            { strategy: 'lowest_cost' as const, alias: copy.backupPlans.templates.cheapest },
            { strategy: 'lowest_latency' as const, alias: copy.backupPlans.templates.fastest },
            { strategy: 'priority' as const, alias: copy.backupPlans.templates.best },
          ].map((template) => (
            <button key={template.alias} type="button" disabled={isSaving} onClick={() => applyTemplate(template.strategy, template.alias)} className="min-h-11 rounded-md border border-indigo-300 px-3 text-base font-medium text-indigo-900 hover:bg-indigo-50 disabled:opacity-50 dark:border-indigo-800 dark:text-indigo-200 dark:hover:bg-indigo-950">
              {template.alias}
            </button>
          ))}
        </div>
      </div>
      {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-base text-red-950 dark:bg-red-950 dark:text-red-100">{error}</p>}
      {templateNotice && <p role="status" className="rounded-lg bg-indigo-50 p-3 text-base text-indigo-950 dark:bg-indigo-950 dark:text-indigo-100">{templateNotice}</p>}
      {keys.length === 0 && <p className="rounded-lg bg-amber-50 p-3 text-base text-amber-950 dark:bg-amber-950 dark:text-amber-100">{copy.backupPlans.errors.noKey}</p>}
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="text-base text-slate-800 dark:text-slate-200">
          {copy.backupPlans.name}
          <input required maxLength={80} value={draft.alias} onChange={(event) => setDraft({ ...draft, alias: event.target.value })} className="mt-1 min-h-11 block w-full rounded-lg border border-slate-400 bg-white px-3 py-2 text-base text-slate-950 dark:border-slate-600 dark:bg-slate-950 dark:text-white" placeholder={copy.backupPlans.namePlaceholder} />
        </label>
        <label className="text-base text-slate-800 dark:text-slate-200">
          {copy.backupPlans.howToChoose}
          <select value={draft.strategy} onChange={(event) => {
            const strategy = STRATEGIES.find((item) => item.value === event.target.value)?.value
            if (strategy) setDraft({ ...draft, strategy })
          }} className="mt-1 min-h-11 block w-full rounded-lg border border-slate-400 bg-white px-3 py-2 text-base dark:border-slate-600 dark:bg-slate-950">
            {STRATEGIES.map((strategy) => <option key={strategy.value} value={strategy.value}>{strategy.label}</option>)}
          </select>
        </label>
        <label className="text-base text-slate-800 dark:text-slate-200">
          {copy.backupPlans.giveUpAfter}
          <input type="number" min={1} max={120} step={1} required value={draft.timeoutMs / 1000} onChange={(event) => setDraft({ ...draft, timeoutMs: Number(event.target.value) * 1000 })} className="mt-1 min-h-11 block w-full rounded-lg border border-slate-400 bg-white px-3 py-2 text-base dark:border-slate-600 dark:bg-slate-950" />
        </label>
        <label className="text-base text-slate-800 dark:text-slate-200">
          {copy.backupPlans.maxAttempts}
          <input type="number" min={1} max={20} required value={draft.maxAttempts} onChange={(event) => setDraft({ ...draft, maxAttempts: Number(event.target.value) })} className="mt-1 min-h-11 block w-full rounded-lg border border-slate-400 bg-white px-3 py-2 text-base dark:border-slate-600 dark:bg-slate-950" />
        </label>
      </div>
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold text-slate-950 dark:text-white">{copy.backupPlans.addTarget}</h3>
          <button type="button" onClick={addTarget} disabled={!keys.length || isSaving} className="min-h-11 rounded-lg border border-slate-400 px-4 text-base font-medium text-slate-900 disabled:opacity-50 dark:border-slate-600 dark:text-white">{copy.backupPlans.addTarget}</button>
        </div>
        {draft.targets.map((target, index) => (
          <TargetRow
            key={`${target.keyId}-${index}`}
            target={target}
            index={index}
            keys={keys}
            needsAttention={Boolean(health.byTarget[getTargetHealthKey(target)]?.needsAttention)}
            onChange={(updated) => updateTarget(index, updated)}
            onRemove={() => setDraft((current) => ({ ...current, targets: current.targets.filter((_, itemIndex) => itemIndex !== index) }))}
            onDragStart={setDragIndex}
            onDrop={moveTarget}
          />
        ))}
        {!draft.targets.length && <p className="rounded-lg border border-dashed border-slate-400 p-4 text-base text-slate-700 dark:border-slate-600 dark:text-slate-300">{copy.backupPlans.targetLabels.noTargets}</p>}
      </div>
      <div className="flex justify-end">
        <button type="submit" disabled={isSaving} className="min-h-12 rounded-lg bg-indigo-700 px-5 text-base font-semibold text-white hover:bg-indigo-800 disabled:opacity-50">{isSaving ? copy.app.loading : copy.backupPlans.save}</button>
      </div>
    </form>
  )
}
