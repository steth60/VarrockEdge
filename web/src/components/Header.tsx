import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link, useLocation } from 'react-router-dom';
import { Icon, StatusPill, Badge, type StatusKind } from './primitives';
import { AccountModal } from './AccountModal';
import { api } from '../api/client';
import type { AuthUser } from '../hooks/useAuth';

const TITLES: Record<string, { label: string; section: string; hint?: string }> = {
  '/overview': { section: 'Monitor', label: 'Overview' },
  '/topology': { section: 'Monitor', label: 'Topology' },
  '/sysdata':  { section: 'System',  label: 'System Data',     hint: 'telemetry' },
  '/logs':     { section: 'Monitor', label: 'Logs & Threats',  hint: 'IDS' },
  '/dhcp':     { section: 'Network', label: 'DHCP',            hint: 'leases' },
  '/dns':      { section: 'Network', label: 'DNS',             hint: 'dnsmasq' },
  '/vpn':      { section: 'Network', label: 'WireGuard',       hint: 'wg0' },
  '/firewall': { section: 'Network', label: 'Firewall',        hint: 'iptables' },
  '/services': { section: 'System',  label: 'Services',        hint: 'systemd' },
  '/users':    { section: 'System',  label: 'Users' },
  '/settings': { section: 'System',  label: 'Settings' },
};

interface Service { name: string; status: 'running' | 'stopped' | 'degraded' }

export function Header({
  onOpenPalette, user, onLogout, onAccountSaved,
}: {
  onOpenPalette?: () => void;
  user: AuthUser | null;
  onLogout: () => void;
  onAccountSaved: () => void;
}) {
  const loc = useLocation();
  const meta = TITLES[loc.pathname] ?? { section: 'Monitor', label: 'Overview' };
  const [health, setHealth] = useState<{ status: StatusKind; label: string }>({ status: 'running', label: 'all systems normal' });
  const [menuOpen, setMenuOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [menuPos, setMenuPos] = useState<{ top: number; left: number } | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const popRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const load = () => api.get<{ services: Service[] }>('/api/overview/services').then(r => {
      const failed   = r.services.filter(s => s.status === 'stopped').length;
      const degraded = r.services.filter(s => s.status === 'degraded').length;
      if (failed > 0)        setHealth({ status: 'stopped',  label: `${failed} service${failed === 1 ? '' : 's'} down` });
      else if (degraded > 0) setHealth({ status: 'degraded', label: `${degraded} degraded` });
      else                   setHealth({ status: 'running',  label: 'all systems normal' });
    }).catch(() => {});
    load();
    const t = setInterval(load, 30_000);
    return () => clearInterval(t);
  }, []);

  // Dismiss the account menu on outside-click + Escape. The menu is portaled
  // to document.body, so an "inside" click must check the popup ref too.
  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (menuRef.current?.contains(t) || popRef.current?.contains(t)) return;
      setMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenuOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [menuOpen]);

  const initials = (user?.name ?? 'A').split(' ').map(s => s[0]).slice(0, 2).join('').toUpperCase();

  const toggleMenu = () => {
    if (menuOpen) { setMenuOpen(false); return; }
    const r = menuRef.current?.getBoundingClientRect();
    if (r) setMenuPos({ top: r.bottom + 8, left: r.right - 240 });
    setMenuOpen(true);
  };

  return (
    <header className="h-12 shrink-0 border-b border-zinc-800/70 bg-zinc-950/40 backdrop-blur flex items-center gap-4 px-5">
      <div className="flex items-center gap-2 text-[12.5px] min-w-0">
        <span className="text-zinc-500">{meta.section}</span>
        <Icon name="ChevronRight" size={12} className="text-zinc-700" />
        <span className="font-display font-semibold text-zinc-100 truncate">{meta.label}</span>
        {meta.hint && (
          <code className="ml-1 font-mono text-[10.5px] text-zinc-500 px-1.5 py-0.5 rounded bg-zinc-900/60 border border-zinc-800/60">{meta.hint}</code>
        )}
      </div>

      <button
        className="ml-6 relative flex-1 max-w-md text-left"
        onClick={() => onOpenPalette?.()}
      >
        <Icon name="Search" size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
        <span className="block w-full h-8 pl-9 pr-16 rounded-md bg-zinc-900/50 border border-zinc-800/70 text-[12.5px] text-zinc-600 leading-8 hover:border-zinc-700 transition-colors">
          Jump to host, lease, peer, rule…
        </span>
        <kbd className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[10px] font-mono text-zinc-500 bg-zinc-900/80 border border-zinc-800/70 px-1.5 py-0.5 rounded">⌘K</kbd>
      </button>

      <div className="flex-1" />

      <Link to="/services" title="Open service status">
        <StatusPill status={health.status} label={health.label} />
      </Link>

      <div ref={menuRef}>
        <button
          onClick={toggleMenu}
          aria-label="Account menu"
          className="w-8 h-8 rounded-full flex items-center justify-center transition-transform hover:scale-105"
        >
          <span className="w-7 h-7 rounded-full bg-gradient-to-br from-cyan-400 to-indigo-500 text-[10px] font-semibold text-zinc-950 flex items-center justify-center">
            {initials}
          </span>
        </button>
      </div>

      {menuOpen && menuPos && createPortal(
        <div
          ref={popRef}
          className="fixed w-60 rounded-lg glass-strong shadow-2xl border border-zinc-800/70 overflow-hidden z-[200]"
          style={{ top: menuPos.top, left: menuPos.left }}
        >
          <div className="px-3.5 py-3 border-b border-zinc-800/70">
            <div className="flex items-center gap-1.5">
              <span className="text-[12.5px] font-medium text-zinc-100 truncate">{user?.name ?? 'Account'}</span>
              {user && <Badge variant="neutral" size="sm">{user.role}</Badge>}
            </div>
            <div className="font-mono text-[10.5px] text-zinc-500 truncate mt-0.5">{user?.email ?? '—'}</div>
          </div>
          <button
            onClick={() => { setMenuOpen(false); setAccountOpen(true); }}
            className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-[12px] text-zinc-300 hover:bg-zinc-800/60 hover:text-zinc-100 transition-colors"
          >
            <Icon name="UserCog" size={14} className="text-zinc-500" />
            Account settings
          </button>
          <button
            onClick={() => { setMenuOpen(false); onLogout(); }}
            className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-[12px] text-rose-300 hover:bg-rose-500/10 transition-colors border-t border-zinc-800/70"
          >
            <Icon name="LogOut" size={14} />
            Sign out
          </button>
        </div>,
        document.body
      )}

      {user && <AccountModal open={accountOpen} onClose={() => setAccountOpen(false)} user={user} onSaved={onAccountSaved} />}
    </header>
  );
}
