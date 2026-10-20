import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { LiveScope } from './live-scope.mjs';

const guildId = process.env.DISCORD_TEST_GUILD_ID;
const applicationId = process.env.DISCORD_APPLICATION_ID;
const selected = process.argv.includes('--only') ? new Set(process.argv[process.argv.indexOf('--only') + 1]?.split(',')) : undefined;
if (!guildId || !applicationId || !process.argv.includes('--guild-id') || process.argv[process.argv.indexOf('--guild-id') + 1] !== guildId) throw new Error('An explicit matching guild ID is required.');
const entries = JSON.parse(await readFile('src/reference/discord.json', 'utf8')).entries;
const transport = new StdioClientTransport({ command: process.execPath, args: ['--env-file=.env', resolve('dist/index.js')], env: { ...process.env, DISCORD_MCP_OFFLINE: '0' }, stderr: 'pipe' });
const client = new Client({ name: 'discord-mcp-readonly-live-test', version: '1.0.0' });
const report = { started_at: new Date().toISOString(), guild_id: guildId, results: [], skipped: [] };
const reportPath = resolve('.cache', `live-readonly-${Date.now().toString(36)}.json`);
const safe = value => {
  let text = String(value);
  for (const secret of [process.env.DISCORD_BOT_TOKEN, process.env.DISCORD_CLIENT_SECRET].filter(Boolean)) text = text.replaceAll(secret, '[redacted]');
  return text;
};
transport.stderr?.on('data', data => console.error(safe(data)));
await mkdir('.cache', { recursive: true });
try {
  await client.connect(transport);
  const getGuild = entries.find(entry => entry.title === 'Get Guild');
  const guildResult = await client.callTool({ name: getGuild.tool, arguments: { guild_id: guildId } });
  if (guildResult.isError) throw new Error('Cannot access the explicitly selected test guild.');
  const guild = guildResult.structuredContent.data;
  const scope = new LiveScope(guildId, applicationId, [], 'readonly_');
  const featureRequirements = { 'Get Guild Preview': 'DISCOVERABLE', 'Get Guild Welcome Screen': 'COMMUNITY', 'Get Guild Vanity URL': 'VANITY_URL', 'Get Guild Widget': 'WIDGET_ENABLED', 'Get Guild Widget Image': 'WIDGET_ENABLED' };
  for (const entry of entries.filter(entry => entry.kind === 'rest' && entry.method === 'GET' && entry.status !== 'excluded' && entry.auth === 'bot')) {
    if (selected && !selected.has(entry.tool)) continue;
    const params = [...entry.path.matchAll(/\{([^}]+)\}/g)].map(match => match[1]);
    if (params.some(name => !['guild_id', 'application_id'].includes(name)) || entry.path === '/users/@me/guilds' || entry.title === 'Search Guild Messages') continue;
    const requiredFeature = featureRequirements[entry.title];
    if (requiredFeature && !guild.features.includes(requiredFeature)) { report.skipped.push({ tool: entry.tool, reason: `Missing ${requiredFeature}` }); continue; }
    const input = {};
    if (params.includes('guild_id')) input.guild_id = guildId;
    if (params.includes('application_id')) input.application_id = applicationId;
    if (entry.fields.query.some(field => field.name === 'limit')) input.query = { limit: 10 };
    if (entry.title === 'Search Guild Members') input.query = { ...input.query, query: 'mcp_test_' };
    scope.assertCall(entry, input);
    const result = await client.callTool({ name: entry.tool, arguments: input }, undefined, { timeout: 30000 });
    const expectedVoiceState = entry.title === 'Get Current User Voice State' && result.structuredContent?.error?.details?.code === 10065;
    if (result.isError && !expectedVoiceState) {
      const message = safe(JSON.stringify(result.structuredContent?.error ?? result.content));
      report.results.push({ tool: entry.tool, status: 'failed', error: message });
      console.log(`FAIL ${entry.tool}: ${message}`);
    } else {
      const data = result.structuredContent?.data;
      report.results.push({ tool: entry.tool, status: 'passed', item_count: Array.isArray(data) ? data.length : undefined, expected_discord_code: expectedVoiceState ? 10065 : undefined });
      console.log(`PASS ${entry.tool}`);
    }
    await writeFile(reportPath, JSON.stringify(report, null, 2) + '\n');
  }
} finally {
  await client.close().catch(() => undefined);
  report.finished_at = new Date().toISOString();
  await writeFile(reportPath, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ report: reportPath, passed: report.results.filter(result => result.status === 'passed').length, failed: report.results.filter(result => result.status === 'failed').length, skipped: report.skipped.length }));
  if (report.results.some(result => result.status === 'failed')) process.exitCode = 1;
}
