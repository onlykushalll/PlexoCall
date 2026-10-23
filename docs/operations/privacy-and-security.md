# Privacy and security boundaries

This describes the current private-alpha implementation. It is a factual map of the code, not a claim that the service has completed an independent security review.

## Data and retention

| Data | Where it goes | Current handling |
|---|---|---|
| Invite secret | Invite URL, Electron main process, control API request | High-entropy bearer secret derived from a random per-attempt client key and the server secret; the control API stores only its SHA-256 hash. Links expire after 12 hours or when the creator ends the room. Anyone holding the link can attempt to join. |
| Owner secret and saved invite | Control API response, Electron main process | Owner bearer capability and invite secret are derived from the random per-attempt client key and server secret; the API stores only their SHA-256 hashes. The desktop encrypts owner-session records with Electron `safeStorage` on Windows (DPAPI), allowing the home screen to reopen or end managed calls after app restart. The renderer receives only an opaque local session ID. |
| Participant token | Electron main and renderer, LiveKit server | Room-scoped, permits publishing/subscribing, and expires after two minutes. It is not stored in the database. A two-minute token may be exchanged for a new token through the API while the invite remains valid. |
| Display name | Electron renderer, API request, LiveKit token/participant state | Not stored in PostgreSQL. The creator chooses a display name; participants in a room can see it. The user's convenience copy is kept in local browser storage. |
| Call metadata | PostgreSQL | Call UUID, opaque LiveKit room name, invite/owner secret hashes, hashed create retry key, HMAC fingerprint of the original display name, creation/expiry/revocation/room-close/final-close timestamps. Finalized closed rows are purged after seven days. |
| Rate-limit bucket | PostgreSQL | HMAC of the client IP and route scope, hit count, and fixed-window timestamps. Expired buckets are deleted after a one-hour retention margin. The HMAC hides raw addresses in this table; Fastify operational logs may still include the request IP. |
| Media | Participants and LiveKit SFU | WebRTC encrypts media in transit. The SFU is trusted with live media unless a future app-level E2EE key lifecycle is implemented. No recording or transcription path is present. |
| Network logs | Control API stdout/container logs | Fastify request logs may include remote address, method, path, status, and timing. Secrets are sent in request bodies rather than URL parameters and request bodies are not deliberately logged. Operators set log collection and retention. |

The creator's encrypted owner data is protected from other Windows users, but Electron's documented DPAPI storage is not protection against malware running as the same Windows user. Do not share a Windows account with someone you do not trust.

## Trust boundaries

1. **Renderer:** context isolation, sandbox, no Node integration, and a small preload API. IPC handlers check the current app window, main frame, and trusted URL. The renderer still handles the LiveKit participant token because the WebRTC SDK runs there.
2. **Electron main:** validates the control endpoint, performs API requests with timeouts and bounded response bodies, and keeps owner secrets out of renderer state and logs.
3. **Control API:** validates bounded request payloads, rejects browser `Origin` requests, enforces PostgreSQL-backed per-IP fixed-window limits for create/join/revoke, hashes random bearer secrets, and issues short-lived room-scoped JWTs. It does not contain a user account/authorization system. Rate-limit bucket keys are HMACs of the configured client IP and route scope; raw bucket IP values are not stored in the rate-limit table.
4. **PostgreSQL:** stores call policy and secret hashes, not raw bearer values or media.
5. **LiveKit SFU:** handles signaling and forwards media. Transport encryption protects network legs; the SFU operator is within the media trust boundary.

Invite secrets are excluded from URLs sent to the API, logs redact authorization/cookie headers, and API errors map to generic client messages. The app encrypts an endpoint-specific idempotency key and original display name with Windows protected storage before its create request; the API stores only the key hash and a server-keyed fingerprint of the name, and can reproduce the same capabilities from its server secret. These controls do not prevent a user from forwarding their invitation or an operator from observing live media at the SFU.

## Current limits and release gates

- **Not end-to-end encrypted:** LiveKit has E2EE primitives, but this app has no client-managed key generation, sharing, rotation, removal, or recovery. Never claim that the service operator cannot access media.
- **Invite-based, not identity-authenticated:** the app has no account system, device identity, waiting room, or host admission UI. A forwarded invite works like the original invite.
- **Revocation has a bounded grace window:** ending marks the invite revoked under a database row lock, deletes the current media room, and stops new participant-token issuance. A token already minted can remain valid until it expires, at most two minutes after minting; a still-valid token may attempt to join again. Room deletion is retried every 15 seconds for at least three minutes after revocation, then a final room-close check is recorded. Service outages delay this cleanup until the API and SFU recover.
- **Expiry is enforced by the control service:** calls are marked revoked at their 12-hour expiry and the SFU room is repeatedly deleted through the same three-minute grace and final-check sequence. Startup reconciliation handles overdue rooms, including calls that were interrupted before finalization.
- **Abuse protection is alpha-level:** create/join/revoke throttles are persisted in PostgreSQL and shared across API instances; the health route has a process-local throttle. Limits are still keyed only by client IP, not account or device. There is no durable user quota, account reputation, abuse report flow, CAPTCHA, or moderation system. Do not expose an unauthenticated API to the general public.
- **Secret rotation needs a design:** the current create-capability derivation and request fingerprints use `LIVEKIT_API_SECRET`. Rotating it makes unresolved create retries unrecoverable and resets keyed rate-limit buckets. Add versioned keys and a migration/overlap procedure before production rotation.
- **Metadata minimization is partial:** no media is recorded, but the service and host can observe connection metadata, call timing, display names, IP addresses, and operational logs.
- **No independent security sign-off:** review service configuration, Windows packaging/signing, dependency notices, and endpoint behavior before any broad distribution.

Before a public beta, add identity/admission policy, distributed abuse controls, a tested E2EE key lifecycle, retention/incident policies, and an external security review. Keep the no-recording behavior and document server trust honestly.
