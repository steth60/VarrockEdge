import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { exec } from './exec';
import { config } from '../config';
import { db } from '../db/client';
import { wgPeers, wgServer } from '../db/schema';
import { eq } from 'drizzle-orm';
import { log } from '../logger';

const WG_DIR = config.onLinux ? '/etc/wireguard' : path.join(config.configDir, 'wireguard');
const WG_CONF = path.join(WG_DIR, 'wg0.conf');

export interface KeyTriple {
  privateKey: string;
  publicKey: string;
  presharedKey: string;
}

function mockBase64Key(): string {
  return crypto.randomBytes(32).toString('base64');
}

export async function genKeys(): Promise<KeyTriple> {
  if (!config.onLinux) {
    return { privateKey: mockBase64Key(), publicKey: mockBase64Key(), presharedKey: mockBase64Key() };
  }
  const priv = (await exec('wg', ['genkey'])).stdout.trim();
  const pub  = (await exec('wg', ['pubkey'], { stdin: priv })).stdout.trim();
  const psk  = (await exec('wg', ['genpsk'])).stdout.trim();
  return { privateKey: priv, publicKey: pub, presharedKey: psk };
}

// DER prefixes for X25519 keys — let us round-trip raw 32-byte curve25519
// keys through Node's crypto without shelling out to `wg pubkey`.
const X25519_PKCS8_PREFIX = Buffer.from('302e020100300506032b656e04220420', 'hex');

/** Derive the WireGuard public key from a base64 private key (curve25519). */
export function derivePublicKey(privateKeyB64: string): string {
  const raw = Buffer.from(privateKeyB64, 'base64');
  if (raw.length !== 32) throw new Error('private key must be 32 bytes of base64');
  const der = Buffer.concat([X25519_PKCS8_PREFIX, raw]);
  const priv = crypto.createPrivateKey({ key: der, format: 'der', type: 'pkcs8' });
  const spki = crypto.createPublicKey(priv).export({ type: 'spki', format: 'der' });
  return spki.subarray(spki.length - 32).toString('base64');
}

export interface ParsedWgConfig {
  iface: { privateKey?: string; address?: string; dns?: string; mtu?: number; listenPort?: number };
  peers: { publicKey?: string; presharedKey?: string; allowedIps?: string; endpoint?: string; keepalive?: number }[];
}

/** Parse a WireGuard .conf (INI-like) into structured sections. */
export function parseWgConfig(text: string): ParsedWgConfig {
  const cfg: ParsedWgConfig = { iface: {}, peers: [] };
  let section: 'iface' | 'peer' | null = null;
  let cur: ParsedWgConfig['peers'][number] | null = null;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, '').trim();
    if (!line) continue;
    const sec = line.match(/^\[(\w+)\]$/i);
    if (sec) {
      const name = sec[1].toLowerCase();
      if (name === 'interface') { section = 'iface'; cur = null; }
      else if (name === 'peer') { section = 'peer'; cur = {}; cfg.peers.push(cur); }
      else { section = null; cur = null; }
      continue;
    }
    const kv = line.match(/^([A-Za-z]+)\s*=\s*(.+)$/);
    if (!kv) continue;
    const key = kv[1].toLowerCase();
    const val = kv[2].trim();
    if (section === 'iface') {
      if (key === 'privatekey') cfg.iface.privateKey = val;
      else if (key === 'address') cfg.iface.address = val;
      else if (key === 'dns') cfg.iface.dns = val;
      else if (key === 'mtu') cfg.iface.mtu = Number(val) || undefined;
      else if (key === 'listenport') cfg.iface.listenPort = Number(val) || undefined;
    } else if (section === 'peer' && cur) {
      if (key === 'publickey') cur.publicKey = val;
      else if (key === 'presharedkey') cur.presharedKey = val;
      else if (key === 'allowedips') cur.allowedIps = val;
      else if (key === 'endpoint') cur.endpoint = val;
      else if (key === 'persistentkeepalive') cur.keepalive = Number(val) || undefined;
    }
  }
  return cfg;
}

