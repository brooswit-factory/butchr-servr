# butchr-servr

Local control panel for Butchr: authorization-scoped remote rule definitions and global briefs, with deployment → session visibility. Built for Bun 1.3.11+. Its green interface shares Butchr’s upstream Rules editor, model and validators through a pinned public source dependency.

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

## Admin login

Open http://127.0.0.1:7731/setup on the service host as the same OS user. On first run, choose and confirm your own password (at least 12 characters, at most 1024 UTF-8 bytes). There is no default password. Setup requires a same-UID loopback peer, exact Host/Origin and a short-lived one-use browser cookie plus CSRF token; it cannot replace an established password. Login is at `/login`, and Log out invalidates the current server-side session. No signup or roles are involved.

Passwords use Bun's automatically salted Argon2id implementation (64MiB, three iterations); only the hash is stored in the private SQLite database. Browser sessions use random 256-bit tokens, stored only as SHA-256 hashes server-side, with HttpOnly, SameSite=Strict, host-only cookies. Sessions survive service restarts, expire after 30 minutes without dashboard keyboard/pointer activity or an administrative write (passive reads/polling do not extend this) and after eight hours absolutely. Login/setup attempts are limited to five per minute and one concurrent password hash; anonymous setup tickets are bounded and expire after ten minutes. Login rotates the browser token and CSRF secret. Explicit logout clears the dashboard; expiry preserves in-memory drafts behind the login screen.

This service binds HTTP loopback only, so cookies intentionally omit Secure for local HTTP compatibility; do not proxy/expose it to LAN or the internet. Cookie scope cannot distinguish ports, so other services running as the same OS user remain within the local trust boundary. Password protection does not defend against a process that already owns this Unix account and can read the private database. No password, session token or authorization key belongs in URLs, logs or source control. Keep runtime backups private as they now include password hashes and active-session records.

Machine bearer keys remain separate: `/v1/register`, `/v1/events`, `/v1/instance-events` and legacy `/v1/connect` use their own authorization and cannot access administrative APIs. Setting a dashboard password does not interrupt existing instance connections.

