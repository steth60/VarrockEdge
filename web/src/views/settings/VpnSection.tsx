import { useEffect, useState } from 'react';
import { Card, Button, Badge, KV } from '../../components/primitives';
import { api } from '../../api/client';

interface WgServer {
  publicKey: string; listenPort: number; tunnelCidr: string; mtu: number;
  publicEndpoint: string | null; dnsPush: string; defaultAllowedIps: string;
}
interface WgPeer {
  id: number; name: string; allowedIps: string; endpoint: string;
  handshake: string; status: 'connected' | 'idle' | 'offline'; kind: string;
}

const PEER_VARIANT = { connected: 'success', idle: 'warn', offline: 'neutral' } as const;

export function VpnSection({ onManage }: { onManage: () => void }) {
  const [server, setServer] = useState<WgServer | null>(null);
  const [peers, setPeers] = useState<WgPeer[]>([]);

  useEffect(() => {
    api.get<{ server: WgServer }>('/api/wireguard/server').then(r => setServer(r.server)).catch(() => {});
    api.get<{ peers: WgPeer[] }>('/api/wireguard/peers').then(r => setPeers(r.peers)).catch(() => {});
  }, []);

  return (
    <div className="space-y-6">
      <Card title="VPN" subtitle="WireGuard tunnel server — full management on the WireGuard page"
            action={<Button variant="secondary" size="sm" icon="ArrowUpRight" onClick={onManage}>Manage in WireGuard</Button>}>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-5">
          <KV k="Public endpoint" v={server ? `${server.publicEndpoint ?? '—'}:${server.listenPort}` : '—'} mono />
          <KV k="Tunnel subnet" v={server?.tunnelCidr ?? '—'} mono />
          <KV k="MTU" v={server?.mtu ?? '—'} mono />
          <KV k="Peers" v={`${peers.filter(p => p.status === 'connected').length} / ${peers.length} connected`} />
        </div>
      </Card>

      <Card title="Peers" subtitle={`${peers.length} configured`}>
        <table className="w-full text-[12.5px]">
          <thead>
            <tr className="text-left text-[10.5px] uppercase tracking-[0.08em] text-zinc-500 border-b border-zinc-800/70">
              <th className="font-medium py-2.5 pr-4">Name</th>
              <th className="font-medium py-2.5 pr-4">Allowed IPs</th>
              <th className="font-medium py-2.5 pr-4">Kind</th>
              <th className="font-medium py-2.5 pr-4">Handshake</th>
              <th className="font-medium py-2.5">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-800/60">
            {peers.map(p => (
              <tr key={p.id} className="hover:bg-zinc-900/30">
                <td className="py-3 pr-4 text-zinc-100">{p.name}</td>
                <td className="py-3 pr-4 font-mono text-zinc-300">{p.allowedIps}</td>
                <td className="py-3 pr-4 text-zinc-400">{p.kind}</td>
                <td className="py-3 pr-4 font-mono text-zinc-400">{p.handshake}</td>
                <td className="py-3"><Badge variant={PEER_VARIANT[p.status]} size="sm">{p.status}</Badge></td>
              </tr>
            ))}
            {peers.length === 0 && <tr><td colSpan={5} className="py-8 text-center text-[12px] text-zinc-600">no peers configured</td></tr>}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
