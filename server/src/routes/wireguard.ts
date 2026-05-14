import { Router } from 'express';
import { z } from 'zod';
import QRCode from 'qrcode';
import { db } from '../db/client';
import { wgPeers, wgServer } from '../db/schema';
import { eq } from 'drizzle-orm';
import { addPeer, listPeers, removePeer, renderPeerConf, serverInfo, ensureServerAsync } from '../system/wireguard';

const router = Router();

router.get('/server', async (_req, res) => {
  await ensureServerAsync().catch(() => {});
  const s = serverInfo();
  res.json({
    server: s ? {
      publicKey: s.publicKey,
      listenPort: s.listenPort,
      tunnelCidr: s.tunnelCidr,
      mtu: s.mtu,
      publicEndpoint: s.publicEndpoint,
      dnsPush: s.dnsPush,
      defaultAllowedIps: s.defaultAllowedIps,
    } : null,
  });
});

router.patch('/server', async (req, res) => {
  const schema = z.object({
    listenPort: z.number().int().min(1).max(65535).optional(),
    tunnelCidr: z.string().optional(),
    mtu: z.number().int().min(576).max(9000).optional(),
    publicEndpoint: z.string().nullable().optional(),
    dnsPush: z.string().optional(),
    defaultAllowedIps: z.string().optional(),
  });
  const parse = schema.safeParse(req.body);
  if (!parse.success) return res.status(400).json({ error: 'invalid input', issues: parse.error.issues });
  const s = serverInfo();
  if (!s) return res.status(409).json({ error: 'server not initialized' });
  db.update(wgServer).set(parse.data).where(eq(wgServer.id, s.id)).run();
  res.json({ ok: true });
});

router.get('/peers', async (_req, res) => {
  res.json({ peers: await listPeers() });
});

const peerSchema = z.object({
  name: z.string().min(1),
  allowedIps: z.string().optional(),
  keepalive: z.number().int().min(0).max(3600).optional(),
  kind: z.enum(['road-warrior', 'site']).optional(),
  remoteSubnet: z.string().optional(),
  remoteEndpoint: z.string().optional(),
});

router.post('/peers', async (req, res) => {
  const parse = peerSchema.safeParse(req.body);
  if (!parse.success) return res.status(400).json({ error: 'invalid input', issues: parse.error.issues });
  try {
    await ensureServerAsync();
    const row = await addPeer(parse.data);
    res.json({ peer: row });
  } catch (err: any) {
    res.status(500).json({ error: err?.message ?? 'add failed' });
  }
});

router.delete('/peers/:id', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'bad id' });
  await removePeer(id);
  res.json({ ok: true });
});

router.get('/peers/:id/conf', (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'bad id' });
  const peer = db.select().from(wgPeers).where(eq(wgPeers.id, id)).get();
  if (!peer) return res.status(404).json({ error: 'not found' });
  const conf = renderPeerConf(id);
  res.setHeader('Content-Type', 'application/x-wireguard-conf');
  res.setHeader('Content-Disposition', `attachment; filename="${peer.name.replace(/[^a-zA-Z0-9._-]/g, '_')}.conf"`);
  res.send(conf);
});

router.get('/peers/:id/qr', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'bad id' });
  try {
    const conf = renderPeerConf(id);
    const png = await QRCode.toBuffer(conf, { type: 'png', errorCorrectionLevel: 'M', margin: 1, width: 480 });
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'no-store');
    res.send(png);
  } catch (err: any) {
    res.status(500).json({ error: err?.message ?? 'qr failed' });
  }
});

export default router;
