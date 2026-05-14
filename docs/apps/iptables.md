# iptables

VarrokEdge manages three concerns with iptables:

1. **Source NAT (SNAT/MASQUERADE)** — outbound traffic from
   `10.0.0.0/24` is rewritten to the WAN IP.
2. **Destination NAT (DNAT) — port forwarding** — incoming `eth0:port` is
   redirected to an internal host:port.
3. **Filter rules (INPUT/FORWARD)** — accept/drop/reject inbound or
   transit traffic.

## What VarrokEdge does with it

- Persists every rule it manages as a row in `fw_snat`, `fw_dnat`, or
  `fw_rules`.
- On mutation, issues an `iptables -A` (or `-D` for delete) immediately,
  then calls `iptables-save > /etc/iptables/rules.v4` so the rule
  survives reboot.
- The first run seeds a "core" MASQUERADE row
  (`-A POSTROUTING -o eth0 -s 10.0.0.0/24 -j MASQUERADE`). The UI
  refuses to let it be deleted — this is what lets the LAN reach the
  internet at all.
- Reads hit counters via `iptables -t nat -L PREROUTING -n -v -x` for the
  Port Forwards table.

## Mapping: VarrokEdge action → iptables command

| Action                          | iptables                                                                       |
|---------------------------------|--------------------------------------------------------------------------------|
| Add DNAT                        | `-t nat -A PREROUTING -i eth0 -p tcp --dport 443 -j DNAT --to 10.0.0.20:443`  |
|                                 | `-A FORWARD -i eth0 -o eth1 -p tcp -d 10.0.0.20 --dport 443 -j ACCEPT`        |
| Add SNAT / MASQ                 | `-t nat -A POSTROUTING -o eth0 -s 10.0.0.0/24 -j MASQUERADE`                  |
| Add static SNAT                 | `-t nat -A POSTROUTING -o eth0 -s 10.0.0.20 -j SNAT --to-source 51.x.x.x`     |
| Filter accept                   | `-A INPUT -p tcp -s 10.0.0.0/24 --dport 22 -j ACCEPT`                          |

## Install / inspect

```bash
sudo apt-get install iptables iptables-persistent

# See current rules
iptables -L -n -v
iptables -t nat -L -n -v

# Persist
iptables-save > /etc/iptables/rules.v4
netfilter-persistent save
netfilter-persistent reload

# Watch a counter increment
watch -n1 'iptables -t nat -L PREROUTING -n -v -x'
```

## Files touched

| Path                          | Owner                 | Notes                                  |
|-------------------------------|-----------------------|----------------------------------------|
| `/etc/iptables/rules.v4`      | netfilter-persistent  | rewritten by `iptables-save` on each mutation |

## Why iptables and not nftables?

iptables is still the most widely supported on Debian/Ubuntu LXCs and
matches operator muscle memory. The UI surfaces an `nftables-monitor`
unit for parity with the Claude Design mock, but it's not required.

## Code references

- `server/src/system/iptables.ts` — `applyDnat`, `applySnat`, `applyRule`, `persist`
- `server/src/routes/firewall.ts` — REST endpoints
