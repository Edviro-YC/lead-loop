import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { ToolContext } from './helpers'
import { registerExampleTools } from './tools/examples'
import { registerRunTools } from './tools/runs'
import { registerSequenceTools } from './tools/sequences'

/**
 * Build a per-request MCP server with all LeadLoop tools registered,
 * closed over the authenticated user's context. The server is stateless:
 * a fresh instance is created for every HTTP request.
 */
export function buildMcpServer(ctx: ToolContext): McpServer {
  const server = new McpServer({ name: 'leadloop', version: '2.0.0' })

  registerSequenceTools(server, ctx)
  registerRunTools(server, ctx)
  registerExampleTools(server, ctx)

  return server
}
