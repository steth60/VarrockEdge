import { Router } from 'express';
import { z } from 'zod';
import { upnpStatus, listMappings, setUpnpEnabled, deleteMapping } from '../system/upnp';
import { requireRole } from '../auth/middleware';

const router = Router();

router.get('/', async (_req, res) => {
  res.json({ ...(await upnpStatus()), mappings: listMappings() });
});

const patchSchema = z.object({ enabled: z.boolean() });

router.patch('/', requireRole('Owner'), async (req, res) => {
  const parse = patchSchema.safeParse(req.body);
  if (!parse.success) return res.status(400).json({ error: 'invalid input' });
  await setUpnpEnabled(parse.data.enabled);
  res.json({ ...(await upnpStatus()), mappings: listMappings() });
});

router.delete('/mappings/:proto/:eport', requireRole('Owner', 'Admin'), async (req, res) => {
  const proto = String(req.params.proto).toUpperCase();
  const eport = Number(req.params.eport);
  if ((proto !== 'TCP' && proto !== 'UDP') || !Number.isInteger(eport)) {
    return res.status(400).json({ error: 'bad mapping reference' });
  }
  const ok = await deleteMapping(proto, eport);
  if (!ok) return res.status(404).json({ error: 'mapping not found' });
  res.json({ ok: true });
});

export default router;
