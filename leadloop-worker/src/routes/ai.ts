import { Hono } from 'hono'
import type { AppEnv } from '../lib/types'
import { enhanceDraft, suggestReply } from '../services/openai'
import { createServiceClient } from '../lib/supabase'
import { findSimilarExamples, formatExamplesForPrompt } from '../services/retrieval'

const ai = new Hono<AppEnv>()

ai.post('/enhance', async (c) => {
  const { draft_text, lead_context, intent } = await c.req.json<{
    draft_text: string
    lead_context?: Record<string, string>
    intent?: string
  }>()

  if (!draft_text) return c.json({ error: 'draft_text is required' }, 400)

  const enhanced = await enhanceDraft(c.env.OPENAI_API_KEY, {
    draftText: draft_text,
    leadContext: lead_context,
    intent,
  })

  return c.json({ enhanced })
})

ai.post('/suggest-reply', async (c) => {
  const supabase = c.get('supabase')
  const { thread_id } = await c.req.json<{ thread_id: string }>()

  if (!thread_id) return c.json({ error: 'thread_id is required' }, 400)

  // Fetch thread messages for context
  const { data: messages, error } = await supabase
    .from('thread_messages')
    .select('direction, from_email, body_text, sent_at')
    .eq('thread_id', thread_id)
    .order('sent_at', { ascending: true })

  if (error) return c.json({ error: error.message }, 500)
  if (!messages?.length) return c.json({ error: 'No messages found for this thread' }, 404)

  // Retrieve similar outreach examples via pgvector
  const userId = c.get('userId')
  const threadContext = messages.map((m) => m.body_text ?? '').join('\n')
  const serviceClient = createServiceClient(c.env)
  const retrieved = await findSimilarExamples(
    serviceClient, c.env.OPENAI_API_KEY, userId, threadContext
  )
  const examples = formatExamplesForPrompt(retrieved)

  const suggestion = await suggestReply(c.env.OPENAI_API_KEY, {
    threadMessages: messages,
    examples,
  })

  return c.json({ suggestion })
})

ai.post('/generate-followup', async (c) => {
  const supabase = c.get('supabase')
  const { thread_id, template_id } = await c.req.json<{
    thread_id: string
    template_id?: string
  }>()

  // If a template is provided, render it; otherwise generate from context
  let baseText = ''
  if (template_id) {
    const { data: template } = await supabase
      .from('templates')
      .select('body')
      .eq('id', template_id)
      .single()
    baseText = template?.body ?? ''
  }

  const { data: messages } = await supabase
    .from('thread_messages')
    .select('direction, from_email, body_text, sent_at')
    .eq('thread_id', thread_id)
    .order('sent_at', { ascending: true })

  const suggestion = await suggestReply(c.env.OPENAI_API_KEY, {
    threadMessages: messages ?? [],
    examples: [],
    baseText,
    isFollowUp: true,
  })

  return c.json({ suggestion })
})

export { ai }
