# Per-flow telemetry

The NOC overview's three Top-N strips, the Application breakdown
donut, and the throughput-chart's latency/loss series are all fed by
a background sampler that reads `conntrack` and tracks ICMP RTT.

## Components

### conntrack sampler — `server/src/system/conntrack.ts`

- Runs `conntrack -L -o extended -p tcp -p udp` every 5 seconds on
  Linux. On macOS dev, generates a plausible synthetic distribution
  every 30 seconds.
- Parses each connection's `src=`, `dst=`, `sport=`, `dport=`,
  `bytes=`, `packets=`. When both directions are present (the typical
  case for an `ASSURED` flow), sums them.
- Aggregates into a single 1-hour rolling window across four maps:
  - **clients** — by source IP (private only)
  - **services** — by `(dport, proto)`
  - **destinations** — by destination IP (public only)
  - **apps** — by port-mapped application name (see `port_apps.json`)
- Replaces the contents of `flow_top_clients`, `flow_top_services`,
  `flow_top_destinations`, `flow_apps` atomically per tick.

### Port → application map — `server/data/port_apps.json`

About 50 well-known ports. Anything not in the table is reported as
`tcp:NNNN` / `udp:NNNN`.

### Latency probe — `server/src/system/latencyProbe.ts`

- Pings `1.1.1.1` every 30s with `ping -c 3`.
- Writes one row to `latency_buckets` per minute (avg of the samples
  inside that minute). Older than 24h is pruned.
- Surfaced by `GET /api/metrics/history` — used by the NOC overview's
  latency mini-chart.

### Availability probe — `server/src/system/availabilityProbe.ts`

- Every 90s: pings `1.1.1.1` (WAN target) and reads each WG peer's
  current status from `wg show wg0 dump`.
- Classifies as `up` / `degraded` / `down`, then writes/updates the
  matching 15-minute bucket in `availability_buckets`. Within a
  bucket, the worst status seen wins.
- Surfaced by `GET /api/metrics/availability?target=wan|wg:<id>` —
  used by the 24h availability strips on the Overview.

## Endpoints

| Method | Path                                   | Returns                                                          |
|--------|----------------------------------------|------------------------------------------------------------------|
| GET    | `/api/flows/top?kind=clients`           | top 8 LAN clients in the 1h window                              |
| GET    | `/api/flows/top?kind=services`          | top 8 dport+proto combos                                         |
| GET    | `/api/flows/top?kind=destinations`      | top 8 public destination IPs                                     |
| GET    | `/api/flows/apps?window=1h`             | per-application down/up bytes                                    |
| GET    | `/api/metrics/history`                  | last 60 minutes of `{minute, avgMs, lossPct}`                    |
| GET    | `/api/metrics/availability?target=...`  | last 96 fifteen-min buckets of `{bucket, status}`                |
| GET    | `/api/probes/latency`                   | live ping fan-out to 4 well-known targets (no DB)                |
| POST   | `/api/probes/speedtest`                 | runs Ookla `speedtest` synchronously (Owner only)                |

## Caveats

- **Direction inference is approximate.** conntrack collapses both
  directions into one row, so "down vs up" for an Application
  breakdown row is computed from the heuristic `src is private,
  dst is public → up bytes`, everything else → down bytes. Not
  perfect, but good enough for an at-a-glance breakdown.
- **Post-NAT addresses.** For traffic going out via NAT, conntrack
  reports the outbound source as the private LAN address; that's
  what we use for Top LAN clients. For inbound DNAT, the destination
  IP becomes the internal IP, so Top destinations sees the public
  side of *outbound* flows but the internal side of *inbound* DNAT
  flows. Live with it for v1.
- **No flow history.** We only keep the current 1h window. Historical
  Top-N would require either a longer retention column on the same
  tables or per-minute summary rows. Not worth the storage cost yet.
- The samplers are best-effort — if `conntrack` isn't installed (the
  Services banner will flag it as missing), the table just stays
  empty and every strip shows "no flow data yet".
