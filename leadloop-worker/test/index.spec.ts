import { describe, it, expect } from 'vitest'
import { SELF } from 'cloudflare:test'

describe('LeadLoop Worker', () => {
  it('responds to health check', async () => {
    const response = await SELF.fetch('http://localhost/health')
    expect(response.status).toBe(200)
    const body = await response.json<{ status: string }>()
    expect(body.status).toBe('ok')
  })

  it('returns 401 for unauthenticated API requests', async () => {
    const response = await SELF.fetch('http://localhost/api/templates')
    expect(response.status).toBe(401)
  })

  it('returns 401 for unauthenticated addon requests', async () => {
    const response = await SELF.fetch('http://localhost/addon/context', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })
    expect(response.status).toBe(401)
  })
})
