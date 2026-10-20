import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { deflateSync } from 'node:zlib';
import { LiveScope } from './live-scope.mjs';

const guildId = process.env.DISCORD_TEST_GUILD_ID;
const applicationId = process.env.DISCORD_APPLICATION_ID;
if (!guildId || !applicationId || !process.env.DISCORD_BOT_TOKEN) throw new Error('Set DISCORD_TEST_GUILD_ID, DISCORD_APPLICATION_ID and DISCORD_BOT_TOKEN in the ignored local environment.');
const target = process.argv[process.argv.indexOf('--guild-id') + 1];
if (target !== guildId || !process.argv.includes('--guild-id')) throw new Error('Pass --guild-id matching DISCORD_TEST_GUILD_ID explicitly.');
const runId = Date.now().toString(36);
const prefix = `mcp_test_${runId}_`;
const reportPath = resolve('.cache', `live-test-${runId}.json`);
const report = { started_at: new Date().toISOString(), guild_id: guildId, application_id: applicationId, prefix, protected_channel_ids: [], results: [], skipped: [], cleanup: [], fatal: null };
const inventory = JSON.parse(await readFile('src/reference/discord.json', 'utf8')).entries;
const transport = new StdioClientTransport({ command: process.execPath, args: ['--env-file=.env', resolve('dist/index.js')], env: { ...process.env, DISCORD_MCP_OFFLINE: '0' }, stderr: 'pipe' });
const client = new Client({ name: 'discord-mcp-isolated-live-test', version: '1.0.0' });
const cleanups = [];
let scope;
let category;
let channel;
const scrub = value => {
  let text = String(value);
  for (const secret of [process.env.DISCORD_BOT_TOKEN, process.env.DISCORD_CLIENT_SECRET].filter(Boolean)) text = text.replaceAll(secret, '[redacted]');
  return text;
};
transport.stderr?.on('data', data => console.error(scrub(data)));
await mkdir('.cache', { recursive: true });

async function save() { await writeFile(reportPath, JSON.stringify(report, null, 2) + '\n'); }

async function raw(name, input = {}) {
  const response = await client.callTool({ name, arguments: input }, undefined, { timeout: 45000 });
  if (response.isError) {
    const error = new Error(JSON.stringify(response.structuredContent?.error ?? response.content));
    error.discordError = response.structuredContent?.error;
    throw error;
  }
  return response.structuredContent?.data ?? null;
}

async function call(title, input = {}, expectedDiscordCode) {
  const entry = inventory.find(item => item.kind === 'rest' && item.title === title && item.status !== 'excluded');
  if (!entry) throw new Error(`No registered operation: ${title}`);
  scope?.assertCall(entry, input);
  const started = Date.now();
  try {
    const data = await raw(entry.tool, input);
    report.results.push({ tool: entry.tool, operation: title, status: 'passed', duration_ms: Date.now() - started });
    console.log(`PASS ${entry.tool}`);
    await save();
    return data;
  } catch (error) {
    if (expectedDiscordCode && error.discordError?.details?.code === expectedDiscordCode) {
      report.results.push({ tool: entry.tool, operation: title, status: 'passed', expected_discord_code: expectedDiscordCode, duration_ms: Date.now() - started });
      console.log(`PASS ${entry.tool} (expected Discord ${expectedDiscordCode})`);
      await save();
      return null;
    }
    const message = scrub(error.message);
    report.results.push({ tool: entry.tool, operation: title, status: 'failed', duration_ms: Date.now() - started, error: message });
    console.log(`FAIL ${entry.tool}: ${message}`);
    await save();
    throw error;
  }
}

function remember(kind, object, title, input) {
  scope.remember(kind, object.id);
  cleanups.push({ title, input });
  return object;
}

async function group(name, work) {
  try { await work(); } catch (error) { report.skipped.push({ group: name, reason: `Remaining dependent checks stopped: ${scrub(error.message)}` }); }
}

function png(size) {
  const crc = buffer => {
    let value = 0xffffffff;
    for (const byte of buffer) {
      value ^= byte;
      for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ value >>> 1 : value >>> 1;
    }
    return (value ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const head = Buffer.from(type);
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const checksum = Buffer.alloc(4);
    checksum.writeUInt32BE(crc(Buffer.concat([head, data])));
    return Buffer.concat([length, head, data, checksum]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8;
  header[9] = 6;
  const pixels = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) pixels.set([88, 101, 242, 255], y * (size * 4 + 1) + 1 + x * 4);
  return Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), chunk('IHDR', header), chunk('IDAT', deflateSync(pixels)), chunk('IEND', Buffer.alloc(0))]);
}

