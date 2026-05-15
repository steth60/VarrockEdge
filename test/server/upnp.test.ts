import { describe, it, expect, beforeAll } from 'vitest';
import { runMigrations } from '../../server/src/db/migrate';
import { db } from '../../server/src/db/client';
import { networks } from '../../server/src/db/schema';
import { renderConfig, listMappings, isUpnpEnabled, setUpnpEnabled } from '../../server/src/system/upnp';

beforeAll(() => {
  runMigrations();
});

describe('miniupnpd config rendering', () => {
  it('always emits the security fundamentals', () => {
    const conf = renderConfig();
    expect(conf).toMatch(/^ext_ifname=eth0$/m);
    expect(conf).toMatch(/^secure_mode=yes$/m);          // map to own IP only
    expect(conf).toMatch(/^enable_natpmp=yes$/m);
    expect(conf).toMatch(/^deny 0-65535 0\.0\.0\.0\/0 0-65535$/m); // default-deny
  });

  it('adds listening_ip + an allow rule for each UPnP-allowed network', () => {
    db.insert(networks).values({
      name: 'UPnP Test Net', vlanId: 4050, iface: 'eth1', subnet: '10.50.0.0/24',
      gateway: '10.50.0.1', dhcpEnabled: true, dhcpStart: '10.50.0.50', dhcpEnd: '10.50.0.200',
      leaseTime: '24h', dnsServers: '1.1.1.1', domain: 'varrok.local',
      purpose: 'iot', enabled: true, isDefault: false, upnpAllowed: true, createdAt: Date.now(),
    }).run();
    const conf = renderConfig();
    expect(conf).toMatch(/^listening_ip=eth1\.4050$/m);
    expect(conf).toMatch(/^allow 1024-65535 10\.50\.0\.0\/24 1024-65535$/m);
  });

  it('does not list a network that has not opted in', () => {
    db.insert(networks).values({
      name: 'No UPnP Net', vlanId: 4051, iface: 'eth1', subnet: '10.51.0.0/24',
      gateway: '10.51.0.1', dhcpEnabled: true, dhcpStart: '10.51.0.50', dhcpEnd: '10.51.0.200',
      leaseTime: '24h', dnsServers: '1.1.1.1', domain: 'varrok.local',
      purpose: 'iot', enabled: true, isDefault: false, upnpAllowed: false, createdAt: Date.now(),
    }).run();
    expect(renderConfig()).not.toMatch(/10\.51\.0\.0\/24/);
  });
});

describe('miniupnpd state', () => {
  it('listMappings returns synthetic mappings in dev mode', () => {
    const m = listMappings();
    expect(m.length).toBeGreaterThan(0);
    expect(m.every(x => x.proto === 'TCP' || x.proto === 'UDP')).toBe(true);
  });

  it('setUpnpEnabled toggles the persisted master switch', async () => {
    expect(isUpnpEnabled()).toBe(false);
    await setUpnpEnabled(true);
    expect(isUpnpEnabled()).toBe(true);
    await setUpnpEnabled(false);
    expect(isUpnpEnabled()).toBe(false);
  });
});
