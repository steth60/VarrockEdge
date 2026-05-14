import { useEffect, useMemo, useState } from 'react';
import { Card, Badge, Button, IconButton, KPICard, Sparkline, Icon, Select, Modal, KV, LegendDot, ToggleSwitch, Input, LOG_LEVEL_COLORS } from '../components/primitives';
import { api } from '../api/client';

interface Threat {
  id: number;
  ruleId: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  kind: string;
  src: string;
  dst: string;
  count: number;
  firstSeenAt: number;
  lastSeenAt: number;
  status: string;
  country: string | null;
  desc: string | null;
}

interface Rule { id: string; name: string; category: string; enabled: boolean; severity: string; threshold: string; action: string; hits: number; builtin: boolean }
interface Ban { ip: string; jail: string; bannedAt: number | null; expiresAt: number | null; attempts: number | null; reason: string | null }
interface Bucket { hour: number; critical: number; high: number; medium: number; low: number }

const SEV_META: Record<string, { variant: any; dot: string }> = {
  critical: { variant: 'danger', dot: 'bg-rose-400 dot-pulse' },
  high:     { variant: 'warn',   dot: 'bg-orange-400' },
  medium:   { variant: 'warn',   dot: 'bg-amber-400' },
  low:      { variant: 'info',   dot: 'bg-sky-400' },
};
const STATUS_META: Record<string, { variant: any; label: string }> = {
  banned:       { variant: 'danger',  label: 'IP banned' },
  'rate-limit': { variant: 'warn',    label: 'Rate-limited' },
  flagged:      { variant: 'warn',    label: 'Flagged' },
  monitoring:   { variant: 'info',    label: 'Monitoring' },
  acked:        { variant: 'neutral', label: 'Acknowledged' },
};

