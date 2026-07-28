import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Find all scheduled follow-ups that are due now. Called by the cron.
 */
export async function getDueFollowUps(
  supabase: SupabaseClient
): Promise<
  Array<{
    id: string
    rule_id: string
    thread_id: string
    user_id: string
  }>
> {
  const now = new Date().toISOString()

  const { data, error } = await supabase
    .from('scheduled_follow_ups')
    .select('id, rule_id, thread_id, user_id')
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
 * Start a follow-up schedule on a thread: create the rule and its first
 * pending occurrence. Shared by the dashboard API, the Gmail add-on, and
 * the MCP tool. Throws if the thread isn't the user's or already has a
 * pending follow-up (parallel cadences on one thread are never wanted).
 * Plain `.limit(1)` selects (not `.maybeSingle()`) so callers under either
 * the RLS or service-role client behave identically.
 */
export async function createFollowUpSchedule(
  supabase: SupabaseClient,
  userId: string,
  threadId: string,
  opts: { delayDays?: number; condition?: string; templateId?: string | null } = {}
) {
  const { data: threads } = await supabase
    .from('watched_threads')
    .select('id')
    .eq('id', threadId)
    .eq('user_id', userId)
    .limit(1)
  if (!threads?.[0]) throw new Error('Thread not found')

  const { data: pending } = await supabase
    .from('scheduled_follow_ups')
    .select('id, scheduled_for')
    .eq('thread_id', threadId)
    .eq('status', 'pending')
    .limit(1)
  if (pending?.[0]) {
    throw new Error(`Thread already has a pending follow-up (scheduled for ${pending[0].scheduled_for})`)
  }

  const delayDays = opts.delayDays ?? 3

  const { data: rule, error: ruleErr } = await supabase
    .from('follow_up_rules')
    .insert({
      thread_id: threadId,
      user_id: userId,
      delay_days: delayDays,
      condition: opts.condition ?? 'no_reply',
      template_id: opts.templateId ?? null,
    })
    .select()
    .single()
  if (ruleErr) throw new Error(ruleErr.message)

  const scheduledFor = new Date()
  scheduledFor.setDate(scheduledFor.getDate() + delayDays)

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
  if (schedErr) throw new Error(schedErr.message)

  return { rule, scheduled }
}

/**
 * After a follow-up draft is created, schedule the next one. There is no
 * draft-count cap: a rule runs until the thread gets a reply, its sequence
 * exhausts, or the user cancels it.
 */
export async function scheduleNextFollowUp(
  supabase: SupabaseClient,
  ruleId: string,
  threadId: string,
  userId: string
): Promise<void> {
  const { data: rule } = await supabase
    .from('follow_up_rules')
    .select('delay_days, status')
    .eq('id', ruleId)
    .single()

  if (!rule || rule.status !== 'active') return

  const scheduledFor = new Date()
  scheduledFor.setDate(scheduledFor.getDate() + rule.delay_days)

  await supabase.from('scheduled_follow_ups').insert({
    rule_id: ruleId,
    thread_id: threadId,
    user_id: userId,
    scheduled_for: scheduledFor.toISOString(),
  })
}
