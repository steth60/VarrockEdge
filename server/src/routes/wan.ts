import { Router } from 'express';
import { z } from 'zod';
import { listWans, addWan, patchWan, removeWan, wanHistory } from '../system/wan';
import { requireRole } from '../auth/middleware';

const router = Router();

router.get('/', (_req, res) => {
  res.json({ wans: listWans() });
});

const createSchema = z.object({
  iface: z.string().min(1).max(32).regex(/^[a-zA-Z0-9._:-]+$/),
  label: z.string().min(1),
  role: z.enum(['primary', 'failover', 'snat-only']).optional(),
  priority: z.number().int().min(1).max(1000).optional(),
  healthTarget: z.string().min(1).optional(),
});

router.post('/', requireRole('Owner'), (req, res) => {
  const parse = createSchema.safeParse(req.body);
  if (!parse.success) return res.status(400).json({ error: 'invalid input', issues: parse.error.issues });
  try {
    const row = addWan(parse.data);
    res.json({ wan: row });
  } catch (err: any) {
    if (String(err?.message).includes('UNIQUE')) return res.status(409).json({ error: 'iface already exists' });
    res.status(500).json({ error: err?.message ?? 'failed' });
  }
});

const patchSchema = z.object({
  label: z.string().optional(),
  role: z.enum(['primary', 'failover', 'snat-only']).optional(),
  priority: z.number().int().min(1).max(1000).optional(),
  healthTarget: z.string().optional(),
  enabled: z.boolean().optional(),
});

router.patch('/:id', requireRole('Owner', 'Admin'), (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'bad id' });
  const parse = patchSchema.safeParse(req.body);
  if (!parse.success) return res.status(400).json({ error: 'invalid input' });
  patchWan(id, parse.data);
  res.json({ ok: true });
});

router.delete('/:id', requireRole('Owner'), (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'bad id' });
  removeWan(id);
  res.json({ ok: true });
});

router.get('/:iface/history', (req, res) => {
  const iface = req.params.iface;
  const range = (req.query.range === '24h' ? '24h' : '1h') as '1h' | '24h';
  res.json({ history: wanHistory(iface, range) });
});

export default router;
