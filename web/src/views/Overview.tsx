import { useEffect, useMemo, useRef, useState } from 'react';
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
interface Interfaces {
  wan: { name: string; ip: string | null; role: string; rxMbps: number; txMbps: number; publicIp?: string | null };
  lan: { name: string; ip: string;        role: string; rxMbps: number; txMbps: number };
}
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
        <SpeedTestCard />
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
  // Keep a 60-sample rolling history of total WAN bps for the sparkline (~84s @ 1.4s SSE tick).
  const [hist, setHist] = useState<number[]>([]);
  useEffect(() => {
    if (!live) return;
    setHist(h => {
      const next = [...h, live.eth0.rxMbps + live.eth0.txMbps];
      return next.length > 60 ? next.slice(-60) : next;
    });
  }, [live]);

  const totalDl = live?.eth0.rxMbps ?? 0;
  const totalUl = live?.eth0.txMbps ?? 0;
  const fmtRate = (mbps: number) => mbps < 1 ? `${(mbps * 1000).toFixed(0)} Kbps` : `${mbps.toFixed(1)} Mbps`;

  return (
    <Card padding="p-4">
      <div className="flex items-center gap-3 mb-2">
        <div className="w-8 h-8 rounded-md bg-zinc-900/70 border border-zinc-800/70 flex items-center justify-center">
          <Icon name="Cloud" size={15} className="text-cyan-300" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[12.5px] font-medium text-zinc-100 truncate">{interfaces?.wan.role ?? 'WAN'}</div>
          <div className="text-[10.5px] text-zinc-500 font-mono truncate">{interfaces?.wan.name ?? 'eth0'}</div>
        </div>
        <span className="text-[10.5px] text-emerald-300 font-mono">100%</span>
      </div>

      <div className="space-y-1 text-[11.5px]">
        <div className="flex items-center justify-between">
          <span className="text-zinc-500">Public IP</span>
          <span className="font-mono text-cyan-300">{interfaces?.wan.publicIp ?? '…'}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-zinc-500">Local IP</span>
          <span className="font-mono text-zinc-300">{interfaces?.wan.ip ?? '—'}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-zinc-500">Throughput</span>
          <span className="font-mono">
            <span className="text-emerald-300">↓ {fmtRate(totalDl)}</span>
            <span className="text-zinc-700 mx-1.5">·</span>
            <span className="text-cyan-300">↑ {fmtRate(totalUl)}</span>
          </span>
        </div>
      </div>

      {/* Throughput sparkline */}
      <div className="mt-2 -mx-1">
        <WanSparkline data={hist} />
      </div>

      {/* Latency pills (auto-coloured by RTT to Cloudflare/Google/Quad9) */}
      <div className="mt-2"><LatencyTriple /></div>
    </Card>
  );
}

function WanSparkline({ data }: { data: number[] }) {
  if (data.length === 0) {
    return <div className="h-10 rounded-md bg-zinc-900/30 border border-zinc-800/40" />;
  }
  const W = 240, H = 40, PAD = 2;
  const max = Math.max(0.05, ...data) * 1.1;
  const x = (i: number) => PAD + (i / Math.max(1, data.length - 1)) * (W - PAD * 2);
  const y = (v: number) => H - PAD - (v / max) * (H - PAD * 2);
  const line = data.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('');
  const area = `${line} L${x(data.length - 1).toFixed(1)},${H - PAD} L${x(0).toFixed(1)},${H - PAD} Z`;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full block" style={{ height: 40 }} preserveAspectRatio="none">
      <defs>
        <linearGradient id="wanSpark" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#22d3ee" stopOpacity="0.45" />
          <stop offset="100%" stopColor="#22d3ee" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill="url(#wanSpark)" />
      <path d={line} fill="none" stroke="#22d3ee" strokeWidth="1.3" />
    </svg>
  );
}

interface PingTargetLite { host: string; label: string; avgMs: number | null; lossPct: number; ok: boolean }
const SHORT_PILLS: Array<{ host: string; provider: 'cloudflare' | 'google' | 'quad9'; label: string }> = [
  { host: '1.1.1.1', provider: 'cloudflare', label: 'Cloudflare DNS' },
  { host: '8.8.8.8', provider: 'google',     label: 'Google DNS' },
  { host: '9.9.9.9', provider: 'quad9',      label: 'Quad9 DNS' },
];

function ProviderMark({ provider }: { provider: 'cloudflare' | 'google' | 'quad9' }) {
  // Inline marks rendered geometrically — no external image deps, no copyright
  // issue. Each is recognisable enough to identify the provider in the pill.
  if (provider === 'cloudflare') {
    // Cloud silhouette in Cloudflare orange.
    return (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-label="Cloudflare">
        <path
          d="M19.4 14.1c.4-1.4-.3-2.7-1.7-3a4 4 0 0 0-1-.1l-.1-.4a4.7 4.7 0 0 0-9.2-.5 3.6 3.6 0 0 0-3.1 5.6c.3.4.7.7 1.1.9.1 0 .2 0 .2.2l9 0c2.4 0 4.5-1 4.8-2.7Z"
          fill="#f48120"
        />
        <path d="M20.5 11.4c0-.1 0-.2-.1-.2-.7.1-1.4.4-1.9.9-.1.1-.1.2 0 .3.6.8.8 1.8.6 2.7-.1.4-.3.8-.6 1.1-.1.1-.1.2 0 .2l.8.4c1.3.4 2.7-.4 3-1.7.2-1.4-.5-2.8-1.8-3.7Z" fill="#faae40" />
      </svg>
    );
  }
  if (provider === 'google') {
    // The four-colour G dot ring.
    return (
      <svg width="14" height="14" viewBox="0 0 24 24" aria-label="Google">
        <path d="M21.6 12.2c0-.7-.1-1.3-.2-1.9H12v3.7h5.4c-.2 1.2-.9 2.3-1.9 3v2.4h3.1c1.8-1.7 2.9-4.2 2.9-7.2Z" fill="#4285f4" />
        <path d="M12 22c2.6 0 4.7-.9 6.3-2.3l-3.1-2.4c-.9.6-2 .9-3.2.9-2.5 0-4.6-1.6-5.3-3.9H3.5v2.5C5.1 19.7 8.3 22 12 22Z" fill="#34a853" />
        <path d="M6.7 14.3a6 6 0 0 1 0-3.8V8H3.5a10 10 0 0 0 0 8l3.2-1.7Z" fill="#fbbc04" />
        <path d="M12 6.4c1.4 0 2.7.5 3.7 1.4l2.8-2.8C16.7 3.4 14.6 2.5 12 2.5 8.3 2.5 5.1 4.8 3.5 8l3.2 2.5c.7-2.3 2.8-3.9 5.3-3.9Z" fill="#ea4335" />
      </svg>
    );
  }
  // Quad9 — a teal segmented ring with a "9".
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" aria-label="Quad9">
      <circle cx="12" cy="12" r="9" fill="none" stroke="#3b82f6" strokeWidth="2.5" strokeDasharray="3 1.8" />
      <text x="12" y="16" textAnchor="middle" fontFamily="Space Grotesk, sans-serif" fontWeight="700" fontSize="11" fill="#3b82f6">9</text>
    </svg>
  );
}

