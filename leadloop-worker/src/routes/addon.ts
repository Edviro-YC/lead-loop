import { Hono } from 'hono'
import type { AppEnv } from '../lib/types'
import { enhanceDraft, suggestReply } from '../services/openai'
import { findSimilarExamples, formatExamplesForPrompt } from '../services/retrieval'

const addon = new Hono<AppEnv>()

/**
 * Context card data for the current Gmail view.
 * The add-on sends the thread ID and/or compose metadata;
 * we return relevant templates, lead info, and thread status.
 */
addon.post('/context', async (c) => {
  const supabase = c.get('supabase')
  const userId = c.get('userId')
  const { gmail_thread_id, to_email } = await c.req.json<{
    gmail_thread_id?: string
    to_email?: string
  }>()

  const result: Record<string, unknown> = {}

  // Check if this thread is already watched
  if (gmail_thread_id) {
    const { data: thread } = await supabase
      .from('watched_threads')
      .select('id, status, lead_id')
      .eq('user_id', userId)
      .eq('gmail_thread_id', gmail_thread_id)
      .single()
    result.watched_thread = thread
  }

  // Look up lead by recipient email
  if (to_email) {
    const { data: lead } = await supabase
      .from('leads')
      .select('id, name, company, title, status')
      .eq('user_id', userId)
      .eq('email', to_email)
      .single()
    result.lead = lead
  }

  // Fetch active templates for quick-insert
  const { data: templates } = await supabase
    .from('templates')
    .select('id, name, category')
    .eq('user_id', userId)
    .eq('is_active', true)
    .order('name')

  result.templates = templates

  return c.json(result)
})

addon.post('/insert-template', async (c) => {
  const supabase = c.get('supabase')
  const { template_id, context } = await c.req.json<{
    template_id: string
    context: Record<string, string>
  }>()

  const { data: template, error } = await supabase
    .from('templates')
    .select('subject, body')
    .eq('id', template_id)
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

addon.post('/enhance', async (c) => {
  const { draft_text, lead_context } = await c.req.json<{
    draft_text: string
    lead_context?: Record<string, string>
  }>()

  const enhanced = await enhanceDraft(c.env.OPENAI_API_KEY, {
    draftText: draft_text,
    leadContext: lead_context,
  })

  return c.json({ enhanced })
})

addon.post('/suggest-reply', async (c) => {
  const supabase = c.get('supabase')
  const userId = c.get('userId')
  const { gmail_thread_id } = await c.req.json<{ gmail_thread_id: string }>()

  // Find internal thread record, or fetch from Gmail if not watched
  const { data: thread } = await supabase
    .from('watched_threads')
    .select('id')
    .eq('user_id', userId)
    .eq('gmail_thread_id', gmail_thread_id)
    .single()

  if (!thread) {
    // Thread not watched -- return a basic suggestion without stored context
    return c.json({
      suggestion: null,
      message: 'Watch this thread first for contextual suggestions',
    })
  }

  const { data: messages } = await supabase
    .from('thread_messages')
    .select('direction, from_email, body_text, sent_at')
    .eq('thread_id', thread.id)
    .order('sent_at', { ascending: true })

  if (!messages?.length) {
    return c.json({ suggestion: null, message: 'No synced messages yet' })
  }

  const threadContext = messages.map((m) => m.body_text ?? '').join('\n')
  const retrieved = await findSimilarExamples(
    supabase, c.env.OPENAI_API_KEY, userId, threadContext
  )
  const examples = formatExamplesForPrompt(retrieved)

  const suggestion = await suggestReply(c.env.OPENAI_API_KEY, {
    threadMessages: messages,
    examples,
  })

  return c.json({ suggestion })
})

addon.post('/watch', async (c) => {
  const supabase = c.get('supabase')
  const userId = c.get('userId')
  const { gmail_thread_id, subject } = await c.req.json<{
    gmail_thread_id: string
    subject?: string
  }>()

  const { data, error } = await supabase
    .from('watched_threads')
    .upsert(
      { gmail_thread_id, subject, user_id: userId, status: 'active' },
      { onConflict: 'user_id,gmail_thread_id' }
    )
    .select()
    .single()

  if (error) return c.json({ error: error.message }, 500)

  await c.env.THREAD_SYNC_QUEUE.send({ threadId: data.id, userId })

  return c.json({ thread: data, message: 'Thread is now being watched' })
})

addon.post('/set-followup', async (c) => {
  const supabase = c.get('supabase')
  const userId = c.get('userId')
  const { gmail_thread_id, delay_days, template_id } = await c.req.json<{
    gmail_thread_id: string
    delay_days?: number
    template_id?: string
  }>()

  // Ensure thread is watched
  const { data: thread } = await supabase
    .from('watched_threads')
    .select('id')
    .eq('user_id', userId)
    .eq('gmail_thread_id', gmail_thread_id)
    .single()

  if (!thread) return c.json({ error: 'Thread must be watched first' }, 400)

  const days = delay_days ?? 3

  const { data: rule, error } = await supabase
    .from('follow_up_rules')
    .insert({
      thread_id: thread.id,
      user_id: userId,
      delay_days: days,
      template_id: template_id ?? null,
    })
    .select()
    .single()

  if (error) return c.json({ error: error.message }, 500)

  const scheduledFor = new Date()
  scheduledFor.setDate(scheduledFor.getDate() + days)

  await supabase.from('scheduled_follow_ups').insert({
    rule_id: rule.id,
    thread_id: thread.id,
    user_id: userId,
    scheduled_for: scheduledFor.toISOString(),
  })

  return c.json({ rule, message: `Follow-up scheduled in ${days} days` })
})

export { addon }
