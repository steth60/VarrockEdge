# VarrokEdge — Documentation

VarrokEdge is a lightweight network controller for a Proxmox LXC. It manages
a private NAT network behind a public WAN, exposing **DHCP**, **DNS**,
**WireGuard**, and a **firewall** through a single React control plane.

The codebase is a Node 20 + TypeScript Express app with a Drizzle/SQLite
state DB. It does **not** implement network primitives itself — it
orchestrates native Linux daemons via `child_process`, writes their config
files, and reads their state. Treat it as a thin operator UI over the
existing Debian/Ubuntu stack.

## Contents

- [architecture.md](architecture.md) — how the pieces fit together
- [installation.md](installation.md) — install on a fresh LXC
- [development.md](development.md) — local dev on macOS / Linux, tests, CI
- [api.md](api.md) — REST endpoints, auth, request/response shapes
- [updates.md](updates.md) — in-app self-update + missing-app installer
- [multi-wan.md](multi-wan.md) — health-checked WAN failover
- [per-flow-telemetry.md](per-flow-telemetry.md) — conntrack sampler + probers
- [apps/](apps) — per-application docs for each underlying tool VarrokEdge
  drives:
  - [dnsmasq](apps/dnsmasq.md) — DHCP + DNS resolver
  - [wireguard](apps/wireguard.md) — VPN tunnel + peers
  - [iptables](apps/iptables.md) — NAT, port forwarding, firewall rules
  - [fail2ban](apps/fail2ban.md) — log-driven IP banning
  - [systemd](apps/systemd.md) — service supervision, journal
  - [sqlite](apps/sqlite.md) — appliance state store

## Operating principles

- **LAN-only control plane.** The web server binds to `10.0.0.2` (and
  `127.0.0.1` for SSH tunnels). It refuses to bind to `0.0.0.0` or the WAN
  interface IP. The Services page surfaces if any required tool isn't
  installed.
- **Native tools, not reimplementations.** Every feature is a thin wrapper
  around an existing daemon. Removing VarrokEdge leaves the underlying
  config working — it doesn't own the data path.
- **Single audit point for privileged calls.** `server/src/system/exec.ts`
  is the only place that runs external commands. On non-Linux platforms it
  short-circuits to dry-run mode so the app can be developed on macOS.
- **State in one place.** All operator-managed config (reservations, DNS
  records, peers, rules, users, sessions, threats) lives in
  `varrok-edge.db` (SQLite). Daemons are configured by rendering from that
  DB; ground truth is whichever config file is on disk at any moment.

## Quick reference

| Concern               | Lives in                            | Tool                       |
|-----------------------|-------------------------------------|----------------------------|
| DHCP leases           | `/var/lib/misc/dnsmasq.leases`      | dnsmasq                    |
| DHCP reservations     | DB + `/etc/dnsmasq.d/static.conf`   | dnsmasq                    |
| DNS records           | DB + `/etc/dnsmasq.d/varrok-dns.conf` | dnsmasq                  |
| WG server config      | DB + `/etc/wireguard/wg0.conf`      | wireguard-tools            |
| Port forwarding       | DB + `iptables -t nat`              | iptables / netfilter       |
| SNAT / masquerade     | DB + `iptables -t nat POSTROUTING`  | iptables / netfilter       |
| Filter rules          | DB + `iptables INPUT/FORWARD`       | iptables                   |
| Rule persistence      | `/etc/iptables/rules.v4`            | netfilter-persistent       |
| IP block list         | fail2ban-managed jails              | fail2ban                   |
| Threat detection      | DB `threats` table + detector       | (in-process matchers)      |
| Service supervision   | systemd                             | systemctl / journalctl     |
