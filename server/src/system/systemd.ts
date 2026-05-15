import { exec } from './exec';
import { config } from '../config';
import { log } from '../logger';

export type Status = 'active' | 'inactive' | 'degraded' | 'failed';
export type SubState = 'running' | 'exited' | 'dead' | 'failed' | 'waiting';

export interface Service {
  unit: string;
  desc: string;
  category: 'VarrokEdge' | 'Network' | 'Security' | 'System';
  status: Status;
  sub: SubState;
  enabled: boolean;
  uptime: string;
  pid: number | null;
  cpu: number;       // percent
  mem: number;       // MB
  restarts: number;
  depends: string[];
  triggers: string[];
  file: string;
  critical: boolean;
  binary: string;    // underlying executable that must exist
  installed: boolean; // is the binary present?
}

// Known unit set — covers everything VarrokEdge orchestrates plus a few common neighbours.
const UNITS: Array<Omit<Service, 'status' | 'sub' | 'enabled' | 'uptime' | 'pid' | 'cpu' | 'mem' | 'restarts' | 'installed'>> = [
  { unit: 'dnsmasq.service',           desc: 'DHCP + DNS resolver',                category: 'Network',    depends: ['network.target'],            triggers: ['nss-lookup.target'], file: '/lib/systemd/system/dnsmasq.service',          critical: true,  binary: 'dnsmasq' },
  { unit: 'wg-quick@wg0.service',      desc: 'WireGuard tunnel wg0',                category: 'Network',    depends: ['network-online.target'],     triggers: [],                    file: '/lib/systemd/system/wg-quick@.service',         critical: true,  binary: 'wg-quick' },
  { unit: 'networking.service',        desc: 'Raise network interfaces',            category: 'Network',    depends: ['local-fs.target'],           triggers: [],                    file: '/lib/systemd/system/networking.service',        critical: true,  binary: 'ifup' },
  { unit: 'systemd-networkd.service',  desc: 'Network configuration manager',       category: 'Network',    depends: [],                            triggers: [],                    file: '/lib/systemd/system/systemd-networkd.service',  critical: false, binary: 'systemd-networkd' },
  { unit: 'systemd-resolved.service',  desc: 'Network name resolution',             category: 'Network',    depends: [],                            triggers: [],                    file: '/lib/systemd/system/systemd-resolved.service',  critical: false, binary: 'systemd-resolved' },
  { unit: 'avahi-daemon.service',      desc: 'Avahi mDNS/DNS-SD daemon',            category: 'Network',    depends: ['dbus.service'],              triggers: [],                    file: '/lib/systemd/system/avahi-daemon.service',      critical: false, binary: 'avahi-daemon' },
  { unit: 'miniupnpd.service',         desc: 'UPnP IGD + NAT-PMP daemon',           category: 'Network',    depends: ['network-online.target'],     triggers: [],                    file: '/lib/systemd/system/miniupnpd.service',         critical: false, binary: 'miniupnpd' },

  { unit: 'netfilter-persistent.service', desc: 'Persistent iptables ruleset',      category: 'Security',   depends: ['network-pre.target'],        triggers: [],                    file: '/lib/systemd/system/netfilter-persistent.service', critical: true,  binary: 'iptables' },
  { unit: 'fail2ban.service',          desc: 'IP banning daemon — log scanner',     category: 'Security',   depends: ['netfilter-persistent.service'], triggers: [],                 file: '/lib/systemd/system/fail2ban.service',          critical: true,  binary: 'fail2ban-client' },
  { unit: 'ssh.service',               desc: 'OpenSSH daemon',                      category: 'Security',   depends: ['network-online.target'],     triggers: [],                    file: '/lib/systemd/system/ssh.service',                critical: true,  binary: 'sshd' },

  { unit: 'systemd-timesyncd.service', desc: 'Network time synchronization',        category: 'System',     depends: [],                            triggers: [],                    file: '/lib/systemd/system/systemd-timesyncd.service', critical: false, binary: 'systemd-timesyncd' },
  { unit: 'systemd-journald.service',  desc: 'Journal log management',              category: 'System',     depends: [],                            triggers: [],                    file: '/lib/systemd/system/systemd-journald.service',  critical: true,  binary: 'systemd-journald' },
  { unit: 'cron.service',              desc: 'Periodic command scheduler',          category: 'System',     depends: [],                            triggers: [],                    file: '/lib/systemd/system/cron.service',              critical: false, binary: 'cron' },
  { unit: 'unattended-upgrades.service', desc: 'Automatic security updates',        category: 'System',     depends: [],                            triggers: [],                    file: '/lib/systemd/system/unattended-upgrades.service', critical: false, binary: 'unattended-upgrade' },

  { unit: 'varrok-edge.service',       desc: 'VarrokEdge control plane (Web UI + API)', category: 'VarrokEdge', depends: ['network.target', 'dnsmasq.service'], triggers: [],         file: '/etc/systemd/system/varrok-edge.service',       critical: true,  binary: 'node' },
];

