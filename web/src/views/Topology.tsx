import { useEffect, useMemo, useRef, useState } from 'react';
import { Card, Button, LegendDot, Icon } from '../components/primitives';
import { api } from '../api/client';

interface TopologyData {
  wan: { iface: string; ip: string | null; rxMbps: number; txMbps: number; addresses: { ip: string; role: string }[] };
  lan: { iface: string; ip: string; cidr: string; rxMbps: number; txMbps: number; hosts: { mac: string; ip: string; hostname: string; source: 'lease' | 'reservation' }[] };
  vpn: { cidr: string; port: number; peers: { id: number; name: string; allowedIps: string; status: 'connected' | 'idle' | 'offline'; kind: string; endpoint: string; rxBytes: number; txBytes: number }[] };
  edge: { hostname: string; version: string; container: string; uptime: number };
  ts: number;
}

const STATUS_COLOR: Record<string, string> = {
  connected: '#22d3ee',
  idle:      '#fbbf24',
  offline:   '#71717a',
  lease:     '#34d399',
  reservation: '#22d3ee',
};

export function Topology() {
  const [data, setData] = useState<TopologyData | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const [showAnnotations, setShowAnnotations] = useState(true);
  const [refreshTick, setRefreshTick] = useState(0);
  const svgRef = useRef<SVGSVGElement | null>(null);

  const fetchData = () => api.get<TopologyData>('/api/topology').then(setData).catch(() => {});

  useEffect(() => {
    fetchData();
    const t = setInterval(fetchData, 30_000);
    return () => clearInterval(t);
  }, [refreshTick]);

  const exportSvg = () => {
    if (!svgRef.current) return;
    const xml = new XMLSerializer().serializeToString(svgRef.current);
    const blob = new Blob([`<?xml version="1.0" encoding="UTF-8"?>\n${xml}`], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `varrok-topology-${new Date().toISOString().slice(0, 10)}.svg`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <h3 className="font-display text-[15px] font-semibold tracking-tight text-zinc-100">Topology</h3>
        <span className="text-[11.5px] text-zinc-500">
          {data ? `Live · ${data.lan.hosts.length} LAN host${data.lan.hosts.length === 1 ? '' : 's'}, ${data.vpn.peers.length} peer${data.vpn.peers.length === 1 ? '' : 's'} · auto-refreshed every 30s` : 'Loading…'}
        </span>
        <div className="ml-auto flex items-center gap-2">
          <Button variant="ghost" size="sm" icon={showAnnotations ? 'Eye' : 'EyeOff'} onClick={() => setShowAnnotations(s => !s)}>Annotations</Button>
          <Button variant="secondary" size="sm" icon="Download" onClick={exportSvg}>Export SVG</Button>
          <Button variant="primary" size="sm" icon="RefreshCw" onClick={() => setRefreshTick(t => t + 1)}>Refresh</Button>
        </div>
      </div>

      <Card padding="p-0" className="relative overflow-hidden">
        <div className="relative grid-faint" style={{ height: 560 }}>
          {data ? (
            <NetworkSVG data={data} hovered={hovered} setHovered={setHovered} showAnnotations={showAnnotations} svgRef={svgRef} />
          ) : (
            <div className="absolute inset-0 flex items-center justify-center text-[12px] text-zinc-500 font-mono">loading topology…</div>
          )}
          <div className="absolute left-4 bottom-4 flex flex-wrap items-center gap-3 bg-zinc-950/70 backdrop-blur border border-zinc-800/70 rounded-lg px-3 py-2 text-[11px]">
            <LegendDot color="#34d399" label="LAN lease" />
            <LegendDot color="#22d3ee" label="LAN reservation / WG connected" />
            <LegendDot color="#fbbf24" label="WG idle" />
            <LegendDot color="#71717a" label="WG offline" />
          </div>
        </div>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card title="Public Subnet" subtitle={data?.wan.iface ? `${data.wan.iface} · ${data.wan.ip ?? '(no v4)'}` : 'eth0'}>
          <div className="space-y-1.5 font-mono text-[12px]">
            {data?.wan.addresses.map(a => (
              <div key={a.ip} className="flex justify-between">
                <span className="text-cyan-300">{a.ip}</span>
                <span className="text-zinc-400">{a.role === 'primary' ? 'primary' : 'SNAT'}</span>
              </div>
            ))}
            {data && data.wan.addresses.length === 0 && <div className="text-zinc-600">(no addresses bound)</div>}
          </div>
        </Card>
        <Card title="Private Subnet" subtitle={`${data?.lan.cidr ?? '10.0.0.0/24'} · ${data?.lan.iface ?? 'eth1'} bridge`}>
          <div className="space-y-1.5 font-mono text-[12px]">
            <div className="flex justify-between"><span className="text-cyan-300">{data?.lan.ip ?? '10.0.0.1'}</span><span className="text-zinc-300">VarrokEdge (gateway)</span></div>
            <div className="flex justify-between"><span className="text-zinc-400">{data?.lan.hosts.length ?? 0} hosts seen</span><span className="text-zinc-600">via DHCP / static</span></div>
          </div>
        </Card>
        <Card title="VPN Subnet" subtitle={`${data?.vpn.cidr ?? '10.10.0.0/24'} · wg0 :${data?.vpn.port ?? 51820}`}>
          <div className="space-y-1.5 font-mono text-[12px]">
            <div className="flex justify-between"><span className="text-zinc-400">{data?.vpn.peers.length ?? 0} peers</span><span className="text-zinc-600">{data?.vpn.peers.filter(p => p.status === 'connected').length ?? 0} connected</span></div>
          </div>
        </Card>
      </div>
    </div>
  );
}

function NetworkSVG({ data, hovered, setHovered, showAnnotations, svgRef }: {
  data: TopologyData;
  hovered: string | null;
  setHovered: (s: string | null) => void;
  showAnnotations: boolean;
  svgRef: React.MutableRefObject<SVGSVGElement | null>;
}) {
  const W = 1100, H = 560;
  const ovh   = { x:  90, y: 100 };
  const cloud = { x: 220, y: 100 };
  const edge  = { x: 480, y: 280 };
  const lan   = { x: 760, y: 180 };
  const vpn   = { x: 760, y: 400 };

  // Auto-distribute hosts around the LAN hub on a small arc.
  const hosts = useMemo(() => distribute(data.lan.hosts.slice(0, 12), 920, 60, 320, 1100, 'lan').map((p, i) => ({
    id: `lan-${i}`,
    x: p.x, y: p.y,
    label: data.lan.hosts[i]!.hostname || data.lan.hosts[i]!.mac.slice(0, 8),
    sub: data.lan.hosts[i]!.ip,
    tone: STATUS_COLOR[data.lan.hosts[i]!.source] ?? '#34d399',
  })), [data.lan.hosts]);

  const peers = useMemo(() => distribute(data.vpn.peers.slice(0, 12), 920, 390, 540, 1080, 'vpn').map((p, i) => ({
    id: `vpn-${i}`,
    x: p.x, y: p.y,
    label: data.vpn.peers[i]!.name,
    sub: data.vpn.peers[i]!.allowedIps,
    tone: STATUS_COLOR[data.vpn.peers[i]!.status] ?? '#71717a',
  })), [data.vpn.peers]);

  const linkOp = (a: string, b: string) => !hovered || hovered === a || hovered === b ? 1 : 0.25;
  const wanMbps = (data.wan.rxMbps + data.wan.txMbps).toFixed(1);

  return (
    <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} className="w-full h-full" preserveAspectRatio="xMidYMid meet">
      <defs>
        <linearGradient id="wan-flow" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%"  stopColor="#34d399" stopOpacity="0.0" />
          <stop offset="50%" stopColor="#34d399" stopOpacity="0.8" />
          <stop offset="100%" stopColor="#34d399" stopOpacity="0.0" />
        </linearGradient>
        <filter id="edge-glow" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="6" result="b" />
          <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
      </defs>

      <g opacity={hovered && hovered !== 'lan' ? 0.4 : 1}>
        <rect x="680" y="40" width="380" height="280" rx="12" fill="rgba(34,211,238,0.04)" stroke="rgba(34,211,238,0.18)" strokeDasharray="4 4" />
        <text x="700" y="62" fill="#22d3ee" fontFamily="JetBrains Mono, monospace" fontSize="11" opacity={showAnnotations ? 1 : 0}>{data.lan.cidr} · LAN</text>
      </g>
      <g opacity={hovered && hovered !== 'vpn' ? 0.4 : 1}>
        <rect x="680" y="360" width="380" height="180" rx="12" fill="rgba(167,139,250,0.04)" stroke="rgba(167,139,250,0.18)" strokeDasharray="4 4" />
        <text x="700" y="382" fill="#a78bfa" fontFamily="JetBrains Mono, monospace" fontSize="11" opacity={showAnnotations ? 1 : 0}>{data.vpn.cidr} · wg0 :{data.vpn.port}</text>
      </g>
      <g opacity={hovered && hovered !== 'cloud' ? 0.4 : 1}>
        <rect x="40" y="40" width="340" height="180" rx="12" fill="rgba(82,82,91,0.04)" stroke="rgba(82,82,91,0.2)" strokeDasharray="4 4" />
        <text x="60" y="62" fill="#a1a1aa" fontFamily="JetBrains Mono, monospace" fontSize="11" opacity={showAnnotations ? 1 : 0}>Internet · WAN ({data.wan.iface})</text>
      </g>

      <line x1={ovh.x} y1={ovh.y} x2={cloud.x} y2={cloud.y} stroke="rgba(161,161,170,0.4)" strokeWidth="1.5" opacity={linkOp('ovh','cloud')} />

      <g opacity={linkOp('cloud','edge')}>
        <line x1={cloud.x + 20} y1={cloud.y + 10} x2={edge.x - 30} y2={edge.y - 20} stroke="rgba(52,211,153,0.5)" strokeWidth="2" />
        <line x1={cloud.x + 20} y1={cloud.y + 10} x2={edge.x - 30} y2={edge.y - 20} stroke="url(#wan-flow)" strokeWidth="3" strokeDasharray="20 60">
          <animate attributeName="stroke-dashoffset" from="0" to="-80" dur="3s" repeatCount="indefinite" />
        </line>
        {showAnnotations && <text x={(cloud.x + edge.x) / 2 - 50} y={(cloud.y + edge.y) / 2} fill="#34d399" fontFamily="JetBrains Mono, monospace" fontSize="10">{data.wan.iface} ↕ {wanMbps}Mbps</text>}
      </g>

      <g opacity={linkOp('edge','lan')}>
        <line x1={edge.x + 30} y1={edge.y - 10} x2={lan.x - 20} y2={lan.y} stroke="rgba(34,211,238,0.5)" strokeWidth="2" />
        {showAnnotations && <text x={(edge.x + lan.x) / 2 - 30} y={(edge.y + lan.y) / 2 - 18} fill="#22d3ee" fontFamily="JetBrains Mono, monospace" fontSize="10">{data.lan.iface}</text>}
      </g>

      <g opacity={linkOp('edge','vpn')}>
        <line x1={edge.x + 30} y1={edge.y + 10} x2={vpn.x - 20} y2={vpn.y} stroke="rgba(167,139,250,0.6)" strokeWidth="2" strokeDasharray="6 4" />
        {showAnnotations && <text x={(edge.x + vpn.x) / 2 - 40} y={(edge.y + vpn.y) / 2 + 18} fill="#a78bfa" fontFamily="JetBrains Mono, monospace" fontSize="10">wg0 :{data.vpn.port} UDP</text>}
      </g>

      {hosts.map(h => (
        <line key={h.id} x1={lan.x + 20} y1={lan.y} x2={h.x - 14} y2={h.y}
              stroke="rgba(82,82,91,0.5)" strokeWidth="1.2"
              opacity={!hovered || hovered === h.id || hovered === 'lan' ? 1 : 0.2} />
      ))}
      {peers.map(p => (
        <line key={p.id} x1={vpn.x + 20} y1={vpn.y} x2={p.x - 14} y2={p.y}
              stroke="rgba(167,139,250,0.4)" strokeWidth="1.2" strokeDasharray="3 3"
              opacity={!hovered || hovered === p.id || hovered === 'vpn' ? 1 : 0.2} />
      ))}

      <Node x={ovh.x}   y={ovh.y}   id="ovh"   icon="Cloud" label="WAN GW"   sub={data.wan.ip ?? '—'} tone="#71717a" hovered={hovered} setHovered={setHovered} />
      <Node x={cloud.x} y={cloud.y} id="cloud" icon="Globe" label="Internet" sub="any" tone="#71717a" hovered={hovered} setHovered={setHovered} />

      <g onMouseEnter={() => setHovered('edge')} onMouseLeave={() => setHovered(null)} style={{ cursor: 'pointer' }}>
        <rect x={edge.x - 60} y={edge.y - 36} width="120" height="72" rx="12"
              fill="rgba(34,211,238,0.08)" stroke="#22d3ee" strokeWidth="1.5"
              filter={hovered === 'edge' ? 'url(#edge-glow)' : undefined} />
        <text x={edge.x} y={edge.y - 6} textAnchor="middle" fill="#e4e4e7" fontFamily="Space Grotesk, sans-serif" fontSize="13" fontWeight="600">VarrokEdge</text>
        <text x={edge.x} y={edge.y + 9} textAnchor="middle" fill="#a1a1aa" fontFamily="JetBrains Mono, monospace" fontSize="10">{data.edge.container} · {data.edge.version}</text>
        <text x={edge.x} y={edge.y + 23} textAnchor="middle" fill="#52525b" fontFamily="JetBrains Mono, monospace" fontSize="9.5">NAT · DHCP · DNS · WG</text>
      </g>

      <Node x={lan.x} y={lan.y} id="lan" icon="Network"     label="LAN bridge" sub={`${data.lan.iface} · ${data.lan.ip}`} tone="#22d3ee" hovered={hovered} setHovered={setHovered} />
      <Node x={vpn.x} y={vpn.y} id="vpn" icon="ShieldCheck" label="wg0"        sub={data.vpn.cidr} tone="#a78bfa" hovered={hovered} setHovered={setHovered} />

      {hosts.map(h => <Leaf key={h.id} {...h} hovered={hovered} setHovered={setHovered} />)}
      {peers.map(p => <Leaf key={p.id} {...p} hovered={hovered} setHovered={setHovered} />)}

      {hosts.length === 0 && (
        <text x={1000} y={200} textAnchor="middle" fill="#52525b" fontFamily="JetBrains Mono, monospace" fontSize="10">no LAN hosts yet</text>
      )}
      {peers.length === 0 && (
        <text x={1000} y={460} textAnchor="middle" fill="#52525b" fontFamily="JetBrains Mono, monospace" fontSize="10">no WG peers yet</text>
      )}
    </svg>
  );
}