export interface ImportPeerResult {
  peer: typeof wgPeers.$inferSelect;
  warnings: string[];
}

/**
 * Register a road-warrior peer from a pasted/uploaded client .conf.
 * The client config's [Interface] is the peer (private key + tunnel IP);
 * its [Peer] block describes a server — we validate it against ours.
 */
export async function importPeerFromConfig(name: string, configText: string): Promise<ImportPeerResult> {
  const server = ensureServer();
  if (!server) throw new Error('wg server not initialized');
  const parsed = parseWgConfig(configText);
  const warnings: string[] = [];

  const privateKey = parsed.iface.privateKey;
  if (!privateKey) throw new Error('config has no [Interface] PrivateKey — cannot import as a road-warrior peer');
  if (!parsed.iface.address) throw new Error('config has no [Interface] Address');

  let publicKey: string;
  try {
    publicKey = derivePublicKey(privateKey);
  } catch (e: any) {
    throw new Error(`could not derive public key from PrivateKey: ${e?.message ?? e}`);
  }

  const existing = db.select().from(wgPeers).where(eq(wgPeers.publicKey, publicKey)).get();
  if (existing) throw new Error(`a peer with this key already exists ("${existing.name}")`);

  // The [Peer] block of a client config is the server it dials.
  const srvPeer = parsed.peers[0];
  if (srvPeer?.publicKey && srvPeer.publicKey !== server.publicKey) {
    warnings.push('config’s [Peer] PublicKey does not match this appliance — the .conf was issued for a different WireGuard server');
  }
  if (srvPeer?.endpoint && server.publicEndpoint) {
    const host = srvPeer.endpoint.split(':')[0];
    if (host && host !== server.publicEndpoint) {
      warnings.push(`config’s Endpoint (${srvPeer.endpoint}) differs from this appliance’s public endpoint (${server.publicEndpoint})`);
    }
  }
  if (parsed.peers.length > 1) {
    warnings.push(`config had ${parsed.peers.length} [Peer] blocks — only the first was used`);
  }

  const allowedIps = parsed.iface.address.split(',')
    .map(s => s.trim()).filter(Boolean)
    .map(a => a.includes('/') ? a : `${a}/32`)
    .join(',');

  const row = db.insert(wgPeers).values({
    name,
    publicKey,
    privateKey,
    presharedKey: srvPeer?.presharedKey ?? null,
    allowedIps,
    keepalive: srvPeer?.keepalive ?? 25,
    kind: 'road-warrior',
    remoteSubnet: null,
    remoteEndpoint: null,
  }).returning().get();
  await writeServerConfig();
  await reload();
  return { peer: row, warnings };
}

function ensureServer() {
  let row = db.select().from(wgServer).get();
  if (row) return row;
  // Lazy provision — sync key gen on macOS dev (mock); on Linux this is called from init flow
  if (!config.onLinux) {
    const k: KeyTriple = { privateKey: mockBase64Key(), publicKey: mockBase64Key(), presharedKey: '' };
    db.insert(wgServer).values({
      privateKey: k.privateKey,
      publicKey: k.publicKey,
      listenPort: 51820,
      tunnelCidr: '10.10.0.0/24',
      mtu: 1420,
      publicEndpoint: null,
      dnsPush: '10.0.0.1,1.1.1.1',
      defaultAllowedIps: '10.0.0.0/24',
    }).run();
    row = db.select().from(wgServer).get()!;
  }
  return row;
}

export async function ensureServerAsync() {
  if (db.select().from(wgServer).get()) return;
  const k = await genKeys();
  db.insert(wgServer).values({
    privateKey: k.privateKey,
    publicKey: k.publicKey,
    listenPort: 51820,
    tunnelCidr: '10.10.0.0/24',
    mtu: 1420,
    publicEndpoint: null,
    dnsPush: '10.0.0.1,1.1.1.1',
    defaultAllowedIps: '10.0.0.0/24',
  }).run();
  log.info('wg server keypair provisioned');
}

export function serverInfo() {
  return ensureServer();
}

