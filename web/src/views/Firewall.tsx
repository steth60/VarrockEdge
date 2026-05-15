import { useEffect, useState, type FormEvent } from 'react';
import { Card, Button, IconButton, Field, Input, Select, Badge, Icon } from '../components/primitives';
import { api } from '../api/client';

interface Dnat { id: number; srcPort: number; proto: string; destIp: string; destPort: number; comment: string | null; hits?: number }
interface Snat { id: number; source: string; outIface: string; mode: 'MASQUERADE' | 'SNAT'; toSource: string | null; comment: string | null; isCore: boolean }
interface Rule { id: number; chain: string; action: string; proto: string; source: string | null; dport: string | null; comment: string | null }

export function Firewall() {
  const [tab, setTab] = useState<'nat' | 'snat' | 'fw' | 'upnp'>('nat');
  const [forwards, setForwards] = useState<Dnat[]>([]);
  const [snatRules, setSnatRules] = useState<Snat[]>([]);
  const [fwRules, setFwRules] = useState<Rule[]>([]);

  const reload = () => {
    api.get<{ forwards: Dnat[] }>('/api/firewall/dnat').then(r => setForwards(r.forwards)).catch(() => {});
    api.get<{ rules: Snat[] }>('/api/firewall/snat').then(r => setSnatRules(r.rules)).catch(() => {});
    api.get<{ rules: Rule[] }>('/api/firewall/rules').then(r => setFwRules(r.rules)).catch(() => {});
  };
  useEffect(reload, []);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-1 p-1 rounded-lg bg-zinc-900/40 border border-zinc-800/60 w-fit">
        {[
          { id: 'nat',  label: 'Port Forwarding (DNAT)', icon: 'ArrowRightLeft' },
          { id: 'snat', label: 'Source NAT',             icon: 'Shuffle' },
          { id: 'fw',   label: 'Firewall Rules',         icon: 'Shield' },
          { id: 'upnp', label: 'UPnP / NAT-PMP',         icon: 'Router' },
        ].map(t => (
          <button key={t.id} onClick={() => setTab(t.id as any)}
                  className={`inline-flex items-center gap-2 h-8 px-3 rounded-md text-[12px] font-medium transition-colors ${tab === t.id ? 'bg-zinc-800/80 text-zinc-100' : 'text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800/40'}`}>
            <Icon name={t.icon} size={13} />{t.label}
          </button>
        ))}
      </div>

      {tab === 'nat' && <DnatPanel forwards={forwards} reload={reload} />}
      {tab === 'snat' && <SnatPanel rules={snatRules} reload={reload} />}
      {tab === 'fw' && <FwRulesPanel rules={fwRules} reload={reload} />}
      {tab === 'upnp' && <UpnpPanel />}
    </div>
  );
}

interface UpnpMapping {
  proto: 'TCP' | 'UDP';
  externalPort: number;
  internalIp: string;
  internalPort: number;
  description: string;
  expiresAt: number | null;
}
interface UpnpState {
  enabled: boolean;
  running: boolean;
  allowedNetworks: Array<{ id: number; name: string; vlanId: number | null }>;
  mappingCount: number;
  mappings: UpnpMapping[];
}

function expiryLabel(ts: number | null): string {
  if (ts === null) return 'no expiry';
  const d = (ts - Date.now()) / 1000;
  if (d <= 0) return 'expired';
  if (d < 3600) return `${Math.round(d / 60)}m left`;
  if (d < 86400) return `${Math.round(d / 3600)}h left`;
  return `${Math.round(d / 86400)}d left`;
}

