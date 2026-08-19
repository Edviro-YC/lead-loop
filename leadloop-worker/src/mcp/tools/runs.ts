import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { jsonResult, errorResult, type ToolContext } from '../helpers'
import {
  startSequence,
  stopRun,
  saveRunAsExample,
  draftNow,
  sendLeadLoopDrafts,
  OUTSTANDING_DRAFT_STATUSES,
} from '../../services/runs'

/**
 * Attach actionable schedule state to runs so agents can pick safe ids:
 * `next_draft_at` (the scheduled cadence row, if any) and
 * `unsent_draft_status` (draft_created | sending | draft_missing | null).
 */
async function annotateRuns<T extends { id: string }>(
  supabase: SupabaseClient,
  userId: string,
  runs: T[]
): Promise<Array<T & { next_draft_at: string | null; unsent_draft_status: string | null }>> {
  if (runs.length === 0) return []
  const { data } = await supabase
    .from('scheduled_follow_ups')
    .select('thread_id, status, scheduled_for, acted_at')
    .eq('user_id', userId)
    .in(
      'thread_id',
      runs.map((r) => r.id)
    )
    .in('status', ['pending', 'drafting', ...OUTSTANDING_DRAFT_STATUSES])
  const rows = data ?? []

  return runs.map((run) => {
    const mine = rows.filter((s) => s.thread_id === run.id)
    const cadence = mine.find((s) => s.status === 'pending' || s.status === 'drafting')
    const draft = mine
      .filter((s) => (OUTSTANDING_DRAFT_STATUSES as readonly string[]).includes(s.status))
      .sort(
        (a, b) => new Date(b.acted_at ?? 0).getTime() - new Date(a.acted_at ?? 0).getTime()
      )[0]
    return {
      ...run,
      next_draft_at: cadence?.scheduled_for ?? null,
      unsent_draft_status: draft?.status ?? null,
    }
  })
}

