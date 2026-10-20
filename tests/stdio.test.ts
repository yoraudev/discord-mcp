import { it, expect } from 'vitest';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { resolve } from 'node:path';

it('negotiates MCP over a real child process and calls validated tools', async () => {
  const transport = new StdioClientTransport({ command: process.execPath, args: [resolve('dist/index.js')], env: { DISCORD_MCP_OFFLINE: '1' }, stderr: 'pipe' });
  const client = new Client({ name: 'discord-mcp-contract-test', version: '1.0.0' });
  let stderr = '';
  transport.stderr?.on('data', data => { stderr += String(data); });
  try {
    await client.connect(transport);
    const listing = await client.listTools();
    expect(listing.tools.some(tool => tool.name === 'discord_messages_create')).toBe(true);
    expect(listing.tools.length).toBeGreaterThan(200);
    const result = await client.callTool({ name: 'discord_status', arguments: {} });
    expect(result.isError).not.toBe(true);
    expect(JSON.stringify(result)).toContain('offline');
    const error = await client.callTool({ name: 'discord_messages_create', arguments: { channel_id: '22', body: { content: 'hello' } } });
    expect(error.isError).toBe(true);
    expect(JSON.stringify(error)).toContain('AUTH_REQUIRED');
    const resources = await client.listResources();
    expect(resources.resources.some(resource => resource.uri === 'discord://capabilities')).toBe(true);
    expect(stderr).toBe('');
  } finally { await client.close(); }
}, 20000);
