import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Icon, StatusPill, type StatusKind } from './primitives';
import { api } from '../api/client';

const TITLES: Record<string, { label: string; section: string; hint?: string }> = {
  '/overview': { section: 'Monitor', label: 'Overview' },
  '/topology': { section: 'Monitor', label: 'Topology' },
  '/sysdata':  { section: 'Monitor', label: 'System Data',     hint: 'telemetry' },
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

export function Header({ onOpenPalette }: { onOpenPalette?: () => void }) {
  const loc = useLocation();
  const meta = TITLES[loc.pathname] ?? { section: 'Monitor', label: 'Overview' };
  const [health, setHealth] = useState<{ status: StatusKind; label: string }>({ status: 'running', label: 'all systems normal' });

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
    </header>
  );
}
