import { useEffect, useState } from 'react';
import { Card, Button, Modal, Field, Input, Select, Badge, Icon } from '../../components/primitives';
import { SpeedTestMainView } from '../../components/SpeedTest';
import { api } from '../../api/client';
import type { WanLink } from './types';

interface Draft {
  iface: string; label: string; role: string; priority: string;
  healthTarget: string; isp: string; wanPort: string;
}
const blankDraft: Draft = { iface: '', label: '', role: 'primary', priority: '100', healthTarget: '1.1.1.1', isp: '', wanPort: '' };

const statusColor = (s: string) => s === 'up' ? 'text-emerald-300' : s === 'degraded' ? 'text-amber-300' : 'text-rose-300';
const statusDot = (s: string) => s === 'up' ? 'bg-emerald-400' : s === 'degraded' ? 'bg-amber-400' : 'bg-rose-400';

function uptimeLabel(w: WanLink): string {
  if (w.uptimePct == null) return '—';
  return `${w.uptimePct}%`;
}

export function InternetSection() {
  const [wans, setWans] = useState<WanLink[]>([]);
  const [editing, setEditing] = useState<WanLink | null>(null);
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState<Draft>(blankDraft);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const reload = () => api.get<{ wans: WanLink[] }>('/api/wan').then(r => setWans(r.wans)).catch(() => {});
  useEffect(() => { reload(); const t = setInterval(reload, 15_000); return () => clearInterval(t); }, []);

  const openCreate = () => { setDraft(blankDraft); setCreating(true); setEditing(null); setErr(null); };
  const openEdit = (w: WanLink) => {
    setDraft({
      iface: w.iface, label: w.label, role: w.role, priority: String(w.priority),
      healthTarget: w.healthTarget, isp: w.isp ?? '', wanPort: w.wanPort == null ? '' : String(w.wanPort),
    });
    setEditing(w); setCreating(false); setErr(null);
  };
  const close = () => { setCreating(false); setEditing(null); setErr(null); };

  const save = async () => {
    setBusy(true); setErr(null);
    const body: any = {
      iface: draft.iface.trim(),
      label: draft.label.trim(),
      role: draft.role,
      priority: Number(draft.priority) || 100,
      healthTarget: draft.healthTarget.trim() || '1.1.1.1',
    };
    if (draft.isp.trim()) body.isp = draft.isp.trim();
    if (draft.wanPort.trim()) body.wanPort = Number(draft.wanPort);
    try {
      if (editing) await api.patch(`/api/wan/${editing.id}`, body);
      else await api.post('/api/wan', body);
      close(); reload();
    } catch (e: any) { setErr(e?.message ?? 'save failed'); }
    finally { setBusy(false); }
  };

  const remove = async (w: WanLink) => {
    if (!window.confirm(`Remove ${w.iface}? The default route may change if this is the active WAN.`)) return;
    try { await api.delete(`/api/wan/${w.id}`); reload(); }
    catch (e: any) { alert(e?.message ?? 'delete failed'); }
  };

  return (
    <div className="space-y-6">
      <Card title="Internet" subtitle="WAN uplinks · health probed every 30s · priority-based failover"
            action={<Button variant="primary" size="sm" icon="Plus" onClick={openCreate}>Create New</Button>}>
        <div className="overflow-x-auto">
          <table className="w-full text-[12.5px]">
            <thead>
              <tr className="text-left text-[10.5px] uppercase tracking-[0.08em] text-zinc-500 border-b border-zinc-800/70">
                <th className="font-medium py-2.5 pr-4">ISP</th>
                <th className="font-medium py-2.5 pr-4">Name</th>
                <th className="font-medium py-2.5 pr-4">Interface</th>
                <th className="font-medium py-2.5 pr-4">IPv4 Address</th>
                <th className="font-medium py-2.5 pr-4">IPv6 Address</th>
                <th className="font-medium py-2.5 pr-4">Port</th>
                <th className="font-medium py-2.5 pr-4">Uptime</th>
                <th className="font-medium py-2.5 pr-4">Peak Util.</th>
                <th className="font-medium py-2.5 pr-4">Latency</th>
                <th className="font-medium py-2.5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/60">
              {wans.map(w => (
                <tr key={w.id} className="hover:bg-zinc-900/30 group">
                  <td className="py-3 pr-4">
                    <span className="inline-flex items-center gap-2">
                      <span className={`w-1.5 h-1.5 rounded-full ${statusDot(w.health.status)}`} />
                      <span className="text-zinc-200">{w.isp ?? '—'}</span>
                    </span>
                  </td>
                  <td className="py-3 pr-4 text-zinc-300">{w.label}</td>
                  <td className="py-3 pr-4 font-mono text-zinc-100">{w.iface}</td>
                  <td className="py-3 pr-4 font-mono text-zinc-300">{w.ipv4 ?? '—'}</td>
                  <td className="py-3 pr-4 font-mono text-zinc-500">{w.ipv6 ?? '—'}</td>
                  <td className="py-3 pr-4 font-mono text-zinc-400">{w.wanPort ?? '—'}</td>
                  <td className="py-3 pr-4 font-mono text-zinc-300">{uptimeLabel(w)}</td>
                  <td className="py-3 pr-4 font-mono text-zinc-500">—</td>
                  <td className="py-3 pr-4 font-mono">
                    <span className={statusColor(w.health.status)}>
                      {w.health.rttMs != null ? `${w.health.rttMs.toFixed(0)} ms` : '—'}
                    </span>
                  </td>
                  <td className="py-3 text-right">
                    <div className="inline-flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <Button variant="ghost" size="sm" icon="Pencil" onClick={() => openEdit(w)}>Edit</Button>
                      <Button variant="danger" size="sm" icon="Trash2" onClick={() => remove(w)}>Remove</Button>
                    </div>
                  </td>
                </tr>
              ))}
              {wans.length === 0 && <tr><td colSpan={10} className="py-8 text-center text-[12px] text-zinc-600">no WAN uplinks — click Create New</td></tr>}
            </tbody>
          </table>
        </div>
        <GatewayPorts wans={wans} />
      </Card>

      <SpeedTestMainView />

      <Modal
        open={creating || editing != null}
        onClose={close}
        size="lg"
        title={editing ? `Edit ${editing.label}` : 'Add WAN uplink'}
        subtitle="The interface must already exist at the OS / Proxmox layer"
        footer={<>
          <Button variant="ghost" onClick={close}>Cancel</Button>
          <Button variant="primary" icon="Check" onClick={save} disabled={busy || !draft.iface.trim() || !draft.label.trim()}>
            {busy ? 'Saving…' : editing ? 'Save changes' : 'Add uplink'}
          </Button>
        </>}>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Field label="Interface">
            <Input mono placeholder="eth0" value={draft.iface} onChange={(e) => setDraft({ ...draft, iface: e.target.value })} disabled={editing != null} />
          </Field>
          <Field label="Name">
            <Input placeholder="Internet 1" value={draft.label} onChange={(e) => setDraft({ ...draft, label: e.target.value })} />
          </Field>
          <Field label="ISP" hint="Shown in the table — informational">
            <Input placeholder="Virgin Media" value={draft.isp} onChange={(e) => setDraft({ ...draft, isp: e.target.value })} />
          </Field>
          <Field label="Gateway port" hint="Physical port number">
            <Input mono type="number" placeholder="9" value={draft.wanPort} onChange={(e) => setDraft({ ...draft, wanPort: e.target.value })} />
          </Field>
          <Field label="Role">
            <Select value={draft.role} onChange={(e) => setDraft({ ...draft, role: e.target.value })}>
              <option value="primary">primary</option>
              <option value="failover">failover</option>
              <option value="snat-only">snat-only</option>
            </Select>
          </Field>
          <Field label="Priority" hint="Lower = preferred">
            <Input mono type="number" value={draft.priority} onChange={(e) => setDraft({ ...draft, priority: e.target.value })} />
          </Field>
          <Field label="Health-check target" className="md:col-span-2">
            <Input mono value={draft.healthTarget} onChange={(e) => setDraft({ ...draft, healthTarget: e.target.value })} />
          </Field>
        </div>
        {err && (
          <div className="mt-4 p-2.5 rounded-lg bg-rose-500/10 border border-rose-500/30 text-[11.5px] text-rose-300 flex gap-1.5">
            <Icon name="AlertCircle" size={13} className="shrink-0 mt-0.5" />{err}
          </div>
        )}
      </Modal>
    </div>
  );
}

