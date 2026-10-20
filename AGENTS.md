# discord-mcp

## Tech Stack

- **Language:** TypeScript, strict mode, ES modules
- **Runtime:** Node.js 24.17 or newer
- **Protocol:** the official Model Context Protocol TypeScript SDK, stdio transport
- **Discord:** Discord REST API v10 and Gateway through discord.js; no audio transport
- **Validation:** Zod schemas shared by tools, tests and documentation
- **Authentication:** one bot token with optional Discord OAuth2 authorization
- **State:** bounded in-memory event history, interaction handles and OAuth2 sessions
- **Build:** npm with a committed lockfile and TypeScript
- **Tests:** Vitest, HTTP contract tests and MCP stdio integration tests
- **CI / releases:** GitHub Actions; installable npm tarballs in GitHub Releases

## Project Rules

- Every file in the repository is written in English: code, identifiers, user-facing strings, documentation and commit messages.
- Commit messages follow Conventional Commits: `type(scope): description`, with types such as `feat`, `fix`, `chore`, `docs`, `refactor`, `test` and `ci`. Mark breaking changes with `!` after the type. Keep the subject line short and make it the best single description of the change; put the details in the commit body, written out in full.
- Commit to the `dev` branch. `main` is protected and changes only by merging a pull request from `dev`, which publishes a release when it touches runtime sources, the package manifest, the lockfile or build configuration; never push to `main` directly. Keep `dev` after merging. Branch protection must be configured on the remote repository before the first merge.
- Commits, pull requests and anything else published to the repository carry only the repository owner's name and email. Never add AI or tool attribution: no `Co-Authored-By` trailers, no "Generated with" lines, no assistant names as author or committer.
- Do not write comments. Every hand-written file (anything that is not auto-generated) stays free of code comments, including config files such as YAML and `.gitattributes`.
- Whenever something is added to, changed in, or removed from the project, every `.md` file that references it must be updated in the same change.
