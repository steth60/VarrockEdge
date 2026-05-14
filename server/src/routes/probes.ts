import { Router } from 'express';
import { ping, probeAll, PROBE_TARGETS } from '../system/ping';
import { runSpeedTest } from '../system/speedtest';
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

router.post('/speedtest', requireRole('Owner'), async (_req, res) => {
  try {
    res.json(await runSpeedTest());
  } catch (err: any) {
    res.status(500).json({ error: err?.message ?? 'speedtest failed' });
  }
});

export default router;
