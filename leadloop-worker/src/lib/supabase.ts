import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { AppBindings } from './types'

/**
 * Create a Supabase client scoped to an authenticated user's JWT.
 * Respects RLS policies -- the user can only access their own rows.
 */
export function createUserClient(env: AppBindings, accessToken: string): SupabaseClient {
  return createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
    global: {
      headers: { Authorization: `Bearer ${accessToken}` },
    },
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  })
}

/**
 * Create a Supabase admin client using the service role key.
 * Bypasses RLS -- use only for background jobs (cron, queue consumers).
 */
export function createServiceClient(env: AppBindings): SupabaseClient {
  return createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  })
}
