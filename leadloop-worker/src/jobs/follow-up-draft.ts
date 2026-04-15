import type { SupabaseClient } from '@supabase/supabase-js'
import type { FollowUpDraftMessage } from '../lib/types'
import { suggestReply } from '../services/openai'
import { refreshAccessToken, createDraft } from '../services/gmail'
import { scheduleNextFollowUp } from '../services/scheduling'
import { findSimilarExamples, formatExamplesForPrompt } from '../services/retrieval'
import { syncThreadFromGmail } from './thread-sync'

interface DraftEnv {
  OPENAI_API_KEY: string
  GOOGLE_CLIENT_ID: string
  GOOGLE_CLIENT_SECRET: string
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
    supabase.from('watched_threads').select('gmail_thread_id, subject').eq('id', threadId).single(),
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

  const { data: messages } = await supabase
    .from('thread_messages')
    .select('direction, from_email, body_text, sent_at')
    .eq('thread_id', threadId)
    .order('sent_at', { ascending: true })

  let baseText = ''
  if (rule?.template_id) {
    const { data: template } = await supabase
      .from('templates')
      .select('body')
      .eq('id', rule.template_id)
      .single()
    baseText = template?.body ?? ''
  }

  const threadContext = (messages ?? []).map((m) => m.body_text ?? '').join('\n')
  const retrieved = await findSimilarExamples(
    supabase, env.OPENAI_API_KEY, msg.userId, threadContext
  )
  const examples = formatExamplesForPrompt(retrieved)

  const generatedBody = await suggestReply(env.OPENAI_API_KEY, {
    threadMessages: messages ?? [],
    examples,
    baseText,
    isFollowUp: true,
  })

  const { access_token } = await refreshAccessToken(
    env.GOOGLE_CLIENT_ID,
    env.GOOGLE_CLIENT_SECRET,
    profile.gmail_refresh_token
  )

  const receivedMsg = messages?.find((m) => m.direction === 'received')
  const toEmail = receivedMsg?.from_email ?? ''

  const draft = await createDraft(
    { accessToken: access_token },
    toEmail,
    `Re: ${thread.subject ?? ''}`,
    generatedBody,
    thread.gmail_thread_id
  )

  await supabase
    .from('scheduled_follow_ups')
    .update({
      status: 'draft_created',
      draft_gmail_id: draft.id,
      generated_body: generatedBody,
      acted_at: new Date().toISOString(),
    })
    .eq('id', msg.scheduledFollowUpId)

  await scheduleNextFollowUp(
    supabase,
    followUp.rule_id,
    threadId,
    msg.userId
  )
}
