// Encrypts a provider key in the browser before inserting its ciphertext into Supabase.
import { useState, type FormEvent } from 'react'
import { encryptSecretForVault, VaultCryptoError } from '../../core/crypto'
import { PROVIDER_CONFIGS, type ProviderConfig, type ProviderId } from '../../core/providers'
import { supabase } from '../../lib/supabase'
import { useVaultStore } from '../../store/vault'
import { copy } from '../../lib/copy'

type ImportPrefs = {
  freeOnly?: boolean
  includeText?: boolean
  includeImage?: boolean
}

export default function AddKeyModal({
  isOpen,
  onClose,
  initialProvider = 'openai',
  providerOptions = PROVIDER_CONFIGS,
}: {
  isOpen: boolean
  onClose: () => void
  initialProvider?: ProviderId
  providerOptions?: readonly ProviderConfig[]
}) {
  const addProviderKey = useVaultStore((state) => state.addProviderKey)
  const setModelImportPrefs = useVaultStore((state) => state.setModelImportPrefs)
  const [provider, setProvider] = useState<ProviderId>(initialProvider)
  const [label, setLabel] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [passphrase, setPassphrase] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const [savedKeyId, setSavedKeyId] = useState<string | null>(null)
  const [showImport, setShowImport] = useState(false)
  const [importPrefs, setImportPrefs] = useState<ImportPrefs>({
    freeOnly: false,
    includeText: true,
    includeImage: true,
  })
  const [isImporting, setIsImporting] = useState(false)

  function handleClose() {
    if (isSaving || isImporting) return
    setApiKey('')
    setPassphrase('')
    setLabel('')
    setError(null)
    setSavedKeyId(null)
    setShowImport(false)
    setImportPrefs({ freeOnly: false, includeText: true, includeImage: true })
    onClose()
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)

    if (!supabase) {
      setError(copy.errors.unknown)
      return
    }

    setIsSaving(true)
    try {
      const { data: { user }, error: userError } = await supabase.auth.getUser()
      if (userError) throw userError
      if (!user) throw new Error(copy.keys.lockedHint)

      const { data: canary, error: canaryError } = await supabase
        .from('vault_meta')
        .select('kdf_salt, canary_ciphertext, canary_iv')
        .eq('user_id', user.id)
        .maybeSingle()
      if (canaryError) throw canaryError
      if (!canary) {
        setError(copy.secretPassword.setupNeeded)
        return
      }

      const encrypted = await encryptSecretForVault(apiKey.trim(), passphrase, canary)
      const { data, error: insertError } = await supabase
        .from('provider_keys')
        .insert({
          user_id: user.id,
          provider,
          label: label.trim(),
          ...encrypted,
        })
        .select('id, provider, label')
        .single()
      if (insertError) throw insertError

      addProviderKey({
        id: data.id,
        provider,
        label: data.label,
        apiKey: apiKey.trim(),
      })
      setApiKey('')
      setPassphrase('')
      setLabel('')
      setSavedKeyId(data.id)

      if (provider === 'openrouter') {
        setShowImport(true)
      } else {
        onClose()
      }
    } catch (caughtError) {
      setError(
        caughtError instanceof VaultCryptoError && caughtError.code === 'passphrase_mismatch'
          ? copy.keys.secretPasswordMismatch
          : copy.keys.saveError,
      )
    } finally {
      setIsSaving(false)
    }
  }

  function handleImport() {
    if (!savedKeyId) return
    setIsImporting(true)
    try {
      const prefs: ImportPrefs = { ...importPrefs }
      setModelImportPrefs(savedKeyId, prefs)
      setSavedKeyId(null)
      setShowImport(false)
      setImportPrefs({ freeOnly: false, includeText: true, includeImage: true })
      onClose()
    } finally {
      setIsImporting(false)
    }
  }

  function togglePref(key: keyof ImportPrefs) {
    setImportPrefs((current) => ({ ...current, [key]: !current[key] }))
  }

  if (!isOpen) return null

  return (
    <div
      className="fixed inset-0 z-20 flex items-center justify-center bg-slate-950/50 p-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) handleClose()
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="add-key-title"
        className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl dark:bg-slate-900"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 id="add-key-title" className="text-xl font-semibold text-slate-950 dark:text-white">{showImport ? copy.keys.importTitle : copy.keys.addTitle}</h2>
            <p className="mt-1 text-base text-slate-700 dark:text-slate-300">{showImport ? copy.keys.importHint : copy.keys.addHint}</p>
          </div>
          <button type="button" onClick={handleClose} disabled={isSaving || isImporting} aria-label={copy.keys.closeDialog} className="min-h-11 min-w-11 rounded-md px-2 text-base text-slate-700 hover:bg-slate-100 disabled:opacity-50 dark:text-slate-200 dark:hover:bg-slate-800">×</button>
        </div>

        {error && <p role="alert" className="mt-4 rounded-lg bg-red-50 p-3 text-base text-red-950 dark:bg-red-950 dark:text-red-100">{error}</p>}

        {showImport ? (
          <form onSubmit={(event) => { event.preventDefault(); handleImport() }} className="mt-5 space-y-4">
            <fieldset className="border border-slate-200 rounded-xl p-4 dark:border-slate-800">
              <legend className="px-2 text-base font-medium text-slate-900 dark:text-white">{copy.keys.importTitle}</legend>
              <div className="mt-3 space-y-3">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={importPrefs.freeOnly ?? false}
                    onChange={() => togglePref('freeOnly')}
                    className="rounded border-slate-400 text-indigo-700 focus:ring-indigo-500 dark:border-slate-600 dark:focus:ring-indigo-400"
                  />
                  <span className="text-base text-slate-800 dark:text-slate-200">{copy.keys.freeOnly}</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={importPrefs.includeText ?? true}
                    onChange={() => togglePref('includeText')}
                    className="rounded border-slate-400 text-indigo-700 focus:ring-indigo-500 dark:border-slate-600 dark:focus:ring-indigo-400"
                  />
                  <span className="text-base text-slate-800 dark:text-slate-200">{copy.keys.includeText}</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={importPrefs.includeImage ?? true}
                    onChange={() => togglePref('includeImage')}
                    className="rounded border-slate-400 text-indigo-700 focus:ring-indigo-500 dark:border-slate-600 dark:focus:ring-indigo-400"
                  />
                  <span className="text-base text-slate-800 dark:text-slate-200">{copy.keys.includeImage}</span>
                </label>
              </div>
            </fieldset>
            <div className="flex justify-end gap-3 pt-4">
              <button type="button" onClick={handleClose} disabled={isImporting} className="min-h-11 rounded-lg px-4 text-base text-slate-700 hover:bg-slate-100 disabled:opacity-50 dark:text-slate-200 dark:hover:bg-slate-800">{copy.app.cancel}</button>
              <button type="submit" disabled={isImporting} className="min-h-11 rounded-lg bg-indigo-700 px-5 text-base font-semibold text-white hover:bg-indigo-800 disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-700">
                {isImporting ? copy.keys.importing : copy.keys.importButton}
              </button>
            </div>
          </form>
        ) : (
          <form onSubmit={handleSubmit} className="mt-5 space-y-4">
          <label className="block text-base font-medium text-slate-800 dark:text-slate-200">
            {copy.keys.service}
            <select
              value={provider}
              onChange={(event) => {
                const selected = providerOptions.find(({ id }) => id === event.target.value)
                if (selected) setProvider(selected.id)
              }}
              className="mt-1.5 min-h-11 w-full rounded-lg border border-slate-400 bg-white px-3 py-2.5 text-base dark:border-slate-600 dark:bg-slate-950"
            >
              {providerOptions.map(({ id }) => <option key={id} value={id}>{copy.keys.serviceNames[id]}</option>)}
            </select>
          </label>
          <label className="block text-base font-medium text-slate-800 dark:text-slate-200">
            {copy.keys.label}
            <input
              required
              maxLength={80}
              value={label}
              onChange={(event) => setLabel(event.target.value)}
              placeholder={copy.keys.labelPlaceholder}
              className="mt-1.5 min-h-11 w-full rounded-lg border border-slate-400 bg-white px-3 py-2.5 text-base dark:border-slate-600 dark:bg-slate-950"
            />
          </label>
          <label className="block text-base font-medium text-slate-800 dark:text-slate-200">
            {copy.keys.key}
            <input
              type="password"
              autoComplete="off"
              required
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
              className="mt-1.5 min-h-11 w-full rounded-lg border border-slate-400 bg-white px-3 py-2.5 text-base dark:border-slate-600 dark:bg-slate-950"
            />
          </label>
          <label className="block text-base font-medium text-slate-800 dark:text-slate-200">
            {copy.keys.secretPassword}
            <input
              type="password"
              autoComplete="off"
              minLength={12}
              required
              value={passphrase}
              onChange={(event) => setPassphrase(event.target.value)}
              className="mt-1.5 min-h-11 w-full rounded-lg border border-slate-400 bg-white px-3 py-2.5 text-base dark:border-slate-600 dark:bg-slate-950"
            />
          </label>
          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={handleClose} disabled={isSaving} className="min-h-11 rounded-lg px-4 text-base text-slate-700 hover:bg-slate-100 disabled:opacity-50 dark:text-slate-200 dark:hover:bg-slate-800">{copy.app.cancel}</button>
            <button type="submit" disabled={isSaving || showImport} className="min-h-11 rounded-lg bg-indigo-700 px-5 text-base font-semibold text-white hover:bg-indigo-800 disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-700">
              {isSaving ? copy.keys.saving : copy.keys.save}
            </button>
          </div>
        </form>
        )}
      </section>
    </div>
  )
}
