import { useEffect, useRef, useState } from 'react';
import { Button, IconButton, Icon, ToggleSwitch } from '../components/primitives';
import { api } from '../api/client';

interface TopologyData {
  wan: { iface: string; ip: string | null; rxMbps: number; txMbps: number; addresses: { ip: string; role: string }[] };
  lan: { iface: string; ip: string; cidr: string; rxMbps: number; txMbps: number; hosts: { mac: string; ip: string; hostname: string; source: 'lease' | 'reservation' | 'static' }[] };
  vpn: { cidr: string; port: number; peers: { id: number; name: string; allowedIps: string; status: 'connected' | 'idle' | 'offline'; kind: string; endpoint: string; rxBytes: number; txBytes: number; remoteSubnet: string | null }[] };
  edge: { hostname: string; version: string; container: string; uptime: number };
  ts: number;
}

interface Wan {
  id: number; iface: string; label: string; role: string; priority: number; healthTarget: string; enabled: boolean;
  health?: { status: 'up' | 'degraded' | 'down'; rttMs: number | null; lossPct: number | null; ts: number | null };
}

interface TopoFilters {
  online: boolean;
  offline: boolean;
  lan: boolean;
  vpnPeers: boolean;
  sites: boolean;
  showInternet: boolean;
}

const DEFAULT_FILTERS: TopoFilters = {
  online: true, offline: false,
  lan: true, vpnPeers: true, sites: true,
  showInternet: true,
};

interface ViewBox { x: number; y: number; w: number; h: number }
const INITIAL_VIEWBOX: ViewBox = { x: 0, y: 0, w: 1400, h: 680 };

interface PanProps {
  viewBox: ViewBox;
  onWheel: (e: React.WheelEvent<SVGSVGElement>) => void;
  onMouseDown: (e: React.MouseEvent<SVGSVGElement>) => void;
  onMouseMove: (e: React.MouseEvent<SVGSVGElement>) => void;
  onMouseUp: () => void;
}