function distribute<T>(items: T[], colX: number, minY: number, maxY: number, _maxX: number, _kind: string) {
  if (items.length === 0) return [];
  const span = maxY - minY;
  return items.map((_, i) => ({
    x: colX + ((i % 2) * 40 - 20),
    y: minY + (items.length === 1 ? span / 2 : (span / (items.length - 1)) * i),
  }));
}

function Node({ x, y, id, icon, label, sub, tone, hovered, setHovered }: {
  x: number; y: number; id: string; icon: string; label: string; sub: string; tone: string;
  hovered: string | null; setHovered: (s: string | null) => void;
}) {
  const active = hovered === id;
  return (
    <g onMouseEnter={() => setHovered(id)} onMouseLeave={() => setHovered(null)} style={{ cursor: 'pointer' }}>
      <circle cx={x} cy={y} r={active ? 22 : 18} fill="rgba(24,24,27,0.85)" stroke={tone} strokeWidth={active ? 2 : 1.5} style={{ transition: 'r .15s' }} />
      <foreignObject x={x - 12} y={y - 12} width="24" height="24" pointerEvents="none">
        <div style={{ width:'100%', height:'100%', display:'flex', alignItems:'center', justifyContent:'center', color: tone }}>
          <Icon name={icon} size={14} color={tone} />
        </div>
      </foreignObject>
      <text x={x} y={y + 38} textAnchor="middle" fill="#e4e4e7" fontFamily="Space Grotesk, sans-serif" fontSize="11.5" fontWeight="500">{label}</text>
      <text x={x} y={y + 52} textAnchor="middle" fill="#71717a" fontFamily="JetBrains Mono, monospace" fontSize="10">{sub}</text>
    </g>
  );
}

function Leaf({ x, y, id, label, sub, tone, hovered, setHovered }: {
  x: number; y: number; id: string; label: string; sub: string; tone: string;
  hovered: string | null; setHovered: (s: string | null) => void;
}) {
  const active = hovered === id;
  return (
    <g onMouseEnter={() => setHovered(id)} onMouseLeave={() => setHovered(null)} style={{ cursor: 'pointer' }}>
      <rect x={x - 14} y={y - 9} width="28" height="18" rx="4" fill="rgba(24,24,27,0.85)" stroke={tone} strokeWidth={active ? 1.5 : 1} opacity={active ? 1 : 0.85} />
      <circle cx={x} cy={y} r="2" fill={tone} />
      <text x={x + 22} y={y - 1} fill="#e4e4e7" fontFamily="Space Grotesk, sans-serif" fontSize="11">{label}</text>
      <text x={x + 22} y={y + 11} fill="#71717a" fontFamily="JetBrains Mono, monospace" fontSize="9.5">{sub}</text>
    </g>
  );
}
