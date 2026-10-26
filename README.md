# butchr-servr

Local control panel for Butchr: authorization-scoped remote rule definitions and briefs, with deployment → session visibility. Built for Bun 1.3.11+. Its green interface shares Butchr’s upstream Rules editor, model and validators through a pinned public source dependency.

```sh
git clone --branch codex/first-control-panel --recurse-submodules https://github.com/brooswit-factory/butchr-servr.git
cd butchr-servr
bun install --frozen-lockfile --ignore-scripts
bun run typecheck
bun run test
bun run build:web
bun start
```

For an existing checkout, run `git submodule update --init --recursive` first. The submodule is pinned to public Butchr revision `683d8982e40b585bac975bb6661d4b98d08edfe4`; no adjacent checkout, local dependency symlink, provider credentials or runtime files are required. Dependencies are explicitly declared at this repository root and locked in `bun.lock`. The root test script runs only this server's tests, not the upstream factory suite. Builds retain prior hashed assets for open tabs and emit third-party license notices.

Open http://127.0.0.1:7731. Hosting is **loopback only**. `BUTCHR_SERVR_PORT` changes the loopback port; `BUTCHR_SERVR_DB` changes the SQLite path (default `runtime/control.sqlite`). Keep that directory private. Tests use memory-only generated keys or an explicitly nonsecret mock in disposable temporary databases.

## Security and keys

Create an authorization in the Authorizations dashboard. No default key exists. The dashboard reveals a new 256-bit bearer key once; SQLite stores its SHA-256 hash only. Keys have no automatic expiry in this sprint; revoke an authorization to stop future connections immediately. Connected clients receive revocation-driven stream closure and clear their remote state. Reconnect authentication rejects revoked keys.

A key permits only identity registration/heartbeat and reading remote rule definitions and briefs assigned to its authorization, through authenticated registration and EventSource streaming (see [protocol](PROTOCOL.md)). It does not grant admin, brief editing, shell execution or fleet control. Anyone holding it can register claimed IDs under that authorization and read those definitions/briefs. No hardware/device attestation is provided. Last-seen timestamps report contact, not guaranteed liveness.

Admin pages/APIs require a loopback connection from the same Unix UID, exact Host and compatible Origin/Fetch Metadata. Writes require same Origin, JSON and a per-process CSRF token. The Linux/macOS peer UID helper is carried from the existing Butchr implementation; unknown peer ownership fails closed. Do not proxy or expose this service publicly. HTTP is acceptable only for this Codey loopback scope; other hosts/TLS/authentication are future work.

Brief content is displayed as plain text in the server dashboard. Client Markdown rendering must ignore raw HTML and unsafe URLs. Remote IDs include persistent server ID, authorization ID and brief ID, avoiding collisions with local/custom records. Revoking or deleting a server brief never deletes existing independent client copies.

The client registers `{deploymentId, sessionId}` with `Authorization: Bearer <key>` at `/v1/register`. Deployment ID persists; session ID is fresh per process and stable across retries. Server-owned briefs and rules arrive only on `/v1/events` as an initial authoritative snapshot and ordered RFC6902 JSON Patch events. Reconnect explicitly resynchronizes a snapshot. Registration heartbeats maintain first/last contact and deduplicate the authorization/deployment/session tuple; they do not deliver state. There are100 briefs,1,000 deployments and10,000 sessions per authorization, with a240 requests/minute machine-request limit. Stream/frame/queue bounds and recovery behavior are specified in [PROTOCOL.md](PROTOCOL.md). This is an initial local panel, not a multi-tenant internet service.

## Local operations

Back up the SQLite database while the process is stopped. Restarting preserves server identity, authorizations, hierarchy and briefs. No raw keys, client credentials or runtime data belong in Git. The `runtime/` directory is ignored. Server data and the client credential file require private filesystem permissions. Do not log authorization headers or reveal keys in URLs, process arguments, reports or screenshots.

Implementation uses Bun's SQLite API, React/LaunchPad and the pinned Butchr Rules editor. `src/peer-uid.ts` is adapted from the existing MIT-licensed Butchr same-UID guard, preserving its security checks. This repository contains only the server sprint; Butchr client integration is maintained separately.


## Remote rule semantics

Each authorization has **Rules** and **Deployments** tabs. Rule creation/patches use Butchr's actual validators, full-document parser and catalog, not a parallel schema. New rules start disabled; updates require a reviewed plan bound to the current authorization, definition and revision. Deletion requires a disabled rule and confirmation. Concurrent changes are rejected rather than overwriting another editor. There are at most 100 rules and 8 MB of rule document data per authorization.

The control panel stores configuration and does not hold provider credentials, run provider query previews or execute workers. Scope/agent counts are not measured here. The existing Codey management client stages the full remote source in memory, read-only, separately from local rules; configured enabled state is shown separately from actual execution. No local rules are overwritten, no controller is enabled and existing freezes remain unchanged. Live fleet execution is a separate deployment concern.

Remote references include server, authorization and original rule ID. Updates replace the prior snapshot; deletions vanish on the next successful sync. A malformed snapshot, disconnect, revocation or failed sync clears that remote source without changing local rules. A process restart retains deployment identity and creates a fresh session; reconnecting in the same process retains session identity. Built-in/custom brief handling remains independent.

The shared editor supports Butchr's provider-specific queries, execution modes, agent preferences, permissions, capacity roles and event/notification settings. The server catalog provides the shipped built-in briefs and remote briefs assigned to this authorization. Selecting a remote brief copies its current text into the rule; later library edits do not rewrite existing rule instructions. Full custom brief text is also editable. A narrowly anchored server build adaptation supplies storage-accurate review text and the authorization brief selector; the pinned upstream checkout is not changed. Provider-backed query previews explicitly report unavailable instead of contacting Jira, GitHub or other services.
