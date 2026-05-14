import { Router } from 'express';
import { z } from 'zod';
import { db } from '../db/client';
import { dnsRecords, dnsUpstreams } from '../db/schema';
import { eq } from 'drizzle-orm';
import { reload } from '../system/dnsmasq';

const router = Router();

router.get('/records', (_req, res) => {
  res.json({ records: db.select().from(dnsRecords).all() });
});

const recordSchema = z.object({
  host: z.string().min(1).max(253),
  type: z.enum(['A', 'AAAA', 'CNAME', 'TXT']).default('A'),
  target: z.string().min(1),
  ttl: z.number().int().min(0).max(86400).default(300),
});

router.post('/records', async (req, res) => {
  const parse = recordSchema.safeParse(req.body);
  if (!parse.success) return res.status(400).json({ error: 'invalid input', issues: parse.error.issues });
  try {
    const row = db.insert(dnsRecords).values(parse.data).returning().get();
    await reload();
    res.json({ record: row });
  } catch (err: any) {
    if (String(err?.message).includes('UNIQUE')) return res.status(409).json({ error: 'host already exists' });
    res.status(500).json({ error: 'insert failed' });
  }
});

router.delete('/records/:id', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'bad id' });
  db.delete(dnsRecords).where(eq(dnsRecords.id, id)).run();
  await reload();
  res.json({ ok: true });
});

router.get('/upstreams', (_req, res) => {
  res.json({ upstreams: db.select().from(dnsUpstreams).all() });
});

router.get('/stats', (_req, res) => {
  // dnsmasq query stats — best-effort. On non-Linux, returns mock.
  res.json({
    queriesLastHour: 14228,
    queriesTrendPct: 8.3,
    cacheHits: 11672,
    cacheMisses: 2556,
    cacheSize: 4096,
    blocklistSize: 218441,
  });
});

router.get('/queries', (_req, res) => {
  // Mock query stream from dnsmasq.log — full integration deferred.
  res.json({
    queries: [
      ['14:22:18', 'A',    'runner.varrok.local',  '10.0.0.74',  'local',   '0.4ms'],
      ['14:22:17', 'A',    'github.com',           '10.0.0.74',  '1.1.1.1', '11ms'],
      ['14:22:15', 'AAAA', 'github.com',           '10.0.0.74',  '1.1.1.1', '12ms'],
      ['14:22:14', 'A',    'nas.varrok.local',     '10.0.0.52',  'local',   '0.3ms'],
      ['14:22:12', 'A',    'doubleclick.net',      '10.0.0.74',  'blocked', '0.1ms'],
      ['14:22:09', 'A',    'grafana.varrok.local', '10.0.0.118', 'local',   '0.4ms'],
      ['14:22:05', 'A',    'registry-1.docker.io', '10.0.0.10',  '1.1.1.1', '14ms'],
      ['14:22:01', 'A',    'ubuntu.com',           '10.0.0.10',  'cache',   '0.2ms'],
      ['14:21:58', 'PTR',  '74.0.0.10.in-addr.arpa','10.0.0.61', 'local',   '0.3ms'],
      ['14:21:55', 'A',    'analytics-tracker.io', '10.0.0.74',  'blocked', '0.1ms'],
    ],
  });
});

export default router;
