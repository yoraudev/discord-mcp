import { describe, it, expect, vi } from 'vitest';
import { DiscordRest } from '../src/rest.js';

describe('Discord HTTP contract', () => {
  it('preserves query strings, nullable fields and encoded audit reasons', async () => {
    const request = vi.fn<typeof fetch>(async () => Response.json({ id: '44' }));
    const rest = new DiscordRest('bot-secret', request);
    await rest.execute({ method: 'PATCH', path: '/guilds/22/members/33', query: { with_counts: true }, body: { nick: null }, audit_reason: 'Test reason / unicode ä' });
    const [url, init] = request.mock.calls[0]!;
    expect(String(url)).toBe('https://discord.com/api/v10/guilds/22/members/33?with_counts=true');
    expect(init?.headers).toMatchObject({ Authorization: 'Bot bot-secret', 'X-Audit-Log-Reason': 'Test%20reason%20%2F%20unicode%20%C3%A4' });
    expect(init?.body).toBe('{"nick":null}');
  });

  it('sends root arrays without adding an object wrapper', async () => {
    const request = vi.fn<typeof fetch>(async () => Response.json([]));
    await new DiscordRest('secret', request).execute({ method: 'PATCH', path: '/guilds/22/roles', body: [{ id: '33', position: 2 }] });
    expect(request.mock.calls[0]![1]?.body).toBe('[{"id":"33","position":2}]');
  });

  it('uploads message files with payload_json and sticker files with form fields', async () => {
    const request = vi.fn<typeof fetch>(async () => Response.json({ id: '44' }));
    const rest = new DiscordRest('secret', request);
    const file = { filename: 'small.txt', data_base64: Buffer.from('hello').toString('base64') };
    await rest.execute({ method: 'POST', path: '/channels/22/messages', body: { content: 'hello' }, files: [file] });
    const form = request.mock.calls[0]![1]?.body as FormData;
    expect(JSON.parse(form.get('payload_json') as string)).toEqual({ content: 'hello' });
    expect(await (form.get('files[0]') as File).text()).toBe('hello');
    expect(request.mock.calls[0]![1]?.headers).not.toHaveProperty('Content-Type');
    await rest.execute({ method: 'POST', path: '/guilds/22/stickers', body: { name: 'sticker', tags: 'wave' }, files: [file], sticker: true });
    const sticker = request.mock.calls[1]![1]?.body as FormData;
    expect(sticker.get('name')).toBe('sticker');
    expect(sticker.get('payload_json')).toBeNull();
    expect(sticker.get('file')).toBeInstanceOf(File);
  });

  it('handles CSV invite target uploads and CSV/binary responses', async () => {
    const request = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response('user_id\n123\n', { headers: { 'Content-Type': 'text/csv' } }))
      .mockResolvedValueOnce(new Response(new Uint8Array([137, 80, 78, 71]), { headers: { 'Content-Type': 'image/png' } }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    const rest = new DiscordRest('secret', request);
    expect(await rest.execute({ method: 'GET', path: '/invites/test/target-users' })).toEqual({ content_type: 'text/csv', text: 'user_id\n123\n' });
    expect(await rest.execute({ method: 'GET', path: '/guilds/22/widget.png' })).toEqual({ content_type: 'image/png', data_base64: 'iVBORw==' });
    await rest.execute({ method: 'PUT', path: '/invites/test/target-users', fileField: 'target_users_file', files: [{ filename: 'users.csv', data_base64: 'dXNlcl9pZAoxMjMK' }] });
    expect((request.mock.calls[2]![1]?.body as FormData).get('target_users_file')).toBeInstanceOf(File);
  });

  it('respects an explicit 429 delay, but never retries an uncertain write', async () => {
    const request = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ retry_after: 0.001, global: true }, { status: 429 }))
      .mockResolvedValueOnce(Response.json({ id: '44' }));
    const rest = new DiscordRest('secret', request);
    expect(await rest.execute({ method: 'POST', path: '/channels/22/messages', body: { content: 'hello' } })).toEqual({ id: '44' });
    expect(request).toHaveBeenCalledTimes(2);
    const lost = vi.fn<typeof fetch>().mockRejectedValue(new Error('socket closed'));
    await expect(new DiscordRest('secret', lost).execute({ method: 'POST', path: '/channels/22/messages', body: { content: 'once' } })).rejects.toMatchObject({ code: 'NETWORK_ERROR', message: expect.stringContaining('may have succeeded') });
    expect(lost).toHaveBeenCalledTimes(1);
  });

  it('returns sanitized permission errors and lets later requests continue', async () => {
    const request = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ code: 50013, message: 'Missing Permissions', token: 'secret' }, { status: 403 }))
      .mockResolvedValueOnce(Response.json({ id: '22' }));
    const rest = new DiscordRest('secret', request);
    await expect(rest.execute({ method: 'GET', path: '/guilds/22' })).rejects.toMatchObject({ status: 403, details: { code: 50013, message: 'Missing Permissions' } });
    expect(await rest.execute({ method: 'GET', path: '/guilds/22' })).toEqual({ id: '22' });
  });
});
