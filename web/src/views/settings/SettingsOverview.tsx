import { useEffect, useState, type ReactNode } from 'react';
import { Icon, Badge } from '../../components/primitives';
import { api } from '../../api/client';
import type { VNetwork, WanLink } from './types';

interface WgServer { publicEndpoint: string | null; listenPort: number; tunnelCidr: string }
interface WgPeer { id: number; name: string; status: 'connected' | 'idle' | 'offline'; kind: string }

/** Collapsible summary card mirroring the UniFi settings overview. */
function SummaryCard({
  icon, title, children, footer, defaultOpen = true,
}: { icon: string; title: string; children: ReactNode; footer: ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="relative glass rounded-xl noise overflow-hidden">
      <button onClick={() => setOpen(o => !o)}
              className="w-full flex items-center gap-2.5 px-5 py-3.5 hover:bg-zinc-900/30 transition-colors">
        <Icon name={icon} size={15} className="text-cyan-300" />
        <span className="font-display text-[13.5px] font-semibold tracking-tight text-zinc-100">{title}</span>
        <Icon name={open ? 'ChevronUp' : 'ChevronDown'} size={15} className="ml-auto text-zinc-500" />
      </button>
      {open && (
        <div className="px-5 pb-4">
          {children}
          <div className="mt-3 pt-3 border-t border-zinc-800/60 flex items-center gap-4 text-[12px]">{footer}</div>
        </div>
      )}
    </section>
  );
}

function Link({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  return <button onClick={onClick} className="text-cyan-300 hover:text-cyan-200 font-medium transition-colors">{children}</button>;
}

function Th({ children }: { children: ReactNode }) {
  return <th className="font-medium py-2 pr-4 text-left">{children}</th>;
}

const EMPTY = <tr><td colSpan={9} className="py-5 text-center text-[12px] text-zinc-600">nothing configured yet</td></tr>;

export function SettingsOverview({ onNavigate }: { onNavigate: (id: string) => void }) {
  const [nets, setNets] = useState<VNetwork[]>([]);
  const [wans, setWans] = useState<WanLink[]>([]);
  const [server, setServer] = useState<WgServer | null>(null);
  const [peers, setPeers] = useState<WgPeer[]>([]);

  useEffect(() => {
    api.get<{ networks: VNetwork[] }>('/api/networks').then(r => setNets(r.networks)).catch(() => {});
    api.get<{ wans: WanLink[] }>('/api/wan').then(r => setWans(r.wans)).catch(() => {});
    api.get<{ server: WgServer }>('/api/wireguard/server').then(r => setServer(r.server)).catch(() => {});
    api.get<{ peers: WgPeer[] }>('/api/wireguard/peers').then(r => setPeers(r.peers)).catch(() => {});
  }, []);

  const dot = (s: string) => s === 'up' || s === 'connected' ? 'bg-emerald-400' : s === 'degraded' || s === 'idle' ? 'bg-amber-400' : s === 'synthetic' ? 'bg-zinc-500' : 'bg-rose-400';

  return (
    <div className="space-y-4">
      <div>
        <h2 className="font-display text-[15px] font-semibold tracking-tight text-zinc-100">Overview</h2>
        <p className="text-[11.5px] text-zinc-500 mt-0.5">A roll-up of everything VarrokEdge manages — expand a card to see detail.</p>
      </div>

      <SummaryCard icon="Wifi" title="WiFi" footer={<Link onClick={() => onNavigate('wifi')}>Manage</Link>}>
        <div className="py-4 text-[12px] text-zinc-500">
          This appliance manages no access points. WiFi is handled by your APs directly.
        </div>
      </SummaryCard>

      <SummaryCard icon="Network" title="Networks"
        footer={<>
          <Link onClick={() => onNavigate('networks')}>Create New</Link>
          <Link onClick={() => onNavigate('networks')}>Manage</Link>
        </>}>
        <table className="w-full text-[12px]">
          <thead><tr className="text-[10px] uppercase tracking-[0.08em] text-zinc-500 border-b border-zinc-800/70">
            <Th>Name</Th><Th>VLAN ID</Th><Th>Subnet</Th><Th>DHCP</Th><Th>IP Leases</Th>
          </tr></thead>
          <tbody className="divide-y divide-zinc-800/60">
            {nets.map(n => (
              <tr key={n.id} className="hover:bg-zinc-900/30">
                <td className="py-2 pr-4"><span className="inline-flex items-center gap-2"><span className={`w-1.5 h-1.5 rounded-full ${dot(n.link)}`} />{n.name}</span></td>
                <td className="py-2 pr-4 font-mono text-zinc-400">{n.vlanId ?? '—'}</td>
                <td className="py-2 pr-4 font-mono text-zinc-300">{n.subnet}</td>
                <td className="py-2 pr-4 text-zinc-400">{n.dhcpEnabled ? 'Server' : 'Off'}</td>
                <td className="py-2 pr-4 font-mono text-cyan-300">{n.leasesUsed} / {n.leasesTotal}</td>
              </tr>
            ))}
            {nets.length === 0 && EMPTY}
          </tbody>
        </table>
      </SummaryCard>

      <SummaryCard icon="Globe" title="Internet"
        footer={<>
          <Link onClick={() => onNavigate('internet')}>Create New</Link>
          <Link onClick={() => onNavigate('internet')}>Manage</Link>
        </>}>
        <table className="w-full text-[12px]">
          <thead><tr className="text-[10px] uppercase tracking-[0.08em] text-zinc-500 border-b border-zinc-800/70">
            <Th>Name</Th><Th>Interface</Th><Th>ISP</Th><Th>IPv4</Th><Th>Latency</Th>
          </tr></thead>
          <tbody className="divide-y divide-zinc-800/60">
            {wans.map(w => (
              <tr key={w.id} className="hover:bg-zinc-900/30">
                <td className="py-2 pr-4"><span className="inline-flex items-center gap-2"><span className={`w-1.5 h-1.5 rounded-full ${dot(w.health.status)}`} />{w.label}</span></td>
                <td className="py-2 pr-4 font-mono text-zinc-300">{w.iface}</td>
                <td className="py-2 pr-4 text-zinc-400">{w.isp ?? '—'}</td>
                <td className="py-2 pr-4 font-mono text-zinc-300">{w.ipv4 ?? '—'}</td>
                <td className="py-2 pr-4 font-mono text-zinc-400">{w.health.rttMs != null ? `${w.health.rttMs.toFixed(0)} ms` : '—'}</td>
              </tr>
            ))}
            {wans.length === 0 && EMPTY}
          </tbody>
        </table>
      </SummaryCard>

      <SummaryCard icon="Lock" title="VPN" footer={<Link onClick={() => onNavigate('vpn')}>Manage</Link>}>
        <div className="grid grid-cols-3 gap-4 py-2">
          <div>
            <div className="text-[10px] uppercase tracking-[0.08em] text-zinc-500">Endpoint</div>
            <div className="font-mono text-[12px] text-cyan-300 mt-1">{server?.publicEndpoint ?? '—'}:{server?.listenPort ?? 51820}</div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-[0.08em] text-zinc-500">Tunnel subnet</div>
            <div className="font-mono text-[12px] text-zinc-300 mt-1">{server?.tunnelCidr ?? '—'}</div>
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-[0.08em] text-zinc-500">Peers</div>
            <div className="text-[12px] text-zinc-300 mt-1">
              <Badge variant="success" size="sm">{peers.filter(p => p.status === 'connected').length} connected</Badge>
              <span className="text-zinc-500 ml-2">{peers.length} total</span>
            </div>
          </div>
        </div>
      </SummaryCard>
    </div>
  );
}
