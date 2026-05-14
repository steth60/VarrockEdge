import { Router } from 'express';
import { recentLogs, tail } from '../system/journal';

const router = Router();

router.get('/recent', (_req, res) => {
  res.json({ logs: recentLogs(100) });
});

router.get('/stream', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders?.();
  const t = tail(['dnsmasq', 'wg-quick@wg0', 'netfilter-persistent']);
  t.on('line', line => {
    res.write(`data: ${JSON.stringify(line)}\n\n`);
  });
  const keepalive = setInterval(() => res.write(': ping\n\n'), 25_000);
  req.on('close', () => {
    clearInterval(keepalive);
    t.stop();
  });
});

export default router;
