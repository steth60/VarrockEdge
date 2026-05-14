import fs from 'node:fs';
import os from 'node:os';
import { config } from '../config';

let lastCpu: { idle: number; total: number } | null = null;
const lastIface = new Map<string, { rx: number; tx: number; ts: number }>();

function readProcStat(): { idle: number; total: number } | null {
  try {
    const line = fs.readFileSync('/proc/stat', 'utf8').split('\n')[0];
    if (!line) return null;
    const parts = line.trim().split(/\s+/).slice(1).map(Number);
    const idle = (parts[3] ?? 0) + (parts[4] ?? 0);
    const total = parts.reduce((a, b) => a + b, 0);
    return { idle, total };
  } catch {
    return null;
  }
}

export function getCpu(): number {
  if (!config.onLinux) {
    const cpus = os.cpus();
    const idle = cpus.reduce((a, c) => a + c.times.idle, 0);
    const total = cpus.reduce((a, c) => a + Object.values(c.times).reduce((x, y) => x + y, 0), 0);
    if (!lastCpu) { lastCpu = { idle, total }; return 12 + Math.random() * 18; }
    const di = idle - lastCpu.idle;
    const dt = total - lastCpu.total;
    lastCpu = { idle, total };
    if (dt <= 0) return 0;
    return Math.max(0, Math.min(100, (1 - di / dt) * 100));
  }
  const cur = readProcStat();
  if (!cur) return 0;
  if (!lastCpu) { lastCpu = cur; return 0; }
  const di = cur.idle - lastCpu.idle;
  const dt = cur.total - lastCpu.total;
  lastCpu = cur;
  if (dt <= 0) return 0;
  return Math.max(0, Math.min(100, (1 - di / dt) * 100));
}

export function getMem(): { used: number; total: number } {
  if (config.onLinux) {
    try {
      const txt = fs.readFileSync('/proc/meminfo', 'utf8');
      const pick = (k: string) => Number(/^([0-9]+)/.exec(txt.split(`${k}:`)[1] ?? '0')?.[1] ?? 0);
      const totalKb = pick('MemTotal');
      const availKb = pick('MemAvailable');
      return { used: Math.round((totalKb - availKb) / 1024), total: Math.round(totalKb / 1024) };
    } catch { /* fall through */ }
  }
  const total = Math.round(os.totalmem() / 1024 / 1024);
  const free = Math.round(os.freemem() / 1024 / 1024);
  return { used: total - free, total };
}

interface IfaceTput { rxMbps: number; txMbps: number; rxBytes: number; txBytes: number; }

export function getIface(name: string): IfaceTput {
  if (!config.onLinux) {
    const fake = 6 + Math.random() * 18;
    return { rxMbps: fake, txMbps: fake * 0.7, rxBytes: 0, txBytes: 0 };
  }
  try {
    const rx = Number(fs.readFileSync(`/sys/class/net/${name}/statistics/rx_bytes`, 'utf8'));
    const tx = Number(fs.readFileSync(`/sys/class/net/${name}/statistics/tx_bytes`, 'utf8'));
    const now = Date.now();
    const last = lastIface.get(name);
    lastIface.set(name, { rx, tx, ts: now });
    if (!last) return { rxMbps: 0, txMbps: 0, rxBytes: rx, txBytes: tx };
    const dt = (now - last.ts) / 1000;
    if (dt <= 0) return { rxMbps: 0, txMbps: 0, rxBytes: rx, txBytes: tx };
    return {
      rxMbps: ((rx - last.rx) * 8 / 1_000_000) / dt,
      txMbps: ((tx - last.tx) * 8 / 1_000_000) / dt,
      rxBytes: rx,
      txBytes: tx,
    };
  } catch {
    return { rxMbps: 0, txMbps: 0, rxBytes: 0, txBytes: 0 };
  }
}

export function getDisk(): { used: number; total: number } {
  // Node 18+ has fs.statfsSync; degrade gracefully on older engines.
  try {
    const sf = (fs as any).statfsSync?.('/');
    if (sf) {
      const total = Number(sf.blocks) * Number(sf.bsize);
      const free  = Number(sf.bavail) * Number(sf.bsize);
      return { used: Math.round((total - free) / 1024 / 1024), total: Math.round(total / 1024 / 1024) };
    }
  } catch { /* ignore */ }
  return { used: 0, total: 0 };
}

export function getTempC(): number | null {
  if (!config.onLinux) return null;
  try {
    const v = Number(fs.readFileSync('/sys/class/thermal/thermal_zone0/temp', 'utf8').trim());
    if (!Number.isFinite(v) || v <= 0) return null;
    return v / 1000;   // millicelsius → celsius
  } catch {
    return null;
  }
}

export function snapshot() {
  const mem = getMem();
  const disk = getDisk();
  const wan = getIface(config.wanIface);
  const lan = getIface(config.lanIface);
  return {
    cpu: getCpu(),
    ram: mem.used,
    ramTotal: mem.total,
    disk: { used: disk.used, total: disk.total },
    tempC: getTempC(),
    eth0: { rxMbps: wan.rxMbps, txMbps: wan.txMbps },
    eth1: { rxMbps: lan.rxMbps, txMbps: lan.txMbps },
    loadAvg: os.loadavg(),
    uptime: os.uptime(),
    ts: Date.now(),
  };
}
