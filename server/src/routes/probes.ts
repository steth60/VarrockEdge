import { Router } from 'express';
import { ping, probeAll, PROBE_TARGETS } from '../system/ping';
import { runSpeedTest, listSpeedtests } from '../system/speedtest';
import { requireRole } from '../auth/middleware';

const router = Router();

router.get('/latency', async (_req, res) => {
  const results = await probeAll();
  const targets = PROBE_TARGETS.map((t, i) => ({ ...t, ...results[i] }));
  res.json({ targets, ts: Date.now() });
});

router.get('/ping', async (req, res) => {
  const host = String(req.query.host ?? '');
  if (!host) return res.status(400).json({ error: 'host required' });
  res.json(await ping(host));
});

router.get('/speedtest/stream', requireRole('Owner'), (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders?.();
  const e = runSpeedTest('manual');
  e.on('data', (ev: any) => res.write(`data: ${JSON.stringify(ev)}\n\n`));
  e.on('end', () => res.end());
  req.on('close', () => { try { e.cancel(); } catch {} });
});

router.get('/speedtest/history', (req, res) => {
  const limit = Math.min(200, Math.max(1, Number(req.query.limit ?? 50)));
  res.json({ runs: listSpeedtests(limit) });
});

export default router;
