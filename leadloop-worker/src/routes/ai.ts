import { Hono } from 'hono'
import type { AppEnv } from '../lib/types'
import { enhanceDraft, suggestReply } from '../services/openai'
import { createServiceClient } from '../lib/supabase'
import {
  findSimilarExamples,
  formatExamplesForPrompt,
  loadSequenceContext,
  type SequenceDraftContext,
} from '../services/retrieval'

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

  if (!thread_id) return c.json({ error: 'thread_id is required' }, 400)

  const { data: thread, error: threadError } = await supabase
    .from('watched_threads')
    .select('sequence_id, sequence_step')
    .eq('id', thread_id)
    .single()
  if (threadError || !thread) return c.json({ error: 'Thread not found' }, 404)

  // An assigned sequence supplies the base content (and wins over any
  // template); an exhausted sequence is an explicit error, not a fallback.
  let sequence: SequenceDraftContext | undefined
  let baseText = ''
  if (thread.sequence_id) {
    const result = await loadSequenceContext(
      supabase, c.get('userId'), thread.sequence_id, thread.sequence_step
    )
    if (result.status === 'exhausted') {
      return c.json(
        {
          error:
            `Thread is past the end of sequence "${result.name}" ` +
            `(step ${thread.sequence_step} of ${result.totalSteps}). ` +
            'Unassign the sequence or lower the thread\'s sequence_step.',
        },
        400
      )
    }
    sequence = result.ctx
  } else if (template_id) {
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
    sequence,
  })

  return c.json({ suggestion })
})

export { ai }
