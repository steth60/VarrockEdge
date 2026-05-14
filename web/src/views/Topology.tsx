import { useState } from 'react';
import { Card, Button, LegendDot, Icon } from '../components/primitives';

export function Topology() {
  const [hovered, setHovered] = useState<string | null>(null);
  const [showAnnotations, setShowAnnotations] = useState(true);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <h3 className="font-display text-[15px] font-semibold tracking-tight text-zinc-100">Topology</h3>
        <span className="text-[11.5px] text-zinc-500">Live · auto-refreshed every 30s</span>
        <div className="ml-auto flex items-center gap-2">
          <Button variant="ghost" size="sm" icon="ZoomIn">Fit</Button>
          <Button variant="ghost" size="sm" icon={showAnnotations ? 'Eye' : 'EyeOff'} onClick={() => setShowAnnotations(s => !s)}>Annotations</Button>
          <Button variant="secondary" size="sm" icon="Download">Export SVG</Button>
          <Button variant="primary" size="sm" icon="RefreshCw">Refresh</Button>
        </div>
      </div>

      <Card padding="p-0" className="relative overflow-hidden">
        <div className="relative grid-faint" style={{ height: 560 }}>
          <NetworkSVG hovered={hovered} setHovered={setHovered} showAnnotations={showAnnotations} />
          <div className="absolute left-4 bottom-4 flex flex-wrap items-center gap-3 bg-zinc-950/70 backdrop-blur border border-zinc-800/70 rounded-lg px-3 py-2 text-[11px]">
            <LegendDot color="#34d399" label="Up" />
            <LegendDot color="#22d3ee" label="Tunneled" />
            <LegendDot color="#a78bfa" label="DNS" />
            <LegendDot color="#fbbf24" label="Warn" />
            <LegendDot color="#71717a" label="Idle" />
          </div>
        </div>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card title="Public Subnet" subtitle="51.38.114.200/29 — OVH allocation">
          <div className="space-y-1.5 font-mono text-[12px]">
            <div className="flex justify-between"><span className="text-zinc-500">.206</span><span className="text-zinc-400">OVH gateway</span></div>
            <div className="flex justify-between"><span className="text-cyan-300">.207</span><span className="text-zinc-300">eth0 — primary</span></div>
            <div className="flex justify-between"><span className="text-zinc-700">.210–.213</span><span className="text-zinc-600">spare</span></div>
          </div>
        </Card>
        <Card title="Private Subnet" subtitle="10.0.0.0/24 — eth1 bridge">
          <div className="space-y-1.5 font-mono text-[12px]">
            <div className="flex justify-between"><span className="text-cyan-300">.1</span><span className="text-zinc-300">VarrokEdge (gateway)</span></div>
            <div className="flex justify-between"><span className="text-cyan-300">.10–.40</span><span className="text-zinc-400">static reservations</span></div>
            <div className="flex justify-between"><span className="text-cyan-300">.50–.200</span><span className="text-zinc-400">DHCP pool (151)</span></div>
          </div>
        </Card>
        <Card title="VPN Subnet" subtitle="10.10.0.0/24 — wg0 tunnel">
          <div className="space-y-1.5 font-mono text-[12px]">
            <div className="flex justify-between"><span className="text-cyan-300">.1</span><span className="text-zinc-300">wg0 server</span></div>
            <div className="flex justify-between"><span className="text-cyan-300">.2–.5</span><span className="text-zinc-400">peers (5 configured)</span></div>
          </div>
        </Card>
      </div>
    </div>
  );
}

