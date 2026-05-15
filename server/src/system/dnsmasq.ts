import fs from 'node:fs';
import path from 'node:path';
import { exec } from './exec';
import { config } from '../config';
import { db } from '../db/client';
import { dhcpReservations, dnsRecords, networks } from '../db/schema';
import { log } from '../logger';
import { noNewline } from '../validators';

const LEASES_FILE = '/var/lib/misc/dnsmasq.leases';
const CONF_DIR = config.onLinux ? '/etc/dnsmasq.d' : path.join(config.configDir, 'dnsmasq.d');
const MAIN_CONF = path.join(CONF_DIR, 'varrok.conf');
const STATIC_CONF = path.join(CONF_DIR, 'static.conf');
const DNS_CONF = path.join(CONF_DIR, 'varrok-dns.conf');

function ensureDir() {
  if (!fs.existsSync(CONF_DIR)) fs.mkdirSync(CONF_DIR, { recursive: true });
}

export function renderMainConf(): string {
  const nets = db.select().from(networks).all().filter(n => n.enabled);
  const lines = ['# Managed by VarrokEdge — do not edit by hand.', 'bind-interfaces'];

  if (nets.length === 0) {
    // No networks defined — bind the LAN iface so dnsmasq still starts,
    // but serve no DHCP scope until a network exists.
    lines.push(`interface=${noNewline(config.lanIface, 'lanIface')}`);
  } else {
    // One `interface=` line per network's (VLAN) interface.
    // Every interpolated value is newline-checked: a CR/LF here would inject
    // an arbitrary dnsmasq directive (e.g. `dhcp-script=`, which runs as root).
    for (const n of nets) {
      const ifn = n.vlanId
        ? `${noNewline(n.iface, 'iface')}.${Number(n.vlanId)}`
        : noNewline(n.iface, 'iface');
      lines.push(`interface=${ifn}`);
    }
    // One tagged dhcp-range + options block per DHCP-enabled network.
    for (const n of nets) {
      if (!n.dhcpEnabled) continue;
      const tag = `net${Number(n.id)}`;
      lines.push(`dhcp-range=set:${tag},${noNewline(n.dhcpStart, 'dhcpStart')},${noNewline(n.dhcpEnd, 'dhcpEnd')},${noNewline(n.leaseTime, 'leaseTime')}`);
      lines.push(`dhcp-option=tag:${tag},3,${noNewline(n.gateway, 'gateway')}`);
      lines.push(`dhcp-option=tag:${tag},6,${noNewline(n.dnsServers, 'dnsServers')}`);
    }
  }

  const defaultNet = nets.find(n => n.isDefault) ?? nets[0];
  lines.push(
    `domain=${noNewline(defaultNet?.domain ?? 'varrok.local', 'domain')}`,
    'local=/varrok.local/',
    'expand-hosts',
    'log-queries',
    'log-dhcp',
    `conf-file=${STATIC_CONF}`,
    `conf-file=${DNS_CONF}`,
    '',
  );
  return lines.join('\n');
}

export function renderStaticConf(): string {
  const rows = db.select().from(dhcpReservations).all();
  const lines = ['# Static DHCP reservations'];
  for (const r of rows) {
    // Reservations carry their network tag so dnsmasq applies the right scope;
    // a NULL network_id falls through to whichever scope owns the IP.
    const tag = r.networkId ? `set:net${Number(r.networkId)},` : '';
    lines.push(`dhcp-host=${tag}${noNewline(r.mac, 'mac')},${noNewline(r.hostname, 'hostname')},${noNewline(r.ip, 'ip')},${noNewline(r.lease, 'lease')}`);
  }
  return lines.join('\n') + '\n';
}

export function renderDnsConf(): string {
  const rows = db.select().from(dnsRecords).all();
  const lines = ['# Local DNS records'];
  for (const r of rows) {
    const host = noNewline(r.host, 'host');
    const target = noNewline(r.target, 'target');
    if (r.type === 'CNAME') lines.push(`cname=${host},${target}`);
    else if (r.type === 'TXT') lines.push(`txt-record=${host},${target}`);
    else lines.push(`address=/${host}/${target}`);
  }
  return lines.join('\n') + '\n';
}

export async function writeConfigs() {
  ensureDir();
  fs.writeFileSync(MAIN_CONF, renderMainConf());
  fs.writeFileSync(STATIC_CONF, renderStaticConf());
  fs.writeFileSync(DNS_CONF, renderDnsConf());
  log.info({ MAIN_CONF, STATIC_CONF, DNS_CONF }, 'dnsmasq.write');
}

export async function reload() {
  await writeConfigs();
  // Must be `restart`, not `reload`: dnsmasq's SIGHUP only re-reads /etc/hosts
  // and resolv.conf — it does NOT re-evaluate `interface=` or `dhcp-range=`
  // (nor conf-file includes). New VLAN networks / scopes / reservations only
  // take effect on a full restart.
  return exec('systemctl', ['restart', 'dnsmasq'], { allowFailure: true });
}

export interface Lease {
  hostname: string;
  ip: string;
  mac: string;
  expiry: string; // human
  expiresAt: number; // epoch
}

export function parseLeases(): Lease[] {
  // No synthetic data — if the leases file isn't readable (macOS dev,
  // dnsmasq not running, or no clients have asked for an IP yet), return
  // empty so the UI honestly reflects what the appliance knows.
  if (!config.onLinux || !fs.existsSync(LEASES_FILE)) return [];
  try {
    const data = fs.readFileSync(LEASES_FILE, 'utf8');
    return data.split('\n').filter(Boolean).map(line => {
      const [epoch, mac, ip, hostname] = line.split(/\s+/);
      const expiresAt = Number(epoch) * 1000;
      const remain = expiresAt - Date.now();
      const h = Math.max(0, Math.floor(remain / 3_600_000));
      const m = Math.max(0, Math.floor((remain % 3_600_000) / 60_000));
      return {
        hostname: hostname && hostname !== '*' ? hostname : 'unknown',
        ip: ip ?? '',
        mac: mac ?? '',
        expiry: `${h}h ${m.toString().padStart(2, '0')}m`,
        expiresAt,
      };
    });
  } catch (err) {
    log.warn({ err }, 'leases parse failed');
    return [];
  }
}
