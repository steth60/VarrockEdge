import { Router } from 'express';
import { z } from 'zod';
import { db } from '../db/client';
import { settings } from '../db/schema';
import { eq } from 'drizzle-orm';
import { config } from '../config';
import os from 'node:os';

const router = Router();

router.get('/', (_req, res) => {
  const rows = db.select().from(settings).all();
  const map: Record<string, string> = {};
  for (const r of rows) map[r.key] = r.value;
  res.json({ settings: map });
});

const patchSchema = z.record(z.string(), z.string());

router.patch('/', (req, res) => {
  const parse = patchSchema.safeParse(req.body);
  if (!parse.success) return res.status(400).json({ error: 'invalid input' });
  for (const [k, v] of Object.entries(parse.data)) {
    const existing = db.select().from(settings).where(eq(settings.key, k)).get();
    if (existing) db.update(settings).set({ value: v, updatedAt: new Date() }).where(eq(settings.key, k)).run();
    else db.insert(settings).values({ key: k, value: v }).run();
  }
  res.json({ ok: true });
});

router.get('/about', (_req, res) => {
  res.json({
    product: 'VarrokEdge',
    version: '0.9.2',
    build: 1187,
    channel: 'stable',
    container: 'ct-104',
    kernel: os.release(),
    hostname: os.hostname(),
    uptime: os.uptime(),
    onLinux: config.onLinux,
  });
});

export default router;
