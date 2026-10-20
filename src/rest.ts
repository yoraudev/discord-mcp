import { readFile } from 'node:fs/promises';
import { setTimeout as sleep } from 'node:timers/promises';
import { ToolError, sanitize } from './errors.js';
import { version } from './version.js';

export interface Upload {
  filename: string;
  path?: string;
  data_base64?: string;
  content_type?: string;
  field?: string;
}

export interface RestRequest {
  method: string;
  path: string;
  auth?: string;
  query?: Record<string, unknown>;
  body?: unknown;
  files?: Upload[];
  audit_reason?: string;
  sticker?: boolean;
  fileField?: string;
  signal?: AbortSignal;
}

export class DiscordRest {
  private tail: Promise<unknown> = Promise.resolve();
  private availableAt = 0;

  constructor(private readonly token?: string, private readonly request: typeof fetch = fetch, private readonly base = 'https://discord.com/api/v10') {}

  execute(input: RestRequest): Promise<unknown> {
    const result = this.tail.then(() => this.perform(input));
    this.tail = result.catch(() => undefined);
    return result;
  }

  private async perform(input: RestRequest): Promise<unknown> {
    if (input.signal?.aborted) throw new ToolError('CANCELLED', 'The request was cancelled before it was sent.');
    if (!input.path.startsWith('/') || input.path.startsWith('//') || input.path.includes('?')) throw new ToolError('INVALID_ROUTE', 'Invalid Discord API route.');
    const url = new URL(this.base + input.path);
    for (const [key, value] of Object.entries(input.query ?? {})) {
      if (value === undefined) continue;
      if (Array.isArray(value)) value.forEach(item => url.searchParams.append(key, String(item)));
      else url.searchParams.set(key, String(value));
    }
    const authorization = input.auth ?? (this.token ? `Bot ${this.token}` : undefined);
    if (!authorization && !/\/(?:webhooks|interactions)\//.test(input.path)) throw new ToolError('AUTH_REQUIRED', 'A Discord bot token is required.');
    const headers: Record<string, string> = { 'User-Agent': `DiscordBot (https://github.com/yoraudev/discord-mcp, ${version})` };
    if (authorization) headers.Authorization = authorization;
    if (input.audit_reason) headers['X-Audit-Log-Reason'] = encodeURIComponent(input.audit_reason);
    let body: BodyInit | undefined;
    if (input.files?.length) {
      const form = new FormData();
      if (input.sticker || input.fileField) {
        for (const [key, value] of Object.entries((input.body ?? {}) as Record<string, unknown>)) if (value !== undefined && value !== null) form.set(key, String(value));
      } else form.set('payload_json', JSON.stringify(input.body ?? {}));
      let size = Buffer.byteLength(JSON.stringify(input.body ?? {}));
      for (const [index, file] of input.files.entries()) {
        if (!!file.path === !!file.data_base64) throw new ToolError('INVALID_FILE', 'Provide exactly one of path or data_base64 for each file.');
        const bytes = file.path ? await readFile(file.path) : Buffer.from(file.data_base64!, 'base64');
        size += bytes.length;
        if (size > 25 * 1024 * 1024) throw new ToolError('UPLOAD_TOO_LARGE', 'The request exceeds the 25 MiB upload limit.');
        form.append(file.field ?? input.fileField ?? (input.sticker ? 'file' : `files[${index}]`), new Blob([new Uint8Array(bytes)], { type: file.content_type ?? 'application/octet-stream' }), file.filename);
      }
      body = form;
    } else if (input.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(input.body);
    }
    for (let attempt = 0; attempt < 4; attempt++) {
      const wait = this.availableAt - Date.now();
      if (wait > 0) await sleep(wait, undefined, { signal: input.signal });
      const signal = input.signal ? AbortSignal.any([input.signal, AbortSignal.timeout(30000)]) : AbortSignal.timeout(30000);
      let response: Response;
      try {
        response = await this.request(url, { method: input.method, headers, body, signal, redirect: 'error' });
      } catch {
        throw new ToolError('NETWORK_ERROR', input.method === 'GET' ? 'Discord could not be reached.' : 'Discord response was lost. The write may have succeeded; it was not retried.');
      }
      const bytes = Buffer.from(await response.arrayBuffer());
      const raw = bytes.toString('utf8');
      let data: unknown;
      try { data = raw ? JSON.parse(raw) : null; } catch {
        const content_type = response.headers.get('Content-Type') ?? 'application/octet-stream';
        data = /^(?:text\/|application\/csv)/i.test(content_type) ? { content_type, text: raw } : { content_type, data_base64: bytes.toString('base64') };
      }
      if (response.headers.get('X-RateLimit-Remaining') === '0') {
        const seconds = Number(response.headers.get('X-RateLimit-Reset-After'));
        if (Number.isFinite(seconds)) this.availableAt = Date.now() + Math.max(0, seconds * 1000);
      }
      if (response.status === 429) {
        const seconds = Number((data as Record<string, unknown>)?.retry_after ?? response.headers.get('Retry-After') ?? 1);
        if (!Number.isFinite(seconds) || seconds < 0 || seconds > 120) throw new ToolError('RATE_LIMITED', 'Discord requested a long rate-limit delay. Retry later.', 429);
        this.availableAt = Date.now() + Math.max(100, seconds * 1000);
        if (attempt < 3) continue;
      }
      if (!response.ok) throw new ToolError('DISCORD_API_ERROR', `Discord returned HTTP ${response.status}.`, response.status, sanitize(data, [this.token ?? '', input.auth ?? '']));
      return data;
    }
    throw new ToolError('RATE_LIMITED', 'Discord rate limit retries exhausted.', 429);
  }
}
