# REST API

All endpoints are JSON. All routes outside `/api/auth/login` require an
active cookie session (`varrok_sid`, HttpOnly, SameSite=Lax). Use
`credentials: 'include'` from a browser.

## Auth

| Method | Path                  | Body                              | Notes |
|--------|-----------------------|-----------------------------------|-------|
| POST   | `/api/auth/login`     | `{email, password}`               | Sets `varrok_sid` cookie, returns `{user}`. |
| POST   | `/api/auth/logout`    | —                                 | Clears the cookie. |
| GET    | `/api/auth/me`        | —                                 | `401` if unauthed; `{user}` otherwise. |

## Overview

| GET | `/api/overview/services`   | systemd status of critical units (deprecated; use `/api/services`). |
| GET | `/api/overview/interfaces` | WAN + LAN with current throughput. |
| GET | `/api/overview/system`     | host info (kernel, uptime, hostname). |
| GET | `/api/overview/snapshot`   | one-shot metrics snapshot. |

## Metrics (SSE)

| GET | `/api/metrics/stream` | event-stream, 1.4s tick: `{cpu, ram, ramTotal, eth0:{rxMbps,txMbps}, eth1:{...}, ts}` |
| GET | `/api/metrics/snapshot` | same payload as a single response. |

## DHCP

| GET    | `/api/dhcp/leases`           | parsed leases from `dnsmasq.leases`. |
| GET    | `/api/dhcp/reservations`     | DB-backed static reservations. |
| POST   | `/api/dhcp/reservations`     | `{hostname, mac, ip, lease?, comment?}` — reloads dnsmasq. |
| DELETE | `/api/dhcp/reservations/:id` | — |
| GET    | `/api/dhcp/scope`            | range, gateway, DNS, domain. |
| PATCH  | `/api/dhcp/scope`            | partial update. |

## DNS

| GET    | `/api/dns/records`     | local A/AAAA/CNAME/TXT records. |
| POST   | `/api/dns/records`     | `{host, target, type?, ttl?}`. |
| DELETE | `/api/dns/records/:id` | — |
| GET    | `/api/dns/upstreams`   | configured forwarders. |
| GET    | `/api/dns/stats`       | query/cache counters. |
| GET    | `/api/dns/queries`     | recent query log (best-effort). |

## WireGuard

| GET    | `/api/wireguard/server`         | server info (public key, port, CIDR). |
| PATCH  | `/api/wireguard/server`         | listenPort / tunnelCidr / etc. |
| GET    | `/api/wireguard/peers`          | peers with live status (from `wg show wg0 dump`). |
| POST   | `/api/wireguard/peers`          | `{name, allowedIps?, keepalive?, kind?}` — generates keys, returns peer. |
| DELETE | `/api/wireguard/peers/:id`      | tears down + rewrites `wg0.conf`. |
| GET    | `/api/wireguard/peers/:id/conf` | downloadable `.conf`. |
| GET    | `/api/wireguard/peers/:id/qr`   | PNG QR code (480×480). |

## Firewall

| GET    | `/api/firewall/dnat`      | port forwards (with live hit counts). |
| POST   | `/api/firewall/dnat`      | new DNAT rule. |
| DELETE | `/api/firewall/dnat/:id`  | — |
| GET    | `/api/firewall/snat`      | SNAT/MASQUERADE rules. |
| POST   | `/api/firewall/snat`      | new SNAT rule. Core MASQUERADE row is protected. |
| DELETE | `/api/firewall/snat/:id`  | — (403 if core). |
| GET    | `/api/firewall/rules`     | filter rules (INPUT/FORWARD). |
| POST   | `/api/firewall/rules`     | new rule. |
| DELETE | `/api/firewall/rules/:id` | — |

## Topology

| GET | `/api/topology` | merged view: WAN + LAN (leases ∪ reservations) + WG peers + edge info. |

## Security (threats, rules, bans)

| GET    | `/api/security/threats`           | active threats, ordered by last seen. |
| PATCH  | `/api/security/threats/:id`       | `{status: 'acked'\|'flagged'\|...}`. |
| POST   | `/api/security/threats/:id/ban`   | escalate via fail2ban. |
| GET    | `/api/security/timeline`          | 24h hourly buckets per severity. |
| GET    | `/api/security/rules`             | detection rules. |
| PATCH  | `/api/security/rules/:id`         | `{enabled?, severity?, threshold?, action?}`. |
| GET    | `/api/security/bans`              | active fail2ban bans across all jails. |
| POST   | `/api/security/bans`              | `{ip, jail?}`. |
| DELETE | `/api/security/bans/:ip`          | unban. |

## Services

| GET  | `/api/services`              | systemd units (status, PID, CPU, RAM, enabled, restarts, binary, installed). |
| GET  | `/api/services/requirements` | install status of each required binary. |
| GET  | `/api/services/:unit/journal?lines=30` | last N journal lines. |
| POST | `/api/services/:unit/action` | `{action: 'start'\|'stop'\|'restart'\|'reload'\|'enable'\|'disable'}`. |

## Logs

| GET | `/api/logs/recent`  | recent journal lines (one-shot). |
| GET | `/api/logs/stream`  | SSE: live tail of dnsmasq + wg-quick + netfilter-persistent. |

## Users

| GET    | `/api/users`                | list. |
| POST   | `/api/users`                | invite (Owner/Admin only). |
| PATCH  | `/api/users/:id`            | role / status / password (Owner/Admin only). |
| DELETE | `/api/users/:id`            | remove (Owner only, can't delete self). |
| GET    | `/api/users/sessions/active`| active session list. |

## Settings

| GET   | `/api/settings`        | KV map. |
| PATCH | `/api/settings`        | partial update. |
| GET   | `/api/settings/about`  | product info. |

## Errors

- `400` — schema validation failure; response includes `issues` from zod.
- `401` — no session; reply with login.
- `403` — authenticated but role insufficient (or protected resource).
- `404` — resource not found.
- `409` — uniqueness violation (e.g. duplicate MAC or DNS host).
- `500` — unhandled. Check `journalctl -u varrok-edge`.
