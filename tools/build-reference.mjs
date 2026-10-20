import { readFile, readdir, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const clean = value => value.replace(/\\([_\[\]*])/g, '$1').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/`/g, '').trim();
const slug = value => value.toLowerCase().replace(/[^a-z0-9\s-]/g, '').replace(/\s+/g, '-');
const entries = [];
const documents = [];
for (const file of (await readdir('.cache/reference')).filter(file => file.endsWith('.md')).sort()) {
  const text = await readFile(`.cache/reference/${file}`, 'utf8');
  const source = `https://docs.discord.com/developers/${file.replace('__', '/').replace(/\.md$/, '')}`;
  documents.push({ source, sha256: createHash('sha256').update(text).digest('hex') });
  const sections = text.split(/(?=^## )/m);
  for (const section of sections) {
    const title = section.match(/^## (.+)/)?.[1];
    const route = section.match(/^(GET|POST|PUT|PATCH|DELETE)\s*\n(\/[^\n]+)/m);
    if (!title || !route) continue;
    const path = clean(route[2]).replace(/\{([^}]+)\}/g, (_, name) => `{${name.replaceAll('.', '_')}}`);
    const fields = { query: [], body: [] };
    let target;
    let inTable = false;
    for (const line of section.split('\n')) {
      if (/^#{3,6} /.test(line)) {
        target = /Query String (?:Params|Parameters)/i.test(line) ? 'query' : /(?:JSON|Form|Request Body).*?(?:Params|Parameters|Fields)|JSON Body/i.test(line) ? 'body' : undefined;
        inTable = false;
      }
      if (!target || !line.startsWith('|')) continue;
      const cells = line.split('|').slice(1, -1).map(clean);
      if (/^(field|param|parameter)$/i.test(cells[0] ?? '')) { inTable = true; continue; }
      if (!inTable || !cells[0] || /^[-: ]+$/.test(cells[0])) continue;
      const raw = cells[0];
      const name = raw.replace(/[?*]/g, '').trim();
      if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name) || ['payload_json', 'tts'].includes(name)) continue;
      const nullable = /All parameters to this endpoint are optional and nullable/i.test(section);
      const type = `${nullable && !cells[1]?.startsWith('?') ? '?' : ''}${cells[1] ?? 'JSON'}`;
      if (!fields[target].some(field => field.name === name)) fields[target].push({ name, type, required: !raw.includes('?') && !/All JSON params are optional|All parameters (?:to this endpoint )?are optional/i.test(section) && !/^Modify |^Edit /.test(title), description: cells.slice(2).join(' | ') });
    }
    const audio = /soundboard|voice-message|Send Soundboard/i.test(`${file} ${title}`);
    const disabled = title === 'Batch Edit Application Command Permissions';
    const outside = file === 'resources__lobby.md' || /Group DM|Current User Connections/.test(title);
    const deprecated = /deprecated/i.test(title) || /deprecated in favor/i.test(section);
    const auth = /Edit Application Command Permissions|Current User Application Role Connection|Current Authorization Information|Get Current User Guild Member/.test(title) ? 'oauth2' : /\/webhooks\/.*token|\/interactions\//.test(path) ? 'handle' : 'bot';
    const group = file.replace(/^(resources|interactions)__/, '').replace(/\.md$/, '').replaceAll('-', '_');
    const id = `${group}_${slug(title).replaceAll('-', '_')}`;
    const shortName = slug(title).replaceAll('-', '_').replaceAll('application', 'app');
    const aliases = { 'Create Message': 'messages_create', 'Get Channel Messages': 'messages_list', 'Get Channel Message': 'messages_get', 'Edit Message': 'messages_edit', 'Delete Message': 'messages_delete' };
    entries.push({ id, kind: 'rest', title, method: route[1], path, source: `${source}#${slug(title)}`, auth, permissions: [...new Set([...section.matchAll(/`((?:MANAGE|SEND|VIEW|READ|CREATE|USE|ADD|MODERATE|KICK|BAN|MENTION|CONNECT|MOVE|MUTE|DEAFEN|REQUEST|SET)_[A-Z_]+)`/g)].map(match => match[1]))].sort(), intents: [], conditions: [...new Set([...section.matchAll(/(?:requires?|only available|must have)[^.\n]+/gi)].map(match => clean(match[0])))].slice(0, 6), status: audio || disabled || outside || deprecated ? 'excluded' : auth === 'bot' ? 'implemented' : 'conditional', reason: audio ? 'Audio playback, soundboard and voice messages are excluded by product scope.' : disabled ? 'Discord documents this endpoint as disabled or removed.' : outside ? 'Social SDK lobbies and user-only connections/group DMs are outside the bot/application surface.' : deprecated ? 'Replaced by the documented current endpoint; legacy duplicate routes are excluded.' : null, tool: audio || disabled || outside || deprecated ? null : `discord_${aliases[title] ?? shortName}`, fields, arrayBody: /Bulk Overwrite|Modify Guild (?:Channel|Role) Positions|Update Application Role Connection Metadata Records/i.test(title), multipart: /multipart\/form-data/.test(section), audit: /audit.log.reason/i.test(section) });
  }
}
const eventFiles = ['events__gateway-events.md', 'events__webhook-events.md'];
for (const file of eventFiles) {
  const text = await readFile(`.cache/reference/${file}`, 'utf8');
  for (const match of text.matchAll(/^(?:#### |### (?=Request Channel Info))([^\n]+)\n([\s\S]*?)(?=^#{2,4} |$(?![\s\S]))/gm)) {
    const title = match[1];
    const body = match[2];
    const name = title.toUpperCase().replaceAll(/[^A-Z0-9]+/g, '_');
    if (!name || /OBJECT|STRUCTURE|EXAMPLE|PAYLOAD/.test(name)) continue;
    const audio = /SOUNDBOARD|VOICE_SERVER|VOICE_CHANNEL_EFFECT/.test(name);
    const social = /^(?:LOBBY_|GAME_DIRECT_|QUEST_)/.test(name);
    const sending = file.includes('gateway') && match.index < text.indexOf('## Receive Events');
    const internal = sending && /^(?:IDENTIFY|RESUME|HEARTBEAT|UPDATE_VOICE_STATE)$/.test(name) || !sending && /^(?:HELLO|RECONNECT|INVALID_SESSION)$/.test(name);
    const tool = sending ? ({ REQUEST_GUILD_MEMBERS: 'discord_gateway_request_members', UPDATE_PRESENCE: 'discord_gateway_update_presence', REQUEST_CHANNEL_INFO: 'discord_gateway_request_channel_info' })[name] : 'discord_events_poll';
    entries.push({ id: `${file.includes('webhook') ? 'webhook' : 'gateway'}_${name.toLowerCase()}`, kind: file.includes('webhook') ? 'webhook' : 'gateway', title, event: name, source: `https://docs.discord.com/developers/${file.replace('__', '/').replace('.md', '')}#${slug(title)}`, auth: 'bot', permissions: [], intents: [...new Set([...body.matchAll(/`((?:GUILD|DIRECT|MESSAGE|AUTO_MODERATION)[A-Z_]+)`/g)].map(match => match[1]))], conditions: file.includes('webhook') ? ['A public HTTPS webhook URL and an application public key are required.'] : ['The configured Gateway intents and Discord permissions apply.'], status: audio || social || internal ? 'excluded' : 'implemented', reason: audio ? 'Audio transport and soundboard are excluded by product scope.' : social ? 'Social SDK and partner quest events are outside the bot/application surface.' : internal ? 'Connection lifecycle is managed internally; bot audio connection changes are excluded.' : null, tool: audio || social || internal ? null : tool });
  }
}
for (const entry of entries.filter(entry => entry.kind === 'rest')) {
  const inherit = ({ 'Bulk Overwrite Global Application Commands': 'Create Global Application Command', 'Modify Webhook with Token': 'Modify Webhook', 'Edit Original Interaction Response': 'Edit Webhook Message', 'Edit Followup Message': 'Edit Webhook Message', 'Create Followup Message': 'Execute Webhook' })[entry.title];
  if (inherit) {
    const parent = entries.find(item => item.title === inherit);
    entry.fields.body = parent.fields.body.filter(field => !['username', 'avatar_url', 'thread_name', 'applied_tags'].includes(field.name));
    entry.multipart ||= parent.multipart;
  }
  if (entry.fields.body.some(field => field.type === 'file')) entry.multipart = true;
  if (entry.status !== 'excluded' && /requires? (?:the )?`[^`]+` (?:OAuth2 )?scope/i.test(entry.conditions.join(' '))) entry.status = 'conditional';
}
for (const entry of entries.filter(entry => entry.kind === 'webhook' && entry.status !== 'excluded')) entry.status = 'conditional';
const unique = [...new Map(entries.map(entry => [entry.id, entry])).values()];
await mkdir('src/reference', { recursive: true });
await writeFile('src/reference/discord.json', JSON.stringify({ reviewedAt: '2026-10-20', documents, entries: unique }, null, 2) + '\n');
console.log(JSON.stringify({ routes: unique.filter(entry => entry.kind === 'rest').length, events: unique.filter(entry => entry.kind !== 'rest').length, excluded: unique.filter(entry => entry.status === 'excluded').map(entry => entry.title) }, null, 2));
