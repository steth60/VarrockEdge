import { describe, it, expect, beforeAll } from 'vitest';
import { runMigrations } from '../../server/src/db/migrate';
import { db } from '../../server/src/db/client';
import { wgPeers, wgServer, networks } from '../../server/src/db/schema';
import {
  ensureServerAsync,
  renderServerConfig,
  renderPeerConf,
  renderRemotePeerSnippet,
  rotateServerKeys,
  addPeer,
  genKeys,
} from '../../server/src/system/wireguard';
import { eq } from 'drizzle-orm';

beforeAll(async () => {
  runMigrations();
  await ensureServerAsync();
  // A known enabled network so localCidrs() (peer-facing AllowedIPs) is testable.
  if (!db.select().from(networks).all().some(n => n.subnet === '10.77.0.0/24')) {
    db.insert(networks).values({
      name: 'WG Test Net', vlanId: 770, iface: 'eth1', subnet: '10.77.0.0/24',
      gateway: '10.77.0.1', dhcpEnabled: true, dhcpStart: '10.77.0.50', dhcpEnd: '10.77.0.200',
      leaseTime: '24h', dnsServers: '1.1.1.1', domain: 'varrok.local',
      purpose: 'iot', enabled: true, isDefault: false, upnpAllowed: false, createdAt: Date.now(),
    }).run();
  }
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

  it('site peer: addPeer creates the row and rendered config carries Endpoint + remote subnet', async () => {
    db.delete(wgPeers).run();
    const remotePub = (await genKeys()).publicKey;
    const peer = await addPeer({
      name: 'london',
      kind: 'site',
      remoteSubnet: '10.20.0.0/24',
      remoteEndpoint: '203.0.113.42:51820',
      providedPublicKey: remotePub,
    });
    expect(peer.kind).toBe('site');
    expect(peer.allowedIps).toBe('10.20.0.0/24');
    expect(peer.remoteEndpoint).toBe('203.0.113.42:51820');
    const conf = renderServerConfig();
    expect(conf).toContain(`PublicKey = ${remotePub}`);
    expect(conf).toContain('AllowedIPs = 10.20.0.0/24');
    expect(conf).toContain('Endpoint = 203.0.113.42:51820');
    // A site peer adds return forwarding + a scoped MASQUERADE into the LANs.
    expect(conf).toMatch(/PostUp =.*FORWARD -o wg0 -j ACCEPT/);
    expect(conf).toContain('iptables -t nat -A POSTROUTING -s 10.20.0.0/24 -o eth1+ -j MASQUERADE');
  });

  it('site peer: responder role has no Endpoint in the rendered config', async () => {
    db.delete(wgPeers).run();
    const remotePub = (await genKeys()).publicKey;
    await addPeer({
      name: 'remote-pop',
      kind: 'site',
      remoteSubnet: '10.30.0.0/24',
      providedPublicKey: remotePub,
      // no remoteEndpoint → responder
    });
    const conf = renderServerConfig();
    const peerBlock = conf.split('[Peer]')[1] ?? '';
    expect(peerBlock).not.toMatch(/Endpoint =/);
  });

  it('renderRemotePeerSnippet uses server publicEndpoint and produces a valid [Peer] block', async () => {
    db.delete(wgPeers).run();
    // Set a public endpoint so the snippet has a real Endpoint line.
    const s = db.select().from(wgServer).get()!;
    db.update(wgServer).set({ publicEndpoint: '51.38.114.207' }).where(eq(wgServer.id, s.id)).run();
    const remotePub = (await genKeys()).publicKey;
    const peer = await addPeer({
      name: 'paris',
      kind: 'site',
      remoteSubnet: '10.40.0.0/24',
      providedPublicKey: remotePub,
    });
    const snippet = renderRemotePeerSnippet(peer.id);
    expect(snippet).toMatch(/^\[Peer\]/m);
    expect(snippet).toContain(`PublicKey = ${db.select().from(wgServer).get()!.publicKey}`);
    expect(snippet).toMatch(/Endpoint = 51\.38\.114\.207:\d+/);
    // AllowedIPs is derived from the tunnel CIDR + real networks, not a
    // hardcoded /24.
    const allowed = snippet.split('\n').find(l => l.startsWith('AllowedIPs ='))!;
    expect(allowed).toContain('10.10.0.0/24');   // tunnel CIDR
    expect(allowed).toContain('10.77.0.0/24');   // a real network subnet
    expect(allowed).not.toBe('AllowedIPs = 10.0.0.0/24');
  });

  it('rotateServerKeys swaps the key and existing peer .conf reflects the new pubkey', async () => {
    db.delete(wgPeers).run();
    // Add a road-warrior with generated keys so we can re-render its .conf.
    const before = await addPeer({ name: 'phone', kind: 'road-warrior' });
    const oldServer = db.select().from(wgServer).get()!;
    const { publicKey: newPub } = await rotateServerKeys();
    expect(newPub).not.toBe(oldServer.publicKey);
    const conf = renderPeerConf(before.id);
    expect(conf).toContain(`PublicKey = ${newPub}`);
    expect(conf).not.toContain(`PublicKey = ${oldServer.publicKey}`);
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
    // Road-warrior split-tunnel routes the real networks (tunnel CIDR present).
    expect(conf).toMatch(/AllowedIPs =.*10\.10\.0\.0\/24/);
    expect(conf).toContain('PersistentKeepalive = 25');
  });
});
