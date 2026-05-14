import fs from 'node:fs';
import path from 'node:path';
import { exec } from './exec';
import { config } from '../config';
import { db } from '../db/client';
import { dhcpReservations, dhcpScope, dnsRecords } from '../db/schema';
import { log } from '../logger';

const LEASES_FILE = '/var/lib/misc/dnsmasq.leases';
const CONF_DIR = config.onLinux ? '/etc/dnsmasq.d' : path.join(config.configDir, 'dnsmasq.d');
const MAIN_CONF = path.join(CONF_DIR, 'varrok.conf');
const STATIC_CONF = path.join(CONF_DIR, 'static.conf');
const DNS_CONF = path.join(CONF_DIR, 'varrok-dns.conf');

function ensureDir() {
  if (!fs.existsSync(CONF_DIR)) fs.mkdirSync(CONF_DIR, { recursive: true });
}

export function renderMainConf(): string {
  const scope = db.select().from(dhcpScope).get() ?? {
    rangeStart: '10.0.0.50', rangeEnd: '10.0.0.200', leaseTime: '24h',
    gateway: '10.0.0.1', dnsServers: '10.0.0.1,1.1.1.1', domain: 'varrok.local',
  };
  return [
    '# Managed by VarrokEdge — do not edit by hand.',
    `interface=${config.lanIface}`,
    'bind-interfaces',
    `dhcp-range=${scope.rangeStart},${scope.rangeEnd},${scope.leaseTime}`,
    `dhcp-option=3,${scope.gateway}`,
    `dhcp-option=6,${scope.dnsServers}`,
    `domain=${scope.domain}`,
    'local=/varrok.local/',
    'expand-hosts',
    'log-queries',
    'log-dhcp',
    `conf-file=${STATIC_CONF}`,
    `conf-file=${DNS_CONF}`,
    '',
  ].join('\n');
}

export function renderStaticConf(): string {
  const rows = db.select().from(dhcpReservations).all();
  const lines = ['# Static DHCP reservations'];
  for (const r of rows) {
    lines.push(`dhcp-host=${r.mac},${r.hostname},${r.ip},${r.lease}`);
  }
  return lines.join('\n') + '\n';
}

export function renderDnsConf(): string {
  const rows = db.select().from(dnsRecords).all();
  const lines = ['# Local DNS records'];
  for (const r of rows) {
    if (r.type === 'CNAME') lines.push(`cname=${r.host},${r.target}`);
    else if (r.type === 'TXT') lines.push(`txt-record=${r.host},${r.target}`);
    else lines.push(`address=/${r.host}/${r.target}`);
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
  return exec('systemctl', ['reload', 'dnsmasq'], { allowFailure: true });
}

export interface Lease {
  hostname: string;
  ip: string;
  mac: string;
  expiry: string; // human
  expiresAt: number; // epoch
}

export function parseLeases(): Lease[] {
  if (!config.onLinux || !fs.existsSync(LEASES_FILE)) {
    return [
      { hostname: 'runner-01',       ip: '10.0.0.52',  mac: 'aa:bb:cc:11:22:33', expiry: '23h 12m', expiresAt: Date.now() + 23 * 3600_000 },
      { hostname: 'nas-truenas',     ip: '10.0.0.61',  mac: '6c:b3:11:8e:a2:0d', expiry: '11h 04m', expiresAt: Date.now() + 11 * 3600_000 },
      { hostname: 'ws-callum',       ip: '10.0.0.74',  mac: 'a4:83:e7:21:c8:91', expiry: '20h 51m', expiresAt: Date.now() + 20 * 3600_000 },
      { hostname: 'pi-monitor',      ip: '10.0.0.82',  mac: 'dc:a6:32:4b:7e:11', expiry: '19h 33m', expiresAt: Date.now() + 19 * 3600_000 },
      { hostname: 'switch-uap-lite', ip: '10.0.0.110', mac: '78:8a:20:34:5b:c2', expiry: '22h 02m', expiresAt: Date.now() + 22 * 3600_000 },
      { hostname: 'gh-runner-02',    ip: '10.0.0.118', mac: 'bc:24:11:0e:91:4a', expiry: '17h 41m', expiresAt: Date.now() + 17 * 3600_000 },
    ];
  }
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
