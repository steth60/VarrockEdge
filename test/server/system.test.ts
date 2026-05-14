import { describe, it, expect } from 'vitest';
import { currentVersion } from '../../server/src/system/updater';
import { checkRequirements } from '../../server/src/system/systemd';

describe('updater.currentVersion', () => {
  it('returns a sensible shape', async () => {
    const v = await currentVersion();
    expect(typeof v.gitAvailable).toBe('boolean');
    if (v.gitAvailable) {
      expect(v.sha).toMatch(/^[0-9a-f]{40}$/);
      expect(v.short).toMatch(/^[0-9a-f]{4,12}$/);
    } else {
      expect(v.sha).toBeNull();
      expect(v.short).toBeNull();
    }
  });
});

describe('systemd.checkRequirements', () => {
  it('returns a list with apt-installable `pkg` fields for each tool', async () => {
    const reqs = await checkRequirements();
    expect(reqs.length).toBeGreaterThan(5);
    const dnsm = reqs.find(r => r.binary === 'dnsmasq');
    expect(dnsm?.pkg).toBe('dnsmasq');
    const wg = reqs.find(r => r.binary === 'wg');
    expect(wg?.pkg).toBe('wireguard-tools');
    // systemd built-ins shouldn't have an apt package.
    const sc = reqs.find(r => r.binary === 'systemctl');
    expect(sc?.pkg).toBeNull();
  });

  it('every requirement row has the expected shape', async () => {
    const reqs = await checkRequirements();
    for (const r of reqs) {
      expect(typeof r.binary).toBe('string');
      expect(typeof r.feature).toBe('string');
      expect(typeof r.installed).toBe('boolean');
      expect(r.pkg === null || typeof r.pkg === 'string').toBe(true);
    }
  });
});
