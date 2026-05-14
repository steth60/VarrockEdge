# Development

```bash
npm install
npm run db:migrate
VE_ADMIN_PASSWORD=admin npm run db:seed
npm run dev
```

- API → `http://127.0.0.1:8080`
- Vite dev → `http://localhost:5173` (proxies `/api` to the server)

Sign in as `admin@varrok.local` / `admin`.

## Project layout

```
server/   Express + Drizzle/SQLite + system managers
web/      React + Vite SPA, served from server/public after build
docs/     this folder
test/     Vitest unit + integration tests
.github/  CI workflow
install.sh + varrok-edge.service.template
```

## Common scripts

| Script                  | What it does                                        |
|-------------------------|-----------------------------------------------------|
| `npm run dev`           | watch-mode server + Vite, parallel                  |
| `npm run dev:server`    | `tsx watch server/src/index.ts`                     |
| `npm run dev:web`       | `vite` only                                         |
| `npm run build`         | builds web → `server/public/`, then compiles server |
| `npm start`             | `node server/dist/index.js`                         |
| `npm run db:migrate`    | apply pending migrations                            |
| `npm run db:seed`       | idempotent seed (admin user, defaults)              |
| `npm run typecheck`     | tsc on both projects                                |
| `npm run test`          | Vitest watch                                        |
| `npm run test:run`      | Vitest one-shot (used in CI)                        |
| `npm run test:coverage` | with v8 coverage                                    |

## Dual-mode exec on macOS

Every call to a privileged binary (`dnsmasq`, `iptables`, `wg`,
`systemctl`, `fail2ban-client`) routes through `server/src/system/exec.ts`.
On non-Linux platforms it logs `{cmd, args, dryRun: true}` and returns
success immediately. So:

- CRUD on DHCP / DNS / WG / firewall flows work — DB rows persist, but the
  daemon isn't touched.
- The Services page lists units with the seeded mock state.
- The detector emits synthetic threats every ~12s so the Logs view has
  live data.

## Testing

Vitest with `pool: 'forks'` + `singleFork: true` so all tests share a
single in-memory DB created in `test/setup.ts`. Server modules read
`process.env.VE_DB_PATH` before any other import, so the env vars set in
`test/setup.ts` apply globally.

```
test/server/      unit + integration tests (incl. supertest)
test/web/         pure-function utility tests
```

Run a single file: `npx vitest run test/server/wireguard.test.ts`.

## CI

`.github/workflows/ci.yml` runs on push/PR to `main`:

1. `actions/setup-node@v4` with Node 20 and npm cache.
2. `npm ci`
3. `npm run typecheck`
4. `npm run test:run`
5. `npm run build`
6. Asserts `server/public/index.html` exists.

About 2–3 minutes per run.

## Adding a new feature

1. **Schema:** new table in `server/src/db/schema.ts` + matching SQL in
   a new `server/src/db/migrations/000N_name.sql`.
2. **System wrapper** (if it touches a daemon): a new file in
   `server/src/system/` that funnels every external call through `exec()`.
3. **Route:** `server/src/routes/<name>.ts`, mounted in
   `server/src/index.ts`.
4. **View:** `web/src/views/<Name>.tsx`, registered in `App.tsx` and
   `components/Sidebar.tsx` + `components/Header.tsx`.
5. **Tests:** at minimum, a happy-path API test in `test/server/`.
6. **Docs:** if a new underlying tool is involved, add
   `docs/apps/<tool>.md` and link from `docs/README.md`.
