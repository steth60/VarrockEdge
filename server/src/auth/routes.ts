import { Router } from 'express';
import { z } from 'zod';
import { db } from '../db/client';
import { users } from '../db/schema';
import { eq } from 'drizzle-orm';
import { verify, hash } from './password';
import { createSession, destroySession, SESSION_COOKIE, type AuthedRequest } from './middleware';
import { recordLogin } from './loginStats';

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
  if (!u || u.status !== 'active') { recordLogin(false); return res.status(401).json({ error: 'invalid credentials' }); }
  let ok = false;
  try { ok = await verify(u.passwordHash, password); } catch { ok = false; }
  if (!ok) { recordLogin(false); return res.status(401).json({ error: 'invalid credentials' }); }
  recordLogin(true);
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

const updateMeSchema = z.object({
  name: z.string().min(1).max(80).optional(),
  email: z.string().email().optional(),
  currentPassword: z.string().optional(),
  newPassword: z.string().min(8).max(200).optional(),
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

  const patch: Partial<{ name: string; email: string; passwordHash: string }> = {};
  if (name !== undefined) patch.name = name;
  if (email !== undefined) patch.email = email;
  if (newPassword !== undefined) patch.passwordHash = await hash(newPassword);
  if (Object.keys(patch).length === 0) return res.status(400).json({ error: 'nothing to update' });

  try {
    db.update(users).set(patch).where(eq(users.id, req.user.id)).run();
  } catch (err: any) {
    if (String(err?.message).includes('UNIQUE')) return res.status(409).json({ error: 'that email is already in use' });
    return res.status(500).json({ error: 'update failed' });
  }
  const u = db.select().from(users).where(eq(users.id, req.user.id)).get()!;
  res.json({ user: { id: u.id, email: u.email, name: u.name, role: u.role } });
});

export default router;