export function Topology() {
  const [tab, setTab] = useState<'topology' | 'infrastructure'>('topology');
  const [collapsed, setCollapsed] = useState(false);
  const [data, setData] = useState<TopologyData | null>(null);
  const [wans, setWans] = useState<Wan[]>([]);
  const [filters, setFilters] = useState<TopoFilters>(DEFAULT_FILTERS);
  const [viewBox, setViewBox] = useState<ViewBox>(INITIAL_VIEWBOX);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const drag = useRef<{ x: number; y: number; vb: ViewBox } | null>(null);

  const fetchData = () => {
    api.get<TopologyData>('/api/topology').then(setData).catch(() => {});
    api.get<{ wans: Wan[] }>('/api/wan').then(r => setWans(r.wans)).catch(() => setWans([]));
  };

  useEffect(() => {
    fetchData();
    const t = setInterval(fetchData, 30_000);
    return () => clearInterval(t);
  }, []);

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

  const resetView = () => setViewBox(INITIAL_VIEWBOX);
  const zoom = (factor: number) => setViewBox(v => {
    const newW = Math.max(300, Math.min(3500, v.w * factor));
    const newH = Math.max(150, Math.min(1700, v.h * factor));
    return { x: v.x + (v.w - newW) / 2, y: v.y + (v.h - newH) / 2, w: newW, h: newH };
  });
  const onWheel = (e: React.WheelEvent<SVGSVGElement>) => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return;
    const factor = e.deltaY < 0 ? 0.88 : 1.14;
    setViewBox(v => {
      const newW = Math.max(300, Math.min(3500, v.w * factor));
      const newH = Math.max(150, Math.min(1700, v.h * factor));
      const cx = (e.clientX - rect.left) / rect.width;
      const cy = (e.clientY - rect.top) / rect.height;
      return { x: v.x + (v.w - newW) * cx, y: v.y + (v.h - newH) * cy, w: newW, h: newH };
    });
  };
  const onMouseDown = (e: React.MouseEvent<SVGSVGElement>) => { drag.current = { x: e.clientX, y: e.clientY, vb: viewBox }; };
  const onMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    if (!drag.current || !svgRef.current) return;
    const rect = svgRef.current.getBoundingClientRect();
    const dx = (drag.current.x - e.clientX) * (drag.current.vb.w / rect.width);
    const dy = (drag.current.y - e.clientY) * (drag.current.vb.h / rect.height);
    setViewBox({ ...drag.current.vb, x: drag.current.vb.x + dx, y: drag.current.vb.y + dy });
  };
  const onMouseUp = () => { drag.current = null; };
  const pan: PanProps = { viewBox, onWheel, onMouseDown, onMouseMove, onMouseUp };

  return (
    <div className="flex flex-col gap-4" style={{ minHeight: 'calc(100vh - 110px)' }}>
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-1 p-1 rounded-lg bg-zinc-900/40 border border-zinc-800/60">
          {[
            { id: 'topology',       label: 'Topology',       icon: 'Workflow' },
            { id: 'infrastructure', label: 'Infrastructure', icon: 'Boxes' },
          ].map(t => (
            <button key={t.id} onClick={() => setTab(t.id as any)}
                    className={`inline-flex items-center gap-2 h-8 px-3.5 rounded-md text-[12.5px] font-medium transition-colors ${tab === t.id ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800/40'}`}>
              <Icon name={t.icon} size={13} />{t.label}
            </button>
          ))}
        </div>
        <IconButton name={collapsed ? 'PanelLeftOpen' : 'PanelLeftClose'} label="Collapse panel" size="sm" variant="ghost" onClick={() => setCollapsed(s => !s)} />
        <div className="ml-auto flex items-center gap-2">
          <Button variant="ghost" size="sm" icon="Maximize2" onClick={resetView}>Fit</Button>
          <Button variant="ghost" size="sm" icon="Download" onClick={exportSvg}>Export</Button>
          <Button variant="primary" size="sm" icon="RefreshCw" onClick={fetchData}>Refresh</Button>
        </div>
      </div>

      <div className="grid gap-4 flex-1" style={{ gridTemplateColumns: collapsed ? '0fr 1fr' : '280px 1fr', minHeight: 0 }}>
        {!collapsed && (
          tab === 'topology'
            ? <TopologyFilterPanel data={data} filters={filters} setFilters={setFilters} />
            : <InfrastructureFilterPanel data={data} />
        )}
        {collapsed && <div />}
        <div className="rounded-xl border border-zinc-800/70 bg-zinc-950/40 backdrop-blur grid-faint overflow-hidden relative">
          {!data && <div className="absolute inset-0 flex items-center justify-center text-[12px] text-zinc-500 font-mono">loading…</div>}
          {data && (tab === 'topology'
            ? <TopologyCanvas data={data} svgRef={svgRef} filters={filters} {...pan} />
            : <InfrastructureCanvas data={data} wans={wans} svgRef={svgRef} {...pan} />
          )}
          <div className="absolute right-4 bottom-4 flex flex-col gap-1 bg-zinc-950/80 backdrop-blur border border-zinc-800/70 rounded-lg p-1 shadow-xl">
            <IconButton name="Crosshair" label="Recenter" size="sm" onClick={resetView} />
            <IconButton name="Plus"      label="Zoom in"  size="sm" onClick={() => zoom(0.8)} />
            <IconButton name="Minus"     label="Zoom out" size="sm" onClick={() => zoom(1.25)} />
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Filter panels ───────────────────────────────────────────────
function TopologyFilterPanel({ data, filters, setFilters }: { data: TopologyData | null; filters: TopoFilters; setFilters: (f: TopoFilters) => void }) {
  const lanCount  = data?.lan.hosts.length ?? 0;
  const peerCount = data?.vpn.peers.length ?? 0;
  const siteCount = data?.vpn.peers.filter(p => p.kind === 'site').length ?? 0;
  const set = <K extends keyof TopoFilters>(k: K, v: TopoFilters[K]) => setFilters({ ...filters, [k]: v });
  return (
    <aside className="rounded-xl border border-zinc-800/70 bg-zinc-950/40 backdrop-blur p-4 space-y-4 overflow-y-auto">
      <FilterToggleRow label="Show Internet" value={filters.showInternet} onChange={v => set('showInternet', v)} />
      <FilterGroup label="Device Status" defaultOpen>
        <FilterCheckRow label="Online"  count={data?.vpn.peers.filter(p => p.status === 'connected').length ?? 0} dot="bg-emerald-400" checked={filters.online}  onChange={v => set('online', v)} />
        <FilterCheckRow label="Offline" count={data?.vpn.peers.filter(p => p.status === 'offline').length   ?? 0} dot="bg-zinc-600"    checked={filters.offline} onChange={v => set('offline', v)} />
      </FilterGroup>
      <FilterGroup label="Client Devices" defaultOpen>
        <FilterCheckRow label="LAN (wired)" count={lanCount}              checked={filters.lan}      onChange={v => set('lan', v)} />
        <FilterCheckRow label="VPN peers"   count={peerCount - siteCount} checked={filters.vpnPeers} onChange={v => set('vpnPeers', v)} />
        <FilterCheckRow label="Sites"       count={siteCount}             checked={filters.sites}    onChange={v => set('sites', v)} />
      </FilterGroup>
      <FilterGroup label="Subnets" defaultOpen>
        <FilterCheckRow label={`LAN — ${data?.lan.cidr ?? '10.0.0.0/24'}`}  count={lanCount}  checked onChange={() => {}} />
        <FilterCheckRow label={`VPN — ${data?.vpn.cidr ?? '10.10.0.0/24'}`} count={peerCount} checked onChange={() => {}} />
      </FilterGroup>
      <div className="pt-2 border-t border-zinc-800/60">
        <button onClick={() => setFilters(DEFAULT_FILTERS)} className="text-[11.5px] text-cyan-300 hover:text-cyan-200">Reset filters</button>
      </div>
    </aside>
  );
}

function InfrastructureFilterPanel({ data }: { data: TopologyData | null }) {
  return (
    <aside className="rounded-xl border border-zinc-800/70 bg-zinc-950/40 backdrop-blur p-4 space-y-4 overflow-y-auto">
      <FilterToggleRow label="Digital twin details" value={false} onChange={() => {}} />
      <div className="rounded-lg border border-cyan-400/30 bg-cyan-400/5 p-3">
        <div className="flex items-center justify-between">
          <div className="text-[12px] font-medium text-zinc-100">VarrokEdge — {data?.edge.hostname.split('.')[0] ?? 'edge-01'}</div>
          <span className="text-[10px] text-zinc-500 font-mono">{data?.edge.version ?? '0.9.2'}</span>
        </div>
        <DeviceFacePlate />
        <div className="text-[10.5px] text-zinc-500 font-mono mt-2 flex items-center justify-between">
          <span>{data?.edge.container ?? 'ct-104'} · Proxmox</span>
          <span className="text-zinc-400">{formatUptime(data?.edge.uptime ?? 0)}</span>
        </div>
      </div>
    </aside>
  );
}

function FilterToggleRow({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center justify-between p-2 -mx-1 rounded-md hover:bg-zinc-900/40">
      <span className="text-[12px] font-medium text-zinc-200">{label}</span>
      <ToggleSwitch value={value} onChange={onChange} />
    </div>
  );
}

function FilterGroup({ label, defaultOpen, children }: { label: string; defaultOpen?: boolean; children: React.ReactNode }) {
  const [open, setOpen] = useState(!!defaultOpen);
  return (
    <div>
      <button onClick={() => setOpen(o => !o)} className="w-full flex items-center justify-between py-1.5">
        <span className="text-[11.5px] font-medium text-zinc-100">{label}</span>
        <Icon name={open ? 'ChevronUp' : 'ChevronDown'} size={12} className="text-zinc-500" />
      </button>
      {open && <div className="pl-1 space-y-1 pt-1">{children}</div>}
    </div>
  );
}

function FilterCheckRow({ label, count, dot, checked, onChange }: { label: string; count: number; dot?: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center justify-between py-1.5 px-1 -mx-1 rounded-md hover:bg-zinc-900/40 cursor-pointer">
      <span className="flex items-center gap-2 text-[12px] text-zinc-300">
        <span className={`w-3.5 h-3.5 rounded-[3px] border flex items-center justify-center transition-colors ${checked ? 'bg-cyan-400 border-cyan-400' : 'border-zinc-600 bg-transparent'}`}
              onClick={(e) => { e.preventDefault(); onChange(!checked); }}>
          {checked && <Icon name="Check" size={10} color="#09090b" strokeWidth={3.5} />}
        </span>
        {dot && <span className={`w-1.5 h-1.5 rounded-full ${dot}`} />}
        <span>{label}</span>
      </span>
      <span className="font-mono text-[10.5px] text-zinc-500">({count})</span>
    </label>
  );
}

function DeviceFacePlate() {
  return (
    <svg viewBox="0 0 220 36" className="w-full mt-2" style={{ height: 36 }}>
      <defs>
        <linearGradient id="dpFace" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="rgba(34,211,238,0.15)" />
          <stop offset="100%" stopColor="rgba(34,211,238,0.02)" />
        </linearGradient>
      </defs>
      <rect x="0.5" y="2" width="219" height="32" rx="3" fill="url(#dpFace)" stroke="rgba(34,211,238,0.45)" />
      <rect x="6" y="9" width="60" height="18" rx="1.5" fill="rgba(9,9,11,0.6)" stroke="rgba(82,82,91,0.6)" />
      <text x="36" y="22" textAnchor="middle" fill="#a1a1aa" fontFamily="JetBrains Mono, monospace" fontSize="9">VARROK</text>
      {Array.from({ length: 8 }).map((_, i) => (
        <g key={i}>
          <rect x={76 + i * 16} y="11" width="13" height="14" rx="1.5" fill="rgba(9,9,11,0.6)" stroke="rgba(82,82,91,0.6)" />
          <circle cx={82.5 + i * 16} cy="18" r="1.4" fill={i < 2 ? '#34d399' : i < 4 ? '#22d3ee' : 'rgba(82,82,91,0.5)'} />
        </g>
      ))}
      <circle cx="212" cy="18" r="2.2" fill="#34d399">
        <animate attributeName="opacity" values="1;0.4;1" dur="2s" repeatCount="indefinite" />
      </circle>
    </svg>
  );
}

// ─── Topology canvas — hierarchical Internet → WAN → Edge → Subnets → Devices
function TopologyCanvas({ data, svgRef, filters, viewBox, onWheel, onMouseDown, onMouseMove, onMouseUp }:
  { data: TopologyData; svgRef: React.MutableRefObject<SVGSVGElement | null>; filters: TopoFilters } & PanProps) {
  const passesStatus = (s: string) => (s === 'connected' ? filters.online : filters.offline);
  const lanHosts = filters.lan      ? data.lan.hosts.slice(0, 8) : [];
  const vpnPeers = filters.vpnPeers ? data.vpn.peers.filter(p => p.kind !== 'site' && passesStatus(p.status)).slice(0, 6) : [];
  const sites    = filters.sites    ? data.vpn.peers.filter(p => p.kind === 'site' && passesStatus(p.status)).slice(0, 4) : [];

  const internetY = 60, wanY = 150, edgeY = 250, subnetY = 360, deviceY = 510;
  const centerX = 700;
  const lanX = 460, vpnX = 950, siteX = 1240;
  const lanXs = lanHosts.map((_, i) => 180 + i * 110);
  const vpnXs = vpnPeers.map((_, i) => 830 + i * 90);
  const siteXs = sites.map((_, i) => 1170 + i * 90);

  return (
    <svg
      ref={svgRef}
      viewBox={`${viewBox.x} ${viewBox.y} ${viewBox.w} ${viewBox.h}`}
      className="w-full h-full block select-none"
      preserveAspectRatio="xMidYMid meet"
      style={{ cursor: 'grab' }}
      onWheel={onWheel}
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      onMouseUp={onMouseUp}
      onMouseLeave={onMouseUp}
    >
      <defs>
        <filter id="tnodeGlow" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="6" result="b" />
          <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
      </defs>

      {[['Internet', internetY], ['WAN', wanY], ['Edge', edgeY], ['Subnets', subnetY], ['Endpoints', deviceY]].map(([l, y]) => (
        <text key={l as string} x="24" y={(y as number) + 4} fill="#52525b" fontFamily="JetBrains Mono, monospace" fontSize="9.5">{l}</text>
      ))}

      {filters.showInternet && <Wire x1={centerX} y1={internetY + 22} x2={centerX} y2={wanY - 22} color="rgba(82,82,91,0.5)" />}
      <Wire x1={centerX} y1={wanY + 22} x2={centerX} y2={edgeY - 28} color="#34d399" flow />
      {filters.lan      && <Wire x1={centerX - 30} y1={edgeY + 28} x2={lanX} y2={subnetY - 22} color="rgba(34,211,238,0.6)" />}
      {filters.vpnPeers && <Wire x1={centerX + 5}  y1={edgeY + 28} x2={vpnX} y2={subnetY - 22} color="rgba(167,139,250,0.6)" dashed />}
      {filters.sites    && <Wire x1={centerX + 30} y1={edgeY + 28} x2={siteX} y2={subnetY - 22} color="rgba(167,139,250,0.6)" dashed />}

      {lanXs.map((x, i) => <Wire key={`l${i}`} x1={lanX} y1={subnetY + 22} x2={x} y2={deviceY - 22} color="rgba(82,82,91,0.55)" thin />)}
      {vpnXs.map((x, i) => <Wire key={`v${i}`} x1={vpnX} y1={subnetY + 22} x2={x} y2={deviceY - 22} color="rgba(167,139,250,0.5)" dashed thin />)}
      {siteXs.map((x, i) => <Wire key={`s${i}`} x1={siteX} y1={subnetY + 22} x2={x} y2={deviceY - 22} color="rgba(167,139,250,0.5)" dashed thin />)}

      {filters.showInternet && <TNode x={centerX} y={internetY} icon="Globe" label="Internet" sub="any" tone="#71717a" />}
      <TNode x={centerX} y={wanY} icon="Cloud" label={`WAN · ${data.wan.iface}`} sub={data.wan.ip ?? '—'} tone="#34d399" badge="100%" />

      <g filter="url(#tnodeGlow)">
        <rect x={centerX - 110} y={edgeY - 30} width="220" height="60" rx="8" fill="rgba(34,211,238,0.08)" stroke="#22d3ee" strokeWidth="1.4" />
      </g>
      <foreignObject x={centerX - 106} y={edgeY - 26} width="212" height="52">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, height: '100%' }}>
          <div style={{ width: 34, height: 34, borderRadius: 8, background: 'linear-gradient(135deg,#22d3ee,rgba(99,102,241,0.7))', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <span style={{ color: 'rgba(9,9,11,0.9)', fontFamily: 'Space Grotesk, sans-serif', fontWeight: 700, fontSize: 14 }}>VE</span>
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ width: 6, height: 6, borderRadius: 99, background: '#34d399', boxShadow: '0 0 6px #34d399' }} />
              <span style={{ fontFamily: 'Space Grotesk, sans-serif', fontSize: 13, color: '#e4e4e7', fontWeight: 600 }}>VarrokEdge — {data.edge.hostname.split('.')[0]}</span>
            </div>
            <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 10.5, color: '#a1a1aa', marginTop: 2 }}>{data.edge.container} · {data.edge.version} · NAT · DHCP · DNS · WG</div>
          </div>
        </div>
      </foreignObject>

      {filters.lan      && <TNode x={lanX}  y={subnetY} icon="Network"     label={`LAN · ${data.lan.iface}`} sub={data.lan.cidr} tone="#22d3ee" />}
      {filters.vpnPeers && <TNode x={vpnX}  y={subnetY} icon="ShieldCheck" label="wg0 peers" sub={data.vpn.cidr} tone="#a78bfa" />}
      {filters.sites    && <TNode x={siteX} y={subnetY} icon="Network"     label="Site links" sub={`${sites.length} configured`} tone="#a78bfa" />}

      {lanHosts.map((d, i) => <TLeaf key={d.mac} x={lanXs[i]!} y={deviceY} icon="Cpu" label={truncate(d.hostname || d.mac.slice(0, 8), 12)} sub={d.ip} tone={d.source === 'reservation' ? '#22d3ee' : '#34d399'} />)}
      {vpnPeers.map((p, i) => <TLeaf key={p.id} x={vpnXs[i]!} y={deviceY} icon="Smartphone" label={truncate(p.name, 12)} sub={p.allowedIps} tone={p.status === 'connected' ? '#22d3ee' : '#71717a'} />)}
      {sites.map((s, i) => <TLeaf key={s.id} x={siteXs[i]!} y={deviceY} icon="Network" label={truncate(s.name, 12)} sub={s.remoteSubnet ?? '—'} tone={s.status === 'connected' ? '#22d3ee' : '#fbbf24'} />)}

      {filters.lan && lanHosts.length === 0 && <text x={lanX} y={deviceY} textAnchor="middle" fill="#52525b" fontFamily="JetBrains Mono, monospace" fontSize="10">no LAN hosts yet</text>}
      {(filters.vpnPeers || filters.sites) && vpnPeers.length + sites.length === 0 && <text x={(vpnX + siteX) / 2} y={deviceY} textAnchor="middle" fill="#52525b" fontFamily="JetBrains Mono, monospace" fontSize="10">no WG peers yet</text>}
    </svg>
  );
}

