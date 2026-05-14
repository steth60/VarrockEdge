import { useEffect, useMemo, useState } from 'react';
import { Card, StatusPill, Button, Icon, KV, Badge, LegendDot, Select } from '../components/primitives';
import { useSSE } from '../api/sse';
import { api } from '../api/client';

interface Snapshot {
  cpu: number;
  ram: number;
  ramTotal: number;
  disk: { used: number; total: number };
  tempC: number | null;
  eth0: { rxMbps: number; txMbps: number };
  eth1: { rxMbps: number; txMbps: number };
  ts: number;
}

interface SystemInfo { hostname: string; kernel: string; uptime: number; version: string; loadAvg: number[]; container: string; }
interface Interfaces { wan: { name: string; ip: string; role: string; rxMbps: number; txMbps: number }; lan: { name: string; ip: string; role: string; rxMbps: number; txMbps: number } }
interface Threat { id: number; severity: string; status: string }
interface WgPeer { id: number; name: string; status: string; kind: string }
interface Bucket { hour: number; critical: number; high: number; medium: number; low: number }
interface Lease { hostname: string; ip: string; mac: string }

export function Overview() {
  const live = useSSE<Snapshot>('/api/metrics/stream');
  const [chartTab, setChartTab] = useState<'throughput' | 'connections' | 'flows'>('throughput');
  const [range, setRange] = useState<'1h' | '1D' | '1W' | '1M'>('1D');
  const [series, setSeries] = useState({ activity: true, latency: true, loss: true });
  const [sysinfo, setSysinfo] = useState<SystemInfo | null>(null);
  const [interfaces, setInterfaces] = useState<Interfaces | null>(null);
  const [threats, setThreats] = useState<Threat[]>([]);
  const [peers, setPeers] = useState<WgPeer[]>([]);
  const [buckets, setBuckets] = useState<Bucket[]>([]);
  const [leasesCount, setLeasesCount] = useState(0);

  useEffect(() => {
    api.get<SystemInfo>('/api/overview/system').then(setSysinfo).catch(() => {});
    api.get<Interfaces>('/api/overview/interfaces').then(setInterfaces).catch(() => {});
    api.get<{ threats: Threat[] }>('/api/security/threats').then(r => setThreats(r.threats)).catch(() => {});
    api.get<{ peers: WgPeer[] }>('/api/wireguard/peers').then(r => setPeers(r.peers)).catch(() => {});
    api.get<{ buckets: Bucket[] }>('/api/security/timeline').then(r => setBuckets(r.buckets)).catch(() => {});
    api.get<{ leases: Lease[] }>('/api/dhcp/leases').then(r => setLeasesCount(r.leases.length)).catch(() => {});
  }, []);

  return (
    <div className="grid grid-cols-12 gap-5">
      <aside className="col-span-12 xl:col-span-3 space-y-4">
        <ApplianceCard sysinfo={sysinfo} peers={peers} threats={threats} leasesCount={leasesCount} />
        <WanCard interfaces={interfaces} live={live} />
        <LatencyPills />
        <SpeedTestCard />
        <PriorityCard />
        <SystemMiniCard live={live} />
      </aside>

      <section className="col-span-12 xl:col-span-9 space-y-4">
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-1 p-1 rounded-lg bg-zinc-900/40 border border-zinc-800/60">
            {[
              { id: 'throughput',  label: 'Internet' },
              { id: 'connections', label: 'Connections' },
              { id: 'flows',       label: 'Flows' },
            ].map(t => (
              <button key={t.id} onClick={() => setChartTab(t.id as any)}
                      className={`px-3 h-7 text-[12px] rounded-md font-medium transition-colors ${chartTab === t.id ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-500 hover:text-zinc-200'}`}>
                {t.label}
              </button>
            ))}
          </div>
          <Select className="h-8 !text-[11.5px] w-40" defaultValue="all">
            <option value="all">All WANs</option>
            <option value="eth0">eth0 — primary</option>
          </Select>
          <div className="ml-auto flex items-center gap-2">
            {([
              { id: 'activity', label: 'Activity', dot: '#22d3ee' },
              { id: 'latency',  label: 'Latency',  dot: '#fbbf24' },
              { id: 'loss',     label: 'Loss',     dot: '#fb7185' },
            ] as const).map(s => {
              const enabled = (series as any)[s.id];
              return (
                <button key={s.id} onClick={() => setSeries(t => ({ ...t, [s.id]: !enabled }))}
                        className={`inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md text-[11px] border transition-colors ${enabled ? 'bg-zinc-900/60 border-zinc-700 text-zinc-200' : 'bg-zinc-900/20 border-zinc-800/50 text-zinc-600'}`}>
                  <span className="w-3 h-3 rounded-sm flex items-center justify-center"
                        style={{ background: enabled ? s.dot : 'transparent', border: enabled ? 'none' : '1px solid #52525b' }}>
                    {enabled && <Icon name="Check" size={9} color="#09090b" strokeWidth={3} />}
                  </span>
                  <span>{s.label}</span>
                </button>
              );
            })}
            <div className="inline-flex rounded-md bg-zinc-900/40 border border-zinc-800/60 p-0.5">
              {(['1h', '1D', '1W', '1M'] as const).map(r => (
                <button key={r} onClick={() => setRange(r)}
                        className={`px-2.5 h-6 text-[11px] rounded-sm font-medium font-mono transition-colors ${range === r ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-500 hover:text-zinc-200'}`}>
                  {r}
                </button>
              ))}
            </div>
          </div>
        </div>

        <Card padding="p-0" className="overflow-hidden">
          <ChartSwitcher tab={chartTab} range={range} series={series} live={live} peers={peers} />
          <div className="px-5 pb-4">
            <AvailabilityStripLive
              label={interfaces?.wan.name ? `${interfaces.wan.name} · WAN` : 'eth0 · WAN'}
              target="wan" colorMap={WAN_COLORS} icon="Globe"
              sub={interfaces?.wan.ip ?? '—'} />
            {peers.slice(0, 2).map(p => (
              <AvailabilityStripLive key={p.id}
                label={p.kind === 'site' ? `wg0 site · ${p.name ?? p.id}` : `wg0 peer · ${p.name ?? p.id}`}
                target={`wg:${p.id}`} colorMap={WG_COLORS} icon="ShieldCheck"
                sub={`status: ${p.status}`} />
            ))}
          </div>
        </Card>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <TopStripLive title="Top LAN clients"   kind="clients" />
          <TopStripLive title="Top services"      kind="services" />
          <TopStripLive title="Top destinations"  kind="destinations" />
        </div>

        <ServiceHealthCard peers={peers} threats={threats} />

        <Card padding="p-0" className="overflow-hidden">
          <div className="px-5 pt-4 pb-3 flex items-start justify-between">
            <div>
              <h3 className="font-display text-[13.5px] font-semibold tracking-tight text-zinc-100">WAN latency (last 60 min)</h3>
              <p className="text-[11.5px] text-zinc-500 mt-0.5">Real ICMP probe to 1.1.1.1 every 30s</p>
            </div>
          </div>
          <LatencyHistoryChart />
        </Card>

        <Card title="Connection quality" subtitle="Real ICMP probes to 1.1.1.1, 8.8.8.8, 9.9.9.9, github.com"
              action={
                <div className="flex items-center gap-2 text-[11px] text-zinc-500">
                  <LegendDot color="#34d399" label="Excellent" />
                  <LegendDot color="#fbbf24" label="Fair" />
                  <LegendDot color="#fb7185" label="Poor" />
                </div>
              }>
          <QualityScatterLive />
        </Card>

        <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
          <Card title="Application breakdown" subtitle="From conntrack · last hour" className="lg:col-span-3" padding="p-5">
            <ApplicationBreakdownLive />
          </Card>
          <Card title="Connection mix" subtitle="Active flows" className="lg:col-span-2" padding="p-5">
            <ConnectionMix peers={peers} />
          </Card>
        </div>
      </section>
    </div>
  );
}

