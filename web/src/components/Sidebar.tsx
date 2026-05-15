import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { NavLink } from 'react-router-dom';
import { Icon } from './primitives';
import type { Tweaks } from '../hooks/useTweaks';
import { ACCENT_PALETTE } from '../hooks/useTweaks';
import type { AuthUser } from '../hooks/useAuth';
import { api } from '../api/client';

interface Threat { id: number; severity: string; status: string }

const NAV = [
  { id: 'overview', to: '/overview', label: 'Overview',       icon: 'LayoutDashboard', section: 'Monitor' },
  { id: 'topology', to: '/topology', label: 'Topology',       icon: 'Workflow',         section: 'Monitor' },
  { id: 'logs',     to: '/logs',     label: 'Logs & Threats', icon: 'ShieldAlert',      section: 'Monitor', hint: 'IDS' },
  { id: 'dhcp',     to: '/dhcp',     label: 'DHCP',           icon: 'Plug',             section: 'Network', hint: 'leases' },
  { id: 'dns',      to: '/dns',      label: 'DNS',            icon: 'Globe2',           section: 'Network', hint: 'dnsmasq' },
  { id: 'vpn',      to: '/vpn',      label: 'WireGuard',      icon: 'ShieldCheck',      section: 'Network', hint: 'wg0' },
  { id: 'fw',       to: '/firewall', label: 'Firewall',       icon: 'Flame',            section: 'Network', hint: 'iptables' },
  { id: 'sysdata',  to: '/sysdata',  label: 'System Data',    icon: 'Activity',         section: 'System',  hint: 'telemetry' },
  { id: 'services', to: '/services', label: 'Services',       icon: 'Boxes',            section: 'System',  hint: 'systemd' },
  { id: 'users',    to: '/users',    label: 'Users',          icon: 'Users',            section: 'System' },
  { id: 'settings', to: '/settings', label: 'Settings',       icon: 'Settings',         section: 'System' },
] as const;

type Section = 'Monitor' | 'Network' | 'System';
// Monitor + Network live in the scrolling rail; System items are pinned to the
// always-visible bottom block so Settings / Users can never be clipped.
const TOP_SECTIONS: Section[] = ['Monitor', 'Network'];

type NavEntry = typeof NAV[number];

function NavItem({ item, accentHex }: { item: NavEntry; accentHex: string }) {
  return (
    <Tipped label={item.label} hint={'hint' in item ? (item as any).hint : undefined}>
      <NavLink to={item.to}>
        {({ isActive }) => (
          <div
            className={`relative w-9 h-9 rounded-lg flex items-center justify-center transition-colors ${
              isActive ? 'bg-zinc-800/70 text-zinc-100' : 'text-zinc-500 hover:text-zinc-100 hover:bg-zinc-800/40'
            }`}
          >
            {isActive && (
              <span className="absolute left-0 top-1.5 bottom-1.5 w-0.5 rounded-r" style={{ background: accentHex }} />
            )}
            <Icon name={item.icon} size={16} strokeWidth={isActive ? 2 : 1.75} />
          </div>
        )}
      </NavLink>
    </Tipped>
  );
}

