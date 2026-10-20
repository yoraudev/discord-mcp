import { describe, it, expect, vi } from 'vitest';
import { EventQueue } from '../src/events.js';
import { Interactions } from '../src/interactions.js';
import { DiscordRest } from '../src/rest.js';
import { Vault, sanitize } from '../src/errors.js';
import { loadConfig } from '../src/config.js';
import { Gateway } from '../src/gateway.js';
import { Events } from 'discord.js';

describe('event delivery', () => {
  it('reports overwritten history, advances through filtered events and rejects stale cursors', async () => {
    const queue = new EventQueue(2);
    queue.push('MESSAGE_CREATE', { guild_id: '1' });
    queue.push('MESSAGE_CREATE', { guild_id: '2' });
    queue.push('MESSAGE_DELETE', { guild_id: '1' });
    const page = await queue.poll({ types: ['MESSAGE_DELETE'], guild_id: '1' });
    expect(page.gap).toBe(true);
    expect(page.events).toHaveLength(1);
    expect((await queue.poll({ cursor: page.cursor })).events).toHaveLength(0);
    await expect(new EventQueue().poll({ cursor: page.cursor })).rejects.toMatchObject({ code: 'CURSOR_INVALID' });
  });

  it('waits for a matching event and cancels long polling', async () => {
    const queue = new EventQueue();
    const pending = queue.poll({ types: ['MATCH'], timeout_ms: 1000 });
    queue.push('IGNORE', {});
    queue.push('MATCH', { content: 'hello' });
    expect((await pending).events[0]?.type).toBe('MATCH');
    const controller = new AbortController();
    const waiting = queue.poll({ cursor: `${queue.epoch}:2`, timeout_ms: 1000, signal: controller.signal });
    controller.abort();
    await expect(waiting).rejects.toMatchObject({ code: 'CANCELLED' });
  });
});

describe('interaction deadlines', () => {
  it('defers commands before exposing their handle and keeps tokens private', async () => {
    const request = vi.fn<typeof fetch>(async () => new Response(null, { status: 204 }));
    const queue = new EventQueue();
    const interactions = new Interactions(new DiscordRest(undefined, request), queue);
    await interactions.receive({ id: '22', application_id: '33', token: 'interaction-secret', type: 2, data: { name: 'hello' } });
    expect(request.mock.calls[0]![1]?.body).toBe('{"type":5,"data":{"flags":64}}');
    const result = await queue.poll();
    expect(JSON.stringify(result)).not.toContain('interaction-secret');
    const event = result.events[0]?.data as { interaction_handle: string };
    expect(interactions.resolve(event.interaction_handle)).toMatchObject({ acknowledged: true, id: '22' });
  });

  it('opens a preconfigured modal and answers autocomplete immediately', async () => {
    const request = vi.fn<typeof fetch>(async () => new Response(null, { status: 204 }));
    const interactions = new Interactions(new DiscordRest(undefined, request), new EventQueue());
    interactions.setRule({ id: 'modal', command_name: 'form', interaction_type: 2, response: { type: 9, data: { title: 'Form', custom_id: 'form', components: [] } } });
    await interactions.receive({ id: '22', application_id: '33', token: 'secret', type: 2, data: { name: 'form' } });
    expect(JSON.parse(request.mock.calls[0]![1]?.body as string).type).toBe(9);
    await interactions.receive({ id: '23', application_id: '33', token: 'secret', type: 4, data: { name: 'other' } });
    expect(JSON.parse(request.mock.calls[1]![1]?.body as string)).toEqual({ type: 8, data: { choices: [] } });
    expect(() => interactions.setRule({ id: 'invalid', interaction_type: 5, response: { type: 9 } })).toThrow('Modal rules');
  });

  it('supports explicit manual responses once and rejects expired initial deadlines', async () => {
    const request = vi.fn<typeof fetch>(async () => new Response(null, { status: 204 }));
    const queue = new EventQueue();
    const interactions = new Interactions(new DiscordRest(undefined, request), queue);
    interactions.setRule({ id: 'manual', command_name: 'manual', response: { type: 0 } });
    await interactions.receive({ id: '22', application_id: '33', token: 'secret', type: 2, data: { name: 'manual' } });
    const event = (await queue.poll()).events[0]?.data as { interaction_handle: string };
    expect(request).not.toHaveBeenCalled();
    await interactions.respond(event.interaction_handle, { type: 4, data: { content: 'hello' } });
    await expect(interactions.respond(event.interaction_handle, { type: 4 })).rejects.toMatchObject({ code: 'ALREADY_ACKNOWLEDGED' });
    await interactions.receive({ id: '23', application_id: '33', token: 'secret', type: 2, data: { name: 'manual' } });
    const latest = (await queue.poll()).events[1]?.data as { interaction_handle: string };
    interactions.resolve(latest.interaction_handle).acknowledgement_deadline = Date.now() - 1;
    await expect(interactions.respond(latest.interaction_handle, { type: 4 })).rejects.toMatchObject({ code: 'INTERACTION_DEADLINE' });
  });

  it('answers autocomplete and final search submission as separate interactions', async () => {
    const request = vi.fn<typeof fetch>(async () => new Response(null, { status: 204 }));
    const queue = new EventQueue();
    const interactions = new Interactions(new DiscordRest(undefined, request), queue);
    interactions.setRule({ id: 'suggest', command_name: 'search', interaction_type: 4, response: { type: 8, data: { choices: [{ name: 'Result', value: 'result' }] } } });
    interactions.setRule({ id: 'submit', command_name: 'search', interaction_type: 2, response: { type: 4, data: { content: 'Search completed.', flags: 64 } } });
    await interactions.receive({ id: '22', application_id: '33', token: 'secret', type: 4, data: { name: 'search' } });
    await interactions.receive({ id: '23', application_id: '33', token: 'secret', type: 2, data: { name: 'search' } });
    expect(request.mock.calls.map(([, init]) => JSON.parse(init?.body as string).type)).toEqual([8, 4]);
    expect((await queue.poll()).events.map(event => (event.data as { acknowledgement: number }).acknowledgement)).toEqual([8, 4]);
  });
});

describe('Gateway lifecycle and credential handling', () => {
  it('surfaces disconnect/resume and explains missing member intents without a connection', async () => {
    const queue = new EventQueue();
    const gateway = new Gateway(loadConfig({ DISCORD_MCP_OFFLINE: '1' }), queue, new Interactions(new DiscordRest(), queue));
    gateway.client.emit(Events.ShardDisconnect, { code: 1006 }, 0);
    gateway.client.emit(Events.ShardReconnecting, 0);
    gateway.client.emit(Events.ShardResume, 0, 2);
    expect((await queue.poll()).events.map(event => event.type)).toEqual(['GATEWAY_DISCONNECTED', 'GATEWAY_RECONNECTING', 'GATEWAY_RESUMED']);
    await expect(gateway.requestMembers('22', {})).rejects.toMatchObject({ code: 'INTENT_REQUIRED' });
    await gateway.close();
  });

  it('replaces webhook credentials with handles and removes nested secrets', () => {
    const vault = new Vault();
    const result = vault.capture({ id: '22', type: 1, token: 'webhook-secret', nested: { access_token: 'oauth-secret', content: 'hello' } }) as { webhook_handle: string };
    expect(JSON.stringify(result)).not.toContain('secret');
    expect(vault.get(result.webhook_handle).token).toBe('webhook-secret');
    expect(sanitize('Bearer abc.def', [])).toBe('[redacted]');
  });
});
