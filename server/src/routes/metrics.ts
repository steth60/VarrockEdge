import { Router } from 'express';
import { snapshot } from '../system/metrics';

const router = Router();

router.get('/stream', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders?.();

  const send = () => {
    const data = snapshot();
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };
  // Initial tick
  send();
  const t = setInterval(send, 1400);
  const keepalive = setInterval(() => res.write(': ping\n\n'), 25_000);
  req.on('close', () => {
    clearInterval(t);
    clearInterval(keepalive);
  });
});

router.get('/snapshot', (_req, res) => {
  res.json(snapshot());
});

export default router;
