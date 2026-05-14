# Updates

VarrokEdge can update itself in place from a git remote. Settings → Updates
checks `origin/<branch>`, lists incoming commits, and (with one button)
pulls, installs missing apps, rebuilds, migrates the DB, and restarts.

## Flow

```
Settings → Updates
   │
   ├─ Check now ──► POST /api/system/update/check
   │                 git fetch origin <branch>
   │                 git rev-list --left-right --count HEAD...origin/<branch>
   │                 → { ahead, behind, commits[] }
   │
   └─ Install update ──► POST /api/system/update/run  (SSE)
        ├─ git fetch
        ├─ git reset --hard origin/<branch>
        ├─ npm ci             (Linux only)
        ├─ npm run build
        ├─ apt-get install    (optional, when "also install missing apps" is ticked)
        ├─ npm run db:migrate
        └─ scheduleRestart() → systemctl restart varrok-edge
```

Each step streams as an SSE `data:` line:

```json
{ "step": "git.fetch", "status": "ok",   "msg": "..." }
{ "step": "build",     "status": "fail", "msg": "...", "exit": 1 }
{ "event": "restart", "msg": "restarting service…" }
```

The frontend polls `GET /api/system/version` until the SHA flips, then
reloads.

## Permissions

| Endpoint                       | Role required        |
|--------------------------------|----------------------|
| GET `/api/system/version`      | any authenticated    |
| POST `/api/system/update/check`| Admin or Owner       |
| POST `/api/system/update/run`  | **Owner only**       |
| GET `/api/system/apps/missing` | any authenticated    |
| POST `/api/system/apps/install`| Admin or Owner       |

A simple in-process lock prevents two updates from running concurrently —
the second request returns `409 Conflict`.

## Missing-application installer

The Services page lists every binary VarrokEdge depends on (`dnsmasq`,
`wg`, `iptables`, `fail2ban-client`, `git`, ...). A `which <bin>` probe
runs on every request to `/api/services`; anything missing surfaces in
the amber banner.

Clicking **Install all** issues `POST /api/system/apps/install` with no
body — the server computes the set from missing requirements and runs
`apt-get install -y --no-install-recommends <pkg> ...`. Same SSE stream
format as updates.

You can also pin specific packages:

```bash
curl -b cookie.jar -X POST http://10.0.0.2:8080/api/system/apps/install \
  -H 'Content-Type: application/json' \
  -d '{"packages":["wireguard-tools","fail2ban"]}'
```

## Restart behaviour

After a successful update, the server calls a detached
`systemctl restart varrok-edge` and exits with code 2. systemd's
`Restart=on-failure` directive in the unit brings us back. The
EventSource the browser was streaming drops; the UI starts polling
`/api/system/version` every 2s and reloads when the SHA changes.

On macOS dev the restart is a no-op log message — the process stays
running.

## Manual fallback

If the in-app updater fails (network, partial apt state, broken
migration), recover from a shell:

```bash
cd /opt/varrok-edge
git fetch origin && git reset --hard origin/main
npm ci
npm run build
npm run db:migrate
systemctl restart varrok-edge
```

To roll back to a previous version:

```bash
git -C /opt/varrok-edge log --oneline | head -10
git -C /opt/varrok-edge reset --hard <sha>
npm --prefix /opt/varrok-edge ci && npm --prefix /opt/varrok-edge run build
systemctl restart varrok-edge
```

DB migrations are forward-only — a rollback to an older code commit
won't undo schema changes. Restoring an older DB (see `docs/apps/sqlite.md`)
is the safe path if the new schema is incompatible.

## What `git reset --hard` means here

`reset --hard` discards any local working-tree changes. The appliance is
not a development host — it shouldn't have local commits or edits.
If you've patched files in `/opt/varrok-edge` and run an update, those
patches will be lost. Use a fork + push to your own remote instead.

## Why not just `apt upgrade`?

`apt` can't manage VarrokEdge — it's not packaged. Updates come from a
git remote that you control (a fork of the upstream repo, or upstream
itself). The "install missing apps" feature is a thin wrapper around
`apt-get install` to one-shot the required dependencies after a fresh
container is provisioned.

## Code references

- `server/src/system/updater.ts` — runUpdate, currentVersion, checkUpdates, installPackages, scheduleRestart
- `server/src/routes/system.ts` — /api/system/* endpoints
- `server/src/system/systemd.ts` — checkRequirements (binary + apt package map)
- `web/src/views/Settings.tsx` — Updates panel
- `web/src/views/Services.tsx` — Install-all button on the missing-app banner
