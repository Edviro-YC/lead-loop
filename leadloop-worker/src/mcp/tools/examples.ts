import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { SupabaseClient } from '@supabase/supabase-js'
import { jsonResult, errorResult, type ToolContext } from '../helpers'

const EXAMPLE_COLUMNS = 'id, context, subject, body, outcome, tags, sequence_id, created_at'

/** The service-role client bypasses RLS, so linking to a sequence checks ownership explicitly. */
async function assertSequenceOwned(
  supabase: SupabaseClient,
  userId: string,
  sequenceId: string
): Promise<string | null> {
  const { data } = await supabase
    .from('sequences')
    .select('id')
    .eq('id', sequenceId)
    .eq('user_id', userId)
    .maybeSingle()
  return data ? null : 'Sequence not found'
}

export function registerExampleTools(server: McpServer, ctx: ToolContext): void {
  const { supabase, userId } = ctx

  server.registerTool(
    'list_examples',
    {
      title: 'List outreach examples',
      description:
        "List the user's saved outreach examples (winning conversations tagged for GTM analysis), " +
        'newest first. Filter by tag, outcome, the sequence that won, or a text query.',
      inputSchema: {
        query: z
          .string()
          .optional()
          .describe('Text search over context, subject, and body'),
        tag: z.string().optional().describe('Only examples tagged with this tag'),
        outcome: z
          .string()
          .optional()
          .describe('Only examples with this outcome (e.g. "replied", "meeting_booked")'),
        sequence_id: z
          .string()
          .optional()
          .describe('Only examples produced by this sequence (UUID)'),
        limit: z.number().int().min(1).max(100).optional().describe('Max results (default all)'),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ query: text, tag, outcome, sequence_id, limit }) => {
      let query = supabase
        .from('outreach_examples')
        .select(EXAMPLE_COLUMNS)
        .eq('user_id', userId)
        .order('created_at', { ascending: false })

      if (text) {
        const escaped = text.replace(/[%_,()]/g, ' ').trim()
        query = query.or(
          `context.ilike.%${escaped}%,subject.ilike.%${escaped}%,body.ilike.%${escaped}%`
        )
      }
      if (tag) query = query.contains('tags', [tag])
      if (outcome) query = query.eq('outcome', outcome)
      if (sequence_id) query = query.eq('sequence_id', sequence_id)
      if (limit) query = query.limit(limit)

      const { data, error } = await query
      if (error) return errorResult(error.message)
      return jsonResult({ examples: data })
    }
  )

  server.registerTool(
    'create_example',
    {
      title: 'Create outreach example',
      description:
        'Save an outreach example (an email or conversation that worked) for the GTM team to ' +
        'analyze. To capture a whole run, prefer save_run_as_example.',
      inputSchema: {
        context: z
          .string()
          .min(1)
          .describe('The situation this email was written for (who, why, what stage)'),
        subject: z.string().optional().describe('Email subject line'),
        body: z.string().min(1).describe('The email or conversation text'),
        outcome: z.string().optional().describe('What happened (e.g. "replied", "meeting_booked")'),
        tags: z.array(z.string()).optional().describe('Tags for filtering'),
        sequence_id: z
          .string()
          .optional()
          .describe('Sequence (UUID) that produced this win, if any'),
      },
      annotations: { destructiveHint: false },
    },
    async ({ context, subject, body, outcome, tags, sequence_id }) => {
      if (sequence_id) {
        const ownership = await assertSequenceOwned(supabase, userId, sequence_id)
        if (ownership) return errorResult(ownership)
      }

      const { data, error } = await supabase
        .from('outreach_examples')
        .insert({ user_id: userId, context, subject, body, outcome, tags, sequence_id })
        .select(EXAMPLE_COLUMNS)
        .single()

      if (error) return errorResult(error.message)
      return jsonResult({ example: data })
    }
  )

  server.registerTool(
    'update_example',
    {
      title: 'Update outreach example',
      description:
        'Update fields of an existing outreach example. Set sequence_id null to unlink it from ' +
        'its sequence.',
      inputSchema: {
        id: z.string().describe('Example id (UUID)'),
        context: z.string().min(1).optional(),
        subject: z.string().optional(),
        body: z.string().min(1).optional(),
        outcome: z.string().optional(),
        tags: z.array(z.string()).optional(),
        sequence_id: z
          .string()
          .nullable()
          .optional()
          .describe('Sequence (UUID) that produced this win, or null to unlink'),
      },
      annotations: { destructiveHint: false, idempotentHint: true },
    },
    async ({ id, sequence_id, ...fields }) => {
      const updates: Record<string, unknown> = {}
      for (const [key, value] of Object.entries(fields)) {
        if (value !== undefined) updates[key] = value
      }

      if (sequence_id !== undefined) {
        if (sequence_id !== null) {
          const ownership = await assertSequenceOwned(supabase, userId, sequence_id)
          if (ownership) return errorResult(ownership)
        }
        updates.sequence_id = sequence_id
      }

      if (Object.keys(updates).length === 0) return errorResult('No fields to update')

      const { data, error } = await supabase
        .from('outreach_examples')
        .update(updates)
        .eq('id', id)
        .eq('user_id', userId)
        .select(EXAMPLE_COLUMNS)
        .single()

      if (error || !data) return errorResult(error?.message ?? 'Example not found')
      return jsonResult({ example: data })
    }
  )

  server.registerTool(
    'delete_example',
    {
      title: 'Delete outreach example',
      description: 'Permanently delete an outreach example.',
      inputSchema: {
        id: z.string().describe('Example id (UUID)'),
      },
      annotations: { destructiveHint: true },
    },
    async ({ id }) => {
      const { data, error } = await supabase
        .from('outreach_examples')
        .delete()
        .eq('id', id)
        .eq('user_id', userId)
        .select('id')

      if (error) return errorResult(error.message)
      if (!data?.length) return errorResult('Example not found')
      return jsonResult({ deleted: true, id })
    }
  )
}
