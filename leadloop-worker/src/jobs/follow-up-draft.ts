import type { SupabaseClient } from '@supabase/supabase-js'
import type { FollowUpDraftMessage } from '../lib/types'
import {
  suggestReply,
  buildSuggestReplyPrompt,
  type SuggestReplyParams,
} from '../services/openai'
import { refreshAccessToken, createDraft } from '../services/gmail'
import { scheduleNextFollowUp } from '../services/scheduling'
import {
  findSimilarExamples,
  formatExamplesForPrompt,
  loadSequenceContext,
  type SequenceDraftContext,
} from '../services/retrieval'
import { syncThreadFromGmail } from './thread-sync'

interface DraftEnv {
  OPENAI_API_KEY: string
  GOOGLE_CLIENT_ID: string
  GOOGLE_CLIENT_SECRET: string
}

export interface FollowUpThread {
  id: string
  subject: string | null
  sequence_id: string | null
  sequence_step: number
}

export type FollowUpDraftPlan =
  | { status: 'exhausted'; sequenceName: string; totalSteps: number }
  | {
      status: 'ok'
      toEmail: string
      subject: string
      prompt: { system: string; user: string }
      body: string
    }

/**
 * Compute everything about a thread's next follow-up draft -- recipient,
 * subject, the exact OpenAI prompt, and the generated body -- without
 * creating a Gmail draft or mutating any state. Shared by the queue job
 * and the MCP preview tool so previews match what actually gets drafted.
 */
export async function planFollowUpDraft(
  supabase: SupabaseClient,
  openaiApiKey: string,
  userId: string,
  thread: FollowUpThread,
  templateId?: string | null
): Promise<FollowUpDraftPlan> {
  // An assigned sequence supplies the base content (and wins over the
  // rule's template). An exhausted sequence is reported explicitly --
  // never a silent fallback to generic drafting.
  let sequence: SequenceDraftContext | undefined
  let baseText = ''
  if (thread.sequence_id) {
    const result = await loadSequenceContext(
      supabase, userId, thread.sequence_id, thread.sequence_step
    )
    if (result.status === 'exhausted') {
      return { status: 'exhausted', sequenceName: result.name, totalSteps: result.totalSteps }
    }
    sequence = result.ctx
  } else if (templateId) {
    const { data: template } = await supabase
      .from('templates')
      .select('body')
      .eq('id', templateId)
      .single()
    baseText = template?.body ?? ''
  }

  const { data: messages } = await supabase
    .from('thread_messages')
    .select('direction, from_email, to_email, body_text, sent_at')
    .eq('thread_id', thread.id)
    .order('sent_at', { ascending: true })
  const msgs = messages ?? []

  // Reply to the other party: sender of their latest message, or -- on
  // outbound-only threads with no reply yet -- the recipient of our last
  // sent message. A thread with neither is an error, not an empty To:.
  const newestFirst = [...msgs].reverse()
  const toEmail =
    newestFirst.find((m) => m.direction === 'received')?.from_email ??
    newestFirst.find((m) => m.direction === 'sent')?.to_email
  if (!toEmail) {
    throw new Error(`Cannot determine follow-up recipient for thread ${thread.id}`)
  }

  const threadContext = msgs.map((m) => m.body_text ?? '').join('\n')
  const retrieved = await findSimilarExamples(
    supabase, openaiApiKey, userId, threadContext
  )
  const examples = formatExamplesForPrompt(retrieved)

  const params: SuggestReplyParams = {
    threadMessages: msgs,
    examples,
    baseText,
    isFollowUp: true,
    sequence,
  }

  return {
    status: 'ok',
    toEmail,
    subject: `Re: ${thread.subject ?? ''}`,
    prompt: buildSuggestReplyPrompt(params),
    body: await suggestReply(openaiApiKey, params),
  }
}

/**
 * Generate a follow-up email and create it as a Gmail draft.
 * Called by the follow-up-draft queue consumer.
 */
export async function processFollowUpDraft(
  supabase: SupabaseClient,
  env: DraftEnv,
  msg: FollowUpDraftMessage
): Promise<void> {
  const { data: followUp } = await supabase
    .from('scheduled_follow_ups')
    .select('*, follow_up_rules(template_id, delay_days, condition)')
    .eq('id', msg.scheduledFollowUpId)
    .single()

  if (!followUp || followUp.status !== 'pending') return

  const threadId = followUp.thread_id

  const [{ data: thread }, { data: profile }] = await Promise.all([
    supabase
      .from('watched_threads')
      .select('gmail_thread_id, subject, sequence_id, sequence_step')
      .eq('id', threadId)
      .single(),
    supabase.from('profiles').select('gmail_refresh_token, gmail_email').eq('id', msg.userId).single(),
  ])

  if (!profile?.gmail_refresh_token) {
    console.error(`No Gmail credentials for user ${msg.userId}`)
    return
  }

  if (!thread) {
    console.error(`Thread ${threadId} not found`)
    return
  }

  await syncThreadFromGmail(supabase, env, {
    threadId,
    gmailThreadId: thread.gmail_thread_id,
    userId: msg.userId,
    refreshToken: profile.gmail_refresh_token,
    userEmail: profile.gmail_email ?? '',
  })

  const rule = followUp.follow_up_rules
  if (rule?.condition === 'no_reply') {
    const { data: recentReceived } = await supabase
      .from('thread_messages')
      .select('id')
      .eq('thread_id', threadId)
      .eq('direction', 'received')
      .limit(1)

    if (recentReceived?.length) {
      await supabase
        .from('scheduled_follow_ups')
        .update({ status: 'dismissed', acted_at: new Date().toISOString() })
        .eq('id', msg.scheduledFollowUpId)
      return
    }
  }

  const plan = await planFollowUpDraft(
    supabase,
    env.OPENAI_API_KEY,
    msg.userId,
    {
      id: threadId,
      subject: thread.subject,
      sequence_id: thread.sequence_id,
      sequence_step: thread.sequence_step,
    },
    rule?.template_id
  )

  if (plan.status === 'exhausted') {
    console.log(
      `Sequence "${plan.sequenceName}" exhausted for thread ${threadId} ` +
        `(step ${thread.sequence_step} of ${plan.totalSteps}); ` +
        `dismissing follow-up ${msg.scheduledFollowUpId}`
    )
    await supabase
      .from('scheduled_follow_ups')
      .update({ status: 'dismissed', acted_at: new Date().toISOString() })
      .eq('id', msg.scheduledFollowUpId)
    return
  }

  const { access_token } = await refreshAccessToken(
    env.GOOGLE_CLIENT_ID,
    env.GOOGLE_CLIENT_SECRET,
    profile.gmail_refresh_token
  )

  const draft = await createDraft(
    { accessToken: access_token },
    plan.toEmail,
    plan.subject,
    plan.body,
    thread.gmail_thread_id
  )

  await supabase
    .from('scheduled_follow_ups')
    .update({
      status: 'draft_created',
      draft_gmail_id: draft.id,
      generated_body: plan.body,
      acted_at: new Date().toISOString(),
    })
    .eq('id', msg.scheduledFollowUpId)

  // A step was drafted; advance the thread's position in the sequence.
  if (thread.sequence_id) {
    const { error: stepError } = await supabase
      .from('watched_threads')
      .update({ sequence_step: thread.sequence_step + 1 })
      .eq('id', threadId)
    if (stepError) {
      throw new Error(`Draft ${draft.id} created but failed to advance sequence step: ${stepError.message}`)
    }
  }

  await scheduleNextFollowUp(
    supabase,
    followUp.rule_id,
    threadId,
    msg.userId
  )
}
