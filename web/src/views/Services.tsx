import { useEffect, useState } from 'react';
import { Card, Button, IconButton, Badge, KPICard, Modal, KV, Icon } from '../components/primitives';
import { api } from '../api/client';

type Status = 'active' | 'inactive' | 'degraded' | 'failed';
type SubState = 'running' | 'exited' | 'dead' | 'failed' | 'waiting';

interface Service {
  unit: string;
  desc: string;
  category: 'VarrokEdge' | 'Network' | 'Security' | 'System';
  status: Status;
  sub: SubState;
  enabled: boolean;
  uptime: string;
  pid: number | null;
  cpu: number;
  mem: number;
  restarts: number;
  depends: string[];
  triggers: string[];
  file: string;
  critical: boolean;
  binary: string;
  installed: boolean;
}

interface Requirement {
  name: string;
  binary: string;
  feature: string;
  installed: boolean;
  hint: string;
}

const STATUS_META: Record<Status, { dot: string; text: string; badge: any; label: string }> = {
  active:   { dot: 'bg-emerald-400', text: 'text-emerald-300', badge: 'success', label: 'Active' },
  inactive: { dot: 'bg-zinc-600',    text: 'text-zinc-400',    badge: 'neutral', label: 'Inactive' },
  degraded: { dot: 'bg-amber-400',   text: 'text-amber-300',   badge: 'warn',    label: 'Degraded' },
  failed:   { dot: 'bg-rose-400',    text: 'text-rose-300',    badge: 'danger',  label: 'Failed' },
};

const SUB_LABEL: Record<SubState, string> = {
  running: 'Running',
  exited:  'Exited (oneshot)',
  dead:    'Dead',
  failed:  'Failed',
  waiting: 'Waiting',
};

