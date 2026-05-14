import { spawn, ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { config } from '../config';

export interface SpeedTestResult {
  downloadMbps: number;
  uploadMbps: number;
  pingMs: number;
  isp: string | null;
  server: string | null;
  ts: number;
  source: 'ookla' | 'synthetic';
}

export interface SpeedTestEvent {
  phase: 'ping' | 'download' | 'upload' | 'done' | 'error';
  mbps?: number;       // instantaneous Mbps (download/upload phases)
  pingMs?: number;     // populated on phase=ping & phase=done
  elapsed?: number;    // 0..1 progress within current phase
  result?: SpeedTestResult;  // populated on phase=done
  msg?: string;
}

const DOWNLOAD_SECS = 30;
const UPLOAD_SECS = 30;

/**
 * Streaming speedtest runner. Emits SpeedTestEvent on `data`.
 *
 * On Linux with Ookla `speedtest` installed: parses --progress=yes
 * machine-readable output (one JSON object per line).
 * Otherwise: a faithful 60s simulator (3s ping → 30s download → 30s
 * upload → done) with a noisy curve so the UI graph looks alive in
 * dev / on appliances without the binary.
 */
export function runSpeedTest(): EventEmitter & { cancel: () => void } {
  const emitter = new EventEmitter() as EventEmitter & { cancel: () => void };
  let proc: ChildProcess | undefined;
  let cancelled = false;
  let downSamples: number[] = [];
  let upSamples: number[] = [];
  let ping = 0;
  let isp: string | null = null;
  let server: string | null = null;
  let usingOokla = false;

  const finish = (source: 'ookla' | 'synthetic') => {
    const avg = (xs: number[]) => xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length;
    const result: SpeedTestResult = {
      downloadMbps: avg(downSamples),
      uploadMbps: avg(upSamples),
      pingMs: ping,
      isp, server,
      ts: Date.now(),
      source,
    };
    emitter.emit('data', { phase: 'done', result } as SpeedTestEvent);
    emitter.emit('end');
  };

  // ── Linux + Ookla path ──────────────────────────────────────────
  if (config.onLinux) {
    try {
      proc = spawn('speedtest', ['--format=jsonl', '--progress=yes', '--accept-license', '--accept-gdpr'], { stdio: ['ignore', 'pipe', 'pipe'] });
      usingOokla = true;
      let buf = '';
      proc.stdout?.on('data', d => {
        buf += d.toString();
        const lines = buf.split('\n');
        buf = lines.pop() ?? '';
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const j = JSON.parse(line);
            // `speedtest --format=jsonl --progress=yes` emits:
            //   {"type":"ping","ping":{"latency":14.1, ...}}
            //   {"type":"download","download":{"bandwidth":<bytes/sec>,"elapsed":<ms>,"progress":0..1}}
            //   {"type":"upload",  "upload":  {"bandwidth":<bytes/sec>,"elapsed":<ms>,"progress":0..1}}
            //   {"type":"result", ...}
            if (j.isp) isp = j.isp;
            if (j.server?.name) server = j.server.name;
            if (j.type === 'ping' && j.ping?.latency) {
              ping = j.ping.latency;
              emitter.emit('data', { phase: 'ping', pingMs: ping, elapsed: j.ping.progress ?? 1 } as SpeedTestEvent);
            } else if (j.type === 'download' && j.download?.bandwidth) {
              const mbps = j.download.bandwidth * 8 / 1_000_000;
              downSamples.push(mbps);
              emitter.emit('data', { phase: 'download', mbps, elapsed: j.download.progress ?? 0 } as SpeedTestEvent);
            } else if (j.type === 'upload' && j.upload?.bandwidth) {
              const mbps = j.upload.bandwidth * 8 / 1_000_000;
              upSamples.push(mbps);
              emitter.emit('data', { phase: 'upload', mbps, elapsed: j.upload.progress ?? 0 } as SpeedTestEvent);
            } else if (j.type === 'result') {
              if (j.download?.bandwidth) downSamples = [j.download.bandwidth * 8 / 1_000_000];
              if (j.upload?.bandwidth)   upSamples   = [j.upload.bandwidth   * 8 / 1_000_000];
            }
          } catch { /* ignore non-JSON lines */ }
        }
      });
      proc.on('close', code => {
        if (cancelled) return;
        if (code === 0 && (downSamples.length > 0 || upSamples.length > 0)) {
          finish('ookla');
        } else {
          // Binary missing or failed — fall back to simulator.
          usingOokla = false;
          simulate();
        }
      });
      proc.on('error', () => {
        usingOokla = false;
        simulate();
      });
      return emitter;
    } catch {
      // fall through to simulator
    }
  }

  // ── Synthetic simulator ─────────────────────────────────────────
  simulate();
  return emitter;

  function simulate() {
    if (cancelled) return;
    // Generate a per-second sample stream that looks like a real run.
    const stepMs = 500;
    let phase: SpeedTestEvent['phase'] = 'ping';
    let t = 0;
    const peakDown = 250 + Math.random() * 600;
    const peakUp = 60 + Math.random() * 200;
    ping = 8 + Math.random() * 14;
    isp = 'synthetic';
    server = 'dev mode';

    // Quick ping phase (~2s)
    const pingTimer = setInterval(() => {
      if (cancelled) return clearInterval(pingTimer);
      t += stepMs;
      emitter.emit('data', { phase: 'ping', pingMs: ping, elapsed: Math.min(1, t / 2000) } as SpeedTestEvent);
      if (t >= 2000) {
        clearInterval(pingTimer);
        phase = 'download';
        t = 0;
        const dlTimer = setInterval(() => {
          if (cancelled) return clearInterval(dlTimer);
          t += stepMs;
          const progress = t / (DOWNLOAD_SECS * 1000);
          // Spin-up: starts low, climbs to peak by ~30%, then steady with noise.
          const env = progress < 0.3 ? Math.sin(progress / 0.3 * Math.PI / 2) : 0.92 + Math.random() * 0.16;
          const mbps = Math.max(1, peakDown * env);
          downSamples.push(mbps);
          emitter.emit('data', { phase: 'download', mbps, elapsed: progress } as SpeedTestEvent);
          if (t >= DOWNLOAD_SECS * 1000) {
            clearInterval(dlTimer);
            phase = 'upload';
            t = 0;
            const ulTimer = setInterval(() => {
              if (cancelled) return clearInterval(ulTimer);
              t += stepMs;
              const progress = t / (UPLOAD_SECS * 1000);
              const env = progress < 0.3 ? Math.sin(progress / 0.3 * Math.PI / 2) : 0.92 + Math.random() * 0.16;
              const mbps = Math.max(1, peakUp * env);
              upSamples.push(mbps);
              emitter.emit('data', { phase: 'upload', mbps, elapsed: progress } as SpeedTestEvent);
              if (t >= UPLOAD_SECS * 1000) {
                clearInterval(ulTimer);
                finish('synthetic');
              }
            }, stepMs);
          }
        }, stepMs);
      }
    }, stepMs);
  }

  emitter.cancel = () => {
    cancelled = true;
    if (proc) proc.kill('SIGKILL');
    emitter.emit('data', { phase: 'error', msg: 'cancelled' } as SpeedTestEvent);
    emitter.emit('end');
  };
}

