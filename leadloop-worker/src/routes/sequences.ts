import { Hono } from 'hono'
import type { AppEnv } from '../lib/types'

const sequences = new Hono<AppEnv>()

/**
 * Capture a whole watched thread as a sequence: every sent message
 * becomes one step-numbered outreach example. Complements the
 * single-message POST /api/examples/from-thread/:threadId.
 */
sequences.post('/from-thread/:threadId', async (c) => {
  const supabase = c.get('supabase')
  const userId = c.get('userId')
  const threadId = c.req.param('threadId')
  const { name, description, outcome, tags } = await c.req.json<{
    name?: string
    description?: string
    outcome?: string
    tags?: string[]
  }>()

  const { data: thread, error: threadError } = await supabase
    .from('watched_threads')
    .select('id, subject')
    .eq('id', threadId)
    .single()
  if (threadError || !thread) return c.json({ error: 'Thread not found' }, 404)

  const { data: messages, error: messagesError } = await supabase
    .from('thread_messages')
    .select('subject, body_text, snippet, sent_at')
    .eq('thread_id', threadId)
    .eq('direction', 'sent')
    .order('sent_at', { ascending: true })
  if (messagesError) return c.json({ error: messagesError.message }, 500)

  const withBodies = (messages ?? [])
    .map((m) => ({ ...m, body: m.body_text ?? m.snippet ?? '' }))
    .filter((m) => m.body.trim())
  if (!withBodies.length) {
    return c.json({ error: 'No sent messages with content found in this thread' }, 404)
  }

  const threadSubject = thread.subject ?? 'Untitled thread'
  const { data: sequence, error: sequenceError } = await supabase
    .from('sequences')
    .insert({
      user_id: userId,
      name: name || `Sequence: ${threadSubject}`,
      description: description ?? `Captured from thread "${threadSubject}"`,
    })
    .select('id, name, description, created_at')
    .single()
  if (sequenceError || !sequence) {
    return c.json({ error: sequenceError?.message ?? 'Failed to create sequence' }, 500)
  }

  // Single bulk insert = one atomic statement; on failure, remove the
  // just-created empty sequence rather than leaving half a capture behind.
  const { data: examples, error: examplesError } = await supabase
    .from('outreach_examples')
    .insert(
      withBodies.map((m, i) => ({
        user_id: userId,
        context: `Step ${i + 1} of ${withBodies.length} — thread "${threadSubject}"`,
        subject: m.subject ?? thread.subject,
        body: m.body,
        outcome: outcome ?? 'replied',
        tags: tags ?? [],
        sequence_id: sequence.id,
        step_number: i + 1,
      }))
    )
    .select('id, step_number')
  if (examplesError || !examples) {
    await supabase.from('sequences').delete().eq('id', sequence.id)
    return c.json({ error: examplesError?.message ?? 'Failed to create step examples' }, 500)
  }

  await c.env.EMBED_EXAMPLE_QUEUE.sendBatch(
    examples.map((e) => ({ body: { exampleId: e.id } }))
  )

  const skipped = (messages?.length ?? 0) - withBodies.length
  return c.json(
    { sequence, steps: examples, ...(skipped ? { skipped_empty_messages: skipped } : {}) },
    201
  )
})

export { sequences }