function UpnpPanel() {
  const [st, setSt] = useState<UpnpState | null>(null);
  const [busy, setBusy] = useState(false);

  const reload = () => api.get<UpnpState>('/api/upnp').then(setSt).catch(() => {});
  useEffect(() => { reload(); const t = setInterval(reload, 20_000); return () => clearInterval(t); }, []);

  const toggle = async () => {
    if (!st) return;
    if (!st.enabled && !window.confirm('Enable UPnP? LAN devices on opted-in networks will be able to open WAN ports without admin approval.')) return;
    setBusy(true);
    try { setSt(await api.patch<UpnpState>('/api/upnp', { enabled: !st.enabled })); }
    catch (e: any) { alert(e?.message ?? 'failed'); }
    finally { setBusy(false); }
  };

  const revoke = async (m: UpnpMapping) => {
    if (!window.confirm(`Revoke the ${m.proto} :${m.externalPort} → ${m.internalIp}:${m.internalPort} mapping?`)) return;
    try { await api.delete(`/api/upnp/mappings/${m.proto}/${m.externalPort}`); reload(); }
    catch (e: any) { alert(e?.message ?? 'failed'); }
  };

  return (
    <div className="space-y-6">
      <Card title="UPnP IGD / NAT-PMP" subtitle="Lets LAN devices auto-open WAN ports — gated, per-network"
            action={
              <Button variant={st?.enabled ? 'danger' : 'primary'} size="sm" icon="Power" onClick={toggle} disabled={busy || !st}>
                {st?.enabled ? 'Disable UPnP' : 'Enable UPnP'}
              </Button>
            }>
        <div className="flex flex-wrap items-center gap-3">
          <Badge variant={st?.running ? 'success' : st?.enabled ? 'warn' : 'neutral'} size="md" icon={st?.running ? 'CheckCircle2' : 'CircleSlash'}>
            {!st ? 'loading…' : st.running ? 'running' : st.enabled ? 'enabled — not running' : 'disabled'}
          </Badge>
          <span className="text-[12px] text-zinc-500">
            {st && st.allowedNetworks.length > 0
              ? <>honoured on: {st.allowedNetworks.map(n => n.name).join(', ')}</>
              : 'no networks opted in — enable "Allow UPnP" on a network under Settings → Networks'}
          </span>
        </div>
        <p className="text-[11.5px] text-zinc-500 mt-3 leading-relaxed">
          Mappings are created by devices on opted-in networks (game consoles, servers). Secure mode is on —
          a device can only forward a port to its own address. Every mapping is listed below and can be revoked.
        </p>
      </Card>

      <Card title="Active mappings" subtitle={st ? `${st.mappings.length} live port mapping${st.mappings.length === 1 ? '' : 's'}` : '—'}>
        <table className="w-full text-[12.5px]">
          <thead>
            <tr className="text-left text-[10.5px] uppercase tracking-[0.08em] text-zinc-500 border-b border-zinc-800/70">
              <th className="font-medium py-2.5 pr-4">Ext. Port</th>
              <th className="font-medium py-2.5 pr-4">Proto</th>
              <th className="font-medium py-2.5 pr-4">Internal Target</th>
              <th className="font-medium py-2.5 pr-4">Description</th>
              <th className="font-medium py-2.5 pr-4">Lease</th>
              <th className="font-medium py-2.5 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-800/60">
            {st?.mappings.map(m => (
              <tr key={`${m.proto}:${m.externalPort}`} className="hover:bg-zinc-900/30 group">
                <td className="py-3 pr-4 font-mono text-cyan-300">{m.externalPort}</td>
                <td className="py-3 pr-4"><Badge variant="neutral" size="sm">{m.proto}</Badge></td>
                <td className="py-3 pr-4 font-mono text-zinc-300">{m.internalIp}:{m.internalPort}</td>
                <td className="py-3 pr-4 text-zinc-400">{m.description}</td>
                <td className="py-3 pr-4 font-mono text-zinc-500">{expiryLabel(m.expiresAt)}</td>
                <td className="py-3 text-right">
                  <Button variant="danger" size="sm" icon="Trash2" className="opacity-0 group-hover:opacity-100 transition-opacity" onClick={() => revoke(m)}>Revoke</Button>
                </td>
              </tr>
            ))}
            {st && st.mappings.length === 0 && (
              <tr><td colSpan={6} className="py-8 text-center text-[12px] text-zinc-600">
                {st.enabled ? 'no active mappings — devices have not requested any' : 'UPnP is disabled'}
              </td></tr>
            )}
          </tbody>
        </table>
      </Card>
    </div>
  );
}