// ─── Left rail cards ─────────────────────────────────────────────
function ApplianceCard({ sysinfo, peers, threats, leasesCount }: { sysinfo: SystemInfo | null; peers: WgPeer[]; threats: Threat[]; leasesCount: number }) {
  return (
    <Card padding="p-4">
      <div className="flex items-start gap-3">
        <ApplianceGlyph />
        <div className="flex-1 min-w-0">
          <div className="font-display text-[14px] font-semibold text-zinc-100 tracking-tight">VarrokEdge — {sysinfo?.hostname?.split('.')[0] ?? 'edge-01'}</div>
          <div className="text-[10.5px] text-zinc-500 font-mono mt-0.5">{sysinfo?.container ?? 'ct-104'} · Proxmox</div>
          <div className="mt-2"><StatusPill status="running" label="online" /></div>
        </div>
      </div>
      <div className="divider mt-3 pt-3 grid grid-cols-2 gap-x-3 gap-y-2 text-[11px]">
        <KV k="Uptime"  v={formatUptime(sysinfo?.uptime ?? 0)} mono />
        <KV k="Gateway" v="10.0.0.1" mono />
        <KV k="OS"      v={`VE ${sysinfo?.version ?? '0.9.2'}`} mono />
        <KV k="Kernel"  v={sysinfo?.kernel ?? '—'} mono />
      </div>
      <div className="mt-3 grid grid-cols-4 gap-1.5">
        <MiniCount icon="ShieldCheck" value={String(peers.filter(p => p.kind === 'site').length)} label="sites" />
        <MiniCount icon="UserPlus"    value={String(peers.length)} label="peers" />
        <MiniCount icon="Plug"        value={String(leasesCount)} label="leases" />
        <MiniCount icon="ShieldAlert" value={String(threats.filter(t => t.status !== 'acked').length)} label="alerts" tone={threats.filter(t => t.status !== 'acked').length > 0 ? 'warn' : undefined} />
      </div>
    </Card>
  );
}

function MiniCount({ icon, value, label, tone }: { icon: string; value: string; label: string; tone?: 'warn' | 'danger' }) {
  const toneClass = tone === 'warn' ? 'text-amber-300 border-amber-400/30 bg-amber-400/5'
                  : tone === 'danger' ? 'text-rose-300 border-rose-400/30 bg-rose-400/5'
                  : 'text-zinc-300 border-zinc-700/60 bg-zinc-900/40';
  return (
    <div className={`rounded-md border px-1.5 py-1.5 flex flex-col items-center ${toneClass}`}>
      <Icon name={icon} size={11} className="opacity-70" />
      <div className="font-mono text-[13px] leading-none mt-1">{value}</div>
      <div className="text-[9.5px] uppercase tracking-wider text-zinc-500 mt-0.5">{label}</div>
    </div>
  );
}

function ApplianceGlyph() {
  return (
    <svg width="56" height="36" viewBox="0 0 56 36" className="shrink-0">
      <defs>
        <linearGradient id="appglow" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#22d3ee" stopOpacity="0.25" />
          <stop offset="100%" stopColor="#22d3ee" stopOpacity="0.05" />
        </linearGradient>
      </defs>
      <rect x="2" y="6" width="52" height="24" rx="3" fill="url(#appglow)" stroke="rgba(34,211,238,0.5)" strokeWidth="1" />
      <line x1="2" y1="13" x2="54" y2="13" stroke="rgba(34,211,238,0.25)" />
      {[8,16,24,32,40].map((x, i) => (
        <rect key={i} x={x} y="17" width="6" height="9" rx="1"
              fill={i < 2 ? 'rgba(52,211,153,0.4)' : 'rgba(82,82,91,0.4)'}
              stroke={i < 2 ? '#34d399' : 'rgba(82,82,91,0.7)'} strokeWidth="0.6" />
      ))}
      <circle cx="50" cy="22" r="2" fill="#34d399">
        <animate attributeName="opacity" values="1;0.3;1" dur="2s" repeatCount="indefinite" />
      </circle>
    </svg>
  );
}

function WanCard({ interfaces, live }: { interfaces: Interfaces | null; live: Snapshot | null }) {
  return (
    <Card padding="p-4">
      <div className="flex items-center gap-3 mb-3">
        <button className="flex items-center gap-1.5 text-[11.5px]">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" style={{ boxShadow: '0 0 6px #34d399' }} />
          <span className="text-zinc-100 font-medium">{interfaces?.wan.name ?? 'eth0'}</span>
        </button>
        <div className="ml-auto text-[10px] text-emerald-300 font-mono">100%</div>
      </div>
      <div className="flex items-center gap-2">
        <div className="w-7 h-7 rounded-md bg-zinc-900/70 border border-zinc-800/70 flex items-center justify-center">
          <Icon name="Cloud" size={14} className="text-cyan-300" />
        </div>
        <div>
          <div className="text-[12.5px] font-medium text-zinc-100">{interfaces?.wan.role ?? 'Public WAN'}</div>
          <div className="text-[10.5px] text-zinc-500 font-mono">{interfaces?.wan.ip ?? '—'}</div>
        </div>
      </div>
      <div className="divider mt-3 pt-3 space-y-1.5">
        <RailRow k="Throughput ↓" v={live ? `${live.eth0.rxMbps.toFixed(1)} Mbps` : '—'} mono color="text-emerald-300" />
        <RailRow k="Throughput ↑" v={live ? `${live.eth0.txMbps.toFixed(1)} Mbps` : '—'} mono color="text-cyan-300" />
        <RailRow k="LAN ↓"        v={live ? `${live.eth1.rxMbps.toFixed(1)} Mbps` : '—'} mono />
        <RailRow k="LAN ↑"        v={live ? `${live.eth1.txMbps.toFixed(1)} Mbps` : '—'} mono />
      </div>
    </Card>
  );
}

function RailRow({ k, v, mono, color }: { k: string; v: string; mono?: boolean; color?: string }) {
  return (
    <div className="flex items-center justify-between text-[11.5px]">
      <span className="text-zinc-500">{k}</span>
      <span className={`${mono ? 'font-mono' : ''} ${color || 'text-zinc-200'}`}>{v}</span>
    </div>
  );
}

interface PingTarget { host: string; label: string; avgMs: number | null; lossPct: number; ok: boolean }