// ─── Infrastructure canvas — real WAN blocks from /api/wan ──────
function InfrastructureCanvas({ data, wans, svgRef, viewBox, onWheel, onMouseDown, onMouseMove, onMouseUp }:
  { data: TopologyData; wans: Wan[]; svgRef: React.MutableRefObject<SVGSVGElement | null> } & PanProps) {
  const blocks = wans.length > 0 ? wans : [{ id: -1, iface: data.wan.iface, label: data.wan.iface, role: 'primary', priority: 100, healthTarget: '', enabled: true, health: { status: 'up' as const, rttMs: null, lossPct: null, ts: null } }];
  return (
    <svg
      ref={svgRef}
      viewBox={`${viewBox.x} ${viewBox.y} ${viewBox.w} ${viewBox.h}`}
      className="w-full h-full block select-none"
      preserveAspectRatio="xMidYMid meet"
      style={{ cursor: 'grab' }}
      onWheel={onWheel}
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      onMouseUp={onMouseUp}
      onMouseLeave={onMouseUp}
    >
      <defs>
        <filter id="infraGlow" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="8" result="b" />
          <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
      </defs>

      {blocks.slice(0, 4).map((w, i) => (
        <foreignObject key={w.iface} x={380 + i * 280} y={120} width={260} height={76}>
          <WanBlock wan={w} primaryIp={data.wan.ip} />
        </foreignObject>
      ))}

      {blocks.slice(0, 4).map((_, i) => {
        const fromX = 380 + i * 280 + 130;
        return <path key={i} d={`M${fromX},196 C${fromX},300 700,360 700,440`} stroke="rgba(34,211,238,0.55)" strokeWidth="1.6" fill="none" />;
      })}

      <g filter="url(#infraGlow)">
        <rect x="400" y="440" width="600" height="96" rx="12" fill="rgba(34,211,238,0.07)" stroke="#22d3ee" strokeWidth="1.5" />
      </g>
      <foreignObject x="412" y="452" width="576" height="72">
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, height: '100%' }}>
          <div style={{ width: 200 }}><DeviceFacePlate /></div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ width: 7, height: 7, borderRadius: 99, background: '#34d399', boxShadow: '0 0 7px #34d399' }} />
              <span style={{ fontFamily: 'Space Grotesk, sans-serif', fontSize: 15, color: '#e4e4e7', fontWeight: 600 }}>VarrokEdge — {data.edge.hostname.split('.')[0]}</span>
              <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 10.5, color: '#71717a', marginLeft: 6 }}>{data.edge.version}</span>
            </div>
            <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: '#a1a1aa', marginTop: 4 }}>{data.edge.container} · Proxmox · NAT + DHCP + DNS + WG</div>
          </div>
          <div style={{ display: 'flex', gap: 18, fontFamily: 'JetBrains Mono, monospace', fontSize: 12 }}>
            <div style={{ textAlign: 'right' }}>
              <div style={{ color: '#71717a', fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.8 }}>Uptime</div>
              <div style={{ color: '#e4e4e7', marginTop: 3 }}>{formatUptime(data.edge.uptime)}</div>
            </div>
          </div>
        </div>
      </foreignObject>

      <path d="M700,536 C700,600 700,610 700,620" stroke="rgba(82,82,91,0.6)" strokeWidth="1.6" fill="none" />
      <foreignObject x="540" y="618" width="320" height="46">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 14px', border: '1px solid rgba(63,63,70,0.7)', borderRadius: 10, background: 'rgba(24,24,27,0.6)' }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 26, height: 26, borderRadius: 6, background: 'rgba(34,211,238,0.1)', border: '1px solid rgba(34,211,238,0.35)' }}>
            <Icon name="Network" size={13} color="#22d3ee" />
          </span>
          <div style={{ flex: 1 }}>
            <div style={{ fontFamily: 'Space Grotesk, sans-serif', fontSize: 12, color: '#e4e4e7' }}>{data.lan.iface} · {data.lan.cidr}</div>
            <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 10, color: '#71717a' }}>{data.lan.hosts.length} devices</div>
          </div>
          <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 10.5, color: '#34d399' }}>100%</span>
        </div>
      </foreignObject>
    </svg>
  );
}