function DnatPanel({ forwards, reload }: { forwards: Dnat[]; reload: () => void }) {
  const [draft, setDraft] = useState({ srcPort: '', proto: 'tcp', destIp: '', destPort: '', comment: '' });

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!draft.srcPort || !draft.destIp || !draft.destPort) return;
    try {
      await api.post('/api/firewall/dnat', {
        srcPort: Number(draft.srcPort),
        proto: draft.proto,
        destIp: draft.destIp,
        destPort: Number(draft.destPort),
        comment: draft.comment || undefined,
      });
      setDraft({ srcPort: '', proto: 'tcp', destIp: '', destPort: '', comment: '' });
      reload();
    } catch (err: any) { alert(err?.message ?? 'failed'); }
  };

  return (
    <>
      <Card title="Add Port Forwarding Rule" subtitle="DNAT: eth0 (public) → eth1 (private)"
            action={<Badge variant="info" size="sm" icon="Info">iptables -t nat -A PREROUTING</Badge>}>
        <form className="grid grid-cols-2 md:grid-cols-6 gap-3" onSubmit={submit}>
          <Field label="Source port" className="md:col-span-1">
            <Input mono placeholder="80" value={draft.srcPort} onChange={(e) => setDraft({ ...draft, srcPort: e.target.value })} />
          </Field>
          <Field label="Protocol" className="md:col-span-1">
            <Select value={draft.proto} onChange={(e) => setDraft({ ...draft, proto: e.target.value })}>
              <option value="tcp">TCP</option><option value="udp">UDP</option><option value="both">TCP+UDP</option>
            </Select>
          </Field>
          <Field label="Destination IP" className="md:col-span-2">
            <Input mono placeholder="10.0.0.20" value={draft.destIp} onChange={(e) => setDraft({ ...draft, destIp: e.target.value })} />
          </Field>
          <Field label="Destination port" className="md:col-span-1">
            <Input mono placeholder="80" value={draft.destPort} onChange={(e) => setDraft({ ...draft, destPort: e.target.value })} />
          </Field>
          <Field label="Comment (optional)" className="md:col-span-1">
            <Input placeholder="web" value={draft.comment} onChange={(e) => setDraft({ ...draft, comment: e.target.value })} />
          </Field>
          <div className="col-span-2 md:col-span-6 flex items-center justify-between gap-3 pt-1">
            <code className="font-mono text-[11px] text-zinc-500 truncate">
              -A PREROUTING -i eth0 -p {draft.proto || 'tcp'} --dport <span className="text-zinc-300">{draft.srcPort || '—'}</span> -j DNAT --to-destination <span className="text-zinc-300">{draft.destIp || '—'}</span>:<span className="text-zinc-300">{draft.destPort || '—'}</span>
            </code>
            <Button type="submit" variant="primary" size="md" icon="Plus">Commit rule</Button>
          </div>
        </form>
      </Card>

      <Card title="Active Port Forwards" subtitle={`${forwards.length} DNAT entries`}>
        <table className="w-full text-[12.5px]">
          <thead>
            <tr className="text-left text-[10.5px] uppercase tracking-[0.08em] text-zinc-500 border-b border-zinc-800/70">
              <th className="font-medium py-2.5 w-8"></th>
              <th className="font-medium py-2.5">Public</th>
              <th className="font-medium py-2.5">Proto</th>
              <th className="font-medium py-2.5">→ Destination</th>
              <th className="font-medium py-2.5">Comment</th>
              <th className="font-medium py-2.5 text-right">Hits</th>
              <th className="font-medium py-2.5 text-right"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-800/60">
            {forwards.map((f, i) => (
              <tr key={f.id} className="hover:bg-zinc-900/30 group">
                <td className="py-3 text-zinc-600 font-mono text-[11px]">{String(i + 1).padStart(2, '0')}</td>
                <td className="py-3"><code className="font-mono text-zinc-100">eth0:{f.srcPort}</code></td>
                <td className="py-3"><Badge variant={f.proto === 'tcp' ? 'info' : 'accent'} size="sm">{f.proto.toUpperCase()}</Badge></td>
                <td className="py-3">
                  <div className="inline-flex items-center gap-2">
                    <Icon name="ArrowRight" size={12} className="text-zinc-600" />
                    <code className="font-mono text-cyan-300">{f.destIp}</code>
                    <span className="text-zinc-600">:</span>
                    <code className="font-mono text-zinc-300">{f.destPort}</code>
                  </div>
                </td>
                <td className="py-3 text-zinc-400">{f.comment || <span className="text-zinc-700">—</span>}</td>
                <td className="py-3 text-right font-mono text-zinc-400">{(f.hits ?? 0).toLocaleString()}</td>
                <td className="py-3 text-right">
                  <div className="inline-flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <IconButton name="Pencil" label="Edit" size="sm" />
                    <IconButton name="Trash2" label="Delete" size="sm" variant="danger"
                      onClick={() => api.delete(`/api/firewall/dnat/${f.id}`).then(reload)} />
                  </div>
                </td>
              </tr>
            ))}
            {forwards.length === 0 && <tr><td colSpan={7} className="py-8 text-center text-[12px] text-zinc-600">No forwards yet.</td></tr>}
          </tbody>
        </table>
      </Card>
    </>
  );
}

