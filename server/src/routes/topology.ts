import { Router } from 'express';
import os from 'node:os';
import { db } from '../db/client';
import { dhcpReservations, fwSnat, wgServer } from '../db/schema';
import { parseLeases } from '../system/dnsmasq';
import { listPeers } from '../system/wireguard';
import { getIface } from '../system/metrics';
import { config } from '../config';

const router = Router();

router.get('/', async (_req, res) => {
  const leases = parseLeases();
  const reservations = db.select().from(dhcpReservations).all();
  const peers = await listPeers();
  const snat = db.select().from(fwSnat).all();
  const server = db.select().from(wgServer).get();

  // Build LAN hosts — leases ∪ reservations (reservation overrides lease hostname).
  const lanMap = new Map<string, { mac: string; ip: string; hostname: string; source: 'lease' | 'reservation' }>();
  for (const l of leases) lanMap.set(l.mac, { mac: l.mac, ip: l.ip, hostname: l.hostname, source: 'lease' });
  for (const r of reservations) lanMap.set(r.mac, { mac: r.mac, ip: r.ip, hostname: r.hostname, source: 'reservation' });
  const lanHosts = [...lanMap.values()];

  // Interface info — best-effort.
  const ifs = os.networkInterfaces();
  const v4 = (name: string) => (ifs[name] ?? []).find(a => a.family === 'IPv4');
  const wanV4 = v4(config.wanIface);
  const lanV4 = v4(config.lanIface);
  const wanT = getIface(config.wanIface);
  const lanT = getIface(config.lanIface);

  // SNAT-published WAN IPs (de-dup the to_source list).
  const wanIps = new Set<string>();
  if (wanV4) wanIps.add(wanV4.address);
  for (const r of snat) if (r.toSource) wanIps.add(r.toSource);

  res.json({
    wan: {
      iface: config.wanIface,
      ip: wanV4 ? wanV4.address : null,
      gateway: null, // not derivable from JS API alone
      rxMbps: wanT.rxMbps,
      txMbps: wanT.txMbps,
      addresses: [...wanIps].map(ip => ({ ip, role: ip === wanV4?.address ? 'primary' : 'snat' })),
    },
    lan: {
      iface: config.lanIface,
      ip: lanV4 ? lanV4.address : '10.0.0.1',
      cidr: '10.0.0.0/24',
      rxMbps: lanT.rxMbps,
      txMbps: lanT.txMbps,
      hosts: lanHosts,
    },
    vpn: {
      cidr: server?.tunnelCidr ?? '10.10.0.0/24',
      port: server?.listenPort ?? 51820,
      peers: peers.map(p => ({
        id: p.id,
        name: p.name,
        allowedIps: p.allowedIps,
        status: p.status,
        kind: p.kind,
        endpoint: p.endpoint,
        rxBytes: p.rxBytes,
        txBytes: p.txBytes,
      })),
    },
    edge: {
      hostname: os.hostname(),
      version: '0.9.2',
      container: 'ct-104',
      uptime: os.uptime(),
    },
    ts: Date.now(),
  });
});

export default router;