function nextTunnelIp(cidr: string): string {
  const base = cidr.split('/')[0] ?? '10.10.0.0';
  const parts = base.split('.').map(Number);
  const used = new Set(db.select().from(wgPeers).all().flatMap(p => p.allowedIps.split(',').map(s => s.trim().split('/')[0] ?? '')));
  for (let i = 2; i < 254; i++) {
    const ip = `${parts[0]}.${parts[1]}.${parts[2]}.${i}`;
    if (!used.has(ip)) return ip;
  }
  return '10.10.0.250';
}

export interface AddPeerInput {
  name: string;
  allowedIps?: string;
  keepalive?: number;
  kind?: 'road-warrior' | 'site';
  remoteSubnet?: string;
  remoteEndpoint?: string;
  // If client provides keys, we trust them. Otherwise we generate.
  providedPublicKey?: string;
  providedPresharedKey?: string;
}

export async function addPeer(input: AddPeerInput) {
  const server = ensureServer();
  if (!server) throw new Error('wg server not initialized');
  const kind = input.kind ?? 'road-warrior';

  if (kind === 'site') {
    if (!input.providedPublicKey) throw new Error('site link requires a remote public key');
    if (!input.remoteSubnet) throw new Error('site link requires a remote subnet');
    const psk = input.providedPresharedKey ?? (await genKeys()).presharedKey;
    const row = db.insert(wgPeers).values({
      name: input.name,
      publicKey: input.providedPublicKey,
      privateKey: null, // we never see the remote's private key
      presharedKey: psk || null,
      allowedIps: input.remoteSubnet,
      keepalive: input.keepalive ?? 25,
      kind: 'site',
      remoteSubnet: input.remoteSubnet,
      remoteEndpoint: input.remoteEndpoint ?? null,
    }).returning().get();
    await writeServerConfig();
    await reload();
    return row;
  }

  // road-warrior: we generate the keypair so we can issue them a complete .conf
  let privateKey: string | null = null;
  let publicKey = input.providedPublicKey ?? '';
  let presharedKey = input.providedPresharedKey ?? '';
  if (!publicKey) {
    const k = await genKeys();
    privateKey = k.privateKey;
    publicKey = k.publicKey;
    if (!presharedKey) presharedKey = k.presharedKey;
  }
  const allowed = input.allowedIps ?? `${nextTunnelIp(server.tunnelCidr)}/32`;
  const row = db.insert(wgPeers).values({
    name: input.name,
    publicKey,
    privateKey,
    presharedKey: presharedKey || null,
    allowedIps: allowed,
    keepalive: input.keepalive ?? 25,
    kind: 'road-warrior',
    remoteSubnet: null,
    remoteEndpoint: null,
  }).returning().get();
  await writeServerConfig();
  await reload();
  return row;
}

export async function rotateServerKeys(): Promise<{ publicKey: string }> {
  const s = ensureServer();
  if (!s) throw new Error('server not initialized');
  const k = await genKeys();
  db.update(wgServer).set({ privateKey: k.privateKey, publicKey: k.publicKey }).where(eq(wgServer.id, s.id)).run();
  await writeServerConfig();
  await reload();
  return { publicKey: k.publicKey };
}

export async function wipe() {
  db.delete(wgPeers).run();
  db.delete(wgServer).run();
  if (config.onLinux) {
    await exec('systemctl', ['stop', 'wg-quick@wg0'], { allowFailure: true });
    try {
      const fs = await import('node:fs');
      if (fs.existsSync(WG_CONF)) fs.unlinkSync(WG_CONF);
    } catch { /* ignore */ }
  }
}

export async function restart() {
  if (!config.onLinux) return;
  await exec('systemctl', ['restart', 'wg-quick@wg0'], { allowFailure: true });
}

