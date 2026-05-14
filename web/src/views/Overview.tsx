import { useEffect, useState } from 'react';
import {
  Card, KPICard, Sparkline, Ring, StatusPill, Badge, Button, Icon,
  KV, LOG_LEVEL_COLORS, makeWave, shift,
} from '../components/primitives';
import { useSSE } from '../api/sse';
import { api } from '../api/client';

interface Snapshot {
  cpu: number;
  ram: number;
  ramTotal: number;
  eth0: { rxMbps: number; txMbps: number };
  eth1: { rxMbps: number; txMbps: number };
  ts: number;
}

interface ServicesResp { services: Array<{ name: string; status: 'running'|'stopped'|'degraded'; pid?: number; uptime?: string; desc: string }> }
interface InterfacesResp {
  wan: { name: string; role: string; ip: string; mac?: string; rxMbps: number; txMbps: number };
  lan: { name: string; role: string; ip: string; mac?: string; rxMbps: number; txMbps: number };
}
interface SystemResp { hostname: string; kernel: string; uptime: number; version: string; loadAvg: number[]; container: string }

const SEED_LOGS = [
  { time: '14:22:18', level: 'INFO',  svc: 'dnsmasq',  msg: 'DHCPACK(eth1) 10.0.0.118 bc:24:11:0e:91:4a gh-runner-02' },
  { time: '14:22:11', level: 'OK',    svc: 'wg-quick', msg: 'peer site-londonB: handshake established (6s)' },
  { time: '14:21:58', level: 'INFO',  svc: 'iptables', msg: 'DNAT eth0:25565 → 10.0.0.55:25565 hit (count 2381)' },
  { time: '14:21:42', level: 'WARN',  svc: 'nftables', msg: 'rule sync skew 184ms — consider lowering poll interval' },
  { time: '14:21:21', level: 'INFO',  svc: 'dnsmasq',  msg: 'reading /etc/dnsmasq.d/static.conf (4 hosts)' },
  { time: '14:20:55', level: 'DEBUG', svc: 'kernel',   msg: 'br0: port 3(veth104i0) entered forwarding state' },
  { time: '14:20:41', level: 'OK',    svc: 'wg-quick', msg: 'peer callum-laptop: handshake established (12s)' },
  { time: '14:20:14', level: 'ERROR', svc: 'fail2ban', msg: 'banned 185.220.101.42 (port 22, 6 attempts)' },
  { time: '14:19:53', level: 'INFO',  svc: 'dnsmasq',  msg: 'query[A] runner.varrok.local from 10.0.0.74' },
  { time: '14:19:32', level: 'INFO',  svc: 'systemd',  msg: 'Started Network Time Synchronization' },
];

