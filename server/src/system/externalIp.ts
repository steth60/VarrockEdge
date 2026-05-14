import { spawn } from 'node:child_process';
import { log } from '../logger';

interface Cache { ip: string | null; ts: number }
let cache: Cache = { ip: null, ts: 0 };
const TTL_MS = 5 * 60_000;

/**
 * Discover the appliance's public IP by querying a couple of well-known
 * "what's-my-ip" endpoints. Cached for 5 minutes.
 *
 * Uses curl rather than fetch() so we honour the OS routing table
 * (default route, in particular — useful on multi-WAN appliances).
 */
export async function getExternalIp(force = false): Promise<string | null> {
  if (!force && cache.ip && Date.now() - cache.ts < TTL_MS) return cache.ip;

  const sources = ['https://api.ipify.org', 'https://ifconfig.me/ip', 'https://ipv4.icanhazip.com'];
  for (const url of sources) {
    const ip = await curl(url);
    if (ip && /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(ip.trim())) {
      cache = { ip: ip.trim(), ts: Date.now() };
      log.debug({ ip: cache.ip, source: url }, 'external IP refreshed');
      return cache.ip;
    }
  }
  return cache.ip; // last known, even if stale
}

function curl(url: string, timeoutMs = 4000): Promise<string | null> {
  return new Promise(resolve => {
    const proc = spawn('curl', ['-fsS', '--max-time', String(Math.ceil(timeoutMs / 1000)), url], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    const t = setTimeout(() => { proc.kill('SIGKILL'); }, timeoutMs + 500);
    proc.stdout.on('data', d => { out += d.toString(); });
    proc.on('close', code => {
      clearTimeout(t);
      resolve(code === 0 ? out : null);
    });
    proc.on('error', () => { clearTimeout(t); resolve(null); });
  });
}
