import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Icon } from './primitives';
import { api } from '../api/client';

interface Item {
  id: string;
  label: string;
  hint: string;       // shown muted
  group: string;
  to: string;
  icon: string;
}

interface Lease       { hostname: string; ip: string; mac: string }
interface Reservation { id: number; hostname: string; mac: string; ip: string }
interface DnsRecord   { id: number; host: string; type: string; target: string }
interface WgPeer      { id: number; name: string; kind: string; allowedIps: string }
interface FwDnat      { id: number; srcPort: number; destIp: string; destPort: number }
interface User        { id: number; email: string; name: string; role: string }
interface Service     { name: string; desc: string }

const NAV_ITEMS: Item[] = [
  { id: 'nav:overview', label: 'Overview',       hint: 'NOC dashboard',  group: 'Pages', to: '/overview', icon: 'LayoutDashboard' },
  { id: 'nav:topology', label: 'Topology',       hint: 'Network map',    group: 'Pages', to: '/topology', icon: 'Workflow' },
  { id: 'nav:sysdata',  label: 'System Data',    hint: 'Telemetry',      group: 'Pages', to: '/sysdata',  icon: 'Activity' },
  { id: 'nav:logs',     label: 'Logs & Threats', hint: 'IDS',            group: 'Pages', to: '/logs',     icon: 'ShieldAlert' },
  { id: 'nav:dhcp',     label: 'DHCP',           hint: 'Leases',         group: 'Pages', to: '/dhcp',     icon: 'Plug' },
  { id: 'nav:dns',      label: 'DNS',            hint: 'dnsmasq',        group: 'Pages', to: '/dns',      icon: 'Globe2' },
  { id: 'nav:vpn',      label: 'WireGuard',      hint: 'wg0',            group: 'Pages', to: '/vpn',      icon: 'ShieldCheck' },
  { id: 'nav:fw',       label: 'Firewall',       hint: 'iptables',       group: 'Pages', to: '/firewall', icon: 'Flame' },
  { id: 'nav:services', label: 'Services',       hint: 'systemd',        group: 'Pages', to: '/services', icon: 'Boxes' },
  { id: 'nav:users',    label: 'Users',          hint: 'Auth',           group: 'Pages', to: '/users',    icon: 'Users' },
  { id: 'nav:settings', label: 'Settings',       hint: '',               group: 'Pages', to: '/settings', icon: 'Settings' },
];

function fuzzyScore(needle: string, hay: string): number {
  if (!needle) return 1;
  const h = hay.toLowerCase();
  const n = needle.toLowerCase();
  if (h.includes(n)) return 1000 - h.indexOf(n);                    // substring is best
  let score = 0, hi = 0;
  for (const ch of n) {
    const found = h.indexOf(ch, hi);
    if (found < 0) return 0;
    score += 1;
    hi = found + 1;
  }
  return score;
}

