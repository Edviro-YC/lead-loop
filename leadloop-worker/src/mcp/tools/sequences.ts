import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { jsonResult, errorResult, type ToolContext } from '../helpers'
import { extractVariables } from '../../lib/render'
import type { SequenceStep } from '../../services/runs'

const stepSchema = z.object({
  body: z
    .string()
    .min(1)
    .describe('Follow-up email body; use {{variable}} placeholders (e.g. {{first_name}})'),
  delay_days: z
    .number()
    .int()
    .min(1)
    .describe('Days to wait after the previous email before drafting this step (minimum 1)'),
})

const stepsField = z
  .array(stepSchema)
  .describe('Ordered follow-up emails: first item = step 1, drafted delay_days after your first email')

function requiredVariables(steps: SequenceStep[]): string[] {
  return [...new Set(steps.flatMap((s) => extractVariables(s.body)))].filter((v) => v !== 'email')
}

export function registerSequenceTools(server: McpServer, ctx: ToolContext): void {
  const { supabase, userId } = ctx

  server.registerTool(
    'list_sequences',
    {
      title: 'List sequences',
      description:
        "List the user's follow-up sequences (each carries its ordered follow-up emails as steps, " +
        'modeling a multi-touch arc: bump, case study, breakup, ...), newest first, with step counts.',
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    async () => {
      const { data, error } = await supabase
        .from('sequences')
        .select('id, name, description, created_at, steps')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })

      if (error) return errorResult(error.message)

      const sequences = (data ?? []).map(({ steps, ...seq }) => ({
        ...seq,
        step_count: ((steps ?? []) as SequenceStep[]).length,
      }))
      return jsonResult({ sequences })
    }
  )

  server.registerTool(
    'get_sequence',
    {
      title: 'Get sequence',
      description:
        'Fetch one sequence with its ordered steps (body + delay_days each) and the ' +
        '{{variables}} required to start a run of it.',
      inputSchema: {
        id: z.string().describe('Sequence id (UUID)'),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ id }) => {
      const { data: sequence, error } = await supabase
        .from('sequences')
        .select('id, name, description, steps, created_at')
        .eq('id', id)
        .eq('user_id', userId)
        .maybeSingle()

      if (error) return errorResult(error.message)
      if (!sequence) return errorResult('Sequence not found')

      const steps = (sequence.steps ?? []) as SequenceStep[]
      return jsonResult({ sequence, required_variables: requiredVariables(steps) })
    }
  )

  server.registerTool(
    'create_sequence',
    {
      title: 'Create sequence',
      description:
        'Create a follow-up sequence with its steps inline. Each step is a follow-up email ' +
        '(body with {{variable}} placeholders + delay_days). You send the personalized first ' +
        'email yourself; steps are what LeadLoop drafts after it.',
      inputSchema: {
        name: z.string().min(1).describe('Sequence name (e.g. "K-12 facilities cold outreach")'),
        description: z
          .string()
          .optional()
          .describe('Who this sequence targets and what arc it follows'),
        steps: stepsField.optional(),
      },
      annotations: { destructiveHint: false },
    },
    async ({ name, description, steps }) => {
      const { data, error } = await supabase
        .from('sequences')
        .insert({ user_id: userId, name, description, steps: steps ?? [] })
        .select('id, name, description, steps, created_at')
        .single()

      if (error) return errorResult(error.message)
      return jsonResult({ sequence: data })
    }
  )

  server.registerTool(
    'update_sequence',
    {
      title: 'Update sequence',
      description:
        'Update a sequence: rename, change description, or replace its steps wholesale ' +
        '(pass the full ordered steps array — it overwrites the existing one). ' +
        'Active runs pick up step edits on their next draft.',
      inputSchema: {
        id: z.string().describe('Sequence id (UUID)'),
        name: z.string().min(1).optional(),
        description: z.string().optional(),
        steps: stepsField.optional(),
      },
      annotations: { destructiveHint: false, idempotentHint: true },
    },
    async ({ id, name, description, steps }) => {
      const updates: Record<string, unknown> = {}
      if (name !== undefined) updates.name = name
      if (description !== undefined) updates.description = description
      if (steps !== undefined) updates.steps = steps
      if (Object.keys(updates).length === 0) return errorResult('No fields to update')

      const { data, error } = await supabase
        .from('sequences')
        .update(updates)
        .eq('id', id)
        .eq('user_id', userId)
        .select('id, name, description, steps, created_at')
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
        'Delete a sequence and its steps. Runs assigned to it are unassigned (no more drafts).',
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
}
