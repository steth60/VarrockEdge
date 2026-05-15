import fs from 'node:fs';
import { exec } from './exec';
import { config } from '../config';
import { loginStats } from '../auth/loginStats';

/** A subsystem health signal: success 0-100, or null when no data source. */
export interface HealthMetric { success: number | null; detail: string }

export interface ServiceHealth {
  dhcpAck: HealthMetric;
  dnsFailures: HealthMetric;
  natTranslate: HealthMetric;
  authUi: HealthMetric;
}

let cache: { ts: number; data: ServiceHealth } | null = null;
const TTL_MS = 60_000;

export async function getServiceHealth(): Promise<ServiceHealth> {
  if (cache && Date.now() - cache.ts < TTL_MS) return cache.data;
  const data: ServiceHealth = {
    dhcpAck: await dhcpAck(),
    dnsFailures: await dnsFailures(),
    natTranslate: natTranslate(),
    authUi: authUi(),
  };
  cache = { ts: Date.now(), data };
  return data;
}

// DHCP ACK rate — DHCPACK vs DHCPNAK in the dnsmasq journal over the last hour.
async function dhcpAck(): Promise<HealthMetric> {
  if (!config.onLinux) return { success: 99.6, detail: 'synthetic · 247 ACK / 1 NAK · 1h' };
  try {
    const r = await exec('journalctl', ['-u', 'dnsmasq', '--since', '-1h', '--no-pager'], { allowFailure: true });
    const ack = (r.stdout.match(/DHCPACK/g) ?? []).length;
    const nak = (r.stdout.match(/DHCPNAK/g) ?? []).length;
    const total = ack + nak;
    if (total === 0) return { success: 100, detail: 'idle · no DHCP traffic in 1h' };
    return { success: (ack / total) * 100, detail: `${ack} ACK / ${nak} NAK · 1h` };
  } catch {
    return { success: null, detail: 'dnsmasq journal unavailable' };
  }
}

// DNS failures — dnsmasq dumps cumulative stats to the journal on SIGUSR1.
async function dnsFailures(): Promise<HealthMetric> {
  if (!config.onLinux) return { success: 99.97, detail: 'synthetic · 3 failed of 9.4k' };
  try {
    await exec('pkill', ['-SIGUSR1', 'dnsmasq'], { allowFailure: true });
    await new Promise(r => setTimeout(r, 400));
    const r = await exec('journalctl', ['-u', 'dnsmasq', '--since', '-20s', '--no-pager'], { allowFailure: true });
    // "queries forwarded 4521, queries answered locally 8932, queries failed 12"
    const m = /queries forwarded (\d+), queries answered locally (\d+)(?:, queries failed (\d+))?/.exec(r.stdout);
    if (!m) return { success: null, detail: 'dnsmasq stats not reported' };
    const total = Number(m[1]) + Number(m[2]);
    const failed = Number(m[3] ?? 0);
    if (total === 0) return { success: 100, detail: 'idle · no queries yet' };
    return { success: 100 - (failed / total) * 100, detail: `${failed} failed of ${total}` };
  } catch {
    return { success: null, detail: 'dnsmasq journal unavailable' };
  }
}

// NAT translate — conntrack table headroom from /proc.
function natTranslate(): HealthMetric {
  if (!config.onLinux) return { success: 100, detail: 'synthetic · 4% of table' };
  try {
    const count = Number(fs.readFileSync('/proc/sys/net/netfilter/nf_conntrack_count', 'utf8').trim());
    const max = Number(fs.readFileSync('/proc/sys/net/netfilter/nf_conntrack_max', 'utf8').trim());
    if (!Number.isFinite(count) || !Number.isFinite(max) || max <= 0) {
      return { success: null, detail: 'conntrack not loaded' };
    }
    const usage = count / max;
    // Healthy until ~85% full, then degrade linearly to 0 at 100%.
    const success = usage < 0.85 ? 100 : Math.max(0, ((1 - usage) / 0.15) * 100);
    return { success, detail: `${(usage * 100).toFixed(0)}% of table · ${count}/${max}` };
  } catch {
    return { success: null, detail: 'conntrack not loaded' };
  }
}

// Auth (web UI) — login success rate over the last hour.
function authUi(): HealthMetric {
  const { ok, fail } = loginStats();
  const total = ok + fail;
  if (total === 0) return { success: 100, detail: 'idle · no logins in 1h' };
  return { success: (ok / total) * 100, detail: `${fail} failed / ${ok} ok · 1h` };
}
