import { Hono } from 'hono'
import type { AppEnv } from '../lib/types'

const examples = new Hono<AppEnv>()

examples.get('/', async (c) => {
  const supabase = c.get('supabase')
  const userId = c.get('userId')

  const { data, error } = await supabase
    .from('outreach_examples')
    .select('id, context, subject, body, outcome, tags, created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })

  if (error) return c.json({ error: error.message }, 500)
  return c.json({ examples: data })
})

examples.post('/', async (c) => {
  const supabase = c.get('supabase')
  const userId = c.get('userId')
  const body = await c.req.json<{
    context: string
    subject?: string
    body: string
    outcome?: string
    tags?: string[]
  }>()

  const { data, error } = await supabase
    .from('outreach_examples')
    .insert({ ...body, user_id: userId })
    .select()
    .single()

  if (error) return c.json({ error: error.message }, 500)

  // Enqueue embedding generation
  if (data) {
    await c.env.EMBED_EXAMPLE_QUEUE.send({ exampleId: data.id })
  }

  return c.json({ example: data }, 201)
})

examples.put('/:id', async (c) => {
  const supabase = c.get('supabase')
  const id = c.req.param('id')
  const body = await c.req.json<{
    context?: string
    subject?: string
    body?: string
    outcome?: string
    tags?: string[]
  }>()

  const { data, error } = await supabase
    .from('outreach_examples')
    .update(body)
    .eq('id', id)
    .select()
    .single()

  if (error) return c.json({ error: error.message }, 500)

  // Re-embed if content changed
  if (data && (body.context || body.body || body.subject)) {
    await c.env.EMBED_EXAMPLE_QUEUE.send({ exampleId: data.id })
  }

  return c.json({ example: data })
})

examples.delete('/:id', async (c) => {
  const supabase = c.get('supabase')
  const id = c.req.param('id')

  const { error } = await supabase.from('outreach_examples').delete().eq('id', id)
  if (error) return c.json({ error: error.message }, 500)
  return c.json({ success: true })
})

examples.post('/from-thread/:threadId', async (c) => {
  const supabase = c.get('supabase')
  const userId = c.get('userId')
  const threadId = c.req.param('threadId')
  const { outcome, tags } = await c.req.json<{
    outcome?: string
    tags?: string[]
  }>()

  const [{ data: thread }, { data: messages }] = await Promise.all([
    supabase.from('watched_threads').select('subject').eq('id', threadId).single(),
    supabase.from('thread_messages').select('direction, body_text, sent_at')
      .eq('thread_id', threadId).eq('direction', 'sent').order('sent_at', { ascending: true }).limit(1),
  ])

  if (!messages?.length) {
    return c.json({ error: 'No sent messages found in this thread' }, 404)
  }

  const sentMsg = messages[0]

  const { data, error } = await supabase
    .from('outreach_examples')
    .insert({
      user_id: userId,
      context: `Thread: ${thread?.subject ?? 'Unknown'}`,
      subject: thread?.subject,
      body: sentMsg.body_text ?? '',
      outcome: outcome ?? 'replied',
      tags: tags ?? [],
    })
    .select()
    .single()

  if (error) return c.json({ error: error.message }, 500)

  if (data) {
    await c.env.EMBED_EXAMPLE_QUEUE.send({ exampleId: data.id })
  }

  return c.json({ example: data }, 201)
})

export { examples }
