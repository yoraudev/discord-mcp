import { z } from 'zod';
import { reference, type ReferenceEntry } from './reference.js';
import { assertNoAudio, inputSchema, jsonObject, snowflake } from './schemas.js';
import { ToolError, Vault } from './errors.js';
import type { Config } from './config.js';
import type { DiscordRest, Upload } from './rest.js';
import type { EventQueue } from './events.js';
import type { Gateway } from './gateway.js';
import type { OAuth } from './oauth.js';
import type { Interactions } from './interactions.js';

export interface Context {
  config: Config;
  rest: DiscordRest;
  events: EventQueue;
  gateway: Gateway;
  oauth: OAuth;
  interactions: Interactions;
  vault: Vault;
}

export interface Tool {
  name: string;
  description: string;
  schema: z.ZodObject;
  readOnly: boolean;
  destructive: boolean;
  execute: (input: Record<string, unknown>, signal?: AbortSignal) => Promise<unknown>;
}

export async function executeOperation(entry: ReferenceEntry, input: Record<string, unknown>, context: Context, signal?: AbortSignal): Promise<unknown> {
  const params: Record<string, unknown> = { ...input };
  let authorization: string | undefined;
  if (entry.auth === 'oauth2') {
    const scope = /permissions/.test(entry.path!) ? 'applications.commands.permissions.update' : /role-connection/.test(entry.path!) ? 'role_connections.write' : entry.title === 'Get Current User Guild Member' ? 'guilds.members.read' : undefined;
    authorization = `Bearer ${await context.oauth.accessToken(scope)}`;
  }
  if (typeof params.interaction_handle === 'string') {
    const state = context.interactions.resolve(params.interaction_handle);
    if (entry.title === 'Create Interaction Response' && state.acknowledged) throw new ToolError('ALREADY_ACKNOWLEDGED', 'The interaction was acknowledged automatically. Edit the original response or create a followup. Configure a rule for immediate modal/autocomplete responses.');
    if (entry.title === 'Create Interaction Response' && state.acknowledgement_deadline <= Date.now()) throw new ToolError('INTERACTION_DEADLINE', 'The three-second initial response deadline has expired.');
    Object.assign(params, { interaction_id: state.id, interaction_token: state.token, application_id: state.application_id });
    authorization = '';
  }
  if (typeof params.webhook_handle === 'string') {
    const secret = context.vault.get(params.webhook_handle);
    Object.assign(params, { webhook_id: secret.id, webhook_token: secret.token });
    authorization = '';
  }
  params.application_id ??= context.config.applicationId ?? context.gateway.client.application?.id;
  const path = entry.path!.replace(/\{([^}]+)\}/g, (_, name: string) => {
    const value = params[name];
    if (typeof value !== 'string' || !value) throw new ToolError('PARAMETER_REQUIRED', `${name} is required. Configure DISCORD_APPLICATION_ID where applicable.`);
    return encodeURIComponent(value);
  });
  let body = input.body;
  if (entry.title === 'Add Guild Member') body = { ...(body as object), access_token: await context.oauth.accessToken('guilds.join') };
  if (/messages|webhooks|interactions/.test(entry.path!) || /Start Thread/.test(entry.title)) assertNoAudio(body);
  if (entry.title === 'Create Interaction Response' && typeof input.interaction_handle === 'string') return context.vault.capture(await context.interactions.respond(input.interaction_handle, body, input.query as Record<string, unknown> | undefined, input.files as Upload[] | undefined, signal));
  const result = await context.rest.execute({ method: entry.method!, path, auth: authorization, query: input.query as Record<string, unknown> | undefined, body, files: input.files as Upload[] | undefined, sticker: entry.title === 'Create Guild Sticker', fileField: entry.fields?.body.find(field => field.type === 'file')?.name, audit_reason: input.audit_reason as string | undefined, signal });
  return context.vault.capture(result);
}

