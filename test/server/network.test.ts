import { describe, it, expect, beforeAll } from 'vitest';
import { runMigrations } from '../../server/src/db/migrate';
import { db } from '../../server/src/db/client';
import { networks } from '../../server/src/db/schema';
import {
  prefixOf, ipInSubnet, usableHosts, vlanIfaceName,
  createNetwork, deleteNetwork, getDefaultNetwork,
} from '../../server/src/system/network';

beforeAll(() => {
  runMigrations();
  if (db.select().from(networks).all().length === 0) {
    db.insert(networks).values({
      name: 'Default LAN', vlanId: null, iface: 'eth1', subnet: '10.0.0.0/24',
      gateway: '10.0.0.1', dhcpEnabled: true, dhcpStart: '10.0.0.50', dhcpEnd: '10.0.0.200',
      leaseTime: '24h', dnsServers: '1.1.1.1', domain: 'varrok.local',
      purpose: 'corporate', enabled: true, isDefault: true, createdAt: Date.now(),
    }).run();
  }
});

describe('CIDR helpers', () => {
  it('prefixOf extracts the prefix length', () => {
    expect(prefixOf('10.0.0.0/24')).toBe(24);
    expect(prefixOf('192.168.0.0/16')).toBe(16);
    expect(prefixOf('garbage')).toBe(24); // safe default
  });

  it('ipInSubnet matches addresses inside a subnet', () => {
    expect(ipInSubnet('10.0.0.74', '10.0.0.0/24')).toBe(true);
    expect(ipInSubnet('10.0.1.5', '10.0.0.0/24')).toBe(false);
    expect(ipInSubnet('10.10.114.50', '10.10.114.0/24')).toBe(true);
    expect(ipInSubnet('not-an-ip', '10.0.0.0/24')).toBe(false);
  });

  it('usableHosts excludes network + broadcast', () => {
    expect(usableHosts('10.0.0.0/24')).toBe(254);
    expect(usableHosts('10.0.0.0/30')).toBe(2);
  });

  it('vlanIfaceName appends the VLAN tag only when set', () => {
    expect(vlanIfaceName({ iface: 'eth1', vlanId: 114 })).toBe('eth1.114');
    expect(vlanIfaceName({ iface: 'eth1', vlanId: null })).toBe('eth1');
  });
});

describe('network CRUD', () => {
  it('creates and deletes a VLAN network', async () => {
    const before = db.select().from(networks).all().length;
    const row = await createNetwork({
      name: 'Test VLAN', vlanId: 4002, iface: 'eth1',
      subnet: '10.40.2.0/24', gateway: '10.40.2.1',
      dhcpStart: '10.40.2.50', dhcpEnd: '10.40.2.200',
    });
    expect(row.vlanId).toBe(4002);
    expect(db.select().from(networks).all().length).toBe(before + 1);
    const del = await deleteNetwork(row.id);
    expect(del.ok).toBe(true);
    expect(db.select().from(networks).all().length).toBe(before);
  });

  it('refuses to delete the default network', async () => {
    const def = getDefaultNetwork();
    expect(def).toBeDefined();
    const r = await deleteNetwork(def!.id);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/default/);
  });
});
