import { createClient } from 'npm:@supabase/supabase-js@2'

export async function getRouteRateLimit(request: Request): Promise<boolean | null> {
  const authorization = request.headers.get('authorization')
  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')
  if (!authorization || !supabaseUrl || !supabaseAnonKey) return null

  const client = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { data, error } = await client.rpc('consume_route_rate_limit')
  if (error || typeof data !== 'boolean') return null
  return data
}
