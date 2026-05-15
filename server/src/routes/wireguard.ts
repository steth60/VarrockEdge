import { Router } from 'express';
import { z } from 'zod';
import QRCode from 'qrcode';
import { db } from '../db/client';
import { wgPeers, wgServer } from '../db/schema';
import { eq } from 'drizzle-orm';
import { addPeer, listPeers, removePeer, renderPeerConf, serverInfo, ensureServerAsync, rotateServerKeys, wipe, restart, renderRemotePeerSnippet, writeServerConfig, reload, importPeerFromConfig } from '../system/wireguard';

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
  // Re-render so changes show up in current peer .conf downloads and the live tunnel.
  await writeServerConfig();
  await reload();
  res.json({ server: serverInfo() });
});

// ─── Danger zone ────────────────────────────────────────────────────
router.post('/restart', async (_req, res) => {
  try { await restart(); res.json({ ok: true }); }
  catch (err: any) { res.status(500).json({ error: err?.message ?? 'restart failed' }); }
});

router.post('/server/rotate', async (_req, res) => {
  try { const r = await rotateServerKeys(); res.json({ ok: true, publicKey: r.publicKey }); }
  catch (err: any) { res.status(500).json({ error: err?.message ?? 'rotate failed' }); }
});

router.delete('/server', async (_req, res) => {
  try { await wipe(); res.json({ ok: true }); }
  catch (err: any) { res.status(500).json({ error: err?.message ?? 'wipe failed' }); }
});

// ─── Site-to-site ───────────────────────────────────────────────────
router.get('/sites', async (_req, res) => {
  const peers = await listPeers();
  res.json({ sites: peers.filter(p => p.kind === 'site') });
});

const siteSchema = z.object({
  name: z.string().min(1),
  remoteSubnet: z.string().regex(/^(\d{1,3}\.){3}\d{1,3}\/\d{1,2}$/, 'expected CIDR like 10.20.0.0/24'),
  remotePublicKey: z.string().min(40),
  remoteEndpoint: z.string().optional(),
  presharedKey: z.string().optional(),
  keepalive: z.number().int().min(0).max(3600).optional(),
});

router.post('/sites', async (req, res) => {
  const parse = siteSchema.safeParse(req.body);
  if (!parse.success) return res.status(400).json({ error: 'invalid input', issues: parse.error.issues });
  try {
    await ensureServerAsync();
    const row = await addPeer({
      name: parse.data.name,
      kind: 'site',
      remoteSubnet: parse.data.remoteSubnet,
      remoteEndpoint: parse.data.remoteEndpoint || undefined,
      providedPublicKey: parse.data.remotePublicKey,
      providedPresharedKey: parse.data.presharedKey,
      keepalive: parse.data.keepalive,
    });
    res.json({ site: row });
  } catch (err: any) {
    res.status(400).json({ error: err?.message ?? 'failed' });
  }
});

router.delete('/sites/:id', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'bad id' });
  await removePeer(id);
  res.json({ ok: true });
});

router.get('/sites/:id/remote-config', (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'bad id' });
  try {
    const snippet = renderRemotePeerSnippet(id);
    res.setHeader('Content-Type', 'text/plain');
    res.setHeader('Content-Disposition', `attachment; filename="remote-peer-${id}.conf"`);
    res.send(snippet);
  } catch (err: any) {
    res.status(404).json({ error: err?.message ?? 'not found' });
  }
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

router.post('/peers/import', async (req, res) => {
  const schema = z.object({
    name: z.string().min(1),
    config: z.string().min(20),
  });
  const parse = schema.safeParse(req.body);
  if (!parse.success) return res.status(400).json({ error: 'invalid input', issues: parse.error.issues });
  try {
    await ensureServerAsync();
    const r = await importPeerFromConfig(parse.data.name, parse.data.config);
    res.json(r);
  } catch (err: any) {
    res.status(400).json({ error: err?.message ?? 'import failed' });
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
