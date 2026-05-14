# dnsmasq

[dnsmasq](https://thekelleys.org.uk/dnsmasq/doc.html) is a lightweight
DHCP server + DNS forwarder + caching resolver. VarrokEdge uses it for
**both** DHCP (on `eth1`) and local DNS (`*.varrok.local` plus general
forwarding to upstream resolvers).

## What VarrokEdge does with it

- Renders three drop-ins under `/etc/dnsmasq.d/` from the DB:
  - `varrok.conf` — interface binding, DHCP range, gateway, push DNS,
    domain.
  - `static.conf` — one `dhcp-host=MAC,host,IP,lease` line per row in
    `dhcp_reservations`.
  - `varrok-dns.conf` — one line per row in `dns_records`. A → `address=`,
    CNAME → `cname=`, TXT → `txt-record=`.
- Calls `systemctl reload dnsmasq` after every write (preserves existing
  leases — never restart).
- Parses `/var/lib/misc/dnsmasq.leases` to render the live leases table.

## Critical config

```
interface=eth1
bind-interfaces          # never bind to eth0 (public) — important
dhcp-range=10.0.0.50,10.0.0.200,24h
dhcp-option=3,10.0.0.1   # gateway pushed to clients
dhcp-option=6,10.0.0.1,1.1.1.1  # DNS servers
domain=varrok.local
local=/varrok.local/
expand-hosts
```

`bind-interfaces` is non-negotiable — without it, dnsmasq listens on
`0.0.0.0` and would answer DHCP requests on the WAN.

## Install / inspect

```bash
sudo apt-get install dnsmasq
systemctl status dnsmasq
journalctl -fu dnsmasq

# Show current configuration
dnsmasq --test                   # validate before reload
cat /var/lib/misc/dnsmasq.leases # raw leases: <epoch> <mac> <ip> <hostname> <clientid>
```

## Files touched

| Path                          | Owner             | Purpose                       |
|-------------------------------|-------------------|-------------------------------|
| `/etc/dnsmasq.d/varrok.conf`  | VarrokEdge        | DHCP scope + DNS              |
| `/etc/dnsmasq.d/static.conf`  | VarrokEdge        | static reservations           |
| `/etc/dnsmasq.d/varrok-dns.conf` | VarrokEdge     | local DNS records             |
| `/etc/dnsmasq.conf`           | distro (untouched) | base settings                |
| `/var/lib/misc/dnsmasq.leases`| dnsmasq           | live lease state              |

## Port 53 caveat

Debian/Ubuntu ship `systemd-resolved` listening on `127.0.0.53:53`. The
installer **disables** `systemd-resolved` so dnsmasq can claim port 53.
The Services page surfaces `systemd-resolved.service` as `inactive` /
`disabled` — that's the expected state on a VarrokEdge appliance.

## Code references

- `server/src/system/dnsmasq.ts` — config renderers + reload + lease parser
- `server/src/routes/dhcp.ts` — DHCP CRUD endpoints
- `server/src/routes/dns.ts` — DNS CRUD endpoints
