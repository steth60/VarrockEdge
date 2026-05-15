import { useEffect, useState } from 'react';
import { Card, Button, IconButton, Modal, Ring, Icon, KV, Field, Input, Badge } from '../components/primitives';
import { api } from '../api/client';

interface Lease {
  hostname: string; ip: string; mac: string; expiry: string; expiresAt: number;
  networkId: number | null; networkName: string | null; vlanId: number | null;
}
interface Reservation { id: number; hostname: string; mac: string; ip: string; lease: string; }
interface Scope { rangeStart: string; rangeEnd: string; leaseTime: string; gateway: string; dnsServers: string; domain: string; }
interface DiscoveredHost { ip: string; mac: string | null; hostname: string | null; source: 'lease' | 'reservation' | 'static'; responded: boolean; }
interface ScanResult { scanned: number; responded: number; hosts: DiscoveredHost[]; cidr: string; durationMs: number; }
interface NetOption { id: number; name: string; vlanId: number | null }

// Best-effort vendor hint from the MAC OUI (first 3 octets). Not exhaustive —
// unmatched prefixes bucket as "Unknown".
const OUI_VENDORS: Record<string, string> = {
  'F0:9F:C2': 'Ubiquiti', '24:5A:4C': 'Ubiquiti', '78:8A:20': 'Ubiquiti', 'FC:EC:DA': 'Ubiquiti',
  '3C:22:FB': 'Apple', 'A4:83:E7': 'Apple', 'F0:18:98': 'Apple', '14:7D:DA': 'Apple', 'BC:D0:74': 'Apple',
  '44:00:10': 'Apple', 'D0:81:7A': 'Apple', '90:DD:5D': 'Apple',
  '18:B4:30': 'Nest', '64:16:66': 'Nest', '38:8B:59': 'Google', '6C:AD:F8': 'Google',
  'FC:A6:67': 'Amazon', '44:65:0D': 'Amazon', '68:54:FD': 'Amazon',
  'B8:27:EB': 'Raspberry Pi', 'DC:A6:32': 'Raspberry Pi', 'E4:5F:01': 'Raspberry Pi',
  '24:0A:C4': 'Espressif', '7C:9E:BD': 'Espressif', 'A0:20:A6': 'Espressif', 'C8:2B:96': 'Espressif',
  '00:1A:11': 'Google', '54:60:09': 'Google',
  '8C:85:90': 'Apple', 'AC:DE:48': 'Apple', 'F4:F5:D8': 'Google',
  '50:C7:BF': 'TP-Link', '00:11:32': 'Synology', '00:1B:21': 'Intel', '00:50:56': 'VMware',
  'BC:24:11': 'Proxmox', '00:15:5D': 'Microsoft',
  '00:0C:29': 'VMware', '52:54:00': 'QEMU/KVM',
};

function vendorOf(mac: string): string {
  const oui = mac.slice(0, 8).toUpperCase();
  return OUI_VENDORS[oui] ?? 'Unknown';
}

