# Installation

VarrokEdge targets a privileged Debian 12 / Ubuntu 24.04 LXC container with
two interfaces:

- `eth0` — public WAN
- `eth1` — private LAN, statically assigned `10.0.0.2/24`

## One-shot install

```bash
sudo bash install.sh
```

This:

1. `apt-get install`s the required system packages.
2. Installs Node.js 20 via the NodeSource repo.
3. Disables `systemd-resolved` to free port 53 for `dnsmasq`.
4. Copies the app to `/opt/varrok-edge`, runs `npm ci` and `npm run build`.
5. Generates a random admin password and a session secret into
   `/etc/varrok-edge/env`.
6. Runs DB migrations and seeds the admin user, default DHCP scope,
   default detection rules, and the core MASQUERADE row.
7. Writes a systemd unit, enables and starts it.
8. Bootstraps `iptables -t nat -A POSTROUTING -o eth0 -j MASQUERADE`
   and persists it.
9. Prints the URL, username, and password.

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

```bash
cd /opt/varrok-edge
git pull
npm ci
npm run build
npm run db:migrate
systemctl restart varrok-edge
```

`db:migrate` is idempotent — already-applied migrations are skipped.
