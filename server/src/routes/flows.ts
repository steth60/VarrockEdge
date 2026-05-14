import { Router } from 'express';
import { desc, eq } from 'drizzle-orm';
import { db } from '../db/client';
import { flowTopClients, flowTopServices, flowTopDestinations, flowApps } from '../db/schema';

const router = Router();

router.get('/top', (req, res) => {
  const kind = String(req.query.kind ?? 'clients');
  const window = String(req.query.window ?? '1h');
  if (kind === 'clients') {
    const rows = db.select().from(flowTopClients)
      .where(eq(flowTopClients.window, window))
      .orderBy(desc(flowTopClients.bytes))
      .limit(8)
      .all();
    return res.json({ items: rows.map(r => ({ key: r.srcIp, label: r.srcIp, hint: r.srcIp, bytes: r.bytes, packets: r.packets })) });
  }
  if (kind === 'services') {
    const rows = db.select().from(flowTopServices)
      .where(eq(flowTopServices.window, window))
      .orderBy(desc(flowTopServices.bytes))
      .limit(8)
      .all();
    return res.json({ items: rows.map(r => ({ key: `${r.proto}:${r.dport}`, label: appNameLite(r.dport), hint: `${r.proto}:${r.dport}`, bytes: r.bytes, packets: r.packets })) });
  }
  if (kind === 'destinations') {
    const rows = db.select().from(flowTopDestinations)
      .where(eq(flowTopDestinations.window, window))
      .orderBy(desc(flowTopDestinations.bytes))
      .limit(8)
      .all();
    return res.json({ items: rows.map(r => ({ key: r.dstIp, label: r.dstIp, hint: r.countryHint ?? r.dstIp, bytes: r.bytes, packets: r.packets })) });
  }
  res.status(400).json({ error: 'bad kind' });
});

router.get('/apps', (req, res) => {
  const window = String(req.query.window ?? '1h');
  const rows = db.select().from(flowApps).where(eq(flowApps.window, window)).all();
  rows.sort((a, b) => (b.downBytes + b.upBytes) - (a.downBytes + a.upBytes));
  res.json({ apps: rows.slice(0, 10).map(r => ({ name: r.app, down: r.downBytes, up: r.upBytes })) });
});

function appNameLite(port: number): string {
  if (port === 443) return 'HTTPS';
  if (port === 80)  return 'HTTP';
  if (port === 53)  return 'DNS';
  if (port === 22 || port === 2222) return 'SSH';
  if (port === 51820) return 'WireGuard';
  if (port === 993) return 'IMAPS';
  if (port === 25 || port === 587 || port === 465) return 'SMTP';
  if (port === 25565) return 'Minecraft';
  return `port ${port}`;
}

export default router;
