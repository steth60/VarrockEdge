import { useEffect, useState } from 'react';
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

function Network() {
  return (
    <>
      <Card title="WAN (eth0)" subtitle="Public-facing interface — OVH uplink">
        <SettingRow label="Addressing mode">
          <Select className="max-w-sm" defaultValue="static">
            <option value="static">Static</option><option value="dhcp">DHCP</option><option value="pppoe">PPPoE</option>
          </Select>
        </SettingRow>
        <SettingRow label="IPv4 address"><Input mono className="max-w-sm" defaultValue="51.38.114.207/29" /></SettingRow>
        <SettingRow label="Gateway"><Input mono className="max-w-sm" defaultValue="51.38.114.206" /></SettingRow>
        <SettingRow label="MTU"><Input mono className="max-w-sm" defaultValue="1500" /></SettingRow>
      </Card>
      <Card title="LAN (eth1)" subtitle="Private bridge — 10.0.0.0/24">
        <SettingRow label="IPv4 address"><Input mono className="max-w-sm" defaultValue="10.0.0.1/24" /></SettingRow>
        <SettingRow label="Bridge"><Input mono className="max-w-sm" defaultValue="vmbr1" /></SettingRow>
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

function Updates() {
  return (
    <Card title="System Updates" subtitle="VarrokEdge appliance image">
      <div className="flex items-center gap-4 p-4 rounded-lg bg-zinc-900/40 border border-zinc-800/60">
        <div className="w-10 h-10 rounded-lg bg-cyan-400/15 flex items-center justify-center">
          <Icon name="Download" size={18} className="text-cyan-300" />
        </div>
        <div className="flex-1">
          <div className="text-[13px] font-medium text-zinc-100">You're on the latest version — v0.9.2</div>
          <div className="text-[11.5px] text-zinc-500">Released 2 weeks ago · check back later for updates</div>
        </div>
        <Button variant="ghost" size="md" icon="RefreshCw">Check now</Button>
      </div>
    </Card>
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
