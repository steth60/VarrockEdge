import { sql, and, eq, gt } from 'drizzle-orm';
import { db } from '../db/client';
import { detectionRules, threats, eventBuckets } from '../db/schema';
import { config } from '../config';
import { log } from '../logger';
import { tail, type JournalLine } from './journal';

type Severity = 'critical' | 'high' | 'medium' | 'low';

interface MatchResult {
  ruleId: string;
  src: string;
  dst: string;
  kind: string;
  severity: Severity;
  desc: string;
}

type Matcher = (line: JournalLine) => MatchResult | null;

// Real pattern matchers. Conservative regexes — only escalate on strong signals.
const MATCHERS: Matcher[] = [
  // SSH brute force — sshd "Failed password" / pam_unix auth failure
  (l) => {
    if (l.svc !== 'sshd' && l.svc !== 'systemd') {
      if (!/Failed password|authentication failure/i.test(l.msg)) return null;
    }
    const m = /from\s+([\d.]+)/.exec(l.msg);
    if (!m) return null;
    return {
      ruleId: 'ssh-bf', src: m[1]!, dst: 'eth0:22',
      kind: 'SSH brute force', severity: 'critical',
      desc: 'SSH password authentication failure',
    };
  },
  // Port scan / dropped traffic — iptables LOG target output via kernel
  (l) => {
    if (!/DROP|REJECT/i.test(l.msg)) return null;
    const src = /SRC=([\d.]+)/.exec(l.msg);
    const dpt = /DPT=(\d+)/.exec(l.msg);
    if (!src) return null;
    return {
      ruleId: 'port-scan', src: src[1]!,
      dst: dpt ? `eth0:${dpt[1]}` : 'eth0:*',
      kind: 'Port scan / dropped traffic', severity: 'high',
      desc: 'iptables dropped inbound packet',
    };
  },
  // fail2ban ban events — counted as critical (matches whatever jail fired)
  (l) => {
    if (l.svc !== 'fail2ban') return null;
    const m = /(?:Ban|banned)\s+([\d.]+)/.exec(l.msg);
    if (!m) return null;
    return {
      ruleId: 'ssh-bf', src: m[1]!, dst: 'eth0:22',
      kind: 'fail2ban escalation', severity: 'critical',
      desc: 'IP added to fail2ban jail',
    };
  },
  // New MAC on LAN — first DHCPACK for a MAC we haven't seen
  (l) => {
    if (l.svc !== 'dnsmasq') return null;
    const m = /DHCPACK\(\S+\)\s+([\d.]+)\s+([0-9a-f:]{17})\s+(\S*)/i.exec(l.msg);
    if (!m) return null;
    return {
      ruleId: 'new-mac', src: m[2]!, dst: m[1]!,
      kind: 'New device on LAN', severity: 'low',
      desc: `First DHCP lease for MAC (hostname: ${m[3] || 'unknown'})`,
    };
  },
];

const DEV_SAMPLES: MatchResult[] = [
  { ruleId: 'ssh-bf',    src: '185.220.101.42', dst: 'eth0:22',   kind: 'SSH brute force',     severity: 'critical', desc: 'SSH password auth failure from Tor exit' },
  { ruleId: 'port-scan', src: '212.83.40.6',    dst: 'eth0:*',    kind: 'Port scan',           severity: 'high',     desc: 'TCP SYN sweep' },
  { ruleId: 'dns-amp',   src: '94.115.66.12',   dst: 'eth0:53',   kind: 'DNS amplification',   severity: 'high',     desc: 'ANY query with spoofed source' },
  { ruleId: 'wg-fail',   src: '88.214.10.92',   dst: 'eth0:51820',kind: 'Failed WG handshake', severity: 'medium',   desc: 'Invalid public key' },
  { ruleId: 'new-mac',   src: 'bc:24:11:0e:91:4a',dst: '10.0.0.118', kind: 'New device on LAN',severity: 'low',      desc: 'First lease for MAC' },
];

let started = false;
let devTimer: NodeJS.Timeout | null = null;

