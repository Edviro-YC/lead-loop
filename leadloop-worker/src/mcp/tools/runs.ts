import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { jsonResult, errorResult, type ToolContext } from '../helpers'
import { startSequence, stopRun, saveRunAsExample } from '../../services/runs'

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
        "LeadLoop then creates each follow-up as a Gmail draft on each step's delay_days cadence — it never sends, " +
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
        'completed (sequence exhausted), stopped (manually ended).',
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
      return jsonResult({ runs: data })
    }
  )

  server.registerTool(
    'get_run',
    {
      title: 'Get run',
      description:
        'Fetch one run with its synced messages in chronological order ' +
        '(direction "sent" = the user, "received" = the lead) and its next pending follow-up, if any.',
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

      const [{ data: messages, error }, { data: pending }] = await Promise.all([
        supabase
          .from('thread_messages')
          .select('*')
          .eq('thread_id', run_id)
          .order('sent_at', { ascending: true }),
        supabase
          .from('scheduled_follow_ups')
          .select('scheduled_for')
          .eq('thread_id', run_id)
          .eq('status', 'pending')
          .limit(1),
      ])

      if (error) return errorResult(error.message)
      return jsonResult({ run, messages, next_draft_at: pending?.[0]?.scheduled_for ?? null })
    }
  )

  server.registerTool(
    'stop_run',
    {
      title: 'Stop run',
      description:
        'Stop a sequence run: no more follow-up drafts are created for the thread. ' +
        'Any pending follow-up is dismissed.',
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
