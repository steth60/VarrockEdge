import { Router } from 'express';
import { z } from 'zod';
import { db } from '../db/client';
import { users, sessions } from '../db/schema';
import { eq } from 'drizzle-orm';
import { hash } from '../auth/password';
import { requireRole, type AuthedRequest } from '../auth/middleware';

const router = Router();

// Role hierarchy — an actor may only modify users ranked strictly below them
// (Owners excepted, who manage everyone).
const RANK: Record<string, number> = { Owner: 3, Admin: 2, Network: 1, 'Read-only': 0 };

router.get('/', requireRole('Owner', 'Admin'), (_req, res) => {
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

router.patch('/:id', requireRole('Owner', 'Admin'), async (req: AuthedRequest, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'bad id' });
  const parse = updateSchema.safeParse(req.body);
  if (!parse.success) return res.status(400).json({ error: 'invalid input', issues: parse.error.issues });

  const target = db.select().from(users).where(eq(users.id, id)).get();
  if (!target) return res.status(404).json({ error: 'not found' });
  const actor = req.user!;

  // You cannot change your own role or status — prevents self-promotion and
  // self-lockout. Use a different admin account.
  if (actor.id === id && (parse.data.role !== undefined || parse.data.status !== undefined)) {
    return res.status(400).json({ error: 'cannot change your own role or status' });
  }
  // A non-Owner may only modify users ranked strictly below them.
  if (actor.id !== id && actor.role !== 'Owner' && (RANK[target.role] ?? 0) >= (RANK[actor.role] ?? 0)) {
    return res.status(403).json({ error: 'cannot modify a user of equal or higher role' });
  }
  // Only an Owner may grant the Owner role.
  if (parse.data.role === 'Owner' && actor.role !== 'Owner') {
    return res.status(403).json({ error: 'only an Owner can grant the Owner role' });
  }
  // Never demote or suspend the last active Owner.
  const demotesOwner = target.role === 'Owner'
    && ((parse.data.role !== undefined && parse.data.role !== 'Owner') || parse.data.status === 'suspended');
  if (demotesOwner) {
    const activeOwners = db.select().from(users).where(eq(users.role, 'Owner')).all()
      .filter(u => u.status === 'active');
    if (activeOwners.length <= 1) {
      return res.status(409).json({ error: 'cannot demote or suspend the last active Owner' });
    }
  }

  const patch: any = { ...parse.data };
  if (parse.data.password) {
    patch.passwordHash = await hash(parse.data.password);
    delete patch.password;
  }
  db.update(users).set(patch).where(eq(users.id, id)).run();
  // A password or role change invalidates the target's existing sessions.
  if (parse.data.password || parse.data.role || parse.data.status) {
    db.delete(sessions).where(eq(sessions.userId, id)).run();
  }
  res.json({ ok: true });
});

router.delete('/:id', requireRole('Owner'), (req: AuthedRequest, res) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'bad id' });
  if (req.user?.id === id) return res.status(400).json({ error: 'cannot delete self' });
  db.delete(users).where(eq(users.id, id)).run();
  res.json({ ok: true });
});

router.get('/sessions/active', requireRole('Owner', 'Admin'), (_req, res) => {
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
