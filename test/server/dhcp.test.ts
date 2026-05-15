import { describe, it, expect, beforeAll } from 'vitest';
import express from 'express';
import request from 'supertest';
import { runMigrations } from '../../server/src/db/migrate';
import { db } from '../../server/src/db/client';
import { networks, dhcpReservations } from '../../server/src/db/schema';
import { reachableIps } from '../../server/src/system/scan';
import dhcpRoutes from '../../server/src/routes/dhcp';

const app = express();
app.use(express.json());
app.use('/api/dhcp', dhcpRoutes);

beforeAll(() => {
  runMigrations();
  if (db.select().from(networks).all().some(n => n.subnet === '10.20.0.0/24')) return;
  db.insert(networks).values({
    name: 'DHCP Test Net', vlanId: 320, iface: 'eth1', subnet: '10.20.0.0/24',
    gateway: '10.20.0.1', dhcpEnabled: true, dhcpStart: '10.20.0.50', dhcpEnd: '10.20.0.200',
    leaseTime: '24h', dnsServers: '1.1.1.1', domain: 'varrok.local',
    purpose: 'iot', enabled: true, isDefault: false, upnpAllowed: false, createdAt: Date.now(),
  }).run();
  db.insert(dhcpReservations).values({
    hostname: 'fixed-host', mac: 'de:ad:be:ef:03:20', ip: '10.20.0.10', lease: '24h',
  }).run();
});

describe('reachableIps', () => {
  it('returns a set of IPs (synthetic in dev mode)', () => {
    const ips = reachableIps();
    expect(ips).toBeInstanceOf(Set);
    expect(ips.size).toBeGreaterThan(0);
  });
});

describe('GET /api/dhcp/clients', () => {
  it('merges reservations as fixed clients, annotated with their network', async () => {
    const r = await request(app).get('/api/dhcp/clients');
    expect(r.status).toBe(200);
    const c = r.body.clients.find((x: any) => x.mac === 'de:ad:be:ef:03:20');
    expect(c).toBeDefined();
    expect(c.leaseType).toBe('fixed');
    expect(c.networkName).toBe('DHCP Test Net');
    expect(c.vlanId).toBe(320);
    expect(c.status === 'online' || c.status === 'offline').toBe(true);
  });
});

describe('GET /api/dhcp/reservations', () => {
  it('annotates each reservation with its network', async () => {
    const r = await request(app).get('/api/dhcp/reservations');
    expect(r.status).toBe(200);
    const row = r.body.reservations.find((x: any) => x.mac === 'de:ad:be:ef:03:20');
    expect(row.networkName).toBe('DHCP Test Net');
    expect(row.vlanId).toBe(320);
  });
});
