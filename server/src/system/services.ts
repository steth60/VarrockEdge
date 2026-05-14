import { exec } from './exec';
import { config } from '../config';

export interface ServiceState {
  name: string;
  status: 'running' | 'stopped' | 'degraded';
  pid?: number;
  uptime?: string;
  desc: string;
}

async function systemctl(unit: string): Promise<ServiceState['status']> {
  if (!config.onLinux) return 'running';
  try {
    const r = await exec('systemctl', ['is-active', unit], { allowFailure: true });
    const v = r.stdout.trim();
    if (v === 'active') return 'running';
    if (v === 'activating' || v === 'reloading') return 'degraded';
    return 'stopped';
  } catch { return 'stopped'; }
}

async function pidOf(unit: string): Promise<number | undefined> {
  if (!config.onLinux) return undefined;
  try {
    const r = await exec('systemctl', ['show', '-p', 'MainPID', '--value', unit], { allowFailure: true });
    const n = Number(r.stdout.trim());
    return Number.isFinite(n) && n > 0 ? n : undefined;
  } catch { return undefined; }
}

const UNITS: Array<{ name: string; unit: string; desc: string }> = [
  { name: 'dnsmasq',         unit: 'dnsmasq.service',     desc: 'DHCP + Local DNS' },
  { name: 'wg-quick@wg0',    unit: 'wg-quick@wg0.service',desc: 'WireGuard tunnel' },
  { name: 'iptables',        unit: 'netfilter-persistent.service', desc: 'NAT + Firewall rules' },
  { name: 'nftables-monitor',unit: 'nftables-monitor.service',     desc: 'Rule sync watcher' },
];

export async function listServices(): Promise<ServiceState[]> {
  return Promise.all(UNITS.map(async u => ({
    name: u.name,
    desc: u.desc,
    status: await systemctl(u.unit),
    pid: await pidOf(u.unit),
    uptime: config.onLinux ? undefined : '6d 14h',
  })));
}

export async function reload(unit: string) {
  return exec('systemctl', ['reload', unit], { allowFailure: true });
}

export async function restart(unit: string) {
  return exec('systemctl', ['restart', unit], { allowFailure: true });
}
