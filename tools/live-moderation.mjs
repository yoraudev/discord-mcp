import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { setTimeout as sleep } from 'node:timers/promises';
import { resolve } from 'node:path';
import { LiveScope } from './live-scope.mjs';

const guildId = process.env.DISCORD_TEST_GUILD_ID;
const memberId = process.env.DISCORD_TEST_MEMBER_ID;
const applicationId = process.env.DISCORD_APPLICATION_ID;
const target = process.argv[process.argv.indexOf('--guild-id') + 1];
if (!guildId || !memberId || !applicationId || !process.argv.includes('--guild-id') || target !== guildId) throw new Error('An explicit matching guild ID and DISCORD_TEST_MEMBER_ID are required.');
const prefix = `mcp_test_${Date.now().toString(36)}_`;
const path = resolve('.cache', `live-moderation-${prefix}.json`);
const report = { guild_id: guildId, member_id: memberId, prefix, started_at: new Date().toISOString(), results: [], cleanup: [], rejoin_url: null, member_restored: false };
const reference = JSON.parse(await readFile('src/reference/discord.json', 'utf8')).entries;
const transport = new StdioClientTransport({ command: process.execPath, args: ['--env-file=.env', resolve('dist/index.js')], env: { ...process.env, DISCORD_MCP_OFFLINE: '0' }, stderr: 'pipe' });
const client = new Client({ name: 'discord-mcp-live-moderation', version: '1.0.0' });
const cleanup = [];
let scope;
let original;
let modifiedMember = false;
let removedMember = false;
let banned = false;
await mkdir('.cache', { recursive: true });
const save = async () => { await writeFile(path, JSON.stringify(report, null, 2) + '\n'); await writeFile('.cache/live-moderation-current.json', JSON.stringify(report, null, 2) + '\n'); };
const safe = value => {
  let text = String(value);
  for (const secret of [process.env.DISCORD_BOT_TOKEN, process.env.DISCORD_CLIENT_SECRET].filter(Boolean)) text = text.replaceAll(secret, '[redacted]');
  return text;
};
transport.stderr?.on('data', data => console.error(safe(data)));

async function call(title, input, expectedCodes = [], record = true) {
  const entry = reference.find(item => item.kind === 'rest' && item.title === title && item.status !== 'excluded');
  if (!entry) throw new Error(`Unknown operation: ${title}`);
  scope?.assertCall(entry, input);
  const response = await client.callTool({ name: entry.tool, arguments: input }, undefined, { timeout: 30000 });
  const error = response.structuredContent?.error;
  if (response.isError && !expectedCodes.includes(error?.details?.code)) {
    const message = safe(JSON.stringify(error ?? response.content));
    if (record) report.results.push({ tool: entry.tool, status: 'failed', error: message });
    throw new Error(message);
  }
  if (record) {
    report.results.push({ tool: entry.tool, status: 'passed', expected_discord_code: error?.details?.code });
    console.log(`PASS ${entry.tool}`);
    await save();
  }
  return response.isError ? null : response.structuredContent?.data;
}

