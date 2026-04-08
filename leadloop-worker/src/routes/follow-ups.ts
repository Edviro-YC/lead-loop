import { Hono } from 'hono'
import type { AppEnv } from '../lib/types'

const followUps = new Hono<AppEnv>()

followUps.post('/threads/:threadId/follow-up', async (c) => {
  const supabase = c.get('supabase')
  const userId = c.get('userId')
  const threadId = c.req.param('threadId')
  const body = await c.req.json<{
    delay_days?: number
    condition?: string
    template_id?: string
    max_follow_ups?: number
  }>()

  // Create the follow-up rule
  const { data: rule, error: ruleErr } = await supabase
    .from('follow_up_rules')
    .insert({
      thread_id: threadId,
      user_id: userId,
      delay_days: body.delay_days ?? 3,
      condition: body.condition ?? 'no_reply',
      template_id: body.template_id ?? null,
      max_follow_ups: body.max_follow_ups ?? 3,
    })
    .select()
    .single()

  if (ruleErr) return c.json({ error: ruleErr.message }, 500)

  // Schedule the first follow-up
  const scheduledFor = new Date()
  scheduledFor.setDate(scheduledFor.getDate() + (body.delay_days ?? 3))

  const { data: scheduled, error: schedErr } = await supabase
    .from('scheduled_follow_ups')
    .insert({
      rule_id: rule.id,
      thread_id: threadId,
      user_id: userId,
      scheduled_for: scheduledFor.toISOString(),
    })
    .select()
    .single()

  if (schedErr) return c.json({ error: schedErr.message }, 500)

  return c.json({ rule, scheduled }, 201)
})

followUps.put('/:id', async (c) => {
  const supabase = c.get('supabase')
  const id = c.req.param('id')
  const body = await c.req.json<{
    delay_days?: number
    condition?: string
    template_id?: string | null
    max_follow_ups?: number
    status?: string
  }>()

  const { data, error } = await supabase
    .from('follow_up_rules')
    .update(body)
    .eq('id', id)
    .select()
    .single()

  if (error) return c.json({ error: error.message }, 500)
  return c.json({ rule: data })
})

followUps.delete('/:id', async (c) => {
  const supabase = c.get('supabase')
  const id = c.req.param('id')

  const [, { error }] = await Promise.all([
    supabase.from('scheduled_follow_ups').update({ status: 'dismissed' }).eq('rule_id', id).eq('status', 'pending'),
    supabase.from('follow_up_rules').update({ status: 'cancelled' }).eq('id', id),
  ])

  if (error) return c.json({ error: error.message }, 500)
  return c.json({ success: true })
})

followUps.get('/pending', async (c) => {
  const supabase = c.get('supabase')
  const userId = c.get('userId')

  const { data, error } = await supabase
    .from('scheduled_follow_ups')
    .select('*, watched_threads(subject, gmail_thread_id), follow_up_rules(delay_days, condition)')
    .eq('user_id', userId)
    .eq('status', 'pending')
    .order('scheduled_for', { ascending: true })

  if (error) return c.json({ error: error.message }, 500)
  return c.json({ follow_ups: data })
})

followUps.post('/:id/dismiss', async (c) => {
  const supabase = c.get('supabase')
  const id = c.req.param('id')

  const { data, error } = await supabase
    .from('scheduled_follow_ups')
    .update({ status: 'dismissed', acted_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single()

  if (error) return c.json({ error: error.message }, 500)
  return c.json({ follow_up: data })
})

followUps.post('/:id/create-draft', async (c) => {
  const userId = c.get('userId')
  const id = c.req.param('id')

  // Enqueue draft creation to the follow-up-draft queue
  await c.env.FOLLOW_UP_DRAFT_QUEUE.send({
    scheduledFollowUpId: id,
    userId,
  })

  return c.json({ queued: true })
})

export { followUps }
