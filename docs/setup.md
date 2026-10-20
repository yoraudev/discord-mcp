# Setup

## Bot and intents

Create a bot in the [Developer Portal](https://discord.com/developers/applications). Keep its token in `DISCORD_BOT_TOKEN`, and configure `DISCORD_APPLICATION_ID` when using OAuth2. Generate an installation URL with the `bot` and `applications.commands` scopes and the permissions needed for your intended operations. Invite the bot to a disposable server before testing administration tools.

Permission requirements are listed for each operation in the [coverage inventory](coverage.md). Role hierarchy still applies: bot role management, kicks, bans and member changes can fail even when permission bits are granted. Missing Discord permissions produce structured API errors rather than a successful-looking empty response.

`DISCORD_INTENTS` uses comma-separated discord.js intent names. Defaults are `Guilds,GuildMessages,GuildMessageReactions,DirectMessages,DirectMessageReactions,GuildVoiceStates,GuildScheduledEvents`. To read general message content, also request `MessageContent`. Member requests need `GuildMembers`; presence data needs `GuildPresences`. Enable privileged intents in the portal and obtain Discord approval where required before requesting them. Invalid intent names fail configuration validation.

To receive moderation, typing, webhook, invite, integration, emoji/sticker, poll and AutoMod events, add their corresponding intent names. The example environment file includes the broad bot intent set; enabling all of it requires the appropriate portal settings. Voice-state events support member administration; the bot never joins an audio session.

## OAuth2

Set `DISCORD_CLIENT_SECRET` and register the exact `DISCORD_OAUTH_REDIRECT_URI` in the portal. The default is `http://127.0.0.1:8765/oauth/callback`. Only loopback HTTP callbacks with an explicit port are accepted. The callback listener starts when `discord_oauth_begin` is called.

Call `discord_oauth_begin` with the necessary scopes, open its returned authorization URL, then inspect `discord_oauth_status`. The state is single-use and expires after ten minutes. Authorization-code exchanges and refreshes stay inside the process. `discord_oauth_disconnect` revokes the token before clearing the local session.

| Scope | Use |
| --- | --- |
| `applications.commands.permissions.update` | Edit a guild command's permissions as an authorized user |
| `guilds.join` | Add the authorized user to a guild using the bot endpoint |
| `guilds.members.read` | Read the authorized user's guild membership |
| `role_connections.write` | Read/update/delete the authorized user's application role connection |
| `application_identities.write` | Authorize application identity profile updates for that user |
| `identify` | Basic identity authorization and session diagnostics |

Only one user OAuth2 session is active at a time. A new successful authorization replaces it. OAuth2 grants no additional bot permissions and does not bypass role hierarchy. Discord can require additional application eligibility for identity and monetization operations.

## Interactions

Receive interactions through the Gateway; do not configure a competing interaction HTTP endpoint. Default acknowledgement happens before the event is exposed to polling. To open a modal, install a `discord_interaction_rules_set` rule matching command type `2` or component type `3` with response type `9` and the modal's title, custom ID and components. For autocomplete, match interaction type `4` and return response type `8` with `choices`.

An interaction event contains `interaction_handle`. Pass it to original-response or followup tools; never supply an interaction token. Rule responses follow the [official callback types](https://docs.discord.com/developers/interactions/receiving-and-responding). Inputs are declarative JSON; rules cannot run code.

Response type `0` is a local rule option for manual acknowledgement. It does not send a Discord callback. The client must be polling already and call the initial-response tool before the event's three-second deadline; otherwise the interaction expires. Default automatic acknowledgements remain enabled for every interaction that does not match such a rule.

## Webhook events

Set the application's hexadecimal `DISCORD_PUBLIC_KEY` and a `DISCORD_WEBHOOK_PORT` distinct from the OAuth callback port. Forward a public HTTPS endpoint through a reverse proxy to `http://127.0.0.1:PORT/discord/events`, then register it under the application's webhook-event settings. Public hosting is supplied by the operator.

The receiver validates Ed25519 signatures over the timestamp and raw body, rejects timestamps older than five minutes, acknowledges Discord PING requests, limits request size and suppresses repeated signed payloads. Webhook events appear in `discord_events_poll` with source `webhook`. They may arrive late or out of order.
