import { useEffect, useState, type FormEvent } from 'react';
import { Card, Button, IconButton, Field, Input, Select, Badge, StatusPill, Ring, Icon } from '../components/primitives';
import { api } from '../api/client';

interface Record { id: number; host: string; type: string; target: string; ttl: number }
interface Upstream { id: number; ip: string; provider: string | null; enabled: boolean }
interface Stats { queriesLastHour: number; queriesTrendPct: number; cacheHits: number; cacheMisses: number; cacheSize: number; blocklistSize: number }

export function Dns() {
  const [records, setRecords] = useState<Record[]>([]);
  const [upstreams, setUpstreams] = useState<Upstream[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [queries, setQueries] = useState<any[][]>([]);
  const [newHost, setNewHost] = useState('');
  const [newTarget, setNewTarget] = useState('');
  const [newType, setNewType] = useState<'A' | 'AAAA' | 'CNAME' | 'TXT'>('A');

  const reload = () => {
    api.get<{ records: Record[] }>('/api/dns/records').then(r => setRecords(r.records)).catch(() => {});
    api.get<{ upstreams: Upstream[] }>('/api/dns/upstreams').then(r => setUpstreams(r.upstreams)).catch(() => {});
    api.get<Stats>('/api/dns/stats').then(setStats).catch(() => {});
    api.get<{ queries: any[][] }>('/api/dns/queries').then(r => setQueries(r.queries)).catch(() => {});
  };

  useEffect(reload, []);

  const addRecord = async (e: FormEvent) => {
    e.preventDefault();
    if (!newHost || !newTarget) return;
    try {
      await api.post('/api/dns/records', { host: newHost, target: newTarget, type: newType, ttl: 300 });
      setNewHost('');
      setNewTarget('');
      reload();
    } catch (err: any) { alert(err?.message ?? 'failed'); }
  };

  const removeRecord = async (id: number) => {
    try { await api.delete(`/api/dns/records/${id}`); reload(); } catch (err: any) { alert(err?.message); }
  };

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
        <Card title="Resolver" subtitle="dnsmasq listener" className="lg:col-span-1">
          <div className="font-mono text-[18px] text-cyan-300">10.0.0.1:53</div>
          <div className="mt-2 text-[11.5px] text-zinc-500">tcp + udp · cached</div>
          <div className="mt-4">
            <StatusPill status="running" label="serving queries" />
          </div>
        </Card>

        <Card title="Queries" subtitle="Last 60 minutes" className="lg:col-span-1">
          <div className="font-display text-[28px] font-semibold text-zinc-100 leading-none">{stats?.queriesLastHour?.toLocaleString() ?? '—'}</div>
          <div className="mt-1 text-[11px] text-emerald-300 font-mono">▲ {stats?.queriesTrendPct?.toFixed(1) ?? '0'}% vs prev hr</div>
          <div className="mt-3 flex items-end gap-[2px] h-10">
            {Array.from({ length: 24 }).map((_, i) => (
              <span key={i} className="flex-1 rounded-t-sm bg-cyan-400/60"
                    style={{ height: `${20 + (Math.sin(i * 0.7) + 1) * 35 + (i % 3) * 5}%` }} />
            ))}
          </div>
        </Card>

        <Card title="Cache" subtitle="Hit ratio" className="lg:col-span-1">
          <div className="flex items-center gap-4">
            <Ring value={stats ? Math.round((stats.cacheHits / Math.max(1, stats.cacheHits + stats.cacheMisses)) * 100) : 82} color="#a78bfa" size={68} />
            <div className="text-[11.5px] text-zinc-400 space-y-0.5">
              <div className="font-mono"><span className="text-zinc-500">hits</span> {stats?.cacheHits?.toLocaleString() ?? '—'}</div>
              <div className="font-mono"><span className="text-zinc-500">misses</span> {stats?.cacheMisses?.toLocaleString() ?? '—'}</div>
              <div className="font-mono"><span className="text-zinc-500">size</span> {stats?.cacheSize ?? '—'}</div>
            </div>
          </div>
        </Card>

        <Card title="Block List" subtitle="Ads + trackers" className="lg:col-span-1">
          <div className="font-display text-[28px] font-semibold text-zinc-100 leading-none">{stats?.blocklistSize?.toLocaleString() ?? '—'}</div>
          <div className="mt-1 text-[11px] text-zinc-500">domains in blocklist</div>
          <div className="mt-3 flex gap-2 items-center">
            <Badge variant="success" size="sm">enabled</Badge>
            <span className="text-[11px] text-zinc-500">updated 4h ago</span>
          </div>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card title="Upstream Resolvers" subtitle="Forwarders for non-local queries" className="lg:col-span-2"
              action={<Button variant="ghost" size="sm" icon="Plus">Add upstream</Button>}>
          <div className="space-y-2">
            {upstreams.map(r => (
              <div key={r.ip} className="flex items-center gap-3 p-3 rounded-lg bg-zinc-900/40 border border-zinc-800/60">
                <span className={`w-1.5 h-1.5 rounded-full ${r.enabled ? 'bg-emerald-400 dot-pulse' : 'bg-zinc-600'}`} />
                <code className="font-mono text-[12.5px] text-zinc-100 w-24">{r.ip}</code>
                <span className="text-[12px] text-zinc-400 flex-1">{r.provider}</span>
                <code className="font-mono text-[11.5px] text-zinc-500">—</code>
                <IconButton name="MoreHorizontal" label="More" size="sm" />
              </div>
            ))}
          </div>
        </Card>

        <Card title="Add DNS Record" subtitle="varrok.local zone" className="lg:col-span-1">
          <form className="space-y-3" onSubmit={addRecord}>
            <Field label="Type">
              <Select value={newType} onChange={(e) => setNewType(e.target.value as any)}>
                <option value="A">A · IPv4</option>
                <option value="AAAA">AAAA · IPv6</option>
                <option value="CNAME">CNAME · Alias</option>
                <option value="TXT">TXT · Text</option>
              </Select>
            </Field>
            <Field label="Hostname">
              <Input mono placeholder="service.varrok.local" value={newHost} onChange={(e) => setNewHost(e.target.value)} />
            </Field>
            <Field label="Target">
              <Input mono placeholder="10.0.0.42" value={newTarget} onChange={(e) => setNewTarget(e.target.value)} />
            </Field>
            <Button variant="primary" size="md" icon="Plus" className="w-full" type="submit">Add record</Button>
          </form>
        </Card>
      </div>

      <Card title="Local DNS Records" subtitle="varrok.local zone — dnsmasq /etc/hosts injection"
            action={<Button variant="secondary" size="sm" icon="FileDown">Export zone</Button>}>
        <table className="w-full text-[12.5px]">
          <thead>
            <tr className="text-left text-[10.5px] uppercase tracking-[0.08em] text-zinc-500 border-b border-zinc-800/70">
              <th className="font-medium py-2.5">Hostname</th>
              <th className="font-medium py-2.5">Type</th>
              <th className="font-medium py-2.5">Target</th>
              <th className="font-medium py-2.5">TTL</th>
              <th className="font-medium py-2.5 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-800/60">
            {records.map((r) => (
              <tr key={r.id} className="hover:bg-zinc-900/30 group">
                <td className="py-3 font-mono text-zinc-100">{r.host}</td>
                <td className="py-3"><Badge variant="info" size="sm">{r.type}</Badge></td>
                <td className="py-3 font-mono text-cyan-300">{r.target}</td>
                <td className="py-3 font-mono text-zinc-500">{r.ttl}s</td>
                <td className="py-3 text-right">
                  <div className="inline-flex opacity-0 group-hover:opacity-100 transition-opacity gap-1">
                    <IconButton name="Pencil" label="Edit" size="sm" />
                    <IconButton name="Trash2" label="Delete" size="sm" variant="danger" onClick={() => removeRecord(r.id)} />
                  </div>
                </td>
              </tr>
            ))}
            {records.length === 0 && <tr><td colSpan={5} className="py-8 text-center text-[12px] text-zinc-600">No records yet.</td></tr>}
          </tbody>
        </table>
      </Card>

      <Card title="Recent Queries" subtitle="Live query log — tail of dnsmasq.log"
            action={<Badge variant="info" size="sm" icon="Activity">live</Badge>}>
        <div className="bg-zinc-950/50 border border-zinc-800/60 rounded-lg p-3 font-mono text-[11.5px] leading-relaxed max-h-[260px] overflow-auto">
          {queries.map((q, i) => {
            const [t, type, host, src, route, lat] = q;
            return (
              <div key={i} className="flex gap-3">
                <span className="text-zinc-600 shrink-0">{t}</span>
                <span className="text-sky-300 shrink-0 w-12">{type}</span>
                <span className="text-zinc-300 flex-1 truncate">{host}</span>
                <span className="text-zinc-500 shrink-0 w-20">from {src}</span>
                <span className={`shrink-0 w-16 ${route === 'blocked' ? 'text-rose-300' : route === 'local' ? 'text-emerald-300' : route === 'cache' ? 'text-violet-300' : 'text-zinc-400'}`}>{route}</span>
                <span className="text-zinc-500 shrink-0 w-12 text-right">{lat}</span>
              </div>
            );
          })}
        </div>
      </Card>
    </div>
  );
}
