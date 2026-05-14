import { spawn } from 'node:child_process';
import { db } from '../db/client';
import { wanInterfaces, wanHealth } from '../db/schema';
import { and, desc, eq, lt } from 'drizzle-orm';
import { config } from '../config';
import { exec } from './exec';
import { ping } from './ping';
import { log } from '../logger';

export interface WanWithHealth {
  id: number;
  iface: string;
  label: string;
  role: string;
  priority: number;
  healthTarget: string;
  enabled: boolean;
  health: { status: 'up' | 'degraded' | 'down'; rttMs: number | null; lossPct: number | null; ts: number | null };
}

function lastHealth(iface: string): WanWithHealth['health'] {
  const row = db.select().from(wanHealth)
    .where(eq(wanHealth.iface, iface))
    .orderBy(desc(wanHealth.ts))
    .limit(1)
    .get();
  if (!row) return { status: 'down', rttMs: null, lossPct: null, ts: null };
  return { status: row.status as 'up' | 'degraded' | 'down', rttMs: row.rttMs, lossPct: row.lossPct, ts: row.ts };
}

export function listWans(): WanWithHealth[] {
  return db.select().from(wanInterfaces).all().map(w => ({
    id: w.id,
    iface: w.iface,
    label: w.label,
    role: w.role,
    priority: w.priority,
    healthTarget: w.healthTarget,
    enabled: w.enabled,
    health: lastHealth(w.iface),
  }));
}

export function addWan(input: { iface: string; label: string; role?: string; priority?: number; healthTarget?: string }) {
  const row = db.insert(wanInterfaces).values({
    iface: input.iface,
    label: input.label,
    role: input.role ?? 'primary',
    priority: input.priority ?? 100,
    healthTarget: input.healthTarget ?? '1.1.1.1',
    enabled: true,
    createdAt: Date.now(),
  }).returning().get();
  return row;
}

export function patchWan(id: number, patch: { label?: string; role?: string; priority?: number; healthTarget?: string; enabled?: boolean }) {
  db.update(wanInterfaces).set(patch).where(eq(wanInterfaces.id, id)).run();
}

export function removeWan(id: number) {
  const row = db.select().from(wanInterfaces).where(eq(wanInterfaces.id, id)).get();
  if (!row) return;
  db.delete(wanHealth).where(eq(wanHealth.iface, row.iface)).run();
  db.delete(wanInterfaces).where(eq(wanInterfaces.id, id)).run();
}

export async function probeWan(iface: string, healthTarget: string): Promise<{ status: 'up' | 'degraded' | 'down'; rttMs: number | null; lossPct: number | null }> {
  // On Linux, bind ping to the specific iface so we genuinely test that link.
  // On macOS dev, fall back to a normal ping.
  let result;
  if (config.onLinux) {
    return new Promise(resolve => {
      const proc = spawn('ping', ['-c', '2', '-W', '1', '-I', iface, healthTarget], { stdio: ['ignore', 'pipe', 'pipe'] });
      let out = '';
      const t = setTimeout(() => { proc.kill('SIGKILL'); }, 5000);
      proc.stdout.on('data', d => { out += d.toString(); });
      proc.stderr.on('data', d => { out += d.toString(); });
      proc.on('close', () => {
        clearTimeout(t);
        const stats = /min\/avg\/max\/(?:mdev|stddev)\s*=\s*[\d.]+\/([\d.]+)\/[\d.]+/.exec(out);
        const loss = /(\d+(?:\.\d+)?)% packet loss/.exec(out);
        const avgMs = stats ? Number(stats[1]) : null;
        const lossPct = loss ? Number(loss[1]) : (stats ? 0 : 100);
        const status = !stats || lossPct >= 100 ? 'down' : lossPct > 5 || (avgMs ?? 0) > 200 ? 'degraded' : 'up';
        resolve({ status, rttMs: avgMs, lossPct });
      });
      proc.on('error', () => { clearTimeout(t); resolve({ status: 'down', rttMs: null, lossPct: 100 }); });
    });
  } else {
    result = await ping(healthTarget, 2, 2000);
    const status: 'up' | 'degraded' | 'down' = !result.ok || result.lossPct >= 100 ? 'down' : result.lossPct > 5 || (result.avgMs ?? 0) > 200 ? 'degraded' : 'up';
    return { status, rttMs: result.avgMs, lossPct: result.lossPct };
  }
}

async function applyRoutes(): Promise<void> {
  if (!config.onLinux) return;
  const candidates = listWans()
    .filter(w => w.enabled && w.health.status === 'up' && w.role !== 'snat-only')
    .sort((a, b) => a.priority - b.priority);
  const chosen = candidates[0];
  if (!chosen) {
    log.warn('no eligible WAN — leaving routing as-is');
    return;
  }
  // Resolve next-hop: parse `ip route show default dev <iface>` to pick the existing gateway.
  // If none is present yet, we can't synthesize one — skip.
  try {
    const r = await exec('ip', ['route', 'show', 'default', 'dev', chosen.iface], { allowFailure: true });
    const match = /default via (\S+)/.exec(r.stdout);
    if (!match) {
      log.warn({ iface: chosen.iface }, 'no default via on iface — routing not changed');
      return;
    }
    const gw = match[1]!;
    await exec('ip', ['route', 'replace', 'default', 'via', gw, 'dev', chosen.iface]);
    log.info({ iface: chosen.iface, gw }, 'default route applied');
  } catch (err) {
    log.warn({ err, iface: chosen.iface }, 'route apply failed');
  }
}

let timer: NodeJS.Timeout | null = null;
let started = false;

async function loop() {
  const wans = db.select().from(wanInterfaces).all().filter(w => w.enabled);
  const now = Date.now();
  for (const w of wans) {
    try {
      const h = await probeWan(w.iface, w.healthTarget);
      db.insert(wanHealth).values({ iface: w.iface, ts: now, status: h.status, rttMs: h.rttMs, lossPct: h.lossPct }).run();
    } catch (err) {
      log.warn({ err, iface: w.iface }, 'wan probe failed');
    }
  }
  // Prune older than 7 days
  const cutoff = now - 7 * 86400_000;
  db.delete(wanHealth).where(lt(wanHealth.ts, cutoff)).run();

  await applyRoutes().catch(err => log.warn({ err }, 'applyRoutes failed'));
}

export function startWanLoop() {
  if (started) return;
  started = true;
  loop().catch(() => {});
  timer = setInterval(() => { loop().catch(() => {}); }, 30_000);
  log.info('wan loop started');
}

export function stopWanLoop() {
  if (timer) clearInterval(timer);
  timer = null;
  started = false;
}

export function wanHistory(iface: string, range: '1h' | '24h' = '1h') {
  const since = Date.now() - (range === '1h' ? 3600_000 : 86400_000);
  return db.select().from(wanHealth).where(and(eq(wanHealth.iface, iface), eq(wanHealth.iface, iface))).all()
    .filter(r => r.ts >= since)
    .sort((a, b) => a.ts - b.ts);
}
