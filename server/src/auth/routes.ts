import { Router } from 'express';
import { z } from 'zod';
import { db } from '../db/client';
import { users } from '../db/schema';
import { eq } from 'drizzle-orm';
import { verify } from './password';
import { createSession, destroySession, SESSION_COOKIE, type AuthedRequest } from './middleware';

const router = Router();

const loginSchema = z.object({
  email: z.string().min(1),
  password: z.string().min(1),
});

router.post('/login', async (req, res) => {
  const parse = loginSchema.safeParse(req.body);
  if (!parse.success) return res.status(400).json({ error: 'invalid input' });
  const { email, password } = parse.data;
  const u = db.select().from(users).where(eq(users.email, email)).get();
  if (!u || u.status !== 'active') return res.status(401).json({ error: 'invalid credentials' });
  let ok = false;
  try { ok = await verify(u.passwordHash, password); } catch { ok = false; }
  if (!ok) return res.status(401).json({ error: 'invalid credentials' });
  const ip = req.ip;
  const ua = req.get('user-agent') ?? undefined;
  const sess = await createSession(u.id, ip, ua);
  db.update(users).set({ lastSeenAt: new Date() }).where(eq(users.id, u.id)).run();
  res.cookie(SESSION_COOKIE, sess.id, {
    httpOnly: true,
    sameSite: 'lax',
    secure: req.secure,
    expires: sess.expiresAt,
    path: '/',
  });
  res.json({ user: { id: u.id, email: u.email, name: u.name, role: u.role } });
});

router.post('/logout', (req: AuthedRequest, res) => {
  if (req.sessionId) destroySession(req.sessionId);
  res.clearCookie(SESSION_COOKIE);
  res.json({ ok: true });
});

router.get('/me', (req: AuthedRequest, res) => {
  if (!req.user) return res.status(401).json({ error: 'unauthorized' });
  res.json({ user: req.user });
});

export default router;
