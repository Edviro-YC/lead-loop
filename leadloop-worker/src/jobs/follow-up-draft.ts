import type { SupabaseClient } from '@supabase/supabase-js'
import type { FollowUpDraftMessage } from '../lib/types'
import { refreshAccessToken, createDraft } from '../services/gmail'
import { scheduleStep, bareEmail, type SequenceStep } from '../services/runs'
import { renderTemplate } from '../lib/render'
import { syncThreadFromGmail } from './thread-sync'

interface DraftEnv {
  GOOGLE_CLIENT_ID: string
  GOOGLE_CLIENT_SECRET: string
}

/**
 * Create the next follow-up draft for a run. No AI: the body is the
 * current step of the sequence with the run's stored {{variables}}
 * filled in. Called by the follow-up-draft queue consumer; throwing
 * lets the queue retry (e.g. transient Gmail failures).
 */
export async function processFollowUpDraft(
  supabase: SupabaseClient,
  env: DraftEnv,
  msg: FollowUpDraftMessage
): Promise<void> {
  const { data: followUp } = await supabase
    .from('scheduled_follow_ups')
    .select('id, thread_id, status')
    .eq('id', msg.scheduledFollowUpId)
    .single()

  if (!followUp || followUp.status !== 'pending') return

  const threadId = followUp.thread_id

  const [{ data: thread }, { data: profile }] = await Promise.all([
    supabase
      .from('watched_threads')
      .select(
        'gmail_thread_id, subject, status, sequence_id, sequence_step, variables, sequences(steps)'
      )
      .eq('id', threadId)
      .single(),
    supabase
      .from('profiles')
      .select('gmail_refresh_token, gmail_email')
      .eq('id', msg.userId)
      .single(),
  ])

  if (!thread) {
    console.error(`Thread ${threadId} not found`)
    return
  }
  if (!profile?.gmail_refresh_token) {
    console.error(`No Gmail credentials for user ${msg.userId}`)
    return
  }

  const dismiss = () =>
    supabase
      .from('scheduled_follow_ups')
      .update({ status: 'dismissed', acted_at: new Date().toISOString() })
      .eq('id', msg.scheduledFollowUpId)

  // A stopped/replied/completed run never drafts.
  if (thread.status !== 'active' || !thread.sequence_id) {
    await dismiss()
    return
  }

  await syncThreadFromGmail(supabase, env, {
    threadId,
    gmailThreadId: thread.gmail_thread_id,
    userId: msg.userId,
    refreshToken: profile.gmail_refresh_token,
    userEmail: profile.gmail_email ?? '',
  })

  const { data: messages } = await supabase
    .from('thread_messages')
    .select('direction, to_email, sent_at')
    .eq('thread_id', threadId)
    .order('sent_at', { ascending: true })
  const msgs = messages ?? []

  // A reply ends the run.
  if (msgs.some((m) => m.direction === 'received')) {
    await dismiss()
    await supabase.from('watched_threads').update({ status: 'replied' }).eq('id', threadId)
    return
  }

  const lastSent = [...msgs].reverse().find((m) => m.direction === 'sent')
  if (!lastSent?.to_email) {
    throw new Error(`Cannot determine follow-up recipient for thread ${threadId}`)
  }

  // Previous step's draft still sitting unsent? Defer a day instead of
  // stacking drafts (nothing outbound has appeared since it was created).
  const { data: prevDrafts } = await supabase
    .from('scheduled_follow_ups')
    .select('acted_at')
    .eq('thread_id', threadId)
    .eq('status', 'draft_created')
    .order('acted_at', { ascending: false })
    .limit(1)
  const prevDraftAt = prevDrafts?.[0]?.acted_at
  if (prevDraftAt && new Date(lastSent.sent_at ?? 0) <= new Date(prevDraftAt)) {
    const tomorrow = new Date()
    tomorrow.setDate(tomorrow.getDate() + 1)
    await supabase
      .from('scheduled_follow_ups')
      .update({ scheduled_for: tomorrow.toISOString() })
      .eq('id', msg.scheduledFollowUpId)
    return
  }

  // Current step. None = past the end (stale schedule): close out.
  // PostgREST types the to-one join loosely, hence the cast.
  const seq = thread.sequences as unknown as { steps?: SequenceStep[] } | null
  const steps = seq?.steps ?? []
  const step = steps[thread.sequence_step - 1]

  if (!step) {
    await dismiss()
    await supabase.from('watched_threads').update({ status: 'completed' }).eq('id', threadId)
    return
  }

  const variables = {
    email: bareEmail(lastSent.to_email),
    ...((thread.variables ?? {}) as Record<string, string>),
  }
  const body = renderTemplate(step.body, variables)
  const subject = `Re: ${thread.subject ?? ''}`

  const { access_token } = await refreshAccessToken(
    env.GOOGLE_CLIENT_ID,
    env.GOOGLE_CLIENT_SECRET,
    profile.gmail_refresh_token
  )

  const draft = await createDraft(
    { accessToken: access_token },
    lastSent.to_email,
    subject,
    body,
    thread.gmail_thread_id
  )

  await supabase
    .from('scheduled_follow_ups')
    .update({
      status: 'draft_created',
      draft_gmail_id: draft.id,
      generated_body: body,
      acted_at: new Date().toISOString(),
    })
    .eq('id', msg.scheduledFollowUpId)

  // Advance; schedule the next step or complete the run.
  const nextStep = thread.sequence_step + 1
  const next = steps[nextStep - 1]

  if (next) {
    const { error: stepError } = await supabase
      .from('watched_threads')
      .update({ sequence_step: nextStep })
      .eq('id', threadId)
    if (stepError) {
      throw new Error(
        `Draft ${draft.id} created but failed to advance sequence step: ${stepError.message}`
      )
    }
    await scheduleStep(supabase, threadId, msg.userId, new Date(), next.delay_days)
  } else {
    await supabase
      .from('watched_threads')
      .update({ sequence_step: nextStep, status: 'completed' })
      .eq('id', threadId)
  }
}
