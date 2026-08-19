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
    const response = await SELF.fetch('http://localhost/api/runs')
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
      expect(body.result.tools).toHaveLength(16)
      expect(body.result.tools.map((t) => t.name)).toContain('start_sequence')
    })

    it('rejects start_sequence when variables are missing', async () => {
      const json = { headers: { 'Content-Type': 'application/json' } }
      const origin = fetchMock.get('https://test-project.supabase.co')
      origin
        .intercept({ method: 'GET', path: /^\/rest\/v1\/sequences/ })
        .reply(
          200,
          JSON.stringify({
            id: 'seq-1',
            name: 'K-12 outreach',
            steps: [{ body: 'Hi {{first_name}} of {{company}}, bumping this.', delay_days: 3 }],
          }),
          json
        )

      const response = await SELF.fetch('http://localhost/mcp', {
        method: 'POST',
        headers: authedHeaders,
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 3,
          method: 'tools/call',
          params: {
            name: 'start_sequence',
            arguments: { sequence_id: 'seq-1', recipient_email: 'lead@example.com' },
          },
        }),
      })
      expect(response.status).toBe(200)
      const body = await readJsonRpc<{
        result: { content: Array<{ text: string }>; isError?: boolean }
      }>(response)
      expect(body.result.isError).toBe(true)
      expect(body.result.content[0].text).toContain('Missing variables: first_name, company')
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
      'delete_example',
      'delete_sequence',
      'draft_now',
      'get_run',
      'get_sequence',
      'list_examples',
      'list_runs',
      'list_sequences',
      'save_run_as_example',
      'send_leadloop_drafts',
      'start_sequence',
      'stop_run',
      'update_example',
      'update_sequence',
    ])

    // Both bulk tools demand an explicit non-empty selection — an empty or
    // missing run_ids can never mean "all" — and send is marked destructive.
    const draftNow = tools.find((t) => t.name === 'draft_now')!
    expect(draftNow.inputSchema.required).toEqual(['run_ids'])
    const draftIds = draftNow.inputSchema.properties?.run_ids as {
      minItems?: number
      maxItems?: number
    }
    expect(draftIds.minItems).toBe(1)
    expect(draftIds.maxItems).toBe(50)
    expect(draftNow.annotations?.destructiveHint).toBe(false)

    const sendDrafts = tools.find((t) => t.name === 'send_leadloop_drafts')!
    expect(sendDrafts.inputSchema.required).toEqual(['run_ids'])
    const sendIds = sendDrafts.inputSchema.properties?.run_ids as {
      minItems?: number
      maxItems?: number
    }
    expect(sendIds.minItems).toBe(1)
    expect(sendIds.maxItems).toBe(20)
    expect(sendDrafts.annotations?.destructiveHint).toBe(true)
    expect(sendDrafts.annotations?.idempotentHint).toBe(true)
    expect(sendDrafts.description).toContain('SENDS REAL EMAIL')

    await client.close()
  })
})
