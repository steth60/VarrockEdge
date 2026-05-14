import { Router } from 'express';
import os from 'node:os';
import { listServices } from '../system/services';
import { snapshot, getIface } from '../system/metrics';
import { config } from '../config';

const router = Router();

router.get('/services', async (_req, res) => {
  res.json({ services: await listServices() });
});

router.get('/snapshot', (_req, res) => {
  res.json(snapshot());
});

router.get('/interfaces', (_req, res) => {
  const ifs = os.networkInterfaces();
  const pick = (name: string) => {
    const arr = ifs[name];
    if (!arr) return null;
    const v4 = arr.find(a => a.family === 'IPv4');
    return v4 ? { name, ip: `${v4.address}/${cidrFromMask(v4.netmask)}`, mac: v4.mac } : null;
  };
  const wan = pick(config.wanIface) ?? { name: config.wanIface, ip: '51.38.114.207/29', mac: 'bc:24:11:8a:42:1f' };
  const lan = pick(config.lanIface) ?? { name: config.lanIface, ip: '10.0.0.1/24', mac: 'bc:24:11:8a:42:20' };
  const wanT = getIface(config.wanIface);
  const lanT = getIface(config.lanIface);
  res.json({
    wan: { ...wan, role: 'Public · OVH', rxMbps: wanT.rxMbps, txMbps: wanT.txMbps },
    lan: { ...lan, role: 'Private · vmbr1', rxMbps: lanT.rxMbps, txMbps: lanT.txMbps },
  });
});

router.get('/system', (_req, res) => {
  res.json({
    hostname: os.hostname(),
    kernel: os.release(),
    uptime: os.uptime(),
    version: '0.9.2',
    loadAvg: os.loadavg(),
    container: 'ct-104',
  });
});

function cidrFromMask(mask: string): number {
  return mask.split('.').reduce((acc, oct) => acc + (Number(oct).toString(2).match(/1/g)?.length ?? 0), 0);
}

export default router;