export function Services() {
  const [services, setServices] = useState<Service[]>([]);
  const [requirements, setRequirements] = useState<Requirement[]>([]);
  const [category, setCategory] = useState<string>('all');
  const [status, setStatus] = useState<string>('all');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Service | null>(null);
  const [busy, setBusy] = useState<Record<string, string>>({});
  const [installing, setInstalling] = useState(false);
  const [installLog, setInstallLog] = useState<string[]>([]);

  const reload = () => {
    api.get<{ services: Service[] }>('/api/services').then(r => setServices(r.services)).catch(() => {});
    api.get<{ requirements: Requirement[] }>('/api/services/requirements').then(r => setRequirements(r.requirements)).catch(() => {});
  };
  useEffect(() => {
    reload();
    const t = setInterval(reload, 15_000);
    return () => clearInterval(t);
  }, []);

  const cats = ['all', 'VarrokEdge', 'Network', 'Security', 'System'];
  const statuses: Array<'all' | Status> = ['all', 'active', 'inactive', 'degraded', 'failed'];

  const filtered = services.filter(s =>
    (category === 'all' || s.category === category) &&
    (status === 'all' || s.status === status) &&
    (!search || s.unit.toLowerCase().includes(search.toLowerCase()) || s.desc.toLowerCase().includes(search.toLowerCase()))
  );

  const counts = {
    active:   services.filter(s => s.status === 'active').length,
    inactive: services.filter(s => s.status === 'inactive').length,
    degraded: services.filter(s => s.status === 'degraded').length,
    failed:   services.filter(s => s.status === 'failed').length,
  };

  const missing = requirements.filter(r => !r.installed);

  const installAll = async () => {
    if (installing) return;
    const pkgs = Array.from(new Set(missing.map(m => (m as any).pkg).filter(Boolean)));
    if (pkgs.length === 0) return;
    if (!window.confirm(`Run \`apt-get install -y ${pkgs.join(' ')}\`?`)) return;
    setInstalling(true);
    setInstallLog([]);
    try {
      const resp = await fetch('/api/system/apps/install', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', 'X-Varrok-CSRF': '1' },
        body: JSON.stringify({}),
      });
      if (!resp.ok || !resp.body) {
        const t = await resp.text();
        throw new Error(`HTTP ${resp.status}: ${t}`);
      }
      const reader = resp.body.getReader();
      const dec = new TextDecoder();
      let buf = '';
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split('\n\n');
        buf = lines.pop() ?? '';
        for (const block of lines) {
          for (const line of block.split('\n')) {
            if (line.startsWith('data: ')) {
              try {
                const ev = JSON.parse(line.slice(6));
                const tag = ev.step ?? ev.event ?? '?';
                const st  = ev.status ?? (ev.ok === false ? 'fail' : ev.ok === true ? 'ok' : '');
                setInstallLog(prev => [...prev, `[${tag}] ${st} ${ev.msg ?? ''}`].slice(-40));
              } catch { /* ignore */ }
            }
          }
        }
      }
      reload();
    } catch (err: any) {
      alert(err?.message ?? 'install failed');
    } finally {
      setInstalling(false);
    }
  };

  const runAction = async (unit: string, action: 'start' | 'stop' | 'restart' | 'reload' | 'enable' | 'disable') => {
    setBusy(b => ({ ...b, [unit]: action }));
    try {
      await api.post(`/api/services/${encodeURIComponent(unit)}/action`, { action });
      // Give systemd a beat, then refresh real state.
      setTimeout(reload, 600);
    } catch (err: any) {
      alert(err?.message ?? 'action failed');
    } finally {
      setTimeout(() => setBusy(b => { const c = { ...b }; delete c[unit]; return c; }), 700);
    }
  };

  return (
    <div className="space-y-6">
      {missing.length > 0 && (
        <Card padding="p-0" className="border-amber-400/30 bg-amber-500/5">
          <div className="px-5 py-4 flex items-start gap-3">
            <Icon name="AlertTriangle" size={18} className="text-amber-300 mt-0.5 shrink-0" />
            <div className="flex-1">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-[13px] font-medium text-amber-200">
                    {missing.length} underlying application{missing.length === 1 ? ' is' : 's are'} missing
                  </div>
                  <p className="text-[11.5px] text-amber-200/80 mt-0.5">
                    VarrokEdge orchestrates native Linux tools. Features depending on these won't work until they're installed.
                  </p>
                </div>
                <Button variant="primary" size="sm" icon={installing ? 'Loader2' : 'Download'}
                        className={installing ? '[&_svg]:animate-spin' : ''}
                        onClick={installAll} disabled={installing}>
                  {installing ? 'Installing…' : 'Install all'}
                </Button>
              </div>
              <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-2">
                {missing.map(m => (
                  <div key={m.binary} className="flex items-center gap-2.5 p-2 rounded-md bg-zinc-950/60 border border-amber-400/15">
                    <Icon name="XCircle" size={13} className="text-rose-300 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="font-mono text-[11.5px] text-zinc-100 truncate">{m.binary}</div>
                      <div className="text-[10.5px] text-zinc-500 truncate">{m.feature}</div>
                    </div>
                    <code className="font-mono text-[10.5px] text-cyan-300 shrink-0 hidden md:block">{m.hint}</code>
                  </div>
                ))}
              </div>
              {installLog.length > 0 && (
                <pre className="mt-3 bg-zinc-950/70 border border-zinc-800/60 rounded-md p-2 text-[10.5px] font-mono text-zinc-400 max-h-[160px] overflow-auto">
{installLog.join('\n')}
                </pre>
              )}
            </div>
          </div>
        </Card>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KPICard label="Active"   value={counts.active}   icon="CheckCircle2"  tone="success" />
        <KPICard label="Inactive" value={counts.inactive} icon="CircleDashed"  tone="neutral" />
        <KPICard label="Degraded" value={counts.degraded} icon="AlertTriangle" tone="neutral" trend={counts.degraded > 0 ? { dir: 'up', value: 'attention' } : undefined} />
        <KPICard label="Failed"   value={counts.failed}   icon="XCircle"       tone="danger"  trend={counts.failed > 0 ? { dir: 'up', value: 'check logs' } : undefined} />
      </div>

      <Card padding="p-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1 p-1 rounded-lg bg-zinc-900/40 border border-zinc-800/60">
            {cats.map(c => (
              <button key={c} onClick={() => setCategory(c)}
                      className={`px-3 h-7 text-[12px] rounded-md font-medium transition-colors ${category === c ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-500 hover:text-zinc-200'}`}>
                {c === 'all' ? 'All' : c}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-1 p-1 rounded-lg bg-zinc-900/40 border border-zinc-800/60">
            {statuses.map(s => (
              <button key={s} onClick={() => setStatus(s)}
                      className={`px-3 h-7 text-[11.5px] rounded-md font-medium transition-colors flex items-center gap-1.5 ${status === s ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-500 hover:text-zinc-200'}`}>
                {s !== 'all' && <span className={`w-1.5 h-1.5 rounded-full ${STATUS_META[s as Status].dot}`} />}
                {s === 'all' ? 'Any status' : STATUS_META[s as Status].label}
              </button>
            ))}
          </div>
          <div className="relative flex-1 min-w-[200px] max-w-md ml-auto">
            <Icon name="Search" size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-500" />
            <input value={search} onChange={(e) => setSearch(e.target.value)}
                   placeholder="filter by unit name or description…"
                   className="w-full h-8 pl-7 pr-3 rounded-md bg-zinc-900/60 border border-zinc-800/70 text-[12px] placeholder:text-zinc-600" />
          </div>
          <Button variant="ghost" size="sm" icon="RefreshCw" onClick={reload}>Refresh</Button>
        </div>
      </Card>

      <Card title="systemd units" subtitle={`${filtered.length} of ${services.length} unit${services.length === 1 ? '' : 's'}`} padding="p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-[12.5px]">
            <thead>
              <tr className="text-left text-[10.5px] uppercase tracking-[0.08em] text-zinc-500 border-b border-zinc-800/70 bg-zinc-900/30">
                <th className="font-medium py-2.5 px-5 w-8"></th>
                <th className="font-medium py-2.5 px-3">Unit</th>
                <th className="font-medium py-2.5 px-3">Status</th>
                <th className="font-medium py-2.5 px-3">Boot</th>
                <th className="font-medium py-2.5 px-3">PID</th>
                <th className="font-medium py-2.5 px-3 text-right">CPU</th>
                <th className="font-medium py-2.5 px-3 text-right">RAM</th>
                <th className="font-medium py-2.5 px-3">Uptime</th>
                <th className="font-medium py-2.5 px-5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/60">
              {filtered.map(s => (
                <ServiceRow key={s.unit} service={s} busy={busy[s.unit]} onAction={(a) => runAction(s.unit, a)} onOpen={() => setSelected(s)} />
              ))}
              {filtered.length === 0 && (
                <tr><td colSpan={9} className="py-10 text-center text-zinc-500 text-[12px]">No units match these filters.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card title="Bulk actions" subtitle="Across all networking units">
          <div className="space-y-2">
            <Button variant="secondary" size="md" icon="RefreshCw" className="w-full" onClick={() => runAction('networking.service', 'restart')}>Restart networking</Button>
            <Button variant="secondary" size="md" icon="ShieldCheck" className="w-full" onClick={() => runAction('netfilter-persistent.service', 'reload')}>Reload firewall</Button>
            <Button variant="ghost" size="md" icon="Terminal" className="w-full" disabled>Open shell (soon)</Button>
          </div>
        </Card>
        <Card title="Required applications" subtitle="VarrokEdge depends on these">
          <div className="space-y-1.5">
            {requirements.slice(0, 6).map(r => (
              <div key={r.binary} className="flex items-center justify-between text-[12px]">
                <div className="flex items-center gap-2 min-w-0">
                  {r.installed
                    ? <Icon name="CheckCircle2" size={12} className="text-emerald-300 shrink-0" />
                    : <Icon name="XCircle" size={12} className="text-rose-300 shrink-0" />}
                  <code className="font-mono text-zinc-200 truncate">{r.binary}</code>
                </div>
                <span className={`text-[10.5px] ${r.installed ? 'text-emerald-300' : 'text-rose-300'}`}>{r.installed ? 'installed' : 'missing'}</span>
              </div>
            ))}
          </div>
        </Card>
        <Card title="Cgroup overview" subtitle="Resource accounting (approx)">
          <div className="space-y-2 text-[11.5px]">
            {[
              ['system.slice', `${services.filter(s => s.status === 'active' && s.category !== 'VarrokEdge').reduce((a, b) => a + b.mem, 0)} MB`, '—'],
              ['varrok.slice', `${services.filter(s => s.category === 'VarrokEdge').reduce((a, b) => a + b.mem, 0)} MB`, '—'],
            ].map(([n, m, c]) => (
              <div key={n} className="flex items-center justify-between font-mono">
                <span className="text-zinc-300">{n}</span>
                <span className="text-zinc-500">{m} · {c}</span>
              </div>
            ))}
          </div>
        </Card>
      </div>

      <Modal open={!!selected} onClose={() => setSelected(null)} size="lg"
             title={selected?.unit} subtitle={selected?.desc}
             footer={selected && (
               <>
                 <Button variant="ghost" onClick={() => setSelected(null)}>Close</Button>
                 <Button variant="secondary" icon={selected.status === 'active' ? 'RotateCw' : 'Play'}
                         onClick={() => { runAction(selected.unit, selected.status === 'active' ? 'restart' : 'start'); setSelected(null); }}>
                   {selected.status === 'active' ? 'Restart' : 'Start'}
                 </Button>
                 {selected.status === 'active' && (
                   <Button variant="danger" icon="Square"
                           onClick={() => { runAction(selected.unit, 'stop'); setSelected(null); }}>Stop</Button>
                 )}
               </>
             )}>
        {selected && <ServiceDetail service={selected} />}
      </Modal>
    </div>
  );
}

function ServiceRow({ service, busy, onAction, onOpen }: { service: Service; busy?: string; onAction: (a: any) => void; onOpen: () => void }) {
  const meta = STATUS_META[service.status];
  const isBusy = !!busy;
  return (
    <tr className={`group transition-colors ${isBusy ? 'bg-zinc-900/40' : 'hover:bg-zinc-900/30'}`}>
      <td className="py-3 px-5">
        <span className={`block w-1.5 h-1.5 rounded-full ${meta.dot} ${service.status === 'active' ? 'dot-pulse' : ''}`} />
      </td>
      <td className="py-3 px-3">
        <button onClick={onOpen} className="text-left">
          <div className="flex items-center gap-2">
            <code className="font-mono text-[12.5px] text-zinc-100">{service.unit}</code>
            {service.critical && <span title="Critical for VarrokEdge operation"><Icon name="ShieldCheck" size={11} className="text-cyan-400/70" /></span>}
            {!service.installed && <Badge variant="danger" size="sm">not installed</Badge>}
          </div>
          <div className="text-[11px] text-zinc-500 mt-0.5">{service.desc}</div>
        </button>
      </td>
      <td className="py-3 px-3">
        <div className="flex flex-col gap-0.5">
          <span className={`text-[11.5px] font-medium ${meta.text}`}>{meta.label}</span>
          <span className="text-[10.5px] text-zinc-500 font-mono">{SUB_LABEL[service.sub] ?? service.sub}</span>
        </div>
      </td>
      <td className="py-3 px-3">
        {service.enabled
          ? <Badge variant="info" size="sm">enabled</Badge>
          : <Badge variant="neutral" size="sm">disabled</Badge>}
      </td>
      <td className="py-3 px-3 font-mono text-zinc-400">{service.pid ?? <span className="text-zinc-700">—</span>}</td>
      <td className="py-3 px-3 text-right font-mono text-zinc-400">{service.pid ? `${service.cpu.toFixed(1)}%` : '—'}</td>
      <td className="py-3 px-3 text-right font-mono text-zinc-400">{service.mem ? `${service.mem} MB` : '—'}</td>
      <td className="py-3 px-3 font-mono text-zinc-500 text-[11.5px]">{service.uptime}</td>
      <td className="py-3 px-5 text-right">
        <div className="inline-flex items-center gap-1">
          {isBusy ? (
            <span className="inline-flex items-center gap-1.5 text-[11px] font-mono text-cyan-300 pr-1">
              <Icon name="Loader2" size={12} className="animate-spin" />
              {busy === 'restart' ? 'restarting' : busy === 'start' ? 'starting' : busy === 'stop' ? 'stopping' : `${busy}…`}
            </span>
          ) : (
            <div className="opacity-0 group-hover:opacity-100 transition-opacity inline-flex gap-1">
              {service.installed && service.status === 'active' ? (
                <>
                  <IconButton name="RotateCw" label="Restart" size="sm" onClick={() => onAction('restart')} />
                  <IconButton name="Square"   label="Stop"    size="sm" variant="danger" onClick={() => onAction('stop')} />
                </>
              ) : service.installed ? (
                <IconButton name="Play" label="Start" size="sm" onClick={() => onAction('start')} />
              ) : null}
              <IconButton name="Terminal" label="View journal" size="sm" onClick={onOpen} />
            </div>
          )}
        </div>
      </td>
    </tr>
  );
}

function ServiceDetail({ service }: { service: Service }) {
  const meta = STATUS_META[service.status];
  const [journal, setJournal] = useState<{ t: string; svc: string; msg: string }[]>([]);
  useEffect(() => {
    api.get<{ lines: typeof journal }>(`/api/services/${encodeURIComponent(service.unit)}/journal?lines=30`)
      .then(r => setJournal(r.lines))
      .catch(() => setJournal([]));
  }, [service.unit]);

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <span className={`w-2.5 h-2.5 rounded-full mt-1 ${meta.dot} ${service.status === 'active' ? 'dot-pulse' : ''}`} />
          <div>
            <div className={`text-[14px] font-medium ${meta.text}`}>{meta.label} · {SUB_LABEL[service.sub] ?? service.sub}</div>
            <div className="text-[11.5px] text-zinc-500 mt-0.5 font-mono">{service.uptime !== '—' ? `up ${service.uptime}` : 'not currently running'}</div>
          </div>
        </div>
        <div className="flex flex-wrap gap-1.5 justify-end">
          {service.critical  && <Badge variant="accent"  size="sm" icon="ShieldCheck">critical</Badge>}
          {!service.installed && <Badge variant="danger" size="sm" icon="XCircle">binary not installed</Badge>}
          {service.enabled
            ? <Badge variant="info" size="sm">enabled at boot</Badge>
            : <Badge variant="neutral" size="sm">disabled at boot</Badge>}
          {service.restarts > 0 && <Badge variant="warn" size="sm">restarted ×{service.restarts}</Badge>}
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <KV k="PID"      v={service.pid ?? '—'} mono />
        <KV k="CPU"      v={service.pid ? `${service.cpu.toFixed(1)}%` : '—'} mono />
        <KV k="Memory"   v={service.mem ? `${service.mem} MB` : '—'} mono />
        <KV k="Category" v={service.category} />
      </div>
      <KV k="Binary"    v={service.binary} mono />
      <KV k="Unit file" v={service.file} mono />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="p-3 rounded-lg bg-zinc-900/40 border border-zinc-800/60">
          <div className="text-[10.5px] uppercase tracking-[0.08em] text-zinc-500 mb-2">Depends on</div>
          {service.depends.length ? (
            <div className="flex flex-wrap gap-1.5">
              {service.depends.map(d => <code key={d} className="font-mono text-[11px] px-2 py-0.5 rounded-md bg-zinc-900/80 border border-zinc-800/70 text-zinc-300">{d}</code>)}
            </div>
          ) : <div className="text-[11.5px] text-zinc-600">— none —</div>}
        </div>
        <div className="p-3 rounded-lg bg-zinc-900/40 border border-zinc-800/60">
          <div className="text-[10.5px] uppercase tracking-[0.08em] text-zinc-500 mb-2">Triggers</div>
          {service.triggers.length ? (
            <div className="flex flex-wrap gap-1.5">
              {service.triggers.map(d => <code key={d} className="font-mono text-[11px] px-2 py-0.5 rounded-md bg-zinc-900/80 border border-zinc-800/70 text-cyan-300">{d}</code>)}
            </div>
          ) : <div className="text-[11.5px] text-zinc-600">— none —</div>}
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between mb-2">
          <div className="text-[10.5px] uppercase tracking-[0.08em] text-zinc-500">Journal · last {journal.length} lines</div>
          <code className="font-mono text-[10.5px] text-zinc-600">journalctl -u {service.unit} -n 30 --no-pager</code>
        </div>
        <div className="bg-zinc-950/60 border border-zinc-800/60 rounded-lg p-3 font-mono text-[11px] leading-relaxed max-h-[260px] overflow-auto">
          {journal.length > 0 ? journal.map((line, i) => (
            <div key={i} className="flex gap-3">
              <span className="text-zinc-600 shrink-0">{line.t}</span>
              <span className="text-zinc-500 shrink-0 w-20">{line.svc}</span>
              <span className="text-zinc-300 truncate">{line.msg}</span>
            </div>
          )) : <div className="text-zinc-600">(no journal entries)</div>}
        </div>
      </div>
    </div>
  );
}
