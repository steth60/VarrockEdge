import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config';
import { log } from '../logger';
import { db } from '../db/client';
import { flowTopClients, flowTopServices, flowTopDestinations, flowApps } from '../db/schema';
import { and, eq } from 'drizzle-orm';

const PORT_APPS_PATH = path.resolve(__dirname, '../../data/port_apps.json');
let PORT_APPS: Record<string, string> = {};
try { PORT_APPS = JSON.parse(fs.readFileSync(PORT_APPS_PATH, 'utf8')); } catch { /* missing in tests */ }

function appName(port: number, proto: string): string {
  return PORT_APPS[String(port)] ?? `${proto}:${port}`;
}

interface Flow { srcIp: string; dstIp: string; sport: number; dport: number; proto: string; bytes: number; packets: number }

/**
 * Parse a conntrack line. Conntrack -L -o extended produces lines like:
 *   tcp  6 431999 ESTABLISHED src=10.0.0.74 dst=140.82.112.4 sport=43122 dport=443 packets=412 bytes=1832000 src=140.82.112.4 dst=51.38.114.207 sport=443 dport=43122 packets=300 bytes=12345 [ASSURED] mark=0 use=1
 * We sum *both* directions when both are present.
 */
function parseConntrack(text: string): Flow[] {
  const flows: Flow[] = [];
  for (const line of text.split('\n')) {
    const proto = line.startsWith('tcp') ? 'tcp' : line.startsWith('udp') ? 'udp' : null;
    if (!proto) continue;
    const srcs    = [...line.matchAll(/src=([\d.]+)/g)].map(m => m[1]!);
    const dsts    = [...line.matchAll(/dst=([\d.]+)/g)].map(m => m[1]!);
    const sports  = [...line.matchAll(/sport=(\d+)/g)].map(m => Number(m[1]));
    const dports  = [...line.matchAll(/dport=(\d+)/g)].map(m => Number(m[1]));
    const packets = [...line.matchAll(/packets=(\d+)/g)].map(m => Number(m[1]));
    const bytes   = [...line.matchAll(/bytes=(\d+)/g)].map(m => Number(m[1]));
    if (srcs.length === 0 || dports.length === 0) continue;
    flows.push({
      srcIp: srcs[0]!,
      dstIp: dsts[0]!,
      sport: sports[0] ?? 0,
      dport: dports[0]!,
      proto,
      bytes:   (bytes[0]   ?? 0) + (bytes[1]   ?? 0),
      packets: (packets[0] ?? 0) + (packets[1] ?? 0),
    });
  }
  return flows;
}