export function registerRunTools(server: McpServer, ctx: ToolContext): void {
  const { supabase, env, userId } = ctx

  server.registerTool(
    'start_sequence',
    {
      title: 'Start sequence',
      description:
        'Tag a sent Gmail thread into LeadLoop and start a follow-up sequence on it. ' +
        'Send the personalized first email yourself first, then call this. ' +
        'Identify the thread by gmail_thread_id, or just pass recipient_email and the newest sent thread to that address is used. ' +
        "variables must cover every {{placeholder}} in the sequence's steps ({{email}} is auto-filled from the thread); " +
        'the error message lists anything missing. ' +
        "LeadLoop then creates each follow-up as a Gmail draft on each step's delay_days cadence — it never sends " +
        'on its own (sending a drafted follow-up requires an explicit send_leadloop_drafts call), ' +
        'and the run stops on its own when the lead replies.',
      inputSchema: {
        sequence_id: z.string().describe('Sequence id (UUID) — see list_sequences'),
        recipient_email: z
          .string()
          .optional()
          .describe("The lead's email address; resolves to your newest sent thread to them"),
        gmail_thread_id: z
          .string()
          .optional()
          .describe('Gmail thread id, when known (takes precedence over recipient_email)'),
        variables: z
          .record(z.string(), z.string())
          .optional()
          .describe(
            'Values for the sequence\'s {{variables}}, e.g. {"first_name": "Sara", "company": "Acme"}'
          ),
      },
      annotations: { destructiveHint: false },
    },
    async ({ sequence_id, recipient_email, gmail_thread_id, variables }) => {
      try {
        const result = await startSequence(supabase, env, userId, {
          sequenceId: sequence_id,
          recipientEmail: recipient_email,
          gmailThreadId: gmail_thread_id,
          variables,
        })
        return jsonResult(result)
      } catch (err) {
        return errorResult(err instanceof Error ? err.message : String(err))
      }
    }
  )

  server.registerTool(
    'list_runs',
    {
      title: 'List runs',
      description:
        'List sequence runs (Gmail threads enrolled in a sequence), most recently active first. ' +
        'Status: active (follow-ups pending), replied (lead answered — a candidate example), ' +
        'completed (sequence exhausted), stopped (manually ended). ' +
        'Each run includes next_draft_at (when its next follow-up will be drafted) and ' +
        'unsent_draft_status (a LeadLoop draft awaiting an explicit send, or null) — ' +
        'use these to choose run_ids for draft_now and send_leadloop_drafts.',
      inputSchema: {
        status: z
          .string()
          .optional()
          .describe('Filter by status: "active", "replied", "completed", "stopped"'),
        sequence_id: z.string().optional().describe('Only runs of this sequence (UUID)'),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ status, sequence_id }) => {
      let query = supabase
        .from('watched_threads')
        .select('*, sequences(name)')
        .eq('user_id', userId)
        .order('last_activity_at', { ascending: false, nullsFirst: false })

      if (status) query = query.eq('status', status)
      if (sequence_id) query = query.eq('sequence_id', sequence_id)

      const { data, error } = await query
      if (error) return errorResult(error.message)
      return jsonResult({ runs: await annotateRuns(supabase, userId, data ?? []) })
    }
  )

  server.registerTool(
    'get_run',
    {
      title: 'Get run',
      description:
        'Fetch one run with its synced messages in chronological order ' +
        '(direction "sent" = the user, "received" = the lead), plus next_draft_at and ' +
        'unsent_draft_status (a LeadLoop draft awaiting an explicit send, or null).',
      inputSchema: {
        run_id: z.string().describe('Run id (UUID, not the Gmail thread id) — see list_runs'),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ run_id }) => {
      const { data: run } = await supabase
        .from('watched_threads')
        .select('*, sequences(name)')
        .eq('id', run_id)
        .eq('user_id', userId)
        .maybeSingle()

      if (!run) return errorResult('Run not found')

      const [{ data: messages, error }, [annotated]] = await Promise.all([
        supabase
          .from('thread_messages')
          .select('*')
          .eq('thread_id', run_id)
          .order('sent_at', { ascending: true }),
        annotateRuns(supabase, userId, [run]),
      ])

      if (error) return errorResult(error.message)
      return jsonResult({
        run: annotated,
        messages,
        next_draft_at: annotated.next_draft_at,
      })
    }
  )

  server.registerTool(
    'draft_now',
    {
      title: 'Draft now',
      description:
        "Skip the remaining wait and draft the selected runs' next follow-up immediately. " +
        'Drafts only — nothing is sent. Requires explicit run_ids from list_runs (max 50); ' +
        'an empty list is rejected, never treated as "all". Runs with an unsent LeadLoop draft ' +
        '(unsent_draft_status set) are skipped — send it with send_leadloop_drafts first. ' +
        'Returns itemized queued/skipped per run; "queued" means the draft job was enqueued, ' +
        'the Gmail draft appears moments later.',
      inputSchema: {
        run_ids: z
          .array(z.string())
          .min(1)
          .max(50)
          .describe('Explicit run ids (UUIDs) — see list_runs'),
      },
      annotations: { destructiveHint: false },
    },
    async ({ run_ids }) => {
      try {
        return jsonResult(await draftNow(supabase, env.FOLLOW_UP_DRAFT_QUEUE, userId, run_ids))
      } catch (err) {
        return errorResult(err instanceof Error ? err.message : String(err))
      }
    }
  )

  server.registerTool(
    'send_leadloop_drafts',
    {
      title: 'Send LeadLoop drafts',
      description:
        "SENDS REAL EMAIL immediately: sends the selected runs' LeadLoop-created Gmail drafts. " +
        'Only drafts LeadLoop itself created are sent (addressed by stored draft id — other Gmail ' +
        'drafts are never listed or touched). Each thread is re-synced first: a reply skips and ' +
        'closes the run, and a newer outgoing message marks the draft superseded instead of ' +
        'double-sending. A Gmail 404 without send evidence is reported as draft_missing, never ' +
        'treated as sent. Requires explicit run_ids from list_runs (max 20); empty is rejected. ' +
        'Safe to retry — already-sent drafts report already_sent. The next step is rescheduled ' +
        'from the actual send time. Outcomes per run: sent, already_sent, skipped_reply, ' +
        'superseded, draft_missing, no_draft, not_found, failed.',
      inputSchema: {
        run_ids: z
          .array(z.string())
          .min(1)
          .max(20)
          .describe('Explicit run ids (UUIDs) — see list_runs'),
      },
      annotations: { destructiveHint: true, idempotentHint: true },
    },
    async ({ run_ids }) => {
      try {
        return jsonResult(await sendLeadLoopDrafts(supabase, env, userId, run_ids))
      } catch (err) {
        return errorResult(err instanceof Error ? err.message : String(err))
      }
    }
  )

  server.registerTool(
    'stop_run',
    {
      title: 'Stop run',
      description:
        'Stop a sequence run: no more follow-up drafts are created for the thread, and any ' +
        'pending or unsent-draft follow-up state is dismissed (existing Gmail drafts are ' +
        'not deleted, just made ineligible for send_leadloop_drafts).',
      inputSchema: {
        run_id: z.string().describe('Run id (UUID) — see list_runs'),
      },
      annotations: { destructiveHint: false, idempotentHint: true },
    },
    async ({ run_id }) => {
      try {
        const run = await stopRun(supabase, userId, run_id)
        return jsonResult({ run })
      } catch (err) {
        return errorResult(err instanceof Error ? err.message : String(err))
      }
    }
  )

  server.registerTool(
    'save_run_as_example',
    {
      title: 'Save run as example',
      description:
        'Save a winning run for the GTM team: the full conversation is copied into one outreach ' +
        'example, linked to the sequence that produced it. Use on runs that got a positive reply.',
      inputSchema: {
        run_id: z.string().describe('Run id (UUID) — see list_runs'),
        context: z
          .string()
          .optional()
          .describe('What made this a win (who the lead was, what worked)'),
        outcome: z
          .string()
          .optional()
          .describe('Outcome label (default "replied"; e.g. "meeting_booked")'),
        tags: z.array(z.string()).optional().describe('Tags for filtering'),
      },
      annotations: { destructiveHint: false },
    },
    async ({ run_id, context, outcome, tags }) => {
      try {
        const example = await saveRunAsExample(supabase, userId, run_id, {
          context,
          outcome,
          tags,
        })
        return jsonResult({ example })
      } catch (err) {
        return errorResult(err instanceof Error ? err.message : String(err))
      }
    }
  )
}
