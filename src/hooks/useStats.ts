import { useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { isProviderId, type ProviderId } from '../core/providers'
import useAuth from './useAuth'
import { supabase } from '../lib/supabase'

export type DailyActivity = {
  day: string
  requests: number
  successes: number
  errors: number
  fallbacks: number
}

export type ServiceActivity = {
  provider: ProviderId
  requests: number
  successes: number
  fallbacks: number
}

export type UsageStats = {
  messagesSent: number
  gatewayRequests: number
  workedPercent: number
  successfulMessages: number
  errors: number
  aborted: number
  fallbacks: number
  averageSpeedMs: number | null
  inputTokens: number | null
  outputTokens: number | null
  estimatedCost: number | null
  baselineCost: number | null
  estimatedSaved: number | null
  daily: DailyActivity[]
  byService: ServiceActivity[]
}

function rollupStorageKey(userId: string): string {
  const utcDay = new Date().toISOString().slice(0, 10)
  return `activity-rollup:${userId}:${utcDay}`
}

async function rollUpOldActivity(userId: string) {
  if (!supabase) throw new Error('Sign in to load your stats.')
  const marker = rollupStorageKey(userId)
  if (window.localStorage.getItem(marker) === 'done') return
  const { error } = await supabase.rpc('rollup_and_prune')
  if (error) throw error
  window.localStorage.setItem(marker, 'done')
}

function numberOrZero(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function nullableNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function parseActivitySummary(value: unknown, gatewayRequests: unknown): UsageStats {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('The activity summary could not be read.')
  }
  const record = value as Record<string, unknown>
  const messagesSent = numberOrZero(record.requests)
  const successfulMessages = numberOrZero(record.successes)
  const errors = numberOrZero(record.errors)
  const completed = successfulMessages + errors
  const saved = nullableNumber(record.estimated_saved_usd)
  const dailyRows = Array.isArray(record.daily) ? record.daily : []
  const serviceRows = Array.isArray(record.by_service) ? record.by_service : []

  return {
    messagesSent,
    gatewayRequests: numberOrZero(gatewayRequests),
    workedPercent: completed ? Math.round(successfulMessages / completed * 100) : 0,
    successfulMessages,
    errors,
    aborted: numberOrZero(record.aborted),
    fallbacks: numberOrZero(record.fallbacks),
    averageSpeedMs: nullableNumber(record.avg_latency_ms),
    inputTokens: nullableNumber(record.input_tokens),
    outputTokens: nullableNumber(record.output_tokens),
    estimatedCost: nullableNumber(record.cost_usd),
    baselineCost: nullableNumber(record.baseline_cost_usd),
    estimatedSaved: saved === null ? null : Math.max(saved, 0),
    daily: dailyRows.flatMap((item) => {
      if (typeof item !== 'object' || item === null || Array.isArray(item)) return []
      const daily = item as Record<string, unknown>
      if (typeof daily.day !== 'string') return []
      return [{
        day: daily.day,
        requests: numberOrZero(daily.requests),
        successes: numberOrZero(daily.successes),
        errors: numberOrZero(daily.errors),
        fallbacks: numberOrZero(daily.fallbacks),
      }]
    }),
    byService: serviceRows.flatMap((item) => {
      if (typeof item !== 'object' || item === null || Array.isArray(item)) return []
      const service = item as Record<string, unknown>
      if (typeof service.provider !== 'string' || !isProviderId(service.provider)) return []
      return [{
        provider: service.provider,
        requests: numberOrZero(service.requests),
        successes: numberOrZero(service.successes),
        fallbacks: numberOrZero(service.fallbacks),
      }]
    }),
  }
}

export default function useStats(days: 7 | 30 = 7) {
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const query = useQuery({
    queryKey: ['home-stats', user?.id, days],
    enabled: Boolean(user && supabase),
    staleTime: 60_000,
    queryFn: async (): Promise<UsageStats> => {
      if (!supabase || !user) throw new Error('Sign in to load your stats.')
      await rollUpOldActivity(user.id)
      const [activityResult, gatewayResult] = await Promise.all([
        supabase.rpc('get_activity_summary', { p_days: days }),
        supabase.rpc('get_gateway_activity_summary', { p_days: days }),
      ])
      if (activityResult.error) throw activityResult.error
      if (gatewayResult.error) throw gatewayResult.error
      return parseActivitySummary(activityResult.data, gatewayResult.data)
    },
  })

  useEffect(() => {
    const refresh = () => {
      void queryClient.invalidateQueries({ queryKey: ['home-stats', user?.id] })
    }
    window.addEventListener('request-logs-updated', refresh)
    return () => window.removeEventListener('request-logs-updated', refresh)
  }, [queryClient, user?.id])

  return query
}
