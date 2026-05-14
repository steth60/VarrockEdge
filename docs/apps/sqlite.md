# SQLite

VarrokEdge's state DB. Single file, WAL mode, accessed via
[better-sqlite3](https://github.com/WiseLibs/better-sqlite3) (synchronous,
in-process, no IPC).

## Why SQLite

- Zero ops: one file, no daemon, no port. Backs up by copying.
- WAL gives us concurrent reads while one writer is active.
- better-sqlite3 is the fastest SQLite binding for Node — perfectly fine
  for an appliance with ≤ a few hundred reservations / peers / rules.

## File location

`/var/lib/varrok-edge/varrok-edge.db` on the appliance; `./var/varrok-edge.db`
in dev. Override with `VE_DB_PATH`.

WAL puts two sidecar files next to it:
- `varrok-edge.db-wal`
- `varrok-edge.db-shm`

A backup must include all three, or the WAL must be checkpointed first
(`sqlite3 ... .recover` or `PRAGMA wal_checkpoint(TRUNCATE)`).

## Schema (high level)

```
users               admin accounts (argon2id password hash)
sessions            cookie sessions, expires_at
dhcp_reservations   MAC ↔ IP pinnings
dhcp_scope          DHCP range + gateway + DNS + domain
dns_records         local zone (A/AAAA/CNAME/TXT)
dns_upstreams       forwarder list
wg_server           server keypair, listen port, tunnel CIDR
wg_peers            road-warrior + site peers
fw_dnat             port forwards
fw_snat             SNAT/MASQUERADE rules (core row protected)
fw_rules            INPUT/FORWARD/OUTPUT filter rules
settings            KV
detection_rules     IDS rule definitions (toggleable)
threats             aggregated security events (rule × src)
event_buckets       per-hour severity counts for the timeline
```

See `server/src/db/schema.ts` for full definitions.

## Migrations

`server/src/db/migrations/000N_*.sql`. The migrate script tracks applied
files in a `__migrations` table; running again is a no-op.

```bash
npm run db:migrate    # applies any pending
npm run db:seed       # idempotent: creates admin user, default scope, etc.
```

## Debugging

```bash
sudo sqlite3 /var/lib/varrok-edge/varrok-edge.db
sqlite> .tables
sqlite> SELECT email, role, status FROM users;
sqlite> SELECT * FROM threats ORDER BY last_seen_at DESC LIMIT 10;
```

## Backups

```bash
# Hot backup (works even while VarrokEdge is running)
sqlite3 /var/lib/varrok-edge/varrok-edge.db ".backup /var/backups/varrok-$(date +%F).db"
```

That's a consistent snapshot. The Backups view (still pending real
implementation) will eventually drive this on a schedule.

## Code references

- `server/src/db/client.ts` — connection + pragmas
- `server/src/db/schema.ts` — Drizzle table definitions
- `server/src/db/migrate.ts` — minimal migration runner
- `server/src/db/seed.ts` — idempotent first-boot seeding
