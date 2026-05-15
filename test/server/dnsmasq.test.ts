import { describe, it, expect, beforeAll } from 'vitest';
import { runMigrations } from '../../server/src/db/migrate';
import { db } from '../../server/src/db/client';
import { dhcpReservations, dhcpScope, dnsRecords, networks } from '../../server/src/db/schema';
import { renderMainConf, renderStaticConf, renderDnsConf } from '../../server/src/system/dnsmasq';

beforeAll(() => {
  runMigrations();
  if (db.select().from(dhcpScope).all().length === 0) {
    db.insert(dhcpScope).values({}).run();
  }
  if (db.select().from(networks).all().length === 0) {
    db.insert(networks).values({
      name: 'Default LAN', vlanId: null, iface: 'eth1', subnet: '10.0.0.0/24',
      gateway: '10.0.0.1', dhcpEnabled: true, dhcpStart: '10.0.0.50', dhcpEnd: '10.0.0.200',
      leaseTime: '24h', dnsServers: '10.0.0.1,1.1.1.1', domain: 'varrok.local',
      purpose: 'corporate', enabled: true, isDefault: true, createdAt: Date.now(),
    }).run();
  }
});

describe('dnsmasq config rendering', () => {
  it('renderMainConf binds to LAN iface, never WAN', () => {
    const conf = renderMainConf();
    expect(conf).toMatch(/^interface=eth1$/m);
    expect(conf).toMatch(/^bind-interfaces$/m);
    expect(conf).not.toMatch(/interface=eth0/);
  });

  it('renderMainConf emits a tagged DHCP range per network', () => {
    const conf = renderMainConf();
    expect(conf).toMatch(/dhcp-range=set:net\d+,10\.0\.0\.50,10\.0\.0\.200,24h/);
    expect(conf).toMatch(/dhcp-option=tag:net\d+,3,10\.0\.0\.1/);
  });

  it('renderStaticConf emits a dhcp-host line per reservation', () => {
    db.delete(dhcpReservations).run();
    db.insert(dhcpReservations).values([
      { hostname: 'runner-01', mac: 'aa:bb:cc:11:22:33', ip: '10.0.0.10', lease: '24h' },
      { hostname: 'nas',       mac: '6c:b3:11:8e:a2:0d', ip: '10.0.0.61', lease: '24h' },
    ]).run();
    const out = renderStaticConf();
    expect(out).toContain('dhcp-host=aa:bb:cc:11:22:33,runner-01,10.0.0.10,24h');
    expect(out).toContain('dhcp-host=6c:b3:11:8e:a2:0d,nas,10.0.0.61,24h');
  });

  it('renderDnsConf emits the right directive per record type', () => {
    db.delete(dnsRecords).run();
    db.insert(dnsRecords).values([
      { host: 'a.varrok.local',     type: 'A',     target: '10.0.0.10', ttl: 300 },
      { host: 'b.varrok.local',     type: 'CNAME', target: 'a.varrok.local', ttl: 300 },
      { host: '_dmarc.varrok.local',type: 'TXT',   target: 'v=DMARC1; p=none;', ttl: 300 },
    ]).run();
    const out = renderDnsConf();
    expect(out).toContain('address=/a.varrok.local/10.0.0.10');
    expect(out).toContain('cname=b.varrok.local,a.varrok.local');
    expect(out).toContain('txt-record=_dmarc.varrok.local,v=DMARC1; p=none;');
  });
});
