import { Router } from 'express';
import { z } from 'zod';
import { db } from '../db/client';
import { dhcpReservations, networks, dnsRecords, flowTopClients } from '../db/schema';
import { eq } from 'drizzle-orm';
import { parseLeases, reload } from '../system/dnsmasq';
import { scanLan, reachableIps } from '../system/scan';
import { getDefaultNetwork, ipInSubnet, applyNetworks } from '../system/network';
import { zIp, zMac, zLease, zComment, zIpList, zHostname, HOSTNAME } from '../validators';

const router = Router();

router.get('/leases', (_req, res) => {
  const nets = db.select().from(networks).all();
  // Annotate each lease with the network whose subnet contains its IP, so the
  // DHCP page can filter clients by VLAN.
  const leases = parseLeases().map(l => {
    const net = nets.find(n => ipInSubnet(l.ip, n.subnet));
    return { ...l, networkId: net?.id ?? null, networkName: net?.name ?? null, vlanId: net?.vlanId ?? null };
  });
  res.json({ leases });
});

router.get('/reservations', (_req, res) => {
  const nets = db.select().from(networks).all();
  const reservations = db.select().from(dhcpReservations).all().map(r => {
    const net = nets.find(n => ipInSubnet(r.ip, n.subnet));
    return { ...r, networkName: net?.name ?? null, vlanId: net?.vlanId ?? null };
  });
  res.json({ reservations });
});

export interface DhcpClient {
  hostname: string;
  ip: string;
  mac: string;
  networkId: number | null;
  networkName: string | null;
  vlanId: number | null;
  leaseType: 'dynamic' | 'fixed';
  status: 'online' | 'offline';
  expiresAt: number | null;
  localDns: string | null;
  traffic1h: number | null;   // bytes seen by conntrack over the last hour
}

// Unified client list — every DHCP lease + every reservation, merged on MAC,
// annotated with network, status, local DNS and recent traffic.
router.get('/clients', (_req, res) => {
  const nets = db.select().from(networks).all();
  const dns = db.select().from(dnsRecords).all();
  const flows = db.select().from(flowTopClients).where(eq(flowTopClients.window, '1h')).all();
  const live = reachableIps();
  const flowByIp = new Map(flows.map(f => [f.srcIp, f.bytes]));
  const netOf = (ip: string) => nets.find(n => ipInSubnet(ip, n.subnet));
  const dnsOf = (ip: string) => dns.find(r => r.target === ip)?.host ?? null;

  const byMac = new Map<string, DhcpClient>();
  // Reservations first — these are the "fixed" clients.
  for (const r of db.select().from(dhcpReservations).all()) {
    const net = netOf(r.ip);
    byMac.set(r.mac.toLowerCase(), {
      hostname: r.hostname, ip: r.ip, mac: r.mac.toLowerCase(),
      networkId: net?.id ?? null, networkName: net?.name ?? null, vlanId: net?.vlanId ?? null,
      leaseType: 'fixed', status: 'offline', expiresAt: null,
      localDns: dnsOf(r.ip), traffic1h: flowByIp.get(r.ip) ?? null,
    });
  }
  // Active leases — fill in dynamic clients, and the live IP/expiry for fixed ones.
  for (const l of parseLeases()) {
    const mac = l.mac.toLowerCase();
    const existing = byMac.get(mac);
    if (existing) {
      existing.ip = l.ip;
      existing.expiresAt = l.expiresAt;
      existing.localDns = dnsOf(l.ip);
      existing.traffic1h = flowByIp.get(l.ip) ?? existing.traffic1h;
    } else {
      const net = netOf(l.ip);
      byMac.set(mac, {
        hostname: l.hostname, ip: l.ip, mac,
        networkId: net?.id ?? null, networkName: net?.name ?? null, vlanId: net?.vlanId ?? null,
        leaseType: 'dynamic', status: 'offline', expiresAt: l.expiresAt,
        localDns: dnsOf(l.ip), traffic1h: flowByIp.get(l.ip) ?? null,
      });
    }
  }
  // Online = a complete ARP entry, or recent conntrack activity.
  for (const c of byMac.values()) {
    c.status = (live.has(c.ip) || flowByIp.has(c.ip)) ? 'online' : 'offline';
  }
  res.json({ clients: [...byMac.values()] });
});

const reservationSchema = z.object({
  hostname: z.string().min(1).max(63).regex(HOSTNAME, 'invalid hostname'),
  mac: zMac,
  ip: zIp,
  lease: zLease.default('24h'),
  comment: zComment.optional(),
  networkId: z.number().int().nullable().optional(),
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

// `/scope` is a back-compat view over the *default* network — the legacy DHCP
// page edits the primary scope here while VLAN networks are managed via
// /api/networks. Both write to the same `networks` row so they never diverge.
function scopeView() {
  const net = getDefaultNetwork();
  if (!net) return null;
  return {
    id: net.id,
    rangeStart: net.dhcpStart,
    rangeEnd: net.dhcpEnd,
    leaseTime: net.leaseTime,
    gateway: net.gateway,
    dnsServers: net.dnsServers,
    domain: net.domain,
  };
}

router.get('/scope', (_req, res) => {
  res.json({ scope: scopeView() });
});

const scopeSchema = z.object({
  rangeStart: zIp,
  rangeEnd: zIp,
  leaseTime: zLease,
  gateway: zIp,
  dnsServers: zIpList,
  domain: zHostname,
});

router.patch('/scope', async (req, res) => {
  const parse = scopeSchema.partial().safeParse(req.body);
  if (!parse.success) return res.status(400).json({ error: 'invalid input', issues: parse.error.issues });
  const net = getDefaultNetwork();
  if (!net) return res.status(409).json({ error: 'no default network' });
  const p = parse.data;
  db.update(networks).set({
    ...(p.rangeStart !== undefined ? { dhcpStart: p.rangeStart } : {}),
    ...(p.rangeEnd !== undefined ? { dhcpEnd: p.rangeEnd } : {}),
    ...(p.leaseTime !== undefined ? { leaseTime: p.leaseTime } : {}),
    ...(p.gateway !== undefined ? { gateway: p.gateway } : {}),
    ...(p.dnsServers !== undefined ? { dnsServers: p.dnsServers } : {}),
    ...(p.domain !== undefined ? { domain: p.domain } : {}),
  }).where(eq(networks.id, net.id)).run();
  await applyNetworks();
  res.json({ scope: scopeView() });
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
