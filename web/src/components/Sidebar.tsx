import { useEffect, useState } from 'react';
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
  { id: 'sysdata',  to: '/sysdata',  label: 'System Data',    icon: 'Activity',         section: 'Monitor', hint: 'telemetry' },
  { id: 'logs',     to: '/logs',     label: 'Logs & Threats', icon: 'ShieldAlert',      section: 'Monitor', hint: 'IDS' },
  { id: 'dhcp',     to: '/dhcp',     label: 'DHCP',           icon: 'Plug',             section: 'Network', hint: 'leases' },
  { id: 'dns',      to: '/dns',      label: 'DNS',            icon: 'Globe2',           section: 'Network', hint: 'dnsmasq' },
  { id: 'vpn',      to: '/vpn',      label: 'WireGuard',      icon: 'ShieldCheck',      section: 'Network', hint: 'wg0' },
  { id: 'fw',       to: '/firewall', label: 'Firewall',       icon: 'Flame',            section: 'Network', hint: 'iptables' },
  { id: 'services', to: '/services', label: 'Services',       icon: 'Boxes',            section: 'System',  hint: 'systemd' },
  { id: 'users',    to: '/users',    label: 'Users',          icon: 'Users',            section: 'System' },
  { id: 'settings', to: '/settings', label: 'Settings',       icon: 'Settings',         section: 'System' },
] as const;

type Section = 'Monitor' | 'Network' | 'System';
const SECTIONS: Section[] = ['Monitor', 'Network', 'System'];

export function Sidebar({ tweaks, user, onLogout }: { tweaks: Tweaks; user: AuthUser | null; onLogout: () => void }) {
  const accent = ACCENT_PALETTE[tweaks.accent];
  const initials = (user?.name ?? 'A').split(' ').map(s => s[0]).slice(0, 2).join('').toUpperCase();
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
      {/* Brand glyph */}
      <button
        className="relative w-9 h-9 rounded-lg flex items-center justify-center group shrink-0"
        style={{
          background: `linear-gradient(135deg, ${accent.hex}, rgba(99,102,241,0.7))`,
          boxShadow: `0 0 14px ${accent.soft}`,
        }}
        title="VarrokEdge — edge-01 · 0.9.2"
      >
        <Icon name="Hexagon" size={18} color="rgba(9,9,11,0.95)" strokeWidth={2.5} />
        <span className="absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full bg-emerald-400 ring-2 ring-zinc-950" />
        <Tooltip label="VarrokEdge" hint="edge-01 · 0.9.2" />
      </button>

      <div className="w-7 h-px bg-zinc-800/70 my-1" />

      {/* Nav */}
      <nav className="flex-1 flex flex-col items-center gap-1 w-full overflow-y-auto no-scrollbar">
        {SECTIONS.map((section, idx) => (
          <div key={section} className="flex flex-col items-center gap-1 w-full">
            {idx > 0 && <div className="w-7 h-px bg-zinc-800/70 my-1" />}
            {NAV.filter(n => n.section === section).map(item => (
              <NavLink
                key={item.id}
                to={item.to}
                className="group relative"
              >
                {({ isActive }) => (
                  <div
                    className={`relative w-9 h-9 rounded-lg flex items-center justify-center transition-colors ${
                      isActive
                        ? 'bg-zinc-800/70 text-zinc-100'
                        : 'text-zinc-500 hover:text-zinc-100 hover:bg-zinc-800/40'
                    }`}
                  >
                    {isActive && (
                      <span
                        className="absolute left-0 top-1.5 bottom-1.5 w-0.5 rounded-r"
                        style={{ background: accent.hex }}
                      />
                    )}
                    <Icon name={item.icon} size={16} strokeWidth={isActive ? 2 : 1.75} />
                    <Tooltip label={item.label} hint={'hint' in item ? (item as any).hint : undefined} />
                  </div>
                )}
              </NavLink>
            ))}
          </div>
        ))}
      </nav>

      <div className="w-7 h-px bg-zinc-800/70 my-1" />

      {/* Bottom: Docs, Alerts, Profile */}
      <div className="flex flex-col items-center gap-1 shrink-0">
        <a
          href="/docs"
          target="_blank"
          rel="noopener"
          className="group relative w-9 h-9 rounded-lg flex items-center justify-center text-zinc-500 hover:text-zinc-100 hover:bg-zinc-800/40 transition-colors"
        >
          <Icon name="BookOpen" size={16} />
          <Tooltip label="Documentation" hint="opens in new tab" />
        </a>
        <NavLink to="/logs" className="group relative w-9 h-9 rounded-lg flex items-center justify-center text-zinc-500 hover:text-zinc-100 hover:bg-zinc-800/40 transition-colors">
          <Icon name="Bell" size={16} />
          {openThreats.count > 0 && (
            <span className={`absolute top-1 right-1 min-w-3.5 h-3.5 px-1 rounded-full bg-rose-500 text-[8.5px] font-mono text-zinc-950 flex items-center justify-center ${openThreats.critical > 0 ? 'animate-pulse' : ''}`}>
              {openThreats.count > 99 ? '99+' : openThreats.count}
            </span>
          )}
          <Tooltip label="Alerts" hint={openThreats.count === 0 ? 'no open threats' : `${openThreats.count} open${openThreats.critical ? ` · ${openThreats.critical} critical` : ''}`} />
        </NavLink>
        <button
          onClick={onLogout}
          className="group relative w-9 h-9 rounded-lg flex items-center justify-center transition-colors"
          title="Sign out"
        >
          <span className="w-7 h-7 rounded-full bg-gradient-to-br from-cyan-400 to-indigo-500 text-[10px] font-semibold text-zinc-950 flex items-center justify-center">
            {initials}
          </span>
          <Tooltip label={user?.name ?? 'Account'} hint="click to sign out" />
        </button>
      </div>
    </aside>
  );
}

function Tooltip({ label, hint }: { label: string; hint?: string }) {
  return (
    <span className="absolute left-full ml-3 top-1/2 -translate-y-1/2 pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity z-50 whitespace-nowrap">
      <span className="inline-flex items-center gap-2 px-2.5 py-1.5 rounded-md glass-strong shadow-xl text-[11.5px] text-zinc-100">
        <span>{label}</span>
        {hint && <code className="font-mono text-[9.5px] text-zinc-500 px-1 py-0.5 rounded bg-zinc-900/80 border border-zinc-800/70">{hint}</code>}
      </span>
    </span>
  );
}
