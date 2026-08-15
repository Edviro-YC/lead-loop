import type { SupabaseClient } from '@supabase/supabase-js'
import { refreshAccessToken, findLatestSentThread } from './gmail'
import { syncThreadFromGmail } from '../jobs/thread-sync'
import { extractVariables } from '../lib/render'

/**
 * Run lifecycle: enrollment (startSequence), scheduling, stopping, and
 * saving winning runs as examples. Shared by the dashboard API, the
 * Gmail add-on, and the MCP tools — which use different Supabase
 * clients (RLS vs service-role), so every query here is explicitly
 * scoped to userId.
 */

interface GoogleEnv {
  GOOGLE_CLIENT_ID: string
  GOOGLE_CLIENT_SECRET: string
}

/** "Name <a@b.com>" -> "a@b.com" (Gmail To/From headers carry display names). */
export function bareEmail(address: string): string {
  return address.match(/<([^>]+)>/)?.[1] ?? address.trim()
}

/**
 * Find all scheduled follow-ups that are due now. Called by the cron.
 */
export async function getDueFollowUps(
  supabase: SupabaseClient
): Promise<Array<{ id: string; thread_id: string; user_id: string }>> {
  const now = new Date().toISOString()

  const { data, error } = await supabase
    .from('scheduled_follow_ups')
    .select('id, thread_id, user_id')
    .eq('status', 'pending')
    .lte('scheduled_for', now)
    .limit(50)

  if (error) {
    console.error('getDueFollowUps error:', error.message)
    return []
  }

  return data ?? []
}

/**
 * Insert the pending follow-up for a run's next step, `delayDays` after
 * `from` (the previous email). Returns the scheduled time.
 */
export async function scheduleStep(
  supabase: SupabaseClient,
  threadId: string,
  userId: string,
  from: Date,
  delayDays: number
): Promise<string> {
  const scheduledFor = new Date(from)
  scheduledFor.setDate(scheduledFor.getDate() + delayDays)
  const iso = scheduledFor.toISOString()

  const { error } = await supabase.from('scheduled_follow_ups').insert({
    thread_id: threadId,
    user_id: userId,
    scheduled_for: iso,
  })
  if (error) throw new Error(`Failed to schedule follow-up: ${error.message}`)

  return iso
}

/** One follow-up email in a sequence's `steps` JSONB array. */
export interface SequenceStep {
  body: string
  delay_days: number
}

export interface StartSequenceOpts {
  sequenceId: string
  /** Gmail thread id, when the caller knows it (the add-on does). */
  gmailThreadId?: string
  /** Otherwise: resolve the newest sent thread to this address. */
  recipientEmail?: string
  /** Values for the {{variables}} used across the sequence's steps. */
  variables?: Record<string, string>
}

/**
 * Enroll a sent Gmail thread in a sequence — the single entry point
 * behind the MCP `start_sequence` tool, the add-on card, and the
 * dashboard form. Resolves the thread, validates that the provided
 * variables cover every {{placeholder}} in the sequence's steps
 * (so a draft can never go out half-rendered), creates the run, and
 * schedules step 1 relative to when the last email was sent.
 */
