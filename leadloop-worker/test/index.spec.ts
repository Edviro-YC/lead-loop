import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { SELF, fetchMock } from 'cloudflare:test'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import type { SupabaseClient } from '@supabase/supabase-js'
import { buildMcpServer } from '../src/mcp/server'
import type { AppBindings } from '../src/lib/types'

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

describe('MCP endpoint', () => {
  const initializeBody = JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'test-client', version: '1.0.0' },
    },
  })

  it('returns 401 without credentials', async () => {
    const response = await SELF.fetch('http://localhost/mcp', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
      },
      body: initializeBody,
    })
    expect(response.status).toBe(401)
  })

  it('returns 403 with an invalid API key', async () => {
    const response = await SELF.fetch('http://localhost/mcp', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        Authorization: 'Bearer definitely-not-the-key',
        'X-User-Email': 'someone@example.com',
      },
      body: initializeBody,
    })
    expect(response.status).toBe(403)
  })

  describe('with valid credentials', () => {
    beforeAll(() => {
      fetchMock.activate()
      fetchMock.disableNetConnect()
      // Profile lookup performed by mcpAuth (cached after first call)
      fetchMock
        .get('https://test-project.supabase.co')
        .intercept({ method: 'GET', path: /^\/rest\/v1\/profiles/ })
        .reply(200, JSON.stringify({ id: '00000000-0000-4000-8000-000000000001' }), {
          headers: { 'Content-Type': 'application/json' },
        })
        .persist()
    })

    afterAll(() => {
      fetchMock.deactivate()
    })

    const authedHeaders = {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      Authorization: 'Bearer test-mcp-key',
      'X-User-Email': 'agent@example.com',
    }

    /** The transport may reply as JSON or as a single-event SSE stream. */
    async function readJsonRpc<T>(response: Response): Promise<T> {
      const text = await response.text()
      if (response.headers.get('content-type')?.includes('text/event-stream')) {
        const dataLine = text.split('\n').find((line) => line.startsWith('data: '))
        if (!dataLine) throw new Error(`No data frame in SSE response: ${text}`)
        return JSON.parse(dataLine.slice(6)) as T
      }
      return JSON.parse(text) as T
    }

    it('completes the initialize handshake', async () => {
      const response = await SELF.fetch('http://localhost/mcp', {
        method: 'POST',
        headers: authedHeaders,
        body: initializeBody,
      })
      expect(response.status).toBe(200)
      const body = await readJsonRpc<{ result: { serverInfo: { name: string } } }>(response)
      expect(body.result.serverInfo.name).toBe('leadloop')
    })

    it('lists tools over HTTP', async () => {
      const response = await SELF.fetch('http://localhost/mcp', {
        method: 'POST',
        headers: authedHeaders,
        body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }),
      })
      expect(response.status).toBe(200)
      const body = await readJsonRpc<{ result: { tools: Array<{ name: string }> } }>(response)
      expect(body.result.tools).toHaveLength(24)
      expect(body.result.tools.map((t) => t.name)).toContain('search_examples')
    })

    it('schedules a follow-up via tools/call', async () => {
      const json = { headers: { 'Content-Type': 'application/json' } }
      const origin = fetchMock.get('https://test-project.supabase.co')
      origin
        .intercept({ method: 'GET', path: /^\/rest\/v1\/watched_threads/ })
        .reply(200, JSON.stringify([{ id: 'thread-1' }]), json)
      origin
        .intercept({ method: 'GET', path: /^\/rest\/v1\/scheduled_follow_ups/ })
        .reply(200, '[]', json)
      origin
        .intercept({ method: 'POST', path: /^\/rest\/v1\/follow_up_rules/ })
        .reply(201, JSON.stringify({ id: 'rule-1', delay_days: 5 }), json)
      origin
        .intercept({ method: 'POST', path: /^\/rest\/v1\/scheduled_follow_ups/ })
        .reply(201, JSON.stringify({ id: 'sched-1', scheduled_for: '2026-08-01T00:00:00Z' }), json)

      const response = await SELF.fetch('http://localhost/mcp', {
        method: 'POST',
        headers: authedHeaders,
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 3,
          method: 'tools/call',
          params: { name: 'schedule_follow_up', arguments: { thread_id: 'thread-1', delay_days: 5 } },
        }),
      })
      expect(response.status).toBe(200)
      const body = await readJsonRpc<{
        result: { content: Array<{ text: string }>; isError?: boolean }
      }>(response)
      expect(body.result.isError).toBeFalsy()
      const payload = JSON.parse(body.result.content[0].text)
      expect(payload.rule_id).toBe('rule-1')
      expect(payload.scheduled_for).toBe('2026-08-01T00:00:00Z')
    })
  })
})

describe('MCP server tools', () => {
  it('registers all LeadLoop tools', async () => {
    const server = buildMcpServer({
      supabase: {} as SupabaseClient,
      env: {} as AppBindings,
      userId: 'test-user',
    })

    const client = new Client({ name: 'test-client', version: '1.0.0' })
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
    await Promise.all([client.connect(clientTransport), server.connect(serverTransport)])

    const { tools } = await client.listTools()
    const names = tools.map((t) => t.name).sort()

    expect(names).toEqual([
      'create_example',
      'create_sequence',
      'create_template',
      'delete_example',
      'delete_sequence',
      'delete_template',
      'get_sequence',
      'get_template',
      'get_thread_messages',
      'list_examples',
      'list_sequences',
      'list_templates',
      'list_watched_threads',
      'preview_follow_up_draft',
      'schedule_follow_up',
      'search_examples',
      'set_sequence_steps',
      'sync_thread',
      'trigger_follow_up',
      'update_example',
      'update_sequence',
      'update_template',
      'update_watched_thread',
      'watch_thread',
    ])

    await client.close()
  })
})