function LatencyPills() {
  const [targets, setTargets] = useState<PingTarget[]>([]);
  useEffect(() => {
    const load = () => api.get<{ targets: PingTarget[] }>('/api/probes/latency').then(r => setTargets(r.targets)).catch(() => {});
    load();
    const t = setInterval(load, 30_000);
    return () => clearInterval(t);
  }, []);
  return (
    <Card padding="p-3">
      <div className="grid grid-cols-2 gap-1.5">
        {targets.length === 0 && Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="flex items-center gap-2 px-2 py-1.5 rounded-md bg-zinc-900/40 border border-zinc-800/60">
            <span className="w-1.5 h-1.5 rounded-full bg-zinc-700" />
            <span className="text-[11px] text-zinc-600 flex-1">probing…</span>
          </div>
        ))}
        {targets.map(t => {
          const ms = t.avgMs ?? 0;
          const dot = !t.ok ? 'bg-rose-400' : ms < 25 ? 'bg-emerald-400' : ms < 60 ? 'bg-amber-400' : 'bg-rose-400';
          return (
            <div key={t.host} className="flex items-center gap-2 px-2 py-1.5 rounded-md bg-zinc-900/40 border border-zinc-800/60" title={t.host}>
              <span className={`w-1.5 h-1.5 rounded-full ${dot}`} />
              <span className="text-[11px] text-zinc-300 flex-1 truncate">{t.label}</span>
              <span className="font-mono text-[11px] text-zinc-100">{t.ok ? `${ms.toFixed(0)}ms` : '—'}</span>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

interface SpeedResult { downloadMbps: number; uploadMbps: number; pingMs: number; isp: string | null; source: string }

function SpeedTestCard() {
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<SpeedResult | null>(null);
  const runTest = async () => {
    setRunning(true);
    try {
      const r = await api.post<SpeedResult>('/api/probes/speedtest');
      setResult(r);
    } catch (err: any) {
      alert(err?.message ?? 'speed test failed');
    } finally {
      setRunning(false);
    }
  };
  const down = result?.downloadMbps ?? 0;
  const up   = result?.uploadMbps ?? 0;
  const png  = result?.pingMs ?? 0;
  return (
    <Card padding="p-4">
      <div className="grid grid-cols-3 gap-2 text-center">
        <div><div className="text-[10px] uppercase tracking-wider text-zinc-500">Down</div><div className="font-mono text-[14px] text-emerald-300 mt-1">{running ? '…' : result ? down.toFixed(1) : '—'}</div><div className="text-[10px] text-zinc-500">Mbps</div></div>
        <div><div className="text-[10px] uppercase tracking-wider text-zinc-500">Up</div><div className="font-mono text-[14px] text-cyan-300 mt-1">{running ? '…' : result ? up.toFixed(1) : '—'}</div><div className="text-[10px] text-zinc-500">Mbps</div></div>
        <div><div className="text-[10px] uppercase tracking-wider text-zinc-500">Ping</div><div className="font-mono text-[14px] text-zinc-100 mt-1">{running ? '…' : result ? png.toFixed(0) : '—'}</div><div className="text-[10px] text-zinc-500">ms</div></div>
      </div>
      <Button variant={running ? 'secondary' : 'primary'} size="md" icon={running ? 'Loader2' : 'Gauge'} className={`w-full mt-3 ${running ? '[&_svg]:animate-spin' : ''}`} onClick={runTest} disabled={running}>
        {running ? 'Testing…' : 'ISP speed test'}
      </Button>
      {result?.source === 'synthetic' && <p className="text-[10px] text-amber-300/80 mt-2 text-center">dev mode — synthetic result</p>}
      {result?.isp && result.source === 'ookla' && <p className="text-[10px] text-zinc-500 mt-2 text-center font-mono">{result.isp}</p>}
    </Card>
  );
}

function PriorityCard() {
  const items = [
    { name: 'VPN tunnels', icon: 'ShieldCheck', active: true },
    { name: 'Video',       icon: 'Video',       active: true },
    { name: 'VoIP',        icon: 'Phone',       active: true },
    { name: 'Gaming',      icon: 'Gamepad2',    active: false },
    { name: 'Backup',      icon: 'HardDrive',   active: false },
  ];
  return (
    <Card padding="p-4">
      <div className="flex items-center justify-between mb-3">
        <div>
          <div className="text-[11.5px] font-medium text-zinc-200">Traffic prioritization</div>
          <div className="text-[10.5px] text-zinc-500 mt-0.5">QoS · DSCP marking</div>
        </div>
        <button className="text-[11px] text-cyan-300 hover:text-cyan-200 inline-flex items-center gap-1">Manage <Icon name="ArrowRight" size={10} /></button>
      </div>
      <div className="grid grid-cols-5 gap-1.5">
        {items.map(i => (
          <div key={i.name} title={i.name}
               className={`aspect-square rounded-md flex items-center justify-center border ${i.active ? 'bg-cyan-400/10 border-cyan-400/30 text-cyan-300' : 'bg-zinc-900/40 border-zinc-800/60 text-zinc-600'}`}>
            <Icon name={i.icon} size={13} />
          </div>
        ))}
      </div>
    </Card>
  );
}

function SystemMiniCard({ live }: { live: Snapshot | null }) {
  const diskUsed  = live?.disk.used ?? 0;
  const diskTotal = live?.disk.total ?? 0;
  const diskPct   = diskTotal > 0 ? (diskUsed / diskTotal) * 100 : 0;
  return (
    <Card padding="p-4">
      <div className="text-[11.5px] font-medium text-zinc-200 mb-3">System</div>
      <div className="space-y-3">
        <SystemBar label="CPU" value={live?.cpu ?? 0} max={100} unit="%" color="#22d3ee" detail="load avg" />
        <SystemBar label="RAM" value={live?.ram ?? 0} max={live?.ramTotal ?? 1024} unit=" MB" color="#a78bfa" detail={live ? `${Math.round((live.ram / (live.ramTotal || 1)) * 100)}% used` : '—'} />
        <SystemBar label="Disk" value={diskPct} max={100} unit="%" color="#34d399" detail={diskTotal > 0 ? `${(diskUsed/1024).toFixed(1)} / ${(diskTotal/1024).toFixed(1)} GB` : '—'} />
        {live?.tempC !== null && live?.tempC !== undefined ? (
          <SystemBar label="Temp" value={live.tempC} max={80} unit="°C" color={live.tempC > 70 ? '#fb7185' : '#fbbf24'} detail={live.tempC > 70 ? 'hot' : 'nominal'} />
        ) : (
          <div>
            <div className="flex items-baseline justify-between mb-1">
              <span className="text-[10.5px] uppercase tracking-wider text-zinc-500">Temp</span>
              <span className="font-mono text-[11.5px] text-zinc-600">—</span>
            </div>
            <div className="h-1.5 rounded-full bg-zinc-800 overflow-hidden">
              <div className="h-full" style={{ width: '0%' }} />
            </div>
            <div className="text-[10px] text-zinc-600 mt-0.5">no thermal_zone0</div>
          </div>
        )}
      </div>
    </Card>
  );
}

function SystemBar({ label, value, max, unit, color, detail }: { label: string; value: number; max: number; unit: string; color: string; detail: string }) {
  const pct = Math.min(100, (value / max) * 100);
  return (
    <div>
      <div className="flex items-baseline justify-between mb-1">
        <span className="text-[10.5px] uppercase tracking-wider text-zinc-500">{label}</span>
        <span className="font-mono text-[11.5px] text-zinc-200">{value.toFixed(value < 10 ? 1 : 0)}{unit}</span>
      </div>
      <div className="h-1.5 rounded-full bg-zinc-800 overflow-hidden">
        <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: color }} />
      </div>
      <div className="text-[10px] text-zinc-600 mt-0.5">{detail}</div>
    </div>
  );
}

// ─── Chart switcher (Internet / Connections / Flows) ─────────────
type ChartTab = 'throughput' | 'connections' | 'flows';
type ChartRange = '1h' | '1D' | '1W' | '1M';
const RANGE_LABELS: Record<ChartRange, string> = { '1h': 'last 1h', '1D': 'last 24h', '1W': 'last 7d', '1M': 'last 30d' };

function ChartSwitcher({ tab, range, series, live, peers }:
  { tab: ChartTab; range: ChartRange; series: { activity: boolean; latency: boolean; loss: boolean }; live: Snapshot | null; peers: WgPeer[] }) {
  if (tab === 'throughput') return <ThroughputChart series={series} live={live} range={range} />;
  if (tab === 'connections') return <ConnectionsChart range={range} peers={peers} />;
  return <FlowsChart range={range} />;
}

// Lengths per range so the chart actually changes width when range changes.
const RANGE_BUCKETS: Record<ChartRange, number> = { '1h': 60, '1D': 96, '1W': 168, '1M': 120 };
const RANGE_XLABELS: Record<ChartRange, string[]> = {
  '1h': ['60m', '45m', '30m', '15m', 'now'],
  '1D': ['24h', '18h', '12h', '6h', 'now'],
  '1W': ['7d',  '5d',  '3d',  '1d', 'now'],
  '1M': ['30d', '21d', '14d', '7d', 'now'],
};

// ─── Throughput chart (live-data driven) ─────────────────────────
function ThroughputChart({ series, live, range }: { series: { activity: boolean; latency: boolean; loss: boolean }; live: Snapshot | null; range: ChartRange }) {
  const [history, setHistory] = useState<number[]>([]);
  const N = RANGE_BUCKETS[range];

  // Sub-sample older buckets when range is wider — quick + dirty: stretch the existing 96-sample buffer.
  useEffect(() => {
    if (!live) return;
    setHistory(h => {
      const next = [...h, live.eth0.rxMbps + live.eth0.txMbps];
      return next.length > 96 ? next.slice(-96) : next;
    });
  }, [live]);

  const data = useMemo(() => {
    return Array.from({ length: N }, (_, i) => {
      // Map bucket i into history index. For wider ranges, repeat the most recent samples.
      const ratio = history.length / N;
      const v = history[Math.floor(i * ratio)] ?? 0;
      const lat = 18 + Math.sin(i * 0.5) * 2 + Math.random() * 2;
      return { activity: v, latency: lat, loss: 0 };
    });
  }, [history, N]);

  const W = 1000, H = 280, PAD_L = 36, PAD_R = 40, PAD_T = 18, PAD_B = 28;
  const plotW = W - PAD_L - PAD_R, plotH = H - PAD_T - PAD_B;
  const maxAct = Math.max(2, ...data.map(d => d.activity)) * 1.05;
  const maxLat = Math.max(...data.map(d => d.latency)) * 1.2;
  const x = (i: number) => PAD_L + (i / Math.max(1, N - 1)) * plotW;
  const yA = (v: number) => PAD_T + plotH - (v / maxAct) * plotH;
  const yL = (v: number) => PAD_T + plotH - (v / maxLat) * plotH;

  const actLine = data.map((d, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${yA(d.activity).toFixed(1)}`).join('');
  const actArea = `${actLine} L${x(N - 1).toFixed(1)},${PAD_T + plotH} L${x(0).toFixed(1)},${PAD_T + plotH} Z`;
  const latLine = data.map((d, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${yL(d.latency).toFixed(1)}`).join('');

  return (
    <div className="p-5">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full block" style={{ height: 280 }}>
        <defs>
          <linearGradient id="actFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#22d3ee" stopOpacity="0.35" />
            <stop offset="100%" stopColor="#22d3ee" stopOpacity="0" />
          </linearGradient>
        </defs>
        {[0.25, 0.5, 0.75, 1].map(p => (
          <line key={p} x1={PAD_L} x2={W - PAD_R} y1={PAD_T + plotH * (1 - p)} y2={PAD_T + plotH * (1 - p)}
                stroke="rgba(63,63,70,0.4)" strokeDasharray="2 4" />
        ))}
        {[0, 0.5, 1].map(p => (
          <text key={p} x={PAD_L - 6} y={PAD_T + plotH * (1 - p) + 3}
                fill="#71717a" fontFamily="JetBrains Mono, monospace" fontSize="9.5" textAnchor="end">
            {(maxAct * p).toFixed(maxAct < 10 ? 1 : 0)}
          </text>
        ))}
        <text x={PAD_L - 6} y={PAD_T - 4} fill="#52525b" fontFamily="JetBrains Mono, monospace" fontSize="9" textAnchor="end">Mbps</text>
        {[0, 0.5, 1].map(p => (
          <text key={p} x={W - PAD_R + 4} y={PAD_T + plotH * (1 - p) + 3}
                fill="#71717a" fontFamily="JetBrains Mono, monospace" fontSize="9.5" textAnchor="start">
            {(maxLat * p).toFixed(0)}
          </text>
        ))}
        <text x={W - PAD_R + 4} y={PAD_T - 4} fill="#52525b" fontFamily="JetBrains Mono, monospace" fontSize="9" textAnchor="start">ms</text>

        {series.activity && (
          <>
            <path d={actArea} fill="url(#actFill)" />
            <path d={actLine} fill="none" stroke="#22d3ee" strokeWidth="1.4" strokeLinejoin="round" />
          </>
        )}
        {series.latency && (
          <path d={latLine} fill="none" stroke="#fbbf24" strokeWidth="1.2" strokeDasharray="3 3" opacity="0.85" />
        )}

        {RANGE_XLABELS[range].map((l, i, arr) => (
          <text key={i} x={PAD_L + (i / (arr.length - 1)) * plotW} y={H - 8}
                fill="#71717a" fontFamily="JetBrains Mono, monospace" fontSize="9.5" textAnchor="middle">{l}</text>
        ))}
      </svg>
    </div>
  );
}

// ─── Connections chart — live count over time ────────────────────
function ConnectionsChart({ range, peers }: { range: ChartRange; peers: WgPeer[] }) {
  // Total active "things" we can count without per-flow conntrack history:
  //   connected WG peers + LAN clients with leases
  const [leases, setLeases] = useState(0);
  const [hist, setHist] = useState<number[]>([]);
  useEffect(() => {
    api.get<{ leases: { mac: string }[] }>('/api/dhcp/leases').then(r => setLeases(r.leases.length)).catch(() => {});
    const t = setInterval(() => {
      api.get<{ leases: { mac: string }[] }>('/api/dhcp/leases').then(r => setLeases(r.leases.length)).catch(() => {});
    }, 30_000);
    return () => clearInterval(t);
  }, []);
  const current = peers.filter(p => p.status === 'connected').length + leases;
  useEffect(() => {
    setHist(h => {
      const next = [...h, current];
      return next.length > 96 ? next.slice(-96) : next;
    });
  }, [current]);

  const N = RANGE_BUCKETS[range];
  const data = Array.from({ length: N }, (_, i) => {
    const ratio = hist.length / N;
    return hist[Math.floor(i * ratio)] ?? 0;
  });
  return <SimpleLineChart data={data} unit="conn" color="#22d3ee" range={range} title="Total active connections (WG peers + LAN clients)" />;
}

// ─── Flows chart — bytes/sec from app sampler ────────────────────
function FlowsChart({ range }: { range: ChartRange }) {
  const [apps, setApps] = useState<Array<{ name: string; down: number; up: number }>>([]);
  const [hist, setHist] = useState<number[]>([]);
  useEffect(() => {
    const load = () => api.get<{ apps: typeof apps }>('/api/flows/apps?window=1h').then(r => setApps(r.apps)).catch(() => {});
    load();
    const t = setInterval(load, 30_000);
    return () => clearInterval(t);
  }, []);
  const total = apps.reduce((a, x) => a + x.down + x.up, 0);
  useEffect(() => {
    setHist(h => {
      const next = [...h, total];
      return next.length > 96 ? next.slice(-96) : next;
    });
  }, [total]);

  const N = RANGE_BUCKETS[range];
  const data = Array.from({ length: N }, (_, i) => {
    const ratio = hist.length / N;
    return hist[Math.floor(i * ratio)] ?? 0;
  });
  return <SimpleLineChart data={data} unit="bytes" color="#a78bfa" range={range} title="Total bytes / interval (from conntrack sampler)" />;
}

// Generic line chart used by Connections + Flows.
function SimpleLineChart({ data, unit, color, range, title }: { data: number[]; unit: string; color: string; range: ChartRange; title: string }) {
  const W = 1000, H = 280, PAD_L = 36, PAD_R = 16, PAD_T = 18, PAD_B = 28;
  const plotW = W - PAD_L - PAD_R, plotH = H - PAD_T - PAD_B;
  const max = Math.max(1, ...data) * 1.1;
  const x = (i: number) => PAD_L + (i / Math.max(1, data.length - 1)) * plotW;
  const y = (v: number) => PAD_T + plotH - (v / max) * plotH;
  const line = data.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('');
  const area = `${line} L${x(data.length - 1).toFixed(1)},${PAD_T + plotH} L${x(0).toFixed(1)},${PAD_T + plotH} Z`;
  const gradId = `g-${unit}`;
  return (
    <div className="p-5">
      <div className="text-[11.5px] text-zinc-500 mb-1">{title} · {RANGE_LABELS[range]}</div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full block" style={{ height: 280 }}>
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.35" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        {[0.25, 0.5, 0.75, 1].map(p => (
          <line key={p} x1={PAD_L} x2={W - PAD_R} y1={PAD_T + plotH * (1 - p)} y2={PAD_T + plotH * (1 - p)}
                stroke="rgba(63,63,70,0.4)" strokeDasharray="2 4" />
        ))}
        {[0, 0.5, 1].map(p => (
          <text key={p} x={PAD_L - 6} y={PAD_T + plotH * (1 - p) + 3}
                fill="#71717a" fontFamily="JetBrains Mono, monospace" fontSize="9.5" textAnchor="end">
            {unit === 'bytes' ? humanBytes(max * p) : (max * p).toFixed(0)}
          </text>
        ))}
        <text x={PAD_L - 6} y={PAD_T - 4} fill="#52525b" fontFamily="JetBrains Mono, monospace" fontSize="9" textAnchor="end">{unit}</text>
        <path d={area} fill={`url(#${gradId})`} />
        <path d={line} fill="none" stroke={color} strokeWidth="1.4" />
        {RANGE_XLABELS[range].map((l, i, arr) => (
          <text key={l} x={PAD_L + (i / (arr.length - 1)) * plotW} y={H - 8}
                fill="#71717a" fontFamily="JetBrains Mono, monospace" fontSize="9.5" textAnchor="middle">{l}</text>
        ))}
      </svg>
    </div>
  );
}

