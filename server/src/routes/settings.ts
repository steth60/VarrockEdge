import { Router } from 'express';
import { z } from 'zod';
import { db } from '../db/client';
import { settings } from '../db/schema';
import { eq } from 'drizzle-orm';
import { config } from '../config';
import { requireRole } from '../auth/middleware';
import os from 'node:os';

const router = Router();

// These setting namespaces drive privileged behaviour — `upnp.enabled`, for
// example, is read by the firewall layer to decide whether to open the WAN
// UPnP hole. They must only be changed through their dedicated, role-gated
// routes (e.g. /api/upnp), never via the generic key/value PATCH below.
const PROTECTED_SETTING_PREFIXES = ['upnp.', 'security.', 'auth.', 'session.'];

router.get('/', (_req, res) => {
  const rows = db.select().from(settings).all();
  const map: Record<string, string> = {};
  for (const r of rows) map[r.key] = r.value;
  res.json({ settings: map });
});

const patchSchema = z.record(z.string(), z.string());

router.patch('/', requireRole('Owner', 'Admin'), (req, res) => {
  const parse = patchSchema.safeParse(req.body);
  if (!parse.success) return res.status(400).json({ error: 'invalid input' });
  for (const k of Object.keys(parse.data)) {
    if (k.length > 64 || PROTECTED_SETTING_PREFIXES.some(p => k.startsWith(p))) {
      return res.status(403).json({ error: `setting key not allowed here: ${k}` });
    }
  }
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
