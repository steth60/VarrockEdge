import { db } from '../db/client';
import { networks } from '../db/schema';
import type { Network } from '../db/schema';
import { eq } from 'drizzle-orm';
import { config } from '../config';
import { exec } from './exec';
import { parseLeases, reload as dnsmasqReload } from './dnsmasq';
import { log } from '../logger';

// ─── CIDR helpers ───────────────────────────────────────────────────
export function prefixOf(subnet: string): number {
  const p = Number(subnet.split('/')[1]);
  return Number.isFinite(p) && p >= 0 && p <= 32 ? p : 24;
}

function ipToInt(ip: string): number | null {
  const parts = ip.trim().split('.').map(Number);
  if (parts.length !== 4 || parts.some(n => !Number.isInteger(n) || n < 0 || n > 255)) return null;
  return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
}

export function ipInSubnet(ip: string, subnet: string): boolean {
  const [base, prefixStr] = subnet.split('/');
  const ipInt = ipToInt(ip);
  const baseInt = ipToInt(base ?? '');
  if (ipInt === null || baseInt === null) return false;
  const prefix = Number(prefixStr);
  if (!Number.isFinite(prefix) || prefix < 0 || prefix > 32) return false;
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return (ipInt & mask) === (baseInt & mask);
}

/** Usable host count for a subnet (network + broadcast excluded). */
export function usableHosts(subnet: string): number {
  const prefix = prefixOf(subnet);
  if (prefix >= 31) return 0;
  return Math.pow(2, 32 - prefix) - 2;
}

export function vlanIfaceName(n: Pick<Network, 'iface' | 'vlanId'>): string {
  return n.vlanId ? `${n.iface}.${n.vlanId}` : n.iface;
}

export function getDefaultNetwork(): Network | undefined {
  return db.select().from(networks).where(eq(networks.isDefault, true)).get()
      ?? db.select().from(networks).all()[0];
}

// ─── VLAN interface lifecycle (dual-mode via exec) ──────────────────
/**
 * Ensure the VLAN sub-interface for a network exists, carries the gateway
 * address, and is up. Native/untagged networks (vlanId NULL) are left alone —
 * the base interface is owned by the host OS.
 */
export async function ensureNetworkIface(n: Network): Promise<void> {
  if (!n.vlanId) return;
  const dev = vlanIfaceName(n);
  const present = await exec('ip', ['link', 'show', dev], { allowFailure: true });
  if (present.code !== 0) {
    await exec('ip', ['link', 'add', 'link', n.iface, 'name', dev, 'type', 'vlan', 'id', String(n.vlanId)], { allowFailure: true });
  }
  await exec('ip', ['addr', 'add', `${n.gateway}/${prefixOf(n.subnet)}`, 'dev', dev], { allowFailure: true });
  await exec('ip', ['link', 'set', dev, 'up'], { allowFailure: true });
  log.info({ dev, vlan: n.vlanId }, 'network iface ensured');
}

/** Tear down a network's VLAN sub-interface. Never touches a base interface. */
export async function removeNetworkIface(n: Pick<Network, 'iface' | 'vlanId'>): Promise<void> {
  if (!n.vlanId) return;
  const dev = vlanIfaceName(n);
  await exec('ip', ['link', 'set', dev, 'down'], { allowFailure: true });
  await exec('ip', ['link', 'del', dev], { allowFailure: true });
  log.info({ dev }, 'network iface removed');
}

/**
 * Reconcile live VLAN interfaces with the DB: create the ones we expect,
 * delete orphaned `<base>.<vlan>` children that no enabled network claims.
 */
export async function syncNetworks(): Promise<void> {
  const rows = db.select().from(networks).all();
  for (const n of rows) {
    if (n.enabled && n.vlanId) await ensureNetworkIface(n).catch(err => log.warn({ err, id: n.id }, 'ensureNetworkIface failed'));
  }
  if (!config.onLinux) return;
  // Orphan cleanup — scoped strictly to `.NNN` children of known base ifaces.
  const bases = new Set(rows.map(r => r.iface));
  const wanted = new Set(rows.filter(r => r.enabled && r.vlanId).map(r => vlanIfaceName(r)));
  try {
    const live = await exec('ip', ['-o', 'link', 'show'], { allowFailure: true });
    for (const line of live.stdout.split('\n')) {
      const m = /^\d+:\s+([^:@\s]+)/.exec(line);
      const dev = m?.[1];
      if (!dev) continue;
      const dot = dev.lastIndexOf('.');
      if (dot < 0) continue;
      const base = dev.slice(0, dot);
      const vlan = dev.slice(dot + 1);
      if (bases.has(base) && /^\d+$/.test(vlan) && !wanted.has(dev)) {
        log.info({ dev }, 'pruning orphan VLAN iface');
        await exec('ip', ['link', 'del', dev], { allowFailure: true });
      }
    }
  } catch (err) {
    log.warn({ err }, 'orphan VLAN scan failed');
  }
}

