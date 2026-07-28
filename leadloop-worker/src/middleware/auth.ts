import { createMiddleware } from 'hono/factory'
import type { Context } from 'hono'
import type { AppEnv } from '../lib/types'
import { createUserClient, createServiceClient } from '../lib/supabase'
import { debug } from '../lib/debug'

const profileCache = new Map<string, { userId: string; expiresAt: number }>()
const CACHE_TTL_MS = 5 * 60 * 1000

/**
 * Resolve a user id from a gmail email via the profiles table,
 * using a short-lived in-memory cache to avoid a DB roundtrip per request.
 * Returns null if no profile matches.
 */
async function resolveUserIdByEmail(
  c: Context<AppEnv>,
  userEmail: string
): Promise<string | null> {
  const t0 = Date.now()

  const cached = profileCache.get(userEmail)
  if (cached && cached.expiresAt > Date.now()) {
    debug(c.env, `[timing] profile lookup cache hit: ${Date.now() - t0}ms`)
    return cached.userId
  }

  const admin = createServiceClient(c.env)
  const { data: profile, error } = await admin
    .from('profiles')
    .select('id')
    .eq('gmail_email', userEmail)
    .single()

  debug(c.env, `[timing] profile lookup: ${Date.now() - t0}ms`)

  if (error || !profile) return null

  profileCache.set(userEmail, {
    userId: profile.id,
    expiresAt: Date.now() + CACHE_TTL_MS,
  })

  return profile.id
}

/**
 * JWT auth middleware for dashboard requests.
 * Validates the Supabase access token from the Authorization header,
 * then sets `userId` and a user-scoped `supabase` client on the context.
 */
export const jwtAuth = createMiddleware<AppEnv>(async (c, next) => {
  const header = c.req.header('Authorization')
  if (!header?.startsWith('Bearer ')) {
    return c.json({ error: 'Missing or malformed Authorization header' }, 401)
  }

  const token = header.slice(7)
  const supabase = createUserClient(c.env, token)
  const { data: { user }, error } = await supabase.auth.getUser(token)

  if (error || !user) {
    return c.json({ error: 'Invalid or expired token' }, 401)
  }

  c.set('userId', user.id)
  c.set('supabase', supabase)
  await next()
})

/**
 * API-key auth middleware for Gmail add-on requests.
 * The add-on sends X-Addon-Key and X-User-Email headers.
 * We validate the key and look up the user by email.
 */
export const addonAuth = createMiddleware<AppEnv>(async (c, next) => {
  const apiKey = c.req.header('X-Addon-Key')
  const userEmail = c.req.header('X-User-Email')

  if (!apiKey || !userEmail) {
    return c.json({ error: 'Missing add-on credentials' }, 401)
  }

  if (apiKey !== c.env.ADDON_API_KEY) {
    return c.json({ error: 'Invalid add-on API key' }, 403)
  }

  const userId = await resolveUserIdByEmail(c, userEmail)
  if (!userId) {
    return c.json({ error: 'User not found' }, 404)
  }

  c.set('userId', userId)
  c.set('supabase', createServiceClient(c.env))
  await next()
})

/**
 * API-key auth middleware for MCP requests.
 * MCP clients send `Authorization: Bearer <MCP_API_KEY>` plus an
 * X-User-Email header identifying which LeadLoop user the agent acts as.
 */
export const mcpAuth = createMiddleware<AppEnv>(async (c, next) => {
  const header = c.req.header('Authorization')
  const userEmail = c.req.header('X-User-Email')

  if (!header?.startsWith('Bearer ') || !userEmail) {
    return c.json({ error: 'Missing MCP credentials' }, 401)
  }

  if (header.slice(7) !== c.env.MCP_API_KEY) {
    return c.json({ error: 'Invalid MCP API key' }, 403)
  }

  const userId = await resolveUserIdByEmail(c, userEmail)
  if (!userId) {
    return c.json({ error: 'User not found' }, 404)
  }

  c.set('userId', userId)
  c.set('supabase', createServiceClient(c.env))
  await next()
})
