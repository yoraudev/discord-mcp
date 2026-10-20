import { it, expect, vi } from 'vitest';
import { createServer } from 'node:http';
import { generateKeyPairSync, sign } from 'node:crypto';
import { OAuth } from '../src/oauth.js';
import { EventQueue } from '../src/events.js';
import { loadConfig } from '../src/config.js';
import { verifySignature, WebhookReceiver } from '../src/webhooks.js';

async function unusedPort(): Promise<number> {
  const server = createServer();
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as { port: number }).port;
  await new Promise<void>(resolve => server.close(() => resolve()));
  return port;
}

it('validates single-use OAuth state, refreshes privately and revokes authorization', async () => {
  const port = await unusedPort();
  const request = vi.fn<typeof fetch>()
    .mockResolvedValueOnce(Response.json({ access_token: 'short-secret', refresh_token: 'refresh-secret', expires_in: 0, scope: 'identify' }))
    .mockResolvedValueOnce(Response.json({ access_token: 'new-secret', refresh_token: 'next-secret', expires_in: 3600, scope: 'identify' }))
    .mockResolvedValueOnce(new Response(null, { status: 200 }));
  const config = loadConfig({ DISCORD_APPLICATION_ID: '22', DISCORD_CLIENT_SECRET: 'client-secret', DISCORD_OAUTH_REDIRECT_URI: `http://127.0.0.1:${port}/oauth/callback`, DISCORD_MCP_OFFLINE: '1' });
  const oauth = new OAuth(config, new EventQueue(), request);
  try {
    const start = await oauth.begin(['identify']);
    const state = new URL(start.authorization_url).searchParams.get('state');
    expect((await fetch(`${config.redirectUri}?state=wrong&code=code`)).status).toBe(400);
    expect(request).not.toHaveBeenCalled();
    expect((await fetch(`${config.redirectUri}?state=${state}&code=code`)).status).toBe(200);
    expect((await fetch(`${config.redirectUri}?state=${state}&code=code`)).status).toBe(400);
    expect(await oauth.accessToken('identify')).toBe('new-secret');
    expect(request.mock.calls[1]![1]?.body?.toString()).toContain('grant_type=refresh_token');
    expect(JSON.stringify(oauth.status())).not.toContain('secret');
    await expect(oauth.accessToken('guilds.join')).rejects.toMatchObject({ code: 'OAUTH_SCOPE_REQUIRED' });
    expect(await oauth.disconnect()).toEqual({ disconnected: true });
    expect(oauth.status().connected).toBe(false);
  } finally { await oauth.close(); }
});

it('verifies signed raw webhook bodies and rejects old or tampered signatures', async () => {
  const pair = generateKeyPairSync('ed25519');
  const key = pair.publicKey.export({ type: 'spki', format: 'der' }).subarray(-32).toString('hex');
  const timestamp = String(Math.floor(Date.now() / 1000));
  const body = Buffer.from(JSON.stringify({ type: 1, event: { type: 'APPLICATION_AUTHORIZED', data: { guild_id: '22', token: 'hidden' } } }));
  const signature = sign(null, Buffer.concat([Buffer.from(timestamp), body]), pair.privateKey).toString('hex');
  expect(verifySignature(key, timestamp, signature, body)).toBe(true);
  expect(verifySignature(key, timestamp, signature, Buffer.from('modified'))).toBe(false);
  expect(verifySignature(key, timestamp, signature, body, Date.now() + 400000)).toBe(false);
  const queue = new EventQueue();
  const receiver = new WebhookReceiver(queue, key);
  const port = await unusedPort();
  await receiver.listen(port);
  try {
    const send = (sig: string) => fetch(`http://127.0.0.1:${port}/discord/events`, { method: 'POST', headers: { 'X-Signature-Timestamp': timestamp, 'X-Signature-Ed25519': sig }, body });
    expect((await send('0'.repeat(128))).status).toBe(401);
    expect((await send(signature)).status).toBe(204);
    expect((await send(signature)).status).toBe(204);
    const page = await queue.poll();
    expect(page.events).toHaveLength(1);
    expect(JSON.stringify(page)).not.toContain('hidden');
  } finally { await receiver.close(); }
});