try {
  await client.connect(transport);
  const guild = await call('Get Guild', { guild_id: guildId });
  const channels = await call('Get Guild Channels', { guild_id: guildId });
  scope = new LiveScope(guildId, applicationId, channels, prefix);
  original = await call('Get Guild Member', { guild_id: guildId, user_id: memberId });
  scope.authorizeMember(original, guild.owner_id);
  if (original.roles.length || original.communication_disabled_until) throw new Error('Destructive moderation requires a fresh test member without existing roles or timeout.');
  report.member_username = original.user.username;
  const category = await call('Create Guild Channel', { guild_id: guildId, body: { name: `${prefix}category`, type: 4 } });
  scope.remember('channel', category.id);
  cleanup.push(['Delete/Close Channel', { channel_id: category.id }]);
  const channel = await call('Create Guild Channel', { guild_id: guildId, body: { name: `${prefix}rejoin`, type: 0, parent_id: category.id } });
  scope.remember('channel', channel.id);
  cleanup.push(['Delete/Close Channel', { channel_id: channel.id }]);
  const invite = await call('Create Channel Invite', { channel_id: channel.id, body: { max_age: 600, max_uses: 1, unique: true, temporary: false } });
  scope.remember('invite', invite.code);
  cleanup.push(['Delete Invite', { invite_code: invite.code }, [10006]]);
  const role = await call('Create Guild Role', { guild_id: guildId, body: { name: `${prefix}memberrole`, permissions: '0' } });
  scope.remember('role', role.id);
  cleanup.push(['Delete Guild Role', { guild_id: guildId, role_id: role.id }]);
  await call('Add Guild Member Role', { guild_id: guildId, user_id: memberId, role_id: role.id });
  const assigned = await call('Get Guild Member', { guild_id: guildId, user_id: memberId });
  if (!assigned.roles.includes(role.id)) throw new Error('Test role assignment was not observed.');
  await call('Remove Guild Member Role', { guild_id: guildId, user_id: memberId, role_id: role.id });
  modifiedMember = true;
  await call('Modify Guild Member', { guild_id: guildId, user_id: memberId, body: { nick: `${prefix}member`, communication_disabled_until: new Date(Date.now() + 60000).toISOString() } });
  const timed = await call('Get Guild Member', { guild_id: guildId, user_id: memberId });
  if (!timed.communication_disabled_until || timed.nick !== `${prefix}member`) throw new Error('Member nickname or timeout was not observed.');
  await call('Modify Guild Member', { guild_id: guildId, user_id: memberId, body: { nick: original.nick ?? null, communication_disabled_until: null } });
  modifiedMember = false;
  await call('Remove Guild Member', { guild_id: guildId, user_id: memberId });
  removedMember = true;
  await call('Get Guild Member', { guild_id: guildId, user_id: memberId }, [10007]);
  await call('Create Guild Ban', { guild_id: guildId, user_id: memberId, body: { delete_message_seconds: 0 } });
  banned = true;
  await call('Get Guild Ban', { guild_id: guildId, user_id: memberId });
  await call('Remove Guild Ban', { guild_id: guildId, user_id: memberId });
  banned = false;
  await call('Get Guild Ban', { guild_id: guildId, user_id: memberId }, [10026]);
  report.rejoin_url = `https://discord.gg/${invite.code}`;
  report.stage = 'waiting_for_member_rejoin';
  await save();
  console.log(JSON.stringify({ stage: report.stage, member_id: memberId, rejoin_url: report.rejoin_url, report: path }));
  const deadline = Date.now() + 300000;
  while (Date.now() < deadline) {
    const member = await call('Get Guild Member', { guild_id: guildId, user_id: memberId }, [10007], false);
    if (member) { report.member_restored = true; removedMember = false; break; }
    await sleep(5000);
  }
  if (!report.member_restored) report.results.push({ operation: 'member rejoin', status: 'not_completed', reason: 'The test account did not rejoin within five minutes.' });
} catch (error) {
  report.fatal = safe(error.message);
  console.error(`MODERATION TEST STOPPED: ${report.fatal}`);
} finally {
  if (banned) await call('Remove Guild Ban', { guild_id: guildId, user_id: memberId }).catch(error => { report.cleanup.push({ operation: 'unban', status: 'failed', error: safe(error.message) }); });
  if (modifiedMember && !removedMember) await call('Modify Guild Member', { guild_id: guildId, user_id: memberId, body: { nick: original.nick ?? null, communication_disabled_until: null } }).catch(error => { report.cleanup.push({ operation: 'restore member', status: 'failed', error: safe(error.message) }); });
  for (const [title, input, expected] of cleanup.reverse()) {
    try { await call(title, input, expected); report.cleanup.push({ operation: title, status: 'passed' }); }
    catch (error) { report.cleanup.push({ operation: title, status: 'failed', error: safe(error.message) }); }
  }
  await client.close().catch(() => undefined);
  report.stage = 'finished';
  report.finished_at = new Date().toISOString();
  await save();
  console.log(JSON.stringify({ report: path, passed: report.results.filter(result => result.status === 'passed').length, failed: report.results.filter(result => result.status === 'failed').length, member_restored: report.member_restored, fatal: report.fatal }));
  if (report.fatal || report.cleanup.some(result => result.status === 'failed')) process.exitCode = 1;
}