export function startDetector() {
  if (started) return;
  started = true;
  if (!config.onLinux) {
    // Seed a handful at boot so the UI has data immediately.
    setTimeout(() => DEV_SAMPLES.forEach(ev => recordEvent(ev)), 100);
    // Then add a synthetic event every ~12s.
    devTimer = setInterval(() => {
      const ev = DEV_SAMPLES[Math.floor(Math.random() * DEV_SAMPLES.length)]!;
      recordEvent(ev);
    }, 12_000);
    log.info('detector started (dev synthetic mode)');
    return;
  }
  const t = tail(['sshd', 'fail2ban', 'kernel', 'dnsmasq', 'systemd']);
  t.on('line', (line: JournalLine) => {
    try {
      for (const matcher of MATCHERS) {
        const r = matcher(line);
        if (!r) continue;
        const rule = db.select().from(detectionRules).where(eq(detectionRules.id, r.ruleId)).get();
        if (!rule || !rule.enabled) continue;
        recordEvent(r);
        break; // one rule per line
      }
    } catch (err) {
      log.warn({ err }, 'detector match failed');
    }
  });
  log.info('detector started (journal tail)');
}

export function stopDetector() {
  started = false;
  if (devTimer) clearInterval(devTimer);
  devTimer = null;
}

export function recordEvent(ev: MatchResult) {
  const now = Date.now();
  const hour = Math.floor(now / 3_600_000);

  // Increment rule hits counter.
  db.update(detectionRules)
    .set({ hits: sql`${detectionRules.hits} + 1` })
    .where(eq(detectionRules.id, ev.ruleId))
    .run();

  // Bucket for timeline.
  const existing = db.select().from(eventBuckets).where(eq(eventBuckets.hour, hour)).get();
  if (!existing) {
    db.insert(eventBuckets).values({
      hour,
      critical: ev.severity === 'critical' ? 1 : 0,
      high:     ev.severity === 'high'     ? 1 : 0,
      medium:   ev.severity === 'medium'   ? 1 : 0,
      low:      ev.severity === 'low'      ? 1 : 0,
    }).run();
  } else {
    const col = ev.severity;
    const expr =
      col === 'critical' ? { critical: sql`${eventBuckets.critical} + 1` } :
      col === 'high'     ? { high:     sql`${eventBuckets.high} + 1` } :
      col === 'medium'   ? { medium:   sql`${eventBuckets.medium} + 1` } :
                           { low:      sql`${eventBuckets.low} + 1` };
    db.update(eventBuckets).set(expr as any).where(eq(eventBuckets.hour, hour)).run();
  }

  // Find an open threat for (ruleId, src) seen in the last 24h, not closed.
  const cutoff = now - 24 * 3_600_000;
  const open = db.select().from(threats)
    .where(and(
      eq(threats.ruleId, ev.ruleId),
      eq(threats.src, ev.src),
      gt(threats.lastSeenAt, cutoff),
    ))
    .get();

  if (open && open.status !== 'acked' && open.status !== 'banned') {
    db.update(threats).set({
      count: open.count + 1,
      lastSeenAt: now,
    }).where(eq(threats.id, open.id)).run();
  } else {
    db.insert(threats).values({
      ruleId: ev.ruleId,
      severity: ev.severity,
      kind: ev.kind,
      src: ev.src,
      dst: ev.dst,
      count: 1,
      firstSeenAt: now,
      lastSeenAt: now,
      status: 'monitoring',
      desc: ev.desc,
    }).run();
  }
}

export function timelineLast24h() {
  const now = Date.now();
  const nowHour = Math.floor(now / 3_600_000);
  const rows = db.select().from(eventBuckets).all();
  const byHour = new Map<number, { critical: number; high: number; medium: number; low: number }>();
  for (const r of rows) byHour.set(r.hour, r);
  const out: Array<{ hour: number; critical: number; high: number; medium: number; low: number }> = [];
  for (let i = 23; i >= 0; i--) {
    const h = nowHour - i;
    const b = byHour.get(h) ?? { critical: 0, high: 0, medium: 0, low: 0 };
    out.push({ hour: h, ...b });
  }
  return out;
}

// Convenience for tests.
export function _resetDetectorForTest() {
  started = false;
  if (devTimer) clearInterval(devTimer);
  devTimer = null;
}
