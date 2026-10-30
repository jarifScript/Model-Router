// Displays encrypted provider credentials that are currently unlocked in memory.
import { useState } from 'react'
import type { ProviderConfig } from '../../core/providers'
import type { DecryptedProviderKey } from '../../types'
import { copy } from '../../lib/copy'
import KeyTestButton from './KeyTestButton'

export default function ProviderCard({
  config,
  keys,
  onAddKey,
  onRemoveKey,
  isRemoving,
}: {
  config: ProviderConfig
  keys: DecryptedProviderKey[]
  onAddKey: () => void
  onRemoveKey: (keyId: string) => void
  isRemoving?: string | null
}) {
  const [keyWorks, setKeyWorks] = useState<Record<string, boolean>>({})
  const serviceName = copy.keys.serviceNames[config.id]
  const status = !keys.length
    ? copy.keys.noKeys
    : Object.values(keyWorks).some(Boolean)
      ? copy.keys.works
      : keys.every((key) => Object.hasOwn(keyWorks, key.id))
        ? copy.keys.notWorking
        : copy.keys.notChecked
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <span aria-hidden="true" className="flex size-7 shrink-0 items-center justify-center rounded-full bg-indigo-100 text-sm font-bold text-indigo-800 dark:bg-indigo-950 dark:text-indigo-200">
            {serviceName.slice(0, 1)}
          </span>
          <h2 className="text-xl font-semibold text-slate-950 dark:text-white">{serviceName}</h2>
        </div>
        {status && <span className="rounded-full bg-slate-100 px-3 py-1 text-sm font-medium text-slate-900 dark:bg-slate-800 dark:text-slate-100">{status}</span>}
      </div>
      <div className="mt-4 flex items-center gap-4">
        <a
          href={config.keyHelpUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-flex min-h-11 items-center text-base font-semibold text-indigo-800 underline hover:text-indigo-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-600 dark:text-indigo-300"
        >
          {copy.keys.getKey}
        </a>
        <button
          type="button"
          onClick={onAddKey}
          className="min-h-11 rounded-lg border border-slate-400 px-4 py-2 text-base font-semibold text-slate-800 hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-600 dark:border-slate-600 dark:text-white dark:hover:bg-slate-800"
        >
          {copy.keys.addKey}
        </button>
      </div>
      {keys.length > 0 && (
        <ul className="mt-4 divide-y divide-slate-100 dark:divide-slate-800">
          {keys.map((key) => (
            <li key={key.id} className="flex flex-wrap items-center gap-3 py-3 first:pt-0 last:pb-0">
              <div className="min-w-0 flex-1">
                <p className="truncate text-base font-medium text-slate-900 dark:text-white">{key.label}</p>
                <p className="mt-1 text-sm text-slate-700 dark:text-slate-300">{copy.keys.keyCount.replace('{count}', String(keys.length))}</p>
              </div>
              <div className="ml-auto flex shrink-0 items-center gap-2">
                <KeyTestButton provider={config.id} apiKey={key.apiKey} onStatusChange={(works) => setKeyWorks((current) => ({ ...current, [key.id]: works }))} />
                <button
                  type="button"
                  onClick={() => {
                    if (window.confirm(copy.keys.removeKeyConfirm)) {
                      onRemoveKey(key.id)
                    }
                  }}
                  disabled={isRemoving === key.id}
                  className="min-h-11 rounded-lg border border-slate-400 px-3 py-1.5 text-sm font-medium text-slate-800 hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-600 disabled:opacity-50 dark:border-slate-600 dark:text-white dark:hover:bg-slate-800"
                >
                  {isRemoving === key.id ? copy.app.working : copy.keys.removeKey}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
