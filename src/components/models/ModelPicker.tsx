import { useEffect, useId, useMemo, useState, type KeyboardEvent } from 'react'
import type { ProviderId } from '../../core/providers'
import type { ModelInfo } from '../../core/models'
import { filterFreeModels } from '../../core/models'
import { useModels } from '../../lib/modelCatalog'
import { copy } from '../../lib/copy'

type ModelSort = 'name' | 'context' | 'price'

function isModelSort(value: string): value is ModelSort {
  return value === 'name' || value === 'context' || value === 'price'
}

type ModelPickerProps = {
  providerId: ProviderId
  keyId?: string
  value: string
  onChange: (modelId: string) => void
  disabled?: boolean
  placeholder?: string
  ariaLabel: string
}

function modelPrice(model: ModelInfo): number | undefined {
  if (!model.priceKnown || model.inputPricePerM === undefined || model.outputPricePerM === undefined) {
    return undefined
  }
  return model.inputPricePerM + model.outputPricePerM
}

function sortModels(models: ModelInfo[], sort: ModelSort): ModelInfo[] {
  return [...models].sort((left, right) => {
    if (sort === 'context') {
      const contextDifference = (right.contextLength ?? -1) - (left.contextLength ?? -1)
      if (contextDifference !== 0) return contextDifference
    } else if (sort === 'price') {
      const leftPrice = modelPrice(left)
      const rightPrice = modelPrice(right)
      if (leftPrice === undefined && rightPrice !== undefined) return 1
      if (leftPrice !== undefined && rightPrice === undefined) return -1
      if (leftPrice !== undefined && rightPrice !== undefined && leftPrice !== rightPrice) {
        return leftPrice - rightPrice
      }
    }
    return left.name.localeCompare(right.name)
  })
}

function formatPrice(value: number): string {
  return value.toLocaleString(undefined, { maximumFractionDigits: 4 })
}

