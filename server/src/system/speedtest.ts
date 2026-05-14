import { spawn } from 'node:child_process';
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

/**
 * Run the Ookla `speedtest` CLI. Falls back to a synthetic result on macOS
 * dev or when the binary isn't available.
 */
export async function runSpeedTest(timeoutMs = 90_000): Promise<SpeedTestResult> {
  if (!config.onLinux) return synthetic();
  return new Promise(resolve => {
    const proc = spawn('speedtest', ['--format=json', '--accept-license', '--accept-gdpr'], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    const t = setTimeout(() => { proc.kill('SIGKILL'); }, timeoutMs);
    proc.stdout.on('data', d => { out += d.toString(); });
    proc.stderr.on('data', d => { err += d.toString(); });
    proc.on('close', code => {
      clearTimeout(t);
      if (code !== 0 || !out) return resolve(synthetic());
      try {
        const j = JSON.parse(out);
        resolve({
          // Ookla returns bytes/s — convert to Mbps.
          downloadMbps: j.download?.bandwidth ? (j.download.bandwidth * 8) / 1_000_000 : 0,
          uploadMbps:   j.upload?.bandwidth   ? (j.upload.bandwidth   * 8) / 1_000_000 : 0,
          pingMs:       j.ping?.latency ?? 0,
          isp:          j.isp ?? null,
          server:       j.server?.name ?? null,
          ts:           Date.now(),
          source:       'ookla',
        });
      } catch {
        resolve(synthetic());
      }
    });
    proc.on('error', () => { clearTimeout(t); resolve(synthetic()); });
  });
}

function synthetic(): SpeedTestResult {
  return {
    downloadMbps: 200 + Math.random() * 400,
    uploadMbps:   50 + Math.random() * 100,
    pingMs:       8 + Math.random() * 12,
    isp:          'synthetic',
    server:       'dev mode',
    ts:           Date.now(),
    source:       'synthetic',
  };
}
