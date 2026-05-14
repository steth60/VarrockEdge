import { ping } from './ping';
import { log } from '../logger';
import { db } from '../db/client';
import { latencyBuckets } from '../db/schema';
import { eq } from 'drizzle-orm';

let timer: NodeJS.Timeout | null = null;
let started = false;

async function probeOnce() {
  const r = await ping('1.1.1.1', 3, 2500);
  const minute = Math.floor(Date.now() / 60_000);
  try {
    const existing = db.select().from(latencyBuckets).where(eq(latencyBuckets.minute, minute)).get();
    if (existing) {
      db.update(latencyBuckets).set({ avgMs: r.avgMs, lossPct: r.lossPct }).where(eq(latencyBuckets.minute, minute)).run();
    } else {
      db.insert(latencyBuckets).values({ minute, avgMs: r.avgMs, lossPct: r.lossPct }).run();
    }
    // Keep at most 24h of data — prune older.
    const cutoff = minute - 24 * 60;
    db.delete(latencyBuckets).where(eq(latencyBuckets.minute, cutoff)).run();
  } catch (err) {
    log.warn({ err }, 'latency persist failed');
  }
}

export function startLatencyProbe() {
  if (started) return;
  started = true;
  probeOnce().catch(() => {});
  timer = setInterval(() => { probeOnce().catch(() => {}); }, 30_000);
  log.info('latency probe started');
}

export function stopLatencyProbe() {
  if (timer) clearInterval(timer);
  timer = null;
  started = false;
}
