import type { SupabaseClient } from '@supabase/supabase-js'
import type { Context } from 'hono'

/**
 * Worker environment bindings.
 * After updating wrangler.jsonc, run `npm run cf-typegen` to regenerate
 * the global Env interface in worker-configuration.d.ts. This local type
 * is used by Hono generics and can be kept in sync manually until then.
 */
export interface AppBindings {
  // Vars (wrangler.jsonc vars)
  SUPABASE_URL: string
  SUPABASE_ANON_KEY: string
  DASHBOARD_URL: string

  // Secrets (set via `wrangler secret put`)
  SUPABASE_SERVICE_ROLE_KEY: string
  OPENAI_API_KEY: string
  GOOGLE_CLIENT_ID: string
  GOOGLE_CLIENT_SECRET: string
  ADDON_API_KEY: string
  MCP_API_KEY: string

  // Optional
  DEBUG?: string

  // Queue producer bindings
  FOLLOW_UP_DRAFT_QUEUE: Queue
  EMBED_EXAMPLE_QUEUE: Queue
}

export interface AppVariables {
  userId: string
  supabase: SupabaseClient
}

export type AppEnv = {
  Bindings: AppBindings
  Variables: AppVariables
}

export type AppContext = Context<AppEnv>

// Queue message payload types
export interface FollowUpDraftMessage {
  scheduledFollowUpId: string
  userId: string
}

export interface EmbedExampleMessage {
  exampleId: string
}
