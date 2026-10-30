// In-memory-only store for decrypted provider keys; intentionally has no persistence middleware.
import { create } from 'zustand'
import type { DecryptedProviderKey } from '../types'

type ModelImportPrefs = {
  freeOnly?: boolean
  includeText?: boolean
  includeImage?: boolean
}

type VaultState = {
  providerKeys: DecryptedProviderKey[]
  isUnlocked: boolean
  modelImportPrefs: Record<string, ModelImportPrefs>
  unlock: (providerKeys: DecryptedProviderKey[]) => void
  addProviderKey: (providerKey: DecryptedProviderKey) => void
  removeProviderKey: (id: string) => void
  setModelImportPrefs: (keyId: string, prefs: ModelImportPrefs) => void
  lock: () => void
}

export const useVaultStore = create<VaultState>((set) => ({
  providerKeys: [],
  isUnlocked: false,
  modelImportPrefs: {},
  unlock: (providerKeys) => set({ providerKeys, isUnlocked: true }),
  addProviderKey: (providerKey) =>
    set((state) => ({
      providerKeys: [...state.providerKeys.filter((key) => key.id !== providerKey.id), providerKey],
      isUnlocked: true,
    })),
  removeProviderKey: (id) =>
    set((state) => ({
      providerKeys: state.providerKeys.filter((key) => key.id !== id),
      modelImportPrefs: Object.fromEntries(
        Object.entries(state.modelImportPrefs).filter(([key]) => key !== id)
      ),
    })),
  setModelImportPrefs: (keyId, prefs) =>
    set((state) => ({
      modelImportPrefs: { ...state.modelImportPrefs, [keyId]: prefs },
    })),
  lock: () => set({ providerKeys: [], isUnlocked: false, modelImportPrefs: {} }),
}))
