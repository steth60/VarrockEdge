import { NavLink } from 'react-router-dom';
import { Icon, StatusPill } from './primitives';
import type { Tweaks } from '../hooks/useTweaks';
import { ACCENT_PALETTE } from '../hooks/useTweaks';

const NAV = [
  { id: 'overview', to: '/overview', label: 'Overview',       icon: 'LayoutDashboard', section: 'Monitor' },
  { id: 'topology', to: '/topology', label: 'Topology',       icon: 'Workflow',         section: 'Monitor' },
  { id: 'logs',     to: '/logs',     label: 'Logs & Threats', icon: 'ShieldAlert',      section: 'Monitor', hint: 'IDS' },
  { id: 'dhcp',     to: '/dhcp',     label: 'DHCP',           icon: 'Plug',             section: 'Network', hint: 'leases' },
  { id: 'dns',      to: '/dns',      label: 'DNS',            icon: 'Globe2',           section: 'Network', hint: 'dnsmasq' },
  { id: 'vpn',      to: '/vpn',      label: 'WireGuard',      icon: 'ShieldCheck',      section: 'Network', hint: 'wg0' },
  { id: 'fw',       to: '/firewall', label: 'Firewall',       icon: 'Flame',            section: 'Network', hint: 'iptables' },
  { id: 'users',    to: '/users',    label: 'Users',          icon: 'Users',            section: 'System' },
  { id: 'services', to: '/services', label: 'Services',       icon: 'Boxes',            section: 'System', hint: 'systemd' },
  { id: 'settings', to: '/settings', label: 'Settings',       icon: 'Settings',         section: 'System' },
] as const;

const DISABLED = [
  { id: 'storage',  label: 'Storage',   icon: 'HardDrive', section: 'System' },
  { id: 'backups',  label: 'Backups',   icon: 'Archive',   section: 'System' },
] as const;

export function Sidebar({ tweaks }: { tweaks: Tweaks }) {
  const accent = ACCENT_PALETTE[tweaks.accent];
  const sections: Array<'Monitor' | 'Network' | 'System'> = ['Monitor', 'Network', 'System'];
  return (
    <aside className="w-[244px] shrink-0 border-r border-zinc-800/70 bg-zinc-950/50 backdrop-blur flex flex-col">
      <div className="px-5 py-5 flex items-center gap-2.5 border-b border-zinc-800/60">
        <div className="relative w-8 h-8 rounded-lg flex items-center justify-center"
             style={{ background: `linear-gradient(135deg, ${accent.hex}, rgba(99,102,241,0.7))`, boxShadow: `0 0 18px ${accent.soft}` }}>
          <Icon name="Hexagon" size={18} color="rgba(9,9,11,0.95)" strokeWidth={2.5} />
          <span className="absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full bg-emerald-400 ring-2 ring-zinc-950" />
        </div>
        <div>
          <div className="font-display text-[14px] font-semibold tracking-tight text-zinc-100 leading-none">VarrokEdge</div>
          <div className="font-mono text-[10.5px] text-zinc-500 mt-1">v0.9.2 · ct-104</div>
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto py-3 px-2.5 space-y-4">
        {sections.map(section => {
          const items = NAV.filter(n => n.section === section);
          const disabled = DISABLED.filter(n => n.section === section);
          if (items.length + disabled.length === 0) return null;
          return (
            <div key={section}>
              <div className="px-3 mb-1.5 text-[10px] uppercase tracking-[0.12em] font-medium text-zinc-600">{section}</div>
              <ul className="space-y-0.5">
                {items.map(item => (
                  <li key={item.id}>
                    <NavLink
                      to={item.to}
                      className={({ isActive }) =>
                        `nav-item w-full flex items-center gap-2.5 h-9 pl-3 pr-2 rounded-md text-[12.5px] font-medium transition-all ${
                          isActive ? 'bg-zinc-800/70 text-zinc-100' : 'text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800/40'
                        }`
                      }
                      data-active={undefined}
                    >
                      {({ isActive }) => (
                        <>
                          <Icon name={item.icon} size={14} className={isActive ? '' : 'text-zinc-500'} />
                          <span className="flex-1 text-left">{item.label}</span>
                          {'hint' in item && (item as any).hint && (
                            <code className={`font-mono text-[9.5px] px-1.5 py-0.5 rounded ${isActive ? 'text-zinc-400 bg-zinc-900/60' : 'text-zinc-600 bg-zinc-900/40'}`}>{(item as any).hint}</code>
                          )}
                        </>
                      )}
                    </NavLink>
                  </li>
                ))}
                {disabled.map(item => (
                  <li key={item.id}>
                    <span className="nav-item w-full flex items-center gap-2.5 h-9 pl-3 pr-2 rounded-md text-[12.5px] font-medium text-zinc-600 cursor-not-allowed">
                      <Icon name={item.icon} size={14} className="text-zinc-700" />
                      <span className="flex-1 text-left">{item.label}</span>
                      <span className="text-[9.5px] text-zinc-700">soon</span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </nav>

      <div className="m-3 p-3 rounded-lg border border-zinc-800/70 bg-zinc-900/30">
        <div className="flex items-center justify-between">
          <div className="text-[10.5px] uppercase tracking-[0.08em] text-zinc-500">Host</div>
          <StatusPill status="running" label="online" />
        </div>
        <div className="mt-2 space-y-1 font-mono text-[10.5px] text-zinc-400">
          <div className="flex justify-between"><span className="text-zinc-500">proxmox</span><span>pve-01</span></div>
          <div className="flex justify-between"><span className="text-zinc-500">uptime</span><span>6d 14h</span></div>
        </div>
      </div>
    </aside>
  );
}
