import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { jsonResult, errorResult, type ToolContext } from '../helpers'

/**
 * Verify a sequence belongs to the user. Required on every write that
 * takes a sequence id: this is the service-role client, so RLS is bypassed.
 */
export async function assertSequenceOwned(
  ctx: ToolContext,
  sequenceId: string
): Promise<string | null> {
  const { data, error } = await ctx.supabase
    .from('sequences')
    .select('id')
    .eq('id', sequenceId)
    .eq('user_id', ctx.userId)
    .maybeSingle()

  if (error) return error.message
  if (!data) return `Sequence ${sequenceId} not found`
  return null
}

export function registerSequenceTools(server: McpServer, ctx: ToolContext): void {
  const { supabase, userId } = ctx

  server.registerTool(
    'list_sequences',
    {
      title: 'List sequences',
      description:
        'List the user\'s outreach sequences (named, ordered groups of outreach examples that model a multi-touch arc), newest first, with their step counts.',
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    async () => {
      const { data, error } = await supabase
        .from('sequences')
        .select('id, name, description, created_at, outreach_examples(count)')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })

      if (error) return errorResult(error.message)

      const sequences = (data ?? []).map(({ outreach_examples, ...seq }) => ({
        ...seq,
        step_count: (outreach_examples as unknown as Array<{ count: number }>)[0]?.count ?? 0,
      }))
      return jsonResult({ sequences })
    }
  )

  server.registerTool(
    'get_sequence',
    {
      title: 'Get sequence',
      description:
        'Fetch one sequence with its full ordered steps (each step is an outreach example with context, subject, and body).',
      inputSchema: {
        id: z.string().describe('Sequence id (UUID)'),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ id }) => {
      const { data: sequence, error } = await supabase
        .from('sequences')
        .select('id, name, description, created_at')
        .eq('id', id)
        .eq('user_id', userId)
        .maybeSingle()

      if (error) return errorResult(error.message)
      if (!sequence) return errorResult('Sequence not found')

      const { data: steps, error: stepsError } = await supabase
        .from('outreach_examples')
        .select('id, step_number, context, subject, body, outcome, tags')
        .eq('sequence_id', id)
        .eq('user_id', userId)
        .order('step_number', { ascending: true })

      if (stepsError) return errorResult(stepsError.message)
      return jsonResult({ sequence, steps })
    }
  )

  server.registerTool(
    'create_sequence',
    {
      title: 'Create sequence',
      description:
        'Create an empty outreach sequence. Add steps by calling create_example (or update_example) with sequence_id and step_number, or reorder existing examples with set_sequence_steps.',
      inputSchema: {
        name: z.string().min(1).describe('Sequence name (e.g. "K-12 facilities cold outreach")'),
        description: z
          .string()
          .optional()
          .describe('Who this sequence targets and what arc it follows'),
      },
      annotations: { destructiveHint: false },
    },
    async ({ name, description }) => {
      const { data, error } = await supabase
        .from('sequences')
        .insert({ user_id: userId, name, description })
        .select('id, name, description, created_at')
        .single()

      if (error) return errorResult(error.message)
      return jsonResult({ sequence: data })
    }
  )

  server.registerTool(
    'update_sequence',
    {
      title: 'Update sequence',
      description: 'Rename a sequence or change its description.',
      inputSchema: {
        id: z.string().describe('Sequence id (UUID)'),
        name: z.string().min(1).optional(),
        description: z.string().optional(),
      },
      annotations: { destructiveHint: false, idempotentHint: true },
    },
    async ({ id, name, description }) => {
      const updates: Record<string, unknown> = {}
      if (name !== undefined) updates.name = name
      if (description !== undefined) updates.description = description
      if (Object.keys(updates).length === 0) return errorResult('No fields to update')

      const { data, error } = await supabase
        .from('sequences')
        .update(updates)
        .eq('id', id)
        .eq('user_id', userId)
        .select('id, name, description, created_at')
        .single()

      if (error || !data) return errorResult(error?.message ?? 'Sequence not found')
      return jsonResult({ sequence: data })
    }
  )

  server.registerTool(
    'delete_sequence',
    {
      title: 'Delete sequence',
      description:
        'Delete a sequence. Its step examples are NOT deleted — they revert to standalone outreach examples. Threads assigned to it are unassigned.',
      inputSchema: {
        id: z.string().describe('Sequence id (UUID)'),
      },
      annotations: { destructiveHint: true },
    },
    async ({ id }) => {
      const { data, error } = await supabase
        .from('sequences')
        .delete()
        .eq('id', id)
        .eq('user_id', userId)
        .select('id')

      if (error) return errorResult(error.message)
      if (!data?.length) return errorResult('Sequence not found')
      return jsonResult({ deleted: true, id })
    }
  )

  server.registerTool(
    'set_sequence_steps',
    {
      title: 'Set sequence steps',
      description:
        'Set a sequence\'s steps to exactly this ordered list of example ids (first id = step 1). Examples currently in the sequence but not listed revert to standalone. Use for adding, removing, and reordering steps in one call.',
      inputSchema: {
        sequence_id: z.string().describe('Sequence id (UUID)'),
        example_ids: z
          .array(z.string())
          .min(1)
          .describe('Example ids (UUIDs) in step order'),
      },
      annotations: { destructiveHint: false, idempotentHint: true },
    },
    async ({ sequence_id, example_ids }) => {
      const ownership = await assertSequenceOwned(ctx, sequence_id)
      if (ownership) return errorResult(ownership)

      // All listed examples must exist and belong to the user before touching anything.
      const { data: owned, error: ownedError } = await supabase
        .from('outreach_examples')
        .select('id')
        .eq('user_id', userId)
        .in('id', example_ids)

      if (ownedError) return errorResult(ownedError.message)
      const ownedIds = new Set((owned ?? []).map((e) => e.id))
      const missing = example_ids.filter((id) => !ownedIds.has(id))
      if (missing.length) return errorResult(`Examples not found: ${missing.join(', ')}`)
      if (new Set(example_ids).size !== example_ids.length) {
        return errorResult('example_ids contains duplicates')
      }

      // ponytail: two-phase (clear membership, then reassign) instead of a
      // transaction, to sidestep the unique (sequence_id, step_number) index
      // during reorders; fine for a single-user tool.
      const { error: clearError } = await supabase
        .from('outreach_examples')
        .update({ sequence_id: null, step_number: null })
        .eq('sequence_id', sequence_id)

      if (clearError) return errorResult(clearError.message)

      for (const [index, id] of example_ids.entries()) {
        const { error } = await supabase
          .from('outreach_examples')
          .update({ sequence_id, step_number: index + 1 })
          .eq('id', id)
          .eq('user_id', userId)
        if (error) {
          return errorResult(`Failed at step ${index + 1} (example ${id}): ${error.message}`)
        }
      }

      return jsonResult({
        sequence_id,
        steps: example_ids.map((id, i) => ({ step_number: i + 1, example_id: id })),
      })
    }
  )
}
