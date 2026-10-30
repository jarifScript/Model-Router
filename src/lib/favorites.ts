import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import useAuth from '../hooks/useAuth'
import { supabase } from './supabase'

export type FavoriteModel = { providerId: string; modelId: string }
type FavoriteContext = { previous: FavoriteModel[] }
const FAVORITES_QUERY_KEY = ['favorite-models'] as const

function isFavoriteModel(value: unknown): value is FavoriteModel {
  if (typeof value !== 'object' || value === null) return false
  const item = value as Record<string, unknown>
  return typeof item.provider_id === 'string' && typeof item.model_id === 'string'
}

export function useFavoriteModels() {
  const { session } = useAuth()
  const queryClient = useQueryClient()
  const userId = session?.user.id

  const favorites = useQuery({
    queryKey: [...FAVORITES_QUERY_KEY, userId],
    enabled: Boolean(userId && supabase),
    queryFn: async () => {
      if (!supabase || !userId) throw new Error('Sign in to load model favorites.')
      const { data, error } = await supabase
        .from('favorite_models')
        .select('provider_id, model_id, created_at')
        .eq('user_id', userId)
        .order('created_at', { ascending: true })
      if (error) throw error
      return (data ?? []).filter(isFavoriteModel).map((item) => ({
        providerId: item.provider_id,
        modelId: item.model_id,
      }))
    },
    staleTime: 60_000,
  })

  const mutation = useMutation({
    mutationFn: async (favorite: FavoriteModel) => {
      if (!supabase || !userId) throw new Error('Sign in to update model favorites.')
      const exists = (queryClient.getQueryData<FavoriteModel[]>([...FAVORITES_QUERY_KEY, userId]) ?? [])
        .some((item) => item.providerId === favorite.providerId && item.modelId === favorite.modelId)
      const query = exists
        ? supabase.from('favorite_models').delete()
          .eq('user_id', userId)
          .eq('provider_id', favorite.providerId)
          .eq('model_id', favorite.modelId)
        : supabase.from('favorite_models').insert({
          user_id: userId,
          provider_id: favorite.providerId,
          model_id: favorite.modelId,
        })
      const { error } = await query
      if (error) throw error
      return favorite
    },
    onMutate: async (favorite): Promise<FavoriteContext> => {
      if (!userId) throw new Error('Sign in to update model favorites.')
      const queryKey = [...FAVORITES_QUERY_KEY, userId]
      await queryClient.cancelQueries({ queryKey })
      const previous = queryClient.getQueryData<FavoriteModel[]>(queryKey) ?? []
      const exists = previous.some((item) => (
        item.providerId === favorite.providerId && item.modelId === favorite.modelId
      ))
      queryClient.setQueryData(queryKey, exists
        ? previous.filter((item) => (
          item.providerId !== favorite.providerId || item.modelId !== favorite.modelId
        ))
        : [...previous, favorite])
      return { previous }
    },
    onError: (_error, _favorite, context) => {
      if (userId && context) queryClient.setQueryData([...FAVORITES_QUERY_KEY, userId], context.previous)
    },
    onSettled: () => {
      if (userId) void queryClient.invalidateQueries({ queryKey: [...FAVORITES_QUERY_KEY, userId] })
    },
  })

  return {
    favorites: favorites.data ?? [],
    isLoading: favorites.isLoading,
    error: favorites.error,
    toggleFavorite: mutation.mutate,
    isUpdating: mutation.isPending,
    mutationError: mutation.error,
  }
}
