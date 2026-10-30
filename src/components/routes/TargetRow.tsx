import type { RouteTarget } from '../../core/route-types'
import { isProviderId } from '../../core/providers'
import type { DecryptedProviderKey } from '../../types'
import ModelPicker from '../models/ModelPicker'
import { copy } from '../../lib/copy'
import InfoTooltip from '../ui/InfoTooltip'

type TargetRowProps = {
  target: RouteTarget
  index: number
  keys: DecryptedProviderKey[]
  needsAttention: boolean
  onChange: (target: RouteTarget) => void
  onRemove: () => void
  onDragStart: (index: number) => void
  onDrop: (index: number) => void
}

export default function TargetRow({
  target,
  index,
  keys,
  needsAttention,
  onChange,
  onRemove,
  onDragStart,
  onDrop,
}: TargetRowProps) {
  const providerIds = [...new Set(keys.map((key) => key.provider))]
  const providerKeys = keys.filter((key) => key.provider === target.provider)

  return (
    <div
      draggable
      onDragStart={() => onDragStart(index)}
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        event.preventDefault()
        onDrop(index)
      }}
      className="grid gap-3 rounded-lg border border-slate-300 bg-slate-50 p-3 text-base dark:border-slate-700 dark:bg-slate-950 sm:grid-cols-[1fr_1.2fr_1fr_0.55fr_auto]"
    >
      <label className="text-base text-slate-800 dark:text-slate-200">
        {copy.backupPlans.targetLabels.service}
        <select
          aria-label={`${copy.backupPlans.targetNumber.replace('{number}', String(index + 1))}: ${copy.backupPlans.targetLabels.service}`}
          value={target.provider}
          onChange={(event) => {
            const provider = event.target.value
            if (!isProviderId(provider)) return
            const firstKey = keys.find((key) => key.provider === provider)
            if (firstKey) onChange({ ...target, provider, keyId: firstKey.id })
          }}
          className="mt-1 min-h-11 block w-full rounded-md border border-slate-400 bg-white px-2 py-2 text-base dark:border-slate-600 dark:bg-slate-900"
        >
          {providerIds.map((id) => (
            <option key={id} value={id}>{copy.keys.serviceNames[id]}</option>
          ))}
        </select>
      </label>
      <div className="text-base text-slate-800 dark:text-slate-200">
        {copy.backupPlans.targetLabels.model}<InfoTooltip topic={copy.backupPlans.targetLabels.model} explanation={copy.models.modelTooltip} />
        <ModelPicker
          ariaLabel={`${copy.backupPlans.targetNumber.replace('{number}', String(index + 1))}: ${copy.backupPlans.targetLabels.model}`}
          providerId={target.provider}
          keyId={target.keyId}
          value={target.model}
          onChange={(model) => onChange({ ...target, model })}
          placeholder={copy.backupPlans.targetLabels.modelPlaceholder}
        />
      </div>
      <label className="text-base text-slate-800 dark:text-slate-200">
        {copy.backupPlans.targetLabels.key}
        <select
          aria-label={`${copy.backupPlans.targetNumber.replace('{number}', String(index + 1))}: ${copy.backupPlans.targetLabels.key}`}
          value={target.keyId}
          onChange={(event) => onChange({ ...target, keyId: event.target.value })}
          className="mt-1 min-h-11 block w-full rounded-md border border-slate-400 bg-white px-2 py-2 text-base dark:border-slate-600 dark:bg-slate-900"
        >
          {providerKeys.map((key) => <option key={key.id} value={key.id}>{key.label}</option>)}
        </select>
      </label>
      <label className="text-base text-slate-800 dark:text-slate-200">
        {copy.backupPlans.targetLabels.weight}
        <input
          aria-label={`${copy.backupPlans.targetNumber.replace('{number}', String(index + 1))}: ${copy.backupPlans.targetLabels.weight}`}
          type="number"
          min={1}
          max={100}
          value={target.weight ?? 1}
          onChange={(event) => onChange({ ...target, weight: Math.min(100, Math.max(1, Number(event.target.value) || 1)) })}
          className="mt-1 min-h-11 block w-full rounded-md border border-slate-400 bg-white px-2 py-2 text-base dark:border-slate-600 dark:bg-slate-900"
        />
      </label>
      <div className="flex items-end justify-between gap-2 sm:flex-col sm:items-end sm:justify-center">
        {needsAttention && <span className="rounded-full bg-amber-100 px-2 py-1 text-sm font-medium text-amber-950 dark:bg-amber-950 dark:text-amber-100">{copy.backupPlans.targetLabels.needsAttention}</span>}
        <button type="button" onClick={onRemove} className="min-h-11 px-3 text-base font-medium text-red-700 hover:text-red-800 dark:text-red-300">{copy.backupPlans.targetLabels.remove}</button>
      </div>
    </div>
  )
}