export function Dhcp() {
  const [leases, setLeases] = useState<Lease[]>([]);
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [scope, setScope] = useState<Scope | null>(null);
  const [converting, setConverting] = useState<Lease | null>(null);
  const [filter, setFilter] = useState('');
  const [scanning, setScanning] = useState(false);
  const [scanResult, setScanResult] = useState<ScanResult | null>(null);
  const [reserveDraft, setReserveDraft] = useState<DiscoveredHost | null>(null);
  const [reserveHostname, setReserveHostname] = useState('');
  const [reserveMac, setReserveMac] = useState('');
  const [nets, setNets] = useState<NetOption[]>([]);
  const [netFilter, setNetFilter] = useState<Set<number>>(new Set());
  const [vendorFilter, setVendorFilter] = useState<Set<string>>(new Set());
  const [leaseState, setLeaseState] = useState<'all' | 'expiring'>('all');
  const [tab, setTab] = useState<'main' | 'iptable'>('main');

  const reload = () => {
    api.get<{ leases: Lease[] }>('/api/dhcp/leases').then(r => setLeases(r.leases)).catch(() => {});
    api.get<{ reservations: Reservation[] }>('/api/dhcp/reservations').then(r => setReservations(r.reservations)).catch(() => {});
    api.get<{ scope: Scope }>('/api/dhcp/scope').then(r => setScope(r.scope)).catch(() => {});
    api.get<{ networks: NetOption[] }>('/api/networks').then(r => setNets(r.networks)).catch(() => {});
  };

  useEffect(reload, []);

  const toggleSet = <T,>(set: Set<T>, v: T): Set<T> => {
    const next = new Set(set);
    next.has(v) ? next.delete(v) : next.add(v);
    return next;
  };

  const filtered = leases.filter(l => {
    if (filter && !l.hostname.toLowerCase().includes(filter.toLowerCase()) && !l.ip.includes(filter) && !l.mac.includes(filter.toLowerCase())) return false;
    if (netFilter.size > 0 && (l.networkId == null || !netFilter.has(l.networkId))) return false;
    if (vendorFilter.size > 0 && !vendorFilter.has(vendorOf(l.mac))) return false;
    if (leaseState === 'expiring' && l.expiresAt - Date.now() > 3_600_000) return false;
    return true;
  });
  const sortedFiltered = tab === 'iptable'
    ? [...filtered].sort((a, b) => ipNum(a.ip) - ipNum(b.ip))
    : filtered;
  const poolCount = scope ? ipsBetween(scope.rangeStart, scope.rangeEnd) : 151;

  const runScan = async () => {
    setScanning(true);
    setScanResult(null);
    try {
      const r = await api.post<ScanResult>('/api/dhcp/scan', {});
      setScanResult(r);
    } catch (err: any) {
      alert(err?.message ?? 'scan failed');
    } finally {
      setScanning(false);
    }
  };

  const openReserve = (h: DiscoveredHost) => {
    setReserveDraft(h);
    setReserveHostname(h.hostname ?? `static-${h.ip.split('.').pop()}`);
    setReserveMac(h.mac ?? '');
  };

  const confirmReserve = async () => {
    if (!reserveDraft) return;
    if (!/^([0-9a-f]{2}:){5}[0-9a-f]{2}$/i.test(reserveMac)) { alert('Enter a valid MAC (xx:xx:xx:xx:xx:xx)'); return; }
    try {
      await api.post('/api/dhcp/reservations', {
        hostname: reserveHostname,
        mac: reserveMac.toLowerCase(),
        ip: reserveDraft.ip,
        lease: '24h',
      });
      setReserveDraft(null);
      // Update the scan list so the row reflects "reservation".
      setScanResult(s => s ? { ...s, hosts: s.hosts.map(h => h.ip === reserveDraft.ip ? { ...h, source: 'reservation', hostname: reserveHostname, mac: reserveMac.toLowerCase() } : h) } : s);
      reload();
    } catch (err: any) { alert(err?.message ?? 'failed'); }
  };

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

      <Card title="Network Scan" subtitle={scanResult ? `${scanResult.responded} of ${scanResult.scanned} addresses responded · ${scanResult.cidr} · ${(scanResult.durationMs / 1000).toFixed(1)}s` : 'Find devices on the LAN that have static IPs (don’t appear in DHCP)'}
            action={
              <Button variant="primary" size="sm" icon={scanning ? 'Loader2' : 'Radar'} onClick={runScan} disabled={scanning}
                      className={scanning ? '[&_svg]:animate-spin' : ''}>
                {scanning ? 'Scanning…' : (scanResult ? 'Rescan' : 'Scan LAN')}
              </Button>
            }>
        {!scanResult && !scanning && (
          <p className="text-[12px] text-zinc-500 leading-relaxed">
            Pings every address in the LAN subnet, then reads the kernel ARP table to discover MACs.
            Addresses that respond but don't appear in <code className="font-mono text-cyan-300">dnsmasq.leases</code> are flagged as <strong>static</strong> — those are the devices configured outside DHCP.
            Use <strong>Reserve</strong> on a static row to pin it.
          </p>
        )}
        {scanning && (
          <div className="flex items-center gap-3 py-2">
            <span className="shimmer h-2 rounded flex-1" />
            <span className="text-[11px] font-mono text-zinc-500">probing /24…</span>
          </div>
        )}
        {scanResult && (
          <div className="overflow-x-auto -mx-5">
            <table className="w-full text-[12.5px]">
              <thead>
                <tr className="text-left text-[10.5px] uppercase tracking-[0.08em] text-zinc-500 border-b border-zinc-800/70">
                  <th className="font-medium py-2.5 px-5">IP</th>
                  <th className="font-medium py-2.5 px-3">MAC</th>
                  <th className="font-medium py-2.5 px-3">Hostname</th>
                  <th className="font-medium py-2.5 px-3">Source</th>
                  <th className="font-medium py-2.5 px-5 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800/60">
                {scanResult.hosts.map(h => (
                  <tr key={h.ip} className="hover:bg-zinc-900/30 group">
                    <td className="py-3 px-5 font-mono text-cyan-300">{h.ip}</td>
                    <td className="py-3 px-3 font-mono text-zinc-400">{h.mac ?? <span className="text-zinc-700">— (ARP miss)</span>}</td>
                    <td className="py-3 px-3 text-zinc-300">{h.hostname ?? <span className="text-zinc-700">—</span>}</td>
                    <td className="py-3 px-3">
                      {h.source === 'static'      ? <Badge variant="warn"    size="sm" icon="AlertTriangle">static (not in DHCP)</Badge>
                       : h.source === 'lease'       ? <Badge variant="success" size="sm" icon="Plug">DHCP lease</Badge>
                       :                              <Badge variant="info"    size="sm" icon="Pin">reservation</Badge>}
                    </td>
                    <td className="py-3 px-5 text-right">
                      {h.source === 'static' && h.mac && (
                        <Button variant="ghost" size="sm" icon="Pin" onClick={() => openReserve(h)}>Reserve</Button>
                      )}
                      {h.source === 'static' && !h.mac && (
                        <span className="text-[11px] text-zinc-600">ARP missing</span>
                      )}
                    </td>
                  </tr>
                ))}
                {scanResult.hosts.length === 0 && (
                  <tr><td colSpan={5} className="py-8 text-center text-[12px] text-zinc-600">Nothing responded.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <div className="grid grid-cols-12 gap-4">
        <aside className="col-span-12 lg:col-span-3">
          <LeaseFilters
            leases={leases} nets={nets}
            filter={filter} setFilter={setFilter}
            netFilter={netFilter} setNetFilter={setNetFilter}
            vendorFilter={vendorFilter} setVendorFilter={setVendorFilter}
            leaseState={leaseState} setLeaseState={setLeaseState}
            toggleSet={toggleSet}
          />
        </aside>

        <div className="col-span-12 lg:col-span-9">
          <Card
            title="Client Leases"
            subtitle={`${filtered.length} of ${leases.length} leases${netFilter.size || vendorFilter.size || filter || leaseState !== 'all' ? ' (filtered)' : ''}`}
            action={
              <div className="flex items-center gap-2">
                <div className="flex items-center gap-1 p-0.5 rounded-md bg-zinc-900/60 border border-zinc-800/70">
                  {(['main', 'iptable'] as const).map(t => (
                    <button key={t} onClick={() => setTab(t)}
                            className={`h-7 px-2.5 rounded text-[11.5px] font-medium transition-colors ${tab === t ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-400 hover:text-zinc-200'}`}>
                      {t === 'main' ? 'Main' : 'IP Table'}
                    </button>
                  ))}
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
                    <th className="font-medium py-2.5 px-3">Network</th>
                    <th className="font-medium py-2.5 px-3">Vendor</th>
                    <th className="font-medium py-2.5 px-3">Expires</th>
                    {tab === 'main' && <th className="font-medium py-2.5 px-5 text-right">Actions</th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-800/60">
                  {sortedFiltered.map((l) => {
                    const expiringSoon = l.expiresAt - Date.now() < 3_600_000;
                    return (
                      <tr key={l.mac} className="hover:bg-zinc-900/30 transition-colors group">
                        <td className="py-3 px-5">
                          <div className="flex items-center gap-2">
                            <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${expiringSoon ? 'bg-amber-400' : 'bg-emerald-400'}`} />
                            <span className="text-zinc-100">{l.hostname}</span>
                          </div>
                        </td>
                        <td className="py-3 px-3 font-mono text-cyan-300">{l.ip}</td>
                        <td className="py-3 px-3 font-mono text-zinc-400">{l.mac}</td>
                        <td className="py-3 px-3">
                          {l.networkName
                            ? <span className="text-zinc-300">{l.networkName}{l.vlanId ? <span className="text-zinc-500 font-mono"> · VLAN {l.vlanId}</span> : null}</span>
                            : <span className="text-zinc-600">—</span>}
                        </td>
                        <td className="py-3 px-3 text-zinc-400">{vendorOf(l.mac)}</td>
                        <td className="py-3 px-3 font-mono text-zinc-400">{l.expiry}</td>
                        {tab === 'main' && (
                          <td className="py-3 px-5 text-right">
                            <div className="inline-flex items-center gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
                              <Button variant="ghost" size="sm" icon="Pin" onClick={() => setConverting(l)}>Convert to Static</Button>
                              <IconButton name="MoreHorizontal" label="More" size="sm" />
                            </div>
                          </td>
                        )}
                      </tr>
                    );
                  })}
                  {sortedFiltered.length === 0 && (
                    <tr><td colSpan={tab === 'main' ? 7 : 6} className="py-8 text-center text-[12px] text-zinc-600">
                      {leases.length === 0 ? 'No active leases.' : 'No leases match the current filters.'}
                    </td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      </div>

      <Modal
        open={!!reserveDraft}
        onClose={() => setReserveDraft(null)}
        title="Reserve discovered host"
        subtitle="Pin this MAC to this IP — written to /etc/dnsmasq.d/static.conf"
        footer={
          <>
            <Button variant="ghost" onClick={() => setReserveDraft(null)}>Cancel</Button>
            <Button variant="primary" icon="Pin" onClick={confirmReserve}>Confirm reservation</Button>
          </>
        }>
        {reserveDraft && (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <KV k="IP"     v={reserveDraft.ip} mono />
              <KV k="Source" v={reserveDraft.source} />
            </div>
            <Field label="Hostname">
              <Input value={reserveHostname} onChange={(e) => setReserveHostname(e.target.value)} />
            </Field>
            <Field label="MAC address" hint={reserveDraft.mac ? 'Pre-filled from ARP — edit only if wrong.' : 'ARP didn’t see this host. Enter manually.'}>
              <Input mono value={reserveMac} onChange={(e) => setReserveMac(e.target.value)} placeholder="aa:bb:cc:dd:ee:ff" />
            </Field>
            <div className="mt-2 p-3 rounded-lg bg-zinc-950/60 border border-zinc-800/60 text-[11.5px]">
              <div className="text-zinc-500 mb-1">// dnsmasq.d/static.conf</div>
              <div className="text-cyan-300 font-mono">dhcp-host={reserveMac || '<MAC>'},{reserveHostname || '<host>'},{reserveDraft.ip},24h</div>
            </div>
          </div>
        )}
      </Modal>

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
  return Math.max(0, ipNum(b) - ipNum(a) + 1);
}

function ipNum(s: string): number {
  return s.split('.').reduce((acc, oct) => (acc << 8) + Number(oct), 0) >>> 0;
}

interface LeaseFiltersProps {
  leases: Lease[];
  nets: NetOption[];
  filter: string; setFilter: (v: string) => void;
  netFilter: Set<number>; setNetFilter: (s: Set<number>) => void;
  vendorFilter: Set<string>; setVendorFilter: (s: Set<string>) => void;
  leaseState: 'all' | 'expiring'; setLeaseState: (v: 'all' | 'expiring') => void;
  toggleSet: <T>(set: Set<T>, v: T) => Set<T>;
}

function LeaseFilters({
  leases, nets, filter, setFilter, netFilter, setNetFilter,
  vendorFilter, setVendorFilter, leaseState, setLeaseState, toggleSet,
}: LeaseFiltersProps) {
  const netCount = (id: number) => leases.filter(l => l.networkId === id).length;
  const vendorCounts = leases.reduce<Record<string, number>>((acc, l) => {
    const v = vendorOf(l.mac);
    acc[v] = (acc[v] ?? 0) + 1;
    return acc;
  }, {});
  const vendors = Object.entries(vendorCounts).sort((a, b) => b[1] - a[1]);
  const expiringCount = leases.filter(l => l.expiresAt - Date.now() < 3_600_000).length;
  const anyActive = filter || netFilter.size > 0 || vendorFilter.size > 0 || leaseState !== 'all';

  const Check = ({ on, label, count, onClick }: { on: boolean; label: string; count: number; onClick: () => void }) => (
    <button onClick={onClick} className="w-full flex items-center gap-2 py-1 text-[12px] hover:text-zinc-100 transition-colors">
      <span className={`w-3.5 h-3.5 rounded-[3px] border flex items-center justify-center shrink-0 ${on ? 'bg-cyan-400 border-cyan-400' : 'border-zinc-600'}`}>
        {on && <Icon name="Check" size={10} className="text-zinc-950" />}
      </span>
      <span className={`flex-1 text-left ${on ? 'text-zinc-100' : 'text-zinc-400'}`}>{label}</span>
      <span className="font-mono text-[10.5px] text-zinc-500">{count}</span>
    </button>
  );

  return (
    <div className="glass rounded-xl p-4 sticky top-4 space-y-4">
      <div className="relative">
        <Icon name="Search" size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-500" />
        <input value={filter} onChange={(e) => setFilter(e.target.value)}
               placeholder="Search host / IP / MAC"
               className="w-full h-8 pl-7 pr-3 rounded-md bg-zinc-900/60 border border-zinc-800/70 text-[12px] placeholder:text-zinc-600 focus:border-cyan-400/50 transition-colors" />
      </div>

      <div>
        <div className="text-[10px] uppercase tracking-[0.1em] text-zinc-500 font-medium mb-1.5">Lease state</div>
        {(['all', 'expiring'] as const).map(s => (
          <button key={s} onClick={() => setLeaseState(s)}
                  className="w-full flex items-center gap-2 py-1 text-[12px] transition-colors">
            <span className={`w-3 h-3 rounded-full border flex items-center justify-center shrink-0 ${leaseState === s ? 'border-cyan-400' : 'border-zinc-600'}`}>
              {leaseState === s && <span className="w-1.5 h-1.5 rounded-full bg-cyan-400" />}
            </span>
            <span className={`flex-1 text-left ${leaseState === s ? 'text-zinc-100' : 'text-zinc-400'}`}>
              {s === 'all' ? 'All leases' : 'Expiring < 1h'}
            </span>
            {s === 'expiring' && <span className="font-mono text-[10.5px] text-zinc-500">{expiringCount}</span>}
          </button>
        ))}
      </div>

      <div>
        <div className="text-[10px] uppercase tracking-[0.1em] text-zinc-500 font-medium mb-1.5">Network / VLAN</div>
        {nets.length === 0 && <div className="text-[11px] text-zinc-600 py-1">no networks</div>}
        {nets.map(n => (
          <Check key={n.id} on={netFilter.has(n.id)} count={netCount(n.id)}
                 label={n.vlanId ? `${n.name} (${n.vlanId})` : n.name}
                 onClick={() => setNetFilter(toggleSet(netFilter, n.id))} />
        ))}
      </div>

      <div>
        <div className="text-[10px] uppercase tracking-[0.1em] text-zinc-500 font-medium mb-1.5">Vendor</div>
        {vendors.length === 0 && <div className="text-[11px] text-zinc-600 py-1">no leases</div>}
        {vendors.map(([v, c]) => (
          <Check key={v} on={vendorFilter.has(v)} count={c} label={v}
                 onClick={() => setVendorFilter(toggleSet(vendorFilter, v))} />
        ))}
      </div>

      {anyActive && (
        <button onClick={() => { setFilter(''); setNetFilter(new Set()); setVendorFilter(new Set()); setLeaseState('all'); }}
                className="text-[11.5px] text-cyan-300 hover:text-cyan-200 transition-colors">
          Clear all filters
        </button>
      )}
    </div>
  );
}
