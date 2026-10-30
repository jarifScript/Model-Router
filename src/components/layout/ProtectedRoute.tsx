// Requires an authenticated Supabase session before rendering protected routes.
import { Navigate, Outlet, useLocation } from 'react-router-dom'
import useAuth from '../../hooks/useAuth'
import { useUserSettings } from '../../hooks/useUserSettings'
import { copy } from '../../lib/copy'
import type { ReactNode } from 'react'

export default function ProtectedRoute() {
  const { isLoading, user } = useAuth()
  const location = useLocation()

  if (isLoading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-50 text-base text-slate-800 dark:bg-slate-950 dark:text-slate-200">
        {copy.app.loading}
      </main>
    )
  }

  if (!user) {
    return <Navigate to="/login" replace state={{ from: location }} />
  }

  return <Outlet />
}

export function AdvancedFeatureRoute({ children }: { children: ReactNode }) {
  const { showAdvancedFeatures } = useUserSettings()
  const location = useLocation()
  if (!showAdvancedFeatures) {
    return <Navigate to="/dashboard" replace state={{ notice: copy.backupPlans.advancedOnly, from: location.pathname }} />
  }
  return children
}
