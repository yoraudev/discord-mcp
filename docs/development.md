# Development

Use Node.js 24.17 or newer and npm. Install with `npm ci`, run `npm run check`, then regenerate the tool and coverage documentation with `npm run docs:generate` when schemas change. Tests use mocked Discord transports and a real stdio MCP client; they do not require a token.

The inventory is a reviewed snapshot of official Discord documentation. `npm run reference:sync` downloads ignored source files; `node tools/build-reference.mjs` extracts operations and field tables. Review extraction results, inherited parameter schemas and exclusions before committing. The generator is a maintenance aid, not proof that newly introduced Discord features need no code changes. `npm run coverage:check` requires every in-scope entry to resolve to an implemented handler and checks the generated documents for drift.

## Live validation

Live tests require operator-provided credentials and a disposable guild. They are never run against arbitrary existing servers. Run the built server through an MCP client, then verify this sequence:

The automated runner is `npm run test:live -- --guild-id YOUR_GUILD_ID`, with a matching `DISCORD_TEST_GUILD_ID` in the local environment. It creates a separate category, rejects calls targeting existing channels and preserves `gifs` and its descendants. Existing server configuration and role permissions are not modified. Reports are written under the ignored `.cache` directory.

1. Inspect `discord_status`, guilds and channel listing.
2. Create a temporary text channel; send, retrieve, edit, react to, pin and delete a message with a small attachment.
3. Create a temporary role, assign and remove it from a test account, then delete it. Verify permission-denied behavior with an appropriately restricted bot.
4. Create and close a thread, create and delete an external scheduled event, and verify a deliberate moderation operation on a disposable test account.
5. Register a temporary guild command and a modal/autocomplete rule, trigger them in Discord, poll the interaction and edit its deferred response. Remove the command and rule afterward.
6. Authorize the command-permission OAuth2 scope, edit a test command permission, inspect status and disconnect.
7. If webhook events are enabled, verify the public URL handshake, signed event delivery and invalid-signature rejection.
8. Restart the connection and process, confirm connection status events and stale-cursor rejection, then remove every temporary object created during testing.

Mock test success does not certify live Discord permissions or application eligibility. Record live validation separately when credentials are available.

## Git and release

The public repository is [yoraudev/discord-mcp](https://github.com/yoraudev/discord-mcp), with `main` as its default branch. Commit only on `dev`, using the repository owner's identity and Conventional Commits. Merge `dev` into `main` through a PR and keep `dev`.

Repository rules prevent deletion and force pushes on both persistent branches. `main` requires a PR, resolved review conversations, the Branch policy check and successful Windows/Linux CI with an up-to-date base. The branch-policy job rejects PRs to `main` from any source other than this repository's `dev` branch. No approving review is mandatory, so the owner can merge their own PR after checks pass. Rules apply without a bypass list.

Automatic branch deletion is disabled, and merge commits preserve the shared `dev` history. After a merge, synchronize the local branches with `git fetch origin`, `git switch dev` and `git merge --ff-only origin/main`, then push `dev`. GitHub Actions has read-only default token permissions; the release workflow explicitly grants the contents write permission needed to publish its tarball and checksum. Release tags are protected against deletion and replacement.

CI runs type checking, lint, build, Vitest, inventory consistency, comment-free source/configuration rules and Markdown-link checks on Windows and Linux. Product-path changes merged into `main` trigger release; docs, tests and tools alone do not. Manual dispatch is also supported. The package manifest supplies major/minor version, while existing matching tags determine the next patch version. Release packaging updates version metadata in the workflow checkout, builds a tarball, checks installation and computes SHA-256 before publishing a GitHub Release. Packages are not sent to npm registry.

The initial license follows Opal's attribution and origin-preservation conditions with discord-mcp's project identity. Repository rules are in [AGENTS.md](../AGENTS.md).
