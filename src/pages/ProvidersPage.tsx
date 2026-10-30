// Provider credential management screen.
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import AddKeyModal from '../components/providers/AddKeyModal'
import ProviderCard from '../components/providers/ProviderCard'
import { MARKETPLACE_PROVIDER_CONFIGS, type ProviderId } from '../core/providers'
import { useVaultStore } from '../store/vault'
import { supabase } from '../lib/supabase'
import { copy } from '../lib/copy'

export default function ProvidersPage() {
  const { providerKeys, unavailableProviderKeys, isUnlocked, removeProviderKey } = useVaultStore()
  const queryClient = useQueryClient()
  const [providerToAdd, setProviderToAdd] = useState<ProviderId | null>(null)
  const [removingKeyId, setRemovingKeyId] = useState<string | null>(null)
  const [removeError, setRemoveError] = useState(false)

  async function handleRemoveKey(keyId: string) {
    setRemoveError(false)
    if (!supabase) {
      setRemoveError(true)
      return
    }
    setRemovingKeyId(keyId)
    try {
      const { data: { user }, error: userError } = await supabase.auth.getUser()
      if (userError) throw userError
      if (!user) throw new Error(copy.keys.lockedHint)

      const { error: deleteError } = await supabase
        .from('provider_keys')
        .delete()
        .eq('id', keyId)
        .eq('user_id', user.id)

      if (deleteError) throw deleteError

      removeProviderKey(keyId)
      await queryClient.invalidateQueries({ queryKey: ['gateway-shared-keys', user.id] })
    } catch {
      setRemoveError(true)
    } finally {
      setRemovingKeyId(null)
    }
  }

  if (!isUnlocked) {
    return (
      <section className="mx-auto max-w-xl rounded-xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
        <h1 className="text-2xl font-bold">{copy.keys.locked}</h1>
        <p className="mt-2 text-base text-slate-700 dark:text-slate-300">{copy.keys.lockedHint}</p>
        <Link to="/unlock" className="mt-4 inline-flex min-h-12 items-center rounded-xl bg-indigo-700 px-5 text-base font-semibold text-white hover:bg-indigo-800">{copy.keys.unlockButton}</Link>
      </section>
    )
  }

  return (
    <section>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-slate-950 dark:text-white">{copy.keys.title}</h1>
          <p className="mt-1 text-base text-slate-700 dark:text-slate-300">{copy.keys.subtitle}</p>
        </div>
      </div>
      {unavailableProviderKeys.length > 0 && (
        <aside role="alert" className="mb-6 rounded-xl border border-amber-300 bg-amber-50 p-4 dark:border-amber-800 dark:bg-amber-950">
          <h2 className="font-semibold text-amber-950 dark:text-amber-100">{copy.keys.unavailableTitle}</h2>
          <p className="mt-1 text-base text-amber-900 dark:text-amber-200">{copy.keys.unavailableHint}</p>
          <ul className="mt-3 divide-y divide-amber-200 dark:divide-amber-800">
            {unavailableProviderKeys.map((key) => (
              <li key={key.id} className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
                <span className="text-base text-amber-950 dark:text-amber-100">
                  {key.label || copy.keys.unavailableKeyLabel} ({key.provider})
                </span>
                <button
                  type="button"
                  onClick={() => {
                    if (window.confirm(copy.keys.removeUnavailableKeyConfirm)) {
                      void handleRemoveKey(key.id)
                    }
                  }}
                  disabled={removingKeyId === key.id}
                  className="min-h-11 rounded-lg border border-amber-700 px-3 py-1.5 text-sm font-medium text-amber-950 hover:bg-amber-100 disabled:opacity-50 dark:border-amber-400 dark:text-amber-100 dark:hover:bg-amber-900"
                >
                  {removingKeyId === key.id ? copy.app.working : copy.keys.removeUnavailableKey}
                </button>
              </li>
            ))}
          </ul>
        </aside>
      )}
      {removeError && (
        <p role="alert" className="mb-6 rounded-lg bg-red-50 p-3 text-base text-red-950 dark:bg-red-950 dark:text-red-100">
          {copy.keys.removeKeyError}
        </p>
      )}
      <div className="grid gap-4 lg:grid-cols-2">
        {MARKETPLACE_PROVIDER_CONFIGS.map((config) => (
          <ProviderCard
            key={config.id}
            config={config}
            keys={providerKeys.filter((key) => key.provider === config.id)}
            onAddKey={() => setProviderToAdd(config.id)}
            onRemoveKey={handleRemoveKey}
            isRemoving={removingKeyId}
          />
        ))}
      </div>
      {providerToAdd && (
        <AddKeyModal
          key={providerToAdd}
          isOpen
          initialProvider={providerToAdd}
          providerOptions={MARKETPLACE_PROVIDER_CONFIGS}
          onClose={() => setProviderToAdd(null)}
        />
      )}
    </section>
  )
}
