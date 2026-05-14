# systemd

VarrokEdge runs as a systemd service and supervises the rest of the
stack through `systemctl` + `journalctl`.

## What VarrokEdge does with it

- Lives as `varrok-edge.service` (installed by `install.sh`).
- Lists ~14 known units on the Services page with status, PID, CPU%, RAM,
  uptime, and the `enabled at boot` flag.
- Maps every unit to its **underlying binary** (`dnsmasq`,
  `wg-quick`, `iptables`, etc.) and surfaces a banner if any required
  binary isn't installed.
- Start / Stop / Restart from the UI shells out to
  `systemctl <action> <unit>`. The unit name is whitelisted against the
  known set before invocation — no arbitrary string is ever passed to
  systemctl.
- Per-unit "View journal" calls `journalctl -u <unit> -n 30 --no-pager`.

## VarrokEdge's own unit

```ini
[Unit]
Description=VarrokEdge — Lightweight Proxmox Network Controller
After=network-online.target dnsmasq.service
Wants=network-online.target

[Service]
Type=simple
User=root
WorkingDirectory=/opt/varrok-edge
EnvironmentFile=/etc/varrok-edge/env
ExecStart=/usr/bin/node /opt/varrok-edge/server/dist/index.js
Restart=on-failure
RestartSec=3s
AmbientCapabilities=CAP_NET_ADMIN CAP_NET_BIND_SERVICE
NoNewPrivileges=false

[Install]
WantedBy=multi-user.target
```

Runs as root so it can `iptables -A`, write to `/etc/`, and call
`systemctl`.

## Inspect commands

```bash
systemctl status varrok-edge
systemctl restart varrok-edge

# Live logs
journalctl -fu varrok-edge

# What we read for the Services page
systemctl show <unit> -p ActiveState -p SubState -p UnitFileState \
                       -p MainPID -p ExecMainStartTimestamp \
                       -p NRestarts -p CPUUsageNSec -p MemoryCurrent
```

## Mapping: VarrokEdge action → systemctl

| UI action      | Command                              |
|----------------|--------------------------------------|
| Start          | `systemctl start <unit>`             |
| Stop           | `systemctl stop <unit>`              |
| Restart        | `systemctl restart <unit>`           |
| Reload         | `systemctl reload <unit>`            |
| Enable at boot | `systemctl enable <unit>`            |
| View journal   | `journalctl -u <unit> -n 30`         |

## Detecting missing applications

For each managed unit, `server/src/system/systemd.ts` knows the
underlying binary (e.g. `wg-quick@wg0.service` → `wg-quick`). On every
list call, it runs `which <binary>`. If a binary isn't found:

- `installed: false` is set on the service row.
- The Services page shows an amber banner counting missing apps with the
  matching install hint (e.g. `apt-get install wireguard-tools`).
- Start / Restart buttons disappear on uninstalled rows.

## Code references

- `server/src/system/systemd.ts` — listServices, action, journalTail, checkRequirements
- `server/src/routes/services.ts` — REST endpoints
- `varrok-edge.service.template` — installer-rendered unit
