# Isolated live testing

The live runner connects a real MCP stdio client to the built server and exercises supported Discord operations with an operator-provided test bot. It is opt-in and is not part of CI or `npm test`.

Recorded outcomes and remaining prerequisites are in [live validation results](live-test-results.md).

## Run

Set the bot credentials, application ID and `DISCORD_TEST_GUILD_ID` in the ignored local `.env`. Enable the configured intents in the Discord application settings and invite the bot to that guild. Build the source, then run:

```bash
npm run build
npm run test:live -- --guild-id YOUR_GUILD_ID
```

The command-line guild ID must match the environment value. Tokens are never printed. Each run writes a sanitized JSON report to `.cache/live-test-RUN_ID.json`, including tool outcomes, skipped prerequisites and cleanup results.

For separately authorized member moderation, set `DISCORD_TEST_MEMBER_ID` and run `node --env-file=.env tools/live-moderation.mjs --guild-id YOUR_GUILD_ID`. The member must be a non-owner human with no existing roles or timeout. This checks role assignment/removal, nickname changes, timeout removal, kick, ban without message deletion and unban. It provides a short-lived invite and waits up to five minutes for the test account to rejoin before removing its temporary category. Browser automation and user tokens are not used to impersonate the account.

For interactive callbacks and optional OAuth2, run `node --env-file=.env tools/live-interactions.mjs --guild-id YOUR_GUILD_ID`. It creates three temporary guild commands and a button in its own test channel. The operator triggers ping, modal submission, autocomplete and search submission, then grants OAuth2 consent as a user allowed to manage guild command permissions. Search submission has its own immediate response rule and is tracked separately from autocomplete. Register the configured loopback redirect in the Developer Portal first. The runner records observed acknowledgements, original/followup response operations and permission editing, revokes its OAuth2 grant, and removes its commands and channels. Reports identify incomplete human steps after an eight-minute wait and the process exits unsuccessfully if any required check is incomplete.

Append `--search-only` to retest autocomplete and final search submission independently, without repeating OAuth2 or other interactions. Append `--oauth-only` to test browser authorization and command permissions without repeating manual interaction steps. The permission round-trip uses an explicit allow for the run's own temporary channel on its own temporary command; deleting that command removes the override. These focused modes cannot be combined. Run only one live client for a bot during interactive tests: concurrent Gateway sessions can compete to acknowledge the same interaction.

The read-only matrix is `node --env-file=.env tools/live-readonly.mjs --guild-id YOUR_GUILD_ID`. It exercises bot-authenticated GET operations that require only the chosen guild/application IDs or public catalog paths. Individual existing channels and guild-wide message search are excluded. Known feature-specific endpoints are skipped when their prerequisites are absent, and report payloads contain outcomes/counts rather than existing message content.

## Isolation

The runner first reads channel metadata to establish a protected baseline. Every pre-existing channel is protected from direct test calls, including message reads. Channels named `gifs` and their known descendants are explicitly recorded in the report; unlisted threads are protected because they are not owned by the run.

Mutations use an explicit operation allowlist. A unique `mcp_test_RUN_ID_` prefix identifies newly created objects. All test text and voice channels belong to a new category. Individual message, role, webhook, invite, command, event, emoji, sticker and AutoMod calls must target objects registered as created by the current run. Test roles grant no permissions, AutoMod rules stay disabled, and guild settings and existing role permissions are not changed. Cleanup operates from the same ownership ledger in reverse order.

The runner checks channel creation and administration, zero-permission roles and test-channel overwrites, messages and attachments, reactions, pins, threads, bulk deletion, polls, short-lived invites, webhook messages, guild application commands, external scheduled events, emoji, stickers, disabled AutoMod rules and Gateway event delivery/member requests. Audio connections and playback are never opened.

Some scenarios require a separately designated non-owner test member, browser OAuth2 consent, manually triggered interactions, Community features, monetization eligibility or a public signed webhook endpoint. These prerequisites are reported rather than inferred or bypassed. A failed operation stops its dependent checks while independent groups continue; cleanup runs afterward. An initial-response network failure is not automatically replayed.

Protected channel metadata is compared before and after cleanup. A newly registered command can legitimately return Discord error `10066` when its permission overrides have not been initialized; that explicit error-contract check is recorded as an expected result.

Do not treat a passing offline suite or handler inventory as live validation of every tool. Read the report's per-operation outcomes and skipped groups. A process interrupted before cleanup finishes requires reviewing its ownership ledger before resuming cleanup; existing resources must never be selected by name alone.
