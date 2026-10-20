import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { LiveScope } from './live-scope.mjs';

const guildId = process.env.DISCORD_TEST_GUILD_ID;
const applicationId = process.env.DISCORD_APPLICATION_ID;
const target = process.argv[process.argv.indexOf('--guild-id') + 1];
if (!guildId || !applicationId || !process.argv.includes('--guild-id') || target !== guildId) throw new Error('An explicit matching test guild ID is required.');
const prefix = `mcptest_${Date.now().toString(36).slice(-5)}_`;
const searchOnly = process.argv.includes('--search-only');
const oauthOnly = process.argv.includes('--oauth-only');
if (searchOnly && oauthOnly) throw new Error('Choose only one focused test mode.');
const requiredChecks = oauthOnly ? ['oauth2'] : searchOnly ? ['autocomplete', 'search_submit'] : ['command', 'modal_open', 'modal_submit', 'autocomplete', 'search_submit', 'button', 'oauth2'];
const reportPath = resolve('.cache', `live-interactions-${prefix}.json`);
const report = { guild_id: guildId, prefix, results: [], checks: {}, cleanup: [], started_at: new Date().toISOString() };
const inventory = JSON.parse(await readFile('src/reference/discord.json', 'utf8')).entries;
const transport = new StdioClientTransport({ command: process.execPath, args: ['--env-file=.env', resolve('dist/index.js')], env: { ...process.env, DISCORD_MCP_OFFLINE: '0' }, stderr: 'pipe' });
const client = new Client({ name: 'discord-mcp-interactive-live-test', version: '1.0.0' });
const cleanup = [];
const handled = new Set();
let scope;
let channel;
let command;
let oauthStarted = false;
let oauthVerified = false;
let cursor;
const safe = value => {
  let text = String(value);
  for (const secret of [process.env.DISCORD_BOT_TOKEN, process.env.DISCORD_CLIENT_SECRET].filter(Boolean)) text = text.replaceAll(secret, '[redacted]');
  return text;
};
transport.stderr?.on('data', data => console.error(safe(data)));
await mkdir('.cache', { recursive: true });
const save = async () => { await writeFile(reportPath, JSON.stringify(report, null, 2) + '\n'); await writeFile('.cache/live-interactions-current.json', JSON.stringify(report, null, 2) + '\n'); };

async function raw(name, input = {}, record = true) {
  const response = await client.callTool({ name, arguments: input }, undefined, { timeout: 40000 });
  if (response.isError) throw new Error(safe(JSON.stringify(response.structuredContent?.error ?? response.content)));
  if (record) { report.results.push({ tool: name, status: 'passed' }); console.log(`PASS ${name}`); await save(); }
  return response.structuredContent?.data;
}

async function call(title, input) {
  const entry = inventory.find(item => item.kind === 'rest' && item.title === title && item.status !== 'excluded');
  if (!entry) throw new Error(`Unknown operation: ${title}`);
  scope?.assertCall(entry, input);
  return raw(entry.tool, input);
}

async function reply(handle, text) {
  await call('Edit Original Interaction Response', { interaction_handle: handle, body: { content: text, allowed_mentions: { parse: [] } } });
  await call('Get Original Interaction Response', { interaction_handle: handle });
}