try {
  await client.connect(transport);
  const status = await raw('discord_status');
  if (!status.gateway.connected || status.gateway.bot_id !== applicationId) throw new Error('Unexpected bot identity or Gateway connection state.');
  const guild = await call('Get Guild', { guild_id: guildId });
  const existing = await call('Get Guild Channels', { guild_id: guildId });
  scope = new LiveScope(guildId, applicationId, existing, prefix);
  const metadata = item => JSON.stringify({ id: item.id, name: item.name, type: item.type, parent_id: item.parent_id, permission_overwrites: item.permission_overwrites, topic: item.topic, nsfw: item.nsfw, rate_limit_per_user: item.rate_limit_per_user });
  report.protected_metadata = Object.fromEntries(existing.filter(item => scope.protectedChannels.has(item.id)).map(item => [item.id, metadata(item)]));
  report.protected_channel_ids = [...scope.protectedChannels];
  report.gateway = { connected: true, bot_id: status.gateway.bot_id };
  console.log(`Protecting ${existing.length} existing channels; gifs IDs: ${report.protected_channel_ids.join(', ')}`);
  category = await call('Create Guild Channel', { guild_id: guildId, body: { name: `${prefix}category`, type: 4 } });
  remember('channel', category, 'Delete/Close Channel', { channel_id: category.id });
  channel = await call('Create Guild Channel', { guild_id: guildId, body: { name: `${prefix}text`, type: 0, parent_id: category.id } });
  remember('channel', channel, 'Delete/Close Channel', { channel_id: channel.id });
  await group('channel administration', async () => {
    await call('Get Channel', { channel_id: channel.id });
    await call('Modify Channel', { channel_id: channel.id, body: { topic: 'Temporary isolated MCP validation', rate_limit_per_user: 1 } });
    await call('Trigger Typing Indicator', { channel_id: channel.id });
    const voice = await call('Create Guild Channel', { guild_id: guildId, body: { name: `${prefix}voice`, type: 2, parent_id: category.id } });
    remember('channel', voice, 'Delete/Close Channel', { channel_id: voice.id });
    await call('Set Voice Channel Status', { channel_id: voice.id, body: { status: 'Isolated MCP administration test' } });
  });
  await group('roles and scoped permissions', async () => {
    const role = await call('Create Guild Role', { guild_id: guildId, body: { name: `${prefix}role`, permissions: '0' } });
    remember('role', role, 'Delete Guild Role', { guild_id: guildId, role_id: role.id });
    await call('Get Guild Role', { guild_id: guildId, role_id: role.id });
    await call('Modify Guild Role', { guild_id: guildId, role_id: role.id, body: { name: `${prefix}edited`, mentionable: false } });
    await call('Edit Channel Permissions', { channel_id: channel.id, overwrite_id: role.id, body: { type: 0, allow: '1024', deny: '0' } });
    await call('Delete Channel Permission', { channel_id: channel.id, overwrite_id: role.id });
  });
  await group('messages, attachments, reactions and pins', async () => {
    const message = await call('Create Message', { channel_id: channel.id, body: { content: 'Isolated discord-mcp live test', allowed_mentions: { parse: [] }, embeds: [{ title: 'Contract test', description: 'Created only in the temporary test channel.' }] }, files: [{ filename: 'test.txt', data_base64: Buffer.from('discord-mcp isolated attachment test').toString('base64'), content_type: 'text/plain' }] });
    scope.remember('message', message.id);
    await call('Get Channel Message', { channel_id: channel.id, message_id: message.id });
    await call('Get Channel Messages', { channel_id: channel.id, query: { limit: 2 } });
    await call('Edit Message', { channel_id: channel.id, message_id: message.id, body: { content: 'Edited isolated live test' } });
    await call('Create Reaction', { channel_id: channel.id, message_id: message.id, emoji_id: '👍' });
    await call('Get Reactions', { channel_id: channel.id, message_id: message.id, emoji_id: '👍' });
    await call('Delete Own Reaction', { channel_id: channel.id, message_id: message.id, emoji_id: '👍' });
    await call('Pin Message', { channel_id: channel.id, message_id: message.id });
    await call('Get Channel Pins', { channel_id: channel.id });
    await call('Unpin Message', { channel_id: channel.id, message_id: message.id });
    const thread = await call('Start Thread from Message', { channel_id: channel.id, message_id: message.id, body: { name: `${prefix}thread`, auto_archive_duration: 60 } });
    remember('channel', thread, 'Delete/Close Channel', { channel_id: thread.id });
    await call('Join Thread', { channel_id: thread.id });
    await call('List Thread Members', { channel_id: thread.id });
    await call('Leave Thread', { channel_id: thread.id });
    await call('Delete Message', { channel_id: channel.id, message_id: message.id });
    const batch = [];
    for (let index = 0; index < 2; index++) {
      const item = await call('Create Message', { channel_id: channel.id, body: { content: `Temporary bulk-delete test ${index}`, allowed_mentions: { parse: [] } } });
      scope.remember('message', item.id);
      batch.push(item.id);
    }
    await call('Bulk Delete Messages', { channel_id: channel.id, body: { messages: batch } });
  });
  await group('polls', async () => {
    const message = await call('Create Message', { channel_id: channel.id, body: { poll: { question: { text: 'Temporary MCP test poll' }, answers: [{ poll_media: { text: 'One' } }, { poll_media: { text: 'Two' } }], duration: 1, allow_multiselect: false, layout_type: 1 } } });
    scope.remember('message', message.id);
    await call('Get Answer Voters', { channel_id: channel.id, message_id: message.id, answer_id: '1' });
    await call('End Poll', { channel_id: channel.id, message_id: message.id });
    await call('Delete Message', { channel_id: channel.id, message_id: message.id });
  });
  await group('invites', async () => {
    const invite = await call('Create Channel Invite', { channel_id: channel.id, body: { max_age: 300, max_uses: 1, temporary: true, unique: true } });
    scope.remember('invite', invite.code);
    cleanups.push({ title: 'Delete Invite', input: { invite_code: invite.code } });
    await call('Get Invite', { invite_code: invite.code });
    await call('Get Channel Invites', { channel_id: channel.id });
  });
  await group('webhooks', async () => {
    const webhook = await call('Create Webhook', { channel_id: channel.id, body: { name: `${prefix}webhook` } });
    remember('webhook', webhook, 'Delete Webhook', { webhook_id: webhook.id });
    scope.remember('webhook_handle', webhook.webhook_handle);
    await call('Get Webhook', { webhook_id: webhook.id });
    await call('Get Webhook with Token', { webhook_handle: webhook.webhook_handle });
    await call('Get Channel Webhooks', { channel_id: channel.id });
    await call('Modify Webhook', { webhook_id: webhook.id, body: { name: `${prefix}hook_edited` } });
    const message = await call('Execute Webhook', { webhook_handle: webhook.webhook_handle, query: { wait: true }, body: { content: 'Temporary webhook validation', allowed_mentions: { parse: [] } } });
    scope.remember('message', message.id);
    await call('Get Webhook Message', { webhook_handle: webhook.webhook_handle, message_id: message.id });
    await call('Edit Webhook Message', { webhook_handle: webhook.webhook_handle, message_id: message.id, body: { content: 'Edited webhook validation' } });
    await call('Delete Webhook Message', { webhook_handle: webhook.webhook_handle, message_id: message.id });
  });
  await group('guild application commands', async () => {
    const command = await call('Create Guild Application Command', { guild_id: guildId, body: { name: `${prefix}command`, description: 'Temporary MCP command validation', type: 1 } });
    remember('command', command, 'Delete Guild Application Command', { guild_id: guildId, command_id: command.id });
    await call('Get Guild Application Command', { guild_id: guildId, command_id: command.id });
    await call('Edit Guild Application Command', { guild_id: guildId, command_id: command.id, body: { description: 'Edited temporary MCP command' } });
    await call('Get Application Command Permissions', { guild_id: guildId, command_id: command.id }, 10066);
  });
  await group('external scheduled events', async () => {
    const event = await call('Create Guild Scheduled Event', { guild_id: guildId, body: { name: `${prefix}event`, privacy_level: 2, entity_type: 3, entity_metadata: { location: 'Isolated MCP test' }, scheduled_start_time: new Date(Date.now() + 3600000).toISOString(), scheduled_end_time: new Date(Date.now() + 7200000).toISOString() } });
    remember('event', event, 'Delete Guild Scheduled Event', { guild_id: guildId, guild_scheduled_event_id: event.id });
    await call('Get Guild Scheduled Event', { guild_id: guildId, guild_scheduled_event_id: event.id });
    await call('Modify Guild Scheduled Event', { guild_id: guildId, guild_scheduled_event_id: event.id, body: { description: 'Edited temporary live-test event' } });
    await call('Get Guild Scheduled Event Users', { guild_id: guildId, guild_scheduled_event_id: event.id });
  });
  await group('guild emoji', async () => {
    const emoji = await call('Create Guild Emoji', { guild_id: guildId, body: { name: `${prefix}emoji`, image: `data:image/png;base64,${png(128).toString('base64')}` } });
    remember('emoji', emoji, 'Delete Guild Emoji', { guild_id: guildId, emoji_id: emoji.id });
    await call('Get Guild Emoji', { guild_id: guildId, emoji_id: emoji.id });
    await call('Modify Guild Emoji', { guild_id: guildId, emoji_id: emoji.id, body: { name: `${prefix}emoji_edit` } });
  });
  await group('guild stickers', async () => {
    const sticker = await call('Create Guild Sticker', { guild_id: guildId, body: { name: `${prefix}sticker`, description: 'Temporary MCP test sticker', tags: 'test' }, files: [{ filename: 'test.png', data_base64: png(320).toString('base64'), content_type: 'image/png' }] });
    remember('sticker', sticker, 'Delete Guild Sticker', { guild_id: guildId, sticker_id: sticker.id });
    await call('Get Guild Sticker', { guild_id: guildId, sticker_id: sticker.id });
    await call('Modify Guild Sticker', { guild_id: guildId, sticker_id: sticker.id, body: { description: 'Edited temporary MCP test sticker' } });
  });
  await group('disabled AutoMod rule', async () => {
    const rule = await call('Create Auto Moderation Rule', { guild_id: guildId, body: { name: `${prefix}automod`, event_type: 1, trigger_type: 1, trigger_metadata: { keyword_filter: [`${prefix}unmatched`] }, actions: [{ type: 1, metadata: { custom_message: 'Isolated disabled test rule' } }], enabled: false } });
    remember('automod', rule, 'Delete Auto Moderation Rule', { guild_id: guildId, auto_moderation_rule_id: rule.id });
    await call('Get Auto Moderation Rule', { guild_id: guildId, auto_moderation_rule_id: rule.id });
    await call('Modify Auto Moderation Rule', { guild_id: guildId, auto_moderation_rule_id: rule.id, body: { name: `${prefix}automod_edit`, enabled: false } });
  });
  await group('Gateway observation', async () => {
    const events = await raw('discord_events_poll', { guild_id: guildId, channel_id: channel.id, limit: 100 });
    report.results.push({ tool: 'discord_events_poll', status: 'passed', event_count: events.events.length, event_types: [...new Set(events.events.map(event => event.type))] });
    if (!events.events.some(event => event.type === 'MESSAGE_CREATE')) throw new Error('The test-channel message event was not observed.');
    await raw('discord_gateway_request_members', { guild_id: guildId, user_ids: [applicationId], limit: 1 });
    report.results.push({ tool: 'discord_gateway_request_members', status: 'passed' });
    await raw('discord_gateway_request_channel_info', { guild_id: guildId, fields: ['status', 'voice_start_time'] });
    report.results.push({ tool: 'discord_gateway_request_channel_info', status: 'passed' });
  });
  report.skipped.push({ group: 'member moderation', reason: 'A disposable, non-owner test member has not been specified.' }, { group: 'user interactions and OAuth2', reason: 'Live slash-command/modal/autocomplete triggers and browser consent require user participation.' }, { group: 'public webhook events', reason: 'A public HTTPS forwarding endpoint and application public key have not been configured.' });
  if (!guild.features.includes('COMMUNITY')) report.skipped.push({ group: 'community-only channels and Stage', reason: 'The isolated guild does not have the COMMUNITY feature; existing server configuration is preserved.' });
} catch (error) {
  report.fatal = scrub(error.message);
  console.error(`LIVE TEST STOPPED: ${report.fatal}`);
} finally {
  for (const item of cleanups.reverse()) {
    try {
      await call(item.title, item.input);
      report.cleanup.push({ operation: item.title, status: 'passed' });
    } catch (error) { report.cleanup.push({ operation: item.title, status: 'failed', error: scrub(error.message) }); }
  }
  if (scope) {
    try {
      const after = await call('Get Guild Channels', { guild_id: guildId });
      const leftover = after.filter(item => scope.owns('channel', item.id));
      report.channel_cleanup_verified = leftover.length === 0;
      report.protected_channels_present = report.protected_channel_ids.every(id => after.some(item => item.id === id));
      report.protected_channels_unchanged = report.protected_channel_ids.every(id => {
        const item = after.find(item => item.id === id);
        return item && report.protected_metadata[id] === JSON.stringify({ id: item.id, name: item.name, type: item.type, parent_id: item.parent_id, permission_overwrites: item.permission_overwrites, topic: item.topic, nsfw: item.nsfw, rate_limit_per_user: item.rate_limit_per_user });
      });
    } catch { report.channel_cleanup_verified = false; }
  }
  await client.close().catch(() => undefined);
  report.finished_at = new Date().toISOString();
  await save();
  console.log(JSON.stringify({ report: reportPath, passed: report.results.filter(result => result.status === 'passed').length, failed: report.results.filter(result => result.status === 'failed').length, skipped_groups: report.skipped.length, fatal: report.fatal, cleanup_verified: report.channel_cleanup_verified, protected_channels_present: report.protected_channels_present }));
  if (report.fatal || report.results.some(result => result.status === 'failed') || report.cleanup.some(result => result.status === 'failed')) process.exitCode = 1;
}
