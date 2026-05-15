import express from 'express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import http from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { config } from './config';
import { log } from './logger';
import { runMigrations } from './db/migrate';
import { loadUser, requireAuth, requireRoleForMutation, type AuthedRequest } from './auth/middleware';
import { csrfGuard } from './auth/csrf';
import { db } from './db/client';
import { sessions } from './db/schema';
import { lt } from 'drizzle-orm';
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
import securityRoutes from './routes/security';
import servicesRoutes from './routes/services';
import systemRoutes from './routes/system';
import sysdataRoutes from './routes/sysdata';
import docsRoutes from './routes/docs';
import probesRoutes from './routes/probes';
import flowsRoutes from './routes/flows';
import wanRoutes from './routes/wan';
import networkRoutes from './routes/networks';
import upnpRoutes from './routes/upnp';
import { startDetector } from './system/detector';
import { applyNetworks } from './system/network';
import { ensureServerAsync } from './system/wireguard';
import { startConntrackSampler } from './system/conntrack';
import { startLatencyProbe } from './system/latencyProbe';
import { startAvailabilityProbe } from './system/availabilityProbe';
import { startWanLoop } from './system/wan';

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
  // Reconcile VLAN interfaces, regenerate + restart dnsmasq, and reconcile
  // miniupnpd — so a fresh boot always converges the daemons to the DB.
  await applyNetworks().catch(err => log.warn({ err }, 'network apply skipped'));
  // Purge expired sessions on boot and hourly — loadUser only deletes a
  // session lazily when its exact id is presented again, so abandoned
  // sessions would otherwise accumulate forever.
  const sweepSessions = () => {
    const r = db.delete(sessions).where(lt(sessions.expiresAt, new Date())).run();
    if (r.changes > 0) log.info({ purged: r.changes }, 'expired sessions swept');
  };
  sweepSessions();
  setInterval(sweepSessions, 60 * 60 * 1000).unref();

  startDetector();
  startConntrackSampler();
  startLatencyProbe();
  startAvailabilityProbe();
  startWanLoop();

  const app = express();
  app.disable('x-powered-by');
  // Trust the upstream TLS terminator (Caddy/nginx) so req.secure reflects
  // X-Forwarded-Proto — the session cookie then gets its Secure flag in prod.
  app.set('trust proxy', 1);
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        // The SPA uses inline style attributes (style={{...}}) pervasively.
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:'],
        fontSrc: ["'self'"],
        connectSrc: ["'self'"],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
        baseUri: ["'self'"],
      },
    },
    // Plain HTTP behind an optional upstream TLS proxy — the proxy owns HSTS.
    hsts: false,
  }));
  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser(config.sessionSecret));
  app.use(loadUser);
  app.use(csrfGuard);

  // Forced first-login password change — until the user sets a real password
  // every API call (except the auth endpoints themselves) is refused, so the
  // gate cannot be skipped by calling the API directly.
  app.use((req, res, next) => {
    if (!req.path.startsWith('/api/') || req.path.startsWith('/api/auth')) return next();
    if ((req as AuthedRequest).user?.mustChangePassword) {
      return res.status(403).json({ error: 'password change required', code: 'MUST_CHANGE_PASSWORD' });
    }
    next();
  });

  // Public routes
  app.use('/api/auth', authRoutes);

  // Protected routes. Tiered role matrix — GET stays open to any authenticated
  // user (read-only dashboards); mutating verbs require the tier below.
  //   networkWrite : Owner/Admin/Network — day-to-day network configuration.
  //   adminWrite   : Owner/Admin         — security, services, system, settings.
  // `users` and `upnp` enforce their own finer-grained per-verb gates.
  const networkWrite = requireRoleForMutation('Owner', 'Admin', 'Network');
  const adminWrite = requireRoleForMutation('Owner', 'Admin');

  app.use('/api/overview', requireAuth, adminWrite,   overviewRoutes);
  app.use('/api/metrics',  requireAuth, adminWrite,   metricsRoutes);
  app.use('/api/dhcp',     requireAuth, networkWrite, dhcpRoutes);
  app.use('/api/dns',      requireAuth, networkWrite, dnsRoutes);
  app.use('/api/wireguard',requireAuth, networkWrite, wgRoutes);
  app.use('/api/firewall', requireAuth, networkWrite, fwRoutes);
  app.use('/api/users',    requireAuth, userRoutes);
  app.use('/api/settings', requireAuth, adminWrite,   settingsRoutes);
  app.use('/api/logs',     requireAuth, adminWrite,   logsRoutes);
  app.use('/api/topology', requireAuth, adminWrite,   topologyRoutes);
  app.use('/api/security', requireAuth, adminWrite,   securityRoutes);
  app.use('/api/services', requireAuth, adminWrite,   servicesRoutes);
  app.use('/api/system',   requireAuth, adminWrite,   systemRoutes);
  app.use('/api/sysdata',  requireAuth, adminWrite,   sysdataRoutes);
  app.use('/api/probes',   requireAuth, adminWrite,   probesRoutes);
  app.use('/api/flows',    requireAuth, adminWrite,   flowsRoutes);
  app.use('/api/wan',      requireAuth, adminWrite,   wanRoutes);
  app.use('/api/networks', requireAuth, networkWrite, networkRoutes);
  app.use('/api/upnp',     requireAuth, upnpRoutes);

  // In-app docs viewer — must be mounted BEFORE the SPA catch-all.
  app.use('/docs', requireAuth, docsRoutes);

  // Static SPA. Vite emits content-hashed asset filenames (index-<sha>.js,
  // ...css) which are safe to cache forever. But index.html itself must not
  // cache, or browsers serve a stale entry-point and never pick up rebuilds.
  if (fs.existsSync(config.publicDir)) {
    app.use(express.static(config.publicDir, {
      index: false,
      setHeaders: (res, filepath) => {
        if (filepath.endsWith('.html')) {
          res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        } else {
          res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        }
      },
    }));
    app.get(/^\/(?!api).*/, (_req, res) => {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
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