async function runConntrack(): Promise<Flow[]> {
  if (!config.onLinux) return synthetic();
  return new Promise(resolve => {
    const proc = spawn('conntrack', ['-L', '-o', 'extended'], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    const t = setTimeout(() => { proc.kill('SIGKILL'); }, 10_000);
    proc.stdout.on('data', d => { out += d.toString(); });
    proc.on('close', () => {
      clearTimeout(t);
      resolve(parseConntrack(out));
    });
    proc.on('error', () => { clearTimeout(t); resolve([]); });
  });
}

// Synthetic flows for macOS dev — mix of LAN clients, services, destinations.
function synthetic(): Flow[] {
  const lanClients = ['10.0.0.10', '10.0.0.20', '10.0.0.61', '10.0.0.74', '10.0.0.82', '10.0.0.118'];
  const destinations = ['140.82.112.4', '8.8.8.8', '1.1.1.1', '17.171.156.84', '142.250.179.206', '52.84.190.5', '199.232.69.194'];
  const services: Array<[number, string]> = [[443, 'tcp'], [443, 'tcp'], [443, 'tcp'], [443, 'tcp'], [53, 'udp'], [22, 'tcp'], [51820, 'udp'], [993, 'tcp']];
  const flows: Flow[] = [];
  for (let i = 0; i < 120; i++) {
    const src = lanClients[i % lanClients.length]!;
    const dst = destinations[(i * 7) % destinations.length]!;
    const [dport, proto] = services[i % services.length]!;
    flows.push({
      srcIp: src,
      dstIp: dst,
      sport: 32000 + (i % 8000),
      dport,
      proto,
      bytes: 1024 + ((i * 1373) % 4_000_000),
      packets: 1 + (i % 200),
    });
  }
  return flows;
}

async function sample(): Promise<void> {
  const flows = await runConntrack();
  if (flows.length === 0) return;
  const now = Date.now();
  const WINDOW = '1h';

  // Aggregate
  const clients = new Map<string, { bytes: number; packets: number }>();
  const services = new Map<string, { bytes: number; packets: number; dport: number; proto: string }>();
  const destinations = new Map<string, { bytes: number; packets: number }>();
  const apps = new Map<string, { down: number; up: number }>();

  for (const f of flows) {
    // Top LAN clients: only sources in private RFC1918
    if (isPrivate(f.srcIp)) {
      const cur = clients.get(f.srcIp) ?? { bytes: 0, packets: 0 };
      cur.bytes += f.bytes; cur.packets += f.packets;
      clients.set(f.srcIp, cur);
    }
    // Top services by dport+proto
    const sKey = `${f.dport}/${f.proto}`;
    const cs = services.get(sKey) ?? { bytes: 0, packets: 0, dport: f.dport, proto: f.proto };
    cs.bytes += f.bytes; cs.packets += f.packets;
    services.set(sKey, cs);
    // Top external destinations (skip private)
    if (!isPrivate(f.dstIp)) {
      const cd = destinations.get(f.dstIp) ?? { bytes: 0, packets: 0 };
      cd.bytes += f.bytes; cd.packets += f.packets;
      destinations.set(f.dstIp, cd);
    }
    // Application breakdown
    const app = appName(f.dport, f.proto);
    const ca = apps.get(app) ?? { down: 0, up: 0 };
    // Heuristic: a "download" is bytes from public to private. Lacking direction
    // we approximate by counting outbound (private→public) as up, the rest as down.
    if (isPrivate(f.srcIp) && !isPrivate(f.dstIp)) ca.up += f.bytes;
    else ca.down += f.bytes;
    apps.set(app, ca);
  }

  // Swap rows atomically per window (we only maintain '1h' for now).
  const tx = (() => {
    db.delete(flowTopClients).where(eq(flowTopClients.window, WINDOW)).run();
    db.delete(flowTopServices).where(eq(flowTopServices.window, WINDOW)).run();
    db.delete(flowTopDestinations).where(eq(flowTopDestinations.window, WINDOW)).run();
    db.delete(flowApps).where(eq(flowApps.window, WINDOW)).run();

    const topClients = [...clients.entries()].sort((a, b) => b[1].bytes - a[1].bytes).slice(0, 20);
    for (const [ip, v] of topClients) {
      db.insert(flowTopClients).values({ window: WINDOW, srcIp: ip, hostHint: null, packets: v.packets, bytes: v.bytes, updatedAt: now }).run();
    }

    const topServices = [...services.entries()].sort((a, b) => b[1].bytes - a[1].bytes).slice(0, 20);
    for (const [, v] of topServices) {
      db.insert(flowTopServices).values({ window: WINDOW, dport: v.dport, proto: v.proto, packets: v.packets, bytes: v.bytes, updatedAt: now }).run();
    }

    const topDestinations = [...destinations.entries()].sort((a, b) => b[1].bytes - a[1].bytes).slice(0, 20);
    for (const [ip, v] of topDestinations) {
      db.insert(flowTopDestinations).values({ window: WINDOW, dstIp: ip, countryHint: null, packets: v.packets, bytes: v.bytes, updatedAt: now }).run();
    }

    const topApps = [...apps.entries()].sort((a, b) => (b[1].down + b[1].up) - (a[1].down + a[1].up)).slice(0, 30);
    for (const [name, v] of topApps) {
      db.insert(flowApps).values({ window: WINDOW, app: name, downBytes: v.down, upBytes: v.up, updatedAt: now }).run();
    }
  });

  try { tx(); } catch (err) { log.warn({ err }, 'conntrack persist failed'); }
}

function isPrivate(ip: string): boolean {
  if (ip.startsWith('10.')) return true;
  if (ip.startsWith('192.168.')) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(ip)) return true;
  if (ip === '127.0.0.1') return true;
  return false;
}

let timer: NodeJS.Timeout | null = null;
let started = false;

export function startConntrackSampler() {
  if (started) return;
  started = true;
  // First sample immediately, then every 5s on Linux, 30s on macOS (synthetic is cheaper but pretend it changes).
  sample().catch(err => log.warn({ err }, 'conntrack sample failed'));
  timer = setInterval(() => { sample().catch(() => {}); }, config.onLinux ? 5_000 : 30_000);
  log.info('conntrack sampler started');
}

export function stopConntrackSampler() {
  if (timer) clearInterval(timer);
  timer = null;
  started = false;
}
