import { createMiddleware } from 'hono/factory'
import type { AppEnv } from '../lib/types'
import { createUserClient, createServiceClient } from '../lib/supabase'
import { debug } from '../lib/debug'

const profileCache = new Map<string, { userId: string; expiresAt: number }>()
const CACHE_TTL_MS = 5 * 60 * 1000

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
  const t0 = Date.now()
  const apiKey = c.req.header('X-Addon-Key')
  const userEmail = c.req.header('X-User-Email')

  if (!apiKey || !userEmail) {
    return c.json({ error: 'Missing add-on credentials' }, 401)
  }

  if (apiKey !== c.env.ADDON_API_KEY) {
    return c.json({ error: 'Invalid add-on API key' }, 403)
  }

  const cached = profileCache.get(userEmail)
  if (cached && cached.expiresAt > Date.now()) {
    debug(c.env, `[timing] addonAuth cache hit: ${Date.now() - t0}ms`)
    const admin = createServiceClient(c.env)
    c.set('userId', cached.userId)
    c.set('supabase', admin)
    await next()
    return
  }

  const admin = createServiceClient(c.env)
  const { data: profile, error } = await admin
    .from('profiles')
    .select('id')
    .eq('gmail_email', userEmail)
    .single()

  debug(c.env, `[timing] addonAuth profile lookup: ${Date.now() - t0}ms`)

  if (error || !profile) {
    return c.json({ error: 'User not found' }, 404)
  }

  profileCache.set(userEmail, {
    userId: profile.id,
    expiresAt: Date.now() + CACHE_TTL_MS,
  })

  c.set('userId', profile.id)
  c.set('supabase', admin)
  await next()
})
