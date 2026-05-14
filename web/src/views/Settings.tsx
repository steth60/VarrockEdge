import { useEffect, useRef, useState } from 'react';
import { Card, Button, SettingRow, ToggleSwitch, Input, Select, KV, Icon, Badge } from '../components/primitives';
import { api } from '../api/client';

const SECTIONS = [
  { id: 'general',  label: 'General',        icon: 'Settings' },
  { id: 'network',  label: 'Network & WAN',  icon: 'Network' },
  { id: 'security', label: 'Security',       icon: 'ShieldCheck' },
  { id: 'updates',  label: 'Updates',        icon: 'Download' },
  { id: 'backups',  label: 'Backups',        icon: 'Archive' },
  { id: 'notify',   label: 'Notifications',  icon: 'Bell' },
  { id: 'api',      label: 'API & Webhooks', icon: 'Webhook' },
  { id: 'about',    label: 'About',          icon: 'Info' },
] as const;

export function Settings() {
  const [section, setSection] = useState<typeof SECTIONS[number]['id']>('general');
  return (
    <div className="grid grid-cols-12 gap-6">
      <aside className="col-span-12 md:col-span-3 lg:col-span-2">
        <nav className="sticky top-4 space-y-0.5">
          {SECTIONS.map(s => (
            <button key={s.id} onClick={() => setSection(s.id)}
                    className={`w-full flex items-center gap-2.5 h-8 px-3 rounded-md text-[12.5px] font-medium transition-colors ${section === s.id ? 'bg-zinc-800/70 text-zinc-100' : 'text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800/40'}`}>
              <Icon name={s.icon} size={13} className={section === s.id ? '' : 'text-zinc-500'} />
              <span>{s.label}</span>
            </button>
          ))}
        </nav>
      </aside>
      <div className="col-span-12 md:col-span-9 lg:col-span-10 space-y-6">
        {section === 'general'  && <General />}
        {section === 'network'  && <Network />}
        {section === 'security' && <Security />}
        {section === 'updates'  && <Updates />}
        {section === 'backups'  && <Backups />}
        {section === 'notify'   && <Notify />}
        {section === 'api'      && <ApiPanel />}
        {section === 'about'    && <About />}
      </div>
    </div>
  );
}

function General() {
  const [hostname, setHostname] = useState('varrok-edge-01');
  return (
    <Card title="General" subtitle="Appliance identity, locale, telemetry">
      <SettingRow label="Hostname" hint="Used in syslog, dashboard chrome, and mDNS broadcasts.">
        <Input mono value={hostname} onChange={(e) => setHostname(e.target.value)} className="max-w-sm" />
      </SettingRow>
      <SettingRow label="Timezone">
        <Select className="max-w-sm" defaultValue="Europe/London">
          <option>Europe/London</option><option>UTC</option><option>America/New_York</option>
        </Select>
      </SettingRow>
      <SettingRow label="Anonymous telemetry" hint="Help improve VarrokEdge. Never includes IPs, MACs, or hostnames.">
        <ToggleSwitch value={true} onChange={() => {}} />
      </SettingRow>
      <div className="pt-4 flex gap-2 justify-end">
        <Button variant="ghost">Discard</Button>
        <Button variant="primary" icon="Save">Save changes</Button>
      </div>
    </Card>
  );
}

interface Wan {
  id: number; iface: string; label: string; role: string; priority: number; healthTarget: string; enabled: boolean;
  health: { status: 'up' | 'degraded' | 'down'; rttMs: number | null; lossPct: number | null; ts: number | null };
}