/** Visual strip of the gateway's physical ports — green where a WAN is bound. */
function GatewayPorts({ wans }: { wans: WanLink[] }) {
  const used = new Map(wans.filter(w => w.wanPort != null).map(w => [w.wanPort!, w]));
  const ports = Array.from({ length: 8 }, (_, i) => i + 1);
  return (
    <div className="mt-4 pt-4 border-t border-zinc-800/60">
      <div className="text-[10.5px] uppercase tracking-[0.08em] text-zinc-500 mb-2">Gateway ports</div>
      <div className="flex items-end gap-1.5">
        {ports.map(p => {
          const w = used.get(p);
          const color = w
            ? (w.health.status === 'up' ? 'bg-emerald-500/70' : w.health.status === 'degraded' ? 'bg-amber-500/70' : 'bg-rose-500/70')
            : 'bg-zinc-800';
          return (
            <div key={p} className={`w-9 h-8 rounded ${color} border border-zinc-700/50 flex items-center justify-center`} title={w ? `${w.label} (${w.iface})` : `Port ${p} — unused`}>
              <span className="text-[10px] font-mono text-zinc-950/80">{p}</span>
            </div>
          );
        })}
        <div className="w-12 h-8 rounded bg-sky-600/50 border border-zinc-700/50 flex items-center justify-center ml-2" title="SFP+ uplink">
          <span className="text-[9px] font-mono text-zinc-100">SFP+</span>
        </div>
      </div>
      <p className="text-[10.5px] text-zinc-600 mt-2">Port mapping is informational — assign a port number when adding a WAN uplink.</p>
    </div>
  );
}