export function Overview() {
  const live = useSSE<Snapshot>('/api/metrics/stream');
  const [history, setHistory] = useState({
    cpu: makeWave(48, 18, 4),
    ram: makeWave(48, 410, 12),
    dl:  makeWave(48, 7, 3),
    ul:  makeWave(48, 14, 5),
  });
  const [services, setServices] = useState<ServicesResp['services']>([]);
  const [interfaces, setInterfaces] = useState<InterfacesResp | null>(null);
  const [sysinfo, setSysinfo] = useState<SystemResp | null>(null);
  const [logs] = useState(SEED_LOGS);

  useEffect(() => {
    api.get<ServicesResp>('/api/overview/services').then(r => setServices(r.services)).catch(() => {});
    api.get<InterfacesResp>('/api/overview/interfaces').then(setInterfaces).catch(() => {});
    api.get<SystemResp>('/api/overview/system').then(setSysinfo).catch(() => {});
  }, []);

  useEffect(() => {
    if (!live) return;
    setHistory(prev => ({
      cpu: shift(prev.cpu, live.cpu),
      ram: shift(prev.ram, live.ram),
      dl:  shift(prev.dl,  live.eth0.rxMbps),
      ul:  shift(prev.ul,  live.eth1.txMbps),
    }));
  }, [live]);

  const cpu = live?.cpu ?? 18.4;
  const ram = live?.ram ?? 412;
  const ramTotal = live?.ramTotal ?? 1024;
  const dl = live?.eth0.rxMbps ?? 6.8;
  const ul = live?.eth1.txMbps ?? 14.2;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <KPICard label="CPU Usage" value={cpu.toFixed(1)} unit="%" icon="Cpu" tone="neutral"
          trend={{ dir: cpu > 22 ? 'up' : 'down', value: '0.4%' }}
          spark={<Sparkline data={history.cpu} color="#22d3ee" />} />
        <KPICard label="RAM Usage" value={Math.round(ram).toString()} unit={`MB / ${ramTotal} MB`} icon="MemoryStick" tone="neutral"
          trend={{ dir: 'up', value: '12 MB' }}
          spark={<Sparkline data={history.ram} color="#a78bfa" />} />
        <KPICard label="eth0 ↓ Public" value={dl.toFixed(1)} unit="Mbps" icon="ArrowDownToLine" tone="success"
          trend={{ dir: 'up', value: `${(dl * 0.06).toFixed(1)} Mb` }}
          spark={<Sparkline data={history.dl} color="#34d399" />} />
        <KPICard label="eth1 ↑ Private" value={ul.toFixed(1)} unit="Mbps" icon="ArrowUpFromLine" tone="accent"
          trend={{ dir: ul > 14 ? 'up' : 'down', value: `${(ul * 0.05).toFixed(1)} Mb` }}
          spark={<Sparkline data={history.ul} color="#22d3ee" />} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card title="Service Status" subtitle="Process supervision" className="lg:col-span-1"
          action={<Button variant="ghost" size="sm" icon="RefreshCw" onClick={() => api.get<ServicesResp>('/api/overview/services').then(r => setServices(r.services))}>Reload</Button>}>
          <div className="divide-y divide-zinc-800/70 -mx-1">
            {(services.length ? services : [
              { name: 'dnsmasq',          pid: 1843, uptime: '6d 14h', status: 'running' as const, desc: 'DHCP + Local DNS' },
              { name: 'wg-quick@wg0',     pid: 1902, uptime: '6d 14h', status: 'running' as const, desc: 'WireGuard tunnel' },
              { name: 'iptables',         uptime: '—',       status: 'running' as const, desc: 'NAT + Firewall rules' },
              { name: 'nftables-monitor', pid: 1944, uptime: '2h 11m', status: 'degraded' as const, desc: 'Rule sync watcher' },
            ]).map((s) => (
              <div key={s.name} className="flex items-center justify-between gap-3 px-1 py-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <code className="font-mono text-[12px] text-zinc-100">{s.name}</code>
                    {s.pid && <span className="text-[10.5px] font-mono text-zinc-500">pid {s.pid}</span>}
                  </div>
                  <p className="text-[11px] text-zinc-500 mt-0.5">{s.desc}{s.uptime ? ` · up ${s.uptime}` : ''}</p>
                </div>
                <StatusPill status={s.status} />
              </div>
            ))}
          </div>
        </Card>

        <Card title="Network Interfaces" subtitle="Public + private bridge" className="lg:col-span-2">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <InterfaceTile name={interfaces?.wan.name ?? 'eth0'} role={interfaces?.wan.role ?? 'Public · OVH'} ip={interfaces?.wan.ip ?? '51.38.114.207/29'}
              mac={interfaces?.wan.mac ?? 'bc:24:11:8a:42:1f'} rx={dl} tx={dl * 0.4} color="#34d399" />
            <InterfaceTile name={interfaces?.lan.name ?? 'eth1'} role={interfaces?.lan.role ?? 'Private · vmbr1'} ip={interfaces?.lan.ip ?? '10.0.0.1/24'}
              mac={interfaces?.lan.mac ?? 'bc:24:11:8a:42:20'} rx={ul * 0.6} tx={ul} color="#22d3ee" />
          </div>
          <div className="mt-4 p-3 rounded-lg bg-zinc-900/40 border border-zinc-800/60 flex items-center gap-3">
            <div className="flex items-center gap-2 text-zinc-300 text-[12px]">
              <Icon name="Network" size={14} className="text-zinc-500" />
              <span>NAT </span>
            </div>
            <code className="font-mono text-[11.5px] text-zinc-400">eth1 (10.0.0.0/24)</code>
            <Icon name="ArrowRight" size={12} className="text-zinc-600" />
            <code className="font-mono text-[11.5px] text-cyan-300">MASQUERADE eth0</code>
            <span className="ml-auto text-[10.5px] font-mono text-zinc-600">3 active forwards</span>
          </div>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card title="System" subtitle={sysinfo ? `LXC container ${sysinfo.container}` : 'LXC container ct-104'} className="lg:col-span-1">
          <div className="grid grid-cols-2 gap-4 items-center">
            <Ring value={Math.round(cpu)} color="#22d3ee" />
            <div>
              <div className="text-[11px] uppercase tracking-[0.08em] text-zinc-500">CPU</div>
              <div className="font-mono text-[18px] text-zinc-100">{cpu.toFixed(1)}%</div>
              <div className="text-[11px] text-zinc-500 mt-0.5">load {sysinfo?.loadAvg.map(v => v.toFixed(2)).join(' ') ?? '0.42 0.38 0.31'}</div>
            </div>
            <Ring value={Math.round((ram / ramTotal) * 100)} color="#a78bfa" />
            <div>
              <div className="text-[11px] uppercase tracking-[0.08em] text-zinc-500">RAM</div>
              <div className="font-mono text-[18px] text-zinc-100">{Math.round(ram)} / {ramTotal}</div>
              <div className="text-[11px] text-zinc-500 mt-0.5">{((ram / ramTotal) * 100).toFixed(0)}% used</div>
            </div>
          </div>
          <div className="divider mt-5 pt-4 grid grid-cols-2 gap-3 text-[12px]">
            <KV k="Kernel"   v={sysinfo?.kernel ?? '6.8.4-pve'} mono />
            <KV k="Uptime"   v={formatUptime(sysinfo?.uptime ?? 6 * 86400 + 14 * 3600)} mono />
            <KV k="Hostname" v={sysinfo?.hostname ?? 'varrok-edge-01'} mono />
            <KV k="Version"  v={`VarrokEdge ${sysinfo?.version ?? '0.9.2'}`} mono />
          </div>
        </Card>

        <Card title="Live Activity Log" subtitle="Tail of journalctl" className="lg:col-span-2"
              action={
                <div className="flex items-center gap-2">
                  <Badge variant="info" size="sm" icon="Activity">live</Badge>
                  <Button variant="ghost" size="sm" icon="Download">Export</Button>
                </div>
              }>
          <div className="bg-zinc-950/50 border border-zinc-800/60 rounded-lg p-3 font-mono text-[11.5px] leading-relaxed max-h-[260px] overflow-auto">
            {logs.map((l, i) => (
              <div key={i} className="flex gap-3">
                <span className="text-zinc-600 shrink-0">{l.time}</span>
                <span className={`shrink-0 w-[68px] ${LOG_LEVEL_COLORS[l.level]}`}>{l.level}</span>
                <span className="text-zinc-500 shrink-0 w-[88px]">{l.svc}</span>
                <span className="text-zinc-300">{l.msg}</span>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}

function formatUptime(secs: number): string {
  const d = Math.floor(secs / 86400);
  const h = Math.floor((secs % 86400) / 3600);
  const m = Math.floor((secs % 3600) / 60);
  return `${d}d ${h}h ${m}m`;
}

function InterfaceTile({ name, role, ip, mac, rx, tx, color }: { name: string; role: string; ip: string; mac?: string; rx: number; tx: number; color: string }) {
  return (
    <div className="p-4 rounded-lg bg-zinc-900/40 border border-zinc-800/60">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="w-1.5 h-1.5 rounded-full" style={{ background: color, boxShadow: `0 0 8px ${color}` }} />
          <code className="font-mono text-[13px] text-zinc-100 font-medium">{name}</code>
        </div>
        <span className="text-[10.5px] uppercase tracking-[0.08em] text-zinc-500">{role}</span>
      </div>
      <div className="mt-3 space-y-1">
        <code className="font-mono text-[12px] text-zinc-300 block">{ip}</code>
        <code className="font-mono text-[11px] text-zinc-500 block">{mac}</code>
      </div>
      <div className="mt-3 flex gap-3 text-[11px]">
        <div className="flex-1">
          <div className="text-zinc-500">RX</div>
          <div className="font-mono text-emerald-300 mt-0.5">{rx.toFixed(1)} Mbps</div>
        </div>
        <div className="flex-1">
          <div className="text-zinc-500">TX</div>
          <div className="font-mono text-cyan-300 mt-0.5">{tx.toFixed(1)} Mbps</div>
        </div>
      </div>
    </div>
  );
}