function Network() {
  const [wans, setWans] = useState<Wan[]>([]);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState({ iface: '', label: '', role: 'primary', priority: 200, healthTarget: '1.1.1.1' });

  const reload = () => api.get<{ wans: Wan[] }>('/api/wan').then(r => setWans(r.wans)).catch(() => {});
  useEffect(() => {
    reload();
    const t = setInterval(reload, 15_000);
    return () => clearInterval(t);
  }, []);

  const submit = async () => {
    if (!draft.iface || !draft.label) { alert('iface and label required'); return; }
    try {
      await api.post('/api/wan', draft);
      setDraft({ iface: '', label: '', role: 'primary', priority: 200, healthTarget: '1.1.1.1' });
      setAdding(false);
      reload();
    } catch (err: any) { alert(err?.message ?? 'failed'); }
  };

  const toggle = async (w: Wan) => {
    try { await api.patch(`/api/wan/${w.id}`, { enabled: !w.enabled }); reload(); }
    catch (err: any) { alert(err?.message ?? 'failed'); }
  };
  const remove = async (w: Wan) => {
    if (!window.confirm(`Remove ${w.iface}? Default route may change if this is the active WAN.`)) return;
    try { await api.delete(`/api/wan/${w.id}`); reload(); }
    catch (err: any) { alert(err?.message ?? 'failed'); }
  };

  return (
    <>
      <Card title="WAN interfaces" subtitle="Multi-WAN failover · health probed every 30s"
            action={<Button variant="primary" size="sm" icon="Plus" onClick={() => setAdding(true)}>Add WAN</Button>}>
        <table className="w-full text-[12.5px]">
          <thead>
            <tr className="text-left text-[10.5px] uppercase tracking-[0.08em] text-zinc-500 border-b border-zinc-800/70">
              <th className="font-medium py-2.5">Iface</th>
              <th className="font-medium py-2.5">Label</th>
              <th className="font-medium py-2.5">Role</th>
              <th className="font-medium py-2.5">Prio</th>
              <th className="font-medium py-2.5">Health target</th>
              <th className="font-medium py-2.5">Status</th>
              <th className="font-medium py-2.5">RTT</th>
              <th className="font-medium py-2.5">Loss</th>
              <th className="font-medium py-2.5 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-800/60">
            {wans.map(w => {
              const dot = w.health.status === 'up' ? 'bg-emerald-400' : w.health.status === 'degraded' ? 'bg-amber-400' : 'bg-rose-400';
              return (
                <tr key={w.id} className="hover:bg-zinc-900/30 group">
                  <td className="py-3 font-mono text-zinc-100">{w.iface}</td>
                  <td className="py-3 text-zinc-300">{w.label}</td>
                  <td className="py-3"><Badge variant={w.role === 'primary' ? 'accent' : w.role === 'failover' ? 'info' : 'neutral'} size="sm">{w.role}</Badge></td>
                  <td className="py-3 font-mono text-zinc-400">{w.priority}</td>
                  <td className="py-3 font-mono text-cyan-300">{w.healthTarget}</td>
                  <td className="py-3">
                    <span className="inline-flex items-center gap-2 text-[11.5px]">
                      <span className={`w-1.5 h-1.5 rounded-full ${dot}`} />
                      <span className={w.health.status === 'up' ? 'text-emerald-300' : w.health.status === 'degraded' ? 'text-amber-300' : 'text-rose-300'}>{w.health.status}</span>
                    </span>
                  </td>
                  <td className="py-3 font-mono text-zinc-400">{w.health.rttMs?.toFixed(0) ?? '—'}{w.health.rttMs !== null ? 'ms' : ''}</td>
                  <td className="py-3 font-mono text-zinc-400">{w.health.lossPct?.toFixed(0) ?? '—'}%</td>
                  <td className="py-3 text-right">
                    <div className="inline-flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <Button variant="ghost" size="sm" icon={w.enabled ? 'Pause' : 'Play'} onClick={() => toggle(w)}>{w.enabled ? 'Disable' : 'Enable'}</Button>
                      <Button variant="danger" size="sm" icon="Trash2" onClick={() => remove(w)}>Remove</Button>
                    </div>
                  </td>
                </tr>
              );
            })}
            {wans.length === 0 && <tr><td colSpan={9} className="py-8 text-center text-[12px] text-zinc-600">no WANs configured</td></tr>}
          </tbody>
        </table>
      </Card>

      {adding && (
        <Card title="Add WAN interface" subtitle="Must be configured at the OS / Proxmox layer first">
          <div className="grid grid-cols-2 gap-4">
            <label className="block">
              <span className="text-[11px] text-zinc-400">Interface</span>
              <Input mono placeholder="eth0:1" value={draft.iface} onChange={(e) => setDraft({ ...draft, iface: e.target.value })} className="mt-1 w-full" />
            </label>
            <label className="block">
              <span className="text-[11px] text-zinc-400">Label</span>
              <Input placeholder="Mobile 4G" value={draft.label} onChange={(e) => setDraft({ ...draft, label: e.target.value })} className="mt-1 w-full" />
            </label>
            <label className="block">
              <span className="text-[11px] text-zinc-400">Role</span>
              <Select value={draft.role} onChange={(e) => setDraft({ ...draft, role: e.target.value })} className="mt-1 w-full">
                <option value="primary">primary</option>
                <option value="failover">failover</option>
                <option value="snat-only">snat-only</option>
              </Select>
            </label>
            <label className="block">
              <span className="text-[11px] text-zinc-400">Priority (lower = higher)</span>
              <Input mono type="number" value={String(draft.priority)} onChange={(e) => setDraft({ ...draft, priority: Number(e.target.value) || 200 })} className="mt-1 w-full" />
            </label>
            <label className="block col-span-2">
              <span className="text-[11px] text-zinc-400">Health-check target</span>
              <Input mono value={draft.healthTarget} onChange={(e) => setDraft({ ...draft, healthTarget: e.target.value })} className="mt-1 w-full" />
            </label>
          </div>
          <div className="flex gap-2 justify-end pt-4">
            <Button variant="ghost" onClick={() => setAdding(false)}>Cancel</Button>
            <Button variant="primary" icon="Plus" onClick={submit}>Save</Button>
          </div>
        </Card>
      )}

      <Card title="LAN" subtitle="Private bridge (read-only — change at OS layer)">
        <SettingRow label="IPv4 address"><Input mono className="max-w-sm" defaultValue="10.0.0.1/24" readOnly /></SettingRow>
        <SettingRow label="Bridge"><Input mono className="max-w-sm" defaultValue="vmbr1" readOnly /></SettingRow>
      </Card>
    </>
  );
}

