import fs from 'node:fs';
import path from 'node:path';

/**
 * Write a file atomically with a fixed mode: write a temp file in the same
 * directory, fsync it, then rename over the target. A concurrent reader — or
 * a daemon reloading its config — never observes a half-written file, and the
 * mode is applied before the content is visible at the final path.
 */
export function atomicWrite(target: string, data: string, mode = 0o640): void {
  const dir = path.dirname(target);
  const tmp = path.join(dir, `.${path.basename(target)}.${process.pid}.tmp`);
  const fd = fs.openSync(tmp, 'w', mode);
  try {
    fs.writeFileSync(fd, data);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.chmodSync(tmp, mode); // openSync mode is subject to umask; pin it
  fs.renameSync(tmp, target);
}