try {
  await client.connect(transport);
  const channels = await call('Get Guild Channels', { guild_id: guildId });
  scope = new LiveScope(guildId, applicationId, channels, prefix);
  const category = await call('Create Guild Channel', { guild_id: guildId, body: { name: `${prefix}category`, type: 4 } });
  scope.remember('channel', category.id);
  cleanup.push(['Delete/Close Channel', { channel_id: category.id }]);
  channel = await call('Create Guild Channel', { guild_id: guildId, body: { name: `${prefix}interactive`, type: 0, parent_id: category.id } });
  scope.remember('channel', channel.id);
  cleanup.push(['Delete/Close Channel', { channel_id: channel.id }]);
  const definitions = [
    { name: `${prefix}ping`, description: 'Test deferred MCP responses', type: 1 },
    { name: `${prefix}form`, description: 'Test the MCP modal response', type: 1 },
    { name: `${prefix}search`, description: 'Test MCP autocomplete', type: 1, options: [{ type: 3, name: 'query', description: 'Type m to test autocomplete', required: true, autocomplete: true }] }
  ];
  const selectedDefinitions = oauthOnly ? definitions.slice(0, 1) : searchOnly ? definitions.slice(2) : definitions;
  for (const definition of selectedDefinitions) {
    const item = await call('Create Guild Application Command', { guild_id: guildId, body: definition });
    scope.remember('command', item.id);
    cleanup.push(['Delete Guild Application Command', { guild_id: guildId, command_id: item.id }]);
    if (definition.name.endsWith('_ping')) command = item;
  }
  if (!oauthOnly) {
  await raw('discord_interaction_rules_set', { id: `${prefix}form`, command_name: `${prefix}form`, interaction_type: 2, response: { type: 9, data: { title: 'discord-mcp live test', custom_id: `${prefix}modal`, components: [{ type: 18, label: 'Test value', component: { type: 4, custom_id: 'value', style: 1, required: true } }] } } });
  await raw('discord_interaction_rules_set', { id: `${prefix}search`, command_name: `${prefix}search`, interaction_type: 4, response: { type: 8, data: { choices: [{ name: 'MCP live test', value: 'mcp' }] } } });
  await raw('discord_interaction_rules_set', { id: `${prefix}search_submit`, command_name: `${prefix}search`, interaction_type: 2, response: { type: 4, data: { content: 'Search test completed.', flags: 64 } } });
  const message = await call('Create Message', { channel_id: channel.id, body: { content: searchOnly ? `Type m into /${prefix}search query, select the suggestion and submit the command. It must finish with a response.` : `Interactive test channel. Run /${prefix}ping, submit /${prefix}form, and type m into /${prefix}search query. Click the button below.`, allowed_mentions: { parse: [] }, components: searchOnly ? [] : [{ type: 1, components: [{ type: 2, label: 'Test MCP button', style: 1, custom_id: `${prefix}button` }] }] } });
  scope.remember('message', message.id);
  }
  try {
    if (!searchOnly) {
    const oauth = await raw('discord_oauth_begin', { scopes: ['identify', 'applications.commands.permissions.update'] });
    oauthStarted = true;
    report.authorization_url = oauth.authorization_url;
    }
  } catch (error) { report.oauth_start_error = safe(error.message); }
  report.stage = 'waiting_for_user';
  report.channel_url = `https://discord.com/channels/${guildId}/${channel.id}`;
  report.commands = selectedDefinitions.map(item => item.name);
  report.modal_custom_id = `${prefix}modal`;
  await save();
  console.log(JSON.stringify({ stage: report.stage, channel_url: report.channel_url, commands: report.commands, authorization_url: report.authorization_url, report: reportPath }));
  const deadline = Date.now() + (searchOnly ? 240000 : 480000);
  while (Date.now() < deadline) {
    const page = await raw('discord_events_poll', { cursor, guild_id: guildId, channel_id: channel.id, types: ['INTERACTION_CREATE'], timeout_ms: 5000, limit: 100 }, false);
    cursor = page.cursor;
    for (const event of page.events) {
      const interaction = event.data;
      if (handled.has(interaction.id)) continue;
      handled.add(interaction.id);
      const payload = interaction.data;
      const handle = interaction.interaction_handle;
      if (interaction.type === 2 && payload.name === `${prefix}ping`) {
        await reply(handle, 'Deferred command response verified.');
        const followup = await call('Create Followup Message', { interaction_handle: handle, body: { content: 'MCP followup verification', allowed_mentions: { parse: [] } } });
        scope.remember('message', followup.id);
        await call('Get Followup Message', { interaction_handle: handle, message_id: followup.id });
        await call('Edit Followup Message', { interaction_handle: handle, message_id: followup.id, body: { content: 'Edited MCP followup' } });
        await call('Delete Followup Message', { interaction_handle: handle, message_id: followup.id });
        report.checks.command = true;
      } else if (interaction.type === 2 && payload.name === `${prefix}form`) {
        if (interaction.acknowledgement !== 9) throw new Error('Modal response was not acknowledged as a modal.');
        report.checks.modal_open = true;
      } else if (interaction.type === 5 && payload.custom_id === `${prefix}modal`) {
        await reply(handle, 'Modal submission verified.');
        report.checks.modal_submit = true;
      } else if (interaction.type === 4 && payload.name === `${prefix}search`) {
        if (interaction.acknowledgement !== 8) throw new Error('Autocomplete response was not observed.');
        report.checks.autocomplete = true;
      } else if (interaction.type === 2 && payload.name === `${prefix}search`) {
        await reply(handle, 'Search command submission completed.');
        report.checks.search_submit = true;
      } else if (interaction.type === 3 && payload.custom_id === `${prefix}button`) {
        if (interaction.acknowledgement !== 6) throw new Error('Component defer was not observed.');
        const followup = await call('Create Followup Message', { interaction_handle: handle, body: { content: 'Button interaction verified.', flags: 64 } });
        scope.remember('message', followup.id);
        await call('Delete Followup Message', { interaction_handle: handle, message_id: followup.id });
        report.checks.button = true;
      }
      console.log(JSON.stringify({ checks: report.checks }));
      await save();
    }
    if (oauthStarted && !oauthVerified) {
      const status = await raw('discord_oauth_status', {}, false);
      if (status.connected) {
        const authorization = await call('Get Current Authorization Information', {});
        if (!authorization.user?.id) throw new Error('OAuth2 did not return an authorized identity.');
        const permissions = [{ id: channel.id, type: 3, permission: true }];
        await call('Edit Application Command Permissions', { guild_id: guildId, command_id: command.id, body: { permissions } });
        const stored = await call('Get Application Command Permissions', { guild_id: guildId, command_id: command.id });
        if (!stored.permissions?.some(item => item.id === channel.id && item.type === 3 && item.permission === true)) throw new Error('The temporary command permission did not round-trip.');
        oauthVerified = true;
        report.checks.oauth2 = true;
        console.log('PASS OAuth2 identity and command permission update');
        await save();
      }
    }
    if (requiredChecks.every(key => report.checks[key])) break;
  }
  report.incomplete = requiredChecks.filter(key => !report.checks[key]);
} catch (error) {
  report.fatal = safe(error.message);
  console.error(`INTERACTIVE TEST STOPPED: ${report.fatal}`);
} finally {
  if (oauthStarted) {
    try { await raw('discord_oauth_disconnect'); report.oauth_revoked = true; } catch (error) { report.cleanup.push({ operation: 'OAuth2 revoke', status: 'failed', error: safe(error.message) }); }
  }
  for (const [title, input] of cleanup.reverse()) {
    try { await call(title, input); report.cleanup.push({ operation: title, status: 'passed' }); }
    catch (error) { report.cleanup.push({ operation: title, status: 'failed', error: safe(error.message) }); }
  }
  await client.close().catch(() => undefined);
  report.stage = 'finished';
  report.finished_at = new Date().toISOString();
  await save();
  console.log(JSON.stringify({ report: reportPath, checks: report.checks, incomplete: report.incomplete, fatal: report.fatal }));
  if (report.fatal || report.incomplete?.length || report.cleanup.some(item => item.status === 'failed')) process.exitCode = 1;
}
