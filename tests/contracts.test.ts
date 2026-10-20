import { describe, it, expect, vi } from 'vitest';
import { createRuntime } from '../src/runtime.js';
import { loadConfig } from '../src/config.js';
import { reference } from '../src/reference.js';
import { inputSchema } from '../src/schemas.js';
import { DiscordRest } from '../src/rest.js';
import { executeOperation } from '../src/tools.js';

describe('tool operation contracts', () => {
  it('sends a named message tool to the official route without accepting arbitrary paths', async () => {
    const runtime = createRuntime(loadConfig({ DISCORD_MCP_OFFLINE: '1', DISCORD_BOT_TOKEN: 'secret', DISCORD_APPLICATION_ID: '33' }));
    try {
      const request = vi.fn<typeof fetch>(async () => Response.json({ id: '44', content: 'hello' }));
      const operation = reference.find(entry => entry.title === 'Create Message')!;
      const input = inputSchema(operation).parse({ channel_id: '22', body: { content: 'hello' } });
      const result = await executeOperation(operation, input, { ...runtime, rest: new DiscordRest('secret', request) });
      expect(result).toEqual({ id: '44', content: 'hello' });
      expect(String(request.mock.calls[0]![0])).toBe('https://discord.com/api/v10/channels/22/messages');
      expect(inputSchema(operation).safeParse({ channel_id: 22, body: { content: 'hello' } }).success).toBe(false);
      expect(inputSchema(operation).safeParse({ channel_id: '22', path: '/other', body: { content: 'hello' } }).success).toBe(false);
      await expect(executeOperation(operation, { channel_id: '22', body: { flags: 8192 } }, runtime)).rejects.toThrow('not supported');
    } finally { await runtime.close(); }
  });

  it('includes nullable edits, command array bodies and application defaults', async () => {
    const member = reference.find(entry => entry.title === 'Modify Guild Member')!;
    expect(inputSchema(member).safeParse({ guild_id: '22', user_id: '33', body: { nick: null, channel_id: null } }).success).toBe(true);
    const commands = reference.find(entry => entry.title === 'Bulk Overwrite Global Application Commands')!;
    expect(inputSchema(commands).safeParse({ body: [{ name: 'hello', description: 'Hello' }] }).success).toBe(true);
    expect(inputSchema(commands).safeParse({ body: { name: 'hello' } }).success).toBe(false);
    const reaction = reference.find(entry => entry.title === 'Create Reaction')!;
    expect(inputSchema(reaction).safeParse({ channel_id: '22', message_id: '33', emoji_id: '👍' }).success).toBe(true);
  });

  it('requires OAuth2 where Discord requires user authorization', async () => {
    const runtime = createRuntime(loadConfig({ DISCORD_MCP_OFFLINE: '1' }));
    try {
      const operation = reference.find(entry => entry.title === 'Edit Application Command Permissions')!;
      await expect(executeOperation(operation, { application_id: '11', guild_id: '22', command_id: '33', body: { permissions: [] } }, runtime)).rejects.toMatchObject({ code: 'OAUTH_REQUIRED' });
      expect(runtime.tools.find(tool => tool.name === 'discord_messages_create')).toBeDefined();
      expect(new Set(runtime.tools.map(tool => tool.name)).size).toBe(runtime.tools.length);
    } finally { await runtime.close(); }
  });
});
