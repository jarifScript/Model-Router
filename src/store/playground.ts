import { create } from 'zustand'
import type { ProviderId } from '../core/providers'
import type { ChatMessage } from '../core/adapters/types'
import { PROVIDER_CONFIGS } from '../core/providers'

export type PlaygroundMessage = ChatMessage & { id: string; model?: string }
export type LastWorkedTarget = { providerId: ProviderId; modelId: string; keyId: string }

type PlaygroundState = {
  providerId: ProviderId
  modelsByProvider: Record<ProviderId, string>
  messages: PlaygroundMessage[]
  draft: string
  selectedRouteId: string
  lastWorkedTarget: LastWorkedTarget | null
  setProvider: (providerId: ProviderId) => void
  setModel: (providerId: ProviderId, model: string) => void
  setSelectedRouteId: (routeId: string) => void
  setLastWorkedTarget: (target: LastWorkedTarget) => void
  setMessages: (messages: PlaygroundMessage[] | ((current: PlaygroundMessage[]) => PlaygroundMessage[])) => void
  setDraft: (draft: string) => void
}

function initialModels(): Record<ProviderId, string> {
  return Object.fromEntries(
    PROVIDER_CONFIGS.map(({ id, defaultModel }) => [id, defaultModel]),
  ) as Record<ProviderId, string>
}

export const usePlaygroundStore = create<PlaygroundState>((set) => ({
  providerId: 'openrouter',
  modelsByProvider: initialModels(),
  messages: [],
  draft: '',
  selectedRouteId: 'single',
  lastWorkedTarget: null,
  setProvider: (providerId) => set({ providerId }),
  setModel: (providerId, model) => set((state) => ({
    modelsByProvider: { ...state.modelsByProvider, [providerId]: model },
  })),
  setSelectedRouteId: (selectedRouteId) => set({ selectedRouteId }),
  setLastWorkedTarget: (lastWorkedTarget) => set({ lastWorkedTarget }),
  setMessages: (messages) => set((state) => ({
    messages: typeof messages === 'function' ? messages(state.messages) : messages,
  })),
  setDraft: (draft) => set({ draft }),
}))
