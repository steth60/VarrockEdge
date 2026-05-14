import { Router, type Response } from 'express';
import { z } from 'zod';
import { currentVersion, checkUpdates, runUpdate, installPackages, scheduleRestart, type Step } from '../system/updater';
import { checkRequirements } from '../system/systemd';
import { requireRole } from '../auth/middleware';

const router = Router();

// In-flight lock — only one update or install at a time across all clients.
let inFlight: { kind: 'update' | 'install'; startedAt: number } | null = null;

function sse(res: Response) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders?.();
  return (s: Step | { event: 'lock' | 'done' | 'restart'; msg?: string; ok?: boolean }) => {
    res.write(`data: ${JSON.stringify(s)}\n\n`);
  };
}

router.get('/version', async (_req, res) => {
  res.json(await currentVersion());
});

router.post('/update/check', requireRole('Owner', 'Admin'), async (_req, res) => {
  try {
    res.json(await checkUpdates());
  } catch (err: any) {
    res.status(500).json({ error: err?.message ?? 'check failed' });
  }
});

router.post('/update/run', requireRole('Owner'), async (req, res) => {
  if (inFlight) {
    return res.status(409).json({ error: `${inFlight.kind} already running since ${new Date(inFlight.startedAt).toISOString()}` });
  }
  const schema = z.object({
    installMissing: z.boolean().optional(),
  });
  const parse = schema.safeParse(req.body ?? {});
  if (!parse.success) return res.status(400).json({ error: 'invalid input' });

  inFlight = { kind: 'update', startedAt: Date.now() };
  const send = sse(res);

  // Resolve list of missing apt packages if requested.
  let installApps: string[] = [];
  if (parse.data.installMissing) {
    const reqs = await checkRequirements();
    installApps = Array.from(new Set(reqs.filter(r => !r.installed && r.pkg).map(r => r.pkg as string)));
    if (installApps.length > 0) {
      send({ step: 'plan', status: 'ok', msg: `will install: ${installApps.join(' ')}` });
    }
  }

  let ok = false;
  try {
    const r = await runUpdate(send, { installApps });
    ok = r.ok;
  } catch (err: any) {
    send({ step: 'unhandled', status: 'fail', msg: err?.message ?? String(err) });
  } finally {
    inFlight = null;
  }

  if (ok) {
    send({ event: 'restart', msg: 'restarting service — your connection will drop. Poll /api/system/version until the SHA changes, then refresh.' });
    res.end();
    scheduleRestart(800);
    return;
  }
  send({ event: 'done', ok });
  res.end();
});

router.get('/apps/missing', async (_req, res) => {
  const reqs = await checkRequirements();
  res.json({
    missing: reqs.filter(r => !r.installed),
    installable: reqs.filter(r => !r.installed && r.pkg).map(r => r.pkg as string),
  });
});

router.post('/apps/install', requireRole('Owner', 'Admin'), async (req, res) => {
  if (inFlight) {
    return res.status(409).json({ error: `${inFlight.kind} already running since ${new Date(inFlight.startedAt).toISOString()}` });
  }
  const schema = z.object({
    packages: z.array(z.string().regex(/^[a-z0-9][a-z0-9.+-]*$/i)).optional(),
  });
  const parse = schema.safeParse(req.body ?? {});
  if (!parse.success) return res.status(400).json({ error: 'invalid input' });

  let packages = parse.data.packages;
  if (!packages || packages.length === 0) {
    const reqs = await checkRequirements();
    packages = Array.from(new Set(reqs.filter(r => !r.installed && r.pkg).map(r => r.pkg as string)));
  }

  inFlight = { kind: 'install', startedAt: Date.now() };
  const send = sse(res);
  try {
    const r = await installPackages(send, packages);
    send({ event: 'done', ok: r.ok });
  } catch (err: any) {
    send({ step: 'unhandled', status: 'fail', msg: err?.message ?? String(err) });
  } finally {
    inFlight = null;
    res.end();
  }
});

export default router;
