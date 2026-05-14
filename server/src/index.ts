import express from 'express';
import cookieParser from 'cookie-parser';
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { config } from './config';
import { log } from './logger';
import { runMigrations } from './db/migrate';
import { loadUser, requireAuth } from './auth/middleware';
import authRoutes from './auth/routes';
import overviewRoutes from './routes/overview';
import metricsRoutes from './routes/metrics';
import dhcpRoutes from './routes/dhcp';
import dnsRoutes from './routes/dns';
import wgRoutes from './routes/wireguard';
import fwRoutes from './routes/firewall';
import userRoutes from './routes/users';
import settingsRoutes from './routes/settings';
import logsRoutes from './routes/logs';
import topologyRoutes from './routes/topology';
import { ensureServerAsync } from './system/wireguard';

function refuseUnsafeBind(host: string) {
  if (host === '0.0.0.0' || host === '::' || host === '*') {
    throw new Error(`Refusing to bind on ${host} — VarrokEdge must not be reachable from WAN. Set VE_BIND_HOST=10.0.0.2 (LAN) or 127.0.0.1 (local).`);
  }
  // Refuse to bind to the WAN interface IP if we can detect it.
  if (config.onLinux) {
    const ifs = os.networkInterfaces();
    const wan = ifs[config.wanIface];
    if (wan) {
      for (const a of wan) {
        if (a.family === 'IPv4' && a.address === host) {
          throw new Error(`Refusing to bind to WAN interface ${config.wanIface} (${host}). Use the LAN IP instead.`);
        }
      }
    }
  }
}

async function main() {
  log.info({ host: config.bindHost, port: config.port, linux: config.onLinux }, 'starting');
  refuseUnsafeBind(config.bindHost);

  runMigrations();
  await ensureServerAsync().catch(err => log.warn({ err }, 'wg init skipped'));

  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());
  app.use(loadUser);

  // Public routes
  app.use('/api/auth', authRoutes);

  // Protected routes
  app.use('/api/overview', requireAuth, overviewRoutes);
  app.use('/api/metrics',  requireAuth, metricsRoutes);
  app.use('/api/dhcp',     requireAuth, dhcpRoutes);
  app.use('/api/dns',      requireAuth, dnsRoutes);
  app.use('/api/wireguard',requireAuth, wgRoutes);
  app.use('/api/firewall', requireAuth, fwRoutes);
  app.use('/api/users',    requireAuth, userRoutes);
  app.use('/api/settings', requireAuth, settingsRoutes);
  app.use('/api/logs',     requireAuth, logsRoutes);
  app.use('/api/topology', requireAuth, topologyRoutes);

  // Static SPA
  if (fs.existsSync(config.publicDir)) {
    app.use(express.static(config.publicDir, { maxAge: '1h', index: false }));
    app.get(/^\/(?!api).*/, (_req, res) => {
      res.sendFile(path.join(config.publicDir, 'index.html'));
    });
  } else {
    app.get('/', (_req, res) => res.json({ ok: true, note: 'API only — web build not present' }));
  }

  // Error handler
  app.use((err: any, _req: any, res: any, _next: any) => {
    log.error({ err }, 'unhandled');
    res.status(500).json({ error: 'internal error' });
  });

  // Primary listener on the configured (LAN) interface.
  const servers: http.Server[] = [];
  await new Promise<void>((resolve, reject) => {
    const s = app.listen(config.port, config.bindHost, () => {
      log.info({ url: `http://${config.bindHost}:${config.port}` }, 'listening (primary)');
      resolve();
    });
    s.on('error', reject);
    servers.push(s);
  });

  // Secondary loopback listener for local console access — only if primary isn't already loopback.
  if (config.bindHost !== '127.0.0.1' && config.bindHost !== '::1') {
    try {
      await new Promise<void>((resolve, reject) => {
        const s = app.listen(config.port, '127.0.0.1', () => {
          log.info({ url: `http://127.0.0.1:${config.port}` }, 'listening (loopback)');
          resolve();
        });
        s.on('error', reject);
        servers.push(s);
      });
    } catch (err) {
      log.warn({ err }, 'loopback bind failed (port likely in use) — continuing');
    }
  }

  const shutdown = (sig: string) => {
    log.info({ sig }, 'shutdown');
    for (const s of servers) s.close();
    setTimeout(() => process.exit(0), 1500);
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch(err => {
  log.fatal({ err: err?.message ?? err }, 'startup failed');
  process.exit(1);
});
