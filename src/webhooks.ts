import { createServer, type Server } from 'node:http';
import { createPublicKey, verify } from 'node:crypto';
import type { EventQueue } from './events.js';

export function verifySignature(key: string, timestamp: string, signature: string, body: Buffer, now = Date.now()): boolean {
  if (!/^\d+$/.test(timestamp) || Math.abs(now - Number(timestamp) * 1000) > 300000 || !/^[a-f\d]{128}$/i.test(signature)) return false;
  try {
    const publicKey = createPublicKey({ key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), Buffer.from(key, 'hex')]), format: 'der', type: 'spki' });
    return verify(null, Buffer.concat([Buffer.from(timestamp), body]), publicKey, Buffer.from(signature, 'hex'));
  } catch { return false; }
}

export class WebhookReceiver {
  private server?: Server;
  private seen = new Map<string, number>();

  constructor(private readonly events: EventQueue, private readonly publicKey: string) {}

  async listen(port: number): Promise<void> {
    const server = createServer(async (request, response) => {
      if (request.method !== 'POST' || request.url !== '/discord/events') { response.writeHead(404).end(); return; }
      try {
        const chunks: Buffer[] = [];
        let length = 0;
        for await (const chunk of request) {
          length += chunk.length;
          if (length > 1024 * 1024) { response.writeHead(413).end(); return; }
          chunks.push(Buffer.from(chunk));
        }
        const body = Buffer.concat(chunks);
        const timestamp = String(request.headers['x-signature-timestamp'] ?? '');
        const signature = String(request.headers['x-signature-ed25519'] ?? '');
        if (!verifySignature(this.publicKey, timestamp, signature, body)) { response.writeHead(401).end(); return; }
        const payload = JSON.parse(body.toString('utf8')) as { type: number; event?: { type: string; data: unknown; timestamp?: string }; id?: string };
        if (payload.type === 0) { response.writeHead(204, { 'Content-Type': 'application/json' }).end(); return; }
        if (payload.type !== 1 || !payload.event?.type || typeof payload.event.data !== 'object') { response.writeHead(400).end(); return; }
        for (const [key, expires] of this.seen) if (expires <= Date.now()) this.seen.delete(key);
        const dedupe = signature;
        if (!this.seen.has(dedupe)) {
          if (this.seen.size >= 10000) this.seen.delete(this.seen.keys().next().value!);
          this.seen.set(dedupe, Date.now() + 300000);
          if (!/^(?:LOBBY_|GAME_DIRECT_|QUEST_)/.test(payload.event.type)) this.events.push(payload.event.type, payload.event.data, 'webhook');
        }
        response.writeHead(204, { 'Content-Type': 'application/json' }).end();
      } catch { if (!response.headersSent) response.writeHead(400).end(); }
    });
    server.requestTimeout = 10000;
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, '127.0.0.1', () => { server.removeListener('error', reject); resolve(); });
    });
    this.server = server;
  }

  async close(): Promise<void> {
    if (this.server) await new Promise<void>(resolve => this.server!.close(() => resolve()));
    this.server = undefined;
  }
}
