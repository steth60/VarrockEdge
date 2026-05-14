import { useLocation } from 'react-router-dom';
import { Icon, IconButton, StatusPill } from './primitives';
import type { AuthUser } from '../hooks/useAuth';

const TITLES: Record<string, { label: string; section: string; hint?: string }> = {
  '/overview': { section: 'Monitor', label: 'Overview' },
  '/topology': { section: 'Monitor', label: 'Topology' },
  '/logs':     { section: 'Monitor', label: 'Logs & Threats', hint: 'IDS' },
  '/dhcp':     { section: 'Network', label: 'DHCP',           hint: 'leases' },
  '/dns':      { section: 'Network', label: 'DNS',            hint: 'dnsmasq' },
  '/vpn':      { section: 'Network', label: 'WireGuard',      hint: 'wg0' },
  '/firewall': { section: 'Network', label: 'Firewall',       hint: 'iptables' },
  '/users':    { section: 'System',  label: 'Users' },
  '/settings': { section: 'System',  label: 'Settings' },
};

export function Header({ user, onLogout }: { user: AuthUser | null; onLogout: () => void }) {
  const loc = useLocation();
  const meta = TITLES[loc.pathname] ?? { section: 'Monitor', label: 'Overview' };
  const initials = (user?.name ?? 'A').split(' ').map(s => s[0]).slice(0, 2).join('').toUpperCase();

  return (
    <header className="h-14 shrink-0 border-b border-zinc-800/70 bg-zinc-950/40 backdrop-blur flex items-center gap-4 px-8">
      <div className="flex items-center gap-2 text-[12.5px] min-w-0">
        <span className="text-zinc-500">{meta.section}</span>
        <Icon name="ChevronRight" size={12} className="text-zinc-700" />
        <span className="font-display font-semibold text-zinc-100 truncate">{meta.label}</span>
        {meta.hint && (
          <code className="ml-1 font-mono text-[10.5px] text-zinc-500 px-1.5 py-0.5 rounded bg-zinc-900/60 border border-zinc-800/60">{meta.hint}</code>
        )}
      </div>

      <div className="ml-6 relative flex-1 max-w-md">
        <Icon name="Search" size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
        <input
          placeholder="Jump to host, lease, peer, rule…"
          className="w-full h-9 pl-9 pr-16 rounded-lg bg-zinc-900/50 border border-zinc-800/70 text-[12.5px] placeholder:text-zinc-600 focus:border-cyan-400/50 focus:bg-zinc-900 transition-colors"
        />
        <kbd className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[10px] font-mono text-zinc-500 bg-zinc-900/80 border border-zinc-800/70 px-1.5 py-0.5 rounded">⌘K</kbd>
      </div>

      <div className="flex-1" />

      <div className="flex items-center gap-1.5">
        <StatusPill status="running" label="all systems normal" />
        <span className="w-px h-5 bg-zinc-800 mx-1" />
        <IconButton name="Bell" label="Alerts" size="sm" />
        <IconButton name="HelpCircle" label="Docs" size="sm" />
        <span className="w-px h-5 bg-zinc-800 mx-1" />
        <button onClick={onLogout} className="flex items-center gap-2 h-8 pl-1 pr-2.5 rounded-md hover:bg-zinc-800/60 transition-colors" title="Click to log out">
          <span className="w-6 h-6 rounded-full bg-gradient-to-br from-cyan-400 to-indigo-500 text-[10.5px] font-semibold text-zinc-950 flex items-center justify-center">{initials}</span>
          <span className="text-[12px] text-zinc-200">{user?.name?.split(' ')[0]?.toLowerCase() ?? 'admin'}</span>
          <Icon name="ChevronDown" size={11} className="text-zinc-500" />
        </button>
      </div>
    </header>
  );
}