export function renderRemotePeerSnippet(peerId: number): string {
  const peer = db.select().from(wgPeers).where(eq(wgPeers.id, peerId)).get();
  if (!peer || peer.kind !== 'site') throw new Error('not a site peer');
  const server = ensureServer();
  if (!server) throw new Error('server not initialized');
  const lines = [
    `# Add this [Peer] block to the REMOTE side's wg0.conf`,
    `# to complete the site-to-site link with VarrokEdge.`,
    `[Peer]`,
    `# VarrokEdge edge — link "${peer.name}"`,
    `PublicKey = ${server.publicKey}`,
  ];
  if (peer.presharedKey) lines.push(`PresharedKey = ${peer.presharedKey}`);
  if (server.publicEndpoint) {
    lines.push(`Endpoint = ${server.publicEndpoint}:${server.listenPort}`);
  } else {
    lines.push(`Endpoint = YOUR.EDGE.IP:${server.listenPort}  # set publicEndpoint in Tunnel settings first`);
  }
  // Advertise our LAN as what they should route to via this peer.
  lines.push(`AllowedIPs = 10.0.0.0/24`);
  lines.push(`PersistentKeepalive = ${peer.keepalive}`);
  return lines.join('\n') + '\n';
}

export async function removePeer(id: number) {
  db.delete(wgPeers).where(eq(wgPeers.id, id)).run();
  await writeServerConfig();
  await reload();
}

export function renderPeerConf(peerId: number): string {
  const peer = db.select().from(wgPeers).where(eq(wgPeers.id, peerId)).get();
  if (!peer) throw new Error('peer not found');
  const server = ensureServer();
  if (!server) throw new Error('server not initialized');
  const lines = [
    '[Interface]',
    `PrivateKey = ${peer.privateKey ?? '<unknown — re-issue this peer>'}`,
    `Address = ${peer.allowedIps}`,
    `DNS = ${server.dnsPush}`,
    `MTU = ${server.mtu}`,
    '',
    '[Peer]',
    `PublicKey = ${server.publicKey}`,
  ];
  if (peer.presharedKey) lines.push(`PresharedKey = ${peer.presharedKey}`);
  lines.push(`Endpoint = ${server.publicEndpoint ?? 'YOUR.PUBLIC.IP'}:${server.listenPort}`);
  lines.push(`AllowedIPs = ${server.defaultAllowedIps}`);
  lines.push(`PersistentKeepalive = ${peer.keepalive}`);
  return lines.join('\n') + '\n';
}

export function renderServerConfig(): string {
  const server = ensureServer();
  if (!server) return '';
  const peers = db.select().from(wgPeers).all();
  const lines = [
    '# Managed by VarrokEdge — do not edit by hand.',
    '[Interface]',
    `PrivateKey = ${server.privateKey}`,
    `Address = ${server.tunnelCidr.split('/')[0]?.replace(/\.0$/, '.1')}/${server.tunnelCidr.split('/')[1]}`,
    `ListenPort = ${server.listenPort}`,
    `MTU = ${server.mtu}`,
    `PostUp = iptables -A FORWARD -i wg0 -j ACCEPT; iptables -t nat -A POSTROUTING -o ${config.wanIface} -j MASQUERADE`,
    `PostDown = iptables -D FORWARD -i wg0 -j ACCEPT; iptables -t nat -D POSTROUTING -o ${config.wanIface} -j MASQUERADE`,
  ];
  for (const p of peers) {
    lines.push('');
    lines.push(`# ${p.name}`);
    lines.push('[Peer]');
    lines.push(`PublicKey = ${p.publicKey}`);
    if (p.presharedKey) lines.push(`PresharedKey = ${p.presharedKey}`);
    lines.push(`AllowedIPs = ${p.allowedIps}`);
    if (p.remoteEndpoint) lines.push(`Endpoint = ${p.remoteEndpoint}`);
    if (p.keepalive) lines.push(`PersistentKeepalive = ${p.keepalive}`);
  }
  return lines.join('\n') + '\n';
}

export async function writeServerConfig() {
  if (!fs.existsSync(WG_DIR)) fs.mkdirSync(WG_DIR, { recursive: true, mode: 0o700 });
  fs.writeFileSync(WG_CONF, renderServerConfig(), { mode: 0o600 });
  log.info({ WG_CONF }, 'wg.write');
}