Implementation references: [Bun password hashing](https://bun.sh/docs/runtime/hashing) and [OWASP session management](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html).

## Security and keys

Create an authorization in the Authorizations dashboard. No default key exists. The dashboard reveals a new 256-bit bearer key once; SQLite stores its SHA-256 hash only. Keys have no automatic expiry in this sprint; revoke an authorization to stop future connections immediately. Connected clients receive revocation-driven stream closure and clear their remote state. Reconnect authentication rejects revoked keys.

A key permits identity registration/heartbeat, bounded operational event upload for its registered sessions, and reading remote rule definitions and the global brief library, through authenticated registration and EventSource streaming (see [protocol](PROTOCOL.md)). It does not grant admin, brief editing, shell execution or fleet control. Anyone holding it can register claimed IDs under that authorization and read those definitions/briefs. No hardware/device attestation is provided. Last-seen timestamps report contact, not guaranteed liveness.

Admin pages/APIs require a loopback connection from the same Unix UID, exact Host and compatible Origin/Fetch Metadata. All administrative APIs additionally require a password-authenticated browser session. Writes require same Origin, JSON and a per-session CSRF token. The Linux/macOS peer UID helper is carried from the existing Butchr implementation; unknown peer ownership fails closed. Do not proxy or expose this service publicly. HTTP is acceptable only for this Codey loopback scope; other hosts/TLS are outside this loopback deployment.

Brief content is displayed as plain text in the server dashboard. Client Markdown rendering must ignore raw HTML and unsafe URLs. Remote IDs include persistent server ID, authorization ID and brief ID, avoiding collisions with local/custom records. Revoking or deleting a server brief never deletes existing independent client copies.

The client registers `{deploymentId, sessionId}` with `Authorization: Bearer <key>` at `/v1/register`. Deployment ID persists; session ID is fresh per process and stable across retries. Server-owned briefs and rules arrive only on `/v1/events` as an initial authoritative snapshot and ordered RFC6902 JSON Patch events. Reconnect explicitly resynchronizes a snapshot. Registration heartbeats maintain first/last contact and deduplicate the authorization/deployment/session tuple; they do not deliver state. There are1000 global briefs (64MB aggregate),1,000 deployments and10,000 sessions per authorization, with a240 requests/minute machine-request limit. Stream/frame/queue bounds and recovery behavior are specified in [PROTOCOL.md](PROTOCOL.md). This is an initial local panel, not a multi-tenant internet service.

## Local operations

Back up the SQLite database while the process is stopped. Restarting preserves server identity, authorizations, hierarchy and briefs. No raw keys, client credentials or runtime data belong in Git. The `runtime/` directory is ignored. Server data and the client credential file require private filesystem permissions. Do not log authorization headers or reveal keys in URLs, process arguments, reports or screenshots.

Implementation uses Bun's SQLite API, React/LaunchPad and the pinned Butchr Rules editor. `src/peer-uid.ts` is adapted from the existing MIT-licensed Butchr same-UID guard, preserving its security checks. This repository contains only the server sprint; Butchr client integration is maintained separately.


## Remote rule semantics

Each authorization has **Rules** and **Deployments** tabs. Rule creation/patches use Butchr's actual validators, full-document parser and catalog, not a parallel schema. New rules start disabled; updates require a reviewed plan bound to the current authorization, definition and revision. Deletion requires a disabled rule and confirmation. Concurrent changes are rejected rather than overwriting another editor. There are at most 100 rules and 8 MB of rule document data per authorization.

The control panel stores configuration and does not hold provider credentials, run provider query previews or execute workers. Scope/agent counts are not measured here. The existing Codey management client stages the full remote source in memory, read-only, separately from local rules; configured enabled state is shown separately from actual execution. No local rules are overwritten, no controller is enabled and existing freezes remain unchanged. Live fleet execution is a separate deployment concern.

Remote references include server, authorization and original rule ID. Updates replace the prior snapshot; deletions vanish on the next successful sync. A malformed snapshot, disconnect, revocation or failed sync clears that remote source without changing local rules. A process restart retains deployment identity and creates a fresh session; reconnecting in the same process retains session identity. Built-in/custom brief handling remains independent.

The shared editor supports Butchr's provider-specific queries, execution modes, agent preferences, permissions, capacity roles and event/notification settings. The server catalog provides the shipped built-in briefs and global remote briefs. Selecting a remote brief copies its current text into the rule; later library edits do not rewrite existing rule instructions. Full custom brief text is also editable. A narrowly anchored server build adaptation supplies storage-accurate review text and the authorization brief selector; the pinned upstream checkout is not changed. Provider-backed query previews explicitly report unavailable instead of contacting Jira, GitHub or other services.


## Session events and local controls

Deployments open a Sessions tab with sessions on the left and event-driven Agents/Status views on the right. Operational snapshots reuse Butchr's existing dashboard checked/unavailable semantics and agent-status vocabulary. Only hashed agent references, status, confirmation times and allowlisted runtime/config/connection fields leave the client; prompts, task titles, paths, terminal contents and secrets are excluded. The dashboard feed is not advertised as a complete fleet census. Event/client/server times and stale/no-event states remain visible.

The authorization index links directly to each Rules page; revocation lives in the authorization's Security tab. Key creation remains available through the collapsed creation form. Revocation stops configuration delivery and new event ingestion without removing historical sessions.

Remote briefs are a server-wide authenticated library. Existing authorization-owned records are transactionally promoted without changing their IDs, names, content or update timestamps. Duplicate names retain distinct IDs and disambiguated selector labels. The old authorizationId input is tolerated for old clients but confers no ownership; the new UI requires no authorization selection. Rules and telemetry remain authorization-scoped. A legacy library above1000 records or64MB fails preflight unchanged instead of deleting data or silently stranding clients.

Butchr's Integrations page owns provider cards and butchr-servr settings. Persistent local master/per-rule controls are stored separately from credentials. Effective remote rule permission is master on AND server enabled AND no local disable. Master off also blocks remote briefs from local consumption while telemetry/transport may continue. Incoming patches/reconnects do not erase local intent. These controls never terminate worker or human sessions; this management runtime still stages rules and keeps controllers off.

When checking a candidate beside a running instance, use `bun scripts/build-web.ts --stage`. It builds only web-dist-next; install its complete assets and entry together during the compatible deployment window. The normal build command also installs the built entry. Never publish runtime databases, backups, credentials or client source in this repository.
