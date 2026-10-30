import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import type { ProviderId } from '../../../src/core/providers.ts'
import type { ProviderErrorClass } from '../../../src/core/adapters/types.ts'
import type { GatewayLogRow } from './gateway-logging.ts'

type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type GatewayDatabase = {
  public: {
    Tables: {
      auto_backup_plans: {
        Row: {
          user_id: string
          targets: Json
          max_attempts: number
          first_token_timeout_ms: number
        }
        Insert: never
        Update: never
        Relationships: []
      }
      gateway_provider_keys: {
        Row: {
          provider_key_id: string
          user_id: string
          provider: ProviderId
          ciphertext: string
          iv: string
        }
        Insert: never
        Update: never
        Relationships: []
      }
      request_logs: {
        Row: GatewayLogRow
        Insert: GatewayLogRow
        Update: Partial<GatewayLogRow>
        Relationships: []
      }
    }
    Views: Record<never, never>
    Functions: {
      consume_gateway_router_key: {
        Args: { p_key_hash: string }
        Returns: {
          router_key_id: string
          user_id: string
          minute_count: number
          day_count: number
          minute_limit: number
          day_limit: number
        }[]
      }
    }
    Enums: Record<never, never>
    CompositeTypes: Record<never, never>
  }
}

export type GatewayClient = SupabaseClient<GatewayDatabase>
