import { exec } from './exec';
import { config } from '../config';
import { log } from '../logger';
import { assertSafeArg, assertMatches, IPV4 } from '../validators';

export interface Ban {
  ip: string;
  jail: string;
  bannedAt: number | null;   // epoch ms, null if unknown
  expiresAt: number | null;  // epoch ms, null = permanent or unknown
  attempts: number | null;
  reason: string | null;
}

const MOCK_BANS: Ban[] = [
  { ip: '185.220.101.42', jail: 'sshd',     bannedAt: Date.now() - 4 * 3600_000,  expiresAt: Date.now() + 6 * 86400_000, attempts: 142, reason: 'SSH brute force' },
  { ip: '212.83.40.6',    jail: 'recidive', bannedAt: Date.now() - 25 * 60_000,   expiresAt: Date.now() + 23 * 3600_000, attempts: 1024,reason: 'Port scan' },
  { ip: '94.115.66.12',   jail: 'dns-abuse',bannedAt: Date.now() - 2 * 3600_000,  expiresAt: Date.now() + 11 * 3600_000, attempts: 86,  reason: 'DNS amplification' },
];

async function listJails(): Promise<string[]> {
  if (!config.onLinux) return Array.from(new Set(MOCK_BANS.map(b => b.jail)));
  try {
    const r = await exec('fail2ban-client', ['status'], { allowFailure: true });
    if (r.code !== 0) return [];
    const m = /Jail list:\s*(.+)$/m.exec(r.stdout);
    return m ? m[1]!.split(',').map(s => s.trim()).filter(Boolean) : [];
  } catch { return []; }
}

async function bannedInJail(jail: string): Promise<string[]> {
  if (!config.onLinux) return MOCK_BANS.filter(b => b.jail === jail).map(b => b.ip);
  try {
    assertSafeArg(jail, 'jail');
    const r = await exec('fail2ban-client', ['status', jail], { allowFailure: true });
    if (r.code !== 0) return [];
    const m = /Banned IP list:\s*(.*)$/m.exec(r.stdout);
    return m ? m[1]!.split(/\s+/).filter(Boolean) : [];
  } catch { return []; }
}

export async function listBans(): Promise<Ban[]> {
  if (!config.onLinux) return [...MOCK_BANS].sort((a, b) => (b.bannedAt ?? 0) - (a.bannedAt ?? 0));
  const jails = await listJails();
  const out: Ban[] = [];
  for (const jail of jails) {
    const ips = await bannedInJail(jail);
    for (const ip of ips) {
      out.push({ ip, jail, bannedAt: null, expiresAt: null, attempts: null, reason: null });
    }
  }
  return out;
}

export async function banIp(ip: string, jail = 'sshd'): Promise<void> {
  if (!config.onLinux) {
    MOCK_BANS.unshift({ ip, jail, bannedAt: Date.now(), expiresAt: Date.now() + 24 * 3600_000, attempts: null, reason: 'manual' });
    log.info({ ip, jail, dryRun: true }, 'ban.add');
    return;
  }
  // Both values reach fail2ban-client as root — reject flag-like jail names
  // and anything that is not a literal IPv4 address.
  assertSafeArg(jail, 'jail');
  assertMatches(ip, IPV4, 'ip');
  await exec('fail2ban-client', ['set', jail, 'banip', ip]);
}

export async function unbanIp(ip: string): Promise<void> {
  if (!config.onLinux) {
    const idx = MOCK_BANS.findIndex(b => b.ip === ip);
    if (idx >= 0) MOCK_BANS.splice(idx, 1);
    log.info({ ip, dryRun: true }, 'ban.remove');
    return;
  }
  // unbanip without jail lookups all jails
  await exec('fail2ban-client', ['unban', ip], { allowFailure: true });
}
