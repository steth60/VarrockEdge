import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { exec } from './exec';
import { config } from '../config';
import { log } from '../logger';

// App root is two levels up from server/dist (or server/src in dev via tsx).
export const APP_DIR = path.resolve(__dirname, '../../..');

export interface Version {
  sha: string | null;
  short: string | null;
  branch: string | null;
  message: string | null;
  date: string | null;
  dirty: boolean;
  gitAvailable: boolean;
}

async function git(args: string[]): Promise<{ stdout: string; code: number }> {
  return new Promise(resolve => {
    const proc = spawn('git', ['-C', APP_DIR, ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    proc.stdout.on('data', d => { out += d.toString(); });
    proc.stderr.on('data', d => { out += d.toString(); });
    proc.on('close', code => resolve({ stdout: out.trim(), code: code ?? -1 }));
    proc.on('error', () => resolve({ stdout: '', code: -1 }));
  });
}

export async function currentVersion(): Promise<Version> {
  const fallback: Version = {
    sha: null, short: null, branch: null, message: null, date: null, dirty: false, gitAvailable: false,
  };
  if (!fs.existsSync(path.join(APP_DIR, '.git'))) return fallback;
  const head = await git(['rev-parse', 'HEAD']);
  if (head.code !== 0) return fallback;
  const short  = await git(['rev-parse', '--short=8', 'HEAD']);
  const branch = await git(['rev-parse', '--abbrev-ref', 'HEAD']);
  const subject= await git(['log', '-1', '--pretty=%s']);
  const date   = await git(['log', '-1', '--pretty=%cI']);
  const status = await git(['status', '--porcelain']);
  return {
    sha: head.stdout || null,
    short: short.stdout || null,
    branch: branch.stdout || null,
    message: subject.stdout || null,
    date: date.stdout || null,
    dirty: status.stdout.length > 0,
    gitAvailable: true,
  };
}

export interface CommitSummary { sha: string; short: string; message: string; date: string }

export async function checkUpdates(): Promise<{
  ahead: number;
  behind: number;
  commits: CommitSummary[];
  branch: string | null;
  remote: string | null;
}> {
  const v = await currentVersion();
  if (!v.gitAvailable) {
    return { ahead: 0, behind: 0, commits: [], branch: null, remote: null };
  }
  const remoteRef = `origin/${v.branch ?? 'main'}`;
  // Fetch with a timeout — if the host has no network this should fail fast.
  await new Promise<void>(resolve => {
    const p = spawn('git', ['-C', APP_DIR, 'fetch', '--quiet', 'origin', v.branch ?? 'main'], { stdio: 'ignore' });
    const t = setTimeout(() => { p.kill('SIGTERM'); }, 15_000);
    p.on('close', () => { clearTimeout(t); resolve(); });
    p.on('error', () => { clearTimeout(t); resolve(); });
  });
  const counts = await git(['rev-list', '--left-right', '--count', `HEAD...${remoteRef}`]);
  let ahead = 0, behind = 0;
  if (counts.code === 0) {
    const parts = counts.stdout.split(/\s+/);
    ahead  = Number(parts[0] ?? 0);
    behind = Number(parts[1] ?? 0);
  }
  const commits: CommitSummary[] = [];
  if (behind > 0) {
    const log = await git(['log', `HEAD..${remoteRef}`, '--pretty=%H%x00%h%x00%s%x00%cI', '-n', '30']);
    if (log.code === 0) {
      for (const line of log.stdout.split('\n')) {
        const parts = line.split('\0');
        if (parts.length === 4) {
          commits.push({ sha: parts[0]!, short: parts[1]!, message: parts[2]!, date: parts[3]! });
        }
      }
    }
  }
  return { ahead, behind, commits, branch: v.branch, remote: remoteRef };
}

export interface Step {
  step: string;
  status: 'start' | 'ok' | 'fail' | 'skip';
  msg?: string;
  exit?: number;
}

type Emitter = (s: Step) => void;

async function runStep(emit: Emitter, name: string, cmd: string, args: string[], opts?: { cwd?: string; allowFailure?: boolean; timeoutMs?: number }): Promise<boolean> {
  emit({ step: name, status: 'start', msg: `${cmd} ${args.join(' ')}` });
  return new Promise(resolve => {
    const proc = spawn(cmd, args, { cwd: opts?.cwd ?? APP_DIR, stdio: ['ignore', 'pipe', 'pipe'] });
    let tail = '';
    const t = setTimeout(() => { proc.kill('SIGKILL'); }, opts?.timeoutMs ?? 600_000);
    proc.stdout.on('data', d => { tail += d.toString(); });
    proc.stderr.on('data', d => { tail += d.toString(); });
    proc.on('close', code => {
      clearTimeout(t);
      const ok = code === 0;
      const msg = tail.trim().split('\n').slice(-5).join('\n');
      emit({ step: name, status: ok || opts?.allowFailure ? 'ok' : 'fail', msg: msg || undefined, exit: code ?? -1 });
      resolve(ok || !!opts?.allowFailure);
    });
    proc.on('error', err => {
      clearTimeout(t);
      emit({ step: name, status: 'fail', msg: err.message });
      resolve(false);
    });
  });
}

/**
 * Run a full update. Yields step events. On success the caller is expected
 * to restart the service (we don't kill ourselves here — caller decides).
 */
export async function runUpdate(emit: Emitter, opts?: { installApps?: string[] }): Promise<{ ok: boolean }> {
  const v = await currentVersion();
  if (!v.gitAvailable) {
    emit({ step: 'preflight', status: 'fail', msg: 'no .git directory found at ' + APP_DIR });
    return { ok: false };
  }
  emit({ step: 'preflight', status: 'ok', msg: `current ${v.short} on ${v.branch}` });

  // 1. git fetch + reset --hard origin/<branch>
  if (!await runStep(emit, 'git.fetch', 'git', ['-C', APP_DIR, 'fetch', '--quiet', 'origin', v.branch ?? 'main'], { timeoutMs: 60_000 })) return { ok: false };
  if (!await runStep(emit, 'git.reset', 'git', ['-C', APP_DIR, 'reset', '--hard', `origin/${v.branch ?? 'main'}`])) return { ok: false };

  // 2. npm ci (only if Linux — dev installs are noisy and slow)
  if (config.onLinux) {
    if (!await runStep(emit, 'npm.ci', 'npm', ['ci', '--no-audit', '--no-fund'], { timeoutMs: 300_000 })) return { ok: false };
  } else {
    emit({ step: 'npm.ci', status: 'skip', msg: 'dev mode (non-linux)' });
  }

  // 3. Build
  if (!await runStep(emit, 'build', 'npm', ['run', 'build'], { timeoutMs: 180_000 })) return { ok: false };

  // 4. Apt-install missing packages (Linux only)
  if (config.onLinux && opts?.installApps && opts.installApps.length > 0) {
    if (!await runStep(emit, 'apt.update', 'apt-get', ['update', '-qq'], { timeoutMs: 60_000, allowFailure: true })) {
      // soft-allow apt-get update failure (offline) — continue to install attempt
    }
    if (!await runStep(emit, 'apt.install', 'apt-get', ['install', '-y', '--no-install-recommends', ...opts.installApps], { timeoutMs: 300_000 })) return { ok: false };
  } else if (opts?.installApps && opts.installApps.length > 0) {
    emit({ step: 'apt.install', status: 'skip', msg: `dev mode — would install: ${opts.installApps.join(' ')}` });
  }

  // 5. DB migrations
  if (!await runStep(emit, 'db.migrate', 'npm', ['run', 'db:migrate'], { timeoutMs: 60_000 })) return { ok: false };

  const after = await currentVersion();
  emit({ step: 'done', status: 'ok', msg: `now at ${after.short} — restart pending` });
  return { ok: true };
}

/** Install a set of apt packages on Linux. Streams via the same Step shape. */
export async function installPackages(emit: Emitter, packages: string[]): Promise<{ ok: boolean }> {
  if (packages.length === 0) {
    emit({ step: 'apt.install', status: 'skip', msg: 'nothing to install' });
    return { ok: true };
  }
  if (!config.onLinux) {
    emit({ step: 'apt.install', status: 'skip', msg: `dev mode — would install: ${packages.join(' ')}` });
    return { ok: true };
  }
  await runStep(emit, 'apt.update',  'apt-get', ['update', '-qq'], { timeoutMs: 60_000, allowFailure: true });
  const ok = await runStep(emit, 'apt.install', 'apt-get', ['install', '-y', '--no-install-recommends', ...packages], { timeoutMs: 300_000 });
  return { ok };
}

/**
 * Schedule a self-restart via systemctl. Spawns detached so it survives our
 * exit; the unit's Restart= directive brings us back.
 */
export function scheduleRestart(delayMs = 600): void {
  log.warn({ delayMs, onLinux: config.onLinux }, 'self-restart scheduled');
  setTimeout(() => {
    if (config.onLinux) {
      try {
        const p = spawn('systemctl', ['restart', 'varrok-edge'], { detached: true, stdio: 'ignore' });
        p.unref();
      } catch (err) {
        log.error({ err }, 'systemctl restart failed; exiting and relying on systemd Restart=');
      }
      // Even if systemctl spawn errors, exit with non-zero so systemd's
      // Restart=on-failure picks us up.
      setTimeout(() => process.exit(2), 500);
    } else {
      // Dev: just log and stay up.
      log.warn('dev mode — would systemctl restart varrok-edge here');
    }
  }, delayMs);
}
