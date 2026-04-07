import { Hono } from 'hono'
import type { AppEnv } from '../lib/types'

const templates = new Hono<AppEnv>()

templates.get('/', async (c) => {
  const supabase = c.get('supabase')
  const userId = c.get('userId')

  const { data, error } = await supabase
    .from('templates')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })

  if (error) return c.json({ error: error.message }, 500)
  return c.json({ templates: data })
})

templates.post('/', async (c) => {
  const supabase = c.get('supabase')
  const userId = c.get('userId')
  const body = await c.req.json<{
    name: string
    subject?: string
    body: string
    category?: string
    variables?: string[]
  }>()

  const { data, error } = await supabase
    .from('templates')
    .insert({ ...body, user_id: userId })
    .select()
    .single()

  if (error) return c.json({ error: error.message }, 500)
  return c.json({ template: data }, 201)
})

templates.put('/:id', async (c) => {
  const supabase = c.get('supabase')
  const id = c.req.param('id')
  const body = await c.req.json<{
    name?: string
    subject?: string
    body?: string
    category?: string
    variables?: string[]
    is_active?: boolean
  }>()

  const { data, error } = await supabase
    .from('templates')
    .update(body)
    .eq('id', id)
    .select()
    .single()

  if (error) return c.json({ error: error.message }, 500)
  return c.json({ template: data })
})

templates.delete('/:id', async (c) => {
  const supabase = c.get('supabase')
  const id = c.req.param('id')

  const { error } = await supabase
    .from('templates')
    .delete()
    .eq('id', id)

  if (error) return c.json({ error: error.message }, 500)
  return c.json({ success: true })
})

templates.post('/:id/render', async (c) => {
  const supabase = c.get('supabase')
  const id = c.req.param('id')
  const { context } = await c.req.json<{
    context: Record<string, string>
  }>()

  const { data: template, error } = await supabase
    .from('templates')
    .select('*')
    .eq('id', id)
    .single()

  if (error || !template) return c.json({ error: 'Template not found' }, 404)

  let rendered = template.body
  let renderedSubject = template.subject || ''
  for (const [key, value] of Object.entries(context)) {
    const placeholder = `{{${key}}}`
    rendered = rendered.replaceAll(placeholder, value)
    renderedSubject = renderedSubject.replaceAll(placeholder, value)
  }

  return c.json({ subject: renderedSubject, body: rendered })
})

export { templates }