export async function reload() {
  if (!config.onLinux) return { stdout: '', stderr: '', code: 0, dryRun: true };
  await exec('wg', ['syncconf', 'wg0', '/dev/stdin'], { stdin: renderServerConfig(), allowFailure: true });
  return { stdout: '', stderr: '', code: 0, dryRun: false };
}

export interface PeerStatus {
  id: number;
  name: string;
  allowedIps: string;
  publicKey: string;
  endpoint: string;
  rxBytes: number;
  txBytes: number;
  handshake: string;
  status: 'connected' | 'idle' | 'offline';
  kind: string;
  remoteSubnet?: string | null;
  keepalive: number;
}

function humanBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let v = n / 1024;
  let u = 0;
  while (v >= 1024 && u < units.length - 1) { v /= 1024; u++; }
  return `${v.toFixed(1)} ${units[u]}`;
}

function humanAgo(epoch: number): string {
  const delta = Date.now() / 1000 - epoch;
  if (epoch === 0) return 'never';
  if (delta < 60) return `${Math.round(delta)}s ago`;
  if (delta < 3600) return `${Math.round(delta / 60)}m ago`;
  if (delta < 86400) return `${Math.round(delta / 3600)}h ago`;
  return `${Math.round(delta / 86400)}d ago`;
}

export async function listPeers(): Promise<PeerStatus[]> {
  const rows = db.select().from(wgPeers).all();
  if (!config.onLinux) {
    return rows.map((p, i) => ({
      id: p.id,
      name: p.name,
      allowedIps: p.allowedIps,
      publicKey: p.publicKey,
      endpoint: i % 3 === 0 ? '82.41.118.22:54211' : '—',
      rxBytes: 1.4e9 / (i + 1),
      txBytes: 342e6 / (i + 1),
      handshake: i % 3 === 0 ? '12s ago' : i % 3 === 1 ? '38s ago' : 'never',
      status: i % 3 === 2 ? 'offline' : i === 0 ? 'connected' : i === 1 ? 'connected' : 'idle',
      kind: p.kind,
      remoteSubnet: p.remoteSubnet,
      keepalive: p.keepalive,
    }));
  }
  try {
    const r = await exec('wg', ['show', 'wg0', 'dump'], { allowFailure: true });
    if (r.code !== 0) return rows.map(p => mapPlain(p));
    // First line is the interface; subsequent lines are peers.
    const peerLines = r.stdout.split('\n').slice(1).filter(Boolean);
    return rows.map(p => {
      const line = peerLines.find(l => l.startsWith(p.publicKey));
      if (!line) return mapPlain(p);
      const [pubkey, _psk, endpoint, _allowed, handshake, rx, tx] = line.split('\t');
      const hs = Number(handshake);
      const status: PeerStatus['status'] = hs === 0
        ? 'offline'
        : (Date.now() / 1000 - hs) < 180 ? 'connected' : 'idle';
      return {
        id: p.id,
        name: p.name,
        allowedIps: p.allowedIps,
        publicKey: pubkey ?? p.publicKey,
        endpoint: endpoint && endpoint !== '(none)' ? endpoint : '—',
        rxBytes: Number(rx) || 0,
        txBytes: Number(tx) || 0,
        handshake: humanAgo(hs),
        status,
        kind: p.kind,
        remoteSubnet: p.remoteSubnet,
        keepalive: p.keepalive,
      };
    });
  } catch {
    return rows.map(p => mapPlain(p));
  }
}

function mapPlain(p: { id: number; name: string; allowedIps: string; publicKey: string; kind: string; remoteSubnet: string | null; keepalive: number }): PeerStatus {
  return {
    id: p.id,
    name: p.name,
    allowedIps: p.allowedIps,
    publicKey: p.publicKey,
    endpoint: '—',
    rxBytes: 0,
    txBytes: 0,
    handshake: 'never',
    status: 'offline',
    kind: p.kind,
    remoteSubnet: p.remoteSubnet,
    keepalive: p.keepalive,
  };
}

export const fmt = { humanBytes, humanAgo };