function Security() {
  return (
    <>
      <Card title="Authentication" subtitle="Admin login policy">
        <SettingRow label="Require MFA" hint="TOTP via authenticator app for all admins.">
          <ToggleSwitch value={true} onChange={() => {}} />
        </SettingRow>
        <SettingRow label="Session timeout">
          <Select className="max-w-sm" defaultValue="60">
            <option value="15">15 minutes</option><option value="60">1 hour</option><option value="240">4 hours</option>
          </Select>
        </SettingRow>
      </Card>
      <Card title="SSH Access" subtitle="Direct shell to the container">
        <SettingRow label="Enable SSH"><ToggleSwitch value={true} onChange={() => {}} /></SettingRow>
        <SettingRow label="Port"><Input mono className="max-w-sm" defaultValue="2222" /></SettingRow>
      </Card>
    </>
  );
}

interface Version {
  sha: string | null; short: string | null; branch: string | null;
  message: string | null; date: string | null; dirty: boolean; gitAvailable: boolean;
}
interface CommitSummary { sha: string; short: string; message: string; date: string }
interface CheckResult { ahead: number; behind: number; commits: CommitSummary[]; branch: string | null; remote: string | null }
interface UpdateEvent { step?: string; status?: 'start' | 'ok' | 'fail' | 'skip'; msg?: string; exit?: number; event?: 'restart' | 'done' | 'lock'; ok?: boolean }
interface MissingApps { missing: Array<{ binary: string; pkg: string | null; feature: string; hint: string }>; installable: string[] }

