import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { jsonResult, errorResult, type ToolContext } from '../helpers'

/** Extract unique {{placeholder}} names from a template's subject + body. */
function extractVariables(subject: string | undefined | null, body: string): string[] {
  const text = `${subject ?? ''}\n${body}`
  return [...new Set([...text.matchAll(/\{\{([a-zA-Z0-9_]+)\}\}/g)].map((m) => m[1]))]
}

export function registerTemplateTools(server: McpServer, ctx: ToolContext): void {
  const { supabase, userId } = ctx

  server.registerTool(
    'list_templates',
    {
      title: 'List templates',
      description:
        'List the user\'s email outreach templates. Returns active templates by default. Template bodies use {{variable}} placeholders.',
      inputSchema: {
        category: z.string().optional().describe('Filter by template category'),
        include_inactive: z
          .boolean()
          .optional()
          .describe('Include deactivated templates (default false)'),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ category, include_inactive }) => {
      let query = supabase
        .from('templates')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })

      if (category) query = query.eq('category', category)
      if (!include_inactive) query = query.eq('is_active', true)

      const { data, error } = await query
      if (error) return errorResult(error.message)
      return jsonResult({ templates: data })
    }
  )

  server.registerTool(
    'get_template',
    {
      title: 'Get template',
      description: 'Fetch a single outreach template by id, including its full body and variables.',
      inputSchema: {
        id: z.string().describe('Template id (UUID)'),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ id }) => {
      const { data, error } = await supabase
        .from('templates')
        .select('*')
        .eq('id', id)
        .eq('user_id', userId)
        .single()

      if (error || !data) return errorResult('Template not found')
      return jsonResult({ template: data })
    }
  )

  server.registerTool(
    'create_template',
    {
      title: 'Create template',
      description:
        'Create a new email outreach template. Use {{variable}} placeholders in the subject/body for personalization (e.g. {{name}}, {{company}}). Variables are auto-detected from the content unless explicitly provided.',
      inputSchema: {
        name: z.string().min(1).describe('Template name'),
        subject: z.string().optional().describe('Email subject line, may contain {{variables}}'),
        body: z.string().min(1).describe('Email body, may contain {{variables}}'),
        category: z.string().optional().describe('Category for organizing templates'),
        variables: z
          .array(z.string())
          .optional()
          .describe('Placeholder names; auto-extracted from subject/body when omitted'),
      },
      annotations: { destructiveHint: false },
    },
    async ({ name, subject, body, category, variables }) => {
      const { data, error } = await supabase
        .from('templates')
        .insert({
          user_id: userId,
          name,
          subject,
          body,
          category,
          variables: variables ?? extractVariables(subject, body),
        })
        .select()
        .single()

      if (error) return errorResult(error.message)
      return jsonResult({ template: data })
    }
  )

  server.registerTool(
    'update_template',
    {
      title: 'Update template',
      description:
        'Update fields of an existing outreach template. Only provided fields are changed. Set is_active to false to deactivate a template without deleting it.',
      inputSchema: {
        id: z.string().describe('Template id (UUID)'),
        name: z.string().min(1).optional(),
        subject: z.string().optional(),
        body: z.string().min(1).optional(),
        category: z.string().optional(),
        variables: z
          .array(z.string())
          .optional()
          .describe('Placeholder names; re-extracted from content when omitted and subject/body change'),
        is_active: z.boolean().optional(),
      },
      annotations: { destructiveHint: false, idempotentHint: true },
    },
    async ({ id, ...fields }) => {
      const updates: Record<string, unknown> = {}
      for (const [key, value] of Object.entries(fields)) {
        if (value !== undefined) updates[key] = value
      }
      if (Object.keys(updates).length === 0) return errorResult('No fields to update')

      // Keep stored variables in sync when content changes without explicit variables.
      if (updates.variables === undefined && (updates.body !== undefined || updates.subject !== undefined)) {
        const { data: existing } = await supabase
          .from('templates')
          .select('subject, body')
          .eq('id', id)
          .eq('user_id', userId)
          .single()

        if (!existing) return errorResult('Template not found')

        updates.variables = extractVariables(
          (updates.subject as string | undefined) ?? existing.subject,
          (updates.body as string | undefined) ?? existing.body
        )
      }

      const { data, error } = await supabase
        .from('templates')
        .update(updates)
        .eq('id', id)
        .eq('user_id', userId)
        .select()
        .single()

      if (error || !data) return errorResult(error?.message ?? 'Template not found')
      return jsonResult({ template: data })
    }
  )

  server.registerTool(
    'delete_template',
    {
      title: 'Delete template',
      description:
        'Permanently delete an outreach template. Prefer update_template with is_active=false to deactivate instead.',
      inputSchema: {
        id: z.string().describe('Template id (UUID)'),
      },
      annotations: { destructiveHint: true },
    },
    async ({ id }) => {
      const { data, error } = await supabase
        .from('templates')
        .delete()
        .eq('id', id)
        .eq('user_id', userId)
        .select('id')

      if (error) return errorResult(error.message)
      if (!data?.length) return errorResult('Template not found')
      return jsonResult({ deleted: true, id })
    }
  )
}
