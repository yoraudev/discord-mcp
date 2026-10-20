# Development

Use Node.js 24.17 or newer and npm. Install with `npm ci`, run `npm run check`, then regenerate the tool and coverage documentation with `npm run docs:generate` when schemas change. Tests use mocked Discord transports and a real stdio MCP client; they do not require a token.

The inventory is a reviewed snapshot of official Discord documentation. `npm run reference:sync` downloads ignored source files; `node tools/build-reference.mjs` extracts operations and field tables. Review extraction results, inherited parameter schemas and exclusions before committing. The generator is a maintenance aid, not proof that newly introduced Discord features need no code changes. `npm run coverage:check` requires every in-scope entry to resolve to an implemented handler and checks the generated documents for drift.

## Live validation

Live tests require operator-provided credentials and a disposable guild. They are never run against arbitrary existing servers. Run the built server through an MCP client, then verify this sequence:

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

Commit only on `dev`, using the repository owner's identity and Conventional Commits. Merge `dev` into `main` through a PR and keep `dev`. Before publishing, configure GitHub branch protection to require the CI check, allow Actions to create releases, and retain the `GITHUB_TOKEN` permissions in the release workflow. No remote repository or hosting is created automatically.

CI runs type checking, lint, build, Vitest, inventory consistency, comment-free source/configuration rules and Markdown-link checks on Windows and Linux. Product-path changes merged into `main` trigger release; docs, tests and tools alone do not. Manual dispatch is also supported. The package manifest supplies major/minor version, while existing matching tags determine the next patch version. Release packaging updates version metadata in the workflow checkout, builds a tarball, checks installation and computes SHA-256 before publishing a GitHub Release. Packages are not sent to npm registry.

The initial license follows Opal's attribution and origin-preservation conditions with discord-mcp's project identity. Repository rules are in [AGENTS.md](../AGENTS.md).
