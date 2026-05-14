# VarrokEdge

Lightweight Proxmox network controller. One pane of glass over **dnsmasq** (DHCP+DNS), **wireguard-tools** (VPN), and **iptables** (NAT+firewall) — for a private `10.0.0.0/24` LAN sitting behind a public OVH WAN.

## Architecture

- **Backend:** Node 20 + TypeScript + Express + Drizzle/SQLite + `child_process` shellouts.
- **Frontend:** React 18 + Vite + Tailwind v3 + lucide-react (compiled and served by the backend).
- **System integration:** real `dnsmasq` / `wg` / `iptables` calls on Linux; safe **dry-run** logging on other platforms (e.g. macOS during development).
- **Binding:** Express binds to the **private** interface only (`10.0.0.2`) plus loopback — never the public WAN.

## Quick start (dev, macOS / Linux)

```bash
npm install
npm run db:migrate
VE_ADMIN_PASSWORD=admin npm run db:seed
npm run dev
# web → http://localhost:5173    api → http://127.0.0.1:8080
```

All system calls are logged as `{dryRun: true}` on non-Linux platforms — no root needed.

## Install on a Proxmox LXC (Debian 12 / Ubuntu 24.04)

```bash
sudo bash install.sh
# → outputs the generated admin password and the GUI URL on completion
```

The installer:

1. Installs `dnsmasq`, `iptables-persistent`, `wireguard-tools`, `sqlite3`, Node 20.
2. Disables `systemd-resolved` to free port 53.
3. Builds the app and migrates the DB.
4. Writes a `varrok-edge.service` systemd unit (running as `root`, required to call `iptables`).
5. Bootstraps the core MASQUERADE rule on `eth0`.

## Layout

```
server/   Express API + Drizzle schema + system managers (dnsmasq, wireguard, iptables, metrics)
web/      React SPA — pixel-port of the design bundle (9 views)
install.sh
varrok-edge.service.template
```

## Notes

- **TLS** is intentionally not handled in-app — terminate it upstream (Caddy, nginx) or use an SSH tunnel.
- The first migration creates one `admin` user; rotate the password via the Users view.
- All privileged commands flow through `server/src/system/exec.ts` — a single audit point.
