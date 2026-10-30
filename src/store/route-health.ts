// Session-memory circuit and attention state shared by Routes and Playground.
import { create } from 'zustand'
import { ProviderHealth } from '../core/health'

const health = new ProviderHealth()

type RouteHealthState = {
  health: ProviderHealth
  revision: number
  refresh: () => void
}

export const useRouteHealth = create<RouteHealthState>((set) => ({
  health,
  revision: 0,
  refresh: () => set((state) => ({ revision: state.revision + 1 })),
}))
