// Provides Supabase authentication state and actions to the React application.
import {
  createContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react'
import type { Session, User } from '@supabase/supabase-js'
import { isSupabaseConfigured, supabase } from '../lib/supabase'
import { useVaultStore } from '../store/vault'

type AuthContextValue = {
  user: User | null
  session: Session | null
  isLoading: boolean
  isConfigured: boolean
  signInWithEmail: (email: string, password: string) => Promise<void>
  signUpWithEmail: (email: string, password: string) => Promise<boolean>
  signInWithGitHub: () => Promise<void>
  signOut: () => Promise<void>
}

export const AuthContext = createContext<AuthContextValue | null>(null)

function requireSupabase() {
  if (!supabase) {
    throw new Error('Supabase is not configured. Add its URL and anon key to .env.local.')
  }

  return supabase
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [isLoading, setIsLoading] = useState(isSupabaseConfigured)

  useEffect(() => {
    if (!supabase) return

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, nextSession) => {
      if (event === 'SIGNED_OUT') useVaultStore.getState().lock()
      setSession(nextSession)
      setIsLoading(false)
    })

    return () => subscription.unsubscribe()
  }, [])

  const value: AuthContextValue = {
    user: session?.user ?? null,
    session,
    isLoading,
    isConfigured: isSupabaseConfigured,
    async signInWithEmail(email, password) {
      const { error } = await requireSupabase().auth.signInWithPassword({ email, password })
      if (error) throw error
    },
    async signUpWithEmail(email, password) {
      const { data, error } = await requireSupabase().auth.signUp({ email, password })
      if (error) throw error
      return data.session === null
    },
    async signInWithGitHub() {
      const { error } = await requireSupabase().auth.signInWithOAuth({
        provider: 'github',
        options: { redirectTo: window.location.origin },
      })
      if (error) throw error
    },
    async signOut() {
      const { error } = await requireSupabase().auth.signOut()
      if (error) throw error
      useVaultStore.getState().lock()
    },
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