function SnatPanel({ rules, reload }: { rules: Snat[]; reload: () => void }) {
  const [draft, setDraft] = useState({ source: '', outIface: 'eth0', mode: 'MASQUERADE', toSource: '', comment: '' });

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!draft.source) return;
    if (draft.mode === 'SNAT' && !draft.toSource) return;
    try {
      await api.post('/api/firewall/snat', {
        source: draft.source,
        outIface: draft.outIface,
        mode: draft.mode,
        toSource: draft.mode === 'SNAT' ? draft.toSource : null,
        comment: draft.comment || undefined,
      });
      setDraft({ source: '', outIface: 'eth0', mode: 'MASQUERADE', toSource: '', comment: '' });
      reload();
    } catch (err: any) { alert(err?.message ?? 'failed'); }
  };

  const preview = draft.mode === 'MASQUERADE'
    ? `-A POSTROUTING -o ${draft.outIface} -s ${draft.source || '—'} -j MASQUERADE`
    : `-A POSTROUTING -o ${draft.outIface} -s ${draft.source || '—'} -j SNAT --to-source ${draft.toSource || '—'}`;

  return (
    <>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card title="MASQUERADE" subtitle="Dynamic source rewrite">
          <p className="text-[12px] text-zinc-400 leading-relaxed">Uses whichever IP is currently bound to the outgoing interface. Best for DHCP-assigned WANs.</p>
          <code className="block mt-3 font-mono text-[11px] text-cyan-300">-j MASQUERADE</code>
        </Card>
        <Card title="SNAT" subtitle="Static source rewrite">
          <p className="text-[12px] text-zinc-400 leading-relaxed">Pins outbound traffic to a specific public IP — required for reverse-DNS / mail reputation alignment.</p>
          <code className="block mt-3 font-mono text-[11px] text-cyan-300">-j SNAT --to-source x.x.x.x</code>
        </Card>
        <Card title="Outbound Interfaces" subtitle="WAN-side bindings">
          <div className="space-y-2 text-[12px]">
            <div className="flex justify-between font-mono"><span className="text-zinc-100">eth0</span><span className="text-cyan-300">51.38.114.207/29</span></div>
          </div>
        </Card>
      </div>

      <Card title="Add Source NAT Rule" subtitle="POSTROUTING chain · nat table"
            action={<Badge variant="info" size="sm" icon="Info">iptables -t nat -A POSTROUTING</Badge>}>
        <form className="grid grid-cols-2 md:grid-cols-6 gap-3" onSubmit={submit}>
          <Field label="Source (CIDR or IP)" className="md:col-span-2">
            <Input mono placeholder="10.0.0.0/24" value={draft.source} onChange={(e) => setDraft({ ...draft, source: e.target.value })} />
          </Field>
          <Field label="Out interface" className="md:col-span-1">
            <Select value={draft.outIface} onChange={(e) => setDraft({ ...draft, outIface: e.target.value })}>
              <option value="eth0">eth0</option>
            </Select>
          </Field>
          <Field label="Mode" className="md:col-span-1">
            <Select value={draft.mode} onChange={(e) => setDraft({ ...draft, mode: e.target.value })}>
              <option value="MASQUERADE">MASQUERADE</option><option value="SNAT">SNAT</option>
            </Select>
          </Field>
          <Field label="To source (SNAT only)" className="md:col-span-1">
            <Input mono placeholder="51.38.114.208" disabled={draft.mode !== 'SNAT'} value={draft.toSource} onChange={(e) => setDraft({ ...draft, toSource: e.target.value })} />
          </Field>
          <Field label="Comment" className="md:col-span-1">
            <Input placeholder="lan egress" value={draft.comment} onChange={(e) => setDraft({ ...draft, comment: e.target.value })} />
          </Field>
          <div className="col-span-2 md:col-span-6 flex items-center justify-between gap-3 pt-1">
            <code className="font-mono text-[11px] text-zinc-500 truncate">{preview}</code>
            <Button type="submit" variant="primary" size="md" icon="Plus">Commit rule</Button>
          </div>
        </form>
      </Card>

      <Card title="Active SNAT Rules" subtitle={`${rules.length} POSTROUTING entries`}>
        <table className="w-full text-[12.5px]">
          <thead>
            <tr className="text-left text-[10.5px] uppercase tracking-[0.08em] text-zinc-500 border-b border-zinc-800/70">
              <th className="font-medium py-2.5 w-8"></th>
              <th className="font-medium py-2.5">Source</th><th className="font-medium py-2.5">Out</th>
              <th className="font-medium py-2.5">Mode</th><th className="font-medium py-2.5">→ Rewrites to</th>
              <th className="font-medium py-2.5">Comment</th><th className="font-medium py-2.5 text-right"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-800/60">
            {rules.map((r, i) => (
              <tr key={r.id} className="hover:bg-zinc-900/30 group">
                <td className="py-3 font-mono text-[11px] text-zinc-600">{String(i + 1).padStart(2, '0')}</td>
                <td className="py-3 font-mono text-zinc-100">{r.source}</td>
                <td className="py-3 font-mono text-zinc-300">{r.outIface}</td>
                <td className="py-3"><Badge variant={r.mode === 'SNAT' ? 'accent' : 'info'} size="sm">{r.mode}</Badge></td>
                <td className="py-3 font-mono text-cyan-300">{r.toSource ?? '—'}</td>
                <td className="py-3 text-zinc-400">{r.comment}{r.isCore && <Badge variant="neutral" size="sm">core</Badge>}</td>
                <td className="py-3 text-right">
                  <div className="inline-flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <IconButton name="Pencil" label="Edit" size="sm" />
                    {!r.isCore && (
                      <IconButton name="Trash2" label="Delete" size="sm" variant="danger"
                        onClick={() => api.delete(`/api/firewall/snat/${r.id}`).then(reload)} />
                    )}
                  </div>
                </td>
              </tr>
            ))}
            {rules.length === 0 && <tr><td colSpan={7} className="py-8 text-center text-[12px] text-zinc-600">No SNAT rules.</td></tr>}
          </tbody>
        </table>
      </Card>
    </>
  );
}

