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
 * After a follow-up draft is created, schedule the next one if the rule
 * hasn't been exhausted.
 */
export async function scheduleNextFollowUp(
  supabase: SupabaseClient,
  ruleId: string,
  threadId: string,
  userId: string
): Promise<void> {
  // Fetch the rule to check counts
  const { data: rule } = await supabase
    .from('follow_up_rules')
    .select('current_count, max_follow_ups, delay_days, status')
    .eq('id', ruleId)
    .single()

  if (!rule || rule.status !== 'active') return

  const nextCount = rule.current_count + 1
  if (nextCount >= rule.max_follow_ups) {
    // Exhausted -- mark rule done
    await supabase
      .from('follow_up_rules')
      .update({ current_count: nextCount, status: 'exhausted' })
      .eq('id', ruleId)
    return
  }

  // Increment counter and schedule next
  await supabase
    .from('follow_up_rules')
    .update({ current_count: nextCount })
    .eq('id', ruleId)

  const scheduledFor = new Date()
  scheduledFor.setDate(scheduledFor.getDate() + rule.delay_days)

  await supabase.from('scheduled_follow_ups').insert({
    rule_id: ruleId,
    thread_id: threadId,
    user_id: userId,
    scheduled_for: scheduledFor.toISOString(),
  })
}
