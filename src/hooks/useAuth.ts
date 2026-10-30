// Reads the current Supabase authentication context.
import { useContext } from 'react'
import { AuthContext } from '../app/AuthProvider'

export default function useAuth() {
  const context = useContext(AuthContext)

  if (!context) {
    throw new Error('useAuth must be used inside AuthProvider.')
  }

  return context
}
