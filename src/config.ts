import { GatewayIntentBits } from 'discord.js';

export interface Config {
  token?: string;
  applicationId?: string;
  clientSecret?: string;
  redirectUri: string;
  publicKey?: string;
  webhookPort?: number;
  eventCapacity: number;
  intents: number[];
  offline: boolean;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const names = (env.DISCORD_INTENTS ?? 'Guilds,GuildMessages,GuildMessageReactions,DirectMessages,DirectMessageReactions,GuildVoiceStates,GuildScheduledEvents').split(',').filter(Boolean);
  const intents = names.map(name => {
    const value = GatewayIntentBits[name as keyof typeof GatewayIntentBits];
    if (typeof value !== 'number') throw new Error(`Unknown Gateway intent: ${name}`);
    return value;
  });
  const capacity = Number(env.DISCORD_EVENT_CAPACITY ?? 10000);
  if (!Number.isSafeInteger(capacity) || capacity < 1 || capacity > 100000) throw new Error('DISCORD_EVENT_CAPACITY must be an integer from 1 to 100000.');
  const port = env.DISCORD_WEBHOOK_PORT ? Number(env.DISCORD_WEBHOOK_PORT) : undefined;
  if (port !== undefined && (!Number.isInteger(port) || port < 1 || port > 65535)) throw new Error('Invalid DISCORD_WEBHOOK_PORT.');
  const redirectUri = env.DISCORD_OAUTH_REDIRECT_URI ?? 'http://127.0.0.1:8765/oauth/callback';
  const redirect = new URL(redirectUri);
  if (redirect.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(redirect.hostname) || !redirect.port) throw new Error('OAuth redirect must be a registered loopback HTTP URL with an explicit port.');
  if (env.DISCORD_PUBLIC_KEY && !/^[a-f\d]{64}$/i.test(env.DISCORD_PUBLIC_KEY)) throw new Error('DISCORD_PUBLIC_KEY must be a 32-byte hexadecimal Ed25519 key.');
  if (port && !env.DISCORD_PUBLIC_KEY) throw new Error('DISCORD_PUBLIC_KEY is required for webhook events.');
  return { token: env.DISCORD_BOT_TOKEN || undefined, applicationId: env.DISCORD_APPLICATION_ID || undefined, clientSecret: env.DISCORD_CLIENT_SECRET || undefined, redirectUri, publicKey: env.DISCORD_PUBLIC_KEY, webhookPort: port, eventCapacity: capacity, intents, offline: env.DISCORD_MCP_OFFLINE === '1' };
}
