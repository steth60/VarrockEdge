import { exec } from './exec';
import { config } from '../config';
import { db } from '../db/client';
import { fwDnat, fwSnat, fwRules } from '../db/schema';
import { log } from '../logger';

const PROTO_FLAGS = (proto: string): string[] => proto === 'both' ? ['tcp'] : [proto];

export async function applyDnat(row: typeof fwDnat.$inferSelect, op: 'A' | 'D' = 'A') {
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
  const args = ['-t', 'nat', `-${op}`, 'POSTROUTING', '-o', row.outIface, '-s', row.source, '-j', row.mode];
  if (row.mode === 'SNAT' && row.toSource) {
    args.push('--to-source', row.toSource);
  }
  await exec('iptables', args, { allowFailure: op === 'D' });
}

export async function applyRule(row: typeof fwRules.$inferSelect, op: 'A' | 'D' = 'A') {
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
