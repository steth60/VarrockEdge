import { Router } from 'express';
import { z } from 'zod';
import { db } from '../db/client';
import { dhcpReservations, dhcpScope } from '../db/schema';
import { eq } from 'drizzle-orm';
import { parseLeases, reload } from '../system/dnsmasq';
import { scanLan } from '../system/scan';

const router = Router();

router.get('/leases', (_req, res) => {
  const leases = parseLeases();
  res.json({ leases });
});

router.get('/reservations', (_req, res) => {
  res.json({ reservations: db.select().from(dhcpReservations).all() });
});

const macRe = /^([0-9a-fA-F]{2}:){5}[0-9a-fA-F]{2}$/;
const ipRe = /^(\d{1,3}\.){3}\d{1,3}$/;

const reservationSchema = z.object({
  hostname: z.string().min(1).max(63),
  mac: z.string().regex(macRe),
  ip: z.string().regex(ipRe),
  lease: z.string().default('24h'),
  comment: z.string().optional(),
});

router.post('/reservations', async (req, res) => {
  const parse = reservationSchema.safeParse(req.body);
  if (!parse.success) return res.status(400).json({ error: 'invalid input', issues: parse.error.issues });
  try {
    const row = db.insert(dhcpReservations).values({
      ...parse.data,
      mac: parse.data.mac.toLowerCase(),
    }).returning().get();
    await reload();
    res.json({ reservation: row });
  } catch (err: any) {
    if (String(err?.message).includes('UNIQUE')) return res.status(409).json({ error: 'mac already reserved' });
    res.status(500).json({ error: 'insert failed' });
  }
});

router.delete('/reservations/:id', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'bad id' });
  db.delete(dhcpReservations).where(eq(dhcpReservations.id, id)).run();
  await reload();
  res.json({ ok: true });
});

router.get('/scope', (_req, res) => {
  res.json({ scope: db.select().from(dhcpScope).get() });
});

const scopeSchema = z.object({
  rangeStart: z.string().regex(ipRe),
  rangeEnd: z.string().regex(ipRe),
  leaseTime: z.string(),
  gateway: z.string().regex(ipRe),
  dnsServers: z.string(),
  domain: z.string(),
});

router.patch('/scope', async (req, res) => {
  const parse = scopeSchema.partial().safeParse(req.body);
  if (!parse.success) return res.status(400).json({ error: 'invalid input', issues: parse.error.issues });
  const current = db.select().from(dhcpScope).get();
  if (!current) {
    db.insert(dhcpScope).values(parse.data as any).run();
  } else {
    db.update(dhcpScope).set(parse.data).where(eq(dhcpScope.id, current.id)).run();
  }
  await reload();
  res.json({ scope: db.select().from(dhcpScope).get() });
});

router.post('/scan', async (req, res) => {
  const cidr = typeof req.body?.cidr === 'string' ? req.body.cidr : undefined;
  try {
    const r = await scanLan({ cidr });
    res.json(r);
  } catch (err: any) {
    res.status(400).json({ error: err?.message ?? 'scan failed' });
  }
});

export default router;