// ─── Availability strips ─────────────────────────────────────────
const WAN_COLORS: Record<string, string> = { up: '#34d399', degraded: '#fbbf24', down: '#fb7185', unknown: 'rgba(63,63,70,0.4)' };
const WG_COLORS:  Record<string, string> = { up: '#22d3ee', degraded: '#fbbf24', down: '#fb7185', unknown: 'rgba(63,63,70,0.4)' };

function AvailabilityStripLive({ label, sub, icon, colorMap, target }: { label: string; sub: string; icon: string; colorMap: Record<string, string>; target: string }) {
  const [buckets, setBuckets] = useState<Array<{ bucket: number; status: string }>>([]);
  useEffect(() => {
    const load = () => api.get<{ buckets: typeof buckets }>(`/api/metrics/availability?target=${encodeURIComponent(target)}`).then(r => setBuckets(r.buckets)).catch(() => {});
    load();
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
  }, [target]);
  return (
    <div className="flex items-center gap-3 mt-3">
      <Icon name={icon} size={14} className="text-zinc-400 shrink-0" />
      <div className="w-44 shrink-0">
        <div className="text-[11.5px] text-zinc-200 truncate">{label}</div>
        <div className="text-[10px] text-zinc-500 font-mono truncate">{sub}</div>
      </div>
      <div className="flex-1 h-3 flex gap-[1px]">
        {buckets.length === 0
          ? Array.from({ length: 96 }).map((_, i) => <div key={i} className="flex-1 rounded-[1px] bg-zinc-800/40" />)
          : buckets.map((b, i) => (
              <div key={b.bucket} className="flex-1 rounded-[1px]"
                style={{ background: colorMap[b.status] ?? colorMap.unknown }}
                title={`${new Date(b.bucket * 15 * 60_000).toLocaleTimeString()} · ${b.status}`} />
            ))}
      </div>
      <Icon name="ChevronRight" size={12} className="text-zinc-600 shrink-0" />
    </div>
  );
}

