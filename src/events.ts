import { ToolError, sanitize } from './errors.js';

export interface EventRecord {
  cursor: string;
  type: string;
  source: 'gateway' | 'webhook' | 'system';
  received_at: string;
  data: unknown;
}

export interface PollOptions {
  cursor?: string;
  types?: string[];
  guild_id?: string;
  channel_id?: string;
  limit?: number;
  timeout_ms?: number;
  signal?: AbortSignal;
}

export class EventQueue {
  private records: EventRecord[] = [];
  private sequence = 0;
  private listeners = new Set<() => void>();
  readonly epoch = crypto.randomUUID();

  constructor(readonly capacity = 10000) {}

  push(type: string, data: unknown, source: EventRecord['source'] = 'gateway'): EventRecord {
    const record = { cursor: `${this.epoch}:${++this.sequence}`, type, data: sanitize(data), source, received_at: new Date().toISOString() };
    this.records.push(record);
    if (this.records.length > this.capacity) this.records.shift();
    for (const listener of [...this.listeners]) listener();
    return record;
  }

  private read(options: PollOptions): { events: EventRecord[]; cursor: string; gap: boolean } {
    const [epoch, sequence] = options.cursor?.split(':') ?? [this.epoch, '0'];
    const after = Number(sequence);
    if (epoch !== this.epoch || !Number.isSafeInteger(after) || after < 0 || after > this.sequence) throw new ToolError('CURSOR_INVALID', 'Cursor belongs to another process or is invalid. Poll without a cursor to restart.');
    const oldest = this.sequence - this.records.length + 1;
    const gap = after < oldest - 1;
    const events: EventRecord[] = [];
    let scanned = after;
    for (const record of this.records) {
      const n = Number(record.cursor.split(':')[1]);
      if (n <= after) continue;
      scanned = n;
      const data = record.data as Record<string, unknown> | null;
      if (options.types?.length && !options.types.includes(record.type)) continue;
      if (options.guild_id && data?.guild_id !== options.guild_id) continue;
      if (options.channel_id && data?.channel_id !== options.channel_id) continue;
      events.push(record);
      if (events.length >= (options.limit ?? 100)) break;
    }
    return { events, cursor: `${this.epoch}:${scanned}`, gap };
  }

  async poll(options: PollOptions = {}): Promise<ReturnType<EventQueue['read']>> {
    let result = this.read(options);
    if (result.events.length || result.gap || !options.timeout_ms) return result;
    await new Promise<void>((resolve, reject) => {
      const finish = (error?: ToolError): void => { clearTimeout(timer); this.listeners.delete(check); options.signal?.removeEventListener('abort', abort); if (error) reject(error); else resolve(); };
      const check = (): void => { result = this.read(options); if (result.events.length || result.gap) finish(); };
      const abort = (): void => { finish(new ToolError('CANCELLED', 'Event polling was cancelled.')); };
      const timer = setTimeout(finish, options.timeout_ms);
      this.listeners.add(check);
      options.signal?.addEventListener('abort', abort, { once: true });
      if (options.signal?.aborted) abort();
      else check();
    });
    return result;
  }
}
