import { Router } from 'express';
import { z } from 'zod';
import { db } from '../db/client';
import { users, sessions } from '../db/schema';
import { eq } from 'drizzle-orm';
import { hash } from '../auth/password';
import { requireRole, type AuthedRequest } from '../auth/middleware';

const router = Router();

router.get('/', (_req, res) => {
  const rows = db.select({
    id: users.id, email: users.email, name: users.name, role: users.role,
    status: users.status, mfaEnabled: users.mfaEnabled, lastSeenAt: users.lastSeenAt,
    createdAt: users.createdAt,
  }).from(users).all();
  res.json({ users: rows });
});

const inviteSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1).optional(),
  role: z.enum(['Owner', 'Admin', 'Network', 'Read-only']).default('Read-only'),
  password: z.string().min(8),
});

router.post('/', requireRole('Owner', 'Admin'), async (req, res) => {
  const parse = inviteSchema.safeParse(req.body);
  if (!parse.success) return res.status(400).json({ error: 'invalid input', issues: parse.error.issues });
  const passwordHash = await hash(parse.data.password);
  try {
    const row = db.insert(users).values({
      email: parse.data.email,
      name: parse.data.name ?? parse.data.email.split('@')[0],
      passwordHash,
      role: parse.data.role,
      status: 'invited',
    }).returning().get();
    res.json({ user: { id: row.id, email: row.email, name: row.name, role: row.role, status: row.status } });
  } catch (err: any) {
    if (String(err?.message).includes('UNIQUE')) return res.status(409).json({ error: 'email already exists' });
    res.status(500).json({ error: 'insert failed' });
  }
});

const updateSchema = z.object({
  role: z.enum(['Owner', 'Admin', 'Network', 'Read-only']).optional(),
  status: z.enum(['active', 'invited', 'suspended']).optional(),
  password: z.string().min(8).optional(),
  mfaEnabled: z.boolean().optional(),
});

router.patch('/:id', requireRole('Owner', 'Admin'), async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'bad id' });
  const parse = updateSchema.safeParse(req.body);
  if (!parse.success) return res.status(400).json({ error: 'invalid input', issues: parse.error.issues });
  const patch: any = { ...parse.data };
  if (parse.data.password) {
    patch.passwordHash = await hash(parse.data.password);
    delete patch.password;
  }
  db.update(users).set(patch).where(eq(users.id, id)).run();
  res.json({ ok: true });
});

router.delete('/:id', requireRole('Owner'), (req: AuthedRequest, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'bad id' });
  if (req.user?.id === id) return res.status(400).json({ error: 'cannot delete self' });
  db.delete(users).where(eq(users.id, id)).run();
  res.json({ ok: true });
});

router.get('/sessions/active', (_req, res) => {
  const rows = db
    .select({
      id: sessions.id,
      userId: sessions.userId,
      ip: sessions.ip,
      ua: sessions.ua,
      createdAt: sessions.createdAt,
      expiresAt: sessions.expiresAt,
      email: users.email,
      name: users.name,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .all();
  res.json({ sessions: rows });
});

export default router;
