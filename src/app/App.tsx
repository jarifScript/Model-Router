// Root application component.
import { Suspense } from 'react'
import { RouterProvider } from 'react-router-dom'
import { router } from './router'
import { AppProviders } from './providers'
import ServiceStatusNotice from '../components/layout/ServiceStatusNotice'
import { copy } from '../lib/copy'

export default function App() {
  return (
    <AppProviders>
      <ServiceStatusNotice />
      <Suspense fallback={<main className="flex min-h-screen items-center justify-center bg-slate-50 text-base text-slate-800 dark:bg-slate-950 dark:text-slate-200">{copy.app.loading}</main>}>
        <RouterProvider router={router} />
      </Suspense>
    </AppProviders>
  )
}