/** Run `which <bin>` to check if a binary is installed. */
async function which(binary: string): Promise<boolean> {
  if (!config.onLinux) {
    // Pretend the core appliance deps are installed on macOS dev.
    const installed = new Set(['dnsmasq', 'wg-quick', 'iptables', 'fail2ban-client', 'systemd-journald', 'systemd-timesyncd', 'cron', 'sshd', 'node', 'git']);
    return installed.has(binary);
  }
  try {
    const r = await exec('which', [binary], { allowFailure: true });
    return r.code === 0 && r.stdout.trim().length > 0;
  } catch { return false; }
}

interface UnitProps {
  ActiveState?: string;
  SubState?: string;
  UnitFileState?: string;
  MainPID?: string;
  ExecMainStartTimestamp?: string;
  NRestarts?: string;
  CPUUsageNSec?: string;
  MemoryCurrent?: string;
}

async function show(unit: string): Promise<UnitProps | null> {
  if (!config.onLinux) return null;
  try {
    const r = await exec('systemctl', [
      'show', unit,
      '-p', 'ActiveState',
      '-p', 'SubState',
      '-p', 'UnitFileState',
      '-p', 'MainPID',
      '-p', 'ExecMainStartTimestamp',
      '-p', 'NRestarts',
      '-p', 'CPUUsageNSec',
      '-p', 'MemoryCurrent',
      '--no-pager',
    ], { allowFailure: true });
    if (r.code !== 0) return null;
    const out: any = {};
    for (const line of r.stdout.split('\n')) {
      const idx = line.indexOf('=');
      if (idx > 0) out[line.slice(0, idx)] = line.slice(idx + 1);
    }
    return out as UnitProps;
  } catch { return null; }
}

