import { loadConfig, type Config } from './config.js';
import { DiscordRest } from './rest.js';
import { EventQueue } from './events.js';
import { Vault } from './errors.js';
import { OAuth } from './oauth.js';
import { Interactions } from './interactions.js';
import { Gateway } from './gateway.js';
import { WebhookReceiver } from './webhooks.js';
import { buildTools } from './tools.js';

export function createRuntime(config: Config = loadConfig()) {
  const events = new EventQueue(config.eventCapacity);
  const rest = new DiscordRest(config.token);
  const interactions = new Interactions(new DiscordRest(config.token), events);
  const oauth = new OAuth(config, events);
  const gateway = new Gateway(config, events, interactions);
  const vault = new Vault();
  const webhook = config.webhookPort && config.publicKey ? new WebhookReceiver(events, config.publicKey) : undefined;
  const context = { config, rest, events, interactions, oauth, gateway, vault };
  const tools = buildTools(context);
  return {
    ...context, tools,
    async start(): Promise<void> {
      if (webhook && config.webhookPort) await webhook.listen(config.webhookPort);
      if (!config.offline) await gateway.start();
    },
    async close(): Promise<void> { await Promise.all([webhook?.close(), oauth.close(), gateway.close()]); }
  };
}
