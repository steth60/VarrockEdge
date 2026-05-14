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
  const keys = input.providedPublicKey
    ? { privateKey: null as string | null, publicKey: input.providedPublicKey, presharedKey: input.providedPresharedKey ?? '' }
    : { ...(await genKeys()), privateKey: null as string | null };
  if (!input.providedPublicKey) {
    const full = await genKeys();
    keys.privateKey = full.privateKey;
    keys.publicKey = full.publicKey;
    keys.presharedKey = full.presharedKey;
  }
  const allowed = input.allowedIps ?? `${nextTunnelIp(server.tunnelCidr)}/32`;
  const row = db.insert(wgPeers).values({
    name: input.name,
    publicKey: keys.publicKey,
    privateKey: keys.privateKey,
    presharedKey: keys.presharedKey || null,
    allowedIps: allowed,
    keepalive: input.keepalive ?? 25,
    kind: input.kind ?? 'road-warrior',
    remoteSubnet: input.remoteSubnet ?? null,
    remoteEndpoint: input.remoteEndpoint ?? null,
  }).returning().get();
  await writeServerConfig();
  await reload();
  return row;
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
