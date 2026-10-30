// Checks provider credentials through the authenticated, allowlisted Edge Function.
import { useState } from 'react'
import { supabase } from '../../lib/supabase'
import type { ProviderId } from '../../types'
import { copy } from '../../lib/copy'

export default function KeyTestButton({
  provider,
  apiKey,
  onStatusChange,
}: {
  provider: ProviderId
  apiKey: string
  onStatusChange: (works: boolean) => void
}) {
  const [status, setStatus] = useState<'works' | 'failed' | null>(null)
  const [isTesting, setIsTesting] = useState(false)

  async function testKey() {
    if (!supabase) {
      setStatus('failed')
      onStatusChange(false)
      return
    }

    setIsTesting(true)
    setStatus(null)
    try {
      let works = false
      const { data, error } = await supabase.functions.invoke<{
        ok: boolean
        message: string
      }>('route', {
        body: { action: 'test_key', providerId: provider },
        headers: { 'x-provider-api-key': apiKey },
      })
      if (error) {
        setStatus('failed')
      } else if (!data) {
        setStatus('failed')
      } else {
        works = data.ok
        setStatus(works ? 'works' : 'failed')
      }
      onStatusChange(works)
    } catch {
      setStatus('failed')
      onStatusChange(false)
    } finally {
      setIsTesting(false)
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={testKey}
        disabled={isTesting}
        aria-label={isTesting ? copy.keys.checkLoading : copy.keys.check}
        title={isTesting ? copy.keys.checkLoading : copy.keys.check}
        className="inline-flex size-11 shrink-0 items-center justify-center rounded-lg border border-slate-400 text-slate-800 hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-indigo-600 disabled:opacity-50 dark:border-slate-600 dark:text-white dark:hover:bg-slate-800"
      >
        {isTesting ? (
          <svg aria-hidden="true" className="size-5 animate-spin" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-80" fill="currentColor" d="M4 12a8 8 0 0 1 8-8V0C5.37 0 0 5.37 0 12h4Zm2 5.3A7.96 7.96 0 0 1 4 12H0c0 3.04 1.13 5.82 3 7.94l3-2.64Z" />
          </svg>
        ) : (
          <svg aria-hidden="true" className="size-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M20 7v5h-5" />
            <path d="M19 12a7 7 0 1 1-2-5" />
          </svg>
        )}
      </button>
      {status && (
        <span role="status" className={`rounded-full px-3 py-1 text-sm font-semibold ${status === 'works' ? 'bg-emerald-100 text-emerald-950 dark:bg-emerald-950 dark:text-emerald-100' : 'bg-red-100 text-red-950 dark:bg-red-950 dark:text-red-100'}`}>
          {status === 'works' ? copy.keys.works : copy.keys.notWorking}
        </span>
      )}
    </div>
  )
}