export async function startSequence(
  supabase: SupabaseClient,
  env: GoogleEnv,
  userId: string,
  opts: StartSequenceOpts
) {
  if (!opts.gmailThreadId && !opts.recipientEmail) {
    throw new Error('Provide gmail_thread_id or recipient_email')
  }

  const [{ data: sequence }, { data: profile }] = await Promise.all([
    supabase
      .from('sequences')
      .select('id, name, steps')
      .eq('id', opts.sequenceId)
      .eq('user_id', userId)
      .maybeSingle(),
    supabase
      .from('profiles')
      .select('gmail_refresh_token, gmail_email')
      .eq('id', userId)
      .single(),
  ])

  if (!sequence) throw new Error('Sequence not found')
  const steps = (sequence.steps ?? []) as SequenceStep[]
  if (!steps.length) {
    throw new Error(`Sequence "${sequence.name}" has no steps — add steps to it first`)
  }

  // `email` is derived from the thread itself; everything else must be provided.
  // Checked before credentials so callers always learn what the sequence needs.
  const required = [...new Set(steps.flatMap((s) => extractVariables(s.body)))]
  const provided = opts.variables ?? {}
  const missing = required.filter((v) => v !== 'email' && !(v in provided))
  if (missing.length) {
    throw new Error(
      `Missing variables: ${missing.join(', ')}. ` +
        `Sequence "${sequence.name}" needs: ${required.join(', ')}`
    )
  }

  if (!profile?.gmail_refresh_token) {
    throw new Error('No Gmail credentials on file — sign in on the dashboard first')
  }

  const { access_token } = await refreshAccessToken(
    env.GOOGLE_CLIENT_ID,
    env.GOOGLE_CLIENT_SECRET,
    profile.gmail_refresh_token
  )

  let gmailThreadId = opts.gmailThreadId
  if (!gmailThreadId) {
    const found = await findLatestSentThread({ accessToken: access_token }, opts.recipientEmail!)
    if (!found) throw new Error(`No sent thread found to ${opts.recipientEmail}`)
    gmailThreadId = found
  }

  // One cadence per thread, ever.
  const { data: existing } = await supabase
    .from('watched_threads')
    .select('id')
    .eq('user_id', userId)
    .eq('gmail_thread_id', gmailThreadId)
    .maybeSingle()
  if (existing) {
    const { data: pending } = await supabase
      .from('scheduled_follow_ups')
      .select('scheduled_for')
      .eq('thread_id', existing.id)
      .eq('status', 'pending')
      .limit(1)
    if (pending?.[0]) {
      throw new Error(
        `Thread already has a follow-up scheduled for ${pending[0].scheduled_for} — stop that run first`
      )
    }
  }

  const { data: run, error: runError } = await supabase
    .from('watched_threads')
    .upsert(
      {
        user_id: userId,
        gmail_thread_id: gmailThreadId,
        status: 'active',
        sequence_id: opts.sequenceId,
        sequence_step: 1,
        variables: provided,
      },
      { onConflict: 'user_id,gmail_thread_id' }
    )
    .select()
    .single()
  if (runError) throw new Error(runError.message)

  await syncThreadFromGmail(supabase, env, {
    threadId: run.id,
    gmailThreadId,
    userId,
    refreshToken: profile.gmail_refresh_token,
    userEmail: profile.gmail_email ?? '',
  })

  const { data: messages } = await supabase
    .from('thread_messages')
    .select('direction, to_email, subject, sent_at')
    .eq('thread_id', run.id)
    .order('sent_at', { ascending: true })
  const sent = (messages ?? []).filter((m) => m.direction === 'sent')
  if (!sent.length) {
    throw new Error(
      'No sent message in this thread — send the personalized first email before starting a sequence'
    )
  }

  const lastSent = sent[sent.length - 1]
  const updates = {
    subject: run.subject ?? messages?.[0]?.subject ?? null,
    variables: {
      email: opts.recipientEmail ?? bareEmail(lastSent.to_email ?? ''),
      ...provided,
    },
  }
  await supabase.from('watched_threads').update(updates).eq('id', run.id)

  const nextDraftAt = await scheduleStep(
    supabase,
    run.id,
    userId,
    new Date(lastSent.sent_at ?? Date.now()),
    steps[0].delay_days
  )

  return {
    run: { ...run, ...updates },
    sequence_name: sequence.name,
    total_steps: steps.length,
    next_draft_at: nextDraftAt,
  }
}

/** Stop a run: no more drafts. Dismisses any pending follow-up. */
export async function stopRun(supabase: SupabaseClient, userId: string, threadId: string) {
  const { data: thread, error } = await supabase
    .from('watched_threads')
    .update({ status: 'stopped' })
    .eq('id', threadId)
    .eq('user_id', userId)
    .select()
    .single()
  if (error || !thread) throw new Error('Run not found')

  await supabase
    .from('scheduled_follow_ups')
    .update({ status: 'dismissed', acted_at: new Date().toISOString() })
    .eq('thread_id', threadId)
    .eq('status', 'pending')

  return thread
}

/**
 * Save a run's real conversation as one outreach example row for GTM
 * analysis: the full thread as text, linked to the sequence that won.
 * Self-contained copy — survives the thread being deleted later.
 */
export async function saveRunAsExample(
  supabase: SupabaseClient,
  userId: string,
  threadId: string,
  opts: { context?: string; outcome?: string; tags?: string[] } = {}
) {
  const [{ data: thread }, { data: messages }] = await Promise.all([
    supabase
      .from('watched_threads')
      .select('subject, sequence_id')
      .eq('id', threadId)
      .eq('user_id', userId)
      .maybeSingle(),
    supabase
      .from('thread_messages')
      .select('direction, body_text, snippet, sent_at')
      .eq('thread_id', threadId)
      .order('sent_at', { ascending: true }),
  ])
  if (!thread) throw new Error('Run not found')

  const withBodies = (messages ?? [])
    .map((m) => ({ ...m, text: (m.body_text ?? m.snippet ?? '').trim() }))
    .filter((m) => m.text)
  if (!withBodies.length) throw new Error('No messages with content in this thread')

  const body = withBodies
    .map(
      (m) =>
        `[${m.direction === 'sent' ? 'SENT' : 'RECEIVED'} ${m.sent_at?.slice(0, 10) ?? ''}]\n${m.text}`
    )
    .join('\n\n')

  const { data, error } = await supabase
    .from('outreach_examples')
    .insert({
      user_id: userId,
      context: opts.context ?? `Thread "${thread.subject ?? 'Untitled'}"`,
      subject: thread.subject,
      body,
      outcome: opts.outcome ?? 'replied',
      tags: opts.tags ?? [],
      sequence_id: thread.sequence_id,
    })
    .select()
    .single()
  if (error) throw new Error(error.message)
  return data
}
