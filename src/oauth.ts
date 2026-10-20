import { createServer, type Server } from 'node:http';
import { randomBytes } from 'node:crypto';
import type { Config } from './config.js';
import { ToolError } from './errors.js';
import type { EventQueue } from './events.js';

interface Token {
  access_token: string;
  refresh_token?: string;
  expires_at: number;
  scopes: string[];
}

export class OAuth {
  private server?: Server;
  private pending?: { state: string; expires: number; scopes: string[] };
  private token?: Token;
  private refreshing?: Promise<void>;

  constructor(private readonly config: Config, private readonly events: EventQueue, private readonly request: typeof fetch = fetch) {}

  status(): { connected: boolean; scopes: string[]; expires_at?: string; pending: boolean } {
    return { connected: !!this.token, scopes: this.token?.scopes ?? [], expires_at: this.token ? new Date(this.token.expires_at).toISOString() : undefined, pending: !!this.pending && this.pending.expires > Date.now() };
  }

  async begin(scopes: string[]): Promise<{ authorization_url: string; expires_in: number }> {
    if (!this.config.applicationId || !this.config.clientSecret) throw new ToolError('OAUTH_NOT_CONFIGURED', 'Set DISCORD_APPLICATION_ID and DISCORD_CLIENT_SECRET to use OAuth2.');
    const allowed = ['identify', 'guilds.join', 'guilds.members.read', 'role_connections.write', 'application_identities.write', 'applications.commands.permissions.update'];
    if (!scopes.length || scopes.some(scope => !allowed.includes(scope))) throw new ToolError('INVALID_SCOPE', `Supported user scopes: ${allowed.join(', ')}.`);
    await this.listen();
    const state = randomBytes(32).toString('hex');
    this.pending = { state, expires: Date.now() + 600000, scopes };
    const url = new URL('https://discord.com/oauth2/authorize');
    for (const [key, value] of Object.entries({ client_id: this.config.applicationId, response_type: 'code', redirect_uri: this.config.redirectUri, scope: scopes.join(' '), state, prompt: 'consent' })) url.searchParams.set(key, value);
    return { authorization_url: url.href, expires_in: 600 };
  }

  private async listen(): Promise<void> {
    if (this.server) return;
    const redirect = new URL(this.config.redirectUri);
    const server = createServer((request, response) => {
      const url = new URL(request.url ?? '/', redirect.origin);
      if (request.method !== 'GET' || url.pathname !== redirect.pathname) { response.writeHead(404).end(); return; }
      const pending = this.pending;
      if (!pending || pending.expires < Date.now() || url.searchParams.get('state') !== pending.state) { response.writeHead(400, { 'Content-Type': 'text/plain' }).end('Invalid or expired authorization state.'); return; }
      this.pending = undefined;
      const code = url.searchParams.get('code');
      if (!code || url.searchParams.has('error')) { response.writeHead(400, { 'Content-Type': 'text/plain' }).end('Authorization was denied.'); return; }
      void this.exchange({ grant_type: 'authorization_code', code, redirect_uri: this.config.redirectUri }, pending.scopes).then(() => {
        this.events.push('OAUTH_CONNECTED', this.status(), 'system');
        response.writeHead(200, { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' }).end('Discord authorization complete. You can close this window.');
      }).catch(() => {
        this.events.push('OAUTH_FAILED', { message: 'Token exchange failed.' }, 'system');
        response.writeHead(502).end('Discord authorization failed. Start authorization again.');
      });
    });
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(Number(redirect.port), redirect.hostname === '[::1]' ? '::1' : redirect.hostname, () => { server.removeListener('error', reject); resolve(); });
    });
    this.server = server;
  }

  private async exchange(params: Record<string, string>, scopes: string[]): Promise<void> {
    const response = await this.request('https://discord.com/api/oauth2/token', {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(15000),
      body: new URLSearchParams({ client_id: this.config.applicationId!, client_secret: this.config.clientSecret!, ...params })
    });
    if (!response.ok) throw new ToolError('OAUTH_EXCHANGE_FAILED', 'Discord rejected the OAuth2 token exchange.', response.status);
    const data = await response.json() as { access_token: string; refresh_token?: string; expires_in: number; scope?: string };
    if (typeof data.access_token !== 'string' || !Number.isFinite(data.expires_in)) throw new ToolError('OAUTH_INVALID_RESPONSE', 'Invalid OAuth2 token response.');
    this.token = { access_token: data.access_token, refresh_token: data.refresh_token, expires_at: Date.now() + data.expires_in * 1000, scopes: data.scope?.split(' ') ?? scopes };
  }

  async accessToken(requiredScope?: string): Promise<string> {
    if (!this.token) throw new ToolError('OAUTH_REQUIRED', 'Authorize the required Discord OAuth2 scopes first.');
    if (requiredScope && !this.token.scopes.includes(requiredScope)) throw new ToolError('OAUTH_SCOPE_REQUIRED', `Authorize the ${requiredScope} scope first.`);
    if (this.token.expires_at < Date.now() + 30000) {
      if (!this.token.refresh_token) throw new ToolError('OAUTH_EXPIRED', 'The OAuth2 session expired. Authorize again.');
      this.refreshing ??= this.exchange({ grant_type: 'refresh_token', refresh_token: this.token.refresh_token }, this.token.scopes).finally(() => { this.refreshing = undefined; });
      await this.refreshing;
    }
    return this.token.access_token;
  }

  async disconnect(): Promise<{ disconnected: true }> {
    const token = this.token;
    if (token) {
      const response = await this.request('https://discord.com/api/oauth2/token/revoke', { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(15000), body: new URLSearchParams({ client_id: this.config.applicationId!, client_secret: this.config.clientSecret!, token: token.access_token }) });
      if (!response.ok) throw new ToolError('OAUTH_REVOCATION_FAILED', 'Discord rejected token revocation. The local session is retained so you can retry.', response.status);
    }
    this.token = undefined;
    this.pending = undefined;
    return { disconnected: true };
  }

  async close(): Promise<void> {
    this.token = undefined;
    this.pending = undefined;
    const server = this.server;
    this.server = undefined;
    if (server) await new Promise<void>(resolve => server.close(() => resolve()));
  }
}
