import type { Request, Response, NextFunction } from 'express';
import crypto from 'node:crypto';
import { db } from '../db/client';
import { sessions, users } from '../db/schema';
import { eq } from 'drizzle-orm';

export const SESSION_COOKIE = 'varrok_sid';
const TTL_MS = 1000 * 60 * 60 * 8; // 8h

export function newSessionId() {
  return crypto.randomBytes(32).toString('base64url');
}

export async function createSession(userId: number, ip?: string, ua?: string) {
  const id = newSessionId();
  const expiresAt = new Date(Date.now() + TTL_MS);
  db.insert(sessions).values({ id, userId, expiresAt, ip, ua }).run();
  return { id, expiresAt };
}

export function destroySession(id: string) {
  db.delete(sessions).where(eq(sessions.id, id)).run();
}

export interface AuthedRequest extends Request {
  user?: { id: number; email: string; name: string; role: string };
  sessionId?: string;
}

export function loadUser(req: AuthedRequest, _res: Response, next: NextFunction) {
  const sid = req.cookies?.[SESSION_COOKIE] as string | undefined;
  if (!sid) return next();
  const row = db
    .select({
      sid: sessions.id,
      uid: sessions.userId,
      expiresAt: sessions.expiresAt,
      email: users.email,
      name: users.name,
      role: users.role,
      status: users.status,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(eq(sessions.id, sid))
    .get();
  if (!row) return next();
  if (row.expiresAt instanceof Date && row.expiresAt.getTime() < Date.now()) {
    destroySession(sid);
    return next();
  }
  if (row.status !== 'active') return next();
  req.user = { id: row.uid, email: row.email, name: row.name, role: row.role };
  req.sessionId = row.sid;
  next();
}

export function requireAuth(req: AuthedRequest, res: Response, next: NextFunction) {
  if (!req.user) return res.status(401).json({ error: 'unauthorized' });
  next();
}

export function requireRole(...roles: string[]) {
  return (req: AuthedRequest, res: Response, next: NextFunction) => {
    if (!req.user) return res.status(401).json({ error: 'unauthorized' });
    if (!roles.includes(req.user.role)) return res.status(403).json({ error: 'forbidden' });
    next();
  };
}

/**
 * Like requireRole, but only gates *mutating* verbs. GET/HEAD/OPTIONS stay
 * open to any authenticated user (read-only views), while POST/PATCH/PUT/
 * DELETE require one of `roles`. Mounted per router to enforce the tiered
 * role matrix without having to annotate every individual handler.
 */
export function requireRoleForMutation(...roles: string[]) {
  return (req: AuthedRequest, res: Response, next: NextFunction) => {
    if (!req.user) return res.status(401).json({ error: 'unauthorized' });
    if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return next();
    if (!roles.includes(req.user.role)) return res.status(403).json({ error: 'forbidden' });
    next();
  };
}