export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [query, setQuery] = useState('');
  const [items, setItems] = useState<Item[]>(NAV_ITEMS);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const navigate = useNavigate();

  // Load dynamic sources on open (cached per session via the API)
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    Promise.all([
      api.get<{ leases: Lease[] }>('/api/dhcp/leases').catch(() => ({ leases: [] })),
      api.get<{ reservations: Reservation[] }>('/api/dhcp/reservations').catch(() => ({ reservations: [] })),
      api.get<{ records: DnsRecord[] }>('/api/dns/records').catch(() => ({ records: [] })),
      api.get<{ peers: WgPeer[] }>('/api/wireguard/peers').catch(() => ({ peers: [] })),
      api.get<{ forwards: FwDnat[] }>('/api/firewall/dnat').catch(() => ({ forwards: [] })),
      api.get<{ users: User[] }>('/api/users').catch(() => ({ users: [] })),
      api.get<{ services: Service[] }>('/api/overview/services').catch(() => ({ services: [] })),
    ]).then(([dhcp, res, dns, wg, fw, users, svc]) => {
      if (cancelled) return;
      const all: Item[] = [...NAV_ITEMS];
      for (const l of dhcp.leases) all.push({ id: `lease:${l.mac}`, label: l.hostname || l.mac, hint: l.ip, group: 'Leases', to: '/dhcp', icon: 'Plug' });
      for (const r of res.reservations) all.push({ id: `res:${r.id}`, label: r.hostname, hint: `${r.ip} · ${r.mac}`, group: 'Reservations', to: '/dhcp', icon: 'Pin' });
      for (const d of dns.records) all.push({ id: `dns:${d.id}`, label: d.host, hint: `${d.type} → ${d.target}`, group: 'DNS', to: '/dns', icon: 'Globe2' });
      for (const p of wg.peers) all.push({ id: `peer:${p.id}`, label: p.name, hint: `${p.kind} · ${p.allowedIps}`, group: 'WG peers', to: '/vpn', icon: 'ShieldCheck' });
      for (const f of fw.forwards) all.push({ id: `fwd:${f.id}`, label: `eth0:${f.srcPort} → ${f.destIp}:${f.destPort}`, hint: 'port forward', group: 'Firewall', to: '/firewall', icon: 'Flame' });
      for (const u of users.users) all.push({ id: `user:${u.id}`, label: u.name, hint: `${u.email} · ${u.role}`, group: 'Users', to: '/users', icon: 'Users' });
      for (const s of svc.services) all.push({ id: `svc:${s.name}`, label: s.name, hint: s.desc, group: 'Services', to: '/services', icon: 'Boxes' });
      setItems(all);
    });
    return () => { cancelled = true; };
  }, [open]);

  useEffect(() => {
    if (open) {
      setQuery('');
      setActive(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  const filtered = useMemo(() => {
    if (!query) return items.slice(0, 20);
    const scored = items
      .map(item => ({ item, score: Math.max(fuzzyScore(query, item.label), fuzzyScore(query, item.hint) * 0.7) }))
      .filter(x => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 40)
      .map(x => x.item);
    return scored;
  }, [items, query]);

  useEffect(() => { setActive(0); }, [query]);

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive(a => Math.min(a + 1, filtered.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(a => Math.max(a - 1, 0)); }
    else if (e.key === 'Enter')   {
      e.preventDefault();
      const it = filtered[active];
      if (it) { navigate(it.to); onClose(); }
    } else if (e.key === 'Escape') {
      onClose();
    }
  };

  if (!open) return null;

  // Group items for display when no query
  const grouped = !query;
  const groups = new Map<string, Item[]>();
  for (const it of filtered) {
    if (!groups.has(it.group)) groups.set(it.group, []);
    groups.get(it.group)!.push(it);
  }

  let runningIdx = 0;
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh] p-6">
      <div className="absolute inset-0 bg-zinc-950/70 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-xl glass-strong rounded-2xl overflow-hidden shadow-2xl modal-in">
        <div className="flex items-center gap-3 px-5 h-12 border-b border-zinc-800/70">
          <Icon name="Search" size={14} className="text-zinc-500" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKey}
            placeholder="Jump to…  host, lease, peer, rule, page"
            className="flex-1 bg-transparent outline-none text-[13.5px] placeholder:text-zinc-600"
          />
          <kbd className="text-[10px] font-mono text-zinc-500 bg-zinc-900/80 border border-zinc-800/70 px-1.5 py-0.5 rounded">esc</kbd>
        </div>
        <div className="max-h-[50vh] overflow-y-auto">
          {grouped ? (
            [...groups.entries()].map(([group, items]) => (
              <div key={group}>
                <div className="px-5 py-1.5 text-[10px] uppercase tracking-[0.1em] text-zinc-600 bg-zinc-900/30">{group}</div>
                {items.map(it => {
                  const idx = runningIdx++;
                  return <Row key={it.id} item={it} active={idx === active} onClick={() => { navigate(it.to); onClose(); }} onHover={() => setActive(idx)} />;
                })}
              </div>
            ))
          ) : (
            filtered.map((it, i) => (
              <Row key={it.id} item={it} active={i === active} onClick={() => { navigate(it.to); onClose(); }} onHover={() => setActive(i)} />
            ))
          )}
          {filtered.length === 0 && <div className="px-5 py-8 text-center text-[12px] text-zinc-500">No matches.</div>}
        </div>
        <div className="px-5 h-9 border-t border-zinc-800/70 flex items-center gap-3 text-[10.5px] text-zinc-500">
          <span><kbd className="font-mono bg-zinc-900/80 border border-zinc-800/70 px-1 py-0.5 rounded">↑↓</kbd> navigate</span>
          <span><kbd className="font-mono bg-zinc-900/80 border border-zinc-800/70 px-1 py-0.5 rounded">↵</kbd> open</span>
          <span className="ml-auto">{filtered.length} {filtered.length === 1 ? 'match' : 'matches'}</span>
        </div>
      </div>
    </div>
  );
}

function Row({ item, active, onClick, onHover }: { item: Item; active: boolean; onClick: () => void; onHover: () => void }) {
  return (
    <button
      onClick={onClick}
      onMouseEnter={onHover}
      className={`w-full flex items-center gap-3 px-5 h-10 text-left transition-colors ${active ? 'bg-zinc-800/70' : 'hover:bg-zinc-900/40'}`}
    >
      <Icon name={item.icon} size={14} className={active ? 'text-cyan-300' : 'text-zinc-500'} />
      <span className={`text-[12.5px] ${active ? 'text-zinc-100' : 'text-zinc-200'} truncate`}>{item.label}</span>
      {item.hint && <span className="ml-auto font-mono text-[10.5px] text-zinc-500 truncate max-w-[40%]">{item.hint}</span>}
    </button>
  );
}
