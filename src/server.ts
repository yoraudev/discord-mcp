import { McpServer } from '@modelcontextprotocol/server';
import { ToolError, sanitize } from './errors.js';
import { createRuntime } from './runtime.js';
import { reviewedAt } from './reference.js';
import { version } from './version.js';

export function createServer(runtime: ReturnType<typeof createRuntime>): McpServer {
  const server = new McpServer({ name: 'discord-mcp', version });
  for (const tool of runtime.tools) {
    server.registerTool(tool.name, {
      description: tool.description,
      inputSchema: tool.schema,
      annotations: { readOnlyHint: tool.readOnly, destructiveHint: tool.destructive, idempotentHint: tool.readOnly, openWorldHint: true }
    }, async (input, extra) => {
      try {
        const result = await tool.execute(input, extra.mcpReq.signal);
        const value = sanitize(result, [runtime.config.token ?? '', runtime.config.clientSecret ?? '']);
        const structuredContent = { data: value ?? null };
        return { content: [{ type: 'text' as const, text: JSON.stringify(structuredContent) }], structuredContent };
      } catch (error) {
        const details = error instanceof ToolError ? { code: error.code, message: error.message, status: error.status, details: error.details } : { code: 'TOOL_FAILED', message: error instanceof Error ? error.message : 'The operation failed.' };
        const safe = sanitize(details, [runtime.config.token ?? '', runtime.config.clientSecret ?? '']);
        return { isError: true, content: [{ type: 'text' as const, text: JSON.stringify(safe) }], structuredContent: { error: safe } };
      }
    });
  }
  server.registerResource('capabilities', 'discord://capabilities', { description: 'Tool capabilities and Discord reference review date.', mimeType: 'application/json' }, async uri => ({ contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify({ reviewed_at: reviewedAt, tools: runtime.tools.map(tool => ({ name: tool.name, description: tool.description })), exclusions: ['audio transport', 'soundboard', 'voice messages', 'Social SDK lobbies', 'user-only group DMs'] }) }] }));
  return server;
}
