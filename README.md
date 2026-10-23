# Plexocall

Plexocall is a Windows-first voice and video calling app built around invite-only rooms. The desktop app uses Electron, React, and LiveKit's WebRTC client. A self-hosted control API issues short-lived room credentials; a self-hosted LiveKit SFU carries live media.

The current milestone is a private alpha foundation, not a public production service. The first release uses normal WebRTC ICE route selection and reconnection. It does not combine Wi-Fi and tether links, route other apps, or promise lossless calls.

## What is in this repository

- A Windows desktop UI for creating and joining voice/video rooms, checking devices, sharing a screen, seeing participants and call diagnostics, and leaving or ending a room.
- A small Fastify control API with PostgreSQL storage for invite/owner capability hashes and expiry/revocation state.
- Local Docker Compose definitions for PostgreSQL, LiveKit, and the API. The development ports bind to loopback and use development-only credentials.
- The approved architecture and implementation plan in [`docs/superpowers`](docs/superpowers/).
- Owner-run deployment, privacy, and release boundaries in [`docs/operations`](docs/operations/).

## Local development

Prerequisites: Windows, Node.js 24, npm, and Docker Desktop configured for Linux containers. This checkout does not include a public call server.

```powershell
npm ci
npm run services:up
npm run dev
```

The app starts with the local control API at `http://127.0.0.1:8787`. Keep the development stack on this PC; its ports, credentials, and plain HTTP/WebSocket endpoints are for local development only. Stop the containers with:

```powershell
npm run services:down
```

The Compose project keeps its PostgreSQL volume when stopped. Removing the volume deletes the local database and is not part of normal shutdown.

## Architecture and limits

The control API stores call IDs, LiveKit room names, SHA-256 hashes of invite/owner secrets, a hash of the create retry key, an HMAC fingerprint binding that key to the original display name, HMAC rate-limit bucket keys and counters, and expiry/revocation/room-close/final-close timestamps. Invite and owner secrets are derived from a random per-attempt client key and the server secret; the API stores only their hashes. It does not store call media or raw display names. Invite links are bearer capabilities: anyone who gets a valid link can try to join until it expires or the creator ends the room. Participant tokens are room-scoped and expire after two minutes; the app can request a fresh token when a user rejoins. Owner controls, the invite needed to reopen a room, and an unresolved create retry record are encrypted with Windows protected storage. The home screen lists managed calls after app restart; reopening starts with camera and microphone off.

Create requests persist the endpoint-specific idempotency key and original display name before sending the request. The encrypted store retains them across endpoint changes and app restarts, so returning to an endpoint retries the same request instead of silently replacing its key. The API binds the key to that name and rejects a mismatched payload. The app clears the key after safely saving the owner record; if it exits before that final encrypted update, retrying the leftover key safely returns the same room. Keys are also cleared when the API says the attempt has expired or been revoked. The API repeatedly closes revoked and expired rooms through a durable reconciliation loop, including after a restart. It keeps repeating the close through a three-minute grace period after revocation to catch any room recreated by a still-valid participant token, then records a final close. While the API is running, reconciliation runs every 15 seconds; if the API or LiveKit is unavailable, final cleanup waits for recovery.

WebRTC encrypts media in transit between each participant and the SFU. The SFU operator is trusted with live media because app-level end-to-end key distribution and rotation are not implemented. Plexocall does not record or transcribe calls.

Self-hosting removes a paid calling API requirement; it does not make global calling infrastructure free. Internet calls need a reachable host, trusted TLS, opened firewall ports, sufficient compute, and outbound bandwidth. Create, join, and end-call throttles use PostgreSQL-backed per-IP windows shared across API instances; health checks use a separate process-local limit. There are still no user accounts, identity checks, quotas, or abuse-review system. Keep it private until those controls and the deployment have been reviewed.

## Scope after the first calling milestone

Multi-link transport remains a separately gated experiment. It is not in the call path. Third-party app boosting for WhatsApp, Instagram, Zoom, or Meet is also later work: Windows socket binding alone cannot transparently redirect Chromium/WebRTC traffic. See the research and gates in [`docs/superpowers/specs/2026-10-23-plexocall-design.md`](docs/superpowers/specs/2026-10-23-plexocall-design.md).

## License

Project source is MIT licensed. Upstream Plexo provenance and license details are recorded in [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md). Dependency licenses must be inventoried before redistribution.
