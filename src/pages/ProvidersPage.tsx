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
  const { providerKeys, isUnlocked, removeProviderKey } = useVaultStore()
  const queryClient = useQueryClient()
  const [providerToAdd, setProviderToAdd] = useState<ProviderId | null>(null)
  const [removingKeyId, setRemovingKeyId] = useState<string | null>(null)

  async function handleRemoveKey(keyId: string) {
    if (!supabase) return
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
      // Error handled by UI; could show a toast here
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
