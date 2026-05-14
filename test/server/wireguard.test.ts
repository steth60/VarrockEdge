import { describe, it, expect, beforeAll } from 'vitest';
import { runMigrations } from '../../server/src/db/migrate';
import { db } from '../../server/src/db/client';
import { wgPeers, wgServer } from '../../server/src/db/schema';
import { ensureServerAsync, renderServerConfig, renderPeerConf, genKeys } from '../../server/src/system/wireguard';

beforeAll(async () => {
  runMigrations();
  await ensureServerAsync();
});

describe('wireguard', () => {
  it('genKeys returns three non-empty base64 strings on macOS dev', async () => {
    const k = await genKeys();
    expect(k.privateKey).toMatch(/^[A-Za-z0-9+/=]{8,}$/);
    expect(k.publicKey).toMatch(/^[A-Za-z0-9+/=]{8,}$/);
    expect(k.presharedKey).toMatch(/^[A-Za-z0-9+/=]{8,}$/);
    expect(new Set([k.privateKey, k.publicKey, k.presharedKey]).size).toBe(3);
  });

  it('renderServerConfig contains [Interface] and required directives', () => {
    const conf = renderServerConfig();
    expect(conf).toMatch(/^\[Interface\]/m);
    expect(conf).toMatch(/^PrivateKey =/m);
    expect(conf).toMatch(/^ListenPort = \d+/m);
    expect(conf).toMatch(/PostUp =.*MASQUERADE/);
    expect(conf).toMatch(/PostDown =.*MASQUERADE/);
  });

  it('renderPeerConf emits the server pubkey and AllowedIPs', () => {
    db.delete(wgPeers).run();
    const server = db.select().from(wgServer).get()!;
    const row = db.insert(wgPeers).values({
      name: 'test-peer',
      publicKey: 'PEERPUB===',
      privateKey: 'PEERPRIV===',
      presharedKey: 'PEERPSK===',
      allowedIps: '10.10.0.2/32',
      keepalive: 25,
      kind: 'road-warrior',
    }).returning().get();

    const conf = renderPeerConf(row.id);
    expect(conf).toMatch(/^\[Interface\]/m);
    expect(conf).toContain('PrivateKey = PEERPRIV===');
    expect(conf).toContain('Address = 10.10.0.2/32');
    expect(conf).toMatch(/^\[Peer\]/m);
    expect(conf).toContain(`PublicKey = ${server.publicKey}`);
    expect(conf).toContain('PresharedKey = PEERPSK===');
    expect(conf).toMatch(/AllowedIPs = 10\.0\.0\.0\/24/);
    expect(conf).toContain('PersistentKeepalive = 25');
  });
});
