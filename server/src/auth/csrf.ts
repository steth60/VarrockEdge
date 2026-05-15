import type { Response, NextFunction } from 'express';
import { SESSION_COOKIE, type AuthedRequest } from './middleware';
import { config } from '../config';

// CSRF protection for a same-origin SPA.
//
// The app authenticates with a cookie, which the browser attaches to *any*
// request to the origin — including ones triggered by a malicious third-party
// page. Two independent checks defeat that:
//
//  1. A custom request header (`X-Varrok-CSRF`). A cross-site <form> or a
//     "simple" cross-origin request cannot set a custom header, and the server
//     grants no CORS preflight, so cross-origin JS cannot either. Only
//     first-party code (our SPA) can send it.
//  2. An Origin/Referer allowlist. A genuine SPA request carries the app's
//     own origin; a forged one carries the attacker's. This also defeats DNS
//     rebinding — a rebound attacker page keeps its original document origin.
//
// CSRF only threatens *cookie-authenticated* requests, so a request with no
// session cookie is passed through untouched (e.g. the initial login POST,
// or non-browser API clients that authenticate some other way).

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function allowedOrigins(): string[] {
  const hosts = [config.bindHost, '127.0.0.1', 'localhost', '[::1]'];
  const out: string[] = [];
  for (const h of hosts) {
    out.push(`http://${h}`, `https://${h}`, `http://${h}:${config.port}`, `https://${h}:${config.port}`);
  }
  return out;
}

function originOf(referer: string | undefined): string | undefined {
  if (!referer) return undefined;
  try { return new URL(referer).origin; } catch { return undefined; }
}

export function csrfGuard(req: AuthedRequest, res: Response, next: NextFunction) {
  if (SAFE_METHODS.has(req.method)) return next();
  if (!req.cookies?.[SESSION_COOKIE]) return next(); // no cookie → nothing to forge

  if (!req.get('x-varrok-csrf')) {
    return res.status(403).json({ error: 'csrf: missing X-Varrok-CSRF header' });
  }
  const origin = req.get('origin') ?? originOf(req.get('referer'));
  if (origin && !allowedOrigins().includes(origin)) {
    return res.status(403).json({ error: 'csrf: request origin not allowed' });
  }
  next();
}