function Updates() {
  const [version, setVersion] = useState<Version | null>(null);
  const [check, setCheck] = useState<CheckResult | null>(null);
  const [checking, setChecking] = useState(false);
  const [running, setRunning] = useState(false);
  const [restartPolling, setRestartPolling] = useState(false);
  const [events, setEvents] = useState<UpdateEvent[]>([]);
  const [installMissing, setInstallMissing] = useState(true);
  const [apps, setApps] = useState<MissingApps | null>(null);
  const esRef = useRef<EventSource | null>(null);

  const loadVersion = () => api.get<Version>('/api/system/version').then(setVersion).catch(() => {});
  const loadApps    = () => api.get<MissingApps>('/api/system/apps/missing').then(setApps).catch(() => {});

  useEffect(() => { loadVersion(); loadApps(); }, []);

  const runCheck = async () => {
    setChecking(true);
    setCheck(null);
    try {
      const r = await api.post<CheckResult>('/api/system/update/check');
      setCheck(r);
    } catch (err: any) { alert(err?.message ?? 'check failed'); }
    finally { setChecking(false); }
  };

  // POST + SSE: we need to seed the request via fetch and read the stream manually
  // since EventSource only supports GET.
  const runUpdate = async () => {
    if (running) return;
    if (!window.confirm('Pull latest code, install missing apps (if checked), run migrations, and restart the service?')) return;
    setRunning(true);
    setEvents([]);
    try {
      const resp = await fetch('/api/system/update/run', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ installMissing }),
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
            if (!line.startsWith('data: ')) continue;
            try {
              const ev: UpdateEvent = JSON.parse(line.slice(6));
              setEvents(prev => [...prev, ev]);
              if (ev.event === 'restart') setRestartPolling(true);
            } catch { /* ignore */ }
          }
        }
      }
    } catch (err: any) {
      setEvents(prev => [...prev, { step: 'error', status: 'fail', msg: err?.message ?? String(err) }]);
    } finally {
      setRunning(false);
    }
  };

  // While a restart is happening, poll /api/system/version until the SHA changes.
  useEffect(() => {
    if (!restartPolling) return;
    const startSha = version?.sha;
    let cancelled = false;
    const tick = async () => {
      try {
        const v = await api.get<Version>('/api/system/version');
        if (!cancelled && v.sha && v.sha !== startSha) {
          setRestartPolling(false);
          setVersion(v);
          setEvents(prev => [...prev, { step: 'restart', status: 'ok', msg: `now at ${v.short}` }]);
          loadApps();
        }
      } catch { /* server still down */ }
    };
    const t = setInterval(tick, 2_000);
    return () => { cancelled = true; clearInterval(t); };
  }, [restartPolling, version?.sha]);

  return (
    <>
      <Card title="Current build" subtitle="What's running right now">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-5">
          <KV k="Commit"   v={version?.short ?? '—'} mono />
          <KV k="Branch"   v={version?.branch ?? '—'} mono />
          <KV k="Released" v={version?.date ? new Date(version.date).toLocaleString() : '—'} mono />
          <KV k="Status"   v={version?.dirty ? 'dirty working tree' : version?.gitAvailable ? 'clean' : 'git unavailable'} />
        </div>
        {version?.message && (
          <div className="mt-4 p-3 rounded-lg bg-zinc-900/40 border border-zinc-800/60">
            <div className="text-[10.5px] uppercase tracking-[0.08em] text-zinc-500 mb-1">Latest commit</div>
            <div className="text-[12.5px] text-zinc-200">{version.message}</div>
          </div>
        )}
      </Card>

      <Card title="System Updates" subtitle="Pull latest from origin and apply"
            action={<Button variant="ghost" size="sm" icon="RefreshCw" onClick={runCheck} disabled={checking || running}>{checking ? 'Checking…' : 'Check now'}</Button>}>
        {check === null && !checking && (
          <p className="text-[12px] text-zinc-500 leading-relaxed">
            Click <strong>Check now</strong> to <code className="font-mono">git fetch</code> and see if {version?.branch ? <>origin/<code className="font-mono">{version.branch}</code></> : 'origin'} is ahead of this build.
          </p>
        )}
        {checking && (
          <div className="flex items-center gap-3">
            <span className="shimmer h-2 rounded flex-1" />
            <span className="text-[11px] font-mono text-zinc-500">git fetch…</span>
          </div>
        )}
        {check && check.behind === 0 && (
          <div className="flex items-center gap-3 p-4 rounded-lg bg-emerald-500/10 border border-emerald-400/30">
            <Icon name="CheckCircle2" size={18} className="text-emerald-300" />
            <div className="flex-1">
              <div className="text-[13px] font-medium text-emerald-200">Up to date</div>
              <div className="text-[11.5px] text-emerald-200/80 mt-0.5">{check.branch} is at the same commit as {check.remote}.</div>
            </div>
          </div>
        )}
        {check && check.behind > 0 && (
          <div className="space-y-4">
            <div className="flex items-center gap-3 p-4 rounded-lg bg-cyan-500/10 border border-cyan-400/30">
              <Icon name="Download" size={18} className="text-cyan-300" />
              <div className="flex-1">
                <div className="text-[13px] font-medium text-cyan-200">
                  {check.behind} commit{check.behind === 1 ? '' : 's'} behind {check.remote}
                </div>
                <div className="text-[11.5px] text-cyan-200/80 mt-0.5">Pulling will reset hard to {check.remote} — local changes are lost.</div>
              </div>
              <label className="flex items-center gap-2 text-[11.5px] text-zinc-300 cursor-pointer">
                <input type="checkbox" checked={installMissing} onChange={(e) => setInstallMissing(e.target.checked)} className="accent-cyan-400" />
                also install missing apps
              </label>
              <Button variant="primary" size="md" icon="Download" onClick={runUpdate} disabled={running}>{running ? 'Installing…' : 'Install update'}</Button>
            </div>

            <div className="max-h-[260px] overflow-auto">
              <div className="text-[10.5px] uppercase tracking-[0.08em] text-zinc-500 mb-2">Incoming commits</div>
              <table className="w-full text-[12px]">
                <tbody className="divide-y divide-zinc-800/60">
                  {check.commits.map(c => (
                    <tr key={c.sha} className="hover:bg-zinc-900/30">
                      <td className="py-2 px-2 font-mono text-cyan-300">{c.short}</td>
                      <td className="py-2 px-2 text-zinc-300 truncate">{c.message}</td>
                      <td className="py-2 px-2 font-mono text-zinc-500 text-[10.5px]">{new Date(c.date).toLocaleDateString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </Card>

      {(events.length > 0 || running || restartPolling) && (
        <Card title="Update progress" subtitle={restartPolling ? 'Service restarting — waiting for the new commit…' : running ? 'Running…' : 'Last run'}
              action={restartPolling && <Badge variant="warn" size="sm" icon="Loader2">restarting</Badge>}>
          <div className="bg-zinc-950/60 border border-zinc-800/60 rounded-lg p-3 font-mono text-[11.5px] leading-relaxed max-h-[360px] overflow-auto">
            {events.map((ev, i) => {
              const color =
                ev.status === 'fail' ? 'text-rose-300' :
                ev.status === 'ok'   ? 'text-emerald-300' :
                ev.status === 'skip' ? 'text-zinc-500' :
                                       'text-sky-300';
              const label = ev.event ? `[${ev.event}]` : `[${ev.step ?? '?'}]`;
              const statusBadge = ev.status ? ev.status.toUpperCase() : '';
              return (
                <div key={i} className="flex gap-3 hover:bg-zinc-900/30 -mx-1 px-1 rounded">
                  <span className={`shrink-0 w-20 ${color}`}>{label}</span>
                  <span className={`shrink-0 w-12 ${color}`}>{statusBadge}</span>
                  <span className="text-zinc-300 truncate">{ev.msg ?? ''}</span>
                </div>
              );
            })}
            {(running || restartPolling) && (
              <div className="flex gap-3 mt-2 opacity-70">
                <span className="text-zinc-600 shrink-0">— working —</span>
                <span className="shimmer h-3 rounded flex-1 max-w-md" />
              </div>
            )}
          </div>
        </Card>
      )}

      {apps && apps.missing.length > 0 && (
        <Card title="Missing applications" subtitle={`${apps.missing.length} required tool${apps.missing.length === 1 ? '' : 's'} not installed`}>
          <table className="w-full text-[12.5px]">
            <tbody className="divide-y divide-zinc-800/60">
              {apps.missing.map(m => (
                <tr key={m.binary}>
                  <td className="py-2 font-mono text-zinc-100">{m.binary}</td>
                  <td className="py-2 text-zinc-400">{m.feature}</td>
                  <td className="py-2 font-mono text-[11px] text-cyan-300">{m.hint}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="text-[11.5px] text-zinc-500 mt-3">Tick "also install missing apps" above when running an update, or run `apt-get` manually.</p>
        </Card>
      )}
    </>
  );
}

function Backups() {
  return (
    <Card title="Configuration Backups" subtitle="Snapshot all rule files + state DB">
      <SettingRow label="Automatic backups"><ToggleSwitch value={true} onChange={() => {}} /></SettingRow>
      <SettingRow label="Schedule"><Select className="max-w-sm" defaultValue="daily"><option>Hourly</option><option>Daily</option><option>Weekly</option></Select></SettingRow>
      <SettingRow label="Retention" hint="Older backups are pruned automatically."><Input mono className="max-w-sm" defaultValue="14 backups" /></SettingRow>
    </Card>
  );
}

function Notify() {
  return (
    <Card title="Channels" subtitle="Where alerts go">
      <div className="space-y-2">
        {[
          { id: 'email',   label: 'Email',     icon: 'Mail',          target: 'ops@axesssystems.co.uk', enabled: true  },
          { id: 'slack',   label: 'Slack',     icon: 'MessageSquare', target: '#varrok-alerts',         enabled: true  },
          { id: 'webhook', label: 'Webhook',   icon: 'Webhook',       target: 'https://hooks.varrok.app/edge01', enabled: false },
        ].map(c => (
          <div key={c.id} className="flex items-center gap-3 p-3 rounded-lg bg-zinc-900/40 border border-zinc-800/60">
            <Icon name={c.icon} size={14} className="text-zinc-400" />
            <div className="flex-1 min-w-0">
              <div className="text-[12.5px] text-zinc-100">{c.label}</div>
              <code className="font-mono text-[11px] text-zinc-500 truncate block">{c.target}</code>
            </div>
            <Badge variant={c.enabled ? 'success' : 'neutral'} size="sm">{c.enabled ? 'enabled' : 'disabled'}</Badge>
          </div>
        ))}
      </div>
    </Card>
  );
}

function ApiPanel() {
  return (
    <Card title="REST API" subtitle="Programmatic control over VarrokEdge">
      <SettingRow label="API enabled"><ToggleSwitch value={true} onChange={() => {}} /></SettingRow>
      <SettingRow label="Base URL"><code className="font-mono text-[12px] text-cyan-300">/api</code></SettingRow>
      <SettingRow label="Rate limit"><Input mono className="max-w-sm" defaultValue="240 req/min per token" /></SettingRow>
    </Card>
  );
}

function About() {
  const [info, setInfo] = useState<any>(null);
  useEffect(() => { api.get('/api/settings/about').then(setInfo).catch(() => {}); }, []);
  return (
    <Card title="About VarrokEdge" subtitle="System & licence info">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-5">
        <KV k="Product"   v={info?.product ?? 'VarrokEdge'} />
        <KV k="Version"   v={`${info?.version ?? '0.9.2'} (build ${info?.build ?? '1187'})`} mono />
        <KV k="Channel"   v={info?.channel ?? 'stable'} />
        <KV k="Container" v={info?.container ?? 'ct-104'} mono />
        <KV k="Kernel"    v={info?.kernel ?? '—'} mono />
        <KV k="Hostname"  v={info?.hostname ?? '—'} mono />
        <KV k="Uptime"    v={info?.uptime ? formatUptime(info.uptime) : '—'} mono />
        <KV k="Platform"  v={info?.onLinux ? 'linux' : 'dev / non-linux'} mono />
      </div>
      <div className="divider mt-6 pt-5 flex flex-wrap gap-2">
        <Button variant="secondary" size="sm" icon="FileText">Release notes</Button>
        <Button variant="secondary" size="sm" icon="BookOpen">Documentation</Button>
        <Button variant="danger" size="sm" icon="Power">Reboot appliance</Button>
      </div>
    </Card>
  );
}

function formatUptime(secs: number): string {
  const d = Math.floor(secs / 86400);
  const h = Math.floor((secs % 86400) / 3600);
  const m = Math.floor((secs % 3600) / 60);
  return `${d}d ${h}h ${m}m`;
}
