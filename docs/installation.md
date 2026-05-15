# Installation

VarrokEdge runs on Debian 12 / Ubuntu 24.04 — a privileged LXC, a VM, or bare
metal — as a router with two network interfaces: one **WAN** (internet-facing)
and one **LAN** (private / clients). The interface names don't matter; you pick
them during install.

> The installer does **not** assign IP addresses to your interfaces. Configure
> the LAN interface's static IP — the gateway address clients use — at the OS
> level (netplan on Ubuntu, `/etc/network/interfaces` on Debian) before or
> after running the installer.

## Install

```bash
sudo bash install.sh
```

Run from a terminal this opens an interactive **setup wizard** (a whiptail TUI):
it detects the machine's network interfaces and walks you through choosing the
WAN and LAN interface, the web-UI bind address and port, and the admin
password — then writes `/etc/varrok-edge/env` and installs.

For automation / scripted deploys, run it non-interactively:

```bash
sudo WAN_IFACE=eth0 LAN_IFACE=eth1 BIND_HOST=10.0.0.1 bash install.sh --non-interactive
```

(A piped `curl … | bash` has no terminal, so it also runs non-interactively.)

Either way the installer:

1. `apt-get install`s the required system packages + Node.js 20.
2. Disables `systemd-resolved` to free port 53 for `dnsmasq`.
3. Copies the app to `/opt/varrok-edge`, runs `npm ci` + `npm run build`.
4. Writes `/etc/varrok-edge/env` — generating a session secret and an
   initial admin password on a fresh install.
5. Runs DB migrations and seeds the admin user + defaults.
6. Installs, enables and starts the systemd unit.
7. Bootstraps the firewall — LAN NAT plus a WAN lockdown (every inbound
   connection on the WAN interface is dropped except the WireGuard listener).

Re-running `install.sh` on a machine that already has it offers **Upgrade in
place** (keep all settings, just rebuild) or **Reconfigure** (change the
WAN / LAN / bind settings).

## Required packages

| Package                | Provides                                  |
|------------------------|-------------------------------------------|
| `dnsmasq`              | DHCP + local DNS                          |
| `iptables`             | NAT + firewall                            |
| `iptables-persistent`  | restore rules at boot                     |
| `wireguard-tools`      | `wg`, `wg-quick`                          |
| `fail2ban`             | log-driven IP banning                     |
| `sqlite3`              | DB CLI (debugging only)                   |
| `nodejs` (>= 20)       | runtime                                   |

The Services page in the UI surfaces a missing-application banner if any
of these binaries can't be found on `PATH`.

## Environment file

Defaults written to `/etc/varrok-edge/env`:

```ini
VE_BIND_HOST=10.0.0.2
VE_PORT=8080
VE_DB_PATH=/var/lib/varrok-edge/varrok-edge.db
VE_CONFIG_DIR=/etc/varrok-edge
VE_WAN_IFACE=eth0
VE_LAN_IFACE=eth1
VE_ADMIN_PASSWORD=<random>
VE_SESSION_SECRET=<random>
VE_LOG_LEVEL=info
```

Edit and `systemctl restart varrok-edge` to take effect.

## TLS

Not handled in-app. Either:

- terminate TLS upstream (Caddy / nginx) and reverse-proxy to
  `127.0.0.1:8080`, or
- access only via an SSH tunnel:
  `ssh -L 8080:127.0.0.1:8080 root@<lxc-host>`.

The default `Set-Cookie` is `SameSite=Lax` (HttpOnly always); the `Secure`
flag is set automatically when the request arrives over HTTPS.

## Upgrades

Re-run the installer from an updated source checkout — it detects the existing
install and offers **Upgrade in place**:

```bash
sudo bash install.sh
```

It preserves `/etc/varrok-edge/env` (including the session secret) and the
database, then rebuilds and restarts. Or do it by hand:

```bash
cd /opt/varrok-edge
git pull
npm ci
npm run build
npm run db:migrate
systemctl restart varrok-edge
```

`db:migrate` is idempotent — already-applied migrations are skipped.
