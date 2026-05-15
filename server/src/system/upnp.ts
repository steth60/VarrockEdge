import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { exec } from './exec';
import { config } from '../config';
import { db } from '../db/client';
import { networks, settings } from '../db/schema';
import { eq } from 'drizzle-orm';
import { action } from './systemd';
import { log } from '../logger';
import { noNewline } from '../validators';

const CONF_DIR = config.onLinux ? '/etc/miniupnpd' : path.join(config.configDir, 'miniupnpd');
const CONF_FILE = path.join(CONF_DIR, 'miniupnpd.conf');
const LEASE_FILE = config.onLinux ? '/var/lib/miniupnpd/upnp.leases' : path.join(config.configDir, 'upnp.leases');

// ─── settings k/v helpers ───────────────────────────────────────────
function getSetting(key: string): string | undefined {
  return db.select().from(settings).where(eq(settings.key, key)).get()?.value;
}
function setSetting(key: string, value: string): void {
  const existing = db.select().from(settings).where(eq(settings.key, key)).get();
  if (existing) db.update(settings).set({ value, updatedAt: new Date() }).where(eq(settings.key, key)).run();
  else db.insert(settings).values({ key, value }).run();
}

export function isUpnpEnabled(): boolean {
  return getSetting('upnp.enabled') === '1';
}

/** Stable device UUID — generated once, then persisted. */
function getUuid(): string {
  let u = getSetting('upnp.uuid');
  if (!u) { u = crypto.randomUUID(); setSetting('upnp.uuid', u); }
  return u;
}

function allowedNetworks() {
  return db.select().from(networks).all().filter(n => n.enabled && n.upnpAllowed);
}

function vlanIface(n: { iface: string; vlanId: number | null }): string {
  return n.vlanId ? `${n.iface}.${n.vlanId}` : n.iface;
}

// ─── config rendering ───────────────────────────────────────────────
export function renderConfig(): string {
  const nets = allowedNetworks();
  const lines = [
    '# Managed by VarrokEdge — do not edit by hand.',
    `ext_ifname=${noNewline(config.wanIface, 'wanIface')}`,
    'enable_upnp=yes',
    'enable_natpmp=yes',
    'secure_mode=yes',          // a client may only map a port to its OWN ip
    'system_uptime=yes',
    `lease_file=${LEASE_FILE}`,
    `uuid=${getUuid()}`,
    'friendly_name=VarrokEdge',
    'model_name=VarrokEdge',
    'notify_interval=60',
    'clean_ruleset_interval=600',
  ];
  // Listen only on the VLAN interfaces that opted in.
  for (const n of nets) lines.push(`listening_ip=${noNewline(vlanIface(n), 'iface')}`);
  // Permit non-privileged ports to opted-in subnets only; deny everything else.
  for (const n of nets) lines.push(`allow 1024-65535 ${noNewline(n.subnet, 'subnet')} 1024-65535`);
  lines.push('deny 0-65535 0.0.0.0/0 0-65535');
  return lines.join('\n') + '\n';
}

export function writeConfig(): void {
  if (!fs.existsSync(CONF_DIR)) fs.mkdirSync(CONF_DIR, { recursive: true, mode: 0o750 });
  fs.writeFileSync(CONF_FILE, renderConfig(), { mode: 0o640 });
  log.info({ CONF_FILE }, 'miniupnpd.write');
}

/** Reconcile the miniupnpd daemon with the DB — the single entrypoint. */
export async function applyUpnp(): Promise<void> {
  const on = isUpnpEnabled() && allowedNetworks().length > 0;
  try {
    if (on) {
      writeConfig();
      await action('miniupnpd.service', 'enable').catch(() => {});
      await action('miniupnpd.service', 'restart');
      log.info('miniupnpd applied — running');
    } else {
      await action('miniupnpd.service', 'stop').catch(() => {});
      await action('miniupnpd.service', 'disable').catch(() => {});
      log.info('miniupnpd applied — stopped');
    }
  } catch (err) {
    log.warn({ err }, 'applyUpnp failed (miniupnpd may not be installed)');
  }
}

export async function setUpnpEnabled(enabled: boolean): Promise<void> {
  setSetting('upnp.enabled', enabled ? '1' : '0');
  await applyUpnp();
}

// ─── active port mappings (miniupnpd lease file) ────────────────────
export interface UpnpMapping {
  proto: 'TCP' | 'UDP';
  externalPort: number;
  internalIp: string;
  internalPort: number;
  description: string;
  expiresAt: number | null; // epoch ms; null = no expiry
}

// lease line: PROTO:eport:iaddr:iport:timestamp:description
function parseLeaseLine(line: string): UpnpMapping | null {
  const parts = line.split(':');
  if (parts.length < 5) return null;
  const proto = parts[0]!.toUpperCase();
  if (proto !== 'TCP' && proto !== 'UDP') return null;
  const ts = Number(parts[4]);
  return {
    proto,
    externalPort: Number(parts[1]),
    internalIp: parts[2]!,
    internalPort: Number(parts[3]),
    description: parts.slice(5).join(':') || '—',
    expiresAt: ts > 0 ? ts * 1000 : null,
  };
}

export function listMappings(): UpnpMapping[] {
  if (!config.onLinux) {
    return [
      { proto: 'TCP', externalPort: 25565, internalIp: '10.0.0.51', internalPort: 25565, description: 'Minecraft server', expiresAt: Date.now() + 3_600_000 },
      { proto: 'UDP', externalPort: 3074,  internalIp: '10.0.0.74', internalPort: 3074,  description: 'Xbox Live',        expiresAt: null },
    ];
  }
  if (!fs.existsSync(LEASE_FILE)) return [];
  try {
    return fs.readFileSync(LEASE_FILE, 'utf8').split('\n').filter(Boolean)
      .map(parseLeaseLine)
      .filter((m): m is UpnpMapping => m !== null);
  } catch (err) {
    log.warn({ err }, 'upnp lease parse failed');
    return [];
  }
}

/** Revoke a mapping: drop its lease line, then restart so miniupnpd rebuilds
 *  its iptables chain from what remains. */
export async function deleteMapping(proto: string, externalPort: number): Promise<boolean> {
  const p = proto.toUpperCase();
  if (!config.onLinux) return true;
  if (!fs.existsSync(LEASE_FILE)) return false;
  const lines = fs.readFileSync(LEASE_FILE, 'utf8').split('\n').filter(Boolean);
  const kept = lines.filter(l => {
    const m = parseLeaseLine(l);
    return !(m && m.proto === p && m.externalPort === externalPort);
  });
  if (kept.length === lines.length) return false;
  fs.writeFileSync(LEASE_FILE, kept.length ? kept.join('\n') + '\n' : '');
  await action('miniupnpd.service', 'restart').catch(() => {});
  return true;
}

export async function upnpStatus() {
  const nets = allowedNetworks();
  let running = false;
  if (config.onLinux) {
    const r = await exec('systemctl', ['is-active', 'miniupnpd'], { allowFailure: true });
    running = r.stdout.trim() === 'active';
  } else {
    running = isUpnpEnabled() && nets.length > 0;
  }
  return {
    enabled: isUpnpEnabled(),
    running,
    allowedNetworks: nets.map(n => ({ id: n.id, name: n.name, vlanId: n.vlanId })),
    mappingCount: listMappings().length,
  };
}
