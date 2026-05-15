import { Router } from 'express';
import { z } from 'zod';
import rateLimit from 'express-rate-limit';
import { db } from '../db/client';
import { users, sessions } from '../db/schema';
import { eq, and, ne } from 'drizzle-orm';
import { verify, hash } from './password';
import { createSession, destroySession, SESSION_COOKIE, type AuthedRequest } from './middleware';
import { recordLogin } from './loginStats';
import { zPassword } from '../validators';

const router = Router();

// Brute-force protection: a per-IP rate limit plus a per-account lockout.
const MAX_FAILED = 10;
const LOCKOUT_MS = 15 * 60_000;
const loginLimiter = rateLimit({
  windowMs: 15 * 60_000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'too many login attempts — try again later' },
});

// A throwaway hash verified when the account is missing/suspended, so login
// timing does not reveal whether an email exists.
const dummyHashReady = hash('varrok-nonexistent-account-placeholder');

const loginSchema = z.object({
  email: z.string().min(1),
  password: z.string().min(1),
});

router.post('/login', loginLimiter, async (req, res) => {
  const parse = loginSchema.safeParse(req.body);
  if (!parse.success) return res.status(400).json({ error: 'invalid input' });
  const { email, password } = parse.data;
  const u = db.select().from(users).where(eq(users.email, email)).get();

  // Per-account lockout.
  if (u?.lockedUntil instanceof Date && u.lockedUntil.getTime() > Date.now()) {
    recordLogin(false);
    return res.status(429).json({ error: 'account temporarily locked — try again later' });
  }

  let ok = false;
  if (u && u.status === 'active') {
    try { ok = await verify(u.passwordHash, password); } catch { ok = false; }
  } else {
    // Run a verify against a dummy hash so a missing/suspended account is not
    // distinguishable by response timing.
    try { await verify(await dummyHashReady, password); } catch { /* ignore */ }
  }

  if (!ok) {
    recordLogin(false);
    if (u) {
      const failed = (u.failedCount ?? 0) + 1;
      const patch: { failedCount: number; lockedUntil?: Date } = { failedCount: failed };
      if (failed >= MAX_FAILED) patch.lockedUntil = new Date(Date.now() + LOCKOUT_MS);
      db.update(users).set(patch).where(eq(users.id, u.id)).run();
    }
    return res.status(401).json({ error: 'invalid credentials' });
  }

  recordLogin(true);
  const ip = req.ip;
  const ua = req.get('user-agent') ?? undefined;
  const sess = await createSession(u!.id, ip, ua);
  db.update(users).set({ lastSeenAt: new Date(), failedCount: 0, lockedUntil: null })
    .where(eq(users.id, u!.id)).run();
  res.cookie(SESSION_COOKIE, sess.id, {
    httpOnly: true,
    sameSite: 'strict',
    secure: req.secure,
    signed: true,
    expires: sess.expiresAt,
    path: '/',
  });
  res.json({ user: { id: u!.id, email: u!.email, name: u!.name, role: u!.role, mustChangePassword: Boolean(u!.mustChangePassword) } });
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

const updateMeSchema = z.object({
  name: z.string().min(1).max(80).optional(),
  email: z.string().email().optional(),
  currentPassword: z.string().optional(),
  newPassword: zPassword.optional(),
});

// Self-service profile update. Changing email or password requires the
// current password; name alone does not.
router.patch('/me', async (req: AuthedRequest, res) => {
  if (!req.user) return res.status(401).json({ error: 'unauthorized' });
  const parse = updateMeSchema.safeParse(req.body);
  if (!parse.success) return res.status(400).json({ error: 'invalid input', issues: parse.error.issues });
  const { name, email, currentPassword, newPassword } = parse.data;

  const row = db.select().from(users).where(eq(users.id, req.user.id)).get();
  if (!row) return res.status(404).json({ error: 'user not found' });

  const sensitive = email !== undefined || newPassword !== undefined;
  if (sensitive) {
    if (!currentPassword) return res.status(400).json({ error: 'current password required' });
    let ok = false;
    try { ok = await verify(row.passwordHash, currentPassword); } catch { ok = false; }
    if (!ok) return res.status(401).json({ error: 'current password is incorrect' });
  }

  const patch: Partial<{ name: string; email: string; passwordHash: string; mustChangePassword: boolean }> = {};
  if (name !== undefined) patch.name = name;
  if (email !== undefined) patch.email = email;
  if (newPassword !== undefined) {
    patch.passwordHash = await hash(newPassword);
    patch.mustChangePassword = false; // a real password has now been set
  }
  if (Object.keys(patch).length === 0) return res.status(400).json({ error: 'nothing to update' });

  try {
    db.update(users).set(patch).where(eq(users.id, req.user.id)).run();
  } catch (err: any) {
    if (String(err?.message).includes('UNIQUE')) return res.status(409).json({ error: 'that email is already in use' });
    return res.status(500).json({ error: 'update failed' });
  }
  // A password change invalidates every other session for this user.
  if (newPassword !== undefined) {
    const keep = req.sessionId;
    db.delete(sessions).where(
      keep ? and(eq(sessions.userId, req.user.id), ne(sessions.id, keep))
           : eq(sessions.userId, req.user.id),
    ).run();
  }
  const u = db.select().from(users).where(eq(users.id, req.user.id)).get()!;
  res.json({ user: { id: u.id, email: u.email, name: u.name, role: u.role, mustChangePassword: Boolean(u.mustChangePassword) } });
});

export default router;
