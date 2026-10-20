import { Client, Events, Partials, GatewayIntentBits, ActivityType, type PresenceStatusData } from 'discord.js';
import type { Config } from './config.js';
import type { EventQueue } from './events.js';
import type { Interactions } from './interactions.js';
import { ToolError } from './errors.js';

export class Gateway {
  readonly client: Client;
  private connected = false;

  constructor(private readonly config: Config, private readonly events: EventQueue, private readonly interactions: Interactions) {
    this.client = new Client({ intents: config.intents, partials: [Partials.Channel, Partials.Message, Partials.Reaction, Partials.User, Partials.GuildMember] });
    this.client.on(Events.Raw, packet => {
      if (!packet.t || !packet.d) return;
      if (packet.t === 'INTERACTION_CREATE') {
        void this.interactions.receive(packet.d as unknown as Record<string, unknown>).catch(() => this.events.push('INTERACTION_FAILED', { message: 'Interaction handling failed.' }, 'system'));
      } else if (!/SOUNDBOARD|VOICE_SERVER|VOICE_CHANNEL_EFFECT/.test(packet.t)) this.events.push(packet.t, packet.d);
    });
    this.client.on(Events.ClientReady, () => { this.connected = true; this.events.push('GATEWAY_READY', { user_id: this.client.user?.id }, 'system'); });
    this.client.on(Events.ShardDisconnect, (event, shard_id) => { this.connected = false; this.events.push('GATEWAY_DISCONNECTED', { shard_id, code: event.code, gap_possible: true }, 'system'); });
    this.client.on(Events.ShardReconnecting, shard_id => this.events.push('GATEWAY_RECONNECTING', { shard_id }, 'system'));
    this.client.on(Events.ShardResume, (shard_id, replayed) => { this.connected = true; this.events.push('GATEWAY_RESUMED', { shard_id, replayed }, 'system'); });
    this.client.on(Events.Error, () => this.events.push('GATEWAY_ERROR', { message: 'Discord Gateway error. Check token, intents and connection status.' }, 'system'));
  }

  async start(): Promise<void> {
    if (!this.config.token) throw new ToolError('AUTH_REQUIRED', 'Set DISCORD_BOT_TOKEN before starting the server.');
    await this.client.login(this.config.token);
  }

  status(): Record<string, unknown> {
    return { connected: this.connected, bot_id: this.client.user?.id, application_id: this.config.applicationId ?? this.client.application?.id, guild_count: this.client.guilds.cache.size, configured_intents: this.config.intents, offline: this.config.offline };
  }

  updatePresence(status: PresenceStatusData, activities: { name: string; type: number; url?: string; state?: string }[], afk: boolean): { updated: true } {
    if (!this.client.isReady()) throw new ToolError('GATEWAY_NOT_READY', 'The Discord Gateway is not ready.');
    this.client.user.setPresence({ status, activities: activities.map(activity => ({ ...activity, type: activity.type as ActivityType })), afk });
    return { updated: true };
  }

  async requestMembers(guildId: string, options: { query?: string; limit?: number; presences?: boolean; user_ids?: string[] }): Promise<unknown> {
    if (!this.config.intents.includes(GatewayIntentBits.GuildMembers)) throw new ToolError('INTENT_REQUIRED', 'Enable the GuildMembers privileged intent in the portal and DISCORD_INTENTS.');
    if (options.presences && !this.config.intents.includes(GatewayIntentBits.GuildPresences)) throw new ToolError('INTENT_REQUIRED', 'Enable GuildPresences before requesting member presences.');
    if (!this.client.isReady()) throw new ToolError('GATEWAY_NOT_READY', 'The Discord Gateway is not ready.');
    const guild = await this.client.guilds.fetch(guildId);
    const members = await guild.members.fetch({ query: options.query, limit: options.limit, withPresences: options.presences, user: options.user_ids, time: 15000 });
    return { members: [...members.values()].map(member => member.toJSON()) };
  }

  async close(): Promise<void> { this.connected = false; await this.client.destroy(); }
}
