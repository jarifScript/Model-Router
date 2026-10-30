import type { ProviderErrorClass } from '../core/adapters/types'
import type { ProviderId } from '../core/providers'
import { supabase } from './supabase'

export type RequestLogSource = 'single' | 'auto' | 'route' | 'gateway'
export type RequestLogStatus = 'success' | 'error' | 'aborted'

export function getRequestLogSource(isSavedRoute: boolean, isAuto: boolean): RequestLogSource {
  if (isSavedRoute) return 'route'
  return isAuto ? 'auto' : 'single'
}

export type RequestLogRow = {
  user_id: string
  created_at: string
  source: RequestLogSource
  route_alias: string | null
  provider: ProviderId
  model: string
  key_id: string | null
  latency_ms: number
  ttfb_ms: number | null
  input_tokens: number | null
  output_tokens: number | null
  tokens_estimated: boolean
  status: RequestLogStatus
  http_status: number | null
  error_class: ProviderErrorClass | null
  fallback_count: number
  est_cost_usd: number | null
  est_baseline_cost_usd: number | null
  est_saved_usd: number | null
}

export type RequestLogOptions = {
  isTest?: boolean
  isSimulation?: boolean
  source?: RequestLogSource | 'test' | 'simulation'
}

type RequestLogger = {
  enqueue: (row: RequestLogRow, options?: RequestLogOptions) => boolean
  flush: () => Promise<void>
  flushAll: () => Promise<void>
  queuedCount: () => number
}

type InsertRows = (rows: readonly RequestLogRow[]) => Promise<void>

const FLUSH_INTERVAL_MS = 5_000
const FLUSH_THRESHOLD = 20
const MAX_QUEUED_ROWS = 200

export function resolveTokenCounts(
  inputTokens: number | null,
  outputTokens: number | null,
  inputCharacters: number,
  outputCharacters: number,
): { inputTokens: number; outputTokens: number; tokensEstimated: boolean } {
  if (inputTokens !== null && outputTokens !== null) {
    return { inputTokens, outputTokens, tokensEstimated: false }
  }
  return {
    inputTokens: Math.ceil(inputCharacters / 4),
    outputTokens: Math.ceil(outputCharacters / 4),
    tokensEstimated: true,
  }
}

export function createRequestLogger(
  insertRows: InsertRows,
  onSuccess?: () => void,
): RequestLogger {
  const queue: RequestLogRow[] = []
  let flushTimer: ReturnType<typeof setTimeout> | null = null
  let flushPromise: Promise<void> | null = null

  function clearFlushTimer() {
    if (flushTimer !== null) {
      clearTimeout(flushTimer)
      flushTimer = null
    }
  }

  function scheduleFlush() {
    if (flushTimer !== null || queue.length === 0) return
    flushTimer = setTimeout(() => {
      flushTimer = null
      void flush()
    }, FLUSH_INTERVAL_MS)
  }

  function flush(): Promise<void> {
    if (flushPromise) return flushPromise
    if (queue.length === 0) return Promise.resolve()
    clearFlushTimer()
    const batch = queue.splice(0, MAX_QUEUED_ROWS)

    const attempt = async () => {
      let saved = false
      try {
        await insertRows(batch)
        saved = true
      } catch {
        try {
          await insertRows(batch)
          saved = true
        } catch {
          saved = false
        }
      } finally {
        try {
          if (saved) onSuccess?.()
        } finally {
          flushPromise = null
          if (queue.length >= FLUSH_THRESHOLD) void flush()
          else scheduleFlush()
        }
      }
    }

    flushPromise = attempt()
    return flushPromise
  }

  function enqueue(row: RequestLogRow, options: RequestLogOptions = {}): boolean {
    if (options.isTest || options.isSimulation
      || options.source === 'test' || options.source === 'simulation') return false
    if (queue.length === MAX_QUEUED_ROWS) queue.shift()
    queue.push(row)
    if (queue.length >= FLUSH_THRESHOLD) void flush()
    else scheduleFlush()
    return true
  }

  async function flushAll(): Promise<void> {
    clearFlushTimer()
    while (queue.length > 0 || flushPromise !== null) {
      if (flushPromise) await flushPromise
      else await flush()
    }
  }

  return { enqueue, flush, flushAll, queuedCount: () => queue.length }
}

const logger = createRequestLogger(async (rows) => {
  if (!supabase) throw new Error('Activity logging is unavailable.')
  const { error } = await supabase.from('request_logs').insert(rows.map((row) => ({ ...row })))
  if (error) throw error
}, () => {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event('request-logs-updated'))
})

export function enqueueRequestLog(row: RequestLogRow, options?: RequestLogOptions): boolean {
  return logger.enqueue(row, options)
}

export function flushRequestLogs(): Promise<void> {
  return logger.flushAll()
}

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') void logger.flush()
  })
}
