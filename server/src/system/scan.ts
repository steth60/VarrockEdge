import fs from 'node:fs';
import { exec } from './exec';
import { config } from '../config';
import { db } from '../db/client';
import { dhcpReservations, dhcpScope } from '../db/schema';
import { parseLeases } from './dnsmasq';
import { log } from '../logger';

/**
 * Passive liveness check — the IPs the kernel currently has a *complete* ARP
 * entry for (flags 0x2). No active sweep; just reads /proc/net/arp. Used to
 * mark DHCP clients online/offline cheaply.
 */
export function reachableIps(): Set<string> {
  if (!config.onLinux) return new Set(['10.0.0.5', '10.0.0.6', '10.0.0.30']);
  const set = new Set<string>();
  try {
    const raw = fs.readFileSync('/proc/net/arp', 'utf8');
    for (const line of raw.split('\n').slice(1)) {
      const p = line.trim().split(/\s+/);
      // IP address | HW type | Flags | HW address | Mask | Device
      if (p.length < 4) continue;
      if (p[0] && p[2] === '0x2' && p[3] && p[3] !== '00:00:00:00:00:00') set.add(p[0]);
    }
  } catch { /* arp table unavailable */ }
  return set;
}

export interface DiscoveredHost {
  ip: string;
  mac: string | null;
  hostname: string | null;
  /** 'lease' = appears in dnsmasq.leases (DHCP-managed)
   *  'reservation' = pinned in DB
   *  'static' = responds but isn't in either — likely manually configured */
  source: 'lease' | 'reservation' | 'static';
  responded: boolean;
}

function ipToInt(ip: string): number {
  return ip.split('.').reduce((a, o) => (a << 8) + Number(o), 0) >>> 0;
}
function intToIp(n: number): string {
  return [24, 16, 8, 0].map(s => (n >>> s) & 0xff).join('.');
}
function cidrRange(cidr: string): [number, number] | null {
  const m = /^(\d+\.\d+\.\d+\.\d+)\/(\d+)$/.exec(cidr);
  if (!m) return null;
  const base = ipToInt(m[1]!);
  const bits = Number(m[2]);
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  const start = (base & mask) >>> 0;
  const end = (start | (~mask >>> 0)) >>> 0;
  return [start + 1, end - 1]; // skip network + broadcast
}

async function ping(ip: string, timeoutMs = 700): Promise<boolean> {
  if (!config.onLinux) {
    // Synthetic responders on macOS dev: mock a handful of "static-IP" devices.
    return ['10.0.0.5', '10.0.0.6', '10.0.0.30'].includes(ip);
  }
  const wait = Math.max(1, Math.ceil(timeoutMs / 1000));
  try {
    const r = await exec('ping', ['-c', '1', '-W', String(wait), ip], { allowFailure: true, timeoutMs: timeoutMs + 500 });
    return r.code === 0;
  } catch { return false; }
}

interface ArpEntry { ip: string; mac: string; }

async function readArp(): Promise<ArpEntry[]> {
  if (!config.onLinux) {
    return [
      { ip: '10.0.0.5',  mac: '00:11:22:33:44:55' },
      { ip: '10.0.0.6',  mac: '00:aa:bb:cc:dd:ee' },
      { ip: '10.0.0.30', mac: '12:34:56:78:9a:bc' },
    ];
  }
  try {
    // /proc/net/arp is fastest and doesn't require root:
    // IP address       HW type     Flags       HW address            Mask     Device
    // 10.0.0.5         0x1         0x2         00:11:22:33:44:55     *        eth1
    const fs = await import('node:fs');
    const raw = fs.readFileSync('/proc/net/arp', 'utf8');
    const out: ArpEntry[] = [];
    for (const line of raw.split('\n').slice(1)) {
      const parts = line.trim().split(/\s+/);
      if (parts.length < 4) continue;
      const ip = parts[0];
      const mac = parts[3];
      if (!ip || !mac || mac === '00:00:00:00:00:00') continue;
      out.push({ ip, mac: mac.toLowerCase() });
    }
    return out;
  } catch { return []; }
}

/**
 * Sweep the LAN (DHCP scope's parent /24 by default) and return what responds.
 * Excludes the appliance's own LAN IP. Concurrency-limited so we don't melt small CTs.
 */
export async function scanLan(opts?: { cidr?: string; concurrency?: number }): Promise<{
  scanned: number;
  responded: number;
  hosts: DiscoveredHost[];
  cidr: string;
  durationMs: number;
}> {
  const t0 = Date.now();
  // Pick the network: VE_LAN_IFACE's /24, or scope-derived /24 if available.
  let cidr = opts?.cidr;
  if (!cidr) {
    const scope = db.select().from(dhcpScope).get();
    const base = scope?.gateway ?? '10.0.0.1';
    const parts = base.split('.');
    cidr = `${parts[0]}.${parts[1]}.${parts[2]}.0/24`;
  }
  const range = cidrRange(cidr);
  if (!range) throw new Error(`bad cidr: ${cidr}`);
  const [start, end] = range;

  const leases = parseLeases();
  const leaseByIp = new Map(leases.map(l => [l.ip, l]));
  const reservations = db.select().from(dhcpReservations).all();
  const resByIp = new Map(reservations.map(r => [r.ip, r]));

  // Sweep
  const concurrency = Math.max(1, Math.min(64, opts?.concurrency ?? 32));
  const ips: string[] = [];
  for (let n = start; n <= end; n++) ips.push(intToIp(n));

  const responded = new Set<string>();
  let scanned = 0;
  for (let i = 0; i < ips.length; i += concurrency) {
    const batch = ips.slice(i, i + concurrency);
    const results = await Promise.all(batch.map(async ip => ({ ip, up: await ping(ip) })));
    for (const r of results) {
      scanned++;
      if (r.up) responded.add(r.ip);
    }
  }

  // Sleep a beat so the kernel ARP cache is populated from successful pings.
  if (config.onLinux) await new Promise(r => setTimeout(r, 200));
  const arp = await readArp();
  const macByIp = new Map(arp.map(a => [a.ip, a.mac]));

  const hosts: DiscoveredHost[] = [];
  for (const ip of responded) {
    const lease = leaseByIp.get(ip);
    const res = resByIp.get(ip);
    const source: DiscoveredHost['source'] = res ? 'reservation' : lease ? 'lease' : 'static';
    hosts.push({
      ip,
      mac: res?.mac ?? lease?.mac ?? macByIp.get(ip) ?? null,
      hostname: res?.hostname ?? lease?.hostname ?? null,
      source,
      responded: true,
    });
  }
  // Sort by IP ascending
  hosts.sort((a, b) => ipToInt(a.ip) - ipToInt(b.ip));

  log.info({ cidr, scanned, responded: responded.size, durationMs: Date.now() - t0 }, 'lan.scan');
  return { scanned, responded: responded.size, hosts, cidr, durationMs: Date.now() - t0 };
}
