import { Router } from 'express';
import { z } from 'zod';
import { listServices, action as svcAction, journalTail, checkRequirements } from '../system/systemd';

const router = Router();

router.get('/', async (_req, res) => {
  res.json({ services: await listServices() });
});

router.get('/requirements', async (_req, res) => {
  res.json({ requirements: await checkRequirements() });
});

const actionSchema = z.object({
  action: z.enum(['start', 'stop', 'restart', 'reload', 'enable', 'disable']),
});

router.post('/:unit/action', async (req, res) => {
  const parse = actionSchema.safeParse(req.body);
  if (!parse.success) return res.status(400).json({ error: 'invalid action' });
  try {
    await svcAction(req.params.unit, parse.data.action);
    res.json({ ok: true });
  } catch (err: any) {
    res.status(400).json({ error: err?.message ?? 'failed' });
  }
});

router.get('/:unit/journal', async (req, res) => {
  const lines = Math.min(200, Number(req.query.lines ?? 30));
  try {
    res.json({ lines: await journalTail(req.params.unit, lines) });
  } catch (err: any) {
    res.status(400).json({ error: err?.message ?? 'failed' });
  }
});

export default router;
