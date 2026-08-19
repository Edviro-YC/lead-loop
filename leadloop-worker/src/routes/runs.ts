import { Hono } from 'hono'
import type { AppEnv } from '../lib/types'
import { syncThreadFromGmail } from '../jobs/thread-sync'
import {
  startSequence,
  stopRun,
  saveRunAsExample,
  draftNow,
  sendLeadLoopDrafts,
} from '../services/runs'

const runs = new Hono<AppEnv>()

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * HTTP trust boundary for bulk run selections: explicit, non-empty,
 * deduplicated UUID arrays with a hard cap. Empty never means "all".
 */
function parseRunIds(body: unknown, max: number): string[] {
  const raw = (body as { run_ids?: unknown } | null)?.run_ids
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new Error('run_ids must be a non-empty array of run UUIDs')
  }
  const ids = [...new Set(raw)]
  if (ids.length > max) throw new Error(`At most ${max} runs per call`)
  if (!ids.every((id) => typeof id === 'string' && UUID_RE.test(id))) {
    throw new Error('run_ids must be UUIDs')
  }
  return ids as string[]
}

/** List runs, optionally filtered by status or sequence. */
runs.get('/', async (c) => {
  const supabase = c.get('supabase')
  const userId = c.get('userId')
  const status = c.req.query('status')
  const sequenceId = c.req.query('sequence_id')

  let query = supabase
    .from('watched_threads')
    .select('*, sequences(name)')
    .eq('user_id', userId)
    .order('last_activity_at', { ascending: false, nullsFirst: false })

  if (status) query = query.eq('status', status)
  if (sequenceId) query = query.eq('sequence_id', sequenceId)

  const { data, error } = await query
  if (error) return c.json({ error: error.message }, 500)
  return c.json({ runs: data })
})

/** Start a sequence on a sent thread (the dashboard door). */
runs.post('/start', async (c) => {
  const body = await c.req.json<{
    sequence_id: string
    gmail_thread_id?: string
    recipient_email?: string
    variables?: Record<string, string>
  }>()

  try {
    const result = await startSequence(c.get('supabase'), c.env, c.get('userId'), {
      sequenceId: body.sequence_id,
      gmailThreadId: body.gmail_thread_id,
      recipientEmail: body.recipient_email,
      variables: body.variables,
    })
    return c.json(result, 201)
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : String(err) }, 400)
  }
})

/** Bump selected runs' pending follow-ups to draft immediately. Drafts only. */
runs.post('/draft-now', async (c) => {
  try {
    const ids = parseRunIds(await c.req.json(), 50)
    const result = await draftNow(
      c.get('supabase'),
      c.env.FOLLOW_UP_DRAFT_QUEUE,
      c.get('userId'),
      ids
    )
    return c.json(result)
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : String(err) }, 400)
  }
})

/** Send selected runs' LeadLoop-created Gmail drafts. Sends real email. */
runs.post('/send-drafts', async (c) => {
  try {
    const ids = parseRunIds(await c.req.json(), 20)
    const result = await sendLeadLoopDrafts(c.get('supabase'), c.env, c.get('userId'), ids)
    return c.json(result)
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : String(err) }, 400)
  }
})

runs.get('/:id/messages', async (c) => {
  const supabase = c.get('supabase')
  const id = c.req.param('id')

  const { data, error } = await supabase
    .from('thread_messages')
    .select('*')
    .eq('thread_id', id)
    .order('sent_at', { ascending: true })

  if (error) return c.json({ error: error.message }, 500)
  return c.json({ messages: data })
})

runs.post('/:id/stop', async (c) => {
  try {
    const run = await stopRun(c.get('supabase'), c.get('userId'), c.req.param('id'))
    return c.json({ run })
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : String(err) }, 400)
  }
})

runs.post('/:id/save-as-example', async (c) => {
  const { context, outcome, tags } = await c.req.json<{
    context?: string
    outcome?: string
    tags?: string[]
  }>()

  try {
    const example = await saveRunAsExample(c.get('supabase'), c.get('userId'), c.req.param('id'), {
      context,
      outcome,
      tags,
    })
    return c.json({ example }, 201)
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : String(err) }, 400)
  }
})

runs.post('/:id/sync', async (c) => {
  const supabase = c.get('supabase')
  const userId = c.get('userId')
  const id = c.req.param('id')

  const [{ data: thread }, { data: profile }] = await Promise.all([
    supabase.from('watched_threads').select('gmail_thread_id').eq('id', id).single(),
    supabase.from('profiles').select('gmail_refresh_token, gmail_email').eq('id', userId).single(),
  ])

  if (!thread) return c.json({ error: 'Run not found' }, 404)
  if (!profile?.gmail_refresh_token) return c.json({ error: 'Gmail credentials expired' }, 400)

  await syncThreadFromGmail(supabase, c.env, {
    threadId: id,
    gmailThreadId: thread.gmail_thread_id,
    userId,
    refreshToken: profile.gmail_refresh_token,
    userEmail: profile.gmail_email ?? '',
  })

  return c.json({ synced: true })
})

export { runs }
