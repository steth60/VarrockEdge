import { ping } from './ping';
import { log } from '../logger';
import { db } from '../db/client';
import { availabilityBuckets, wgPeers } from '../db/schema';
import { eq, and } from 'drizzle-orm';
import { listPeers } from './wireguard';

let timer: NodeJS.Timeout | null = null;
let started = false;

function bucket(): number {
  return Math.floor(Date.now() / (15 * 60_000));
}

async function probeOnce() {
  const b = bucket();

  // WAN: ping a known external target. If reachable, WAN is up.
  const wan = await ping('1.1.1.1', 2, 2000);
  const wanStatus = !wan.ok || wan.lossPct >= 100 ? 'down' : wan.lossPct > 5 || (wan.avgMs ?? 0) > 200 ? 'degraded' : 'up';
  await writeBucket('wan', b, wanStatus);

  // WG: check each site/peer's status (from listPeers — already aggregates wg show wg0 dump).
  try {
    const peers = await listPeers();
    for (const p of peers) {
      const status = p.status === 'connected' ? 'up' : p.status === 'idle' ? 'degraded' : 'down';
      await writeBucket(`wg:${p.id}`, b, status);
    }
  } catch (err) {
    log.warn({ err }, 'avail wg failed');
  }
}

async function writeBucket(target: string, b: number, status: string) {
  try {
    const existing = db.select().from(availabilityBuckets).where(and(eq(availabilityBuckets.target, target), eq(availabilityBuckets.bucket, b))).get();
    if (existing) {
      // Worst-case wins: if we ever saw down/degraded in this 15m window, keep it.
      const order: Record<string, number> = { down: 3, degraded: 2, up: 1 };
      const winning = (order[status] ?? 0) >= (order[existing.status] ?? 0) ? status : existing.status;
      db.update(availabilityBuckets).set({ status: winning }).where(and(eq(availabilityBuckets.target, target), eq(availabilityBuckets.bucket, b))).run();
    } else {
      db.insert(availabilityBuckets).values({ target, bucket: b, status }).run();
    }
    // Prune anything older than 24h
    const cutoff = b - 24 * 4; // 24h * 4 buckets/hour
    db.delete(availabilityBuckets).where(and(eq(availabilityBuckets.target, target), eq(availabilityBuckets.bucket, cutoff))).run();
  } catch (err) {
    log.warn({ err, target }, 'avail persist failed');
  }
}

export function startAvailabilityProbe() {
  if (started) return;
  started = true;
  probeOnce().catch(() => {});
  // Probe every 90s — each 15m bucket gets ~10 samples, plenty for accurate worst-case rollup.
  timer = setInterval(() => { probeOnce().catch(() => {}); }, 90_000);
  log.info('availability probe started');
}

export function stopAvailabilityProbe() {
  if (timer) clearInterval(timer);
  timer = null;
  started = false;
}