function LatencyTriple() {
  const [targets, setTargets] = useState<PingTargetLite[]>([]);
  useEffect(() => {
    const load = () => api.get<{ targets: PingTargetLite[] }>('/api/probes/latency').then(r => setTargets(r.targets)).catch(() => {});
    load();
    const t = setInterval(load, 30_000);
    return () => clearInterval(t);
  }, []);
  const wanted = SHORT_PILLS.map(p => ({ ...p, target: targets.find(t => t.host === p.host) }));
  return (
    <div className="grid grid-cols-3 gap-1.5">
      {wanted.map(({ host, provider, label, target }) => {
        const ms = target?.avgMs ?? null;
        const ok = target?.ok ?? false;
        const tone =
          !ok || ms === null    ? 'border-zinc-800/60 bg-zinc-900/40 text-zinc-500'
          : ms < 30             ? 'border-emerald-400/30 bg-emerald-400/5 text-emerald-300'
          : ms < 100            ? 'border-amber-400/30 bg-amber-400/5 text-amber-300'
          :                       'border-rose-400/30 bg-rose-400/5 text-rose-300';
        return (
          <div
            key={host}
            className={`flex items-center justify-center gap-1.5 h-7 rounded-md border ${tone}`}
            title={`${label} (${host}) avg ${ms?.toFixed(0) ?? '—'}ms`}
          >
            <ProviderMark provider={provider} />
            <span className="font-mono text-[11px]">{ms !== null && ok ? `${ms.toFixed(0)}ms` : '—'}</span>
          </div>
        );
      })}
    </div>
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

interface SpeedResult { downloadMbps: number; uploadMbps: number; pingMs: number; isp: string | null; server: string | null; source: string }
interface SpeedEvent { phase: 'ping' | 'download' | 'upload' | 'done' | 'error'; mbps?: number; pingMs?: number; elapsed?: number; result?: SpeedResult }

function SpeedTestCard() {
  const [phase, setPhase] = useState<'idle' | 'ping' | 'download' | 'upload' | 'done' | 'error'>('idle');
  const [downSamples, setDownSamples] = useState<number[]>([]);
  const [upSamples, setUpSamples] = useState<number[]>([]);
  const [livePing, setLivePing] = useState<number | null>(null);
  const [result, setResult] = useState<SpeedResult | null>(null);
  const [progress, setProgress] = useState(0); // 0..1 within current phase
  const esRef = useRef<EventSource | null>(null);

  const start = () => {
    if (phase !== 'idle' && phase !== 'done' && phase !== 'error') return;
    setDownSamples([]);
    setUpSamples([]);
    setLivePing(null);
    setResult(null);
    setPhase('ping');
    setProgress(0);
    const es = new EventSource('/api/probes/speedtest/stream', { withCredentials: true });
    esRef.current = es;
    es.onmessage = (m) => {
      try {
        const ev: SpeedEvent = JSON.parse(m.data);
        if (ev.phase === 'ping') {
          setPhase('ping');
          if (ev.pingMs !== undefined) setLivePing(ev.pingMs);
          if (ev.elapsed !== undefined) setProgress(ev.elapsed);
        } else if (ev.phase === 'download') {
          setPhase('download');
          if (ev.mbps !== undefined) setDownSamples(s => [...s, ev.mbps!]);
          if (ev.elapsed !== undefined) setProgress(ev.elapsed);
        } else if (ev.phase === 'upload') {
          setPhase('upload');
          if (ev.mbps !== undefined) setUpSamples(s => [...s, ev.mbps!]);
          if (ev.elapsed !== undefined) setProgress(ev.elapsed);
        } else if (ev.phase === 'done' && ev.result) {
          setPhase('done');
          setResult(ev.result);
          setProgress(1);
          es.close();
        } else if (ev.phase === 'error') {
          setPhase('error');
          es.close();
        }
      } catch { /* ignore */ }
    };
    es.onerror = () => {
      // EventSource closes on network error or non-200; surface as error
      // unless we've already received the `done` event.
      setPhase(p => (p === 'done' ? p : 'error'));
      es.close();
    };
  };

  useEffect(() => () => { esRef.current?.close(); }, []);

  if (phase === 'idle') {
    return (
      <Card padding="p-4">
        <div className="grid grid-cols-3 gap-2 text-center">
          {(['Down', 'Up', 'Ping'] as const).map(l => (
            <div key={l}>
              <div className="text-[10px] uppercase tracking-wider text-zinc-500">{l}</div>
              <div className="font-mono text-[14px] text-zinc-600 mt-1">—</div>
              <div className="text-[10px] text-zinc-500">{l === 'Ping' ? 'ms' : 'Mbps'}</div>
            </div>
          ))}
        </div>
        <Button variant="primary" size="md" icon="Gauge" className="w-full mt-3" onClick={start}>ISP speed test</Button>
      </Card>
    );
  }

  if (phase === 'done' && result) {
    return (
      <Card padding="p-4">
        <div className="grid grid-cols-3 gap-2 text-center">
          <div>
            <div className="text-[10px] uppercase tracking-wider text-zinc-500">Down</div>
            <div className="font-mono text-[16px] text-emerald-300 mt-1">{result.downloadMbps.toFixed(1)}</div>
            <div className="text-[10px] text-zinc-500">Mbps avg</div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wider text-zinc-500">Up</div>
            <div className="font-mono text-[16px] text-cyan-300 mt-1">{result.uploadMbps.toFixed(1)}</div>
            <div className="text-[10px] text-zinc-500">Mbps avg</div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-wider text-zinc-500">Ping</div>
            <div className="font-mono text-[16px] text-zinc-100 mt-1">{result.pingMs.toFixed(0)}</div>
            <div className="text-[10px] text-zinc-500">ms</div>
          </div>
        </div>
        {(downSamples.length > 0 || upSamples.length > 0) && (
          <div className="mt-3"><SpeedTestGraph down={downSamples} up={upSamples} /></div>
        )}
        <div className="flex items-center justify-between gap-2 mt-3">
          {result.source === 'synthetic'
            ? <span className="text-[10px] text-amber-300/80">dev mode — synthetic</span>
            : result.isp ? <span className="text-[10px] text-zinc-500 font-mono truncate">{result.isp}</span> : <span />}
          <Button variant="ghost" size="sm" icon="RotateCw" onClick={start}>Run again</Button>
        </div>
      </Card>
    );
  }

  // Running (ping / download / upload) or error
  const showDown = phase === 'download' || downSamples.length > 0;
  const showUp   = phase === 'upload'   || upSamples.length > 0;
  const lastDown = downSamples[downSamples.length - 1] ?? 0;
  const lastUp   = upSamples[upSamples.length - 1] ?? 0;
  return (
    <Card padding="p-4">
      <div className="grid grid-cols-3 gap-2 text-center">
        <div>
          <div className="text-[10px] uppercase tracking-wider text-zinc-500">Down</div>
          <div className="font-mono text-[14px] text-emerald-300 mt-1">{showDown ? lastDown.toFixed(1) : '…'}</div>
          <div className="text-[10px] text-zinc-500">Mbps</div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wider text-zinc-500">Up</div>
          <div className="font-mono text-[14px] text-cyan-300 mt-1">{showUp ? lastUp.toFixed(1) : '…'}</div>
          <div className="text-[10px] text-zinc-500">Mbps</div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wider text-zinc-500">Ping</div>
          <div className="font-mono text-[14px] text-zinc-100 mt-1">{livePing !== null ? livePing.toFixed(0) : '…'}</div>
          <div className="text-[10px] text-zinc-500">ms</div>
        </div>
      </div>

      <div className="mt-3"><SpeedTestGraph down={downSamples} up={upSamples} /></div>

      <div className="mt-2 space-y-1">
        <div className="flex items-center justify-between text-[10px] text-zinc-500">
          <span>{phase === 'ping' ? 'Latency probe' : phase === 'download' ? 'Download · ~30s' : phase === 'upload' ? 'Upload · ~30s' : 'Error'}</span>
          <span className="font-mono">{Math.round(progress * 100)}%</span>
        </div>
        <div className="h-1 rounded-full bg-zinc-800 overflow-hidden">
          <div className="h-full rounded-full transition-all"
               style={{ width: `${Math.max(2, progress * 100)}%`, background: phase === 'upload' ? '#22d3ee' : '#34d399' }} />
        </div>
      </div>
    </Card>
  );
}

function SpeedTestGraph({ down, up }: { down: number[]; up: number[] }) {
  // 120 buckets total: first 60 for download, second 60 for upload.
  // We map samples linearly into their half so the curve grows over time.
  const N = 120;
  const map = (xs: number[], side: 'down' | 'up'): Array<{ v: number; side: 'down' | 'up' }> => {
    if (xs.length === 0) return [];
    return Array.from({ length: 60 }, (_, i) => {
      const idx = Math.floor((i / 60) * xs.length);
      return { v: xs[idx] ?? 0, side };
    });
  };
  const downPts = map(down, 'down');
  const upPts   = map(up,   'up');
  const series: Array<{ v: number; side: 'down' | 'up' } | null> = [
    ...downPts,
    ...Array.from({ length: 60 - downPts.length }, () => null),
    ...upPts,
    ...Array.from({ length: 60 - upPts.length },   () => null),
  ].slice(0, N);

  const W = 360, H = 110, PAD_L = 24, PAD_R = 8, PAD_T = 8, PAD_B = 18;
  const plotW = W - PAD_L - PAD_R, plotH = H - PAD_T - PAD_B;
  const allValues = series.filter(s => s !== null).map(s => (s as any).v);
  const max = Math.max(1, ...allValues) * 1.1;
  const x = (i: number) => PAD_L + (i / (N - 1)) * plotW;
  const y = (v: number) => PAD_T + plotH - (v / max) * plotH;
  const midX = PAD_L + (60 / (N - 1)) * plotW;

  // Build separate path strings per side so they get separate colors.
  const buildPath = (side: 'down' | 'up') => {
    let started = false;
    const cmds: string[] = [];
    series.forEach((s, i) => {
      if (s && s.side === side) {
        cmds.push(`${started ? 'L' : 'M'}${x(i).toFixed(1)},${y(s.v).toFixed(1)}`);
        started = true;
      } else {
        started = false;
      }
    });
    return cmds.join('');
  };
  const buildArea = (side: 'down' | 'up') => {
    let started = false;
    let startI = 0;
    let endI = 0;
    const cmds: string[] = [];
    series.forEach((s, i) => {
      if (s && s.side === side) {
        if (!started) startI = i;
        cmds.push(`${started ? 'L' : 'M'}${x(i).toFixed(1)},${y(s.v).toFixed(1)}`);
        endI = i;
        started = true;
      } else if (started) {
        cmds.push(`L${x(endI).toFixed(1)},${PAD_T + plotH} L${x(startI).toFixed(1)},${PAD_T + plotH} Z`);
        started = false;
      }
    });
    if (started) cmds.push(`L${x(endI).toFixed(1)},${PAD_T + plotH} L${x(startI).toFixed(1)},${PAD_T + plotH} Z`);
    return cmds.join(' ');
  };

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full block" style={{ height: 110 }}>
      <defs>
        <linearGradient id="stDown" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#34d399" stopOpacity="0.4" />
          <stop offset="100%" stopColor="#34d399" stopOpacity="0" />
        </linearGradient>
        <linearGradient id="stUp" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#22d3ee" stopOpacity="0.4" />
          <stop offset="100%" stopColor="#22d3ee" stopOpacity="0" />
        </linearGradient>
      </defs>
      {/* mid-divider */}
      <line x1={midX} y1={PAD_T} x2={midX} y2={H - PAD_B} stroke="rgba(63,63,70,0.55)" strokeDasharray="3 3" />
      <text x={midX} y={H - 4} textAnchor="middle" fill="#52525b" fontFamily="JetBrains Mono, monospace" fontSize="9">30s</text>
      <text x={PAD_L} y={H - 4} textAnchor="start" fill="#52525b" fontFamily="JetBrains Mono, monospace" fontSize="9">DL</text>
      <text x={W - PAD_R} y={H - 4} textAnchor="end" fill="#52525b" fontFamily="JetBrains Mono, monospace" fontSize="9">UL</text>
      {/* y-axis ticks */}
      {[0.5, 1].map(p => (
        <text key={p} x={PAD_L - 4} y={PAD_T + plotH * (1 - p) + 3} textAnchor="end" fill="#52525b" fontFamily="JetBrains Mono, monospace" fontSize="9">
          {(max * p).toFixed(max < 10 ? 1 : 0)}
        </text>
      ))}
      <text x={PAD_L - 4} y={PAD_T - 1} textAnchor="end" fill="#52525b" fontFamily="JetBrains Mono, monospace" fontSize="9">Mbps</text>
      {/* areas */}
      <path d={buildArea('down')} fill="url(#stDown)" />
      <path d={buildArea('up')}   fill="url(#stUp)" />
      {/* lines */}
      <path d={buildPath('down')} fill="none" stroke="#34d399" strokeWidth="1.4" />
      <path d={buildPath('up')}   fill="none" stroke="#22d3ee" strokeWidth="1.4" />
    </svg>
  );
}

// PriorityCard removed: QoS / DSCP marking was never wired to iptables
// mangle rules or tc, the toggles were decorative, and the "Manage" link
// went nowhere. If/when real QoS plumbing lands, this returns.

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
  const [latencyHist, setLatencyHist] = useState<Array<{ minute: number; avgMs: number | null; lossPct: number | null }>>([]);
  const N = RANGE_BUCKETS[range];

  useEffect(() => {
    if (!live) return;
    setHistory(h => {
      const next = [...h, live.eth0.rxMbps + live.eth0.txMbps];
      return next.length > 96 ? next.slice(-96) : next;
    });
  }, [live]);

  // Pull real latency/loss history (60 most-recent minutes) so the secondary
  // series is honest data — not synthetic noise.
  useEffect(() => {
    const load = () => api.get<{ buckets: typeof latencyHist }>('/api/metrics/history').then(r => setLatencyHist(r.buckets)).catch(() => {});
    load();
    const t = setInterval(load, 30_000);
    return () => clearInterval(t);
  }, []);

  const data = useMemo(() => {
    return Array.from({ length: N }, (_, i) => {
      // Activity: stretch the in-memory ring buffer into the requested window.
      const aRatio = history.length / N;
      const activity = history[Math.floor(i * aRatio)] ?? 0;
      // Latency: same stretch over real history.
      const lRatio = latencyHist.length / N;
      const lat = latencyHist[Math.floor(i * lRatio)]?.avgMs ?? null;
      const loss = latencyHist[Math.floor(i * lRatio)]?.lossPct ?? null;
      return { activity, latency: lat, loss };
    });
  }, [history, latencyHist, N]);

  const hasAnyActivity = history.some(v => v > 0.001);
  const hasAnyLatency  = latencyHist.some(b => b.avgMs !== null);

  // Use a tall viewBox; viewer scales it to whatever the parent's width is.
  // 16:5 ratio gives a chart that comfortably fills modern wide cards.
  const W = 1000, H = 320, PAD_L = 40, PAD_R = 44, PAD_T = 22, PAD_B = 30;
  const plotW = W - PAD_L - PAD_R, plotH = H - PAD_T - PAD_B;
  const maxAct = Math.max(0.5, ...data.map(d => d.activity)) * 1.1;
  const maxLat = Math.max(1, ...data.map(d => d.latency ?? 0)) * 1.2;
  const x = (i: number) => PAD_L + (i / Math.max(1, N - 1)) * plotW;
  const yA = (v: number) => PAD_T + plotH - (v / maxAct) * plotH;
  const yL = (v: number) => PAD_T + plotH - (v / maxLat) * plotH;

  const actLine = data.map((d, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${yA(d.activity).toFixed(1)}`).join('');
  const actArea = `${actLine} L${x(N - 1).toFixed(1)},${PAD_T + plotH} L${x(0).toFixed(1)},${PAD_T + plotH} Z`;
  // For the latency line skip null gaps so we don't draw straight to zero.
  const latSegments: string[] = [];
  let cur = '';
  data.forEach((d, i) => {
    if (d.latency !== null) {
      cur += `${cur ? 'L' : 'M'}${x(i).toFixed(1)},${yL(d.latency).toFixed(1)}`;
    } else if (cur) {
      latSegments.push(cur);
      cur = '';
    }
  });
  if (cur) latSegments.push(cur);

  // Hover-tooltip state. Bucket index under the cursor + screen coords.
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const [hover, setHover] = useState<{ idx: number; sx: number; sy: number } | null>(null);

  const onMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const svg = e.currentTarget;
    const rect = svg.getBoundingClientRect();
    if (rect.width === 0) return;
    // Translate cursor x → bucket index based on visible plot area.
    const plotPxL = (PAD_L / W) * rect.width;
    const plotPxW = (plotW / W) * rect.width;
    const rel = (e.clientX - rect.left - plotPxL) / plotPxW;
    const idx = Math.round(rel * (N - 1));
    if (idx < 0 || idx >= N) { setHover(null); return; }
    setHover({ idx, sx: e.clientX, sy: e.clientY });
  };

  const cursorX = hover ? x(hover.idx) : 0;
  const cursorBucket = hover ? data[hover.idx] : null;

  // Range bucket → time-ago string.
  const ago = (idx: number) => {
    const minutesPerBucket = range === '1h' ? 1 : range === '1D' ? 15 : range === '1W' ? 60 : 360;
    const m = Math.round((N - 1 - idx) * minutesPerBucket);
    if (m === 0) return 'now';
    if (m < 60)  return `${m}m ago`;
    if (m < 1440) return `${(m / 60).toFixed(1)}h ago`;
    return `${(m / 1440).toFixed(1)}d ago`;
  };

  return (
    <div className="p-5 h-full flex flex-col" ref={wrapperRef}>
      <div className="relative flex-1 min-h-[260px]">
        <svg
          viewBox={`0 0 ${W} ${H}`} className="absolute inset-0 w-full h-full block" preserveAspectRatio="none"
          onMouseMove={onMove}
          onMouseLeave={() => setHover(null)}
        >
          <defs>
            <linearGradient id="actFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#22d3ee" stopOpacity="0.35" />
              <stop offset="100%" stopColor="#22d3ee" stopOpacity="0" />
            </linearGradient>
          </defs>
          {[0.25, 0.5, 0.75, 1].map(p => (
            <line key={p} x1={PAD_L} x2={W - PAD_R} y1={PAD_T + plotH * (1 - p)} y2={PAD_T + plotH * (1 - p)}
                  stroke="rgba(63,63,70,0.4)" strokeDasharray="2 4" vectorEffect="non-scaling-stroke" />
          ))}
          {hasAnyActivity && (
            <>
              {[0, 0.5, 1].map(p => (
                <text key={p} x={PAD_L - 6} y={PAD_T + plotH * (1 - p) + 4}
                      fill="#71717a" fontFamily="JetBrains Mono, monospace" fontSize="11" textAnchor="end">
                  {(maxAct * p).toFixed(maxAct < 10 ? 1 : 0)}
                </text>
              ))}
              <text x={PAD_L - 6} y={PAD_T - 6} fill="#52525b" fontFamily="JetBrains Mono, monospace" fontSize="10" textAnchor="end">Mbps</text>
            </>
          )}
          {hasAnyLatency && (
            <>
              {[0, 0.5, 1].map(p => (
                <text key={p} x={W - PAD_R + 6} y={PAD_T + plotH * (1 - p) + 4}
                      fill="#71717a" fontFamily="JetBrains Mono, monospace" fontSize="11" textAnchor="start">
                  {(maxLat * p).toFixed(0)}
                </text>
              ))}
              <text x={W - PAD_R + 6} y={PAD_T - 6} fill="#52525b" fontFamily="JetBrains Mono, monospace" fontSize="10" textAnchor="start">ms</text>
            </>
          )}

          {series.activity && hasAnyActivity && (
            <>
              <path d={actArea} fill="url(#actFill)" vectorEffect="non-scaling-stroke" />
              <path d={actLine} fill="none" stroke="#22d3ee" strokeWidth="1.6" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
            </>
          )}
          {series.latency && hasAnyLatency && latSegments.map((d, i) => (
            <path key={i} d={d} fill="none" stroke="#fbbf24" strokeWidth="1.2" strokeDasharray="3 3" opacity="0.85" vectorEffect="non-scaling-stroke" />
          ))}
          {series.loss && hasAnyLatency && data.map((d, i) => (d.loss && d.loss > 0.1)
            ? <rect key={i} x={x(i) - 3} y={PAD_T + plotH - Math.min(d.loss, 5) / 5 * plotH} width="6" height={Math.min(d.loss, 5) / 5 * plotH} fill="#fb7185" opacity="0.55" />
            : null)}

          {RANGE_XLABELS[range].map((l, i, arr) => (
            <text key={i} x={PAD_L + (i / (arr.length - 1)) * plotW} y={H - 10}
                  fill="#71717a" fontFamily="JetBrains Mono, monospace" fontSize="11" textAnchor="middle">{l}</text>
          ))}

          {/* Hover cursor — vertical line + highlight dots */}
          {hover && cursorBucket && (
            <>
              <line x1={cursorX} y1={PAD_T} x2={cursorX} y2={PAD_T + plotH}
                    stroke="rgba(212,212,216,0.4)" strokeDasharray="2 2" vectorEffect="non-scaling-stroke" />
              {hasAnyActivity && series.activity && (
                <circle cx={cursorX} cy={yA(cursorBucket.activity)} r="3.5" fill="#22d3ee" stroke="#09090b" strokeWidth="1.2" vectorEffect="non-scaling-stroke" />
              )}
              {hasAnyLatency && series.latency && cursorBucket.latency !== null && (
                <circle cx={cursorX} cy={yL(cursorBucket.latency)} r="3.5" fill="#fbbf24" stroke="#09090b" strokeWidth="1.2" vectorEffect="non-scaling-stroke" />
              )}
            </>
          )}
        </svg>

        {!hasAnyActivity && !hasAnyLatency && (
          <div className="absolute inset-0 flex items-center justify-center text-[12px] text-zinc-500 font-mono">
            no throughput / latency samples yet
          </div>
        )}

        {/* Tooltip — positioned at the cursor in screen coordinates so it doesn't get squashed by preserveAspectRatio="none" */}
        {hover && cursorBucket && wrapperRef.current && (() => {
          const rect = wrapperRef.current.getBoundingClientRect();
          const offset = 14;
          // Flip the tooltip to the left if it would overflow the card on the right.
          const flipLeft = hover.sx + 180 + offset > rect.right;
          const left = flipLeft ? hover.sx - rect.left - 180 - offset : hover.sx - rect.left + offset;
          const top  = Math.max(8, Math.min(hover.sy - rect.top - 30, rect.height - 80));
          return (
            <div
              className="absolute pointer-events-none z-10 px-3 py-2 rounded-md glass-strong shadow-2xl text-[11px] whitespace-nowrap"
              style={{ left, top, width: 180 }}
            >
              <div className="text-zinc-500 font-mono mb-1">{ago(hover.idx)}</div>
              {hasAnyActivity && (
                <div className="flex items-center justify-between gap-3">
                  <span className="inline-flex items-center gap-1.5 text-zinc-300"><span className="w-2 h-2 rounded-sm bg-cyan-400" />Activity</span>
                  <span className="font-mono text-zinc-100">{cursorBucket.activity.toFixed(2)} Mbps</span>
                </div>
              )}
              {hasAnyLatency && cursorBucket.latency !== null && (
                <div className="flex items-center justify-between gap-3 mt-1">
                  <span className="inline-flex items-center gap-1.5 text-zinc-300"><span className="w-2 h-2 rounded-sm bg-amber-400" />Latency</span>
                  <span className="font-mono text-zinc-100">{cursorBucket.latency.toFixed(0)} ms</span>
                </div>
              )}
              {hasAnyLatency && cursorBucket.loss !== null && cursorBucket.loss > 0 && (
                <div className="flex items-center justify-between gap-3 mt-1">
                  <span className="inline-flex items-center gap-1.5 text-zinc-300"><span className="w-2 h-2 rounded-sm bg-rose-400" />Loss</span>
                  <span className="font-mono text-rose-300">{cursorBucket.loss.toFixed(1)} %</span>
                </div>
              )}
            </div>
          );
        })()}
      </div>
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
  const W = 1000, H = 320, PAD_L = 40, PAD_R = 16, PAD_T = 22, PAD_B = 30;
  const plotW = W - PAD_L - PAD_R, plotH = H - PAD_T - PAD_B;
  const max = Math.max(1, ...data) * 1.1;
  const x = (i: number) => PAD_L + (i / Math.max(1, data.length - 1)) * plotW;
  const y = (v: number) => PAD_T + plotH - (v / max) * plotH;
  const line = data.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('');
  const area = `${line} L${x(data.length - 1).toFixed(1)},${PAD_T + plotH} L${x(0).toFixed(1)},${PAD_T + plotH} Z`;
  const gradId = `g-${unit}`;
  const hasAny = data.some(v => v > 0);
  return (
    <div className="p-5 h-full flex flex-col">
      <div className="text-[11.5px] text-zinc-500 mb-1">{title} · {RANGE_LABELS[range]}</div>
      <div className="relative flex-1 min-h-[260px]">
        <svg viewBox={`0 0 ${W} ${H}`} className="absolute inset-0 w-full h-full block" preserveAspectRatio="none">
          <defs>
            <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity="0.35" />
              <stop offset="100%" stopColor={color} stopOpacity="0" />
            </linearGradient>
          </defs>
          {[0.25, 0.5, 0.75, 1].map(p => (
            <line key={p} x1={PAD_L} x2={W - PAD_R} y1={PAD_T + plotH * (1 - p)} y2={PAD_T + plotH * (1 - p)}
                  stroke="rgba(63,63,70,0.4)" strokeDasharray="2 4" vectorEffect="non-scaling-stroke" />
          ))}
          {hasAny && [0, 0.5, 1].map(p => (
            <text key={p} x={PAD_L - 6} y={PAD_T + plotH * (1 - p) + 4}
                  fill="#71717a" fontFamily="JetBrains Mono, monospace" fontSize="11" textAnchor="end">
              {unit === 'bytes' ? humanBytes(max * p) : (max * p).toFixed(0)}
            </text>
          ))}
          {hasAny && <text x={PAD_L - 6} y={PAD_T - 6} fill="#52525b" fontFamily="JetBrains Mono, monospace" fontSize="10" textAnchor="end">{unit}</text>}
          {hasAny && (
            <>
              <path d={area} fill={`url(#${gradId})`} />
              <path d={line} fill="none" stroke={color} strokeWidth="1.6" vectorEffect="non-scaling-stroke" />
            </>
          )}
          {RANGE_XLABELS[range].map((l, i, arr) => (
            <text key={l} x={PAD_L + (i / (arr.length - 1)) * plotW} y={H - 10}
                  fill="#71717a" fontFamily="JetBrains Mono, monospace" fontSize="11" textAnchor="middle">{l}</text>
          ))}
        </svg>
        {!hasAny && (
          <div className="absolute inset-0 flex items-center justify-center text-[12px] text-zinc-500 font-mono">no data yet</div>
        )}
      </div>
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
  const W = 1000, H = 180, PAD_L = 38, PAD_R = 18, PAD_T = 12, PAD_B = 24;
  const plotW = W - PAD_L - PAD_R, plotH = H - PAD_T - PAD_B;
  const vals = buckets.map(b => b.avgMs ?? 0);
  const maxLat = Math.max(50, ...vals) * 1.2;
  const x = (i: number) => PAD_L + (i / Math.max(1, buckets.length - 1)) * plotW;
  const y = (v: number) => PAD_T + plotH - (v / maxLat) * plotH;
  const line = buckets.map((b, i) => b.avgMs !== null ? `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(b.avgMs).toFixed(1)}` : '').filter(Boolean).join('');
  const area = line ? `${line} L${x(buckets.length - 1).toFixed(1)},${PAD_T + plotH} L${x(0).toFixed(1)},${PAD_T + plotH} Z` : '';
  const noData = buckets.length === 0 || buckets.every(b => b.avgMs === null);
  return (
    <div className="px-5 pb-4">
      <div className="relative" style={{ height: 180 }}>
        {noData ? (
          <div className="absolute inset-0 flex items-center justify-center text-[12px] text-zinc-500 font-mono">collecting samples (one every 30s)…</div>
        ) : (
          <svg viewBox={`0 0 ${W} ${H}`} className="absolute inset-0 w-full h-full block" preserveAspectRatio="none">
            <defs>
              <linearGradient id="latFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%"  stopColor="#22d3ee" stopOpacity="0.35" />
                <stop offset="100%" stopColor="#22d3ee" stopOpacity="0" />
              </linearGradient>
            </defs>
            {[0, 0.5, 1].map(p => (
              <line key={p} x1={PAD_L} x2={W - PAD_R} y1={PAD_T + plotH * (1 - p)} y2={PAD_T + plotH * (1 - p)} stroke="rgba(63,63,70,0.4)" strokeDasharray="2 4" vectorEffect="non-scaling-stroke" />
            ))}
            {[0, 0.5, 1].map(p => (
              <text key={p} x={PAD_L - 6} y={PAD_T + plotH * (1 - p) + 4}
                    fill="#71717a" fontFamily="JetBrains Mono, monospace" fontSize="11" textAnchor="end">
                {(maxLat * p).toFixed(0)}
              </text>
            ))}
            <text x={PAD_L - 6} y={PAD_T - 2} fill="#52525b" fontFamily="JetBrains Mono, monospace" fontSize="10" textAnchor="end">ms</text>
            {buckets.map((b, i) => b.lossPct && b.lossPct > 0 ? (
              <rect key={i} x={x(i) - 2} y={PAD_T + plotH - (Math.min(b.lossPct, 100) / 100) * plotH} width="4" height={(Math.min(b.lossPct, 100) / 100) * plotH} fill="#fb7185" opacity="0.5" />
            ) : null)}
            <path d={area} fill="url(#latFill)" />
            <path d={line} fill="none" stroke="#22d3ee" strokeWidth="1.6" vectorEffect="non-scaling-stroke" />
            {['60m', '45m', '30m', '15m', 'now'].map((l, i, arr) => (
              <text key={l} x={PAD_L + (i / (arr.length - 1)) * plotW} y={H - 6}
                    fill="#71717a" fontFamily="JetBrains Mono, monospace" fontSize="11" textAnchor="middle">{l}</text>
            ))}
          </svg>
        )}
      </div>
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
  const observedMax = points.reduce((m, p) => Math.max(m, p.lat), 0);
  const maxLat = Math.max(100, Math.ceil(observedMax * 1.4 / 25) * 25);
  const W = 1000, H = 280, PAD_L = 44, PAD_R = 28, PAD_T = 28, PAD_B = 36;
  const plotW = W - PAD_L - PAD_R, plotH = H - PAD_T - PAD_B;
  const maxLoss = 5;
  const x = (lat: number) => PAD_L + (lat / maxLat) * plotW;
  const y = (loss: number) => PAD_T + plotH - (loss / maxLoss) * plotH;

  const targetTicks = 6;
  const rawStep = maxLat / targetTicks;
  const niceStep = [10, 20, 25, 50, 100, 200].find(s => s >= rawStep) ?? rawStep;
  const xTicks: number[] = [];
  for (let v = 0; v <= maxLat; v += niceStep) xTicks.push(v);

  // ─── Smart label placement ──────────────────────────────────────
  // Each point can place its label in 8 candidate positions around the dot
  // (E / NE / N / NW / W / SW / S / SE). Pick the first non-colliding slot.
  // If all 8 collide, fall back to E and accept overlap rather than hide.
  const LABEL_PADDING_X = 8;
  const LABEL_PADDING_Y = 4;
  const placements: Array<{ tx: number; ty: number; anchor: 'start' | 'end' | 'middle' }> = [];
  // Used rectangles (in viewBox coords) to test for collisions.
  const used: Array<{ x1: number; y1: number; x2: number; y2: number }> = [];
  // Rough char width @ 11px monospace ≈ 6.6 viewBox-units.
  const approxTextWidth = (s: string) => s.length * 6.6;
  // Add point exclusion zones first so labels never sit on top of any dot.
  for (const p of points) {
    const cx = x(p.lat), cy = y(p.loss);
    used.push({ x1: cx - p.size - 2, y1: cy - p.size - 2, x2: cx + p.size + 2, y2: cy + p.size + 2 });
  }
  for (const p of points) {
    const cx = x(p.lat), cy = y(p.loss);
    const tw = approxTextWidth(p.id);
    const th = 12; // ~font-size + padding
    const r = p.size + 4;
    // 8 candidate slots, ordered by preference (right first, then up-right, etc.)
    const candidates: Array<{ tx: number; ty: number; anchor: 'start' | 'end' | 'middle'; rect: { x1: number; y1: number; x2: number; y2: number } }> = [
      { tx: cx + r + LABEL_PADDING_X, ty: cy + 4, anchor: 'start',  rect: { x1: cx + r,            y1: cy - th/2,      x2: cx + r + tw + LABEL_PADDING_X,         y2: cy + th/2 } },
      { tx: cx + r + LABEL_PADDING_X, ty: cy - r - LABEL_PADDING_Y, anchor: 'start',  rect: { x1: cx + r, y1: cy - r - th, x2: cx + r + tw, y2: cy - r } },
      { tx: cx,                       ty: cy - r - LABEL_PADDING_Y - 2, anchor: 'middle', rect: { x1: cx - tw/2, y1: cy - r - th - 2, x2: cx + tw/2, y2: cy - r - 2 } },
      { tx: cx - r - LABEL_PADDING_X, ty: cy - r - LABEL_PADDING_Y, anchor: 'end',    rect: { x1: cx - r - tw, y1: cy - r - th, x2: cx - r, y2: cy - r } },
      { tx: cx - r - LABEL_PADDING_X, ty: cy + 4, anchor: 'end',    rect: { x1: cx - r - tw, y1: cy - th/2, x2: cx - r, y2: cy + th/2 } },
      { tx: cx - r - LABEL_PADDING_X, ty: cy + r + th, anchor: 'end',    rect: { x1: cx - r - tw, y1: cy + r, x2: cx - r, y2: cy + r + th } },
      { tx: cx,                       ty: cy + r + th + 2, anchor: 'middle', rect: { x1: cx - tw/2, y1: cy + r + 2, x2: cx + tw/2, y2: cy + r + th + 2 } },
      { tx: cx + r + LABEL_PADDING_X, ty: cy + r + th, anchor: 'start',  rect: { x1: cx + r, y1: cy + r, x2: cx + r + tw, y2: cy + r + th } },
    ];
    const overlaps = (a: { x1: number; y1: number; x2: number; y2: number }, b: typeof a) =>
      !(a.x2 < b.x1 || a.x1 > b.x2 || a.y2 < b.y1 || a.y1 > b.y2);
    // Also reject candidates that escape the plot area.
    const inBounds = (r: { x1: number; y1: number; x2: number; y2: number }) =>
      r.x1 >= PAD_L - 8 && r.x2 <= W - PAD_R + 8 && r.y1 >= PAD_T - 8 && r.y2 <= PAD_T + plotH + 8;
    const chosen = candidates.find(c => inBounds(c.rect) && !used.some(u => overlaps(c.rect, u))) ?? candidates[0]!;
    used.push(chosen.rect);
    placements.push({ tx: chosen.tx, ty: chosen.ty, anchor: chosen.anchor });
  }

  return (
    <div className="relative" style={{ height: 280 }}>
      {points.length === 0 ? (
        <div className="absolute inset-0 flex items-center justify-center text-[12px] text-zinc-500 font-mono">probing targets…</div>
      ) : (
        <svg viewBox={`0 0 ${W} ${H}`} className="absolute inset-0 w-full h-full block" preserveAspectRatio="none">
          {/* Traffic-light zones */}
          <rect x={PAD_L} y={PAD_T} width={Math.max(0, x(Math.min(30, maxLat)) - PAD_L)} height={plotH} fill="#34d39911" />
          {maxLat > 30  && <rect x={x(30)}  y={PAD_T} width={x(Math.min(100, maxLat)) - x(30)} height={plotH} fill="#fbbf2411" />}
          {maxLat > 100 && <rect x={x(100)} y={PAD_T} width={(W - PAD_R) - x(100)}            height={plotH} fill="#fb718511" />}

          {xTicks.map(v => (
            <g key={v}>
              <line x1={x(v)} y1={PAD_T} x2={x(v)} y2={PAD_T + plotH} stroke="rgba(63,63,70,0.25)" vectorEffect="non-scaling-stroke" />
              <text x={x(v)} y={PAD_T + plotH + 18} textAnchor="middle" fill="#71717a" fontFamily="JetBrains Mono, monospace" fontSize="11">{v}</text>
            </g>
          ))}
          {[0, 1, 2, 3, 4, 5].map(v => (
            <g key={v}>
              <line x1={PAD_L} y1={y(v)} x2={W - PAD_R} y2={y(v)} stroke="rgba(63,63,70,0.25)" vectorEffect="non-scaling-stroke" />
              <text x={PAD_L - 6} y={y(v) + 4} textAnchor="end" fill="#71717a" fontFamily="JetBrains Mono, monospace" fontSize="11">{v}%</text>
            </g>
          ))}
          <text x={(PAD_L + W - PAD_R) / 2} y={H - 8} textAnchor="middle" fill="#52525b" fontFamily="JetBrains Mono, monospace" fontSize="11">latency · ms</text>
          <text x={PAD_L - 6} y={PAD_T - 8} textAnchor="end" fill="#52525b" fontFamily="JetBrains Mono, monospace" fontSize="11">loss</text>

          {points.map((p, i) => {
            const place = placements[i]!;
            return (
              <g key={p.id}>
                {/* connector line for off-axis labels so the reader can tell which dot the label belongs to */}
                <line
                  x1={x(p.lat)} y1={y(p.loss)}
                  x2={place.anchor === 'middle' ? place.tx : place.tx + (place.anchor === 'start' ? -2 : 2)}
                  y2={place.ty - 3}
                  stroke="rgba(212,212,216,0.18)" strokeWidth="0.6" vectorEffect="non-scaling-stroke"
                />
                <circle cx={x(p.lat)} cy={y(p.loss)} r={p.size + 4} fill={p.color} opacity="0.15" />
                <circle cx={x(p.lat)} cy={y(p.loss)} r={p.size}      fill={p.color} opacity="0.9" />
                <text x={place.tx} y={place.ty} textAnchor={place.anchor}
                      fill="#e4e4e7" fontFamily="JetBrains Mono, monospace" fontSize="11" stroke="#09090b" strokeWidth="3" paintOrder="stroke">
                  {p.id}
                </text>
              </g>
            );
          })}
        </svg>
      )}
    </div>
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
