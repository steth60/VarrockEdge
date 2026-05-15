import 'dotenv/config';
import os from 'node:os';
import path from 'node:path';

// `onLinux` gates real system integration (native daemons, /etc, iproute2).
// VE_SYNTHETIC=1 forces the synthetic/dry-run path regardless of platform —
// used by the test suite so it behaves identically on a Linux CI runner.
const onLinux = process.platform === 'linux' && process.env.VE_SYNTHETIC !== '1';

function env(name: string, fallback?: string): string {
  const v = process.env[name];
  if (v && v.length > 0) return v;
  if (fallback !== undefined) return fallback;
  throw new Error(`Missing required env var ${name}`);
}

function envOr(name: string, fallback: string): string {
  return process.env[name] && process.env[name]!.length > 0 ? process.env[name]! : fallback;
}

const defaultDb = onLinux
  ? '/var/lib/varrok-edge/varrok-edge.db'
  : path.resolve(process.cwd(), 'var/varrok-edge.db');

const defaultConfigDir = onLinux
  ? '/etc/varrok-edge'
  : path.resolve(process.cwd(), 'var/etc');

export const config = {
  bindHost: envOr('VE_BIND_HOST', onLinux ? '10.0.0.2' : '127.0.0.1'),
  port: Number(envOr('VE_PORT', '8080')),
  dbPath: envOr('VE_DB_PATH', defaultDb),
  configDir: envOr('VE_CONFIG_DIR', defaultConfigDir),
  wanIface: envOr('VE_WAN_IFACE', 'eth0'),
  lanIface: envOr('VE_LAN_IFACE', 'eth1'),
  sessionSecret: envOr('VE_SESSION_SECRET', 'dev-only-insecure-secret-change-me'),
  adminPassword: envOr('VE_ADMIN_PASSWORD', 'admin'),
  logLevel: envOr('VE_LOG_LEVEL', 'info'),
  onLinux,
  publicDir: path.resolve(__dirname, '../public'),
  hostname: os.hostname(),
};

export type AppConfig = typeof config;
