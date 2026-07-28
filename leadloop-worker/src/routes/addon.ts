import { Hono } from 'hono'
import type { AppEnv } from '../lib/types'
import { debug } from '../lib/debug'
import { enhanceDraft, suggestReply } from '../services/openai'
import { findSimilarExamples, formatExamplesForPrompt } from '../services/retrieval'
import { syncThreadFromGmail } from '../jobs/thread-sync'
import { createFollowUpSchedule } from '../services/scheduling'

const addon = new Hono<AppEnv>()

/**
 * Context card data for the current Gmail view.
 * The add-on sends the thread ID and/or compose metadata;
 * we return relevant templates, lead info, and thread status.
 */
addon.post('/context', async (c) => {
  const t0 = Date.now()
  const supabase = c.get('supabase')
  const userId = c.get('userId')
  const { gmail_thread_id, to_email } = await c.req.json<{
    gmail_thread_id?: string
    to_email?: string
  }>()

  const t1 = Date.now()
  const [threadResult, leadResult, templatesResult] = await Promise.all([
    gmail_thread_id
      ? supabase.from('watched_threads').select('id, status, lead_id').eq('user_id', userId).eq('gmail_thread_id', gmail_thread_id).single()
      : Promise.resolve({ data: null }),
    to_email
      ? supabase.from('leads').select('id, name, company, title, status').eq('user_id', userId).eq('email', to_email).single()
      : Promise.resolve({ data: null }),
    supabase.from('templates').select('id, name, category').eq('user_id', userId).eq('is_active', true).order('name'),
  ])
  debug(c.env, `[timing] /context parallel queries: ${Date.now() - t1}ms`)

  debug(c.env, `[timing] /context total: ${Date.now() - t0}ms`)
  return c.json({
    watched_thread: threadResult.data,
    lead: leadResult.data,
    templates: templatesResult.data,
  })
})

addon.post('/insert-template', async (c) => {
  const t0 = Date.now()
  const supabase = c.get('supabase')
  const userId = c.get('userId')
  const { template_id, to_email } = await c.req.json<{
    template_id: string
    to_email?: string
    context?: Record<string, string>
  }>()

  const t1 = Date.now()
  const [templateResult, leadResult] = await Promise.all([
    supabase.from('templates').select('subject, body').eq('id', template_id).single(),
    to_email
      ? supabase.from('leads').select('name, company, title').eq('user_id', userId).eq('email', to_email).single()
      : Promise.resolve({ data: null }),
  ])
  debug(c.env, `[timing] /insert-template parallel fetch: ${Date.now() - t1}ms`)

  const template = templateResult.data
  if (templateResult.error || !template) return c.json({ error: 'Template not found' }, 404)

  const lead = leadResult.data as { name?: string; company?: string; title?: string } | null
  const vars: Record<string, string> = {}
  if (lead) {
    vars.first_name = (lead.name ?? '').split(' ')[0]
    vars.name = lead.name ?? ''
    vars.company = lead.company ?? ''
    vars.title = lead.title ?? ''
  }
  if (to_email) vars.email = to_email

  let rendered = template.body
  let renderedSubject = template.subject || ''
  for (const [key, value] of Object.entries(vars)) {
    const placeholder = `{{${key}}}`
    rendered = rendered.replaceAll(placeholder, value)
    renderedSubject = renderedSubject.replaceAll(placeholder, value)
  }

  const htmlBody = rendered.replace(/\n/g, '<br>')
  debug(c.env, `[timing] /insert-template total: ${Date.now() - t0}ms`)
  return c.json({ subject: renderedSubject, body: htmlBody })
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

  const [{ data: thread }, { data: profile }] = await Promise.all([
    supabase.from('watched_threads').select('id, gmail_thread_id').eq('user_id', userId).eq('gmail_thread_id', gmail_thread_id).single(),
    supabase.from('profiles').select('gmail_refresh_token, gmail_email').eq('id', userId).single(),
  ])

  if (!thread) {
    return c.json({
      suggestion: null,
      message: 'Add this thread to LeadLoop first for contextual suggestions',
    })
  }

  if (!profile?.gmail_refresh_token) {
    return c.json({ suggestion: null, message: 'Gmail credentials expired. Please re-authenticate in the dashboard.' })
  }

  await syncThreadFromGmail(supabase, c.env, {
    threadId: thread.id,
    gmailThreadId: thread.gmail_thread_id,
    userId,
    refreshToken: profile.gmail_refresh_token,
    userEmail: profile.gmail_email ?? '',
  })

  const [{ data: messages }, { count: exampleCount }] = await Promise.all([
    supabase
      .from('thread_messages')
      .select('direction, from_email, body_text, sent_at')
      .eq('thread_id', thread.id)
      .order('sent_at', { ascending: true }),
    supabase
      .from('outreach_examples')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId),
  ])

  if (!messages?.length) {
    return c.json({ suggestion: null, message: 'No messages found in this thread' })
  }

  let examples: string[] = []
  if (exampleCount && exampleCount > 0) {
    const threadContext = messages.map((m) => m.body_text ?? '').join('\n')
    const retrieved = await findSimilarExamples(
      supabase, c.env.OPENAI_API_KEY, userId, threadContext
    )
    examples = formatExamplesForPrompt(retrieved)
  }

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
      debug(c.env, '[warn] Initial thread sync failed, will retry on next action:', err)
    }
  }

  return c.json({ thread: data, message: 'Thread added to LeadLoop' })
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

  if (!thread) return c.json({ error: 'Add this thread to LeadLoop first' }, 400)

  const days = delay_days ?? 3

  try {
    const { rule } = await createFollowUpSchedule(supabase, userId, thread.id, {
      delayDays: days,
      templateId: template_id,
    })
    return c.json({ rule, message: `Follow-up scheduled in ${days} days` })
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : String(err) }, 400)
  }
})

export { addon }
