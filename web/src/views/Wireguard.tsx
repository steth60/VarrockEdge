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
  const [importOpen, setImportOpen] = useState(false);

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
          <Button variant="ghost" size="sm" icon="Upload" className="w-full mt-2" onClick={() => setImportOpen(true)}>
            Import existing .conf
          </Button>
          <p className="text-[11.5px] text-zinc-500 mt-3 leading-relaxed">
            Road-warrior peers get a single /32 + downloadable .conf. Import registers a peer from a client config you already have.
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
      {tab === 'settings' && <TunnelSettings server={server} onChanged={reload} />}

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

      <ImportPeerModal open={importOpen} onClose={() => setImportOpen(false)} onImported={reload} />
    </div>
  );
}

function ImportPeerModal({ open, onClose, onImported }: { open: boolean; onClose: () => void; onImported: () => void }) {
  const [name, setName] = useState('');
  const [config, setConfig] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[] | null>(null);

  const reset = () => { setName(''); setConfig(''); setBusy(false); setError(null); setWarnings(null); };
  const close = () => { reset(); onClose(); };

  const onFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setConfig(await file.text());
    if (!name) setName(file.name.replace(/\.conf$/i, ''));
    e.target.value = '';
  };

  const submit = async () => {
    if (!name.trim() || config.trim().length < 20) { setError('peer name and a .conf body are required'); return; }
    setBusy(true);
    setError(null);
    try {
      const r = await api.post<{ warnings: string[] }>('/api/wireguard/peers/import', { name: name.trim(), config });
      setWarnings(r.warnings ?? []);
      onImported();
    } catch (err: any) {
      setError(err?.message ?? 'import failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={close}
      title="Import WireGuard config"
      subtitle="Register a road-warrior peer from an existing client .conf"
      size="lg"
      footer={
        warnings !== null ? (
          <Button variant="primary" icon="Check" onClick={close}>Done</Button>
        ) : (
          <>
            <Button variant="ghost" onClick={close}>Cancel</Button>
            <Button variant="primary" icon="Upload" onClick={submit} disabled={busy || !name.trim() || config.trim().length < 20}>
              {busy ? 'Importing…' : 'Import peer'}
            </Button>
          </>
        )
      }>
      {warnings !== null ? (
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-emerald-300 text-[13px] font-medium">
            <Icon name="CheckCircle2" size={16} />
            Peer “{name}” imported and added to wg0.
          </div>
          {warnings.length > 0 ? (
            <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/30 space-y-1.5">
              <div className="text-[11px] uppercase tracking-[0.08em] text-amber-300 font-medium">Warnings</div>
              {warnings.map((w, i) => (
                <div key={i} className="text-[11.5px] text-amber-200/90 flex gap-1.5">
                  <Icon name="AlertTriangle" size={13} className="shrink-0 mt-0.5" />{w}
                </div>
              ))}
            </div>
          ) : (
            <p className="text-[11.5px] text-zinc-500">Server key and endpoint matched this appliance — no warnings.</p>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          <Field label="Peer name">
            <Input placeholder="proxmox-varrok-client-1" value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="Client .conf" hint="Paste the config, or upload a file. The [Interface] block becomes the peer.">
            <textarea
              spellCheck={false}
              value={config}
              onChange={(e) => setConfig(e.target.value)}
              placeholder={'[Interface]\nPrivateKey = …\nAddress = 10.10.0.5/32\n\n[Peer]\nPublicKey = …\nEndpoint = host:51820'}
              className="font-mono text-[11.5px] leading-relaxed min-h-[180px] px-3 py-2 rounded-lg bg-zinc-900/70 border border-zinc-700/70 text-zinc-100 placeholder:text-zinc-600 hover:border-zinc-600 focus:border-cyan-400/60 focus:bg-zinc-900 transition-colors resize-y"
            />
          </Field>
          <div className="flex items-center gap-3">
            <label className="inline-flex items-center gap-2 h-7 px-2.5 rounded-md text-[11.5px] font-medium text-zinc-300 bg-zinc-800/60 hover:bg-zinc-800 cursor-pointer transition-colors">
              <Icon name="FileUp" size={12} />
              Upload .conf
              <input type="file" accept=".conf,.txt,text/plain" className="hidden" onChange={onFile} />
            </label>
            <span className="text-[11px] text-zinc-500">
              The private key is derived to a public key locally — it routes the client through this tunnel.
            </span>
          </div>
          {error && (
            <div className="p-2.5 rounded-lg bg-rose-500/10 border border-rose-500/30 text-[11.5px] text-rose-300 flex gap-1.5">
              <Icon name="AlertCircle" size={13} className="shrink-0 mt-0.5" />{error}
            </div>
          )}
        </div>
      )}
    </Modal>
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
interface SitePeer extends Peer { remoteSubnet: string | null }

function SiteToSite() {
  const [sites, setSites] = useState<SitePeer[]>([]);
  const [localSubnets, setLocalSubnets] = useState<string>('—');
  const [addOpen, setAddOpen] = useState(false);
  const [draft, setDraft] = useState({ name: '', role: 'initiator' as 'initiator' | 'responder', remoteSubnet: '', remoteEndpoint: '', remotePublicKey: '', presharedKey: '', keepalive: 25 });

  const reload = () => api.get<{ sites: SitePeer[] }>('/api/wireguard/sites').then(r => setSites(r.sites)).catch(() => {});
  useEffect(() => { reload(); const t = setInterval(reload, 15_000); return () => clearInterval(t); }, []);
  // The "Local" subnets advertised across every site link = the real networks.
  useEffect(() => {
    api.get<{ networks: Array<{ subnet: string; enabled: boolean }> }>('/api/networks')
      .then(r => {
        const subs = r.networks.filter(n => n.enabled).map(n => n.subnet);
        setLocalSubnets(subs.length ? subs.join(', ') : '—');
      })
      .catch(() => {});
  }, []);

  const submit = async () => {
    if (!draft.name || !draft.remoteSubnet || !draft.remotePublicKey) {
      alert('name, remote subnet, and remote public key are required');
      return;
    }
    if (draft.role === 'initiator' && !draft.remoteEndpoint) {
      alert('initiator role requires the remote endpoint (host:port)');
      return;
    }
    try {
      await api.post('/api/wireguard/sites', {
        name: draft.name,
        remoteSubnet: draft.remoteSubnet,
        remoteEndpoint: draft.role === 'initiator' ? draft.remoteEndpoint : undefined,
        remotePublicKey: draft.remotePublicKey,
        presharedKey: draft.presharedKey || undefined,
        keepalive: Number(draft.keepalive) || 25,
      });
      setAddOpen(false);
      setDraft({ name: '', role: 'initiator', remoteSubnet: '', remoteEndpoint: '', remotePublicKey: '', presharedKey: '', keepalive: 25 });
      reload();
    } catch (err: any) { alert(err?.message ?? 'failed'); }
  };

  const teardown = async (id: number) => {
    if (!window.confirm('Teardown this site link? Routes will drop until peers re-handshake.')) return;
    try { await api.delete(`/api/wireguard/sites/${id}`); reload(); }
    catch (err: any) { alert(err?.message ?? 'failed'); }
  };

  return (
    <>
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-display text-[14px] font-semibold tracking-tight text-zinc-100">Site-to-site links</h3>
          <p className="text-[11.5px] text-zinc-500 mt-0.5">{sites.length} configured · subnet routing bidirectional</p>
        </div>
        <Button variant="primary" size="md" icon="Plus" onClick={() => setAddOpen(true)}>Add site link</Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {sites.map(s => {
          const role = s.endpoint && s.endpoint !== '—' ? 'Initiator' : 'Responder';
          const meta = PEER_STATUS_META[s.status];
          return (
            <div key={s.id} className="relative glass rounded-xl p-5 noise overflow-hidden group">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <Icon name="Network" size={14} className="text-cyan-300" />
                  <span className="font-display text-[13.5px] font-semibold text-zinc-100">{s.name}</span>
                </div>
                <Badge variant={meta.variant} size="sm">{meta.label}</Badge>
              </div>
              <div className="flex items-center gap-2 mb-4">
                <div className="flex-1 p-2.5 rounded-lg bg-zinc-900/60 border border-zinc-800/70">
                  <div className="text-[10px] uppercase tracking-[0.08em] text-zinc-500">Local</div>
                  <code className="font-mono text-[11.5px] text-zinc-100 block mt-0.5">{localSubnets}</code>
                </div>
                <div className="flex flex-col items-center gap-0.5">
                  <div className="relative w-12 h-px bg-gradient-to-r from-cyan-500/50 via-cyan-400 to-cyan-500/50">
                    <span className={`absolute top-1/2 -translate-y-1/2 left-1/2 -translate-x-1/2 w-1.5 h-1.5 rounded-full ${s.status === 'connected' ? 'bg-cyan-300 dot-pulse' : 'bg-zinc-600'}`} />
                  </div>
                  <code className="font-mono text-[9px] text-zinc-500">wg0</code>
                </div>
                <div className="flex-1 p-2.5 rounded-lg bg-zinc-900/60 border border-zinc-800/70">
                  <div className="text-[10px] uppercase tracking-[0.08em] text-zinc-500">Remote</div>
                  <code className="font-mono text-[11.5px] text-cyan-300 block mt-0.5">{s.remoteSubnet ?? '—'}</code>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-x-3 gap-y-2 text-[11.5px]">
                <div><div className="text-zinc-500 text-[10px] uppercase tracking-wider">Endpoint</div><code className="font-mono text-zinc-300 mt-0.5 block truncate">{s.endpoint || '—'}</code></div>
                <div><div className="text-zinc-500 text-[10px] uppercase tracking-wider">Role</div><span className="text-zinc-300 mt-0.5 block">{role}</span></div>
                <div><div className="text-zinc-500 text-[10px] uppercase tracking-wider">Handshake</div><code className="font-mono text-zinc-300 mt-0.5 block">{s.handshake}</code></div>
                <div><div className="text-zinc-500 text-[10px] uppercase tracking-wider">Transfer</div><code className="font-mono mt-0.5 block"><span className="text-emerald-300">↓{humanBytes(s.rxBytes)}</span><span className="text-zinc-600 mx-1">·</span><span className="text-cyan-300">↑{humanBytes(s.txBytes)}</span></code></div>
              </div>
              <div className="divider mt-4 pt-3 flex items-center justify-between">
                <div className="flex items-center gap-2 text-[11px] text-zinc-500">
                  <span>keepalive {s.keepalive}s</span>
                </div>
                <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                  <Button variant="ghost" size="sm" icon="Download" onClick={() => { window.location.href = `/api/wireguard/sites/${s.id}/remote-config`; }}>Remote .conf</Button>
                  <Button variant="danger" size="sm" icon="Trash2" onClick={() => teardown(s.id)}>Teardown</Button>
                </div>
              </div>
            </div>
          );
        })}
        {sites.length === 0 && (
          <div className="text-[12px] text-zinc-500 col-span-full p-6 rounded-xl border border-dashed border-zinc-800/70">
            No site links yet. Click "Add site link" to dial another VarrokEdge / WireGuard host.
          </div>
        )}
      </div>

      <Card title="Routing Table" subtitle="Routes installed by wg-quick for each site link">
        <table className="w-full text-[12.5px]">
          <thead><tr className="text-left text-[10.5px] uppercase tracking-[0.08em] text-zinc-500 border-b border-zinc-800/70">
            <th className="font-medium py-2.5">Destination</th>
            <th className="font-medium py-2.5">Interface</th>
            <th className="font-medium py-2.5">Source</th>
            <th className="font-medium py-2.5">Status</th>
          </tr></thead>
          <tbody className="divide-y divide-zinc-800/60">
            {sites.map(s => (
              <tr key={s.id} className="hover:bg-zinc-900/30">
                <td className="py-3 font-mono text-cyan-300">{s.remoteSubnet ?? '—'}</td>
                <td className="py-3 font-mono text-zinc-300">wg0</td>
                <td className="py-3 text-zinc-400">{s.name}</td>
                <td className="py-3"><Badge variant={PEER_STATUS_META[s.status].variant} size="sm">{PEER_STATUS_META[s.status].label}</Badge></td>
              </tr>
            ))}
            {sites.length === 0 && <tr><td colSpan={4} className="py-6 text-center text-[12px] text-zinc-600">no routes</td></tr>}
          </tbody>
        </table>
      </Card>

      <Modal open={addOpen} onClose={() => setAddOpen(false)} size="lg"
             title="Configure site-to-site link"
             subtitle="Establish a routed WireGuard tunnel to another network"
             footer={
               <>
                 <Button variant="ghost" onClick={() => setAddOpen(false)}>Cancel</Button>
                 <Button variant="primary" icon="Check" onClick={submit}>Save link</Button>
               </>
             }>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          <div className="space-y-3">
            <Field label="Site name">
              <Input placeholder="London — Site B" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
            </Field>
            <Field label="Role">
              <div className="inline-flex rounded-lg bg-zinc-900/60 border border-zinc-800/60 p-1 w-full">
                {(['initiator', 'responder'] as const).map(r => (
                  <button key={r} type="button" onClick={() => setDraft({ ...draft, role: r })}
                          className={`flex-1 px-3 h-8 text-[12px] rounded-md font-medium transition-colors ${draft.role === r ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-500 hover:text-zinc-200'}`}>
                    {r === 'initiator' ? 'Initiator (we dial out)' : 'Responder (they dial us)'}
                  </button>
                ))}
              </div>
            </Field>
            {draft.role === 'initiator' && (
              <Field label="Remote endpoint" hint="host:port the remote WireGuard listens on">
                <Input mono placeholder="203.0.113.42:51820" value={draft.remoteEndpoint} onChange={(e) => setDraft({ ...draft, remoteEndpoint: e.target.value })} />
              </Field>
            )}
            <Field label="Remote subnet (AllowedIPs)" hint="what lives behind their tunnel">
              <Input mono placeholder="10.20.0.0/24" value={draft.remoteSubnet} onChange={(e) => setDraft({ ...draft, remoteSubnet: e.target.value })} />
            </Field>
            <Field label="Persistent keepalive" hint="seconds; needed when one side is behind NAT">
              <Input mono value={String(draft.keepalive)} onChange={(e) => setDraft({ ...draft, keepalive: Number(e.target.value) || 25 })} />
            </Field>
          </div>
          <div className="space-y-3">
            <Field label="Remote public key" hint="`wg pubkey < privatekey` on their side">
              <Input mono placeholder="paste their wg pubkey…" value={draft.remotePublicKey} onChange={(e) => setDraft({ ...draft, remotePublicKey: e.target.value })} />
            </Field>
            <Field label="Preshared key" hint="optional but recommended">
              <div className="flex gap-2">
                <Input mono className="flex-1" placeholder="32-byte base64 PSK (auto-generated if empty)" value={draft.presharedKey} onChange={(e) => setDraft({ ...draft, presharedKey: e.target.value })} />
              </div>
            </Field>
            <div className="p-3 rounded-lg bg-zinc-950/60 border border-zinc-800/60 mt-2">
              <div className="text-[10.5px] uppercase tracking-[0.08em] text-zinc-500 mb-1">// preview · wg0.conf [Peer]</div>
              <code className="font-mono text-[11px] text-cyan-300 block whitespace-pre">{`PublicKey = ${draft.remotePublicKey || '<remote_pubkey>'}
${draft.presharedKey ? `PresharedKey = ${draft.presharedKey}` : 'PresharedKey = <auto>'}
${draft.role === 'initiator' ? `Endpoint = ${draft.remoteEndpoint || '<remote>'}` : '# (responder — no Endpoint set on our side)'}
AllowedIPs = ${draft.remoteSubnet || '<remote_subnet>'}
PersistentKeepalive = ${draft.keepalive}`}</code>
            </div>
            <p className="text-[11px] text-zinc-500 leading-relaxed">
              After saving, click <strong>Remote .conf</strong> on the site card to download the corresponding <code className="font-mono">[Peer]</code> block to paste on their side.
            </p>
          </div>
        </div>
      </Modal>
    </>
  );
}

// ─── Tunnel Settings ─────────────────────────────────────────────
function TunnelSettings({ server, onChanged }: { server: Server | null; onChanged: () => void }) {
  const [draft, setDraft] = useState({
    publicEndpoint: server?.publicEndpoint ?? '',
    listenPort: server?.listenPort ?? 51820,
    mtu: server?.mtu ?? 1420,
    tunnelCidr: server?.tunnelCidr ?? '10.10.0.0/24',
    dnsPush: server?.dnsPush ?? '10.0.0.1,1.1.1.1',
    defaultAllowedIps: server?.defaultAllowedIps ?? '10.0.0.0/24',
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (server) {
      setDraft({
        publicEndpoint: server.publicEndpoint ?? '',
        listenPort: server.listenPort,
        mtu: server.mtu,
        tunnelCidr: server.tunnelCidr,
        dnsPush: server.dnsPush,
        defaultAllowedIps: server.defaultAllowedIps,
      });
    }
  }, [server]);

  const dirty =
    server &&
    ((draft.publicEndpoint || '') !== (server.publicEndpoint ?? '') ||
      draft.listenPort !== server.listenPort ||
      draft.mtu !== server.mtu ||
      draft.tunnelCidr !== server.tunnelCidr ||
      draft.dnsPush !== server.dnsPush ||
      draft.defaultAllowedIps !== server.defaultAllowedIps);

  const save = async () => {
    setSaving(true);
    try {
      await api.patch('/api/wireguard/server', {
        publicEndpoint: draft.publicEndpoint || null,
        listenPort: Number(draft.listenPort) || 51820,
        mtu: Number(draft.mtu) || 1420,
        tunnelCidr: draft.tunnelCidr,
        dnsPush: draft.dnsPush,
        defaultAllowedIps: draft.defaultAllowedIps,
      });
      onChanged();
    } catch (err: any) {
      alert(err?.message ?? 'save failed');
    } finally {
      setSaving(false);
    }
  };

  const restart = async () => {
    if (!window.confirm('Restart wg-quick@wg0? All peers will reconnect.')) return;
    try { await api.post('/api/wireguard/restart'); onChanged(); }
    catch (err: any) { alert(err?.message ?? 'failed'); }
  };

  const rotate = async () => {
    if (!window.confirm('Rotate server keypair? Every issued .conf will need to be re-downloaded by peers.')) return;
    try {
      const r = await api.post<{ publicKey: string }>('/api/wireguard/server/rotate');
      alert(`New public key:\n${r.publicKey}\n\nDistribute to peers.`);
      onChanged();
    } catch (err: any) { alert(err?.message ?? 'failed'); }
  };

  const wipe = async () => {
    if (!window.confirm('Wipe wg0 entirely — all peers, server key, and config? This cannot be undone.')) return;
    if (!window.confirm('Really wipe everything?')) return;
    try { await api.delete('/api/wireguard/server'); onChanged(); }
    catch (err: any) { alert(err?.message ?? 'failed'); }
  };

  return (
    <div className="space-y-6">
      <Card title="Interface · wg0" subtitle="Server identity, binding, and what peers reach you at">
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
        <SettingRow label="Public endpoint" hint="The host or IP peers dial. Port comes from Listen port below. Required before issued .conf files connect.">
          <Input mono className="max-w-sm" placeholder="51.38.114.207" value={draft.publicEndpoint} onChange={(e) => setDraft({ ...draft, publicEndpoint: e.target.value })} />
        </SettingRow>
        <SettingRow label="Listen port">
          <Input mono className="max-w-sm" value={String(draft.listenPort)} onChange={(e) => setDraft({ ...draft, listenPort: Number(e.target.value) || 51820 })} />
        </SettingRow>
        <SettingRow label="MTU">
          <Input mono className="max-w-sm" value={String(draft.mtu)} onChange={(e) => setDraft({ ...draft, mtu: Number(e.target.value) || 1420 })} />
        </SettingRow>
        <SettingRow label="Tunnel CIDR" hint="Address pool peers are assigned from.">
          <Input mono className="max-w-sm" value={draft.tunnelCidr} onChange={(e) => setDraft({ ...draft, tunnelCidr: e.target.value })} />
        </SettingRow>
      </Card>

      <Card title="Routing & DNS" subtitle="What peers see when connected">
        <SettingRow label="Push DNS" hint="Resolver(s) peers use over the tunnel. Comma-separated.">
          <Input mono className="max-w-sm" value={draft.dnsPush} onChange={(e) => setDraft({ ...draft, dnsPush: e.target.value })} />
        </SettingRow>
        <SettingRow label="Default AllowedIPs" hint="What the road-warrior .conf will route through this tunnel. 0.0.0.0/0 = full tunnel.">
          <Input mono className="max-w-sm" value={draft.defaultAllowedIps} onChange={(e) => setDraft({ ...draft, defaultAllowedIps: e.target.value })} />
        </SettingRow>
      </Card>

      <div className="flex items-center justify-end gap-2">
        <Button variant="ghost" onClick={() => server && setDraft({
          publicEndpoint: server.publicEndpoint ?? '',
          listenPort: server.listenPort,
          mtu: server.mtu,
          tunnelCidr: server.tunnelCidr,
          dnsPush: server.dnsPush,
          defaultAllowedIps: server.defaultAllowedIps,
        })} disabled={!dirty || saving}>Discard</Button>
        <Button variant="primary" icon="Save" onClick={save} disabled={!dirty || saving}>{saving ? 'Saving…' : 'Save changes'}</Button>
      </div>

      <Card title="Danger zone" subtitle="Destructive operations">
        <div className="divide-y divide-zinc-800/60">
          <div className="flex items-center justify-between py-3 pt-0">
            <div>
              <div className="text-[12.5px] font-medium text-zinc-100">Restart tunnel</div>
              <div className="text-[11.5px] text-zinc-500 mt-0.5">All peers will reconnect within ~2s.</div>
            </div>
            <Button variant="secondary" size="sm" icon="Power" onClick={restart}>Restart</Button>
          </div>
          <div className="flex items-center justify-between py-3">
            <div>
              <div className="text-[12.5px] font-medium text-amber-300">Rotate server keypair</div>
              <div className="text-[11.5px] text-zinc-500 mt-0.5">Generates a new wg key. Every existing peer must re-download their .conf or it will stop connecting.</div>
            </div>
            <Button variant="danger" size="sm" icon="RefreshCw" onClick={rotate}>Rotate keys</Button>
          </div>
          <div className="flex items-center justify-between py-3 pb-0">
            <div>
              <div className="text-[12.5px] font-medium text-rose-300">Wipe configuration</div>
              <div className="text-[11.5px] text-zinc-500 mt-0.5">Deletes wg0, all peers, and all site links. Cannot be undone.</div>
            </div>
            <Button variant="danger" size="sm" icon="Trash2" onClick={wipe}>Wipe wg0</Button>
          </div>
        </div>
      </Card>
    </div>
  );
}
