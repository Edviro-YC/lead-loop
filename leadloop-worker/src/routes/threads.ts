import { Hono } from 'hono'
import type { AppEnv } from '../lib/types'

const threads = new Hono<AppEnv>()

threads.get('/', async (c) => {
  const supabase = c.get('supabase')
  const userId = c.get('userId')
  const status = c.req.query('status')

  let query = supabase
    .from('watched_threads')
    .select('*, leads(name, email, company)')
    .eq('user_id', userId)
    .order('last_activity_at', { ascending: false, nullsFirst: false })

  if (status) query = query.eq('status', status)

  const { data, error } = await query
  if (error) return c.json({ error: error.message }, 500)
  return c.json({ threads: data })
})

threads.post('/watch', async (c) => {
  const supabase = c.get('supabase')
  const userId = c.get('userId')
  const { gmail_thread_id, subject, lead_id } = await c.req.json<{
    gmail_thread_id: string
    subject?: string
    lead_id?: string
  }>()

  const { data, error } = await supabase
    .from('watched_threads')
    .upsert(
      { gmail_thread_id, subject, lead_id, user_id: userId, status: 'active' },
      { onConflict: 'user_id,gmail_thread_id' }
    )
    .select()
    .single()

  if (error) return c.json({ error: error.message }, 500)

  // Enqueue an immediate sync for this thread
  await c.env.THREAD_SYNC_QUEUE.send({
    threadId: data.id,
    userId,
  })

  return c.json({ thread: data }, 201)
})

threads.put('/:id', async (c) => {
  const supabase = c.get('supabase')
  const id = c.req.param('id')
  const body = await c.req.json<{
    status?: string
    lead_id?: string | null
  }>()

  const { data, error } = await supabase
    .from('watched_threads')
    .update(body)
    .eq('id', id)
    .select()
    .single()

  if (error) return c.json({ error: error.message }, 500)
  return c.json({ thread: data })
})

threads.get('/:id/messages', async (c) => {
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

threads.post('/:id/sync', async (c) => {
  const userId = c.get('userId')
  const id = c.req.param('id')

  await c.env.THREAD_SYNC_QUEUE.send({ threadId: id, userId })
  return c.json({ queued: true })
})

export { threads }
