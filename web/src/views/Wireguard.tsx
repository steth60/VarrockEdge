import { useEffect, useState } from 'react';
import { Card, Button, IconButton, Field, Input, Badge, Modal, StatusPill, SettingRow, ToggleSwitch, Select, Icon } from '../components/primitives';
import { QRCode } from '../components/QRCode';
import { api } from '../api/client';

interface Server { publicKey: string; listenPort: number; tunnelCidr: string; mtu: number; publicEndpoint: string | null; dnsPush: string; defaultAllowedIps: string }
interface Peer { id: number; name: string; publicKey: string; allowedIps: string; endpoint: string; rxBytes: number; txBytes: number; handshake: string; status: 'connected'|'idle'|'offline'; kind: string; remoteSubnet: string | null; keepalive: number }

const PEER_STATUS_META = {
  connected: { variant: 'success', label: 'Connected' },
  idle:      { variant: 'warn',    label: 'Idle' },
  offline:   { variant: 'danger',  label: 'Offline' },
} as const;

export function Wireguard() {
  const [tab, setTab] = useState<'peers' | 's2s' | 'settings'>('peers');
  const [server, setServer] = useState<Server | null>(null);
  const [peers, setPeers] = useState<Peer[]>([]);
  const [addOpen, setAddOpen] = useState(false);
  const [newPeerId, setNewPeerId] = useState<number | null>(null);
  const [newPeerName, setNewPeerName] = useState('');

  const reload = () => {
    api.get<{ server: Server }>('/api/wireguard/server').then(r => setServer(r.server)).catch(() => {});
    api.get<{ peers: Peer[] }>('/api/wireguard/peers').then(r => setPeers(r.peers)).catch(() => {});
  };

  useEffect(reload, []);

  const generate = async () => {
    if (!newPeerName) return;
    try {
      const r = await api.post<{ peer: Peer }>('/api/wireguard/peers', { name: newPeerName });
      setNewPeerId(r.peer.id);
      reload();
    } catch (err: any) { alert(err?.message ?? 'failed'); }
  };

  const closeAdd = () => {
    setAddOpen(false);
    setNewPeerName('');
    setNewPeerId(null);
  };

  const roadWarriors = peers.filter(p => p.kind !== 'site');

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card title="Tunnel: wg0" subtitle="Server endpoint" className="lg:col-span-2">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-5">
            <div>
              <div className="text-[10.5px] uppercase tracking-[0.08em] text-zinc-500">Public Endpoint</div>
              <div className="font-mono text-[14px] text-cyan-300 mt-1">{server?.publicEndpoint ?? '—'}</div>
            </div>
            <div>
              <div className="text-[10.5px] uppercase tracking-[0.08em] text-zinc-500">Listen Port</div>
              <div className="font-mono text-[14px] text-zinc-100 mt-1">{server?.listenPort ?? 51820} / UDP</div>
            </div>
            <div>
              <div className="text-[10.5px] uppercase tracking-[0.08em] text-zinc-500">Tunnel Subnet</div>
              <div className="font-mono text-[14px] text-zinc-100 mt-1">{server?.tunnelCidr ?? '10.10.0.0/24'}</div>
            </div>
            <div>
              <div className="text-[10.5px] uppercase tracking-[0.08em] text-zinc-500">MTU</div>
              <div className="font-mono text-[14px] text-zinc-100 mt-1">{server?.mtu ?? 1420}</div>
            </div>
          </div>
          <div className="divider mt-5 pt-4 flex items-center gap-3 flex-wrap">
            <StatusPill status="running" label="wg-quick@wg0 active" />
            <span className="text-zinc-700">·</span>
            <span className="text-[12px] text-zinc-400 font-mono">
              {peers.filter(p => p.status === 'connected').length} of {peers.length} peers connected
            </span>
            <div className="ml-auto flex gap-2">
              <Button variant="ghost" size="sm" icon="Power">Restart</Button>
              <Button variant="secondary" size="sm" icon="FileText">View wg0.conf</Button>
            </div>
          </div>
        </Card>

        <Card title="Quick add" subtitle="Provision endpoint" className="lg:col-span-1">
          <div className="grid grid-cols-2 gap-2">
            <Button variant="primary" size="md" icon="UserPlus" onClick={() => setAddOpen(true)}>Road-warrior</Button>
            <Button variant="secondary" size="md" icon="Network" onClick={() => setTab('s2s')}>Site-to-site</Button>
          </div>
          <p className="text-[11.5px] text-zinc-500 mt-3 leading-relaxed">
            Road-warrior peers get a single /32 + downloadable .conf. Site-to-site links span entire subnets bidirectionally.
          </p>
        </Card>
      </div>

      <div className="flex items-center gap-1 p-1 rounded-lg bg-zinc-900/40 border border-zinc-800/60 w-fit">
        {[
          { id: 'peers',    label: 'Road-warrior peers', icon: 'Smartphone' },
          { id: 's2s',      label: 'Site-to-site',       icon: 'Network' },
          { id: 'settings', label: 'Tunnel settings',    icon: 'Settings' },
        ].map(t => (
          <button key={t.id} onClick={() => setTab(t.id as any)}
                  className={`inline-flex items-center gap-2 h-8 px-3 rounded-md text-[12px] font-medium transition-colors ${tab === t.id ? 'bg-zinc-800/80 text-zinc-100' : 'text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800/40'}`}>
            <Icon name={t.icon} size={13} />{t.label}
          </button>
        ))}
      </div>

      {tab === 'peers' && (
        <Card title="Peers" subtitle={`${roadWarriors.length} configured`}>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            {roadWarriors.map(p => <PeerCard key={p.id} peer={p} onRemove={() => api.delete(`/api/wireguard/peers/${p.id}`).then(reload)} />)}
            {roadWarriors.length === 0 && <div className="text-[12px] text-zinc-500 col-span-full">No peers yet. Click "Road-warrior" to provision one.</div>}
          </div>
        </Card>
      )}

      {tab === 's2s' && <SiteToSite />}
      {tab === 'settings' && <TunnelSettings server={server} />}

      <Modal
        open={addOpen}
        onClose={closeAdd}
        title="Generate WireGuard peer"
        subtitle="Provision a new tunnel endpoint"
        size="lg"
        footer={
          <>
            <Button variant="ghost" onClick={closeAdd}>Cancel</Button>
            <Button variant="secondary" icon="Download" onClick={generate} disabled={!newPeerName}>
              {newPeerId ? 'Regenerate' : 'Generate'}
            </Button>
            <Button variant="primary" icon="Check" onClick={closeAdd} disabled={!newPeerId}>Done</Button>
          </>
        }>
        <div className="grid grid-cols-1 md:grid-cols-5 gap-5">
          <div className="md:col-span-3 space-y-4">
            <Field label="Peer name">
              <Input placeholder="callum-iphone" value={newPeerName} onChange={(e) => setNewPeerName(e.target.value)} />
            </Field>
            <Field label="Allowed IPs">
              <Input mono value={newPeerId ? (peers.find(p => p.id === newPeerId)?.allowedIps ?? '') : ''} placeholder="auto-assigned" readOnly />
            </Field>
            <Field label="Public key">
              <Input mono value={newPeerId ? (peers.find(p => p.id === newPeerId)?.publicKey ?? '') : ''} placeholder="— generate first —" readOnly />
            </Field>
            <div className="pt-1">
              <Button variant="secondary" size="sm" icon="FileDown" disabled={!newPeerId}
                onClick={() => newPeerId && (window.location.href = `/api/wireguard/peers/${newPeerId}/conf`)}>
                Download {newPeerName || 'peer'}.conf
              </Button>
            </div>
          </div>
          <div className="md:col-span-2">
            <div className="text-[11px] uppercase tracking-[0.08em] text-zinc-500 mb-2">Scan with WireGuard app</div>
            <QRCode peerId={newPeerId} size={260} />
            <p className="text-[11px] text-zinc-500 mt-3 text-center">QR encodes the full <code className="font-mono">.conf</code></p>
          </div>
        </div>
      </Modal>
    </div>
  );
}

function humanBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  const u = ['KB', 'MB', 'GB', 'TB'];
  let v = n / 1024; let i = 0;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(1)} ${u[i]}`;
}

function PeerCard({ peer, onRemove }: { peer: Peer; onRemove: () => void }) {
  const meta = PEER_STATUS_META[peer.status];
  return (
    <div className="relative glass rounded-lg p-4 hover:border-zinc-700 transition-colors group">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="flex items-center gap-2">
            <span className={`w-2 h-2 rounded-full ${peer.status === 'connected' ? 'bg-emerald-400 dot-pulse' : peer.status === 'idle' ? 'bg-amber-400' : 'bg-zinc-600'}`} />
            <h4 className="font-display font-medium text-[13.5px] text-zinc-100">{peer.name}</h4>
          </div>
          <code className="font-mono text-[11px] text-zinc-500 block mt-1">{peer.allowedIps}</code>
        </div>
        <Badge variant={meta.variant} size="sm">{meta.label}</Badge>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-3 text-[11.5px]">
        <div>
          <div className="text-zinc-500 text-[10.5px] uppercase tracking-wider">Endpoint</div>
          <code className="font-mono text-zinc-300 mt-0.5 block truncate">{peer.endpoint}</code>
        </div>
        <div>
          <div className="text-zinc-500 text-[10.5px] uppercase tracking-wider">Handshake</div>
          <code className="font-mono text-zinc-300 mt-0.5 block">{peer.handshake}</code>
        </div>
        <div>
          <div className="text-zinc-500 text-[10.5px] uppercase tracking-wider">↓ RX</div>
          <code className="font-mono text-emerald-300 mt-0.5 block">{humanBytes(peer.rxBytes)}</code>
        </div>
        <div>
          <div className="text-zinc-500 text-[10.5px] uppercase tracking-wider">↑ TX</div>
          <code className="font-mono text-cyan-300 mt-0.5 block">{humanBytes(peer.txBytes)}</code>
        </div>
      </div>
      <div className="mt-4 flex justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
        <IconButton name="QrCode" label="QR code" size="sm" onClick={() => window.open(`/api/wireguard/peers/${peer.id}/qr`, '_blank')} />
        <IconButton name="Download" label="Download .conf" size="sm" onClick={() => { window.location.href = `/api/wireguard/peers/${peer.id}/conf`; }} />
        <IconButton name="Trash2" label="Revoke" size="sm" variant="danger" onClick={onRemove} />
      </div>
    </div>
  );
}

// ─── Site-to-site ────────────────────────────────────────────────
function SiteToSite() {
  // Pure UI for v1 — data plane lands when the s2s API is wired (TODO marker).
  const sites = [
    { id: 'site-london-b', name: 'London — Site B',     role: 'Initiator', endpoint: '178.62.10.7:51820',  localSubnet: '10.0.0.0/24', remoteSubnet: '10.20.0.0/24', transit: '10.10.0.0/30', status: 'connected', handshake: '6s ago',  rx: '12.1 GB', tx: '8.4 GB', keepalive: 25, psk: true  },
    { id: 'site-paris-dc', name: 'Paris — Datacentre',  role: 'Responder', endpoint: '141.94.218.44:51820', localSubnet: '10.0.0.0/24', remoteSubnet: '10.30.0.0/24', transit: '10.10.0.4/30', status: 'connected', handshake: '14s ago', rx: '4.2 GB',  tx: '6.1 GB', keepalive: 25, psk: true  },
    { id: 'site-berlin',   name: 'Berlin — Edge POP',   role: 'Initiator', endpoint: '95.217.42.18:51820',  localSubnet: '10.0.0.0/24', remoteSubnet: '10.40.0.0/24', transit: '10.10.0.8/30', status: 'degraded',  handshake: '4m ago',  rx: '880 MB', tx: '410 MB', keepalive: 25, psk: false },
  ];
  return (
    <>
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-display text-[14px] font-semibold tracking-tight text-zinc-100">Site-to-site links</h3>
          <p className="text-[11.5px] text-zinc-500 mt-0.5">{sites.length} configured · subnet routing bidirectional</p>
        </div>
        <Button variant="primary" size="md" icon="Plus">Add site link</Button>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {sites.map(s => (
          <div key={s.id} className="relative glass rounded-xl p-5 noise overflow-hidden">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <Icon name="Network" size={14} className="text-cyan-300" />
                <span className="font-display text-[13.5px] font-semibold text-zinc-100">{s.name}</span>
              </div>
              <Badge variant={s.status === 'connected' ? 'success' : 'warn'} size="sm">{s.status === 'connected' ? 'Up' : 'Degraded'}</Badge>
            </div>
            <div className="flex items-center gap-2 mb-4">
              <div className="flex-1 p-2.5 rounded-lg bg-zinc-900/60 border border-zinc-800/70">
                <div className="text-[10px] uppercase tracking-[0.08em] text-zinc-500">Local</div>
                <code className="font-mono text-[11.5px] text-zinc-100 block mt-0.5">{s.localSubnet}</code>
              </div>
              <div className="flex flex-col items-center gap-0.5">
                <div className="relative w-12 h-px bg-gradient-to-r from-cyan-500/50 via-cyan-400 to-cyan-500/50">
                  <span className="absolute top-1/2 -translate-y-1/2 left-1/2 -translate-x-1/2 w-1.5 h-1.5 rounded-full bg-cyan-300 dot-pulse" />
                </div>
                <code className="font-mono text-[9px] text-zinc-500">wg0</code>
              </div>
              <div className="flex-1 p-2.5 rounded-lg bg-zinc-900/60 border border-zinc-800/70">
                <div className="text-[10px] uppercase tracking-[0.08em] text-zinc-500">Remote</div>
                <code className="font-mono text-[11.5px] text-cyan-300 block mt-0.5">{s.remoteSubnet}</code>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-x-3 gap-y-2 text-[11.5px]">
              <div><div className="text-zinc-500 text-[10px] uppercase tracking-wider">Endpoint</div><code className="font-mono text-zinc-300 mt-0.5 block truncate">{s.endpoint}</code></div>
              <div><div className="text-zinc-500 text-[10px] uppercase tracking-wider">Role</div><span className="text-zinc-300 mt-0.5 block">{s.role}</span></div>
              <div><div className="text-zinc-500 text-[10px] uppercase tracking-wider">Handshake</div><code className="font-mono text-zinc-300 mt-0.5 block">{s.handshake}</code></div>
              <div><div className="text-zinc-500 text-[10px] uppercase tracking-wider">Transfer</div><code className="font-mono mt-0.5 block"><span className="text-emerald-300">↓{s.rx}</span><span className="text-zinc-600 mx-1">·</span><span className="text-cyan-300">↑{s.tx}</span></code></div>
            </div>
            <div className="divider mt-4 pt-3 flex items-center justify-between">
              <div className="flex items-center gap-2 text-[11px] text-zinc-500">
                {s.psk && <Badge variant="info" size="sm" icon="Lock">PSK</Badge>}
                <span>keepalive {s.keepalive}s</span>
              </div>
              <Button variant="ghost" size="sm" iconRight="ArrowRight">Inspect</Button>
            </div>
          </div>
        ))}
      </div>
      <Card title="Routing Table" subtitle="Static routes installed by wg-quick">
        <table className="w-full text-[12.5px]">
          <thead><tr className="text-left text-[10.5px] uppercase tracking-[0.08em] text-zinc-500 border-b border-zinc-800/70">
            <th className="font-medium py-2.5">Destination</th><th className="font-medium py-2.5">Via</th>
            <th className="font-medium py-2.5">Interface</th><th className="font-medium py-2.5">Metric</th>
            <th className="font-medium py-2.5">Source</th>
          </tr></thead>
          <tbody className="divide-y divide-zinc-800/60">
            {sites.map(s => (
              <tr key={s.id} className="hover:bg-zinc-900/30">
                <td className="py-3 font-mono text-cyan-300">{s.remoteSubnet}</td>
                <td className="py-3 font-mono text-zinc-300">{s.transit.split('/')[0]}</td>
                <td className="py-3 font-mono text-zinc-300">wg0</td>
                <td className="py-3 font-mono text-zinc-500">100</td>
                <td className="py-3 text-zinc-400">{s.name}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </>
  );
}

// ─── Tunnel Settings ─────────────────────────────────────────────
function TunnelSettings({ server }: { server: Server | null }) {
  return (
    <div className="space-y-6">
      <Card title="Interface · wg0" subtitle="Server identity and binding">
        <SettingRow label="Public key" hint="Distribute this to remote peers.">
          <div className="flex gap-2 max-w-2xl">
            <Input mono readOnly className="flex-1" value={server?.publicKey ?? ''} />
            <IconButton name="Copy" label="Copy" size="md" variant="secondary"
              onClick={() => server?.publicKey && navigator.clipboard.writeText(server.publicKey)} />
          </div>
        </SettingRow>
        <SettingRow label="Private key" hint="Held in /etc/wireguard/wg0.conf — never displayed.">
          <code className="font-mono text-[12px] text-zinc-500">●●●●●●●●●●●●●●●●●●●●●●●●●●●●</code>
        </SettingRow>
        <SettingRow label="Listen port"><Input mono className="max-w-sm" defaultValue={String(server?.listenPort ?? 51820)} /></SettingRow>
        <SettingRow label="Bind address" hint="Restrict listener to a specific WAN.">
          <Select className="max-w-sm" defaultValue="eth0">
            <option value="all">All interfaces</option>
            <option value="eth0">eth0</option>
          </Select>
        </SettingRow>
        <SettingRow label="MTU"><Input mono className="max-w-sm" defaultValue={String(server?.mtu ?? 1420)} /></SettingRow>
        <SettingRow label="Tunnel CIDR"><Input mono className="max-w-sm" defaultValue={server?.tunnelCidr ?? '10.10.0.0/24'} /></SettingRow>
      </Card>

      <Card title="Cryptography" subtitle="Tunnel security parameters">
        <SettingRow label="Require preshared keys" hint="Enforce PSK on all peers — adds post-quantum resistance.">
          <ToggleSwitch value={true} onChange={() => {}} />
        </SettingRow>
        <SettingRow label="Rekey timeout">
          <Select className="max-w-sm" defaultValue="120">
            <option value="60">60s</option><option value="120">120s (default)</option><option value="180">180s</option>
          </Select>
        </SettingRow>
        <SettingRow label="Rotate server key" hint="Generates a new keypair. All peers must update their config.">
          <Button variant="danger" size="sm" icon="RefreshCw">Rotate keys</Button>
        </SettingRow>
      </Card>

      <Card title="Routing & DNS" subtitle="What peers see when connected">
        <SettingRow label="Push DNS"><Input mono className="max-w-sm" defaultValue={server?.dnsPush ?? '10.0.0.1, 1.1.1.1'} /></SettingRow>
        <SettingRow label="Push search domain"><Input mono className="max-w-sm" defaultValue="varrok.local" /></SettingRow>
        <SettingRow label="Default AllowedIPs (road-warrior)" hint="0.0.0.0/0 = full-tunnel.">
          <Select className="max-w-sm" defaultValue="split">
            <option value="full">0.0.0.0/0 (full tunnel)</option>
            <option value="split">10.0.0.0/24 (split tunnel)</option>
            <option value="custom">Custom…</option>
          </Select>
        </SettingRow>
        <SettingRow label="IPv6 support" hint="Adds an ULA range to the tunnel.">
          <ToggleSwitch value={false} onChange={() => {}} />
        </SettingRow>
      </Card>

      <Card title="Danger zone" subtitle="Destructive operations">
        <div className="divide-y divide-zinc-800/60">
          <div className="flex items-center justify-between py-3 pt-0">
            <div>
              <div className="text-[12.5px] font-medium text-zinc-100">Restart tunnel</div>
              <div className="text-[11.5px] text-zinc-500 mt-0.5">All peers will reconnect within ~2s.</div>
            </div>
            <Button variant="secondary" size="sm" icon="Power">Restart</Button>
          </div>
          <div className="flex items-center justify-between py-3 pb-0">
            <div>
              <div className="text-[12.5px] font-medium text-rose-300">Wipe configuration</div>
              <div className="text-[11.5px] text-zinc-500 mt-0.5">Deletes wg0, all peers, and all site links. Cannot be undone.</div>
            </div>
            <Button variant="danger" size="sm" icon="Trash2">Wipe wg0</Button>
          </div>
        </div>
      </Card>
    </div>
  );
}
