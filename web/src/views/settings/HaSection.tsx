import { useEffect, useState } from 'react';
import { Card, Badge, KV, Icon } from '../../components/primitives';
import { api } from '../../api/client';

interface About {
  product: string; version: string; hostname: string;
  container: string; kernel: string; uptime: number; onLinux: boolean;
}

function fmtUptime(secs: number): string {
  const d = Math.floor(secs / 86400);
  const h = Math.floor((secs % 86400) / 3600);
  return `${d}d ${h}h`;
}

export function HaSection() {
  const [info, setInfo] = useState<About | null>(null);
  useEffect(() => { api.get<About>('/api/settings/about').then(setInfo).catch(() => {}); }, []);

  return (
    <div className="space-y-6">
      <Card title="High Availability" subtitle="Controller redundancy">
        <div className="flex items-center gap-3 p-4 rounded-lg bg-zinc-900/40 border border-zinc-800/60">
          <Icon name="Server" size={18} className="text-cyan-300" />
          <div className="flex-1">
            <div className="text-[13px] font-medium text-zinc-100">Standalone node</div>
            <div className="text-[11.5px] text-zinc-500 mt-0.5">
              This appliance runs as a single controller. No HA cluster peer is configured.
            </div>
          </div>
          <Badge variant="neutral" size="md">no cluster</Badge>
        </div>
        <p className="text-[11.5px] text-zinc-500 mt-3 leading-relaxed">
          High availability would pair this node with a second VarrokEdge instance and
          float a virtual IP between them. Clustering is not enabled on this build —
          protect availability with Proxmox-level snapshots and the scheduled config backups.
        </p>
      </Card>

      <Card title="This node" subtitle="Identity of the active controller">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-5">
          <KV k="Hostname" v={info?.hostname ?? '—'} mono />
          <KV k="Container" v={info?.container ?? '—'} mono />
          <KV k="Version" v={info?.version ?? '—'} mono />
          <KV k="Uptime" v={info ? fmtUptime(info.uptime) : '—'} mono />
        </div>
      </Card>
    </div>
  );
}