function FwRulesPanel({ rules, reload }: { rules: Rule[]; reload: () => void }) {
  return (
    <Card title="Firewall Rules" subtitle="INPUT and FORWARD chains"
          action={<Button variant="primary" size="sm" icon="Plus">New rule</Button>}>
      <table className="w-full text-[12.5px]">
        <thead>
          <tr className="text-left text-[10.5px] uppercase tracking-[0.08em] text-zinc-500 border-b border-zinc-800/70">
            <th className="font-medium py-2.5">Chain</th><th className="font-medium py-2.5">Action</th>
            <th className="font-medium py-2.5">Proto</th><th className="font-medium py-2.5">Source</th>
            <th className="font-medium py-2.5">Dport</th><th className="font-medium py-2.5">Comment</th>
            <th className="font-medium py-2.5 text-right"></th>
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-800/60">
          {rules.map(r => (
            <tr key={r.id} className="hover:bg-zinc-900/30 group">
              <td className="py-3"><Badge variant="neutral" size="sm">{r.chain}</Badge></td>
              <td className="py-3"><Badge variant={r.action === 'ACCEPT' ? 'success' : r.action === 'DROP' ? 'danger' : 'warn'} size="sm">{r.action}</Badge></td>
              <td className="py-3 font-mono text-zinc-300">{r.proto}</td>
              <td className="py-3 font-mono text-zinc-300">{r.source ?? '—'}</td>
              <td className="py-3 font-mono text-cyan-300">{r.dport ?? '—'}</td>
              <td className="py-3 text-zinc-400">{r.comment}</td>
              <td className="py-3 text-right">
                <div className="inline-flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <IconButton name="Pencil" label="Edit" size="sm" />
                  <IconButton name="Trash2" label="Delete" size="sm" variant="danger"
                    onClick={() => api.delete(`/api/firewall/rules/${r.id}`).then(reload)} />
                </div>
              </td>
            </tr>
          ))}
          {rules.length === 0 && <tr><td colSpan={7} className="py-8 text-center text-[12px] text-zinc-600">No rules. Click "New rule" to add one.</td></tr>}
        </tbody>
      </table>
    </Card>
  );
}
