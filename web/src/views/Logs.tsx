import { useEffect, useMemo, useState } from 'react';
import { Card, Badge, Button, IconButton, KPICard, Sparkline, Icon, Select, Modal, KV, LegendDot, ToggleSwitch, Input, LOG_LEVEL_COLORS } from '../components/primitives';
import { api } from '../api/client';

interface Threat { id: number; severity: 'critical'|'high'|'medium'|'low'; kind: string; src: string; dst: string; count: number; first: string; last: string; status: string; country: string; desc: string }

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

const THREATS_SEED: Threat[] = [
  { id: 1, severity: 'critical', kind: 'Brute force',         src: '185.220.101.42', dst: 'eth0:22',     count: 142,  first: '14:18:02', last: '14:21:18', status: 'banned',     country: 'RU', desc: 'SSH password auth attempts from Tor exit node' },
  { id: 2, severity: 'high',     kind: 'Port scan',           src: '212.83.40.6',    dst: 'eth0:*',      count: 1024, first: '13:48:11', last: '13:49:02', status: 'banned',     country: 'FR', desc: 'TCP SYN sweep across 1024 ports in 51s' },
  { id: 3, severity: 'high',     kind: 'DNS amplification',   src: '94.115.66.12',   dst: 'eth0:53',     count: 86,   first: '12:11:33', last: '14:02:51', status: 'rate-limit', country: 'UK', desc: 'ANY queries with spoofed source — recursive denial in effect' },
  { id: 4, severity: 'medium',   kind: 'Anomalous egress',    src: '10.0.0.74',      dst: 'tor exit',    count: 4,    first: '13:22:08', last: '14:11:01', status: 'flagged',    country: 'LAN',desc: 'Workstation initiated outbound connections to known Tor relays' },
  { id: 5, severity: 'medium',   kind: 'Failed WG handshake', src: '88.214.10.92',   dst: 'eth0:51820',  count: 18,   first: '11:51:14', last: '14:02:55', status: 'monitoring', country: 'DE', desc: 'Repeated handshakes with invalid public key' },
  { id: 6, severity: 'low',      kind: 'New device on LAN',   src: 'bc:24:11:0e:91:4a',dst: '10.0.0.118',count: 1,    first: '10:05:11', last: '10:05:11', status: 'acked',      country: 'LAN',desc: 'Previously unseen MAC joined DHCP scope' },
];

