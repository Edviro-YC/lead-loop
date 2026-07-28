import type { SupabaseClient } from '@supabase/supabase-js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import type { AppBindings } from '../lib/types'

/**
 * Per-request context shared by all MCP tool handlers.
 * `supabase` is the service-role client, so every query MUST be
 * explicitly scoped to `userId` (RLS is bypassed).
 */
export interface ToolContext {
  supabase: SupabaseClient
  env: AppBindings
  userId: string
}

export function jsonResult(data: unknown): CallToolResult {
  return {
    content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
  }
}

export function errorResult(message: string): CallToolResult {
  return {
    content: [{ type: 'text', text: `Error: ${message}` }],
    isError: true,
  }
}