function NetworkSVG({ hovered, setHovered, showAnnotations }: { hovered: string | null; setHovered: (id: string | null) => void; showAnnotations: boolean }) {
  const ovh    = { x:  90, y: 100 };
  const cloud  = { x: 220, y: 100 };
  const edge   = { x: 480, y: 280 };
  const lan    = { x: 760, y: 180 };
  const vpn    = { x: 760, y: 400 };
  const hosts = [
    { id: 'runner-01',   x: 920, y:  80, ip: '10.0.0.10',  color: '#34d399' },
    { id: 'nas',         x: 980, y: 160, ip: '10.0.0.61',  color: '#34d399' },
    { id: 'ws-callum',   x:1000, y: 250, ip: '10.0.0.74',  color: '#34d399' },
    { id: 'pi-monitor',  x: 960, y: 320, ip: '10.0.0.82',  color: '#34d399' },
  ];
  const peers = [
    { id: 'callum-laptop', x: 920, y: 410, ip: '10.10.0.2',   color: '#22d3ee' },
    { id: 'ops-iphone',    x: 990, y: 470, ip: '10.10.0.3',   color: '#22d3ee' },
    { id: 'site-londonB',  x:1000, y: 540, ip: '10.10.0.0/24',color: '#22d3ee' },
  ];

  const linkOpacity = (a: string, b: string) => !hovered || hovered === a || hovered === b ? 1 : 0.25;

  return (
    <svg viewBox="0 0 1100 560" className="w-full h-full" preserveAspectRatio="xMidYMid meet">
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
        <text x="700" y="62" fill="#22d3ee" fontFamily="JetBrains Mono, monospace" fontSize="11" opacity={showAnnotations ? 1 : 0}>10.0.0.0/24 · LAN</text>
      </g>
      <g opacity={hovered && hovered !== 'vpn' ? 0.4 : 1}>
        <rect x="680" y="360" width="380" height="180" rx="12" fill="rgba(167,139,250,0.04)" stroke="rgba(167,139,250,0.18)" strokeDasharray="4 4" />
        <text x="700" y="382" fill="#a78bfa" fontFamily="JetBrains Mono, monospace" fontSize="11" opacity={showAnnotations ? 1 : 0}>10.10.0.0/24 · wg0</text>
      </g>
      <g opacity={hovered && hovered !== 'cloud' ? 0.4 : 1}>
        <rect x="40" y="40" width="340" height="180" rx="12" fill="rgba(82,82,91,0.04)" stroke="rgba(82,82,91,0.2)" strokeDasharray="4 4" />
        <text x="60" y="62" fill="#a1a1aa" fontFamily="JetBrains Mono, monospace" fontSize="11" opacity={showAnnotations ? 1 : 0}>Internet · OVH AS16276</text>
      </g>

      <line x1={ovh.x} y1={ovh.y} x2={cloud.x} y2={cloud.y} stroke="rgba(161,161,170,0.4)" strokeWidth="1.5" opacity={linkOpacity('ovh','cloud')} />

      <g opacity={linkOpacity('cloud','edge')}>
        <line x1={cloud.x + 20} y1={cloud.y + 10} x2={edge.x - 30} y2={edge.y - 20} stroke="rgba(52,211,153,0.5)" strokeWidth="2" />
        <line x1={cloud.x + 20} y1={cloud.y + 10} x2={edge.x - 30} y2={edge.y - 20} stroke="url(#wan-flow)" strokeWidth="3" strokeDasharray="20 60">
          <animate attributeName="stroke-dashoffset" from="0" to="-80" dur="3s" repeatCount="indefinite" />
        </line>
        {showAnnotations && <text x={(cloud.x + edge.x) / 2 - 40} y={(cloud.y + edge.y) / 2} fill="#34d399" fontFamily="JetBrains Mono, monospace" fontSize="10">eth0 ↕ 6.8Mbps</text>}
      </g>

      <g opacity={linkOpacity('edge','lan')}>
        <line x1={edge.x + 30} y1={edge.y - 10} x2={lan.x - 20} y2={lan.y} stroke="rgba(34,211,238,0.5)" strokeWidth="2" />
        {showAnnotations && <text x={(edge.x + lan.x) / 2 - 30} y={(edge.y + lan.y) / 2 - 18} fill="#22d3ee" fontFamily="JetBrains Mono, monospace" fontSize="10">eth1 / vmbr1</text>}
      </g>

      <g opacity={linkOpacity('edge','vpn')}>
        <line x1={edge.x + 30} y1={edge.y + 10} x2={vpn.x - 20} y2={vpn.y} stroke="rgba(167,139,250,0.6)" strokeWidth="2" strokeDasharray="6 4" />
        {showAnnotations && <text x={(edge.x + vpn.x) / 2 - 40} y={(edge.y + vpn.y) / 2 + 18} fill="#a78bfa" fontFamily="JetBrains Mono, monospace" fontSize="10">wg0 :51820 UDP</text>}
      </g>

      {hosts.map(h => (
        <line key={h.id} x1={lan.x + 20} y1={lan.y} x2={h.x - 14} y2={h.y} stroke="rgba(82,82,91,0.5)" strokeWidth="1.2"
              opacity={!hovered || hovered === h.id || hovered === 'lan' ? 1 : 0.2} />
      ))}
      {peers.map(p => (
        <line key={p.id} x1={vpn.x + 20} y1={vpn.y} x2={p.x - 14} y2={p.y} stroke="rgba(167,139,250,0.4)" strokeWidth="1.2" strokeDasharray="3 3"
              opacity={!hovered || hovered === p.id || hovered === 'vpn' ? 1 : 0.2} />
      ))}

      <Node x={ovh.x}   y={ovh.y}   id="ovh"   icon="Cloud"       label="OVH GW"   sub="51.38.114.206" tone="#71717a" hovered={hovered} setHovered={setHovered} />
      <Node x={cloud.x} y={cloud.y} id="cloud" icon="Globe"       label="Internet" sub="any"           tone="#71717a" hovered={hovered} setHovered={setHovered} />

      <g onMouseEnter={() => setHovered('edge')} onMouseLeave={() => setHovered(null)} style={{ cursor: 'pointer' }}>
        <rect x={edge.x - 60} y={edge.y - 36} width="120" height="72" rx="12"
              fill="rgba(34,211,238,0.08)" stroke="#22d3ee" strokeWidth="1.5"
              filter={hovered === 'edge' ? "url(#edge-glow)" : undefined} />
        <foreignObject x={edge.x - 56} y={edge.y - 32} width="112" height="64">
          <div style={{ color:'#22d3ee', fontFamily:'Space Grotesk, sans-serif', display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', height:'100%' }}>
            <div style={{ display:'flex', alignItems:'center', gap:6 }}>
              <span style={{ width:8, height:8, borderRadius:99, background:'#34d399', boxShadow:'0 0 8px #34d399' }} />
              <strong style={{ fontSize: 13, color:'#e4e4e7' }}>VarrokEdge</strong>
            </div>
            <div style={{ fontFamily:'JetBrains Mono, monospace', fontSize: 10, color:'#a1a1aa', marginTop: 3 }}>ct-104 · 0.9.2</div>
            <div style={{ fontFamily:'JetBrains Mono, monospace', fontSize: 9.5, color:'#52525b', marginTop: 2 }}>NAT · DHCP · DNS · WG</div>
          </div>
        </foreignObject>
      </g>

      <Node x={lan.x} y={lan.y} id="lan" icon="Network"     label="LAN bridge" sub="vmbr1 · 10.0.0.1" tone="#22d3ee" hovered={hovered} setHovered={setHovered} />
      <Node x={vpn.x} y={vpn.y} id="vpn" icon="ShieldCheck" label="wg0"        sub="10.10.0.1/24"     tone="#a78bfa" hovered={hovered} setHovered={setHovered} />

      {hosts.map(h => <Leaf key={h.id} x={h.x} y={h.y} id={h.id} label={h.id} sub={h.ip} tone={h.color} hovered={hovered} setHovered={setHovered} />)}
      {peers.map(p => <Leaf key={p.id} x={p.x} y={p.y} id={p.id} label={p.id} sub={p.ip} tone={p.color} hovered={hovered} setHovered={setHovered} />)}
    </svg>
  );
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