export function Logs() {
  const [tab, setTab] = useState<'threats' | 'live' | 'rules' | 'banlist'>('threats');
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Threat | null>(null);

  const threats = THREATS_SEED.filter(t => (filter === 'all' || t.severity === filter) && (!search || JSON.stringify(t).toLowerCase().includes(search.toLowerCase())));

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <KPICard label="Open threats"   value={THREATS_SEED.filter(t => t.status !== 'acked').length} icon="AlertTriangle" tone="danger" trend={{ dir: 'up', value: '2 in 1h' }} />
        <KPICard label="Banned IPs (24h)" value={47} icon="ShieldX" tone="neutral" />
        <KPICard label="Events / min"   value={184} icon="Activity" tone="accent"
          spark={<Sparkline data={Array.from({length: 40}, (_, i) => 180 + Math.sin(i * 0.5) * 25 + (i % 5) * 4)} color="#22d3ee" />} />
        <KPICard label="Detection rate" value={99.2} unit="%" icon="Radar" tone="success" />
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
            <Button variant="secondary" size="sm" icon="FileDown">Export</Button>
          </div>
        )}
      </div>

      {tab === 'threats' && (
        <>
          <Card title="Event timeline" subtitle="Last 24 hours · grouped by hour" action={<Badge variant="info" size="sm" icon="Radar">live</Badge>}>
            <ThreatTimeline />
          </Card>
          <Card title="Detected threats" subtitle={`${threats.length} of ${THREATS_SEED.length} matching`}>
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
                {threats.map(t => (
                  <tr key={t.id} onClick={() => setSelected(t)} className="hover:bg-zinc-900/30 cursor-pointer">
                    <td className="py-3">
                      <div className="flex items-center gap-2">
                        <span className={`w-2 h-2 rounded-full ${SEV_META[t.severity].dot}`} />
                        <span className="text-[10.5px] uppercase tracking-wider text-zinc-400">{t.severity}</span>
                      </div>
                    </td>
                    <td className="py-3">
                      <div className="text-zinc-100">{t.kind}</div>
                      <div className="text-[11px] text-zinc-500 mt-0.5 truncate max-w-[260px]">{t.desc}</div>
                    </td>
                    <td className="py-3">
                      <div className="flex items-center gap-1.5">
                        <code className="font-mono text-cyan-300">{t.src}</code>
                        <span className="text-[10px] font-mono text-zinc-500">{t.country}</span>
                      </div>
                    </td>
                    <td className="py-3 font-mono text-zinc-300">{t.dst}</td>
                    <td className="py-3 text-right font-mono text-zinc-400">{t.count.toLocaleString()}</td>
                    <td className="py-3 font-mono text-zinc-500 text-[11.5px]">{t.first}</td>
                    <td className="py-3 font-mono text-zinc-500 text-[11.5px]">{t.last}</td>
                    <td className="py-3"><Badge variant={STATUS_META[t.status].variant} size="sm">{STATUS_META[t.status].label}</Badge></td>
                  </tr>
                ))}
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
             footer={
               <>
                 <Button variant="ghost" onClick={() => setSelected(null)}>Close</Button>
                 <Button variant="secondary" icon="Eye">Watch list</Button>
                 <Button variant="danger" icon="ShieldX">Permanently ban</Button>
               </>
             }>
        {selected && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <KV k="Source IP"   v={selected.src} mono />
              <KV k="Origin"      v={selected.country} />
              <KV k="Target"      v={selected.dst} mono />
              <KV k="Event count" v={selected.count.toLocaleString()} mono />
              <KV k="First seen"  v={selected.first} mono />
              <KV k="Last seen"   v={selected.last} mono />
              <KV k="Status"      v={STATUS_META[selected.status].label} />
              <KV k="Action"      v={selected.status === 'banned' ? 'fail2ban -A' : 'monitored'} mono />
            </div>
            <div>
              <div className="text-[11px] uppercase tracking-[0.08em] text-zinc-500 mb-2">Description</div>
              <p className="text-[12.5px] text-zinc-300 leading-relaxed">{selected.desc}</p>
            </div>
            <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-400/30 flex gap-2 text-[12px] text-amber-200">
              <Icon name="AlertCircle" size={14} className="text-amber-300 shrink-0 mt-0.5" />
              <div>
                <strong>Recommended action:</strong> {selected.status === 'banned'
                  ? `IP currently banned. Auto-unban in 7 days. Promote to permanent ban?`
                  : 'Add this source to the watch list, or escalate to a permanent ban.'}
              </div>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

function ThreatTimeline() {
  const buckets = useMemo(() => Array.from({ length: 24 }, (_, h) => {
    const seed = (h * 9301 + 49297) % 233280;
    const r = seed / 233280;
    return {
      hour: h,
      critical: h === 14 ? 3 : Math.floor(r * 2),
      high:     h === 13 || h === 14 ? 2 + Math.floor(r * 3) : Math.floor(r * 2),
      medium:   Math.floor(r * 5),
      low:      Math.floor(r * 8) + 2,
    };
  }), []);
  const max = Math.max(...buckets.map(b => b.critical + b.high + b.medium + b.low));
  return (
    <div>
      <div className="flex items-end gap-1 h-32">
        {buckets.map(b => {
          const total = b.critical + b.high + b.medium + b.low;
          return (
            <div key={b.hour} className="flex-1 flex flex-col-reverse gap-px group" title={`${b.hour}:00 — ${total} events`}>
              <div style={{ height: `${(b.low / max) * 100}%`,      background: 'rgba(56,189,248,0.55)' }} />
              <div style={{ height: `${(b.medium / max) * 100}%`,   background: 'rgba(251,191,36,0.7)' }} />
              <div style={{ height: `${(b.high / max) * 100}%`,     background: 'rgba(251,146,60,0.85)' }} />
              <div style={{ height: `${(b.critical / max) * 100}%`, background: '#fb7185' }} />
            </div>
          );
        })}
      </div>
      <div className="flex justify-between mt-2 font-mono text-[10px] text-zinc-500">
        {[0, 4, 8, 12, 16, 20, 24].map(h => <span key={h}>{String(h).padStart(2, '0')}:00</span>)}
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
  const [rules, setRules] = useState([
    { id: 'ssh-bf',     name: 'SSH brute force',           category: 'Authentication', enabled: true,  severity: 'critical', threshold: '6 attempts / 60s', action: 'ban 7d',         hits: 142 },
    { id: 'port-scan',  name: 'TCP/UDP port scan',         category: 'Reconnaissance', enabled: true,  severity: 'high',     threshold: '40 ports / 30s',   action: 'ban 24h',        hits: 1024 },
    { id: 'dns-amp',    name: 'DNS amplification',         category: 'DNS abuse',      enabled: true,  severity: 'high',     threshold: 'ANY queries from non-LAN', action: 'rate-limit', hits: 86 },
    { id: 'http-flood', name: 'HTTP flood',                category: 'DDoS',           enabled: true,  severity: 'high',     threshold: '500 req/s sustained', action: 'rate-limit + ban', hits: 0 },
    { id: 'tor-egress', name: 'Outbound to Tor relay',     category: 'Egress',         enabled: true,  severity: 'medium',   threshold: 'any match',         action: 'alert + flag',   hits: 4 },
    { id: 'new-mac',    name: 'New device on LAN',         category: 'LAN visibility', enabled: true,  severity: 'low',      threshold: 'first DHCP lease',  action: 'notify',          hits: 1 },
  ]);
  return (
    <>
      <Card title="Detection rules" subtitle={`${rules.filter(r => r.enabled).length} of ${rules.length} enabled`}
            action={<Button variant="primary" size="sm" icon="Plus">New rule</Button>}>
        <table className="w-full text-[12.5px]">
          <thead><tr className="text-left text-[10.5px] uppercase tracking-[0.08em] text-zinc-500 border-b border-zinc-800/70">
            <th className="font-medium py-2.5 w-10"></th>
            <th className="font-medium py-2.5">Rule</th>
            <th className="font-medium py-2.5">Category</th>
            <th className="font-medium py-2.5">Severity</th>
            <th className="font-medium py-2.5">Threshold</th>
            <th className="font-medium py-2.5">Action</th>
            <th className="font-medium py-2.5 text-right">Hits (24h)</th>
          </tr></thead>
          <tbody className="divide-y divide-zinc-800/60">
            {rules.map(r => (
              <tr key={r.id} className="hover:bg-zinc-900/30 group">
                <td className="py-3"><ToggleSwitch value={r.enabled} onChange={(v) => setRules(rules.map(x => x.id === r.id ? { ...x, enabled: v } : x))} /></td>
                <td className="py-3 text-zinc-100">{r.name}</td>
                <td className="py-3 text-zinc-400">{r.category}</td>
                <td className="py-3"><Badge variant={SEV_META[r.severity].variant} size="sm">{r.severity}</Badge></td>
                <td className="py-3 font-mono text-zinc-400 text-[11.5px]">{r.threshold}</td>
                <td className="py-3 font-mono text-cyan-300 text-[11.5px]">{r.action}</td>
                <td className="py-3 text-right font-mono text-zinc-400">{r.hits.toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      <Card title="Threat intelligence feeds" subtitle="External IP reputation lists">
        <div className="space-y-2">
          {[
            { name: 'Emerging Threats — compromised IPs', count: '54,221',  updated: '12 min ago', enabled: true },
            { name: 'AbuseIPDB — confidence ≥ 75',        count: '184,442', updated: '38 min ago', enabled: true },
            { name: 'Tor exit node list',                 count: '1,062',   updated: '1 hour ago', enabled: true },
            { name: 'Spamhaus DROP list',                 count: '894',     updated: '4 hours ago',enabled: true },
          ].map(f => (
            <div key={f.name} className="flex items-center gap-3 p-3 rounded-lg bg-zinc-900/40 border border-zinc-800/60">
              <ToggleSwitch value={f.enabled} onChange={() => {}} />
              <div className="flex-1 min-w-0">
                <div className="text-[12.5px] text-zinc-100">{f.name}</div>
                <div className="text-[11px] text-zinc-500 font-mono mt-0.5">{f.count} entries · updated {f.updated}</div>
              </div>
              <IconButton name="RefreshCw" label="Refresh now" size="sm" />
            </div>
          ))}
        </div>
      </Card>
    </>
  );
}

function BanList() {
  const banned = [
    { ip: '185.220.101.42', country: 'RU', reason: 'SSH brute force',    bannedAt: '14:18:02', expires: 'in 6d 22h',  jail: 'sshd',     attempts: 142  },
    { ip: '212.83.40.6',    country: 'FR', reason: 'Port scan',          bannedAt: '13:48:11', expires: 'in 23h 30m', jail: 'recidive', attempts: 1024 },
    { ip: '94.115.66.12',   country: 'UK', reason: 'DNS amplification',  bannedAt: '12:11:33', expires: 'in 11h 04m', jail: 'dns-abuse',attempts: 86   },
  ];
  return (
    <Card title="Block list" subtitle={`${banned.length} active bans · auto-managed by fail2ban + custom rules`}
          action={
            <div className="flex gap-2">
              <Input mono placeholder="Add IP / CIDR…" className="h-8 w-44" />
              <Button variant="primary" size="sm" icon="ShieldX">Add ban</Button>
            </div>
          }>
      <table className="w-full text-[12.5px]">
        <thead><tr className="text-left text-[10.5px] uppercase tracking-[0.08em] text-zinc-500 border-b border-zinc-800/70">
          <th className="font-medium py-2.5">IP</th><th className="font-medium py-2.5">Origin</th>
          <th className="font-medium py-2.5">Reason</th><th className="font-medium py-2.5">Jail</th>
          <th className="font-medium py-2.5 text-right">Attempts</th>
          <th className="font-medium py-2.5">Banned at</th>
          <th className="font-medium py-2.5">Expires</th>
        </tr></thead>
        <tbody className="divide-y divide-zinc-800/60">
          {banned.map(b => (
            <tr key={b.ip} className="hover:bg-zinc-900/30">
              <td className="py-3 font-mono text-rose-300">{b.ip}</td>
              <td className="py-3 font-mono text-zinc-400">{b.country}</td>
              <td className="py-3 text-zinc-300">{b.reason}</td>
              <td className="py-3"><Badge variant="neutral" size="sm">{b.jail}</Badge></td>
              <td className="py-3 text-right font-mono text-zinc-400">{b.attempts.toLocaleString()}</td>
              <td className="py-3 font-mono text-zinc-500">{b.bannedAt}</td>
              <td className="py-3 font-mono text-zinc-500">{b.expires}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}
