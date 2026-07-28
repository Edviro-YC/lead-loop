import { cors } from 'hono/cors'
import type { AppBindings } from '../lib/types'

export function corsMiddleware() {
  // hono >= 4.12 removed the type param on cors(); env is untyped here
  return cors({
    origin: (origin, c) => {
      const dashboard = (c.env as AppBindings).DASHBOARD_URL
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
      'Mcp-Session-Id',
      'Mcp-Protocol-Version',
      'Last-Event-ID',
    ],
    exposeHeaders: ['Mcp-Session-Id'],
    maxAge: 86400,
  })
}