function fmtTime(ms: number): string {
  const d = new Date(ms);
  return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}:${d.getSeconds().toString().padStart(2, '0')}`;
}

export function Logs() {
  const [tab, setTab] = useState<'threats' | 'live' | 'rules' | 'banlist'>('threats');
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Threat | null>(null);
  const [threats, setThreats] = useState<Threat[]>([]);
  const [buckets, setBuckets] = useState<Bucket[]>([]);

  const reloadThreats = () => {
    api.get<{ threats: Threat[] }>('/api/security/threats').then(r => setThreats(r.threats)).catch(() => {});
    api.get<{ buckets: Bucket[] }>('/api/security/timeline').then(r => setBuckets(r.buckets)).catch(() => {});
  };

  useEffect(() => {
    if (tab !== 'threats') return;
    reloadThreats();
    const t = setInterval(reloadThreats, 10_000);
    return () => clearInterval(t);
  }, [tab]);

  const filtered = threats.filter(t =>
    (filter === 'all' || t.severity === filter) &&
    (!search || `${t.kind} ${t.src} ${t.dst} ${t.desc ?? ''}`.toLowerCase().includes(search.toLowerCase()))
  );

  const ackOrBan = async (t: Threat, kind: 'ack' | 'ban') => {
    if (kind === 'ack') {
      await api.patch(`/api/security/threats/${t.id}`, { status: 'acked' }).catch(() => {});
    } else {
      await api.post(`/api/security/threats/${t.id}/ban`).catch(() => {});
    }
    setSelected(null);
    reloadThreats();
  };

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <KPICard label="Open threats"   value={threats.filter(t => t.status !== 'acked').length} icon="AlertTriangle" tone="danger" />
        <KPICard label="Critical (24h)" value={threats.filter(t => t.severity === 'critical').length} icon="ShieldX" tone="neutral" />
        <KPICard label="Events / hour"  value={buckets[23]?.critical ?? 0 + (buckets[23]?.high ?? 0) + (buckets[23]?.medium ?? 0) + (buckets[23]?.low ?? 0)} icon="Activity" tone="accent"
          spark={<Sparkline data={buckets.map(b => b.critical + b.high + b.medium + b.low)} color="#22d3ee" />} />
        <KPICard label="Rules enabled"  value={'—'} icon="Radar" tone="success" />
      </div>

      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-1 p-1 rounded-lg bg-zinc-900/40 border border-zinc-800/60 w-fit">
          {[
            { id: 'threats', label: 'Threat detection', icon: 'ShieldAlert' },
            { id: 'live',    label: 'Live logs',        icon: 'Terminal' },
            { id: 'rules',   label: 'Detection rules',  icon: 'SlidersHorizontal' },
            { id: 'banlist', label: 'Block list',       icon: 'ShieldX' },
          ].map(t => (
            <button key={t.id} onClick={() => setTab(t.id as any)}
                    className={`inline-flex items-center gap-2 h-8 px-3 rounded-md text-[12px] font-medium transition-colors ${tab === t.id ? 'bg-zinc-800/80 text-zinc-100' : 'text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800/40'}`}>
              <Icon name={t.icon} size={13} />{t.label}
            </button>
          ))}
        </div>
        {tab === 'threats' && (
          <div className="flex items-center gap-2">
            <div className="relative">
              <Icon name="Search" size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-500" />
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="search IP, reason…"
                     className="h-8 pl-7 pr-3 rounded-md bg-zinc-900/60 border border-zinc-800/70 text-[12px] placeholder:text-zinc-600 w-56" />
            </div>
            <div className="inline-flex rounded-md bg-zinc-900/60 border border-zinc-800/60 p-0.5">
              {['all', 'critical', 'high', 'medium', 'low'].map(s => (
                <button key={s} onClick={() => setFilter(s)}
                        className={`px-2.5 h-7 text-[11.5px] rounded-sm font-medium transition-colors ${filter === s ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-500 hover:text-zinc-200'}`}>{s}</button>
              ))}
            </div>
            <Button variant="ghost" size="sm" icon="RefreshCw" onClick={reloadThreats}>Refresh</Button>
          </div>
        )}
      </div>

      {tab === 'threats' && (
        <>
          <Card title="Event timeline" subtitle="Last 24 hours · grouped by hour" action={<Badge variant="info" size="sm" icon="Radar">live</Badge>}>
            <ThreatTimeline buckets={buckets} />
          </Card>
          <Card title="Detected threats" subtitle={`${filtered.length} of ${threats.length} matching · live from detector`}>
            <table className="w-full text-[12.5px]">
              <thead>
                <tr className="text-left text-[10.5px] uppercase tracking-[0.08em] text-zinc-500 border-b border-zinc-800/70">
                  <th className="font-medium py-2.5 w-12">Sev</th>
                  <th className="font-medium py-2.5">Type</th>
                  <th className="font-medium py-2.5">Source</th>
                  <th className="font-medium py-2.5">Target</th>
                  <th className="font-medium py-2.5 text-right">Count</th>
                  <th className="font-medium py-2.5">First seen</th>
                  <th className="font-medium py-2.5">Last seen</th>
                  <th className="font-medium py-2.5">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800/60">
                {filtered.map(t => {
                  const sev = SEV_META[t.severity] ?? SEV_META.low;
                  const status = STATUS_META[t.status] ?? STATUS_META.monitoring;
                  return (
                    <tr key={t.id} onClick={() => setSelected(t)} className="hover:bg-zinc-900/30 cursor-pointer">
                      <td className="py-3">
                        <div className="flex items-center gap-2">
                          <span className={`w-2 h-2 rounded-full ${sev.dot}`} />
                          <span className="text-[10.5px] uppercase tracking-wider text-zinc-400">{t.severity}</span>
                        </div>
                      </td>
                      <td className="py-3">
                        <div className="text-zinc-100">{t.kind}</div>
                        {t.desc && <div className="text-[11px] text-zinc-500 mt-0.5 truncate max-w-[260px]">{t.desc}</div>}
                      </td>
                      <td className="py-3"><code className="font-mono text-cyan-300">{t.src}</code></td>
                      <td className="py-3 font-mono text-zinc-300">{t.dst}</td>
                      <td className="py-3 text-right font-mono text-zinc-400">{t.count.toLocaleString()}</td>
                      <td className="py-3 font-mono text-zinc-500 text-[11.5px]">{fmtTime(t.firstSeenAt)}</td>
                      <td className="py-3 font-mono text-zinc-500 text-[11.5px]">{fmtTime(t.lastSeenAt)}</td>
                      <td className="py-3"><Badge variant={status.variant} size="sm">{status.label}</Badge></td>
                    </tr>
                  );
                })}
                {filtered.length === 0 && (
                  <tr><td colSpan={8} className="py-8 text-center text-[12px] text-zinc-600">No threats matching. Detector is running — events will appear here as the journal generates matches.</td></tr>
                )}
              </tbody>
            </table>
          </Card>
        </>
      )}

      {tab === 'live' && <LiveLogs />}
      {tab === 'rules' && <DetectionRules />}
      {tab === 'banlist' && <BanList />}

      <Modal open={!!selected} onClose={() => setSelected(null)} size="lg"
             title={selected?.kind} subtitle={selected ? `Threat #${String(selected.id).padStart(4, '0')} · ${selected.severity.toUpperCase()}` : ''}
             footer={selected && (
               <>
                 <Button variant="ghost" onClick={() => setSelected(null)}>Close</Button>
                 <Button variant="secondary" icon="Eye" onClick={() => ackOrBan(selected, 'ack')}>Acknowledge</Button>
                 <Button variant="danger" icon="ShieldX" onClick={() => ackOrBan(selected, 'ban')}>Ban IP</Button>
               </>
             )}>
        {selected && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <KV k="Source"      v={selected.src} mono />
              <KV k="Target"      v={selected.dst} mono />
              <KV k="Event count" v={selected.count.toLocaleString()} mono />
              <KV k="Rule"        v={selected.ruleId} mono />
              <KV k="First seen"  v={fmtTime(selected.firstSeenAt)} mono />
              <KV k="Last seen"   v={fmtTime(selected.lastSeenAt)} mono />
              <KV k="Status"      v={(STATUS_META[selected.status] ?? STATUS_META.monitoring).label} />
              <KV k="Severity"    v={selected.severity} />
            </div>
            {selected.desc && (
              <div>
                <div className="text-[11px] uppercase tracking-[0.08em] text-zinc-500 mb-2">Description</div>
                <p className="text-[12.5px] text-zinc-300 leading-relaxed">{selected.desc}</p>
              </div>
            )}
            <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-400/30 flex gap-2 text-[12px] text-amber-200">
              <Icon name="AlertCircle" size={14} className="text-amber-300 shrink-0 mt-0.5" />
              <div>
                <strong>Action:</strong> {selected.status === 'banned'
                  ? 'IP is currently in a fail2ban jail.'
                  : 'Acknowledge to dismiss without action, or ban to send to fail2ban.'}
              </div>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

function ThreatTimeline({ buckets }: { buckets: Bucket[] }) {
  const max = useMemo(() => Math.max(1, ...buckets.map(b => b.critical + b.high + b.medium + b.low)), [buckets]);
  const hourLabel = (h: number) => {
    const d = new Date(h * 3_600_000);
    return `${d.getHours().toString().padStart(2, '0')}:00`;
  };
  return (
    <div>
      <div className="flex items-end gap-1 h-32">
        {buckets.map(b => {
          const total = b.critical + b.high + b.medium + b.low;
          return (
            <div key={b.hour} className="flex-1 flex flex-col-reverse gap-px group" title={`${hourLabel(b.hour)} — ${total} events`}>
              <div style={{ height: `${(b.low / max) * 100}%`,      background: 'rgba(56,189,248,0.55)' }} />
              <div style={{ height: `${(b.medium / max) * 100}%`,   background: 'rgba(251,191,36,0.7)' }} />
              <div style={{ height: `${(b.high / max) * 100}%`,     background: 'rgba(251,146,60,0.85)' }} />
              <div style={{ height: `${(b.critical / max) * 100}%`, background: '#fb7185' }} />
            </div>
          );
        })}
      </div>
      <div className="flex justify-between mt-2 font-mono text-[10px] text-zinc-500">
        {buckets.length > 0 && [0, 4, 8, 12, 16, 20, 23].map(i => buckets[i] && <span key={i}>{hourLabel(buckets[i]!.hour)}</span>)}
      </div>
      <div className="mt-3 flex flex-wrap gap-3 text-[11px]">
        <LegendDot color="#fb7185" label="Critical" />
        <LegendDot color="rgba(251,146,60,0.85)" label="High" />
        <LegendDot color="rgba(251,191,36,0.85)" label="Medium" />
        <LegendDot color="rgba(56,189,248,0.7)" label="Low" />
      </div>
    </div>
  );
}

function LiveLogs() {
  const [source, setSource] = useState('all');
  const [level, setLevel] = useState('all');
  const [logs, setLogs] = useState<{ time: string; level: string; svc: string; msg: string }[]>([]);

  useEffect(() => {
    api.get<{ logs: any[] }>('/api/logs/recent').then(r => setLogs(r.logs)).catch(() => {});
    const es = new EventSource('/api/logs/stream', { withCredentials: true });
    es.onmessage = (ev) => {
      try {
        const line = JSON.parse(ev.data);
        setLogs(prev => [line, ...prev].slice(0, 200));
      } catch { /* ignore */ }
    };
    return () => es.close();
  }, []);

  const filtered = logs.filter(l => {
    if (source !== 'all' && l.svc !== source) return false;
    const order: Record<string, number> = { ERROR: 0, WARN: 1, INFO: 2, OK: 2, DEBUG: 3 };
    const min: Record<string, number> = { all: 99, ERROR: 0, WARN: 1, INFO: 2 };
    return (order[l.level] ?? 99) <= (min[level] ?? 99);
  });

  return (
    <Card title="Live log stream" subtitle="Unified journal"
          action={
            <div className="flex items-center gap-2">
              <Select value={source} onChange={(e) => setSource(e.target.value)} className="h-8 !text-[11.5px]">
                <option value="all">All sources</option>
                <option value="dnsmasq">dnsmasq</option>
                <option value="wg-quick">wg-quick</option>
                <option value="iptables">iptables</option>
                <option value="fail2ban">fail2ban</option>
              </Select>
              <Select value={level} onChange={(e) => setLevel(e.target.value)} className="h-8 !text-[11.5px]">
                <option value="all">All levels</option>
                <option value="ERROR">Error+</option>
                <option value="WARN">Warn+</option>
                <option value="INFO">Info+</option>
              </Select>
              <Badge variant="info" size="sm" icon="Activity">live</Badge>
            </div>
          }>
      <div className="bg-zinc-950/60 border border-zinc-800/60 rounded-lg p-3 font-mono text-[11.5px] leading-relaxed max-h-[480px] overflow-auto">
        {filtered.map((l, i) => (
          <div key={i} className="flex gap-3 hover:bg-zinc-900/30 -mx-1 px-1 rounded">
            <span className="text-zinc-600 shrink-0">{l.time}</span>
            <span className={`shrink-0 w-14 ${LOG_LEVEL_COLORS[l.level] ?? 'text-zinc-300'}`}>{l.level}</span>
            <span className="text-zinc-500 shrink-0 w-20">{l.svc}</span>
            <span className="text-zinc-300 truncate">{l.msg}</span>
          </div>
        ))}
        <div className="flex gap-3 mt-2 opacity-70">
          <span className="text-zinc-600 shrink-0">— streaming —</span>
          <span className="shimmer h-3 rounded flex-1 max-w-md" />
        </div>
      </div>
    </Card>
  );
}

function DetectionRules() {
  const [rules, setRules] = useState<Rule[]>([]);
  const reload = () => api.get<{ rules: Rule[] }>('/api/security/rules').then(r => setRules(r.rules)).catch(() => {});
  useEffect(() => { reload(); }, []);
  const toggle = async (r: Rule) => {
    await api.patch(`/api/security/rules/${r.id}`, { enabled: !r.enabled }).catch(() => {});
    reload();
  };
  return (
    <Card title="Detection rules" subtitle={`${rules.filter(r => r.enabled).length} of ${rules.length} enabled · changes persist to DB`}
          action={<Button variant="primary" size="sm" icon="Plus">New rule</Button>}>
      <table className="w-full text-[12.5px]">
        <thead><tr className="text-left text-[10.5px] uppercase tracking-[0.08em] text-zinc-500 border-b border-zinc-800/70">
          <th className="font-medium py-2.5 w-10"></th>
          <th className="font-medium py-2.5">Rule</th>
          <th className="font-medium py-2.5">Category</th>
          <th className="font-medium py-2.5">Severity</th>
          <th className="font-medium py-2.5">Threshold</th>
          <th className="font-medium py-2.5">Action</th>
          <th className="font-medium py-2.5 text-right">Hits</th>
        </tr></thead>
        <tbody className="divide-y divide-zinc-800/60">
          {rules.map(r => (
            <tr key={r.id} className="hover:bg-zinc-900/30 group">
              <td className="py-3"><ToggleSwitch value={r.enabled} onChange={() => toggle(r)} /></td>
              <td className="py-3 text-zinc-100">{r.name}</td>
              <td className="py-3 text-zinc-400">{r.category}</td>
              <td className="py-3"><Badge variant={SEV_META[r.severity]?.variant ?? 'neutral'} size="sm">{r.severity}</Badge></td>
              <td className="py-3 font-mono text-zinc-400 text-[11.5px]">{r.threshold}</td>
              <td className="py-3 font-mono text-cyan-300 text-[11.5px]">{r.action}</td>
              <td className="py-3 text-right font-mono text-zinc-400">{r.hits.toLocaleString()}</td>
            </tr>
          ))}
          {rules.length === 0 && <tr><td colSpan={7} className="py-8 text-center text-[12px] text-zinc-600">No rules.</td></tr>}
        </tbody>
      </table>
    </Card>
  );
}

function BanList() {
  const [bans, setBans] = useState<Ban[]>([]);
  const [newIp, setNewIp] = useState('');
  const [newJail, setNewJail] = useState('sshd');

  const reload = () => api.get<{ bans: Ban[] }>('/api/security/bans').then(r => setBans(r.bans)).catch(() => {});
  useEffect(() => { reload(); const t = setInterval(reload, 15_000); return () => clearInterval(t); }, []);

  const add = async () => {
    if (!/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(newIp)) { alert('Invalid IPv4 address'); return; }
    try {
      await api.post('/api/security/bans', { ip: newIp, jail: newJail });
      setNewIp('');
      reload();
    } catch (err: any) { alert(err?.message ?? 'failed'); }
  };
  const remove = async (ip: string) => {
    try { await api.delete(`/api/security/bans/${encodeURIComponent(ip)}`); reload(); }
    catch (err: any) { alert(err?.message ?? 'failed'); }
  };

  return (
    <Card title="Block list" subtitle={`${bans.length} active ban${bans.length === 1 ? '' : 's'} · live from fail2ban-client`}
          action={
            <div className="flex gap-2">
              <Input mono placeholder="IP / CIDR" className="h-8 w-36" value={newIp} onChange={(e) => setNewIp(e.target.value)} />
              <Select value={newJail} onChange={(e) => setNewJail(e.target.value)} className="h-8 !text-[11.5px] w-32">
                <option>sshd</option><option>recidive</option><option>dns-abuse</option>
              </Select>
              <Button variant="primary" size="sm" icon="ShieldX" onClick={add}>Add ban</Button>
            </div>
          }>
      <table className="w-full text-[12.5px]">
        <thead><tr className="text-left text-[10.5px] uppercase tracking-[0.08em] text-zinc-500 border-b border-zinc-800/70">
          <th className="font-medium py-2.5">IP</th>
          <th className="font-medium py-2.5">Jail</th>
          <th className="font-medium py-2.5">Reason</th>
          <th className="font-medium py-2.5 text-right">Attempts</th>
          <th className="font-medium py-2.5">Banned at</th>
          <th className="font-medium py-2.5">Expires</th>
          <th className="font-medium py-2.5 text-right"></th>
        </tr></thead>
        <tbody className="divide-y divide-zinc-800/60">
          {bans.map(b => (
            <tr key={`${b.ip}-${b.jail}`} className="hover:bg-zinc-900/30 group">
              <td className="py-3 font-mono text-rose-300">{b.ip}</td>
              <td className="py-3"><Badge variant="neutral" size="sm">{b.jail}</Badge></td>
              <td className="py-3 text-zinc-300">{b.reason ?? '—'}</td>
              <td className="py-3 text-right font-mono text-zinc-400">{b.attempts?.toLocaleString() ?? '—'}</td>
              <td className="py-3 font-mono text-zinc-500">{b.bannedAt ? fmtTime(b.bannedAt) : '—'}</td>
              <td className="py-3 font-mono text-zinc-500">{b.expiresAt ? new Date(b.expiresAt).toLocaleString() : '—'}</td>
              <td className="py-3 text-right">
                <div className="inline-flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <Button variant="ghost" size="sm" icon="Unlock" onClick={() => remove(b.ip)}>Unban</Button>
                </div>
              </td>
            </tr>
          ))}
          {bans.length === 0 && <tr><td colSpan={7} className="py-8 text-center text-[12px] text-zinc-600">No bans active.</td></tr>}
        </tbody>
      </table>
    </Card>
  );
}
