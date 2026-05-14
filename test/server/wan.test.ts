import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { runMigrations } from '../../server/src/db/migrate';
import { db } from '../../server/src/db/client';
import { wanInterfaces, wanHealth } from '../../server/src/db/schema';
import { listWans, addWan, patchWan, removeWan } from '../../server/src/system/wan';

beforeAll(() => { runMigrations(); });

beforeEach(() => {
  db.delete(wanHealth).run();
  db.delete(wanInterfaces).run();
});

describe('wan CRUD', () => {
  it('addWan inserts with defaults', () => {
    const w = addWan({ iface: 'eth-test-0', label: 'Test primary' });
    expect(w.iface).toBe('eth-test-0');
    expect(w.role).toBe('primary');
    expect(w.priority).toBe(100);
    expect(w.healthTarget).toBe('1.1.1.1');
    expect(w.enabled).toBe(true);
  });

  it('listWans returns rows + health stub when no health yet', () => {
    addWan({ iface: 'eth-test-1', label: 'Failover' });
    const all = listWans();
    expect(all).toHaveLength(1);
    expect(all[0]!.health.status).toBe('down');
  });

  it('patchWan updates fields', () => {
    const w = addWan({ iface: 'eth-test-2', label: 'A' });
    patchWan(w.id, { priority: 250, role: 'failover', enabled: false });
    const r = listWans().find(x => x.id === w.id)!;
    expect(r.priority).toBe(250);
    expect(r.role).toBe('failover');
    expect(r.enabled).toBe(false);
  });

  it('removeWan also clears its health rows', () => {
    const w = addWan({ iface: 'eth-test-3', label: 'X' });
    db.insert(wanHealth).values({ iface: 'eth-test-3', ts: Date.now(), status: 'up', rttMs: 12, lossPct: 0 }).run();
    expect(db.select().from(wanHealth).all()).toHaveLength(1);
    removeWan(w.id);
    expect(db.select().from(wanHealth).all()).toHaveLength(0);
    expect(listWans()).toHaveLength(0);
  });
});

describe('wan health linkage', () => {
  it('listWans surfaces the most recent health row', () => {
    addWan({ iface: 'eth-h-0', label: 'X' });
    const t0 = Date.now() - 5000;
    const t1 = Date.now();
    db.insert(wanHealth).values({ iface: 'eth-h-0', ts: t0, status: 'down', rttMs: null, lossPct: 100 }).run();
    db.insert(wanHealth).values({ iface: 'eth-h-0', ts: t1, status: 'up',   rttMs: 14, lossPct: 0 }).run();
    const w = listWans()[0]!;
    expect(w.health.status).toBe('up');
    expect(w.health.rttMs).toBe(14);
  });
});
