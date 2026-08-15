import { Hono } from 'hono'
import type { AppEnv } from '../lib/types'
import { extractVariables } from '../lib/render'
import { startSequence, stopRun, saveRunAsExample, type SequenceStep } from '../services/runs'

const addon = new Hono<AppEnv>()

/**
 * Context for the current Gmail view: the thread's run (if any) and
 * the sequences available to start (with the variables their steps
 * need, so the sidebar can build the enrollment form).
 */
addon.post('/context', async (c) => {
  const supabase = c.get('supabase')
  const userId = c.get('userId')
  const { gmail_thread_id } = await c.req.json<{
    gmail_thread_id?: string
    to_email?: string
  }>()

  const [runResult, sequencesResult] = await Promise.all([
    gmail_thread_id
      ? supabase
          .from('watched_threads')
          .select('id, status, sequence_id, sequence_step, variables, sequences(name)')
          .eq('user_id', userId)
          .eq('gmail_thread_id', gmail_thread_id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    supabase
      .from('sequences')
      .select('id, name, steps')
      .eq('user_id', userId)
      .order('name'),
  ])

  const sequences = (sequencesResult.data ?? []).map((s) => {
    const steps = (s.steps ?? []) as SequenceStep[]
    return {
      id: s.id,
      name: s.name,
      step_count: steps.length,
      variables: [
        ...new Set(steps.flatMap((t) => extractVariables(t.body))),
      ].filter((v) => v !== 'email'),
    }
  })

  return c.json({
    run: runResult.data,
    sequences,
  })
})

addon.post('/start-sequence', async (c) => {
  const { sequence_id, gmail_thread_id, variables } = await c.req.json<{
    sequence_id: string
    gmail_thread_id: string
    variables?: Record<string, string>
  }>()

  try {
    const result = await startSequence(c.get('supabase'), c.env, c.get('userId'), {
      sequenceId: sequence_id,
      gmailThreadId: gmail_thread_id,
      variables,
    })
    return c.json(result, 201)
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : String(err) }, 400)
  }
})

addon.post('/stop-run', async (c) => {
  const { run_id } = await c.req.json<{ run_id: string }>()

  try {
    const run = await stopRun(c.get('supabase'), c.get('userId'), run_id)
    return c.json({ run })
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : String(err) }, 400)
  }
})

addon.post('/save-example', async (c) => {
  const { run_id, outcome, tags } = await c.req.json<{
    run_id: string
    outcome?: string
    tags?: string[]
  }>()

  try {
    const example = await saveRunAsExample(c.get('supabase'), c.get('userId'), run_id, {
      outcome,
      tags,
    })
    return c.json({ example }, 201)
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : String(err) }, 400)
  }
})

export { addon }
