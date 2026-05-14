# Multi-WAN failover

VarrokEdge can monitor multiple WAN uplinks and automatically swap the
default route to the highest-priority healthy one.

## Concepts

- **WAN row** — one record in `wan_interfaces` per logical uplink
  (`eth0`, `eth0:1`, `ppp0`, etc.).
- **Role** — `primary` (eligible to carry traffic), `failover` (only
  used when no higher-priority WAN is up), or `snat-only` (never the
  default route; used for outbound SNAT pinning).
- **Priority** — lower number wins. Same-role tie-break is priority.
- **Health target** — an IP the loop pings every 30s through that
  interface. Default `1.1.1.1`.
- **Health row** — one per probe tick, stored in `wan_health`, pruned
  after 7 days.

## What the loop does

`startWanLoop()` runs every 30 seconds (see
`server/src/system/wan.ts`):

1. For every enabled WAN, ping `healthTarget` bound to that iface
   (`ping -I <iface>`). On macOS dev, fall back to an unbound ping.
2. Classify the result: `down` (≥100% loss or unreachable),
   `degraded` (>5% loss or >200ms avg), `up` (otherwise).
3. Write a row to `wan_health`.
4. Call `applyRoutes()`. This picks the highest-priority WAN whose
   latest status is `up` and isn't `snat-only`. It runs:
   ```
   ip route show default dev <iface>  → grep next-hop
   ip route replace default via <gw> dev <iface>
   ```
   If the chosen WAN matches the current default route, this is a
   no-op. If it differs, the route is swapped immediately.

`applyRoutes()` does not synthesise a default route from nothing — the
OS / Proxmox layer must have configured the interface and its
next-hop gateway before VarrokEdge can pick it. That's intentional:
VarrokEdge orchestrates routing, it does not own L2/L3 plumbing.

## Adding a second WAN

Configure the new interface at the OS layer first (Proxmox network
config, `/etc/network/interfaces`, NetworkManager, whatever). Verify
that running `ip route show default dev <iface>` returns a next-hop.

Then in the UI:

1. **Settings → Network → Add WAN**.
2. Enter `iface` (e.g. `eth0:1`), label, role, priority, and a health
   target.
3. Save. Within 30 seconds the row's status flips to `up` (or `down`,
   if the iface can't reach the target).

If the higher-priority WAN (lower number) is `up`, traffic continues
to flow through it. If/when its status becomes `down`, the next tick
of `applyRoutes()` swaps the default route to the next eligible WAN.

## Endpoints

| Method | Path                          | Role         | Body / response                                |
|--------|-------------------------------|--------------|------------------------------------------------|
| GET    | `/api/wan`                    | any authed   | `{wans: WanWithHealth[]}`                      |
| POST   | `/api/wan`                    | Owner        | `{iface, label, role?, priority?, healthTarget?}` |
| PATCH  | `/api/wan/:id`                | Owner, Admin | `{label?, role?, priority?, healthTarget?, enabled?}` |
| DELETE | `/api/wan/:id`                | Owner        | —                                              |
| GET    | `/api/wan/:iface/history`     | any authed   | `?range=1h\|24h` → `{history: WanHealth[]}`    |

## Topology

The **Infrastructure** tab on the Topology page renders one block per
WAN row (up to 4) with its live status, role, priority, and last
recorded RTT/loss. Cables converge on the central appliance card. As
WAN rows are added or removed via Settings, this view updates within
30 seconds.

## Caveats

- v1 does **failover**, not **policy routing**. You can't yet say
  "send mail subnet via eth0:1, everything else via eth0".
- We don't drop or re-establish existing TCP connections on a failover.
  Long-lived sessions (SSH, WG, long downloads) will break when the
  route changes. Short-lived requests will reconnect transparently.
- A WAN flagged as `enabled: false` is left alone — neither probed
  nor considered for routing. Useful when an iface is temporarily
  unplugged.
- The 7-day `wan_health` retention is hard-coded. If you want longer
  history, raise the cutoff in `system/wan.ts` `loop()` or roll up
  into a daily summary table.
