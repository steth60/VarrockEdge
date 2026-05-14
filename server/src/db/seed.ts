import { db } from './client';
import { users, dhcpScope, dnsUpstreams, fwSnat, detectionRules } from './schema';
import { hash } from '../auth/password';
import { config } from '../config';
import { log } from '../logger';
import { runMigrations } from './migrate';
import { eq } from 'drizzle-orm';

const DEFAULT_RULES = [
  { id: 'ssh-bf',     name: 'SSH brute force',           category: 'Authentication', enabled: true,  severity: 'critical', threshold: '6 attempts / 60s',         action: 'ban 7d' },
  { id: 'port-scan',  name: 'TCP/UDP port scan',         category: 'Reconnaissance', enabled: true,  severity: 'high',     threshold: '40 ports / 30s',           action: 'ban 24h' },
  { id: 'dns-amp',    name: 'DNS amplification',         category: 'DNS abuse',      enabled: true,  severity: 'high',     threshold: 'ANY queries from non-LAN', action: 'rate-limit' },
  { id: 'http-flood', name: 'HTTP flood',                category: 'DDoS',           enabled: true,  severity: 'high',     threshold: '500 req/s sustained',      action: 'rate-limit + ban' },
  { id: 'tor-egress', name: 'Outbound to Tor relay',     category: 'Egress',         enabled: true,  severity: 'medium',   threshold: 'any match',                action: 'alert + flag' },
  { id: 'wg-fail',    name: 'Repeated WG handshake fail',category: 'VPN',            enabled: true,  severity: 'medium',   threshold: '10 fails / 5m',            action: 'rate-limit' },
  { id: 'new-mac',    name: 'New device on LAN',         category: 'LAN visibility', enabled: true,  severity: 'low',      threshold: 'first DHCP lease for MAC', action: 'notify' },
  { id: 'geo-vel',    name: 'Geo-velocity (admin login)',category: 'Authentication', enabled: true,  severity: 'low',      threshold: '>1000 km / 4h',            action: 'require MFA' },
  { id: 'crypto-mine',name: 'Cryptojacking pattern',     category: 'Egress',         enabled: false, severity: 'medium',   threshold: 'matches known pools',      action: 'block + alert' },
];

async function main() {
  runMigrations();

  const existing = db.select().from(users).where(eq(users.email, 'admin@varrok.local')).all();
  if (existing.length === 0) {
    const passwordHash = await hash(config.adminPassword);
    db.insert(users).values({
      email: 'admin@varrok.local',
      name: 'Administrator',
      passwordHash,
      role: 'Owner',
      status: 'active',
    }).run();
    log.info({ email: 'admin@varrok.local' }, 'seeded admin user');
  }

  const scope = db.select().from(dhcpScope).all();
  if (scope.length === 0) {
    db.insert(dhcpScope).values({}).run();
    log.info('seeded default DHCP scope');
  }

  const ups = db.select().from(dnsUpstreams).all();
  if (ups.length === 0) {
    db.insert(dnsUpstreams).values([
      { ip: '1.1.1.1', provider: 'Cloudflare' },
      { ip: '1.0.0.1', provider: 'Cloudflare' },
      { ip: '8.8.8.8', provider: 'Google' },
    ]).run();
    log.info('seeded DNS upstreams');
  }

  const rules = db.select().from(detectionRules).all();
  if (rules.length === 0) {
    for (const r of DEFAULT_RULES) {
      db.insert(detectionRules).values({ ...r, hits: 0, builtin: true }).run();
    }
    log.info({ count: DEFAULT_RULES.length }, 'seeded detection rules');
  }

  const core = db.select().from(fwSnat).all();
  if (core.length === 0) {
    db.insert(fwSnat).values({
      source: '10.0.0.0/24',
      outIface: config.wanIface,
      mode: 'MASQUERADE',
      toSource: null,
      comment: 'default lan egress (core)',
      enabled: true,
      isCore: true,
    }).run();
    log.info('seeded core MASQUERADE rule');
  }
}

main().then(() => process.exit(0)).catch(err => {
  log.error({ err }, 'seed failed');
  process.exit(1);
});