export function buildTools(context: Context): Tool[] {
  const tools: Tool[] = reference.filter(entry => entry.kind === 'rest' && entry.status !== 'excluded').map(entry => ({
    name: entry.tool!,
    description: `${entry.title}. ${entry.auth === 'oauth2' ? 'Requires an authorized OAuth2 session. ' : ''}${entry.permissions.length ? `Discord permissions: ${entry.permissions.join(', ')}. ` : ''}Reference: ${entry.source}`,
    schema: inputSchema(entry), readOnly: entry.method === 'GET', destructive: /DELETE/.test(entry.method!) || /Bulk|Ban|Modify|Edit|Overwrite|Remove|Consume|End Poll/.test(entry.title),
    execute: (input, signal) => executeOperation(entry, input, context, signal)
  }));
  const add = (name: string, description: string, schema: z.ZodObject, readOnly: boolean, execute: Tool['execute']): void => { tools.push({ name, description, schema, readOnly, destructive: !readOnly, execute }); };
  add('discord_status', 'Get bot connection state, OAuth2 scope status and process state without credentials.', z.object({}).strict(), true, async () => ({ gateway: context.gateway.status(), oauth: context.oauth.status(), event_epoch: context.events.epoch }));
  add('discord_events_poll', 'Read Gateway, webhook and connection events. Pass the previous cursor to continue. A gap reports overwritten history; a stale process cursor is rejected.', z.object({ cursor: z.string().optional(), types: z.array(z.string()).optional(), guild_id: snowflake.optional(), channel_id: snowflake.optional(), limit: z.number().int().min(1).max(1000).optional(), timeout_ms: z.number().int().min(0).max(30000).optional() }).strict(), true, (input, signal) => context.events.poll({ ...input, signal }));
  add('discord_gateway_update_presence', 'Update the bot presence through the Gateway.', z.object({ status: z.enum(['online', 'idle', 'dnd', 'invisible']), activities: z.array(z.object({ name: z.string().min(1), type: z.number().int().min(0).max(5), url: z.string().url().optional(), state: z.string().optional() }).strict()).max(4).default([]), afk: z.boolean().default(false) }).strict(), false, async input => context.gateway.updatePresence(input.status as 'online', input.activities as { name: string; type: number }[], input.afk as boolean));
  add('discord_gateway_request_members', 'Request guild members, optionally filtered by query or user IDs. Requires GuildMembers and, for presences, GuildPresences intents.', z.object({ guild_id: snowflake, query: z.string().optional(), limit: z.number().int().min(0).max(1000).optional(), user_ids: z.array(snowflake).min(1).max(100).optional(), presences: z.boolean().optional() }).strict(), true, input => context.gateway.requestMembers(input.guild_id as string, input));
  add('discord_gateway_request_channel_info', 'Request ephemeral channel status and voice start times; the reply is a CHANNEL_INFO event.', z.object({ guild_id: snowflake, fields: z.array(z.enum(['status', 'voice_start_time'])).min(1) }).strict(), true, async input => {
    if (!context.gateway.client.isReady()) throw new ToolError('GATEWAY_NOT_READY', 'The Discord Gateway is not ready.');
    const guild = await context.gateway.client.guilds.fetch(input.guild_id as string);
    guild.shard.send({ op: 43, d: input });
    return { requested: true };
  });
  add('discord_oauth_begin', 'Start optional Discord user authorization. Open the returned URL and grant the requested scopes; credentials stay inside this process.', z.object({ scopes: z.array(z.enum(['identify', 'guilds.join', 'guilds.members.read', 'role_connections.write', 'application_identities.write', 'applications.commands.permissions.update'])).min(1) }).strict(), false, input => context.oauth.begin(input.scopes as string[]));
  add('discord_oauth_status', 'Read OAuth2 connection status and granted scopes.', z.object({}).strict(), true, async () => context.oauth.status());
  add('discord_oauth_disconnect', 'Revoke the current Discord OAuth2 token and clear the local authorization session.', z.object({}).strict(), false, () => context.oauth.disconnect());
  add('discord_interaction_rules_list', 'List immediate interaction response rules. The first matching rule wins; the fallback automatically acknowledges other interactions.', z.object({}).strict(), true, async () => context.interactions.listRules());
  add('discord_interaction_rules_delete', 'Remove an immediate interaction rule.', z.object({ id: z.string() }).strict(), false, async input => context.interactions.deleteRule(input.id as string));
  add('discord_interaction_rules_set', 'Create or replace an immediate response rule. Configure modal/autocomplete rules before the interaction arrives. Response type 0 opts into manual initial responses within Discord\'s three-second deadline.', z.object({ id: z.string().min(1).max(100), command_name: z.string().optional(), custom_id: z.string().optional(), interaction_type: z.number().int().min(2).max(5).optional(), response: z.object({ type: z.number().int(), data: jsonObject.optional() }).strict() }).strict(), false, async input => {
    assertNoAudio(input.response);
    return context.interactions.setRule(input as unknown as Parameters<Interactions['setRule']>[0]);
  });
  return tools;
}
