import { Router } from 'express';
import { z } from 'zod';
import { db } from '../db/client';
import { fwDnat, fwSnat, fwRules } from '../db/schema';
import { eq } from 'drizzle-orm';
import { applyDnat, applySnat, applyRule, persist, dnatHits } from '../system/iptables';

const router = Router();

// ─── DNAT ────────────────────────────────────────────────────────────
router.get('/dnat', async (_req, res) => {
  const rows = db.select().from(fwDnat).all();
  const hits = await dnatHits();
  res.json({
    forwards: rows.map(r => ({
      ...r,
      hits: hits.get(`${r.proto}:${r.srcPort}->${r.destIp}:${r.destPort}`) ?? 0,
    })),
  });
});

const dnatSchema = z.object({
  srcPort: z.number().int().min(1).max(65535),
  proto: z.enum(['tcp', 'udp', 'both']).default('tcp'),
  destIp: z.string().min(1),
  destPort: z.number().int().min(1).max(65535),
  comment: z.string().optional(),
});

router.post('/dnat', async (req, res) => {
  const parse = dnatSchema.safeParse(req.body);
  if (!parse.success) return res.status(400).json({ error: 'invalid input', issues: parse.error.issues });
  const row = db.insert(fwDnat).values(parse.data).returning().get();
  await applyDnat(row, 'A').catch(() => {});
  await persist();
  res.json({ forward: row });
});

router.delete('/dnat/:id', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'bad id' });
  const row = db.select().from(fwDnat).where(eq(fwDnat.id, id)).get();
  if (row) await applyDnat(row, 'D').catch(() => {});
  db.delete(fwDnat).where(eq(fwDnat.id, id)).run();
  await persist();
  res.json({ ok: true });
});

// ─── SNAT ────────────────────────────────────────────────────────────
router.get('/snat', (_req, res) => {
  res.json({ rules: db.select().from(fwSnat).all() });
});

const snatSchema = z.object({
  source: z.string().min(1),
  outIface: z.string().min(1).default('eth0'),
  mode: z.enum(['MASQUERADE', 'SNAT']).default('MASQUERADE'),
  toSource: z.string().nullable().optional(),
  comment: z.string().optional(),
});

router.post('/snat', async (req, res) => {
  const parse = snatSchema.safeParse(req.body);
  if (!parse.success) return res.status(400).json({ error: 'invalid input', issues: parse.error.issues });
  if (parse.data.mode === 'SNAT' && !parse.data.toSource) {
    return res.status(400).json({ error: 'SNAT requires toSource' });
  }
  const row = db.insert(fwSnat).values({
    ...parse.data,
    toSource: parse.data.toSource ?? null,
  }).returning().get();
  await applySnat(row, 'A').catch(() => {});
  await persist();
  res.json({ rule: row });
});

router.delete('/snat/:id', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'bad id' });
  const row = db.select().from(fwSnat).where(eq(fwSnat.id, id)).get();
  if (row?.isCore) return res.status(403).json({ error: 'cannot delete core MASQUERADE rule' });
  if (row) await applySnat(row, 'D').catch(() => {});
  db.delete(fwSnat).where(eq(fwSnat.id, id)).run();
  await persist();
  res.json({ ok: true });
});

// ─── Filter rules ────────────────────────────────────────────────────
router.get('/rules', (_req, res) => {
  res.json({ rules: db.select().from(fwRules).all() });
});

const ruleSchema = z.object({
  chain: z.enum(['INPUT', 'FORWARD', 'OUTPUT']),
  action: z.enum(['ACCEPT', 'DROP', 'REJECT']),
  proto: z.string().default('all'),
  source: z.string().nullable().optional(),
  dport: z.string().nullable().optional(),
  comment: z.string().optional(),
});

router.post('/rules', async (req, res) => {
  const parse = ruleSchema.safeParse(req.body);
  if (!parse.success) return res.status(400).json({ error: 'invalid input', issues: parse.error.issues });
  const row = db.insert(fwRules).values({
    ...parse.data,
    source: parse.data.source ?? null,
    dport: parse.data.dport ?? null,
  }).returning().get();
  await applyRule(row, 'A').catch(() => {});
  await persist();
  res.json({ rule: row });
});

router.delete('/rules/:id', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'bad id' });
  const row = db.select().from(fwRules).where(eq(fwRules.id, id)).get();
  if (row) await applyRule(row, 'D').catch(() => {});
  db.delete(fwRules).where(eq(fwRules.id, id)).run();
  await persist();
  res.json({ ok: true });
});

export default router;
