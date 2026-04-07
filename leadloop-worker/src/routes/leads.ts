import { Hono } from 'hono'
import type { AppEnv } from '../lib/types'

const leads = new Hono<AppEnv>()

leads.get('/', async (c) => {
  const supabase = c.get('supabase')
  const userId = c.get('userId')

  const status = c.req.query('status')
  const limit = parseInt(c.req.query('limit') || '50', 10)
  const offset = parseInt(c.req.query('offset') || '0', 10)

  let query = supabase
    .from('leads')
    .select('*', { count: 'exact' })
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1)

  if (status) query = query.eq('status', status)

  const { data, error, count } = await query
  if (error) return c.json({ error: error.message }, 500)
  return c.json({ leads: data, total: count })
})

leads.post('/', async (c) => {
  const supabase = c.get('supabase')
  const userId = c.get('userId')
  const body = await c.req.json<{
    email: string
    name?: string
    company?: string
    title?: string
    source?: string
    custom_fields?: Record<string, unknown>
  }>()

  const { data, error } = await supabase
    .from('leads')
    .insert({ ...body, user_id: userId })
    .select()
    .single()

  if (error) {
    if (error.code === '23505') {
      return c.json({ error: 'Lead with this email already exists' }, 409)
    }
    return c.json({ error: error.message }, 500)
  }
  return c.json({ lead: data }, 201)
})

leads.post('/import', async (c) => {
  const supabase = c.get('supabase')
  const userId = c.get('userId')
  const { leads: rows } = await c.req.json<{
    leads: Array<{
      email: string
      name?: string
      company?: string
      title?: string
      custom_fields?: Record<string, unknown>
    }>
  }>()

  if (!rows?.length) return c.json({ error: 'No leads provided' }, 400)

  const toInsert = rows.map((row) => ({
    ...row,
    user_id: userId,
    source: 'csv' as const,
  }))

  const { data, error } = await supabase
    .from('leads')
    .upsert(toInsert, { onConflict: 'user_id,email', ignoreDuplicates: true })
    .select()

  if (error) return c.json({ error: error.message }, 500)
  return c.json({ imported: data?.length ?? 0, leads: data })
})

leads.put('/:id', async (c) => {
  const supabase = c.get('supabase')
  const id = c.req.param('id')
  const body = await c.req.json<{
    name?: string
    company?: string
    title?: string
    status?: string
    custom_fields?: Record<string, unknown>
  }>()

  const { data, error } = await supabase
    .from('leads')
    .update(body)
    .eq('id', id)
    .select()
    .single()

  if (error) return c.json({ error: error.message }, 500)
  return c.json({ lead: data })
})

leads.delete('/:id', async (c) => {
  const supabase = c.get('supabase')
  const id = c.req.param('id')

  const { error } = await supabase.from('leads').delete().eq('id', id)
  if (error) return c.json({ error: error.message }, 500)
  return c.json({ success: true })
})

export { leads }