function formatUptime(secs: number): string {
  if (!secs) return '—';
  const d = Math.floor(secs / 86400);
  const h = Math.floor((secs % 86400) / 3600);
  const m = Math.floor((secs % 3600) / 60);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function deriveStatus(p: UnitProps): { status: Status; sub: SubState } {
  const sub = (p.SubState ?? 'dead') as SubState;
  if (p.ActiveState === 'active' && sub === 'running') return { status: 'active', sub };
  if (p.ActiveState === 'active' && sub === 'exited') return { status: 'active', sub };
  if (p.ActiveState === 'active' && sub === 'waiting') return { status: 'active', sub };
  if (p.ActiveState === 'failed') return { status: 'failed', sub: 'failed' };
  if (p.ActiveState === 'activating' || p.ActiveState === 'reloading') return { status: 'degraded', sub };
  return { status: 'inactive', sub };
}

function mockState(u: typeof UNITS[number]): Service {
  // Stable mock that mirrors the design seed.
  const seedMap: Record<string, Partial<Service>> = {
    'dnsmasq.service':              { status: 'active',   sub: 'running', enabled: true,  uptime: '6d 14h 22m', pid: 1843, cpu: 0.4, mem: 18,  restarts: 0 },
    'wg-quick@wg0.service':         { status: 'active',   sub: 'running', enabled: true,  uptime: '6d 14h 22m', pid: 1902, cpu: 0.1, mem: 4,   restarts: 0 },
    'networking.service':           { status: 'active',   sub: 'exited',  enabled: true,  uptime: '6d 14h 22m', pid: null, cpu: 0,   mem: 0,   restarts: 0 },
    'systemd-networkd.service':     { status: 'inactive', sub: 'dead',    enabled: false, uptime: '—',          pid: null, cpu: 0,   mem: 0,   restarts: 0 },
    'systemd-resolved.service':     { status: 'inactive', sub: 'dead',    enabled: false, uptime: '—',          pid: null, cpu: 0,   mem: 0,   restarts: 0 },
    'avahi-daemon.service':         { status: 'failed',   sub: 'failed',  enabled: false, uptime: '—',          pid: null, cpu: 0,   mem: 0,   restarts: 5 },
    'netfilter-persistent.service': { status: 'active',   sub: 'exited',  enabled: true,  uptime: '6d 14h 22m', pid: null, cpu: 0,   mem: 0,   restarts: 0 },
    'fail2ban.service':             { status: 'active',   sub: 'running', enabled: true,  uptime: '6d 14h 18m', pid: 2104, cpu: 0.8, mem: 42,  restarts: 1 },
    'ssh.service':                  { status: 'active',   sub: 'running', enabled: true,  uptime: '6d 14h 22m', pid: 924,  cpu: 0,   mem: 8,   restarts: 0 },
    'systemd-timesyncd.service':    { status: 'active',   sub: 'running', enabled: true,  uptime: '6d 14h 22m', pid: 482,  cpu: 0,   mem: 2,   restarts: 0 },
    'systemd-journald.service':     { status: 'active',   sub: 'running', enabled: true,  uptime: '6d 14h 22m', pid: 224,  cpu: 0.1, mem: 28,  restarts: 0 },
    'cron.service':                 { status: 'active',   sub: 'running', enabled: true,  uptime: '6d 14h 22m', pid: 716,  cpu: 0,   mem: 3,   restarts: 0 },
    'unattended-upgrades.service':  { status: 'inactive', sub: 'dead',    enabled: true,  uptime: '—',          pid: null, cpu: 0,   mem: 0,   restarts: 0 },
    'varrok-edge.service':          { status: 'active',   sub: 'running', enabled: true,  uptime: '6d 14h 22m', pid: 1622, cpu: 1.8, mem: 142, restarts: 0 },
  };
  const seed = seedMap[u.unit] ?? { status: 'inactive' as Status, sub: 'dead' as SubState, enabled: false, uptime: '—', pid: null, cpu: 0, mem: 0, restarts: 0 };
  return { ...u, ...(seed as any), installed: true };
}

export async function listServices(): Promise<Service[]> {
  const out: Service[] = [];
  for (const u of UNITS) {
    const installed = await which(u.binary);
    if (!config.onLinux) {
      const mock = mockState(u);
      mock.installed = installed; // honour real `which` on mac (mostly false except mocked set)
      // If binary not installed, set status to inactive so the UI surfaces it.
      if (!installed) { mock.status = 'inactive'; mock.sub = 'dead'; mock.uptime = '—'; mock.pid = null; mock.cpu = 0; mock.mem = 0; }
      out.push(mock);
      continue;
    }
    if (!installed) {
      out.push({ ...u, status: 'inactive', sub: 'dead', enabled: false, uptime: '—', pid: null, cpu: 0, mem: 0, restarts: 0, installed: false });
      continue;
    }
    const p = await show(u.unit);
    if (!p) {
      out.push({ ...u, status: 'inactive', sub: 'dead', enabled: false, uptime: '—', pid: null, cpu: 0, mem: 0, restarts: 0, installed: true });
      continue;
    }
    const { status, sub } = deriveStatus(p);
    const pid = Number(p.MainPID ?? 0);
    const memBytes = Number(p.MemoryCurrent ?? 0);
    const cpuNs = Number(p.CPUUsageNSec ?? 0);
    const startTs = p.ExecMainStartTimestamp ? Date.parse(p.ExecMainStartTimestamp) : NaN;
    const uptimeSec = Number.isFinite(startTs) ? Math.max(0, Math.floor((Date.now() - startTs) / 1000)) : 0;
    out.push({
      ...u,
      status, sub,
      enabled: p.UnitFileState === 'enabled' || p.UnitFileState === 'enabled-runtime' || p.UnitFileState === 'static',
      uptime: status === 'active' && uptimeSec > 0 ? formatUptime(uptimeSec) : '—',
      pid: pid > 0 ? pid : null,
      cpu: cpuNs > 0 && uptimeSec > 0 ? Math.min(100, Math.round((cpuNs / 1_000_000_000 / Math.max(1, uptimeSec)) * 100 * 10) / 10) : 0,
      mem: memBytes > 0 ? Math.round(memBytes / 1024 / 1024) : 0,
      restarts: Number(p.NRestarts ?? 0),
      installed: true,
    });
  }
  return out;
}

export async function action(unit: string, action: 'start' | 'stop' | 'restart' | 'reload' | 'enable' | 'disable'): Promise<void> {
  // Whitelist the unit against known set to avoid CLI injection.
  if (!UNITS.some(u => u.unit === unit)) throw new Error(`unknown unit ${unit}`);
  if (!config.onLinux) {
    log.info({ unit, action, dryRun: true }, 'systemctl.skip');
    return;
  }
  await exec('systemctl', [action, unit]);
}

export async function journalTail(unit: string, lines = 30): Promise<Array<{ t: string; svc: string; msg: string }>> {
  if (!UNITS.some(u => u.unit === unit)) throw new Error(`unknown unit ${unit}`);
  if (!config.onLinux) {
    return [
      { t: '14:22:18', svc: unit, msg: `${unit}: nominal` },
      { t: '14:21:44', svc: unit, msg: 'periodic health check ok' },
      { t: '14:20:12', svc: unit, msg: 'no warnings' },
    ];
  }
  try {
    const r = await exec('journalctl', ['-u', unit, '-n', String(lines), '--no-pager', '-o', 'short'], { allowFailure: true });
    if (r.code !== 0) return [];
    return r.stdout.split('\n').filter(Boolean).map(line => {
      const m = /^[A-Za-z]+\s+\d+\s+(\d{2}:\d{2}:\d{2})\s+\S+\s+([^:\[]+)(?:\[\d+\])?:\s+(.*)$/.exec(line);
      if (m) return { t: m[1] ?? '', svc: (m[2] ?? '').trim(), msg: m[3] ?? '' };
      return { t: '', svc: unit, msg: line };
    });
  } catch { return []; }
}

/**
 * Probe the binaries VarrokEdge depends on directly.
 * Returns each name + whether `which` finds it.
 */
export interface Requirement {
  name: string;
  binary: string;
  feature: string;
  installed: boolean;
  hint: string;
  /** apt package name, or null if not installable via apt (built-in to systemd, etc.) */
  pkg: string | null;
}

const REQUIREMENTS: Array<Omit<Requirement, 'installed'>> = [
  { name: 'dnsmasq',            binary: 'dnsmasq',         feature: 'DHCP + Local DNS',         hint: 'apt-get install dnsmasq',              pkg: 'dnsmasq' },
  { name: 'WireGuard tools',    binary: 'wg',              feature: 'VPN tunnel + peers',       hint: 'apt-get install wireguard-tools',      pkg: 'wireguard-tools' },
  { name: 'wg-quick',           binary: 'wg-quick',        feature: 'WireGuard interface mgmt', hint: 'apt-get install wireguard-tools',      pkg: 'wireguard-tools' },
  { name: 'iptables',           binary: 'iptables',        feature: 'NAT + firewall rules',     hint: 'apt-get install iptables',             pkg: 'iptables' },
  { name: 'iptables-save',      binary: 'iptables-save',   feature: 'Persist firewall on boot', hint: 'apt-get install iptables-persistent',  pkg: 'iptables-persistent' },
  { name: 'netfilter-persistent', binary: 'netfilter-persistent', feature: 'Restore rules at boot', hint: 'apt-get install iptables-persistent', pkg: 'iptables-persistent' },
  { name: 'fail2ban',           binary: 'fail2ban-client', feature: 'Security: block list / IDS', hint: 'apt-get install fail2ban',           pkg: 'fail2ban' },
  { name: 'miniupnpd',          binary: 'miniupnpd',       feature: 'UPnP IGD + NAT-PMP',       hint: 'apt-get install miniupnpd',            pkg: 'miniupnpd' },
  { name: 'systemctl',          binary: 'systemctl',       feature: 'Service supervision',      hint: 'systemd (built-in)',                   pkg: null },
  { name: 'journalctl',         binary: 'journalctl',      feature: 'Log streaming',            hint: 'systemd (built-in)',                   pkg: null },
  { name: 'sqlite3',            binary: 'sqlite3',         feature: 'DB CLI (optional)',        hint: 'apt-get install sqlite3',              pkg: 'sqlite3' },
  { name: 'git',                binary: 'git',             feature: 'Self-update via pull',     hint: 'apt-get install git',                  pkg: 'git' },
];

export async function checkRequirements(): Promise<Requirement[]> {
  const out: Requirement[] = [];
  for (const r of REQUIREMENTS) {
    out.push({ ...r, installed: await which(r.binary) });
  }
  return out;
}
