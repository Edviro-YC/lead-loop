import { Hono } from 'hono'
import type { AppEnv } from '../lib/types'
import { debug } from '../lib/debug'
import { syncThreadFromGmail } from '../jobs/thread-sync'

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

  const { data: profile } = await supabase
    .from('profiles')
    .select('gmail_refresh_token, gmail_email')
    .eq('id', userId)
    .single()

  if (profile?.gmail_refresh_token) {
    try {
      await syncThreadFromGmail(supabase, c.env, {
        threadId: data.id,
        gmailThreadId: gmail_thread_id,
        userId,
        refreshToken: profile.gmail_refresh_token,
        userEmail: profile.gmail_email ?? '',
      })
    } catch (err) {
      debug(c.env, '[warn] Initial thread sync failed:', err)
    }
  }

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
  const supabase = c.get('supabase')
  const userId = c.get('userId')
  const id = c.req.param('id')

  const [{ data: thread }, { data: profile }] = await Promise.all([
    supabase.from('watched_threads').select('gmail_thread_id').eq('id', id).single(),
    supabase.from('profiles').select('gmail_refresh_token, gmail_email').eq('id', userId).single(),
  ])

  if (!thread) return c.json({ error: 'Thread not found' }, 404)
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

export { threads }
