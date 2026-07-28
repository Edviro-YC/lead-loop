import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { jsonResult, errorResult, type ToolContext } from '../helpers'
import { planFollowUpDraft, type FollowUpDraftPlan } from '../../jobs/follow-up-draft'
import { createFollowUpSchedule } from '../../services/scheduling'

/**
 * Find the thread's next pending scheduled follow-up (earliest first),
 * with the rule it belongs to. Ownership-checked: the service-role
 * client bypasses RLS.
 */
async function findPendingFollowUp(
  ctx: ToolContext,
  threadId: string
): Promise<{ id: string; scheduled_for: string; template_id: string | null } | null> {
  const { data } = await ctx.supabase
    .from('scheduled_follow_ups')
    .select('id, scheduled_for, follow_up_rules(template_id)')
    .eq('thread_id', threadId)
    .eq('user_id', ctx.userId)
    .eq('status', 'pending')
    .order('scheduled_for', { ascending: true })
    .limit(1)
    .maybeSingle()
  if (!data) return null

  // supabase-js types the to-one join as an array; at runtime it's an object.
  const rule = Array.isArray(data.follow_up_rules) ? data.follow_up_rules[0] : data.follow_up_rules
  return { id: data.id, scheduled_for: data.scheduled_for, template_id: rule?.template_id ?? null }
}

export function registerFollowUpTools(server: McpServer, ctx: ToolContext): void {
  const { supabase, env, userId } = ctx

  server.registerTool(
    'schedule_follow_up',
    {
      title: 'Schedule follow-up',
      description:
        'Start a follow-up schedule on a watched thread: creates the rule and the first pending follow-up. The cron drafts it when due and reschedules every delay_days until the thread gets a reply or the rule is cancelled. Use trigger_follow_up to run the pending one early. Errors if the thread already has a pending follow-up.',
      inputSchema: {
        thread_id: z.string().describe('Watched thread id (UUID, not the Gmail thread id)'),
        delay_days: z
          .number()
          .int()
          .min(1)
          .optional()
          .describe('Days until the follow-up, also the repeat cadence (default 3)'),
        template_id: z.string().optional().describe('Optional template id to base drafts on'),
      },
    },
    async ({ thread_id, delay_days, template_id }) => {
      try {
        const { rule, scheduled } = await createFollowUpSchedule(supabase, userId, thread_id, {
          delayDays: delay_days,
          templateId: template_id,
        })
        return jsonResult({
          rule_id: rule.id,
          scheduled_follow_up_id: scheduled.id,
          scheduled_for: scheduled.scheduled_for,
          delay_days: rule.delay_days,
        })
      } catch (err) {
        return errorResult(err instanceof Error ? err.message : String(err))
      }
    }
  )

  server.registerTool(
    'preview_follow_up_draft',
    {
      title: 'Preview follow-up draft',
      description:
        'Dry-run a watched thread\'s next follow-up draft: returns the recipient, subject, the exact OpenAI prompt (system + user messages), and the generated body. Creates no Gmail draft, does not advance the sequence step, and does not touch the schedule. Uses the pending follow-up\'s template when the thread has no sequence. Call sync_thread first if Gmail may have newer messages than the local copy.',
      inputSchema: {
        thread_id: z.string().describe('Watched thread id (UUID, not the Gmail thread id)'),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ thread_id }) => {
      const { data: thread } = await supabase
        .from('watched_threads')
        .select('id, subject, sequence_id, sequence_step')
        .eq('id', thread_id)
        .eq('user_id', userId)
        .single()
      if (!thread) return errorResult('Thread not found')

      const pending = await findPendingFollowUp(ctx, thread_id)

      let plan: FollowUpDraftPlan
      try {
        plan = await planFollowUpDraft(
          supabase, env.OPENAI_API_KEY, userId, thread,
          pending?.template_id
        )
      } catch (err) {
        return errorResult(err instanceof Error ? err.message : String(err))
      }

      if (plan.status === 'exhausted') {
        return errorResult(
          `Thread is past the end of sequence "${plan.sequenceName}" ` +
            `(step ${thread.sequence_step} of ${plan.totalSteps})`
        )
      }

      return jsonResult({
        scheduled_for: pending?.scheduled_for ?? null,
        to: plan.toEmail,
        subject: plan.subject,
        openai_prompt: plan.prompt,
        draft_body: plan.body,
      })
    }
  )

  server.registerTool(
    'trigger_follow_up',
    {
      title: 'Trigger follow-up now',
      description:
        'Run a watched thread\'s pending scheduled follow-up immediately instead of waiting for its scheduled time. This is the real thing: it creates the Gmail draft, advances the sequence step, and schedules the next follow-up per the rule\'s delay.',
      inputSchema: {
        thread_id: z.string().describe('Watched thread id (UUID, not the Gmail thread id)'),
      },
      annotations: { destructiveHint: false },
    },
    async ({ thread_id }) => {
      const pending = await findPendingFollowUp(ctx, thread_id)
      if (!pending) {
        return errorResult('No pending follow-up for this thread. Create one first with schedule_follow_up.')
      }

      await env.FOLLOW_UP_DRAFT_QUEUE.send({
        scheduledFollowUpId: pending.id,
        userId,
      })

      return jsonResult({
        triggered: pending.id,
        was_scheduled_for: pending.scheduled_for,
        note: 'Queued. The Gmail draft should appear on the thread within a few seconds; check the Follow-ups page for the result.',
      })
    }
  )
}
