import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { runMigrations } from '../../server/src/db/migrate';
import { db } from '../../server/src/db/client';
import { threats, eventBuckets, detectionRules } from '../../server/src/db/schema';
import { recordEvent, timelineLast24h, _resetDetectorForTest } from '../../server/src/system/detector';
import { listBans, banIp, unbanIp } from '../../server/src/system/fail2ban';
import { eq } from 'drizzle-orm';

beforeAll(() => {
  runMigrations();
  if (db.select().from(detectionRules).all().length === 0) {
    db.insert(detectionRules).values([
      { id: 'ssh-bf',    name: 'SSH',  category: 'auth', enabled: true, severity: 'critical', threshold: 't', action: 'a', hits: 0, builtin: true },
      { id: 'port-scan', name: 'Scan', category: 'recon',enabled: true, severity: 'high',     threshold: 't', action: 'a', hits: 0, builtin: true },
    ]).run();
  }
  _resetDetectorForTest();
});

beforeEach(() => {
  db.delete(threats).run();
  db.delete(eventBuckets).run();
  db.update(detectionRules).set({ hits: 0 }).where(eq(detectionRules.id, 'ssh-bf')).run();
  db.update(detectionRules).set({ hits: 0 }).where(eq(detectionRules.id, 'port-scan')).run();
});

describe('detector.recordEvent', () => {
  it('creates a new threat for an unseen src', () => {
    recordEvent({ ruleId: 'ssh-bf', src: '1.2.3.4', dst: 'eth0:22', kind: 'SSH brute force', severity: 'critical', desc: 'first' });
    const rows = db.select().from(threats).all();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.src).toBe('1.2.3.4');
    expect(rows[0]!.count).toBe(1);
  });

  it('coalesces repeat events from the same src into one threat (count grows)', () => {
    for (let i = 0; i < 5; i++) {
      recordEvent({ ruleId: 'ssh-bf', src: '1.2.3.4', dst: 'eth0:22', kind: 'SSH brute force', severity: 'critical', desc: 'x' });
    }
    const rows = db.select().from(threats).all();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.count).toBe(5);
  });

  it('keeps separate threats per (ruleId, src)', () => {
    recordEvent({ ruleId: 'ssh-bf',    src: '1.2.3.4', dst: 'eth0:22', kind: 'SSH brute force', severity: 'critical', desc: 'x' });
    recordEvent({ ruleId: 'port-scan', src: '1.2.3.4', dst: 'eth0:*',  kind: 'Port scan',       severity: 'high',     desc: 'x' });
    recordEvent({ ruleId: 'ssh-bf',    src: '5.6.7.8', dst: 'eth0:22', kind: 'SSH brute force', severity: 'critical', desc: 'x' });
    const rows = db.select().from(threats).all();
    expect(rows).toHaveLength(3);
  });

  it('increments the matching rule hits counter', () => {
    recordEvent({ ruleId: 'ssh-bf', src: '1.2.3.4', dst: 'eth0:22', kind: 'k', severity: 'critical', desc: 'x' });
    recordEvent({ ruleId: 'ssh-bf', src: '1.2.3.4', dst: 'eth0:22', kind: 'k', severity: 'critical', desc: 'x' });
    const r = db.select().from(detectionRules).where(eq(detectionRules.id, 'ssh-bf')).get();
    expect(r?.hits).toBe(2);
  });

  it('buckets events by hour and severity', () => {
    recordEvent({ ruleId: 'ssh-bf',    src: '1.2.3.4', dst: '-', kind: 'k', severity: 'critical', desc: 'x' });
    recordEvent({ ruleId: 'port-scan', src: '5.6.7.8', dst: '-', kind: 'k', severity: 'high',     desc: 'x' });
    recordEvent({ ruleId: 'port-scan', src: '9.9.9.9', dst: '-', kind: 'k', severity: 'high',     desc: 'x' });
    const tl = timelineLast24h();
    expect(tl).toHaveLength(24);
    const totals = tl.reduce((a, b) => ({ critical: a.critical + b.critical, high: a.high + b.high, medium: 0, low: 0 }), { critical: 0, high: 0, medium: 0, low: 0 });
    expect(totals.critical).toBe(1);
    expect(totals.high).toBe(2);
  });
});

describe('fail2ban (mock on macOS dev)', () => {
  it('listBans returns seeded mock bans', async () => {
    const bans = await listBans();
    expect(bans.length).toBeGreaterThan(0);
    expect(bans[0]!.ip).toMatch(/^\d+\.\d+\.\d+\.\d+$/);
  });

  it('banIp + unbanIp round-trips an entry', async () => {
    const before = (await listBans()).length;
    await banIp('203.0.113.99', 'sshd');
    const after = await listBans();
    expect(after.length).toBe(before + 1);
    expect(after.some(b => b.ip === '203.0.113.99')).toBe(true);
    await unbanIp('203.0.113.99');
    const final = await listBans();
    expect(final.some(b => b.ip === '203.0.113.99')).toBe(false);
  });
});
