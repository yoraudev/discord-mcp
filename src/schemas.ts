import { z } from 'zod';
import type { Field, ReferenceEntry } from './reference.js';

export const jsonObject = z.record(z.string(), z.json());
export const snowflake = z.string().regex(/^\d{1,20}$/, 'Discord IDs are decimal strings.');
export const uploads = z.array(z.object({ filename: z.string().min(1).max(255), path: z.string().min(1).optional(), data_base64: z.string().optional(), content_type: z.string().optional(), field: z.string().optional() }).strict()).max(10);

function fieldSchema(field: Field): z.ZodType {
  const type = field.type.toLowerCase().replace(/^\?/, '');
  let schema: z.ZodType;
  if (/array|list of/.test(type)) {
    schema = z.array(/snowflake/.test(type) ? snowflake : /string/.test(type) && !/object/.test(type) ? z.string() : /integer/.test(type) ? z.number().int() : jsonObject);
  } else if (/integer or string|string or integer/.test(type)) schema = z.union([z.string(), z.number().int()]);
  else if (type.includes('snowflake')) schema = snowflake;
  else if (/^boolean/.test(type)) schema = z.boolean();
  else if (/^(?:integer|int)/.test(type)) schema = z.number().int();
  else if (/^(?:number|double|float)/.test(type)) schema = z.number();
  else if (/object|dictionary|metadata/.test(type)) schema = jsonObject;
  else if (/string|timestamp|image data|iso8601|iso 8601|comma-delimited/.test(type)) schema = z.string();
  else schema = z.json();
  if (field.type.startsWith('?') || /nullable|may be null|can be null|set to null/i.test(field.description)) schema = schema.nullable();
  schema = schema.describe(`${field.type}: ${field.description}`);
  return field.required ? schema : schema.optional();
}

function objectFields(fields: Field[]): z.ZodObject {
  return z.object(Object.fromEntries(fields.filter(field => field.type !== 'file' && !['access_token', 'file'].includes(field.name)).map(field => [field.name, fieldSchema(field)]))).strict();
}

export function bodySchema(entry: ReferenceEntry): z.ZodType | undefined {
  const fields = entry.fields?.body ?? [];
  if (entry.title === 'Create Interaction Response') return z.object({ type: z.number().int(), data: jsonObject.optional() }).strict();
  if (entry.title === 'Update Application Role Connection Metadata Records') return z.array(z.object({ type: z.number().int().min(1).max(8), key: z.string().regex(/^[a-z0-9_]{1,50}$/), name: z.string().min(1).max(100), description: z.string().min(1).max(200), name_localizations: z.record(z.string(), z.string()).optional(), description_localizations: z.record(z.string(), z.string()).optional() }).strict());
  if (entry.arrayBody) return z.array(fields.length ? objectFields(fields) : jsonObject);
  if (entry.title === 'Modify Webhook with Token') return z.object({ name: z.string().nullable().optional(), avatar: z.string().nullable().optional() }).strict();
  if (entry.title === 'Modify Guild Widget') return z.object({ enabled: z.boolean().optional(), channel_id: snowflake.nullable().optional() }).strict();
  if (/Execute (?:Slack|GitHub)-Compatible Webhook/.test(entry.title)) return jsonObject;
  if (!fields.length) return undefined;
  return objectFields(fields);
}

export function inputSchema(entry: ReferenceEntry): z.ZodObject {
  const shape: Record<string, z.ZodType> = {};
  const pathNames = [...(entry.path ?? '').matchAll(/\{([^}]+)\}/g)].map(match => match[1]!);
  const hasInteraction = pathNames.includes('interaction_token');
  const hasWebhook = pathNames.includes('webhook_token');
  for (const name of pathNames) {
    if (/token$/.test(name) || hasInteraction && ['interaction_id', 'application_id'].includes(name) || hasWebhook && name === 'webhook_id') continue;
    const schema = name.endsWith('_id') && !['provider_issued_user_id', 'provider_type', 'instance_id'].includes(name) && !(name === 'emoji_id' && entry.path?.includes('/reactions/')) ? snowflake : z.string().min(1);
    shape[name] = name === 'application_id' ? schema.optional().describe('Defaults to the configured application ID.') : schema;
  }
  if (hasInteraction) shape.interaction_handle = z.string().uuid();
  if (hasWebhook) shape.webhook_handle = z.string().uuid();
  if (entry.fields?.query.length) shape.query = objectFields(entry.fields.query).optional();
  const body = bodySchema(entry);
  if (body) shape.body = entry.arrayBody || entry.fields?.body.some(field => field.required && field.type !== 'file' && !['access_token', 'file'].includes(field.name)) || entry.title === 'Create Interaction Response' ? body : body.optional();
  if (entry.multipart || entry.title === 'Create Guild Sticker') shape.files = entry.fields?.body.some(field => field.required && /^file(?: contents)?$/.test(field.type)) ? uploads.min(1) : uploads.optional();
  if (entry.audit) shape.audit_reason = z.string().max(512).optional();
  return z.object(shape).strict();
}

export function assertNoAudio(value: unknown): void {
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) { value.forEach(assertNoAudio); return; }
  const object = value as Record<string, unknown>;
  if (object.tts === true || typeof object.flags === 'number' && (object.flags & 8192) !== 0 || 'waveform' in object || 'duration_secs' in object) throw new Error('Audio playback, TTS and voice messages are not supported.');
  Object.values(object).forEach(assertNoAudio);
}
