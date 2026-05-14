import { spawn } from 'node:child_process';
import { log } from '../logger';
import { config } from '../config';

export interface ExecOpts {
  stdin?: string;
  timeoutMs?: number;
  allowFailure?: boolean;
}

export interface ExecResult {
  stdout: string;
  stderr: string;
  code: number;
  dryRun: boolean;
}

export function exec(cmd: string, args: string[] = [], opts: ExecOpts = {}): Promise<ExecResult> {
  if (!config.onLinux) {
    log.info({ cmd, args, stdin: opts.stdin ? '<stdin>' : undefined, dryRun: true }, 'exec.skip');
    return Promise.resolve({ stdout: '', stderr: '', code: 0, dryRun: true });
  }
  return new Promise<ExecResult>((resolve, reject) => {
    const proc = spawn(cmd, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let killed = false;
    const timeout = setTimeout(() => {
      killed = true;
      proc.kill('SIGKILL');
    }, opts.timeoutMs ?? 15_000);
    proc.stdout.on('data', d => { stdout += d.toString(); });
    proc.stderr.on('data', d => { stderr += d.toString(); });
    proc.on('error', err => {
      clearTimeout(timeout);
      reject(err);
    });
    proc.on('close', code => {
      clearTimeout(timeout);
      const result: ExecResult = { stdout, stderr, code: code ?? -1, dryRun: false };
      if (killed) return reject(new Error(`exec timeout: ${cmd} ${args.join(' ')}`));
      if ((code ?? -1) !== 0 && !opts.allowFailure) {
        log.warn({ cmd, args, code, stderr }, 'exec.fail');
        return reject(Object.assign(new Error(`exec failed (${code}): ${stderr || stdout}`), result));
      }
      resolve(result);
    });
    if (opts.stdin) {
      proc.stdin.write(opts.stdin);
    }
    proc.stdin.end();
  });
}
