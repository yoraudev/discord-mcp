export class ToolError extends Error {
  constructor(public readonly code: string, message: string, public readonly status?: number, public readonly details?: unknown) {
    super(message);
  }
}

export function sanitize(value: unknown, secrets: Iterable<string> = []): unknown {
  const secretList = [...secrets].filter(Boolean);
  if (typeof value === 'string') {
    let result = value.replace(/(?:Bot|Bearer)\s+[\w.\-]+/gi, '[redacted]').replace(/(\/webhooks\/\d+\/)[^/?\s]+/g, '$1[redacted]').replace(/(\/interactions\/\d+\/)[^/?\s]+/g, '$1[redacted]');
    for (const secret of secretList) result = result.replaceAll(secret, '[redacted]');
    return result;
  }
  if (Array.isArray(value)) return value.map(item => sanitize(item, secretList));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).filter(([key]) => !/^(?:token|access_token|refresh_token|client_secret|authorization|session_id)$/i.test(key)).map(([key, item]) => [key, sanitize(item, secretList)]));
  return value;
}

export class Vault {
  private values = new Map<string, { token: string; id: string; expires: number }>();

  put(id: string, token: string, lifetimeMs = 15 * 60 * 1000): string {
    this.prune();
    if (this.values.size >= 10000) throw new ToolError('HANDLE_CAPACITY', 'Too many active credential handles.');
    const handle = crypto.randomUUID();
    this.values.set(handle, { token, id, expires: Date.now() + lifetimeMs });
    return handle;
  }

  get(handle: string): { token: string; id: string } {
    this.prune();
    const value = this.values.get(handle);
    if (!value) throw new ToolError('HANDLE_EXPIRED', 'Unknown or expired credential handle.');
    return value;
  }

  private prune(): void {
    for (const [key, value] of this.values) if (value.expires <= Date.now()) this.values.delete(key);
  }

  capture(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(item => this.capture(item));
    if (!value || typeof value !== 'object') return value;
    const result = { ...value } as Record<string, unknown>;
    if (typeof result.token === 'string' && typeof result.id === 'string' && 'type' in result) {
      result.webhook_handle = this.put(result.id, result.token, 24 * 60 * 60 * 1000);
    }
    return sanitize(result);
  }
}
