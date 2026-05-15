import { Router } from 'express';
import { z } from 'zod';
import { desc, eq } from 'drizzle-orm';
import { db } from '../db/client';
import { detectionRules, threats } from '../db/schema';
import { timelineLast24h } from '../system/detector';
import { listBans, banIp, unbanIp } from '../system/fail2ban';

const router = Router();

// ─── Threats ────────────────────────────────────────────────────────
router.get('/threats', (req, res) => {
  const severity = req.query.severity as string | undefined;
  let rows = db.select().from(threats).orderBy(desc(threats.lastSeenAt)).all();
  if (severity && severity !== 'all') rows = rows.filter(r => r.severity === severity);
  res.json({
    threats: rows.map(t => ({
      ...t,
      firstSeenAt: t.firstSeenAt,
      lastSeenAt: t.lastSeenAt,
    })),
  });
});

const statusSchema = z.object({
  status: z.enum(['monitoring', 'flagged', 'rate-limit', 'banned', 'acked']),
});

router.patch('/threats/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'bad id' });
  const parse = statusSchema.safeParse(req.body);
  if (!parse.success) return res.status(400).json({ error: 'invalid input', issues: parse.error.issues });
  db.update(threats).set({ status: parse.data.status }).where(eq(threats.id, id)).run();
  res.json({ ok: true });
});

router.post('/threats/:id/ban', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'bad id' });
  const t = db.select().from(threats).where(eq(threats.id, id)).get();
  if (!t) return res.status(404).json({ error: 'not found' });
  try {
    await banIp(t.src);
    db.update(threats).set({ status: 'banned' }).where(eq(threats.id, id)).run();
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err?.message ?? 'ban failed' });
  }
});

router.get('/timeline', (_req, res) => {
  res.json({ buckets: timelineLast24h() });
});

// ─── Detection rules ────────────────────────────────────────────────
router.get('/rules', (_req, res) => {
  res.json({ rules: db.select().from(detectionRules).all() });
});

const ruleSchema = z.object({
  enabled: z.boolean().optional(),
  severity: z.enum(['critical', 'high', 'medium', 'low']).optional(),
  threshold: z.string().optional(),
  action: z.string().optional(),
  name: z.string().optional(),
});

router.patch('/rules/:id', (req, res) => {
  const id = req.params.id;
  const parse = ruleSchema.safeParse(req.body);
  if (!parse.success) return res.status(400).json({ error: 'invalid input', issues: parse.error.issues });
  const existing = db.select().from(detectionRules).where(eq(detectionRules.id, id)).get();
  if (!existing) return res.status(404).json({ error: 'not found' });
  db.update(detectionRules).set(parse.data).where(eq(detectionRules.id, id)).run();
  res.json({ rule: db.select().from(detectionRules).where(eq(detectionRules.id, id)).get() });
});

// ─── Block list (fail2ban) ──────────────────────────────────────────
router.get('/bans', async (_req, res) => {
  res.json({ bans: await listBans() });
});

const banSchema = z.object({
  ip: z.string().regex(/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/),
  // A fail2ban jail name reaches fail2ban-client as an argument — restrict it
  // to a safe character set so it can never be parsed as an option flag.
  jail: z.string().regex(/^[a-zA-Z0-9_-]{1,32}$/).default('sshd'),
});

router.post('/bans', async (req, res) => {
  const parse = banSchema.safeParse(req.body);
  if (!parse.success) return res.status(400).json({ error: 'invalid input', issues: parse.error.issues });
  try {
    await banIp(parse.data.ip, parse.data.jail);
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err?.message ?? 'ban failed' });
  }
});

router.delete('/bans/:ip', async (req, res) => {
  const ip = req.params.ip;
  if (!/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(ip)) return res.status(400).json({ error: 'bad ip' });
  try {
    await unbanIp(ip);
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err?.message ?? 'unban failed' });
  }
});

export default router;