function WanBlock({ wan, primaryIp }: { wan: Wan; primaryIp: string | null }) {
  const status = wan.health?.status ?? 'unknown';
  const tone = status === 'up' ? '#34d399' : status === 'degraded' ? '#fbbf24' : status === 'down' ? '#fb7185' : '#71717a';
  const ip = wan.iface === 'eth0' || wan.iface === 'eth1' ? (primaryIp ?? wan.iface) : wan.iface;
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px',
      border: '1px solid rgba(63,63,70,0.8)', borderRadius: 10,
      background: 'linear-gradient(180deg, rgba(24,24,27,0.95), rgba(24,24,27,0.7))',
      height: '100%',
    }}>
      <div style={{
        width: 34, height: 34, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: `${tone}1a`, border: `1px solid ${tone}66`, flexShrink: 0,
        color: tone, fontFamily: 'Space Grotesk, sans-serif', fontWeight: 700, fontSize: 14,
      }}>{wan.iface.slice(0, 4).toUpperCase()}</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ fontFamily: 'Space Grotesk, sans-serif', fontWeight: 600, fontSize: 13, color: '#e4e4e7' }}>{wan.label}</div>
          <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: tone }}>{status}</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 4 }}>
          <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 10.5, color: '#a1a1aa' }}>{wan.role} · p{wan.priority}</div>
          <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 10.5, color: '#22d3ee' }}>{ip}</div>
        </div>
        {wan.health?.rttMs !== null && wan.health?.rttMs !== undefined && (
          <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 10, color: '#71717a', marginTop: 2 }}>
            {wan.health.rttMs.toFixed(0)}ms · {wan.health.lossPct?.toFixed(0) ?? 0}% loss
          </div>
        )}
      </div>
    </div>
  );
}

