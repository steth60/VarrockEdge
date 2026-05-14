import { useEffect, useState } from 'react';
import { Card, KPICard, Icon, Badge, Button } from '../components/primitives';
import { api } from '../api/client';
import { useSSE } from '../api/sse';

interface Sysdata {
  hostname: string;
  platform: string;
  arch: string;
  release: string;
  version: string;
  type: string;
  uptime: number;
  loadAvg: number[];
  cpus: Array<{ idx: number; model: string; speed: number; times: { user: number; nice: number; sys: number; idle: number; irq: number } }>;
  memory: { total: number; free: number; used: number };
  interfaces: Array<{ name: string; addresses: Array<{ family: string; address: string; netmask: string; mac: string; internal: boolean }> }>;
  kernel: { release: string; version: string; cmdline: string; bootId: string; machineId: string };
  onLinux: boolean;
  container: string;
}

interface MetricsSnap { cpu: number; ram: number; ramTotal: number; eth0: { rxMbps: number; txMbps: number }; eth1: { rxMbps: number; txMbps: number } }

export function SystemData() {
  const [tab, setTab] = useState<'hardware' | 'memory' | 'network' | 'kernel'>('hardware');
  const [data, setData] = useState<Sysdata | null>(null);
  const live = useSSE<MetricsSnap>('/api/metrics/stream');

  const reload = () => api.get<Sysdata>('/api/sysdata').then(setData).catch(() => {});
  useEffect(() => {
    reload();
    const t = setInterval(reload, 4_000);
    return () => clearInterval(t);
  }, []);

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-1 p-1 rounded-lg bg-zinc-900/40 border border-zinc-800/60">
          {[
            { id: 'hardware', label: 'Hardware',   icon: 'Cpu' },
            { id: 'memory',   label: 'Memory',     icon: 'MemoryStick' },
            { id: 'network',  label: 'Interfaces', icon: 'Network' },
            { id: 'kernel',   label: 'Kernel',     icon: 'Terminal' },
          ].map(t => (
            <button key={t.id} onClick={() => setTab(t.id as any)}
                    className={`inline-flex items-center gap-2 h-8 px-3 rounded-md text-[12px] font-medium transition-colors ${tab === t.id ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800/40'}`}>
              <Icon name={t.icon} size={13} />{t.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="info" size="sm" icon="Activity">live · 4s refresh</Badge>
          <Button variant="secondary" size="sm" icon="Download">Export</Button>
        </div>
      </div>

      {tab === 'hardware' && <Hardware data={data} live={live} />}
      {tab === 'memory'   && <Memory data={data} live={live} />}
      {tab === 'network'  && <NetworkPanel data={data} />}
      {tab === 'kernel'   && <Kernel data={data} />}
    </div>
  );
}

function Hardware({ data, live }: { data: Sysdata | null; live: MetricsSnap | null }) {
  const cpus = data?.cpus ?? [];
  return (
    <>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KPICard label="CPU cores"     value={cpus.length || '—'} icon="Cpu"   tone="neutral" />
        <KPICard label="CPU model"     value={cpus[0]?.model.split(' ').slice(0, 3).join(' ') ?? '—'} icon="Cpu" tone="neutral" />
        <KPICard label="Architecture"  value={data?.arch ?? '—'}  icon="Box"   tone="accent" />
        <KPICard label="Live CPU"      value={live?.cpu.toFixed(1) ?? '—'} unit="%" icon="Activity" tone={live && live.cpu > 80 ? 'danger' : 'success'} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card title="System" subtitle="os module + /proc on Linux" className="lg:col-span-2">
          <div className="grid grid-cols-2 gap-x-6 gap-y-3">
            <SysKV k="Hostname"      v={data?.hostname ?? '—'} />
            <SysKV k="Container"     v={data?.container ?? '—'} />
            <SysKV k="OS type"       v={data?.type ?? '—'} />
            <SysKV k="Architecture"  v={data?.arch ?? '—'} />
            <SysKV k="Kernel release" v={data?.release ?? '—'} />
            <SysKV k="Kernel version" v={data?.version ?? '—'} />
            <SysKV k="Uptime"        v={formatUptime(data?.uptime ?? 0)} />
            <SysKV k="Load average"  v={data?.loadAvg.map(v => v.toFixed(2)).join('  ') ?? '—'} />
            <SysKV k="CPU model"     v={cpus[0]?.model ?? '—'} />
            <SysKV k="CPU speed"     v={cpus[0] ? `${cpus[0].speed} MHz` : '—'} />
          </div>
        </Card>

        <Card title="Per-core" subtitle={`${cpus.length} cores · current`}>
          <div className="space-y-2 max-h-[280px] overflow-auto">
            {cpus.map(c => {
              const total = c.times.user + c.times.nice + c.times.sys + c.times.idle + c.times.irq;
              const usage = total > 0 ? 100 * (1 - c.times.idle / total) : 0;
              return (
                <div key={c.idx} className="flex items-center gap-3">
                  <code className="font-mono text-[11px] text-zinc-500 w-10">CPU{c.idx}</code>
                  <div className="flex-1 h-1.5 rounded-full bg-zinc-800 overflow-hidden">
                    <div className="h-full transition-all" style={{ width: `${usage}%`, background: usage > 70 ? '#fb7185' : usage > 40 ? '#fbbf24' : '#22d3ee' }} />
                  </div>
                  <code className="font-mono text-[11px] text-zinc-200 w-12 text-right">{usage.toFixed(0)}%</code>
                  <code className="font-mono text-[10px] text-zinc-500 w-14 text-right">{(c.speed / 1000).toFixed(2)} GHz</code>
                </div>
              );
            })}
            {cpus.length === 0 && <div className="text-[12px] text-zinc-500">No CPU data.</div>}
          </div>
        </Card>
      </div>
    </>
  );
}

function Memory({ data, live }: { data: Sysdata | null; live: MetricsSnap | null }) {
  const mem = data?.memory ?? { total: 0, free: 0, used: 0 };
  const totalMB = Math.round(mem.total / 1024 / 1024);
  const usedMB  = Math.round(mem.used  / 1024 / 1024);
  const freeMB  = Math.round(mem.free  / 1024 / 1024);
  const pct = mem.total > 0 ? (mem.used / mem.total) * 100 : 0;
  return (
    <>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KPICard label="Total RAM"  value={totalMB.toLocaleString()} unit="MB" icon="MemoryStick" tone="neutral" />
        <KPICard label="Used"       value={usedMB.toLocaleString()}  unit="MB" icon="Activity"    tone={pct > 80 ? 'danger' : pct > 60 ? 'accent' : 'success'} />
        <KPICard label="Free"       value={freeMB.toLocaleString()}  unit="MB" icon="CheckCircle2" tone="success" />
        <KPICard label="Live MB"    value={live?.ram.toString() ?? '—'} unit={live ? `/ ${live.ramTotal}` : 'MB'} icon="Activity" tone="accent" />
      </div>
      <Card title="Memory usage" subtitle="Host (os.totalmem / os.freemem)">
        <div className="h-2 rounded-full bg-zinc-800 overflow-hidden">
          <div className="h-full transition-all" style={{ width: `${pct}%`, background: pct > 80 ? '#fb7185' : pct > 60 ? '#fbbf24' : '#22d3ee' }} />
        </div>
        <div className="mt-2 flex justify-between text-[11px] font-mono text-zinc-500">
          <span>0</span>
          <span className="text-zinc-300">{pct.toFixed(1)}% used</span>
          <span>{totalMB.toLocaleString()} MB</span>
        </div>
      </Card>
    </>
  );
}

function NetworkPanel({ data }: { data: Sysdata | null }) {
  const ifs = data?.interfaces ?? [];
  return (
    <Card title="Network interfaces" subtitle="os.networkInterfaces()">
      <table className="w-full text-[12.5px]">
        <thead>
          <tr className="text-left text-[10.5px] uppercase tracking-[0.08em] text-zinc-500 border-b border-zinc-800/70">
            <th className="font-medium py-2.5">Interface</th>
            <th className="font-medium py-2.5">Family</th>
            <th className="font-medium py-2.5">Address</th>
            <th className="font-medium py-2.5">Netmask</th>
            <th className="font-medium py-2.5">MAC</th>
            <th className="font-medium py-2.5">Internal</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-800/60">
          {ifs.flatMap(i => i.addresses.map((a, idx) => (
            <tr key={`${i.name}-${idx}`} className="hover:bg-zinc-900/30">
              <td className="py-3 font-mono text-zinc-100">{i.name}</td>
              <td className="py-3"><Badge variant={a.family === 'IPv4' ? 'info' : 'neutral'} size="sm">{a.family}</Badge></td>
              <td className="py-3 font-mono text-cyan-300">{a.address}</td>
              <td className="py-3 font-mono text-zinc-400">{a.netmask}</td>
              <td className="py-3 font-mono text-zinc-400">{a.mac}</td>
              <td className="py-3 font-mono text-zinc-500">{a.internal ? 'yes' : 'no'}</td>
            </tr>
          )))}
          {ifs.length === 0 && <tr><td colSpan={6} className="py-8 text-center text-[12px] text-zinc-600">No interfaces.</td></tr>}
        </tbody>
      </table>
    </Card>
  );
}

function Kernel({ data }: { data: Sysdata | null }) {
  return (
    <Card title="Kernel" subtitle="uname + /proc">
      <div className="grid grid-cols-2 gap-x-6 gap-y-3 text-[12px]">
        <SysKV k="Release"  v={data?.kernel.release  ?? '—'} />
        <SysKV k="Version"  v={data?.kernel.version  ?? '—'} />
        <SysKV k="Platform" v={data?.platform ?? '—'} />
        <SysKV k="Arch"     v={data?.arch ?? '—'} />
        <SysKV k="Boot ID"     v={data?.kernel.bootId    || '— (non-linux)'} />
        <SysKV k="Machine ID"  v={data?.kernel.machineId || '— (non-linux)'} />
      </div>
      {data?.kernel.cmdline && (
        <div className="mt-5">
          <div className="text-[10.5px] uppercase tracking-[0.08em] text-zinc-500 mb-2">Boot cmdline</div>
          <pre className="bg-zinc-950/60 border border-zinc-800/60 rounded-lg p-3 font-mono text-[11px] text-zinc-300 break-all whitespace-pre-wrap">{data.kernel.cmdline}</pre>
        </div>
      )}
    </Card>
  );
}

function SysKV({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-start gap-3 text-[12px]">
      <span className="text-zinc-500 w-36 shrink-0">{k}</span>
      <span className="font-mono text-zinc-200 break-all">{v}</span>
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
