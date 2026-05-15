import { useEffect, useState } from 'react';
import { Card, Button, Badge } from '../../components/primitives';
import { api } from '../../api/client';

interface Threat {
  id: number; ruleId: string; severity: string; kind: string;
  src: string; dst: string; status: string; lastSeenAt: number; country: string | null;
}
interface Rule { id: string; name: string; category: string; enabled: boolean; severity: string; hits: number }

const SEV_VARIANT: Record<string, 'danger' | 'warn' | 'info' | 'neutral'> = {
  critical: 'danger', high: 'warn', medium: 'info', low: 'neutral',
};

export function CyberSecureSection({ onManage }: { onManage: () => void }) {
  const [threats, setThreats] = useState<Threat[]>([]);
  const [rules, setRules] = useState<Rule[]>([]);

  useEffect(() => {
    api.get<{ threats: Threat[] }>('/api/security/threats').then(r => setThreats(r.threats)).catch(() => {});
    api.get<{ rules: Rule[] }>('/api/security/rules').then(r => setRules(r.rules)).catch(() => {});
  }, []);

  const open = threats.filter(t => t.status !== 'acked');
  const bySev = (s: string) => open.filter(t => t.severity === s).length;
  const activeRules = rules.filter(r => r.enabled).length;

  return (
    <div className="space-y-6">
      <Card title="CyberSecure" subtitle="Intrusion detection & threat monitoring"
            action={<Button variant="secondary" size="sm" icon="ArrowUpRight" onClick={onManage}>Open security console</Button>}>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { k: 'Critical', v: bySev('critical'), c: 'text-rose-300' },
            { k: 'High',     v: bySev('high'),     c: 'text-amber-300' },
            { k: 'Medium',   v: bySev('medium'),   c: 'text-sky-300' },
            { k: 'Low',      v: bySev('low'),      c: 'text-zinc-300' },
          ].map(s => (
            <div key={s.k} className="rounded-lg bg-zinc-900/40 border border-zinc-800/60 p-3">
              <div className="text-[10px] uppercase tracking-[0.08em] text-zinc-500">{s.k}</div>
              <div className={`font-mono text-[24px] mt-1 ${s.v > 0 ? s.c : 'text-zinc-700'}`}>{s.v}</div>
            </div>
          ))}
        </div>
        <p className="text-[11.5px] text-zinc-500 mt-3">
          {activeRules} of {rules.length} detection rules active · {open.length} open threat{open.length === 1 ? '' : 's'}.
        </p>
      </Card>

      <Card title="Recent threats" subtitle="Most recent detections">
        <table className="w-full text-[12.5px]">
          <thead>
            <tr className="text-left text-[10.5px] uppercase tracking-[0.08em] text-zinc-500 border-b border-zinc-800/70">
              <th className="font-medium py-2.5 pr-4">Severity</th>
              <th className="font-medium py-2.5 pr-4">Kind</th>
              <th className="font-medium py-2.5 pr-4">Source</th>
              <th className="font-medium py-2.5 pr-4">Status</th>
              <th className="font-medium py-2.5">Last seen</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-800/60">
            {threats.slice(0, 8).map(t => (
              <tr key={t.id} className="hover:bg-zinc-900/30">
                <td className="py-3 pr-4"><Badge variant={SEV_VARIANT[t.severity] ?? 'neutral'} size="sm">{t.severity}</Badge></td>
                <td className="py-3 pr-4 text-zinc-300">{t.kind}</td>
                <td className="py-3 pr-4 font-mono text-zinc-400">{t.src}{t.country ? ` · ${t.country}` : ''}</td>
                <td className="py-3 pr-4 text-zinc-400">{t.status}</td>
                <td className="py-3 font-mono text-zinc-500">{new Date(t.lastSeenAt).toLocaleString()}</td>
              </tr>
            ))}
            {threats.length === 0 && <tr><td colSpan={5} className="py-8 text-center text-[12px] text-zinc-600">no threats detected</td></tr>}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
