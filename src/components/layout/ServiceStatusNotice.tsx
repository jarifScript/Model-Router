import { useEffect, useState } from 'react'
import { copy } from '../../lib/copy'

type ServiceState = 'offline' | 'unavailable' | null
const HEALTH_CHECK_INTERVAL_MS = 5 * 60_000
const HEALTH_CHECK_TIMEOUT_MS = 8_000

export default function ServiceStatusNotice() {
  const [serviceState, setServiceState] = useState<ServiceState>(null)

  useEffect(() => {
    const configuredUrl = import.meta.env.VITE_SUPABASE_URL
    const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY
    if (!configuredUrl || !anonKey) return

    let active = true
    let controller: AbortController | null = null

    async function checkService() {
      if (!navigator.onLine) {
        setServiceState('offline')
        return
      }
      setServiceState(null)
      controller?.abort()
      controller = new AbortController()
      try {
        const healthUrl = new URL('/auth/v1/health', configuredUrl)
        const response = await fetch(healthUrl, {
          method: 'GET',
          cache: 'no-store',
          headers: { apikey: anonKey },
          signal: AbortSignal.any([
            controller.signal,
            AbortSignal.timeout(HEALTH_CHECK_TIMEOUT_MS),
          ]),
        })
        if (active) setServiceState(response.ok ? null : 'unavailable')
      } catch {
        if (active) setServiceState('unavailable')
      }
    }

    function updateOnlineStatus() {
      if (navigator.onLine) void checkService()
      else setServiceState('offline')
    }

    void checkService()
    const intervalId = window.setInterval(() => { void checkService() }, HEALTH_CHECK_INTERVAL_MS)
    window.addEventListener('online', updateOnlineStatus)
    window.addEventListener('offline', updateOnlineStatus)
    return () => {
      active = false
      controller?.abort()
      window.clearInterval(intervalId)
      window.removeEventListener('online', updateOnlineStatus)
      window.removeEventListener('offline', updateOnlineStatus)
    }
  }, [])

  if (!serviceState) return null
  return (
    <div role="status" aria-live="polite" className="border-b border-amber-400 bg-amber-50 px-4 py-2 text-center text-sm font-medium text-amber-950 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100">
      {serviceState === 'offline' ? copy.app.offlineNotice : copy.app.serviceUnavailableNotice}
    </div>
  )
}
