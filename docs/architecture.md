# Architecture

```
┌────────────────────────────────────────────────────────────────────┐
│  Browser (admin on LAN)  ──►  http://10.0.0.2:8080                 │
└─────┬──────────────────────────────────────────────────────────────┘
      │  cookie session (argon2id-backed)
      ▼
┌────────────────────────────────────────────────────────────────────┐
│  Express + React SPA (this app)                                     │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │  /api/auth      /api/overview   /api/metrics  (SSE)          │  │
│  │  /api/dhcp      /api/dns        /api/wireguard               │  │
│  │  /api/firewall  /api/topology   /api/security  /api/services │  │
│  │  /api/logs      (SSE)                                        │  │
│  └─────────────────────────┬────────────────────────────────────┘  │
└────────────────────────────┼───────────────────────────────────────┘
                             │
       ┌─────────────────────┼──────────────────────────┐
       ▼                     ▼                          ▼
  Drizzle/SQLite       child_process               systemd + journal
  (state DB)           (privileged shellouts)      (supervision + logs)
                             │
       ┌─────────┬───────────┼──────────────────┬──────────┐
       ▼         ▼           ▼                  ▼          ▼
   dnsmasq   wireguard   iptables / nft      fail2ban    others
   (DHCP+DNS) (VPN)      (NAT + firewall)    (IDS bans)  (ssh, cron…)
```

## Process model

A single Node process runs `server/dist/index.js` under systemd as
`varrok-edge.service`. It runs as **root** because:

- writing `/etc/dnsmasq.d/*`, `/etc/wireguard/wg0.conf`, `/etc/iptables/rules.v4`
- calling `iptables`, `wg`, `wg-quick`, `systemctl`, `fail2ban-client`

all require privilege. There is no privilege drop — the binding restriction
(LAN only) is the security boundary.

## Binding security

`server/src/index.ts` refuses to start if `VE_BIND_HOST` is `0.0.0.0`,
matches the WAN interface IP, or is unset on Linux. The server listens on
the configured LAN IP **and** loopback (so SSH tunnels work). It is never
reachable from the WAN.

## State vs config

The DB is the **source of truth** for everything an operator can mutate
via the UI: reservations, DNS records, WG peers, firewall rules, users,
sessions, detection rules, threats, settings.

For every mutation, two writes happen:

1. The row in SQLite (commit point).
2. A render-and-write pass to the daemon's config file, followed by a
   `systemctl reload` (or `wg syncconf`, or `iptables -A` / `iptables-save`).

If the daemon and the DB ever disagree, the DB wins on the next reload.
If a config file is hand-edited and the daemon is reloaded externally,
VarrokEdge will overwrite it on its next render.

## Dual-mode exec

`server/src/system/exec.ts` is the only place that spawns external
processes. On non-Linux it logs `{cmd, args, dryRun: true}` and returns a
zero exit. This means:

- Developers can run the full app on macOS, click through every CRUD flow,
  and observe what *would* run on a real appliance.
- A unit test can exercise `dnsmasq.ts` / `iptables.ts` without root.

## Detector engine

`server/src/system/detector.ts` runs in-process. On Linux it tails
`journalctl -fu sshd -u fail2ban -u kernel -u dnsmasq` and runs regex
matchers per detection rule. Matches are coalesced by `(rule, src)` over a
24h window into the `threats` table; per-hour counts go into
`event_buckets` for the timeline.

On macOS it emits a synthetic event every ~12s so the UI shows live data.

## SSE streams

Two endpoints push events via Server-Sent Events:

- `/api/metrics/stream` — KPI snapshot every 1.4s (CPU, RAM, iface
  throughput). Read from `/proc/stat` and `/sys/class/net/*/statistics/*`
  on Linux; from `os.cpus()` / `os.totalmem()` with synthetic noise on
  macOS.
- `/api/logs/stream` — journalctl tail, parsed into `{time, level, svc, msg}`.

Both run inside the same Node process — no separate worker.
