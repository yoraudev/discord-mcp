# Live validation results

Validation date: 2026-10-20. Tests used one operator-provided bot in an explicitly selected disposable guild through a real MCP stdio client. Credentials and detailed sanitized reports remain in ignored local files.

Across completed scenarios, 124 distinct registered tools had a recorded passing outcome. This includes explicit expected-error checks for uninitialized command permissions and an absent bot voice state; it does not mean every call returned HTTP success or that all 220 registered tools were tested live.

## Results

| Area | Observed result |
| --- | --- |
| Automated lifecycle | 81 successful calls, no failures in the corrected run; messages, uploads, reactions, pins, polls, channels, threads, permissions, roles, invites, webhooks, commands, scheduled events, emoji, stickers, disabled AutoMod and Gateway requests |
| Authorized member moderation | 23 successful calls; role assignment/removal, nickname restoration, timeout removal, kick, ban without deleting messages, unban and confirmed rejoin |
| Interaction callbacks | Button defer, slash-command defer, modal opening/submission, autocomplete and final search submission observed; original and followup response operations passed |
| Focused search regression | Autocomplete and final command submission both passed after adding the submission response rule; temporary resources removed |
| OAuth2 | Browser consent, authorized identity, temporary command permission write/read round-trip and token revocation passed; temporary command and channels removed |
| Read-only matrix | 36 passed, no failed operations and five unmet-feature skips in the final run; missing bot voice state is an expected Discord error rather than a successful voice connection |
| Cleanup | Completed lifecycle, moderation and interaction runs removed their recorded temporary objects; baseline channel metadata comparison passed |
| Offline checks | 25 tests passed, including HTTP contracts, retries, interaction deadlines, event gaps, OAuth2 state/refresh/revocation, webhook signatures, isolation guards and real MCP stdio integration |
| Distribution | Tarball installed successfully into a separate local directory; installed MCP server completed the stdio initialization handshake |

The `gifs` channel was not modified. No pre-existing channel was edited or deleted. The initial read-only matrix included a guild-wide message-search request; no message payload was printed or retained in its report. The reusable matrix now excludes guild-wide message search and existing-channel reads.

## Corrections found during validation

Reference extraction previously made optional invite targets, webhook content alternatives and emoji role restrictions mandatory. The generator now honors explicit Required/Default columns and endpoint-wide optionality, with regression contracts for minimal request bodies. Generated schemas and the tool catalog were updated together.

The first interactive harness answered autocomplete but did not complete the final search command. The harness now has a separate immediate submission rule and checks both interactions. This behavior passed offline regression coverage and a focused live rerun.

The initial OAuth2 permission test sent an empty override list, after which the permission read returned Discord `10066`. The corrected test writes an explicit override for its own temporary channel, reads and verifies it, then deletes the temporary command. That full round-trip passed without changing existing command permissions.

The first read-only attempt omitted a required member-search query; the runner now supplies one. A later startup attempt failed before the MCP handshake, while REST identity and guild access still worked; one retry completed the full read-only matrix successfully. The startup failure's exact Gateway cause was not established.

## Remaining conditions

Live results do not certify every registered tool or every permission combination. The test guild lacks Community, discovery, vanity URL and widget prerequisites. Community-only forum/Stage/onboarding scenarios were not enabled by changing existing guild settings. Monetization eligibility, other application-specific features and real voice-member move/mute/deafen scenarios require separate eligible resources.

Public Discord webhook delivery was not tested because no public HTTPS forwarding endpoint or application public key was configured. Signature checks, timestamp rejection and duplicate suppression passed locally. Gateway reconnect/resume and missing-intent behavior were verified with controlled tests rather than a forced live outage. Live rate-limit and permission-denied responses were not induced; their HTTP contracts were tested locally.

See [live testing](live-testing.md) for reproducible commands and isolation boundaries, and the [coverage inventory](coverage.md) for implementation coverage rather than live certification.