function Wire({ x1, y1, x2, y2, color, flow, dashed, thin }: { x1: number; y1: number; x2: number; y2: number; color: string; flow?: boolean; dashed?: boolean; thin?: boolean }) {
  const dy = y2 - y1;
  const cp1 = `${x1},${y1 + dy * 0.45}`;
  const cp2 = `${x2},${y2 - dy * 0.45}`;
  const d = `M${x1},${y1} C${cp1} ${cp2} ${x2},${y2}`;
  return (
    <>
      <path d={d} fill="none" stroke={color} strokeWidth={thin ? 1 : 1.5} strokeDasharray={dashed ? '4 4' : undefined} />
      {flow && (
        <path d={d} fill="none" stroke={color} strokeWidth="2.4" strokeDasharray="10 28" opacity="0.6">
          <animate attributeName="stroke-dashoffset" from="0" to="-38" dur="2.5s" repeatCount="indefinite" />
        </path>
      )}
    </>
  );
}

function TNode({ x, y, icon, label, sub, tone, badge }: { x: number; y: number; icon: string; label: string; sub: string; tone: string; badge?: string }) {
  return (
    <g>
      <circle cx={x} cy={y} r="22" fill="rgba(24,24,27,0.85)" stroke={tone} strokeWidth="1.4" />
      <foreignObject x={x - 12} y={y - 12} width="24" height="24" pointerEvents="none">
        <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Icon name={icon} size={14} color={tone} />
        </div>
      </foreignObject>
      <text x={x} y={y + 40} textAnchor="middle" fill="#e4e4e7" fontFamily="Space Grotesk, sans-serif" fontSize="11.5" fontWeight="500">{label}</text>
      <text x={x} y={y + 54} textAnchor="middle" fill="#71717a" fontFamily="JetBrains Mono, monospace" fontSize="10">{sub}</text>
      {badge && (
        <g>
          <rect x={x + 18} y={y - 32} width="32" height="14" rx="3" fill="#34d39922" stroke="#34d39977" />
          <text x={x + 34} y={y - 22} textAnchor="middle" fill="#34d399" fontFamily="JetBrains Mono, monospace" fontSize="9">{badge}</text>
        </g>
      )}
    </g>
  );
}

function TLeaf({ x, y, icon, label, sub, tone }: { x: number; y: number; icon: string; label: string; sub: string; tone: string }) {
  return (
    <g>
      <rect x={x - 18} y={y - 18} width="36" height="36" rx="6" fill="rgba(24,24,27,0.85)" stroke="rgba(82,82,91,0.7)" />
      <foreignObject x={x - 9} y={y - 9} width="18" height="18" pointerEvents="none">
        <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Icon name={icon} size={12} color={tone} />
        </div>
      </foreignObject>
      <text x={x} y={y + 30} textAnchor="middle" fill="#d4d4d8" fontFamily="Space Grotesk, sans-serif" fontSize="10">{label}</text>
      <text x={x} y={y + 42} textAnchor="middle" fill="#71717a" fontFamily="JetBrains Mono, monospace" fontSize="9">{sub}</text>
    </g>
  );
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

function formatUptime(secs: number): string {
  if (!secs) return '—';
  const d = Math.floor(secs / 86400);
  const h = Math.floor((secs % 86400) / 3600);
  return `${d}d ${h}h`;
}
