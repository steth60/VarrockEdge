import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Card, Button, Modal, Field, Input, Select, Badge, Icon } from '../components/primitives';
import { api } from '../api/client';

interface Client {
  hostname: string;
  ip: string;
  mac: string;
  networkId: number | null;
  networkName: string | null;
  vlanId: number | null;
  leaseType: 'dynamic' | 'fixed' | 'static';
  status: 'online' | 'offline';
  expiresAt: number | null;
  localDns: string | null;
  traffic1h: number | null;
}
interface VNet {
  id: number; name: string; vlanId: number | null; subnet: string;
  leasesUsed: number; leasesTotal: number;
}
interface DiscoveredHost { ip: string; mac: string | null; hostname: string | null; source: 'lease' | 'reservation' | 'static'; responded: boolean }
interface ScanResult { scanned: number; responded: number; hosts: DiscoveredHost[]; cidr: string; durationMs: number }

// Best-effort vendor hint from the MAC OUI (first 3 octets).
const OUI_VENDORS: Record<string, string> = {
  'F0:9F:C2': 'Ubiquiti', '24:5A:4C': 'Ubiquiti', '78:8A:20': 'Ubiquiti', 'FC:EC:DA': 'Ubiquiti',
  '3C:22:FB': 'Apple', 'A4:83:E7': 'Apple', 'F0:18:98': 'Apple', '14:7D:DA': 'Apple', 'BC:D0:74': 'Apple',
  '44:00:10': 'Apple', 'D0:81:7A': 'Apple', '90:DD:5D': 'Apple', '8C:85:90': 'Apple', 'AC:DE:48': 'Apple',
  '18:B4:30': 'Nest', '64:16:66': 'Nest', '38:8B:59': 'Google', '6C:AD:F8': 'Google',
  '00:1A:11': 'Google', '54:60:09': 'Google', 'F4:F5:D8': 'Google',
  'FC:A6:67': 'Amazon', '44:65:0D': 'Amazon', '68:54:FD': 'Amazon',
  'B8:27:EB': 'Raspberry Pi', 'DC:A6:32': 'Raspberry Pi', 'E4:5F:01': 'Raspberry Pi',
  '24:0A:C4': 'Espressif', '7C:9E:BD': 'Espressif', 'A0:20:A6': 'Espressif', 'C8:2B:96': 'Espressif',
  '50:C7:BF': 'TP-Link', '00:11:32': 'Synology', '00:1B:21': 'Intel', '00:50:56': 'VMware',
  'BC:24:11': 'Proxmox', '00:15:5D': 'Microsoft', '00:0C:29': 'VMware', '52:54:00': 'QEMU/KVM',
};
const vendorOf = (mac: string): string => OUI_VENDORS[mac.slice(0, 8).toUpperCase()] ?? 'Unknown';

const ipNum = (s: string): number => s.split('.').reduce((a, o) => (a << 8) + Number(o), 0) >>> 0;
const macTail = (mac: string): string => mac.split(':').slice(-2).join(':');

function ipInCidr(ip: string, cidr: string): boolean {
  const [base, bitsS] = cidr.split('/');
  if (!base) return false;
  const bits = Number(bitsS);
  if (!Number.isFinite(bits)) return false;
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return (ipNum(ip) & mask) === (ipNum(base) & mask);
}

function expiryLabel(ts: number | null): string {
  if (ts === null) return '—';
  const d = (ts - Date.now()) / 1000;
  if (d <= 0) return 'expired';
  if (d < 3600) return `${Math.round(d / 60)}m`;
  if (d < 86400) return `${Math.round(d / 3600)}h`;
  return `${Math.round(d / 86400)}d`;
}

