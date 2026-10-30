import { useState, type FormEvent } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import {
  VaultPasswordChangeError,
  changeSecretPassword,
} from '../../lib/vaultManagement'
import { flushRequestLogs } from '../../lib/requestLogger'
import { isProviderId, type EncryptedProviderKey } from '../../types'
import { copy } from '../../lib/copy'
import { supabase } from '../../lib/supabase'
import useAuth from '../../hooks/useAuth'
import { useVaultStore } from '../../store/vault'
import { useModelTestStore } from '../../store/model-tests'
import { usePlaygroundStore } from '../../store/playground'

function clearDeviceSettings(userId: string): boolean {
  try {
    window.localStorage.removeItem('theme')
    const markerPrefix = `activity-rollup:${userId}:`
    const markerKeys = Array.from({ length: window.localStorage.length }, (_, index) => (
      window.localStorage.key(index)
    )).filter((key): key is string => key?.startsWith(markerPrefix) === true)
    for (const key of markerKeys) window.localStorage.removeItem(key)
    return true
  } catch {
    return false
  }
}

export default function SecuritySettings() {
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const lockVault = useVaultStore((state) => state.lock)
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [resetConfirmation, setResetConfirmation] = useState('')
  const [deleteConfirmation, setDeleteConfirmation] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  async function handleChangePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setMessage('')
    setError('')
    if (newPassword.length < 12) {
      setError(copy.secretPassword.passwordHint)
      return
    }
    if (newPassword !== confirmPassword) {
      setError(copy.secretPassword.mismatch)
      return
    }
    const client = supabase
    if (!client || !user) {
      setError(copy.secretPassword.setupNeeded)
      return
    }

    setBusy(true)
    try {
      const { data: canary, error: canaryError } = await client
        .from('vault_meta')
        .select('kdf_salt, canary_ciphertext, canary_iv')
        .eq('user_id', user.id)
        .maybeSingle()
      if (canaryError) throw canaryError
      if (!canary) throw new Error(copy.secretPassword.unavailable)

      const { data: rows, error: keysError } = await client
        .from('provider_keys')
        .select('id, provider, label, ciphertext, iv, salt, created_at')
        .eq('user_id', user.id)
      if (keysError) throw keysError
      const encryptedKeys = rows satisfies EncryptedProviderKey[]
      if (!encryptedKeys.every((key) => isProviderId(key.provider))) {
        throw new Error(copy.secretPassword.unavailable)
      }

      await changeSecretPassword(
        currentPassword,
        newPassword,
        canary,
        encryptedKeys,
        async (nextCanary, nextKeys) => {
          const { error: replaceError } = await client.rpc('change_my_vault', {
            p_canary: nextCanary,
            p_provider_keys: nextKeys,
          })
          if (replaceError) throw replaceError
        },
      )
      setMessage(copy.settings.passwordChanged)
      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')
    } catch (caughtError) {
      setError(caughtError instanceof VaultPasswordChangeError
        ? copy.settings.currentPasswordIncorrect
        : copy.settings.passwordChangeError)
    } finally {
      setBusy(false)
      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')
    }
  }

  async function handleResetVault() {
    setMessage('')
    setError('')
    if (resetConfirmation.trim() !== copy.settings.resetVaultPhrase) {
      setError(copy.settings.confirmationMismatch)
      return
    }
    const client = supabase
    if (!client || !user) {
      setError(copy.secretPassword.setupNeeded)
      return
    }

    setBusy(true)
    try {
      const { error: resetError } = await client.rpc('reset_my_vault')
      if (resetError) throw resetError
      lockVault()
      await queryClient.invalidateQueries({ queryKey: ['gateway-shared-keys', user.id] })
      setResetConfirmation('')
      setMessage(copy.settings.vaultResetSuccess)
    } catch {
      setError(copy.settings.vaultResetError)
    } finally {
      setBusy(false)
    }
  }

  async function handleDeleteAllData() {
    setMessage('')
    setError('')
    if (deleteConfirmation.trim() !== copy.settings.deleteDataPhrase) {
      setError(copy.settings.confirmationMismatch)
      return
    }
    const client = supabase
    if (!client || !user) {
      setError(copy.secretPassword.setupNeeded)
      return
    }

    setBusy(true)
    try {
      await flushRequestLogs()
      const { error: deleteError } = await client.rpc('delete_my_data')
      if (deleteError) throw deleteError
      lockVault()
      queryClient.clear()
      useModelTestStore.getState().clearResults()
      const playground = usePlaygroundStore.getState()
      playground.setMessages([])
      playground.setDraft('')
      playground.setSelectedRouteId('single')
      const deviceSettingsCleared = clearDeviceSettings(user.id)
      let sessionRefreshFailed = false
      try {
        const { error: refreshError } = await client.auth.refreshSession()
        sessionRefreshFailed = Boolean(refreshError)
      } catch {
        sessionRefreshFailed = true
      }
      setDeleteConfirmation('')
      setMessage([
        copy.settings.deleteDataSuccess,
        ...(sessionRefreshFailed ? [copy.settings.deleteDataReloadWarning] : []),
        ...(!deviceSettingsCleared ? [copy.settings.deleteDataDeviceWarning] : []),
      ].join(' '))
    } catch {
      setError(copy.settings.deleteDataError)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="space-y-5">
      <form onSubmit={(event) => { void handleChangePassword(event) }} className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900 sm:p-6">
        <div>
          <h2 className="text-xl font-semibold">{copy.settings.changePassword}</h2>
          <p className="mt-1 text-sm text-slate-700 dark:text-slate-300">{copy.settings.changePasswordHint}</p>
        </div>
        <label className="block text-sm font-medium">
          {copy.settings.currentPassword}
          <input type="password" autoComplete="off" required value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} className="mt-1 min-h-11 w-full rounded-lg border border-slate-400 bg-white px-3 dark:border-slate-600 dark:bg-slate-950" />
        </label>
        <label className="block text-sm font-medium">
          {copy.settings.newPassword}
          <input type="password" autoComplete="off" minLength={12} required value={newPassword} onChange={(event) => setNewPassword(event.target.value)} className="mt-1 min-h-11 w-full rounded-lg border border-slate-400 bg-white px-3 dark:border-slate-600 dark:bg-slate-950" />
        </label>
        <label className="block text-sm font-medium">
          {copy.settings.confirmNewPassword}
          <input type="password" autoComplete="off" minLength={12} required value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} className="mt-1 min-h-11 w-full rounded-lg border border-slate-400 bg-white px-3 dark:border-slate-600 dark:bg-slate-950" />
        </label>
        <button type="submit" disabled={busy} className="min-h-11 rounded-lg bg-indigo-700 px-4 font-semibold text-white disabled:opacity-60">{busy ? copy.secretPassword.working : copy.settings.changePassword}</button>
      </form>

      <section className="space-y-4 rounded-2xl border border-amber-300 bg-white p-5 dark:border-amber-900 dark:bg-slate-900 sm:p-6">
        <div>
          <h2 className="text-xl font-semibold">{copy.settings.forgotPassword}</h2>
          <p className="mt-1 text-sm text-slate-700 dark:text-slate-300">{copy.settings.forgotPasswordHint}</p>
        </div>
        <label className="block text-sm font-medium">
          {copy.settings.typeToResetVault}
          <input value={resetConfirmation} onChange={(event) => setResetConfirmation(event.target.value)} autoComplete="off" className="mt-1 min-h-11 w-full rounded-lg border border-slate-400 bg-white px-3 dark:border-slate-600 dark:bg-slate-950" />
        </label>
        <button type="button" disabled={busy || resetConfirmation.trim() !== copy.settings.resetVaultPhrase} onClick={() => { void handleResetVault() }} className="min-h-11 rounded-lg border border-amber-700 px-4 font-semibold text-amber-900 disabled:opacity-50 dark:text-amber-200">{copy.settings.resetVault}</button>
      </section>

      <section className="space-y-4 rounded-2xl border border-red-300 bg-white p-5 dark:border-red-900 dark:bg-slate-900 sm:p-6">
        <div>
          <h2 className="text-xl font-semibold">{copy.settings.deleteAllData}</h2>
          <p className="mt-1 text-sm text-slate-700 dark:text-slate-300">{copy.settings.deleteAllDataHint}</p>
        </div>
        <label className="block text-sm font-medium">
          {copy.settings.typeToDeleteData}
          <input value={deleteConfirmation} onChange={(event) => setDeleteConfirmation(event.target.value)} autoComplete="off" className="mt-1 min-h-11 w-full rounded-lg border border-slate-400 bg-white px-3 dark:border-slate-600 dark:bg-slate-950" />
        </label>
        <button type="button" disabled={busy || deleteConfirmation.trim() !== copy.settings.deleteDataPhrase} onClick={() => { void handleDeleteAllData() }} className="min-h-11 rounded-lg bg-red-700 px-4 font-semibold text-white disabled:opacity-50">{copy.settings.deleteAllData}</button>
        <p className="text-sm text-slate-700 dark:text-slate-300">{copy.settings.accountRemovalNote}</p>
      </section>

      {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-base text-red-900 dark:bg-red-950 dark:text-red-100">{error}</p>}
      {message && <p role="status" className="rounded-lg bg-emerald-50 p-3 text-base text-emerald-900 dark:bg-emerald-950 dark:text-emerald-100">{message}</p>}
    </section>
  )
}
