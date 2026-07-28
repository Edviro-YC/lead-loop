import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { jsonResult, errorResult, type ToolContext } from '../helpers'
import { syncThreadFromGmail } from '../../jobs/thread-sync'
import { assertSequenceOwned } from './sequences'

export function registerThreadTools(server: McpServer, ctx: ToolContext): void {
  const { supabase, env, userId } = ctx

  server.registerTool(
    'list_watched_threads',
    {
      title: 'List watched threads',
      description:
        'List Gmail threads LeadLoop is watching for this user, most recently active first, with the linked lead (name, email, company) when set.',
      inputSchema: {
        status: z.string().optional().describe('Filter by status (e.g. "active", "closed")'),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ status }) => {
      let query = supabase
        .from('watched_threads')
        .select('*, leads(name, email, company), sequences(name)')
        .eq('user_id', userId)
        .order('last_activity_at', { ascending: false, nullsFirst: false })

      if (status) query = query.eq('status', status)

      const { data, error } = await query
      if (error) return errorResult(error.message)
      return jsonResult({ threads: data })
    }
  )

  server.registerTool(
    'get_thread_messages',
    {
      title: 'Get thread messages',
      description:
        'Fetch the synced messages of a watched thread in chronological order (direction "sent" = the user, "received" = the other party).',
      inputSchema: {
        thread_id: z.string().describe('Watched thread id (UUID, not the Gmail thread id)'),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ thread_id }) => {
      const { data: thread } = await supabase
        .from('watched_threads')
        .select('id, subject, status')
        .eq('id', thread_id)
        .eq('user_id', userId)
        .single()

      if (!thread) return errorResult('Thread not found')

      const { data, error } = await supabase
        .from('thread_messages')
        .select('*')
        .eq('thread_id', thread_id)
        .order('sent_at', { ascending: true })

      if (error) return errorResult(error.message)
      return jsonResult({ thread, messages: data })
    }
  )

  server.registerTool(
    'watch_thread',
    {
      title: 'Watch thread',
      description:
        'Start watching a Gmail thread (by its Gmail thread id). Upserts the watch and immediately syncs the thread\'s messages from Gmail. Optionally link it to a lead.',
      inputSchema: {
        gmail_thread_id: z.string().min(1).describe('The Gmail thread id'),
        subject: z.string().optional().describe('Thread subject (for display)'),
        lead_id: z.string().optional().describe('Lead id (UUID) to link this thread to'),
      },
      annotations: { destructiveHint: false, idempotentHint: true },
    },
    async ({ gmail_thread_id, subject, lead_id }) => {
      const { data, error } = await supabase
        .from('watched_threads')
        .upsert(
          { gmail_thread_id, subject, lead_id, user_id: userId, status: 'active' },
          { onConflict: 'user_id,gmail_thread_id' }
        )
        .select()
        .single()

      if (error) return errorResult(error.message)

      const { data: profile } = await supabase
        .from('profiles')
        .select('gmail_refresh_token, gmail_email')
        .eq('id', userId)
        .single()

      let synced = false
      let syncWarning: string | undefined
      if (profile?.gmail_refresh_token) {
        try {
          await syncThreadFromGmail(supabase, env, {
            threadId: data.id,
            gmailThreadId: gmail_thread_id,
            userId,
            refreshToken: profile.gmail_refresh_token,
            userEmail: profile.gmail_email ?? '',
          })
          synced = true
        } catch (err) {
          syncWarning = `Initial sync failed: ${err instanceof Error ? err.message : String(err)}`
        }
      } else {
        syncWarning = 'No Gmail credentials on file; thread watched but not synced'
      }

      return jsonResult({ thread: data, synced, ...(syncWarning ? { warning: syncWarning } : {}) })
    }
  )

  server.registerTool(
    'update_watched_thread',
    {
      title: 'Update watched thread',
      description:
        'Update a watched thread\'s status (e.g. close it), change which lead it is linked to (null unlinks), or assign it to an outreach sequence. Assigning a sequence without sequence_step resets the step to 1; sequence_step is the next step to draft.',
      inputSchema: {
        id: z.string().describe('Watched thread id (UUID)'),
        status: z.string().optional().describe('New status (e.g. "active", "closed")'),
        lead_id: z.string().nullable().optional().describe('Lead id (UUID) to link, or null to unlink'),
        sequence_id: z
          .string()
          .nullable()
          .optional()
          .describe('Sequence id (UUID) to assign, or null to unassign'),
        sequence_step: z
          .number()
          .int()
          .min(1)
          .optional()
          .describe('Next step to draft (1-based); defaults to 1 when assigning a sequence'),
      },
      annotations: { destructiveHint: false, idempotentHint: true },
    },
    async ({ id, status, lead_id, sequence_id, sequence_step }) => {
      const updates: Record<string, unknown> = {}
      if (status !== undefined) updates.status = status
      if (lead_id !== undefined) updates.lead_id = lead_id
      if (sequence_id !== undefined) {
        if (sequence_id !== null) {
          const ownership = await assertSequenceOwned(ctx, sequence_id)
          if (ownership) return errorResult(ownership)
        }
        updates.sequence_id = sequence_id
        updates.sequence_step = sequence_step ?? 1
      } else if (sequence_step !== undefined) {
        updates.sequence_step = sequence_step
      }
      if (Object.keys(updates).length === 0) return errorResult('No fields to update')

      const { data, error } = await supabase
        .from('watched_threads')
        .update(updates)
        .eq('id', id)
        .eq('user_id', userId)
        .select()
        .single()

      if (error || !data) return errorResult(error?.message ?? 'Thread not found')
      return jsonResult({ thread: data })
    }
  )

  server.registerTool(
    'sync_thread',
    {
      title: 'Sync thread',
      description: 'Re-sync a watched thread\'s messages from Gmail so the local copy is up to date.',
      inputSchema: {
        id: z.string().describe('Watched thread id (UUID)'),
      },
      annotations: { destructiveHint: false, idempotentHint: true },
    },
    async ({ id }) => {
      const [{ data: thread }, { data: profile }] = await Promise.all([
        supabase
          .from('watched_threads')
          .select('gmail_thread_id')
          .eq('id', id)
          .eq('user_id', userId)
          .single(),
        supabase
          .from('profiles')
          .select('gmail_refresh_token, gmail_email')
          .eq('id', userId)
          .single(),
      ])

      if (!thread) return errorResult('Thread not found')
      if (!profile?.gmail_refresh_token) return errorResult('Gmail credentials expired')

      try {
        await syncThreadFromGmail(supabase, env, {
          threadId: id,
          gmailThreadId: thread.gmail_thread_id,
          userId,
          refreshToken: profile.gmail_refresh_token,
          userEmail: profile.gmail_email ?? '',
        })
      } catch (err) {
        return errorResult(`Sync failed: ${err instanceof Error ? err.message : String(err)}`)
      }

      return jsonResult({ synced: true })
    }
  )
}
