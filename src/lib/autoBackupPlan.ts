import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  DEFAULT_AUTO_BACKUP_ATTEMPTS,
  DEFAULT_FIRST_TOKEN_TIMEOUT_MS,
  parseAutoBackupPlan,
  type AutoBackupPlan,
} from '../core/auto-backup-plan'
import useAuth from '../hooks/useAuth'
import { supabase } from './supabase'

const EMPTY_PLAN: AutoBackupPlan = {
  targets: [],
  maxAttempts: DEFAULT_AUTO_BACKUP_ATTEMPTS,
  firstTokenTimeoutMs: DEFAULT_FIRST_TOKEN_TIMEOUT_MS,
}

function planQueryKey(userId: string | undefined) {
  return ['auto-backup-plan', userId]
}

export function useAutoBackupPlan() {
  const { session } = useAuth()
  const queryClient = useQueryClient()
  const userId = session?.user.id
  const query = useQuery({
    queryKey: planQueryKey(userId),
    enabled: Boolean(userId && supabase),
    queryFn: async (): Promise<AutoBackupPlan> => {
      if (!supabase || !userId) throw new Error('Your backup plan is unavailable.')
      const { data, error } = await supabase
        .from('auto_backup_plans')
        .select('targets, max_attempts, first_token_timeout_ms')
        .eq('user_id', userId)
        .maybeSingle()
      if (error) throw error
      if (!data) return EMPTY_PLAN
      const plan = parseAutoBackupPlan(data)
      if (!plan) throw new Error('Your saved backup plan could not be read.')
      return plan
    },
    staleTime: 60_000,
  })
  const mutation = useMutation({
    mutationFn: async (plan: AutoBackupPlan) => {
      if (!supabase || !userId) throw new Error('Sign in to save your backup plan.')
      const { error } = await supabase.from('auto_backup_plans').upsert({
        user_id: userId,
        targets: plan.targets.map(({ provider, model, keyId, timeoutMs }) => ({
          provider,
          model,
          keyId,
          timeoutMs: timeoutMs ?? 30_000,
        })),
        max_attempts: plan.maxAttempts,
        first_token_timeout_ms: plan.firstTokenTimeoutMs,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'user_id' })
      if (error) throw error
      return plan
    },
    onMutate: async (plan) => {
      await queryClient.cancelQueries({ queryKey: planQueryKey(userId) })
      const previous = queryClient.getQueryData<AutoBackupPlan>(planQueryKey(userId))
      queryClient.setQueryData(planQueryKey(userId), plan)
      return { previous }
    },
    onError: (_error, _plan, context) => {
      if (context?.previous) queryClient.setQueryData(planQueryKey(userId), context.previous)
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: planQueryKey(userId) }),
  })

  return {
    plan: query.data ?? EMPTY_PLAN,
    isLoading: query.isLoading,
    error: query.error,
    savePlan: mutation.mutateAsync,
    isSaving: mutation.isPending,
  }
}
