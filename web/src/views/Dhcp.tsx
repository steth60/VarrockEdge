import { useEffect, useState } from 'react';
import { Card, Button, IconButton, Modal, Ring, Icon, KV } from '../components/primitives';
import { api } from '../api/client';

interface Lease { hostname: string; ip: string; mac: string; expiry: string; }
interface Reservation { id: number; hostname: string; mac: string; ip: string; lease: string; }
interface Scope { rangeStart: string; rangeEnd: string; leaseTime: string; gateway: string; dnsServers: string; domain: string; }

export function Dhcp() {
  const [leases, setLeases] = useState<Lease[]>([]);
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [scope, setScope] = useState<Scope | null>(null);
  const [converting, setConverting] = useState<Lease | null>(null);
  const [filter, setFilter] = useState('');

  const reload = () => {
    api.get<{ leases: Lease[] }>('/api/dhcp/leases').then(r => setLeases(r.leases)).catch(() => {});
    api.get<{ reservations: Reservation[] }>('/api/dhcp/reservations').then(r => setReservations(r.reservations)).catch(() => {});
    api.get<{ scope: Scope }>('/api/dhcp/scope').then(r => setScope(r.scope)).catch(() => {});
  };

  useEffect(reload, []);

  const filtered = leases.filter(l => !filter || l.hostname.toLowerCase().includes(filter.toLowerCase()) || l.ip.includes(filter));
  const poolCount = scope ? ipsBetween(scope.rangeStart, scope.rangeEnd) : 151;

  const confirmConvert = async () => {
    if (!converting) return;
    try {
      await api.post('/api/dhcp/reservations', {
        hostname: converting.hostname,
        mac: converting.mac,
        ip: converting.ip,
        lease: '24h',
      });
      setConverting(null);
      reload();
    } catch (err: any) {
      alert(err?.message ?? 'failed');
    }
  };

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card title="DHCP Range" subtitle="dnsmasq scope on eth1" className="lg:col-span-1">
          <div className="font-mono text-[20px] tracking-tight text-cyan-300">
            {scope ? `${scope.rangeStart} — ${scope.rangeEnd}` : '10.0.0.50 — 10.0.0.200'}
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2 text-[12px]">
            <KV k="Lease time" v={scope?.leaseTime ?? '24h'} mono />
            <KV k="Gateway"    v={scope?.gateway ?? '10.0.0.1'} mono />
            <KV k="DNS"        v={scope?.dnsServers ?? '10.0.0.1, 1.1.1.1'} mono />
            <KV k="Domain"     v={scope?.domain ?? 'varrok.local'} mono />
          </div>
          <div className="mt-4 flex gap-2">
            <Button variant="secondary" size="sm" icon="Settings2">Edit scope</Button>
            <Button variant="ghost" size="sm" icon="RefreshCw" onClick={reload}>Reload</Button>
          </div>
        </Card>

        <Card title="Pool Utilization" subtitle="Leases in use" className="lg:col-span-1">
          <div className="flex items-center gap-5">
            <Ring value={Math.round((leases.length / poolCount) * 100)} color="#22d3ee" size={84} />
            <div>
              <div className="font-display text-[28px] font-semibold text-zinc-100 leading-none">{leases.length}<span className="text-zinc-500 text-[16px]"> / {poolCount}</span></div>
              <p className="text-[11.5px] text-zinc-500 mt-1.5">{poolCount - leases.length} addresses available</p>
              <div className="mt-3 flex gap-1">
                {Array.from({ length: 30 }).map((_, i) => (
                  <span key={i} className="h-3 flex-1 rounded-sm" style={{
                    background: i < Math.round((leases.length / poolCount) * 30) ? '#22d3ee' : 'rgba(63,63,70,0.5)',
                  }} />
                ))}
              </div>
            </div>
          </div>
        </Card>

        <Card title="Static Reservations" subtitle="MAC → IP bindings" className="lg:col-span-1">
          <div className="flex items-center gap-4">
            <div className="font-display text-[34px] font-semibold leading-none text-zinc-100">{reservations.length}</div>
            <div className="text-[11.5px] text-zinc-500 leading-relaxed">pinned hosts<br/>via dnsmasq.d/static.conf</div>
          </div>
          <div className="mt-4 space-y-1.5">
            {reservations.slice(0, 6).map(r => (
              <div key={r.id} className="flex items-center justify-between text-[11.5px] font-mono">
                <span className="text-zinc-300">{r.hostname}</span>
                <span className="text-cyan-300">{r.ip}</span>
              </div>
            ))}
            {reservations.length === 0 && <div className="text-[11.5px] text-zinc-600 italic">No reservations yet — click "Convert to Static" on any lease.</div>}
          </div>
        </Card>
      </div>

      <Card title="Active DHCP Leases" subtitle={`${leases.length} clients connected to 10.0.0.0/24`}
            action={
              <div className="flex items-center gap-2">
                <div className="relative">
                  <Icon name="Search" size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-500" />
                  <input
                    value={filter}
                    onChange={(e) => setFilter(e.target.value)}
                    className="h-8 pl-7 pr-3 rounded-md bg-zinc-900/60 border border-zinc-800/70 text-[12px] placeholder:text-zinc-600 w-48"
                    placeholder="Filter hostname…"
                  />
                </div>
                <Button variant="secondary" size="sm" icon="FileDown">Export CSV</Button>
              </div>
            }>
        <div className="overflow-x-auto -mx-5">
          <table className="w-full text-[12.5px]">
            <thead>
              <tr className="text-left text-[10.5px] uppercase tracking-[0.08em] text-zinc-500 border-b border-zinc-800/70">
                <th className="font-medium py-2.5 px-5">Hostname</th>
                <th className="font-medium py-2.5 px-3">IP Address</th>
                <th className="font-medium py-2.5 px-3">MAC Address</th>
                <th className="font-medium py-2.5 px-3">Expires</th>
                <th className="font-medium py-2.5 px-5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/60">
              {filtered.map((l) => (
                <tr key={l.mac} className="hover:bg-zinc-900/30 transition-colors group">
                  <td className="py-3 px-5">
                    <div className="flex items-center gap-2">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0" />
                      <span className="text-zinc-100">{l.hostname}</span>
                    </div>
                  </td>
                  <td className="py-3 px-3 font-mono text-cyan-300">{l.ip}</td>
                  <td className="py-3 px-3 font-mono text-zinc-400">{l.mac}</td>
                  <td className="py-3 px-3 font-mono text-zinc-400">{l.expiry}</td>
                  <td className="py-3 px-5 text-right">
                    <div className="inline-flex items-center gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
                      <Button variant="ghost" size="sm" icon="Pin" onClick={() => setConverting(l)}>Convert to Static</Button>
                      <IconButton name="MoreHorizontal" label="More" size="sm" />
                    </div>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr><td colSpan={5} className="py-8 text-center text-[12px] text-zinc-600">No leases match.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      <Modal
        open={!!converting}
        onClose={() => setConverting(null)}
        title="Convert lease to static reservation"
        subtitle="Pins this MAC to its current IP — written to /etc/dnsmasq.d/static.conf"
        footer={
          <>
            <Button variant="ghost" onClick={() => setConverting(null)}>Cancel</Button>
            <Button variant="primary" icon="Pin" onClick={confirmConvert}>Confirm reservation</Button>
          </>
        }>
        {converting && (
          <div className="space-y-3 font-mono text-[12px]">
            <div className="grid grid-cols-2 gap-3">
              <KV k="Hostname" v={converting.hostname} mono />
              <KV k="MAC" v={converting.mac} mono />
              <KV k="IP" v={converting.ip} mono />
              <KV k="Expires" v={converting.expiry} mono />
            </div>
            <div className="mt-3 p-3 rounded-lg bg-zinc-950/60 border border-zinc-800/60 text-[11.5px]">
              <div className="text-zinc-500 mb-1">// dnsmasq.d/static.conf</div>
              <div className="text-cyan-300">dhcp-host={converting.mac},{converting.hostname},{converting.ip},24h</div>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

function ipsBetween(a: string, b: string): number {
  const toN = (s: string) => s.split('.').reduce((acc, oct) => (acc << 8) + Number(oct), 0) >>> 0;
  return Math.max(0, toN(b) - toN(a) + 1);
}
