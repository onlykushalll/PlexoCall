# Owner-run services

This guide separates local development from calls over the public internet. The repository currently contains only a loopback-bound development stack. It is not a public deployment recipe or an operated service.

## Local development

On Windows, install Node.js 24, npm, and Docker Desktop with Linux containers enabled. From the repository root:

```powershell
npm ci
npm run services:up
npm run dev
```

The Compose project starts PostgreSQL 17, LiveKit Server `v1.13.10`, and the control API. It publishes API/WebSocket and media ports only on `127.0.0.1`. The app's default control URL is `http://127.0.0.1:8787`. Compose credentials are development-only and are committed for local use; never forward these ports from a router or reuse those credentials.

Stop with `npm run services:down`. This preserves the PostgreSQL volume. Removing the volume erases the local call records.

## Internet deployment requirements

Calls between arbitrary internet users need a server the project owner operates and can reach. A free VPS trial or a socket-binding addon does not remove the need for a public address and network capacity. Self-hosting avoids a paid calling API, but compute, public IPs/domains, electricity or hosting, and media bandwidth may still cost money.

Before inviting outside users, provision:

1. A Linux host with Docker or another supported deployment method, stable public reachability, and enough CPU/network bandwidth for the target room count and resolution.
2. A domain and a trusted certificate. Configure the app's control endpoint as `https://calls.example.net` and LiveKit's public endpoint as `wss://media.example.net`. Self-signed certificates are not accepted by the normal desktop client.
3. A reverse proxy or load balancer that terminates TLS and passes WebSocket upgrades to LiveKit's API/WebSocket port `7880` and HTTPS requests to the control API on `8787`.
4. Firewall rules that match the LiveKit configuration. This repository's development configuration uses ICE/TCP `7881` and UDP mux `7882`; allow those inbound protocols to the LiveKit host. Do not assume the loopback-only Compose port mappings are usable from the internet.
5. A unique LiveKit API key/secret and database password. Production validation requires an API key of at least 16 characters and secret of at least 32 characters. Keep them in a secret store or protected deployment environment, never in the desktop app or source control.

Keep the LiveKit API secret stable while this version is in use: outstanding create-retry recovery and rate-limit bucket hashes depend on it. Before rotating it, implement versioned key derivation with an overlap period so pending requests can still be recovered.

The development LiveKit config has no TURN listener and is not a production config. For restrictive networks, enable and test LiveKit's embedded TURN/TLS or TURN/UDP configuration. TURN/TLS usually needs a TURN hostname and certificate; without a layer-4 load balancer, LiveKit documents setting its advertised TLS port to `443`. Opening TURN adds another public service and firewall rule. Confirm whether your chosen proxy can forward the necessary UDP/TCP traffic; ordinary HTTP proxying is not enough for ICE media.

For a host behind NAT, configure LiveKit to discover and advertise its public IP (for example, `rtc.use_external_ip: true`) and verify the advertised ICE candidates from a separate network. If the host has a directly assigned public IP, follow the LiveKit deployment guide for that topology. The default API/WS port should sit behind TLS termination; the media ports are directly exposed as configured.

Example production LiveKit network shape, to adapt and validate for the actual host:

```yaml
port: 7880
rtc:
  tcp_port: 7881
  udp_port: 7882
  use_external_ip: true # typical when the public IP is hidden behind host/container networking
keys:
  YOUR_RANDOM_KEY: YOUR_RANDOM_SECRET
# Add a `turn:` block only after configuring DNS, certificates, and firewall forwarding.
```

Set the API environment to `NODE_ENV=production`, a real `DATABASE_URL`, `LIVEKIT_API_URL=http://livekit:7880`, and `LIVEKIT_PUBLIC_URL=wss://media.example.net`. `.env.example` lists the API variables but is not automatically loaded by the local Compose stack. The desktop user configures the HTTPS API address in the app; the API returns the media WebSocket endpoint.

Configure `TRUST_PROXY` only with the exact addresses or CIDRs of proxies you operate. Otherwise leave it empty. Create, join, and revoke rate limits are persisted in PostgreSQL by HMAC of the client IP and route scope, so API instances sharing this database share the same fixed-window counters. Trusting unverified forwarded headers makes those limits ineffective. Keep PostgreSQL private and backed up. Test restore and service upgrades before relying on them.

## Deployment boundary today

- The API has no accounts, organization model, CAPTCHA, invite moderation, or user-based quota. Create/join/revoke rate limits are shared through PostgreSQL; the health-route throttle is process-local.
- Call creation is open to anyone who can reach the API, subject to basic per-IP throttles. The invite is a bearer secret, not proof of identity.
- A valid participant token can be used to reconnect until its two-minute expiry. Ending a room revokes future API token issuance and asks LiveKit to delete the room; no network service can make an already-issued signed token disappear instantly.
- The control API reconciles expired and revoked room closure at startup and every 15 seconds while it is running. It repeats the room close for at least three minutes after revocation, then records a final check after the participant-token window. If the API or LiveKit is unavailable, final cleanup waits until service recovers; monitor the API logs for pending-closure errors.
- This repository does not yet include a production Compose profile, health monitoring, alerting, automated backups, or a tested multi-region plan.
- The session and call UI have not been validated on real Windows camera, audio, screen-capture, NAT, or packet-loss conditions in this environment.

Do not describe the current setup as a public production calling service until those operational controls and Windows/network checks are complete.

## LiveKit references

- [LiveKit deployment guide](https://docs.livekit.io/transport/self-hosting/deployment/)
- [LiveKit ports and firewall requirements](https://docs.livekit.io/transport/self-hosting/ports-firewall/)
- [LiveKit self-hosted benchmarks](https://docs.livekit.io/transport/self-hosting/benchmark/)
