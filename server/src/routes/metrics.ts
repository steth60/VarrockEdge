import { Router } from 'express';
import { gt } from 'drizzle-orm';
import { snapshot } from '../system/metrics';
import { db } from '../db/client';
import { latencyBuckets, availabilityBuckets } from '../db/schema';
import { eq } from 'drizzle-orm';

const router = Router();

router.get('/stream', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders?.();

  const send = () => {
    const data = snapshot();
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };
  // Initial tick
  send();
  const t = setInterval(send, 1400);
  const keepalive = setInterval(() => res.write(': ping\n\n'), 25_000);
  req.on('close', () => {
    clearInterval(t);
    clearInterval(keepalive);
  });
});

router.get('/snapshot', (_req, res) => {
  res.json(snapshot());
});

// History endpoint: per-minute latency + loss for the last 1h.
router.get('/history', (_req, res) => {
  const nowMin = Math.floor(Date.now() / 60_000);
  const since = nowMin - 60;
  const rows = db.select().from(latencyBuckets).where(gt(latencyBuckets.minute, since)).all();
  const byMin = new Map(rows.map(r => [r.minute, r]));
  const out: Array<{ minute: number; avgMs: number | null; lossPct: number | null }> = [];
  for (let m = since + 1; m <= nowMin; m++) {
    const r = byMin.get(m);
    out.push({ minute: m, avgMs: r?.avgMs ?? null, lossPct: r?.lossPct ?? null });
  }
  res.json({ buckets: out });
});

// Availability strip for the last 24h (96 fifteen-minute buckets).
router.get('/availability', (req, res) => {
  const target = String(req.query.target ?? 'wan');
  const nowBucket = Math.floor(Date.now() / (15 * 60_000));
  const since = nowBucket - 96;
  const rows = db.select().from(availabilityBuckets).where(eq(availabilityBuckets.target, target)).all();
  const byB = new Map(rows.map(r => [r.bucket, r.status]));
  const out: Array<{ bucket: number; status: string }> = [];
  for (let b = since + 1; b <= nowBucket; b++) {
    out.push({ bucket: b, status: byB.get(b) ?? 'unknown' });
  }
  res.json({ target, buckets: out });
});

export default router;