// ─── Top strips (mock — would benefit from real conntrack scraping) ─
const TOP_CLIENTS = [
  { name: 'ws-callum',     sub: '10.0.0.74',  glyph: 'Monitor',      tone: '#22d3ee', traffic: '4.2 GB' },
  { name: 'nas-truenas',   sub: '10.0.0.61',  glyph: 'HardDrive',    tone: '#a78bfa', traffic: '12.1 GB' },
  { name: 'runner-01',     sub: '10.0.0.10',  glyph: 'Cpu',          tone: '#34d399', traffic: '2.8 GB' },
  { name: 'gh-runner-02',  sub: '10.0.0.118', glyph: 'Cpu',          tone: '#34d399', traffic: '1.4 GB' },
  { name: 'pi-monitor',    sub: '10.0.0.82',  glyph: 'Tv',           tone: '#fbbf24', traffic: '880 MB' },
  { name: 'uap-lite',      sub: '10.0.0.110', glyph: 'Wifi',         tone: '#22d3ee', traffic: '420 MB' },
];
const TOP_SERVICES = [
  { name: 'HTTPS', sub: ':443', glyph: 'Lock',  tone: '#34d399', traffic: '30.5 GB' },
  { name: 'DNS',   sub: ':53',  glyph: 'Globe2',tone: '#a78bfa', traffic: '4.72 GB' },
  { name: 'SSH',   sub: ':22',  glyph: 'Terminal', tone: '#22d3ee', traffic: '512 MB' },
  { name: 'WireGuard', sub: ':51820', glyph: 'ShieldCheck', tone: '#22d3ee', traffic: '8.4 GB' },
  { name: 'MC',    sub: ':25565', glyph: 'Gamepad2', tone: '#fb7185', traffic: '1.2 GB' },
  { name: 'IMAP',  sub: ':993', glyph: 'Mail',  tone: '#fbbf24', traffic: '380 MB' },
];
const TOP_DESTINATIONS = [
  { name: 'UK',  sub: 'home',        glyph: 'Flag',   tone: '#22d3ee', traffic: '34.1 GB' },
  { name: 'US',  sub: 'aws',         glyph: 'Server', tone: '#a78bfa', traffic: '12.6 GB' },
  { name: 'IE',  sub: 'cloudflare',  glyph: 'Cloud',  tone: '#34d399', traffic: '6.4 GB' },
  { name: 'DE',  sub: 'hetzner',     glyph: 'Server', tone: '#fbbf24', traffic: '2.1 GB' },
  { name: 'FR',  sub: 'github',      glyph: 'Github', tone: '#22d3ee', traffic: '1.8 GB' },
  { name: 'NL',  sub: 'docker',      glyph: 'Boxes',  tone: '#a78bfa', traffic: '920 MB' },
];

interface FlowItem { key: string; label: string; hint: string; bytes: number; packets: number }

function humanBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  const u = ['KB', 'MB', 'GB', 'TB'];
  let v = n / 1024, i = 0;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(v < 10 ? 1 : 0)} ${u[i]}`;
}

const KIND_GLYPH: Record<string, { glyph: string; tone: string }> = {
  clients:      { glyph: 'MonitorSmartphone', tone: '#22d3ee' },
  services:     { glyph: 'Server',             tone: '#34d399' },
  destinations: { glyph: 'Globe',              tone: '#a78bfa' },
};

function TopStripLive({ title, kind }: { title: string; kind: 'clients' | 'services' | 'destinations' }) {
  const [items, setItems] = useState<FlowItem[]>([]);
  useEffect(() => {
    const load = () => api.get<{ items: FlowItem[] }>(`/api/flows/top?kind=${kind}&window=1h`).then(r => setItems(r.items)).catch(() => {});
    load();
    const t = setInterval(load, 30_000);
    return () => clearInterval(t);
  }, [kind]);
  const meta = KIND_GLYPH[kind]!;
  return (
    <Card title={title} subtitle="Last hour" padding="p-0">
      <div className="px-2 pb-2 pt-0">
        {items.length === 0 ? (
          <div className="text-[10.5px] text-zinc-500 text-center py-3">no data</div>
        ) : (
          <ul className="divide-y divide-zinc-800/40">
            {items.slice(0, 5).map((e, i) => (
              <li key={e.key} className="flex items-center gap-2 px-1.5 py-1.5 rounded-md hover:bg-zinc-900/40 transition-colors" title={e.hint}>
                <span className="w-5 h-5 rounded shrink-0 flex items-center justify-center"
                      style={{ background: `linear-gradient(135deg, ${meta.tone}22, ${meta.tone}08)`, border: `1px solid ${meta.tone}33` }}>
                  <Icon name={meta.glyph} size={11} color={meta.tone} />
                </span>
                <span className="text-zinc-600 font-mono text-[9.5px] w-3 text-right">{i + 1}</span>
                <span className="text-[11px] text-zinc-200 truncate flex-1 min-w-0">{e.label}</span>
                <span className="text-[10px] text-zinc-500 font-mono shrink-0">{humanBytes(e.bytes)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}

function TopStrip({ title, entries }: { title: string; entries: typeof TOP_CLIENTS }) {
  return (
    <Card title={title} subtitle="Last hour · by volume" padding="p-0"
          action={<button className="text-[11px] text-cyan-300 hover:text-cyan-200 inline-flex items-center gap-1 pr-1">All <Icon name="ArrowRight" size={10} /></button>}>
      <div className="px-2 pb-3 pt-1">
        <div className="grid grid-cols-3 gap-1">
          {entries.slice(0, 6).map((e, i) => (
            <button key={i} className="group flex flex-col items-center gap-1 rounded-md hover:bg-zinc-900/50 p-2 transition-colors">
              <div className="w-9 h-9 rounded-lg border border-zinc-800/70 flex items-center justify-center"
                   style={{ background: `linear-gradient(135deg, ${e.tone}22, ${e.tone}08)` }}>
                <Icon name={e.glyph} size={14} color={e.tone} />
              </div>
              <div className="text-[10.5px] font-medium text-zinc-200 truncate max-w-[80px]">{e.name}</div>
              <div className="text-[9.5px] text-zinc-500 font-mono truncate max-w-[80px]">{e.traffic}</div>
            </button>
          ))}
        </div>
      </div>
    </Card>
  );
}

function ServiceHealthCard({ peers, threats }: { peers: WgPeer[]; threats: Threat[] }) {
  const wgConnected = peers.length === 0 ? 100 : (peers.filter(p => p.status === 'connected').length / peers.length) * 100;
  const critOpen    = threats.filter(t => t.severity === 'critical' && t.status !== 'acked').length;
  return (
    <Card title="Service health" subtitle="Live signals from real subsystems"
          action={<Badge variant={critOpen === 0 ? 'success' : 'warn'} size="sm" icon={critOpen === 0 ? 'CheckCircle2' : 'AlertTriangle'}>{critOpen === 0 ? 'nominal' : `${critOpen} critical`}</Badge>}>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <HealthBar label="WG handshake"   success={wgConnected} count={peers.length === 0 ? 'no peers' : `${peers.filter(p => p.status === 'connected').length}/${peers.length} up`} />
        <HealthBar label="Critical threats" success={Math.max(0, 100 - critOpen * 10)} count={`${critOpen} open`} tone={critOpen > 0 ? 'danger' : undefined} />
        <HealthBarUnknown label="DHCP ACK rate" detail="needs dnsmasq journal scrape" />
        <HealthBarUnknown label="DNS SERVFAIL" detail="needs dnsmasq --log-queries" />
        <HealthBarUnknown label="NAT translate" detail="needs conntrack -S sampling" />
        <HealthBarUnknown label="TLS handshake" detail="no upstream proxy detected" />
        <HealthBarUnknown label="DoH/DoT" detail="not wired" />
        <HealthBarUnknown label="Auth (web UI)" detail="needs auth.login.fail/success" />
      </div>
    </Card>
  );
}

function HealthBarUnknown({ label, detail }: { label: string; detail: string }) {
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <span className="text-[11.5px] text-zinc-300 font-medium">{label}</span>
        <span className="font-mono text-[11px] text-zinc-600">—</span>
      </div>
      <div className="flex gap-[2px] mt-1.5">
        {Array.from({ length: 24 }).map((_, i) => (
          <span key={i} className="flex-1 h-3.5 rounded-[1px] bg-zinc-800/40" />
        ))}
      </div>
      <div className="text-[10.5px] text-zinc-600 mt-1.5">{detail}</div>
    </div>
  );
}

function LatencyHistoryChart() {
  const [buckets, setBuckets] = useState<Array<{ minute: number; avgMs: number | null; lossPct: number | null }>>([]);
  useEffect(() => {
    const load = () => api.get<{ buckets: typeof buckets }>('/api/metrics/history').then(r => setBuckets(r.buckets)).catch(() => {});
    load();
    const t = setInterval(load, 30_000);
    return () => clearInterval(t);
  }, []);
  const W = 1000, H = 140, PAD_L = 32, PAD_R = 16, PAD_T = 10, PAD_B = 18;
  const plotW = W - PAD_L - PAD_R, plotH = H - PAD_T - PAD_B;
  const vals = buckets.map(b => b.avgMs ?? 0);
  const maxLat = Math.max(50, ...vals) * 1.2;
  const x = (i: number) => PAD_L + (i / Math.max(1, buckets.length - 1)) * plotW;
  const y = (v: number) => PAD_T + plotH - (v / maxLat) * plotH;
  const line = buckets.map((b, i) => b.avgMs !== null ? `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(b.avgMs).toFixed(1)}` : '').filter(Boolean).join('');
  return (
    <div className="px-5 pb-4">
      {buckets.every(b => b.avgMs === null) ? (
        <div className="text-[12px] text-zinc-500 text-center py-6">collecting samples (one every 30s)…</div>
      ) : (
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full block" style={{ height: H }}>
          {[0, 0.5, 1].map(p => (
            <line key={p} x1={PAD_L} x2={W - PAD_R} y1={PAD_T + plotH * (1 - p)} y2={PAD_T + plotH * (1 - p)} stroke="rgba(63,63,70,0.4)" strokeDasharray="2 4" />
          ))}
          {[0, 0.5, 1].map(p => (
            <text key={p} x={PAD_L - 6} y={PAD_T + plotH * (1 - p) + 3}
                  fill="#71717a" fontFamily="JetBrains Mono, monospace" fontSize="9.5" textAnchor="end">
              {(maxLat * p).toFixed(0)}
            </text>
          ))}
          <text x={PAD_L - 6} y={PAD_T - 2} fill="#52525b" fontFamily="JetBrains Mono, monospace" fontSize="9" textAnchor="end">ms</text>
          {/* Loss bars */}
          {buckets.map((b, i) => b.lossPct && b.lossPct > 0 ? (
            <rect key={i} x={x(i) - 2} y={PAD_T + plotH - (Math.min(b.lossPct, 100) / 100) * plotH} width="4" height={(Math.min(b.lossPct, 100) / 100) * plotH} fill="#fb7185" opacity="0.5" />
          ) : null)}
          <path d={line} fill="none" stroke="#22d3ee" strokeWidth="1.5" />
          {['60m', '45m', '30m', '15m', 'now'].map((l, i, arr) => (
            <text key={l} x={PAD_L + (i / (arr.length - 1)) * plotW} y={H - 4}
                  fill="#71717a" fontFamily="JetBrains Mono, monospace" fontSize="9.5" textAnchor="middle">{l}</text>
          ))}
        </svg>
      )}
    </div>
  );
}

function HealthBar({ label, success, count, tone }: { label: string; success: number; count: string; tone?: 'warn' | 'danger' }) {
  const SEGMENTS = 24;
  const filled = Math.round((success / 100) * SEGMENTS);
  const color = tone === 'warn' ? '#fbbf24' : tone === 'danger' ? '#fb7185' : '#34d399';
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <span className="text-[11.5px] text-zinc-200 font-medium">{label}</span>
        <span className={`font-mono text-[11px] ${tone === 'warn' ? 'text-amber-300' : tone === 'danger' ? 'text-rose-300' : 'text-emerald-300'}`}>{success.toFixed(1)}%</span>
      </div>
      <div className="flex gap-[2px] mt-1.5">
        {Array.from({ length: SEGMENTS }).map((_, i) => (
          <span key={i} className="flex-1 h-3.5 rounded-[1px]"
                style={{ background: i < filled ? color : 'rgba(63,63,70,0.35)' }} />
        ))}
      </div>
      <div className="text-[10.5px] text-zinc-500 mt-1.5">{count}</div>
    </div>
  );
}

function QualityScatterLive() {
  const [targets, setTargets] = useState<Array<{ host: string; label: string; avgMs: number | null; lossPct: number; ok: boolean }>>([]);
  const [peers, setPeers] = useState<Array<{ id: number; name: string; status: string; handshake: string; kind: string }>>([]);
  useEffect(() => {
    const load = () => {
      api.get<{ targets: typeof targets }>('/api/probes/latency').then(r => setTargets(r.targets)).catch(() => {});
      api.get<{ peers: typeof peers }>('/api/wireguard/peers').then(r => setPeers(r.peers)).catch(() => {});
    };
    load();
    const t = setInterval(load, 30_000);
    return () => clearInterval(t);
  }, []);
  const points: Array<{ id: string; lat: number; loss: number; color: string; size: number }> = [];
  for (const t of targets) {
    if (!t.ok) continue;
    const lat = t.avgMs ?? 0;
    const color = lat < 30 && t.lossPct < 1 ? '#34d399' : lat < 80 && t.lossPct < 2 ? '#fbbf24' : '#fb7185';
    points.push({ id: t.label, lat, loss: t.lossPct, color, size: 8 });
  }
  // WG peers — color by status (no per-peer latency yet, place at 0 loss / placeholder lat)
  for (const p of peers) {
    if (p.status === 'offline') continue;
    points.push({ id: p.name, lat: p.status === 'connected' ? 25 : 70, loss: 0, color: p.status === 'connected' ? '#22d3ee' : '#fbbf24', size: 6 });
  }
  return <QualityScatterRaw points={points} />;
}

function QualityScatterRaw({ points }: { points: Array<{ id: string; lat: number; loss: number; color: string; size: number }> }) {
  const W = 1000, H = 200, PAD = 36;
  const maxLat = 150, maxLoss = 5;
  const x = (lat: number) => PAD + (lat / maxLat) * (W - PAD * 2);
  const y = (loss: number) => H - PAD - (loss / maxLoss) * (H - PAD * 2);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full block" style={{ height: 200 }}>
      <rect x={PAD} y={PAD} width={x(40) - PAD} height={y(0.5) - PAD} fill="#34d39911" />
      <rect x={x(40)} y={PAD} width={x(80) - x(40)} height={y(1.5) - PAD} fill="#fbbf2411" />
      <rect x={x(80)} y={PAD} width={W - PAD - x(80)} height={H - PAD * 2} fill="#fb718511" />
      {[0, 25, 50, 75, 100, 125, 150].map(v => (
        <g key={v}>
          <line x1={x(v)} y1={PAD} x2={x(v)} y2={H - PAD} stroke="rgba(63,63,70,0.25)" />
          <text x={x(v)} y={H - PAD + 14} textAnchor="middle" fill="#71717a" fontFamily="JetBrains Mono, monospace" fontSize="9">{v}</text>
        </g>
      ))}
      {[0, 1, 2, 3, 4, 5].map(v => (
        <g key={v}>
          <line x1={PAD} y1={y(v)} x2={W - PAD} y2={y(v)} stroke="rgba(63,63,70,0.25)" />
          <text x={PAD - 6} y={y(v) + 3} textAnchor="end" fill="#71717a" fontFamily="JetBrains Mono, monospace" fontSize="9">{v}%</text>
        </g>
      ))}
      <text x={W / 2} y={H - 4} textAnchor="middle" fill="#52525b" fontFamily="JetBrains Mono, monospace" fontSize="9.5">latency · ms</text>
      {points.map(p => (
        <g key={p.id}>
          <circle cx={x(p.lat)} cy={y(p.loss)} r={p.size + 4} fill={p.color} opacity="0.15" />
          <circle cx={x(p.lat)} cy={y(p.loss)} r={p.size} fill={p.color} opacity="0.9" />
          <text x={x(p.lat) + p.size + 4} y={y(p.loss) + 3} fill="#d4d4d8" fontFamily="JetBrains Mono, monospace" fontSize="10">{p.id}</text>
        </g>
      ))}
    </svg>
  );
}

const APP_DATA = [
  { name: 'SSL/TLS', down: 30.5, up: 2.42, color: '#22d3ee' },
  { name: 'YouTube', down: 4.72, up: 0.07, color: '#fb7185' },
  { name: 'Discord', down: 0.50, up: 1.14, color: '#a78bfa' },
  { name: 'iTunes',  down: 1.21, up: 0.04, color: '#fbbf24' },
  { name: 'Google',  down: 2.81, up: 0.11, color: '#60a5fa' },
  { name: 'Apple',   down: 1.04, up: 0.32, color: '#94a3b8' },
];

interface AppRow { name: string; down: number; up: number }

const APP_COLORS = ['#22d3ee', '#a78bfa', '#34d399', '#fbbf24', '#fb7185', '#60a5fa', '#94a3b8', '#38bdf8'];

function ApplicationBreakdownLive() {
  const [rows, setRows] = useState<AppRow[]>([]);
  useEffect(() => {
    const load = () => api.get<{ apps: AppRow[] }>('/api/flows/apps?window=1h').then(r => setRows(r.apps)).catch(() => {});
    load();
    const t = setInterval(load, 30_000);
    return () => clearInterval(t);
  }, []);
  const data = rows.map((r, i) => ({ ...r, color: APP_COLORS[i % APP_COLORS.length]! }));
  if (data.length === 0) {
    return <div className="text-[12px] text-zinc-500 text-center py-8">no application data yet — sampler is collecting</div>;
  }
  const total = data.reduce((a, d) => a + d.down + d.up, 0);
  let acc = 0;
  const r = 50, cx = 64, cy = 64, stroke = 14, C = 2 * Math.PI * r;
  const downBytes = data.reduce((a, d) => a + d.down, 0);
  return (
    <div className="flex items-center gap-6">
      <div className="relative shrink-0" style={{ width: 128, height: 128 }}>
        <svg viewBox="0 0 128 128" width="128" height="128" className="-rotate-90">
          <circle cx={cx} cy={cy} r={r} fill="none" stroke="rgba(63,63,70,0.4)" strokeWidth={stroke} />
          {data.map(d => {
            const frac = (d.down + d.up) / total;
            const dash = frac * C;
            const offset = -acc * C;
            acc += frac;
            return <circle key={d.name} cx={cx} cy={cy} r={r} fill="none" stroke={d.color} strokeWidth={stroke} strokeDasharray={`${dash} ${C - dash}`} strokeDashoffset={offset} />;
          })}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <div className="font-display text-[20px] font-semibold text-zinc-100 leading-none">{humanBytes(total)}</div>
          <div className="text-[10px] uppercase tracking-wider text-zinc-500 mt-1">total · 1h</div>
        </div>
      </div>
      <div className="flex-1 min-w-0">
        <table className="w-full text-[11.5px]">
          <thead>
            <tr className="text-zinc-500">
              <th className="text-left font-medium pb-2">Application</th>
              <th className="text-right font-medium pb-2 font-mono">Down</th>
              <th className="text-right font-medium pb-2 font-mono">Up</th>
              <th className="text-right font-medium pb-2 font-mono">Total</th>
            </tr>
          </thead>
          <tbody>
            {data.slice(0, 6).map(d => (
              <tr key={d.name} className="border-t border-zinc-800/40">
                <td className="py-1.5"><div className="flex items-center gap-2"><span className="w-2 h-2 rounded-sm" style={{ background: d.color }} /><span className="text-zinc-200">{d.name}</span></div></td>
                <td className="py-1.5 text-right font-mono text-emerald-300">{humanBytes(d.down)}</td>
                <td className="py-1.5 text-right font-mono text-cyan-300">{humanBytes(d.up)}</td>
                <td className="py-1.5 text-right font-mono text-zinc-300">{humanBytes(d.down + d.up)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ApplicationBreakdown() {
  const total = APP_DATA.reduce((a, d) => a + d.down + d.up, 0);
  let acc = 0;
  const r = 50, cx = 64, cy = 64, stroke = 14, C = 2 * Math.PI * r;
  return (
    <div className="flex items-center gap-6">
      <div className="relative shrink-0" style={{ width: 128, height: 128 }}>
        <svg viewBox="0 0 128 128" width="128" height="128" className="-rotate-90">
          <circle cx={cx} cy={cy} r={r} fill="none" stroke="rgba(63,63,70,0.4)" strokeWidth={stroke} />
          {APP_DATA.map(d => {
            const frac = (d.down + d.up) / total;
            const dash = frac * C;
            const offset = -acc * C;
            acc += frac;
            return <circle key={d.name} cx={cx} cy={cy} r={r} fill="none" stroke={d.color} strokeWidth={stroke} strokeDasharray={`${dash} ${C - dash}`} strokeDashoffset={offset} />;
          })}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <div className="font-display text-[20px] font-semibold text-zinc-100 leading-none">{total.toFixed(1)}</div>
          <div className="text-[10px] uppercase tracking-wider text-zinc-500 mt-1">GB · 1h</div>
        </div>
      </div>
      <div className="flex-1 min-w-0">
        <table className="w-full text-[11.5px]">
          <thead>
            <tr className="text-zinc-500">
              <th className="text-left font-medium pb-2">Application</th>
              <th className="text-right font-medium pb-2 font-mono">Down</th>
              <th className="text-right font-medium pb-2 font-mono">Up</th>
              <th className="text-right font-medium pb-2 font-mono">Total</th>
            </tr>
          </thead>
          <tbody>
            {APP_DATA.map(d => (
              <tr key={d.name} className="border-t border-zinc-800/40">
                <td className="py-1.5"><div className="flex items-center gap-2"><span className="w-2 h-2 rounded-sm" style={{ background: d.color }} /><span className="text-zinc-200">{d.name}</span></div></td>
                <td className="py-1.5 text-right font-mono text-emerald-300">{d.down.toFixed(2)} GB</td>
                <td className="py-1.5 text-right font-mono text-cyan-300">{d.up.toFixed(2)} GB</td>
                <td className="py-1.5 text-right font-mono text-zinc-300">{(d.down + d.up).toFixed(2)} GB</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ConnectionMix({ peers }: { peers: WgPeer[] }) {
  const types = [
    { kind: 'LAN',            count: 0,                                                       exp: 'Excellent', color: '#22d3ee' },
    { kind: 'WireGuard',      count: peers.filter(p => p.kind === 'road-warrior').length,    exp: 'Excellent', color: '#a78bfa' },
    { kind: 'Site-to-site',   count: peers.filter(p => p.kind === 'site').length,            exp: 'Excellent', color: '#34d399' },
    { kind: 'Public ingress', count: 0,                                                       exp: 'Good',      color: '#fbbf24' },
  ];
  const total = Math.max(1, types.reduce((a, t) => a + t.count, 0));
  let acc = 0;
  const r = 44, cx = 56, cy = 56, stroke = 12, C = 2 * Math.PI * r;
  return (
    <div className="flex items-center gap-5">
      <div className="relative shrink-0" style={{ width: 112, height: 112 }}>
        <svg viewBox="0 0 112 112" width="112" height="112" className="-rotate-90">
          <circle cx={cx} cy={cy} r={r} fill="none" stroke="rgba(63,63,70,0.4)" strokeWidth={stroke} />
          {types.map(t => {
            const frac = t.count / total;
            const dash = frac * C;
            const offset = -acc * C;
            acc += frac;
            return <circle key={t.kind} cx={cx} cy={cy} r={r} fill="none" stroke={t.color} strokeWidth={stroke} strokeDasharray={`${dash} ${C - dash}`} strokeDashoffset={offset} />;
          })}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <div className="font-display text-[22px] font-semibold text-zinc-100 leading-none">{types.reduce((a, t) => a + t.count, 0)}</div>
          <div className="text-[9.5px] uppercase tracking-wider text-zinc-500 mt-1">flows</div>
        </div>
      </div>
      <div className="flex-1 space-y-1.5">
        {types.map(t => (
          <div key={t.kind} className="flex items-center text-[11.5px]">
            <span className="w-2 h-2 rounded-sm mr-2 shrink-0" style={{ background: t.color }} />
            <span className="text-zinc-200 flex-1">{t.kind}</span>
            <span className="font-mono text-zinc-500 mr-3">{t.count}</span>
            <span className={`text-[10.5px] ${t.exp === 'Excellent' ? 'text-emerald-300' : 'text-amber-300'}`}>{t.exp}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function formatUptime(secs: number): string {
  if (!secs) return '—';
  const d = Math.floor(secs / 86400);
  const h = Math.floor((secs % 86400) / 3600);
  const m = Math.floor((secs % 3600) / 60);
  return `${d}d ${h}h ${m}m`;
}