export function Sidebar({ tweaks, user }: { tweaks: Tweaks; user: AuthUser | null }) {
  const accent = ACCENT_PALETTE[tweaks.accent];
  const [openThreats, setOpenThreats] = useState<{ count: number; critical: number }>({ count: 0, critical: 0 });

  useEffect(() => {
    const load = () => api.get<{ threats: Threat[] }>('/api/security/threats').then(r => {
      const open = r.threats.filter(t => t.status !== 'acked');
      setOpenThreats({ count: open.length, critical: open.filter(t => t.severity === 'critical').length });
    }).catch(() => {});
    load();
    const t = setInterval(load, 30_000);
    return () => clearInterval(t);
  }, []);

  return (
    <aside className="w-[62px] shrink-0 border-r border-zinc-800/70 bg-zinc-950/60 backdrop-blur flex flex-col items-center py-3 gap-2">
      <Tipped label="VarrokEdge" hint={`${user?.name ?? 'edge'} · 0.9.2`}>
        <button
          className="relative w-9 h-9 rounded-lg flex items-center justify-center shrink-0"
          style={{
            background: `linear-gradient(135deg, ${accent.hex}, rgba(99,102,241,0.7))`,
            boxShadow: `0 0 14px ${accent.soft}`,
          }}
        >
          <Icon name="Hexagon" size={18} color="rgba(9,9,11,0.95)" strokeWidth={2.5} />
          <span className="absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full bg-emerald-400 ring-2 ring-zinc-950" />
        </button>
      </Tipped>

      <div className="w-7 h-px bg-zinc-800/70 my-1" />

      <nav className="flex-1 flex flex-col items-center gap-1 w-full">
        {TOP_SECTIONS.map((section, idx) => (
          <div key={section} className="flex flex-col items-center gap-1 w-full">
            {idx > 0 && <div className="w-7 h-px bg-zinc-800/70 my-1" />}
            {NAV.filter(n => n.section === section).map(item => (
              <NavItem key={item.id} item={item} accentHex={accent.hex} />
            ))}
          </div>
        ))}
      </nav>

      <div className="w-7 h-px bg-zinc-800/70 my-1" />

      {/* System group — pinned, always visible regardless of viewport height. */}
      <div className="flex flex-col items-center gap-1 shrink-0">
        {NAV.filter(n => n.section === 'System').map(item => (
          <NavItem key={item.id} item={item} accentHex={accent.hex} />
        ))}
        <div className="w-7 h-px bg-zinc-800/70 my-1" />
        <Tipped label="Documentation" hint="opens in new tab">
          <a
            href="/docs"
            target="_blank"
            rel="noopener"
            className="w-9 h-9 rounded-lg flex items-center justify-center text-zinc-500 hover:text-zinc-100 hover:bg-zinc-800/40 transition-colors"
          >
            <Icon name="BookOpen" size={16} />
          </a>
        </Tipped>
        <Tipped label="Alerts" hint={openThreats.count === 0 ? 'no open threats' : `${openThreats.count} open${openThreats.critical ? ` · ${openThreats.critical} critical` : ''}`}>
          <NavLink to="/logs" className="relative w-9 h-9 rounded-lg flex items-center justify-center text-zinc-500 hover:text-zinc-100 hover:bg-zinc-800/40 transition-colors">
            <Icon name="Bell" size={16} />
            {openThreats.count > 0 && (
              <span className={`absolute top-1 right-1 min-w-3.5 h-3.5 px-1 rounded-full bg-rose-500 text-[8.5px] font-mono text-zinc-950 flex items-center justify-center ${openThreats.critical > 0 ? 'animate-pulse' : ''}`}>
                {openThreats.count > 99 ? '99+' : openThreats.count}
              </span>
            )}
          </NavLink>
        </Tipped>
      </div>
    </aside>
  );
}

/**
 * Wraps any sidebar item and renders a tooltip to document.body via portal
 * on hover. Portal avoids being clipped by ancestor `overflow-hidden`
 * (which we have on the app shell so the body doesn't scroll).
 */
function Tipped({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const hideTimer = useRef<number | null>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  const show = () => {
    if (hideTimer.current) { window.clearTimeout(hideTimer.current); hideTimer.current = null; }
    const el = ref.current?.firstElementChild as HTMLElement | null | undefined;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPos({ top: r.top + r.height / 2, left: r.right + 8 });
  };
  const hide = () => {
    hideTimer.current = window.setTimeout(() => setPos(null), 60);
  };

  useEffect(() => () => { if (hideTimer.current) window.clearTimeout(hideTimer.current); }, []);

  return (
    <div ref={ref} onMouseEnter={show} onMouseLeave={hide} onFocus={show} onBlur={hide}>
      {children}
      {pos && createPortal(
        <span
          className="pointer-events-none fixed z-[100] inline-flex items-center gap-2 px-2.5 py-1.5 rounded-md glass-strong shadow-2xl text-[11.5px] text-zinc-100 whitespace-nowrap -translate-y-1/2"
          style={{ top: pos.top, left: pos.left }}
          role="tooltip"
        >
          <span>{label}</span>
          {hint && <code className="font-mono text-[9.5px] text-zinc-500 px-1 py-0.5 rounded bg-zinc-900/80 border border-zinc-800/70">{hint}</code>}
        </span>,
        document.body
      )}
    </div>
  );
}
