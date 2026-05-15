import { spawn } from 'node:child_process';
import { config } from '../config';

export interface PingResult {
  host: string;
  avgMs: number | null;
  minMs: number | null;
  maxMs: number | null;
  lossPct: number;   // 0-100
  ok: boolean;
}

/**
 * Run `ping` against host, return parsed stats. macOS uses `-W <ms>`, Linux
 * uses `-W <seconds>` — handle both. Always returns a result; bad host or
 * timeout yields `{ok:false, lossPct:100}`.
 */
export async function ping(host: string, count = 2, timeoutMs = 2500): Promise<PingResult> {
  // Validate host — only hostnames / IPv4 / IPv6. A leading '-' is rejected
  // so the value can never be parsed as a `ping` option flag (e.g. `-f`).
  if (!/^[a-z0-9._:-]+$/i.test(host) || host.startsWith('-')) {
    return { host, avgMs: null, minMs: null, maxMs: null, lossPct: 100, ok: false };
  }
  const args = process.platform === 'darwin'
    ? ['-c', String(count), '-W', String(Math.max(1, Math.floor(timeoutMs))), host]
    : ['-c', String(count), '-W', '1', host];
  return new Promise(resolve => {
    const proc = spawn('ping', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    const t = setTimeout(() => { proc.kill('SIGKILL'); }, timeoutMs + 1000);
    proc.stdout.on('data', d => { out += d.toString(); });
    proc.stderr.on('data', d => { out += d.toString(); });
    proc.on('close', () => {
      clearTimeout(t);
      resolve(parse(host, out));
    });
    proc.on('error', () => {
      clearTimeout(t);
      resolve({ host, avgMs: null, minMs: null, maxMs: null, lossPct: 100, ok: false });
    });
  });
}

function parse(host: string, out: string): PingResult {
  // Linux:   "rtt min/avg/max/mdev = 0.041/0.063/0.085/0.018 ms"
  // macOS:   "round-trip min/avg/max/stddev = 14.092/14.092/14.092/0.000 ms"
  const stats = /(?:rtt|round-trip)\s+min\/avg\/max\/(?:mdev|stddev)\s*=\s*([\d.]+)\/([\d.]+)\/([\d.]+)/.exec(out);
  // "1 packets transmitted, 0 packets received, 100% packet loss"  (Linux)
  // "2 packets transmitted, 2 received, 0% packet loss, time 1001ms" (Linux)
  // "2 packets transmitted, 2 packets received, 0.0% packet loss" (macOS)
  const loss = /(\d+(?:\.\d+)?)% packet loss/.exec(out);
  const lossPct = loss ? Number(loss[1]) : (stats ? 0 : 100);
  return {
    host,
    minMs: stats ? Number(stats[1]) : null,
    avgMs: stats ? Number(stats[2]) : null,
    maxMs: stats ? Number(stats[3]) : null,
    lossPct,
    ok: !!stats && lossPct < 100,
  };
}

// Synthetic generator used in unit tests / unreachable hosts.
export function syntheticPing(host: string): PingResult {
  const seed = host.split('').reduce((a, c) => a + c.charCodeAt(0), 0);
  const base = 3 + (seed % 30);
  const jitter = (seed % 7) * 0.3;
  return {
    host,
    minMs: base - jitter,
    avgMs: base,
    maxMs: base + jitter,
    lossPct: 0,
    ok: true,
  };
}

export const PROBE_TARGETS: Array<{ host: string; label: string }> = [
  { host: '1.1.1.1',          label: 'Cloudflare'  },
  { host: '8.8.8.8',          label: 'Google'      },
  { host: '9.9.9.9',          label: 'Quad9'       },
  { host: 'github.com',       label: 'GitHub'      },
];

let cache: { ts: number; results: PingResult[] } | null = null;

/** Cached 30s probe of the default target set. */
export async function probeAll(targets: Array<{ host: string; label: string }> = PROBE_TARGETS): Promise<PingResult[]> {
  if (cache && Date.now() - cache.ts < 30_000) return cache.results;
  const fn = config.onLinux || process.platform === 'darwin' ? ping : async (h: string) => syntheticPing(h);
  const results = await Promise.all(targets.map(t => fn(t.host)));
  cache = { ts: Date.now(), results };
  return results;
}

export function clearProbeCache() { cache = null; }
