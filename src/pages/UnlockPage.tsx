// Creates or unlocks the encrypted browser-side API key vault.
import { useEffect, useState, type FormEvent } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import {
  createVaultCanary,
  decryptSecret,
  verifyVaultCanary,
  type VaultCanary,
} from '../core/crypto'
import { isSupabaseConfigured, supabase } from '../lib/supabase'
import { useVaultStore } from '../store/vault'
import { isProviderId, type EncryptedProviderKey } from '../types'
import useAuth from '../hooks/useAuth'
import { copy } from '../lib/copy'

export default function UnlockPage() {
  const { isLoading: isAuthLoading, user } = useAuth()
  const navigate = useNavigate()
  const isUnlocked = useVaultStore((state) => state.isUnlocked)
  const unlock = useVaultStore((state) => state.unlock)
  const [vaultCanary, setVaultCanary] = useState<VaultCanary | null>(null)
  const [isChecking, setIsChecking] = useState(true)
  const [metadataLoadFailed, setMetadataLoadFailed] = useState(false)
  const [passphrase, setPassphrase] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  useEffect(() => {
    let active = true

    async function loadVaultMetadata() {
      if (isAuthLoading) return
      if (!user) {
        setIsChecking(false)
        return
      }
      if (!supabase) {
        setError(copy.errors.unknown)
        setIsChecking(false)
        return
      }

      try {
        const { data, error: queryError } = await supabase
          .from('vault_meta')
          .select('kdf_salt, canary_ciphertext, canary_iv')
          .eq('user_id', user.id)
          .maybeSingle()
        if (queryError) throw queryError
        if (active && data) setVaultCanary(data)
      } catch {
        if (active) {
          setMetadataLoadFailed(true)
          setError(copy.secretPassword.unavailable)
        }
      } finally {
        if (active) setIsChecking(false)
      }
    }

    void loadVaultMetadata()
    return () => {
      active = false
    }
  }, [isAuthLoading, user])

  if (isUnlocked) return <Navigate to="/dashboard" replace />
  if (!isAuthLoading && !user && !isChecking) return <Navigate to="/login" replace />

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)

    if (!isSupabaseConfigured || !supabase || !user || isAuthLoading) {
      setError(copy.secretPassword.setupNeeded)
      return
    }
    if (metadataLoadFailed) {
      setError(copy.secretPassword.unavailable)
      return
    }
    if (passphrase.length < 12) {
      setError(copy.secretPassword.passwordHint)
      return
    }
    if (!vaultCanary && passphrase !== confirmation) {
      setError(copy.secretPassword.mismatch)
      return
    }

    setIsSubmitting(true)
    try {
      if (!vaultCanary) {
        const canary = await createVaultCanary(passphrase)
        const { error: insertError } = await supabase.from('vault_meta').insert({
          user_id: user.id,
          ...canary,
        })
        if (insertError) throw insertError
        unlock([])
      } else {
        const matches = await verifyVaultCanary(passphrase, vaultCanary)
        if (!matches) {
          setError(copy.secretPassword.incorrect)
          return
        }

        const { data, error: keysError } = await supabase
          .from('provider_keys')
          .select('id, provider, label, ciphertext, iv, salt, created_at')
          .eq('user_id', user.id)
        if (keysError) throw keysError

        const providerKeys = await Promise.all(
          (data satisfies EncryptedProviderKey[]).map(async (record) => {
            if (!isProviderId(record.provider)) {
              throw new Error(copy.errors.unknown)
            }
            return {
              id: record.id,
              provider: record.provider,
              label: record.label,
              apiKey: await decryptSecret(record, passphrase),
            }
          }),
        )
        unlock(providerKeys)
      }

      setPassphrase('')
      setConfirmation('')
      navigate('/dashboard', { replace: true })
    } catch {
      setError(copy.secretPassword.unavailable)
    } finally {
      setIsSubmitting(false)
    }
  }

  if (isChecking) {
    return <main className="flex min-h-screen items-center justify-center text-base">{copy.app.loading}</main>
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-12 dark:bg-slate-950">
      <section className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <h1 className="text-2xl font-semibold text-slate-900 dark:text-white">
          {copy.secretPassword.title}
        </h1>
        <p className="mt-2 text-base text-slate-700 dark:text-slate-300">
          {copy.secretPassword.explanation}
        </p>
        {!isSupabaseConfigured && (
          <p role="alert" className="mt-5 rounded-lg bg-amber-50 p-3 text-base text-amber-950 dark:bg-amber-950 dark:text-amber-100">
            {copy.errors.unknown}
          </p>
        )}
        {error && <p role="alert" className="mt-5 rounded-lg bg-red-50 p-3 text-base text-red-950 dark:bg-red-950 dark:text-red-100">{error}</p>}
        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
          <label className="block text-base font-medium text-slate-800 dark:text-slate-200">
            {vaultCanary ? copy.secretPassword.enter : copy.secretPassword.create}
            <input
              type="password"
              autoComplete="off"
              minLength={12}
              required
              value={passphrase}
              onChange={(event) => setPassphrase(event.target.value)}
              className="mt-1.5 min-h-12 w-full rounded-lg border border-slate-400 bg-white px-3 py-2.5 text-base outline-none focus:border-indigo-600 focus:ring-2 focus:ring-indigo-200 dark:border-slate-600 dark:bg-slate-950 dark:text-white dark:focus:ring-indigo-900"
            />
          </label>
          {!vaultCanary && (
            <label className="block text-base font-medium text-slate-800 dark:text-slate-200">
              {copy.secretPassword.confirm}
              <input
                type="password"
                autoComplete="off"
                minLength={12}
                required
                value={confirmation}
                onChange={(event) => setConfirmation(event.target.value)}
                className="mt-1.5 min-h-12 w-full rounded-lg border border-slate-400 bg-white px-3 py-2.5 text-base outline-none focus:border-indigo-600 focus:ring-2 focus:ring-indigo-200 dark:border-slate-600 dark:bg-slate-950 dark:text-white dark:focus:ring-indigo-900"
              />
            </label>
          )}
          <button
            type="submit"
            disabled={isSubmitting || !isSupabaseConfigured || metadataLoadFailed}
            className="min-h-12 w-full rounded-lg bg-indigo-700 px-4 py-2.5 text-base font-semibold text-white hover:bg-indigo-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isSubmitting ? copy.secretPassword.working : vaultCanary ? copy.secretPassword.submitUnlock : copy.secretPassword.submitCreate}
          </button>
        </form>
        <p className="mt-5 text-center text-base text-slate-700 dark:text-slate-300">
          <Link to="/providers" className="hover:text-indigo-600">{copy.secretPassword.back}</Link>
        </p>
      </section>
    </main>
  )
}
