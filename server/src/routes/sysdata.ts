import { Router } from 'express';
import os from 'node:os';
import fs from 'node:fs';
import { config } from '../config';

const router = Router();

router.get('/', (_req, res) => {
  const cpus = os.cpus();
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const ifs = os.networkInterfaces();

  let kernelCmdline = '';
  let bootId = '';
  let machineId = '';
  if (config.onLinux) {
    try { kernelCmdline = fs.readFileSync('/proc/cmdline', 'utf8').trim(); } catch {}
    try { bootId = fs.readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim(); } catch {}
    try { machineId = fs.readFileSync('/etc/machine-id', 'utf8').trim(); } catch {}
  }

  res.json({
    hostname: os.hostname(),
    platform: process.platform,
    arch: os.arch(),
    release: os.release(),
    version: os.version(),
    type: os.type(),
    uptime: os.uptime(),
    loadAvg: os.loadavg(),
    cpus: cpus.map((c, i) => ({
      idx: i,
      model: c.model,
      speed: c.speed,           // MHz
      times: c.times,
    })),
    memory: {
      total: totalMem,
      free: freeMem,
      used: totalMem - freeMem,
    },
    interfaces: Object.entries(ifs).map(([name, addrs]) => ({
      name,
      addresses: (addrs ?? []).map(a => ({
        family: a.family,
        address: a.address,
        netmask: a.netmask,
        mac: a.mac,
        internal: a.internal,
      })),
    })),
    kernel: {
      release: os.release(),
      version: os.version(),
      cmdline: kernelCmdline,
      bootId,
      machineId,
    },
    onLinux: config.onLinux,
    container: 'ct-104',
    ts: Date.now(),
  });
});

export default router;
