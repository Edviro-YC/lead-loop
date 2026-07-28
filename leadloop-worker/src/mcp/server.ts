import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { ToolContext } from './helpers'
import { registerTemplateTools } from './tools/templates'
import { registerExampleTools } from './tools/examples'
import { registerThreadTools } from './tools/threads'
import { registerSequenceTools } from './tools/sequences'
import { registerFollowUpTools } from './tools/follow-ups'

/**
 * Build a per-request MCP server with all LeadLoop tools registered,
 * closed over the authenticated user's context. The server is stateless:
 * a fresh instance is created for every HTTP request.
 */
export function buildMcpServer(ctx: ToolContext): McpServer {
  const server = new McpServer({ name: 'leadloop', version: '1.0.0' })

  registerTemplateTools(server, ctx)
  registerExampleTools(server, ctx)
  registerThreadTools(server, ctx)
  registerSequenceTools(server, ctx)
  registerFollowUpTools(server, ctx)

  return server
}
