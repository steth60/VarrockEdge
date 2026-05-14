import { db } from './client';
import { users, dhcpScope, dnsUpstreams, fwSnat } from './schema';
import { hash } from '../auth/password';
import { config } from '../config';
import { log } from '../logger';
import { runMigrations } from './migrate';
import { eq } from 'drizzle-orm';

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
