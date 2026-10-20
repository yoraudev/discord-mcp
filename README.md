# discord-mcp

Control a Discord bot from an AI model through Model Context Protocol. Each supported Discord operation has its own tool, with validated inputs, structured results and links to the official Discord reference.

The server runs locally over stdio and controls one bot across all the servers it can access. The AI model runs in your MCP client.

## Install

Install Node.js 24.17 or newer. Download the `.tgz` package from a GitHub Release, then install it, replacing `VERSION` with the downloaded version:

```bash
npm install -g ./yoraudev-discord-mcp-VERSION.tgz
```

Releases are published after product changes merge from `dev` into `main`. There is no npm registry publication. Until a remote repository and its first release exist, build from this checkout:

```bash
npm ci
npm run build
```

## Connect

Create an application and bot in the [Discord Developer Portal](https://discord.com/developers/applications), invite it to your server, and add this entry to your MCP client's configuration:

```json
{
  "mcpServers": {
    "discord": {
      "command": "discord-mcp",
      "env": {
        "DISCORD_BOT_TOKEN": "YOUR_BOT_TOKEN",
        "DISCORD_APPLICATION_ID": "YOUR_APPLICATION_ID"
      }
    }
  }
}
```

For a source checkout, use `node` as the command and the absolute path to `dist/index.js` as its argument. Windows clients that cannot resolve a global npm command can also launch `node` with the installed package's absolute entrypoint. Credentials belong in environment variables. `.env` is loaded by `npm start`; other launchers must explicitly pass environment variables or Node's env-file option.

Ask your model to inspect `discord_status`, list channels, send a message, manage roles, configure application commands, or read events using `discord_events_poll`. The complete [tool catalog](docs/tools.md) is produced from the registered input schemas.

## Capabilities

| Area | Operations |
| --- | --- |
| Messaging | Messages, replies, forwards, attachments, embeds, components, reactions, pins, polls and bot DMs |
| Channels | Text, voice and Stage channel management, forums, media channels, threads, permissions, invites and typing |
| Servers | Members, roles, moderation, bans, AutoMod, audit logs, integrations, onboarding, templates and settings |
| Assets and events | Guild/application emoji, stickers, scheduled events and Stage instances |
| Applications | Global/guild commands, command permissions, interaction responses, metadata, linked roles, identity profiles and supported monetization endpoints |
| Gateway | Presence, member requests, channel information, received events, reconnect/resume and connection-gap reports |
| Webhooks | Incoming webhooks and an optional signed receiver for Discord application events |

Features remain subject to Discord permissions, role hierarchy, intents, application eligibility and documented API restrictions. See the [coverage inventory](docs/coverage.md), [setup guide](docs/setup.md) and [architecture](docs/architecture.md).

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `DISCORD_BOT_TOKEN` | Required | Bot authentication |
| `DISCORD_APPLICATION_ID` | Detected after login | Application path parameters and OAuth2 client ID |
| `DISCORD_INTENTS` | Non-privileged messaging, channel and event intents | Comma-separated discord.js intent names; see the setup guide |
| `DISCORD_EVENT_CAPACITY` | `10000` | Maximum retained events, from 1 to 100000 |
| `DISCORD_CLIENT_SECRET` | Unset | Enables optional OAuth2 authorization |
| `DISCORD_OAUTH_REDIRECT_URI` | `http://127.0.0.1:8765/oauth/callback` | Registered loopback OAuth2 callback |
| `DISCORD_PUBLIC_KEY` | Unset | Application Ed25519 public key for webhook verification |
| `DISCORD_WEBHOOK_PORT` | Unset | Opt-in listener on `127.0.0.1`, path `/discord/events` |
| `DISCORD_MCP_OFFLINE` | Unset | Set `1` for credential-free schema inspection and tests; Discord operations cannot succeed |

## Good to know

- Audio connections, playback, recording, receiving, TTS, soundboard and voice messages are excluded. Voice/Stage channel administration and member move/mute/deafen operations are supported.
- OAuth2, event history, webhook handles and interaction rules live in memory and reset when the process ends. Keep the MCP client connected to receive events.
- Poll with the last returned cursor. A `gap` reports overwritten events; cursors from a previous process are rejected. Discord reconnect events report possible delivery gaps.
- Deferrable interactions are acknowledged automatically. Configure immediate modal/autocomplete rules before users trigger them. Use the interaction handle from the event to edit the original response or send followups.
- Webhook tokens returned by Discord are replaced with `webhook_handle`; interaction tokens are replaced with `interaction_handle`. Handles expire and cannot be reused after a restart.
- The webhook receiver needs a public HTTPS reverse proxy to reach the local port. Hosting and tunnels are not created by this project.
- Discord user-account automation, group DMs, Social SDK lobbies and discontinued duplicate endpoints are outside the bot/application surface. These exclusions are recorded individually in the inventory.

## Development

```bash
npm ci
npm run check
npm run docs:generate
npm pack
```

Use `npm run reference:sync` to refresh the ignored official-document cache, then `node tools/build-reference.mjs` to rebuild the reviewed inventory. Review the inventory and schema overrides before accepting upstream changes. Reference updates must include regenerated documentation and contract tests.

Work is committed to `dev`. `main` changes through pull requests from `dev`; keep `dev` after merging. Configure remote branch protection to require the CI job. Documentation-only and test-only merges do not publish a release. GitHub Actions can also publish a release through **Run workflow**.

The [development guide](docs/development.md) describes validation, live Discord testing and release setup. Follow [AGENTS.md](AGENTS.md) when changing the project.

## License

Free to use, modify and redistribute under the project's attribution and origin-preservation conditions. See [LICENSE](LICENSE).
