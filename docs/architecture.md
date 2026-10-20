# Architecture

One local process exposes MCP tools over stdio, maintains one Discord Gateway connection, and calls Discord REST API v10. The MCP client supplies the model and decides which tools to invoke. Optional OAuth2 and webhook HTTP listeners bind only to loopback addresses.

```text
MCP client -> tool schemas -> operation registry -> Discord REST v10
                                |                      |
                                +-> OAuth2 session     +-> response + credential handles
Discord Gateway -> interaction acknowledgement -> bounded event queue -> events_poll
Signed HTTP webhook events ---------------------> bounded event queue
```

## Modules

| Module | Responsibility |
| --- | --- |
| Configuration/runtime | Environment validation, dependency wiring and lifecycle |
| Reference/schemas/tools | Reviewed Discord inventory, per-operation schemas, MCP registration and request dispatch |
| REST | JSON and multipart requests, serialized rate-limit coordination, cancellation and errors |
| Gateway/events | discord.js reconnect/resume, raw event capture, bounded history and cursor polling |
| Interactions | Expiring credential handles, automatic acknowledgements and immediate response rules |
| OAuth2 | Loopback authorization-code flow, state verification, refresh and revocation |
| Webhooks | Ed25519 verification, timestamp freshness, payload limits and duplicate suppression |

## Contracts

Each REST tool accepts path arguments at the top level, optional `query`, a typed `body`, optional uploads and an audit reason where Discord supports it. IDs are decimal strings. Nested Discord objects use JSON object schemas with their official field descriptions; Discord validates feature-specific nested constraints. Nullable fields retain null, and omitted properties are not sent. Array-body operations send an array rather than wrapping it in an object.

Reference extraction honors explicit Required and Default columns, endpoint-wide optionality and conditional field groups. Conditional webhook content alternatives are not individually mandatory. Guild emoji role restrictions are optional; omitting them creates an unrestricted emoji.

Responses use MCP structured content with `data`; failures set `isError` and contain a code, message, optional HTTP status and sanitized Discord error details. Discord remains authoritative for permissions, hierarchy and feature eligibility. No generic arbitrary-route tool is exposed.

All REST requests share serialized coordination to prevent conflicting writes and respect response-driven rate limits. Interaction acknowledgements use an independent REST client because callback routes have their own limits and must not wait behind ordinary bot requests. Network failures never automatically retry writes; explicit 429 responses can be retried after Discord's delay. Client cancellation propagates to requests and long polling.

## Events and interactions

Event cursors combine a process identifier and sequence number. Filtering still advances the cursor past examined events. Polling returns at most the requested count and waits at most 30 seconds. Capacity loss is explicit; restart cursors are rejected. The queue and connection lifecycle events do not promise durable delivery or replay across a restart.

Commands and ordinary modal submissions default to ephemeral deferred responses. Components default to deferred message updates. Autocomplete defaults to an empty choice list. Rules are evaluated in insertion order; replacing an existing ID retains its priority. Rules can provide an immediate message, update, defer, modal, autocomplete result or activity launch, subject to Discord's interaction-type restrictions. Interaction tokens expire after 15 minutes; a deferred response cannot later open a modal.

A rule with response type `0` opts into manual initial acknowledgement. It emits the interaction immediately with its deadline so a waiting client can call the initial-response tool within three seconds. Automatic rules are preferable when human/model latency could miss the deadline. An initial-response tool call updates the acknowledgement state after success.

Credentials are stored in environment variables or process memory. Responses and events remove token fields; webhook creation returns a handle. OAuth scopes and expiry are visible without exposing tokens. Shutdown closes Gateway connections and optional HTTP listeners.

## Completeness

The reviewed reference includes official source links and document hashes. The inventory records current REST operations, Gateway send/receive events and webhook events. The coverage check compares every supported operation with an actual registered tool and validates generated documentation. Exclusions must name a concrete product or upstream restriction. See [coverage](coverage.md) and [tools](tools.md).