function ModelOption({ model, active }: { model: ModelInfo; active: boolean }) {
  return (
    <span className={`block rounded-md px-3 py-2 ${active ? 'bg-indigo-50 dark:bg-indigo-950' : ''}`}>
      <span className="flex flex-wrap items-center gap-2 text-base font-medium text-slate-950 dark:text-white">
        <span>{model.name}</span>
        {model.isFree === true && <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-sm font-semibold text-emerald-950 dark:bg-emerald-950 dark:text-emerald-100">{copy.models.freeBadge}</span>}
      </span>
      <span className="mt-0.5 block break-all text-sm text-slate-700 dark:text-slate-300">{model.id}</span>
      {(model.priceKnown || model.contextLength !== undefined) && (
        <span className="mt-1 flex flex-wrap gap-x-3 text-sm text-slate-700 dark:text-slate-300">
          {model.priceKnown && model.inputPricePerM !== undefined && model.outputPricePerM !== undefined && (
            <span>${formatPrice(model.inputPricePerM)} / ${formatPrice(model.outputPricePerM)} {copy.models.pricePerMillion}</span>
          )}
          {model.contextLength !== undefined && <span>{copy.models.contextLength.replace('{count}', model.contextLength.toLocaleString())}</span>}
        </span>
      )}
    </span>
  )
}

export default function ModelPicker({
  providerId,
  keyId,
  value,
  onChange,
  disabled = false,
  placeholder = copy.backupPlans.targetLabels.modelPlaceholder,
  ariaLabel,
}: ModelPickerProps) {
  const listboxId = useId()
  const { data: models, isError, isFetching, refetch } = useModels(providerId, keyId)
  const [sort, setSort] = useState<ModelSort>('name')
  const [freeOnly, setFreeOnly] = useState(false)
  const [isOpen, setIsOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(0)
  const [pageStart, setPageStart] = useState(0)

  const sortedModels = useMemo(() => {
    const normalizedQuery = value.trim().toLocaleLowerCase()
    const matchingModels = (models ?? []).filter((model) => (
      !normalizedQuery
      || model.id.toLocaleLowerCase().includes(normalizedQuery)
      || model.name.toLocaleLowerCase().includes(normalizedQuery)
    ))
    return sortModels(freeOnly ? filterFreeModels(matchingModels) : matchingModels, sort)
  }, [freeOnly, models, sort, value])
  const visibleModels = sortedModels.slice(pageStart, pageStart + 100)
  const hasPriceData = Boolean(models?.some((model) => model.priceKnown))
  const activeOption = visibleModels[activeIndex]

  useEffect(() => {
    setFreeOnly(false)
    setPageStart(0)
    setActiveIndex(0)
  }, [providerId, keyId])

  function chooseModel(model: ModelInfo) {
    onChange(model.id)
    setIsOpen(false)
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setIsOpen(true)
      setActiveIndex((current) => isOpen
          ? Math.min(current + 1, Math.max(visibleModels.length - 1, 0))
          : 0)
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setIsOpen(true)
      setActiveIndex((current) => isOpen
        ? Math.max(current - 1, 0)
        : Math.max(visibleModels.length - 1, 0))
    } else if (event.key === 'Enter' && isOpen) {
      event.preventDefault()
      if (activeOption) chooseModel(activeOption)
      else setIsOpen(false)
    } else if (event.key === 'Escape') {
      setIsOpen(false)
    }
  }

  return (
    <div
      className="relative min-w-0"
      onBlur={(event) => {
        const next = event.relatedTarget
        if (!(next instanceof Node) || !event.currentTarget.contains(next)) setIsOpen(false)
      }}
    >
      <div className="flex gap-1">
        <input
          role="combobox"
          aria-label={ariaLabel}
          aria-expanded={isOpen}
          aria-controls={listboxId}
          aria-activedescendant={isOpen && activeOption ? `${listboxId}-option-${activeIndex}` : undefined}
          autoComplete="off"
          maxLength={180}
          value={value}
          disabled={disabled}
          placeholder={placeholder}
          onFocus={() => setIsOpen(true)}
          onChange={(event) => {
            onChange(event.target.value)
            setActiveIndex(0)
            setPageStart(0)
            setIsOpen(true)
          }}
          onKeyDown={handleKeyDown}
          className="mt-1 block min-h-11 min-w-0 flex-1 rounded-md border border-slate-400 bg-white px-2 py-2 text-base text-slate-950 focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-700 dark:border-slate-600 dark:bg-slate-950 dark:text-slate-100"
        />
        <button
          type="button"
          aria-label={copy.models.refreshList}
          title={copy.models.refreshList}
          disabled={disabled || isFetching}
          onClick={() => { void refetch() }}
          className="mt-1 min-h-11 min-w-11 rounded-md border border-slate-400 px-2 text-base text-slate-800 disabled:opacity-50 dark:border-slate-600 dark:text-slate-200"
        >
          {isFetching ? '…' : '↻'}
        </button>
      </div>

      {isOpen && (
        <div className="absolute z-30 mt-1 w-full min-w-0 max-w-[calc(100vw-2rem)] rounded-lg border border-slate-200 bg-white p-2 shadow-xl dark:border-slate-700 dark:bg-slate-900">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-2 dark:border-slate-800">
            <label className="flex min-h-11 items-center gap-1.5 text-base text-slate-800 dark:text-slate-200">
              {copy.models.sort}
              <select aria-label={copy.models.sortModels} value={sort} onChange={(event) => {
                if (isModelSort(event.target.value)) {
                  setSort(event.target.value)
                  setPageStart(0)
                  setActiveIndex(0)
                }
              }} className="min-h-11 rounded border border-slate-400 bg-white px-2 text-base dark:border-slate-600 dark:bg-slate-950">
                <option value="name">{copy.models.sortName}</option>
                <option value="context">{copy.models.sortContext}</option>
                <option value="price">{copy.models.sortPrice}</option>
              </select>
            </label>
            {hasPriceData && (
              <label className="flex min-h-11 items-center gap-1.5 text-base text-slate-800 dark:text-slate-200">
                <input type="checkbox" checked={freeOnly} onChange={(event) => {
                  setFreeOnly(event.target.checked)
                  setActiveIndex(0)
                  setPageStart(0)
                }} />
                {copy.models.freeOnly}
              </label>
            )}
          </div>
          {models && !hasPriceData && (
            <p className="px-2 py-2 text-sm text-slate-700 dark:text-slate-300">{copy.models.priceUnknownForService}</p>
          )}
          {isFetching && !models && (
            <div aria-label={copy.models.loadingModels} className="space-y-2 p-2">
              <div className="h-4 animate-pulse rounded bg-slate-200 dark:bg-slate-700" />
              <div className="h-4 w-3/4 animate-pulse rounded bg-slate-200 dark:bg-slate-700" />
              <div className="h-4 w-5/6 animate-pulse rounded bg-slate-200 dark:bg-slate-700" />
            </div>
          )}
          {isError && (
            <p role="status" className="px-2 py-2 text-base text-amber-950 dark:text-amber-100">
              {copy.models.loadError}
            </p>
          )}
          {!isFetching && !isError && models && sortedModels.length === 0 && (
            <p className="px-2 py-3 text-base text-slate-700 dark:text-slate-300">{copy.models.noMatches}</p>
          )}
          {!isFetching && !isError && !models && (
            <p className="px-2 py-2 text-base text-slate-700 dark:text-slate-300">{copy.models.selectKey}</p>
          )}
          {visibleModels.length > 0 && (
            <div id={listboxId} role="listbox" aria-label={copy.models.availableModels} className="max-h-72 overflow-y-auto py-1">
              {visibleModels.map((model, index) => (
                <button
                  id={`${listboxId}-option-${index}`}
                  key={model.id}
                  type="button"
                  role="option"
                  aria-selected={value === model.id}
                  onMouseEnter={() => setActiveIndex(index)}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => chooseModel(model)}
                  className="block min-h-11 w-full rounded-md text-left hover:bg-indigo-50 dark:hover:bg-indigo-950"
                >
                  <ModelOption model={model} active={activeIndex === index} />
                </button>
              ))}
              {pageStart > 0 && (
                <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => {
                  setPageStart((start) => Math.max(0, start - 100))
                  setActiveIndex(0)
                }} className="min-h-11 w-full px-3 py-2 text-left text-base font-medium text-indigo-800 dark:text-indigo-300">
                  {copy.models.previousModels}
                </button>
              )}
              {sortedModels.length > pageStart + 100 && (
                <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => {
                  setPageStart((start) => start + 100)
                  setActiveIndex(0)
                }} className="min-h-11 w-full px-3 py-2 text-left text-base font-medium text-indigo-800 dark:text-indigo-300">
                  {copy.models.nextModels.replace('{count}', String(sortedModels.length - pageStart - 100))}
                </button>
              )}
            </div>
          )}
          <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => setIsOpen(false)} className="mt-1 min-h-11 w-full border-t border-slate-100 px-2 py-2 text-left text-base font-medium text-indigo-800 dark:border-slate-800 dark:text-indigo-300">
            {copy.models.useCustom}
          </button>
        </div>
      )}
      {hasPriceData === false && models && models.length > 0 && !isOpen && (
        <p className="mt-1 text-sm text-slate-700 dark:text-slate-300">{copy.models.priceUnknownForService}</p>
      )}
    </div>
  )
}
