import { Hono } from 'hono'
import type { AppEnv } from '../lib/types'

const examples = new Hono<AppEnv>()

examples.get('/', async (c) => {
  const supabase = c.get('supabase')
  const userId = c.get('userId')

  const { data, error } = await supabase
    .from('outreach_examples')
    .select('id, context, subject, body, outcome, tags, sequence_id, created_at, sequences(name)')
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
    sequence_id?: string
  }>()

  const { data, error } = await supabase
    .from('outreach_examples')
    .insert({ ...body, user_id: userId })
    .select()
    .single()

  if (error) return c.json({ error: error.message }, 500)
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
    sequence_id?: string | null
  }>()

  const { data, error } = await supabase
    .from('outreach_examples')
    .update(body)
    .eq('id', id)
    .select()
    .single()

  if (error) return c.json({ error: error.message }, 500)
  return c.json({ example: data })
})

examples.delete('/:id', async (c) => {
  const supabase = c.get('supabase')
  const id = c.req.param('id')

  const { error } = await supabase.from('outreach_examples').delete().eq('id', id)
  if (error) return c.json({ error: error.message }, 500)
  return c.json({ success: true })
})

export { examples }