/** Sync interfaces then regenerate + reload dnsmasq. Order matters: dnsmasq
 *  binds to each `interface=` line, so the ifaces must exist first. */
export async function applyNetworks(): Promise<void> {
  await syncNetworks();
  await dnsmasqReload();
}

// ─── Listing with live status + lease usage ─────────────────────────
export interface NetworkWithStatus extends Network {
  vlanIface: string;
  link: 'up' | 'down' | 'synthetic';
  leasesUsed: number;
  leasesTotal: number;
  leasesAvailable: number;
}

export async function listNetworks(): Promise<NetworkWithStatus[]> {
  const rows = db.select().from(networks).all();
  const leases = parseLeases();
  let linkState = new Map<string, boolean>();
  if (config.onLinux) {
    try {
      const live = await exec('ip', ['-o', 'link', 'show'], { allowFailure: true });
      for (const line of live.stdout.split('\n')) {
        const m = /^\d+:\s+([^:@\s]+).*\sstate\s+(\S+)/.exec(line);
        if (m) linkState.set(m[1]!, m[2] === 'UP' || /\bUP\b/.test(line));
      }
    } catch { /* leave map empty */ }
  }
  return rows.map(n => {
    const dev = vlanIfaceName(n);
    const total = n.dhcpEnabled ? rangeSize(n.dhcpStart, n.dhcpEnd) : usableHosts(n.subnet);
    const used = leases.filter(l => ipInSubnet(l.ip, n.subnet)).length;
    const link: NetworkWithStatus['link'] = !config.onLinux
      ? 'synthetic'
      : (linkState.get(dev) ? 'up' : 'down');
    return {
      ...n,
      vlanIface: dev,
      link,
      leasesUsed: used,
      leasesTotal: total,
      leasesAvailable: Math.max(0, total - used),
    };
  });
}

function rangeSize(start: string, end: string): number {
  const a = ipToInt(start);
  const b = ipToInt(end);
  if (a === null || b === null || b < a) return 0;
  return b - a + 1;
}

// ─── CRUD ───────────────────────────────────────────────────────────
export interface NetworkInput {
  name: string;
  vlanId?: number | null;
  iface?: string;
  subnet: string;
  gateway: string;
  dhcpEnabled?: boolean;
  dhcpStart: string;
  dhcpEnd: string;
  leaseTime?: string;
  dnsServers?: string;
  domain?: string;
  purpose?: string;
  enabled?: boolean;
}

export async function createNetwork(input: NetworkInput): Promise<Network> {
  const row = db.insert(networks).values({
    name: input.name,
    vlanId: input.vlanId ?? null,
    iface: input.iface ?? config.lanIface,
    subnet: input.subnet,
    gateway: input.gateway,
    dhcpEnabled: input.dhcpEnabled ?? true,
    dhcpStart: input.dhcpStart,
    dhcpEnd: input.dhcpEnd,
    leaseTime: input.leaseTime ?? '24h',
    dnsServers: input.dnsServers ?? '1.1.1.1',
    domain: input.domain ?? 'varrok.local',
    purpose: input.purpose ?? 'corporate',
    enabled: input.enabled ?? true,
    isDefault: false,
    createdAt: Date.now(),
  }).returning().get();
  await applyNetworks();
  return row;
}

export async function updateNetwork(id: number, patch: Partial<NetworkInput>): Promise<Network | undefined> {
  const before = db.select().from(networks).where(eq(networks.id, id)).get();
  if (!before) return undefined;
  // Recreate the iface from scratch if anything iface-shaping changed.
  const ifaceTouched = ['vlanId', 'iface', 'gateway', 'subnet', 'enabled'].some(k => k in patch);
  if (ifaceTouched) await removeNetworkIface(before).catch(() => {});
  db.update(networks).set(patch).where(eq(networks.id, id)).run();
  await applyNetworks();
  return db.select().from(networks).where(eq(networks.id, id)).get();
}

export async function deleteNetwork(id: number): Promise<{ ok: boolean; reason?: string }> {
  const row = db.select().from(networks).where(eq(networks.id, id)).get();
  if (!row) return { ok: false, reason: 'not found' };
  if (row.isDefault) return { ok: false, reason: 'cannot delete the default network' };
  await removeNetworkIface(row).catch(() => {});
  db.delete(networks).where(eq(networks.id, id)).run();
  await applyNetworks();
  return { ok: true };
}
