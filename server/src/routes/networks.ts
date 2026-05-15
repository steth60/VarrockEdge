import { Router } from 'express';
import { z } from 'zod';
import { listNetworks, createNetwork, updateNetwork, deleteNetwork } from '../system/network';
import { db } from '../db/client';
import { networks } from '../db/schema';
import { eq } from 'drizzle-orm';
import { requireRole } from '../auth/middleware';

const router = Router();

const ipRe = /^(\d{1,3}\.){3}\d{1,3}$/;
const cidrRe = /^(\d{1,3}\.){3}\d{1,3}\/\d{1,2}$/;
const ifaceRe = /^[a-zA-Z0-9._:-]+$/;

router.get('/', async (_req, res) => {
  res.json({ networks: await listNetworks() });
});

const createSchema = z.object({
  name: z.string().min(1).max(48),
  vlanId: z.number().int().min(1).max(4094).nullable().optional(),
  iface: z.string().min(1).max(32).regex(ifaceRe).optional(),
  subnet: z.string().regex(cidrRe),
  gateway: z.string().regex(ipRe),
  dhcpEnabled: z.boolean().optional(),
  dhcpStart: z.string().regex(ipRe),
  dhcpEnd: z.string().regex(ipRe),
  leaseTime: z.string().optional(),
  dnsServers: z.string().optional(),
  domain: z.string().optional(),
  purpose: z.enum(['corporate', 'guest', 'iot', 'management']).optional(),
  enabled: z.boolean().optional(),
});

router.post('/', requireRole('Owner'), async (req, res) => {
  const parse = createSchema.safeParse(req.body);
  if (!parse.success) return res.status(400).json({ error: 'invalid input', issues: parse.error.issues });
  try {
    const row = await createNetwork(parse.data);
    res.json({ network: row });
  } catch (err: any) {
    if (String(err?.message).includes('UNIQUE')) {
      return res.status(409).json({ error: 'a network with this VLAN ID already exists on that interface' });
    }
    res.status(500).json({ error: err?.message ?? 'failed' });
  }
});

const patchSchema = createSchema.partial();

router.patch('/:id', requireRole('Owner', 'Admin'), async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'bad id' });
  const parse = patchSchema.safeParse(req.body);
  if (!parse.success) return res.status(400).json({ error: 'invalid input', issues: parse.error.issues });
  const existing = db.select().from(networks).where(eq(networks.id, id)).get();
  if (!existing) return res.status(404).json({ error: 'not found' });
  if (existing.isDefault && parse.data.enabled === false) {
    return res.status(409).json({ error: 'the default network cannot be disabled' });
  }
  try {
    const row = await updateNetwork(id, parse.data);
    res.json({ network: row });
  } catch (err: any) {
    if (String(err?.message).includes('UNIQUE')) {
      return res.status(409).json({ error: 'a network with this VLAN ID already exists on that interface' });
    }
    res.status(500).json({ error: err?.message ?? 'failed' });
  }
});

router.delete('/:id', requireRole('Owner'), async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'bad id' });
  const r = await deleteNetwork(id);
  if (!r.ok) return res.status(r.reason === 'not found' ? 404 : 409).json({ error: r.reason });
  res.json({ ok: true });
});

export default router;
