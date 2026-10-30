// In-memory-only store for decrypted provider keys; intentionally has no persistence middleware.
import { create } from 'zustand'
import type { DecryptedProviderKey, UnavailableProviderKey } from '../types'

type ModelImportPrefs = {
  freeOnly?: boolean
  includeText?: boolean
  includeImage?: boolean
}

type VaultState = {
  providerKeys: DecryptedProviderKey[]
  unavailableProviderKeys: UnavailableProviderKey[]
  isUnlocked: boolean
  modelImportPrefs: Record<string, ModelImportPrefs>
  unlock: (
    providerKeys: DecryptedProviderKey[],
    unavailableProviderKeys?: UnavailableProviderKey[],
  ) => void
  addProviderKey: (providerKey: DecryptedProviderKey) => void
  removeProviderKey: (id: string) => void
  setModelImportPrefs: (keyId: string, prefs: ModelImportPrefs) => void
  lock: () => void
}

export const useVaultStore = create<VaultState>((set) => ({
  providerKeys: [],
  unavailableProviderKeys: [],
  isUnlocked: false,
  modelImportPrefs: {},
  unlock: (providerKeys, unavailableProviderKeys = []) =>
    set({ providerKeys, unavailableProviderKeys, isUnlocked: true }),
  addProviderKey: (providerKey) =>
    set((state) => ({
      providerKeys: [...state.providerKeys.filter((key) => key.id !== providerKey.id), providerKey],
      isUnlocked: true,
    })),
  removeProviderKey: (id) =>
    set((state) => ({
      providerKeys: state.providerKeys.filter((key) => key.id !== id),
      unavailableProviderKeys: state.unavailableProviderKeys.filter((key) => key.id !== id),
      modelImportPrefs: Object.fromEntries(
        Object.entries(state.modelImportPrefs).filter(([key]) => key !== id)
      ),
    })),
  setModelImportPrefs: (keyId, prefs) =>
    set((state) => ({
      modelImportPrefs: { ...state.modelImportPrefs, [keyId]: prefs },
    })),
  lock: () => set({
    providerKeys: [],
    unavailableProviderKeys: [],
    isUnlocked: false,
    modelImportPrefs: {},
  }),
}))