function bytesLabel(n: number | null): string {
  if (n === null || n === 0) return '—';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  let v = n, i = 0;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(v < 10 && i > 0 ? 1 : 0)} ${u[i]}`;
}

const displayName = (c: Client): string =>
  c.hostname && c.hostname !== 'unknown' ? c.hostname : `${vendorOf(c.mac)} device`;

export function Dhcp() {
  const [clients, setClients] = useState<Client[]>([]);
  const [scanned, setScanned] = useState<Client[]>([]);   // static hosts found by a scan
  const [nets, setNets] = useState<VNet[]>([]);
  const [tab, setTab] = useState<'main' | 'iptable'>('main');
  const [netSel, setNetSel] = useState<'all' | number>('all');
  const [search, setSearch] = useState('');
  const [statusF, setStatusF] = useState<Set<string>>(new Set());
  const [typeF, setTypeF] = useState<Set<string>>(new Set());
  const [vendorF, setVendorF] = useState<Set<string>>(new Set());
  const [scanning, setScanning] = useState(false);
  const [reserve, setReserve] = useState<{ hostname: string; mac: string; ip: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const reload = () => {
    api.get<{ clients: Client[] }>('/api/dhcp/clients').then(r => setClients(r.clients)).catch(() => {});
    api.get<{ networks: VNet[] }>('/api/networks').then(r => setNets(r.networks)).catch(() => {});
  };
  useEffect(reload, []);

  const all = useMemo(() => {
    // Merge scan-discovered static hosts that aren't already known.
    const known = new Set(clients.map(c => c.mac));
    return [...clients, ...scanned.filter(s => !known.has(s.mac))];
  }, [clients, scanned]);

  // Stage 1 — network filter (drives the rail counts).
  const inNet = all.filter(c => netSel === 'all' || c.networkId === netSel);

  const toggle = <T,>(set: Set<T>, v: T): Set<T> => {
    const n = new Set(set);
    n.has(v) ? n.delete(v) : n.add(v);
    return n;
  };

  // Stage 2 — rail filters + search.
  const rows = inNet.filter(c => {
    if (statusF.size && !statusF.has(c.status)) return false;
    if (typeF.size && !typeF.has(c.leaseType)) return false;
    if (vendorF.size && !vendorF.has(vendorOf(c.mac))) return false;
    if (search) {
      const q = search.toLowerCase();
      if (!displayName(c).toLowerCase().includes(q) && !c.ip.includes(q) && !c.mac.includes(q)) return false;
    }
    return true;
  });
  const sorted = [...rows].sort((a, b) => ipNum(a.ip) - ipNum(b.ip));

  const count = (pred: (c: Client) => boolean) => inNet.filter(pred).length;
  const vendorBuckets = useMemo(() => {
    const m: Record<string, number> = {};
    for (const c of inNet) { const v = vendorOf(c.mac); m[v] = (m[v] ?? 0) + 1; }
    return Object.entries(m).sort((a, b) => b[1] - a[1]);
  }, [inNet]);

  const anyFilter = search || statusF.size || typeF.size || vendorF.size;
  const clearAll = () => { setSearch(''); setStatusF(new Set()); setTypeF(new Set()); setVendorF(new Set()); };

  const runScan = async () => {
    setScanning(true);
    try {
      const r = await api.post<ScanResult>('/api/dhcp/scan', {});
      const statics: Client[] = r.hosts.filter(h => h.source === 'static' && h.mac).map(h => {
        const net = nets.find(n => ipInCidr(h.ip, n.subnet));
        return {
          hostname: h.hostname ?? 'unknown', ip: h.ip, mac: h.mac!.toLowerCase(),
          networkId: net?.id ?? null, networkName: net?.name ?? null, vlanId: net?.vlanId ?? null,
          leaseType: 'static', status: 'online', expiresAt: null, localDns: null, traffic1h: null,
        };
      });
      setScanned(statics);
    } catch (e: any) { alert(e?.message ?? 'scan failed'); }
    finally { setScanning(false); }
  };

  const exportCsv = () => {
    const head = ['Hostname', 'IP', 'MAC', 'Network', 'VLAN', 'Type', 'Status', 'Local DNS', 'Expires'];
    const lines = sorted.map(c => [
      displayName(c), c.ip, c.mac, c.networkName ?? '', c.vlanId ?? '',
      c.leaseType, c.status, c.localDns ?? '', c.expiresAt ? new Date(c.expiresAt).toISOString() : '',
    ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(','));
    const blob = new Blob([[head.join(','), ...lines].join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `varrok-clients-${Date.now()}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  const submitReserve = async () => {
    if (!reserve) return;
    if (!reserve.hostname.trim() || !/^([0-9a-f]{2}:){5}[0-9a-f]{2}$/i.test(reserve.mac) || !/^(\d{1,3}\.){3}\d{1,3}$/.test(reserve.ip)) {
      alert('Enter a hostname, a valid MAC and a valid IP.');
      return;
    }
    setBusy(true);
    try {
      await api.post('/api/dhcp/reservations', {
        hostname: reserve.hostname.trim(), mac: reserve.mac.toLowerCase(), ip: reserve.ip, lease: '24h',
      });
      setReserve(null);
      reload();
    } catch (e: any) { alert(e?.message ?? 'failed'); }
    finally { setBusy(false); }
  };

  const selNet = typeof netSel === 'number' ? nets.find(n => n.id === netSel) : null;

  return (
    <div className="grid grid-cols-12 gap-4">
      <aside className="col-span-12 lg:col-span-3">
        <div className="glass rounded-xl p-4 sticky top-4 space-y-4">
          {/* Network selector */}
          <div>
            <div className="text-[10px] uppercase tracking-[0.1em] text-zinc-500 font-medium mb-1.5">Network</div>
            <Select value={String(netSel)} onChange={(e) => setNetSel(e.target.value === 'all' ? 'all' : Number(e.target.value))}>
              <option value="all">All networks ({nets.length})</option>
              {nets.map(n => (
                <option key={n.id} value={n.id}>{n.name}{n.vlanId ? ` · VLAN ${n.vlanId}` : ''}</option>
              ))}
            </Select>
            {selNet && (
              <div className="mt-1.5 text-[11px] text-zinc-500 font-mono">
                {selNet.subnet} · {selNet.leasesUsed}/{selNet.leasesTotal} leases
              </div>
            )}
          </div>

          <div className="relative">
            <Icon name="Search" size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-500" />
            <input value={search} onChange={(e) => setSearch(e.target.value)}
                   placeholder="Search host / IP / MAC"
                   className="w-full h-8 pl-7 pr-3 rounded-md bg-zinc-900/60 border border-zinc-800/70 text-[12px] placeholder:text-zinc-600 focus:border-cyan-400/50 transition-colors" />
          </div>

          <FilterGroup title="Status">
            <Check label="Online" count={count(c => c.status === 'online')} on={statusF.has('online')} onClick={() => setStatusF(s => toggle(s, 'online'))} />
            <Check label="Offline" count={count(c => c.status === 'offline')} on={statusF.has('offline')} onClick={() => setStatusF(s => toggle(s, 'offline'))} />
          </FilterGroup>

          <FilterGroup title="Lease type">
            <Check label="Dynamic" count={count(c => c.leaseType === 'dynamic')} on={typeF.has('dynamic')} onClick={() => setTypeF(s => toggle(s, 'dynamic'))} />
            <Check label="Fixed" count={count(c => c.leaseType === 'fixed')} on={typeF.has('fixed')} onClick={() => setTypeF(s => toggle(s, 'fixed'))} />
            {count(c => c.leaseType === 'static') > 0 &&
              <Check label="Static (scanned)" count={count(c => c.leaseType === 'static')} on={typeF.has('static')} onClick={() => setTypeF(s => toggle(s, 'static'))} />}
          </FilterGroup>

          <FilterGroup title="Vendor">
            {vendorBuckets.length === 0 && <div className="text-[11px] text-zinc-600 py-1">no clients</div>}
            {vendorBuckets.map(([v, c]) => (
              <Check key={v} label={v} count={c} on={vendorF.has(v)} onClick={() => setVendorF(s => toggle(s, v))} />
            ))}
          </FilterGroup>

          <div className="pt-1 space-y-1.5 border-t border-zinc-800/60">
            {anyFilter && (
              <button onClick={clearAll} className="text-[11.5px] text-cyan-300 hover:text-cyan-200">Clear filters</button>
            )}
            <div className="flex flex-col gap-1.5 pt-1">
              <Button variant="ghost" size="sm" icon={scanning ? 'Loader2' : 'Radar'} onClick={runScan} disabled={scanning}
                      className={`justify-start ${scanning ? '[&_svg]:animate-spin' : ''}`}>
                {scanning ? 'Scanning…' : 'Scan for static hosts'}
              </Button>
              <Button variant="ghost" size="sm" icon="FileDown" onClick={exportCsv} className="justify-start">Export CSV</Button>
              <Button variant="ghost" size="sm" icon="Plus" onClick={() => setReserve({ hostname: '', mac: '', ip: '' })} className="justify-start">Add Fixed IP Client</Button>
            </div>
          </div>
        </div>
      </aside>

      <div className="col-span-12 lg:col-span-9">
        <Card
          title="Clients"
          subtitle={`${sorted.length} of ${inNet.length}${anyFilter ? ' (filtered)' : ''}`}
          action={
            <div className="flex items-center gap-1 p-0.5 rounded-md bg-zinc-900/60 border border-zinc-800/70">
              {(['main', 'iptable'] as const).map(t => (
                <button key={t} onClick={() => setTab(t)}
                        className={`h-7 px-2.5 rounded text-[11.5px] font-medium transition-colors ${tab === t ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-400 hover:text-zinc-200'}`}>
                  {t === 'main' ? 'Main' : 'IP Table'}
                </button>
              ))}
            </div>
          }>
          <div className="overflow-x-auto -mx-5">
            <table className="w-full text-[12.5px]">
              <thead>
                <tr className="text-left text-[10.5px] uppercase tracking-[0.08em] text-zinc-500 border-b border-zinc-800/70">
                  {tab === 'main' ? (
                    <>
                      <Th pl>Name</Th><Th>Vendor</Th><Th>Network</Th><Th>IP Address</Th><Th>Traffic (1h)</Th><Th>Status</Th>
                      <th className="py-2.5 px-5" />
                    </>
                  ) : (
                    <>
                      <Th pl>Name</Th><Th>Hostname</Th><Th>Local DNS</Th><Th>Status</Th>
                      <Th>IP Address</Th><Th>MAC Address</Th><Th>Lease Type</Th><Th>Expires</Th>
                    </>
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800/60">
                {sorted.map(c => (
                  <tr key={c.mac} className="hover:bg-zinc-900/30 group">
                    {tab === 'main' ? (
                      <>
                        <td className="py-3 px-5">
                          <span className="inline-flex items-center gap-2">
                            <StatusDot status={c.status} />
                            <span className="text-zinc-100">{displayName(c)}</span>
                            <span className="font-mono text-[10px] text-zinc-600">{macTail(c.mac)}</span>
                          </span>
                        </td>
                        <td className="py-3 px-3 text-zinc-400">{vendorOf(c.mac)}</td>
                        <td className="py-3 px-3">{netCell(c)}</td>
                        <td className="py-3 px-3 font-mono text-cyan-300">{c.ip}</td>
                        <td className="py-3 px-3 font-mono text-zinc-400">{bytesLabel(c.traffic1h)}</td>
                        <td className="py-3 px-3">{statusCell(c.status)}</td>
                        <td className="py-3 px-5 text-right">
                          {c.leaseType === 'dynamic' && (
                            <Button variant="ghost" size="sm" icon="Pin"
                                    className="opacity-0 group-hover:opacity-100 transition-opacity"
                                    onClick={() => setReserve({ hostname: c.hostname === 'unknown' ? '' : c.hostname, mac: c.mac, ip: c.ip })}>
                              Reserve
                            </Button>
                          )}
                        </td>
                      </>
                    ) : (
                      <>
                        <td className="py-3 px-5">
                          <span className="inline-flex items-center gap-2">
                            <StatusDot status={c.status} />
                            <span className="text-zinc-100">{displayName(c)}</span>
                            <span className="font-mono text-[10px] text-zinc-600">{macTail(c.mac)}</span>
                          </span>
                        </td>
                        <td className="py-3 px-3 text-zinc-400">{c.hostname === 'unknown' ? '—' : c.hostname}</td>
                        <td className="py-3 px-3 font-mono text-zinc-400">{c.localDns ?? '—'}</td>
                        <td className="py-3 px-3">{statusCell(c.status)}</td>
                        <td className="py-3 px-3 font-mono text-cyan-300">{c.ip}</td>
                        <td className="py-3 px-3 font-mono text-zinc-400">{c.mac}</td>
                        <td className="py-3 px-3">
                          <Badge variant={c.leaseType === 'fixed' ? 'info' : c.leaseType === 'static' ? 'warn' : 'neutral'} size="sm">
                            {c.leaseType}
                          </Badge>
                        </td>
                        <td className="py-3 px-3 font-mono text-zinc-400">{expiryLabel(c.expiresAt)}</td>
                      </>
                    )}
                  </tr>
                ))}
                {sorted.length === 0 && (
                  <tr><td colSpan={8} className="py-10 text-center text-[12px] text-zinc-600">
                    {all.length === 0 ? 'No clients — no leases or reservations yet.' : 'No clients match the current filters.'}
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>
      </div>

      <Modal
        open={reserve != null}
        onClose={() => setReserve(null)}
        title="Fixed IP reservation"
        subtitle="Pin a MAC to an IP — written to /etc/dnsmasq.d/static.conf"
        footer={<>
          <Button variant="ghost" onClick={() => setReserve(null)}>Cancel</Button>
          <Button variant="primary" icon="Pin" onClick={submitReserve} disabled={busy}>{busy ? 'Saving…' : 'Save reservation'}</Button>
        </>}>
        {reserve && (
          <div className="space-y-3">
            <Field label="Hostname">
              <Input value={reserve.hostname} onChange={(e) => setReserve({ ...reserve, hostname: e.target.value })} placeholder="callum-laptop" />
            </Field>
            <Field label="MAC address">
              <Input mono value={reserve.mac} onChange={(e) => setReserve({ ...reserve, mac: e.target.value })} placeholder="aa:bb:cc:dd:ee:ff" />
            </Field>
            <Field label="IP address">
              <Input mono value={reserve.ip} onChange={(e) => setReserve({ ...reserve, ip: e.target.value })} placeholder="10.0.0.50" />
            </Field>
            <div className="p-3 rounded-lg bg-zinc-950/60 border border-zinc-800/60 text-[11.5px]">
              <div className="text-zinc-500 mb-1">// dnsmasq.d/static.conf</div>
              <div className="text-cyan-300 font-mono">dhcp-host={reserve.mac || '<MAC>'},{reserve.hostname || '<host>'},{reserve.ip || '<IP>'},24h</div>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}

function Th({ children, pl }: { children?: ReactNode; pl?: boolean }) {
  return <th className={`font-medium py-2.5 ${pl ? 'px-5' : 'px-3'}`}>{children}</th>;
}

function StatusDot({ status }: { status: 'online' | 'offline' }) {
  return <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${status === 'online' ? 'bg-emerald-400' : 'bg-zinc-600'}`} />;
}
function statusCell(status: 'online' | 'offline') {
  return <span className={`text-[11.5px] ${status === 'online' ? 'text-emerald-300' : 'text-zinc-500'}`}>{status}</span>;
}
function netCell(c: Client) {
  if (!c.networkName) return <span className="text-zinc-600">—</span>;
  return <span className="text-zinc-300">{c.networkName}{c.vlanId ? <span className="text-zinc-500 font-mono"> · VLAN {c.vlanId}</span> : null}</span>;
}

function FilterGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-[0.1em] text-zinc-500 font-medium mb-1">{title}</div>
      {children}
    </div>
  );
}

function Check({ label, count, on, onClick }: { label: string; count: number; on: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} className="w-full flex items-center gap-2 py-1 text-[12px] hover:text-zinc-100 transition-colors">
      <span className={`w-3.5 h-3.5 rounded-[3px] border flex items-center justify-center shrink-0 ${on ? 'bg-cyan-400 border-cyan-400' : 'border-zinc-600'}`}>
        {on && <Icon name="Check" size={10} className="text-zinc-950" />}
      </span>
      <span className={`flex-1 text-left ${on ? 'text-zinc-100' : 'text-zinc-400'}`}>{label}</span>
      <span className="font-mono text-[10.5px] text-zinc-500">{count}</span>
    </button>
  );
}
