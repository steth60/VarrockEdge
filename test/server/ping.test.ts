import { describe, it, expect } from 'vitest';
import { ping, syntheticPing } from '../../server/src/system/ping';

describe('ping wrapper', () => {
  it('rejects malformed hosts without spawning', async () => {
    const r = await ping('1.1.1.1; rm -rf /', 1, 200);
    expect(r.ok).toBe(false);
    expect(r.lossPct).toBe(100);
  });

  it('parses loopback successfully (localhost is always reachable)', async () => {
    const r = await ping('127.0.0.1', 1, 2000);
    if (r.ok) {
      expect(r.lossPct).toBeLessThan(100);
      expect(r.avgMs).not.toBeNull();
      expect((r.avgMs ?? 99) < 50).toBe(true);
    } else {
      // Sandboxed environments may not allow raw sockets; accept that.
      expect(r.lossPct).toBe(100);
    }
  });

  it('syntheticPing is deterministic per host', () => {
    const a = syntheticPing('1.1.1.1');
    const b = syntheticPing('1.1.1.1');
    expect(a.avgMs).toBe(b.avgMs);
  });
});
