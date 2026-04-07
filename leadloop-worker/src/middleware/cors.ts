import { cors } from 'hono/cors'
import type { AppEnv } from '../lib/types'

export function corsMiddleware() {
  return cors<AppEnv>({
    origin: (origin, c) => {
      const dashboard = c.env.DASHBOARD_URL
      // Allow dashboard origin and Apps Script (no origin header)
      if (!origin || origin === dashboard) {
        return origin || '*'
      }
      return ''
    },
    allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowHeaders: [
      'Content-Type',
      'Authorization',
      'X-Addon-Key',
      'X-User-Email',
    ],
    maxAge: 86400,
  })
}
