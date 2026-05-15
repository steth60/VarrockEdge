import { exec } from './exec';
import { config } from '../config';
import { db } from '../db/client';
import { fwDnat, fwSnat, fwRules, settings } from '../db/schema';
import { eq } from 'drizzle-orm';
import { log } from '../logger';
import { assertSafeArg } from '../validators';

const PROTO_FLAGS = (proto: string): string[] => proto === 'both' ? ['tcp'] : [proto];

export async function applyDnat(row: typeof fwDnat.$inferSelect, op: 'A' | 'D' = 'A') {
  // Defence in depth — these become iptables argv run as root. Reject any
  // value that could be parsed as a flag (route schemas validate format).
  assertSafeArg(config.wanIface, 'wanIface');
  assertSafeArg(config.lanIface, 'lanIface');
  assertSafeArg(row.destIp, 'destIp');
  for (const p of (row.proto === 'both' ? ['tcp', 'udp'] : [row.proto])) {
    await exec('iptables', [
      '-t', 'nat', `-${op}`, 'PREROUTING',
      '-i', config.wanIface, '-p', p,
      '--dport', String(row.srcPort),
      '-j', 'DNAT',
      '--to-destination', `${row.destIp}:${row.destPort}`,
    ], { allowFailure: op === 'D' });
    // Also allow forward to internal
    await exec('iptables', [
      `-${op}`, 'FORWARD',
      '-i', config.wanIface, '-o', config.lanIface,
      '-p', p, '-d', row.destIp, '--dport', String(row.destPort),
      '-j', 'ACCEPT',
    ], { allowFailure: op === 'D' });
  }
}

export async function applySnat(row: typeof fwSnat.$inferSelect, op: 'A' | 'D' = 'A') {
  assertSafeArg(row.outIface, 'outIface');
  assertSafeArg(row.source, 'source');
  if (row.toSource) assertSafeArg(row.toSource, 'toSource');
  const args = ['-t', 'nat', `-${op}`, 'POSTROUTING', '-o', row.outIface, '-s', row.source, '-j', row.mode];
  if (row.mode === 'SNAT' && row.toSource) {
    args.push('--to-source', row.toSource);
  }
  await exec('iptables', args, { allowFailure: op === 'D' });
}

export async function applyRule(row: typeof fwRules.$inferSelect, op: 'A' | 'D' = 'A') {
  if (row.source) assertSafeArg(row.source, 'source');
  if (row.dport) assertSafeArg(row.dport, 'dport');
  if (row.comment) assertSafeArg(row.comment, 'comment');
  const args = [`-${op}`, row.chain];
  if (row.proto && row.proto !== 'all') args.push('-p', row.proto);
  if (row.source) args.push('-s', row.source);
  if (row.dport && row.dport !== '—' && row.dport !== '*') args.push('--dport', row.dport);
  args.push('-j', row.action);
  if (row.comment) args.push('-m', 'comment', '--comment', row.comment);
  await exec('iptables', args, { allowFailure: op === 'D' });
}

export async function reapplyAll() {
  // Flush our DNAT chain entries, re-add all from DB. Keep MASQUERADE managed by fw_snat rules.
  if (config.onLinux) {
    await exec('iptables', ['-t', 'nat', '-F', 'PREROUTING'], { allowFailure: true });
    // The flush above also drops the jump into miniupnpd's chain. miniupnpd
    // owns the MINIUPNPD chain + its rules (which survive — we never flush it);
    // we just re-add the PREROUTING hook so UPnP mappings keep working.
    const upnpOn = db.select().from(settings).where(eq(settings.key, 'upnp.enabled')).get()?.value === '1';
    if (upnpOn) {
      await exec('iptables', ['-t', 'nat', '-N', 'MINIUPNPD'], { allowFailure: true });
      await exec('iptables', ['-t', 'nat', '-A', 'PREROUTING', '-i', config.wanIface, '-j', 'MINIUPNPD'], { allowFailure: true });
    }
  }
  for (const r of db.select().from(fwDnat).all()) {
    if (r.enabled) await applyDnat(r, 'A').catch(err => log.warn({ err, id: r.id }, 'apply dnat fail'));
  }
  for (const r of db.select().from(fwSnat).all()) {
    if (r.enabled) await applySnat(r, 'A').catch(err => log.warn({ err, id: r.id }, 'apply snat fail'));
  }
  for (const r of db.select().from(fwRules).all()) {
    if (r.enabled) await applyRule(r, 'A').catch(err => log.warn({ err, id: r.id }, 'apply rule fail'));
  }
  await persist();
}

export async function persist() {
  if (!config.onLinux) return;
  try {
    const r = await exec('iptables-save', [], { allowFailure: true });
    if (r.code === 0) {
      const fs = await import('node:fs');
      fs.writeFileSync('/etc/iptables/rules.v4', r.stdout);
    }
  } catch (err) {
    log.warn({ err }, 'persist failed');
  }
}

export interface DnatHit { srcPort: number; proto: string; destIp: string; destPort: number; hits: number; }
export async function dnatHits(): Promise<Map<string, number>> {
  const m = new Map<string, number>();
  if (!config.onLinux) return m;
  try {
    const r = await exec('iptables', ['-t', 'nat', '-L', 'PREROUTING', '-n', '-v', '-x'], { allowFailure: true });
    for (const line of r.stdout.split('\n')) {
      const match = /(\d+)\s+\d+\s+DNAT\s+(\w+).*dpt:(\d+).*to:([0-9.]+):(\d+)/.exec(line);
      if (match) {
        const [, hits, proto, srcPort, destIp, destPort] = match;
        m.set(`${proto}:${srcPort}->${destIp}:${destPort}`, Number(hits));
      }
    }
  } catch {}
  return m;
}
