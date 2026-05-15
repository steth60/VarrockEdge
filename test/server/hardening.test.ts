import { describe, it, expect, beforeAll } from 'vitest';
import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { inArray, eq } from 'drizzle-orm';
import { runMigrations } from '../../server/src/db/migrate';
import { db } from '../../server/src/db/client';
import { users } from '../../server/src/db/schema';
import { hash } from '../../server/src/auth/password';
import { loadUser, requireAuth, requireRoleForMutation } from '../../server/src/auth/middleware';
import { csrfGuard } from '../../server/src/auth/csrf';
import { config } from '../../server/src/config';
import authRoutes from '../../server/src/auth/routes';
import dnsRoutes from '../../server/src/routes/dns';
import userRoutes from '../../server/src/routes/users';

// Mirror the production middleware chain for the routes under test.
const app = express();
app.use(express.json());
app.use(cookieParser(config.sessionSecret));
app.use(loadUser);
app.use(csrfGuard);
app.use('/api/auth', authRoutes);
app.use('/api/dns', requireAuth, requireRoleForMutation('Owner', 'Admin', 'Network'), dnsRoutes);
app.use('/api/users', requireAuth, userRoutes);

const PW = 'Str0ng-Test-Pw!';
const EMAILS = {
  owner: 'hard-owner@t', ro: 'hard-ro@t', admin: 'hard-admin@t',
  ptarget: 'hard-ptarget@t', lock: 'hard-lock@t', sess: 'hard-sess@t',
};

beforeAll(async () => {
  runMigrations();
  const hashed = await hash(PW);
  db.delete(users).where(inArray(users.email, Object.values(EMAILS))).run();
  const mk = (email: string, role: string) => ({
    email, name: email, passwordHash: hashed, role, status: 'active' as const,
    mustChangePassword: false,
  });
  db.insert(users).values([
    mk(EMAILS.owner, 'Owner'), mk(EMAILS.ro, 'Read-only'), mk(EMAILS.admin, 'Admin'),
    mk(EMAILS.ptarget, 'Read-only'), mk(EMAILS.lock, 'Owner'), mk(EMAILS.sess, 'Owner'),
  ]).run();
});

async function login(email: string, password = PW): Promise<string> {
  const r = await request(app).post('/api/auth/login').send({ email, password });
  expect(r.status).toBe(200);
  const sc = r.headers['set-cookie'];
  return (Array.isArray(sc) ? sc[0]! : sc as string).split(';')[0]!;
}

describe('CSRF protection', () => {
  it('rejects a cookie-authenticated mutation with no X-Varrok-CSRF header', async () => {
    const cookie = await login(EMAILS.owner);
    const r = await request(app).post('/api/dns/records').set('Cookie', cookie)
      .send({ host: 'csrf-a.varrok.local', type: 'A', target: '10.0.0.21' });
    expect(r.status).toBe(403);
    expect(String(r.body.error)).toMatch(/csrf/i);
  });

  it('allows the same mutation once the header is present', async () => {
    const cookie = await login(EMAILS.owner);
    const r = await request(app).post('/api/dns/records')
      .set('Cookie', cookie).set('X-Varrok-CSRF', '1')
      .send({ host: 'csrf-b.varrok.local', type: 'A', target: '10.0.0.22' });
    expect(r.status).toBe(200);
  });
});

describe('role matrix', () => {
  it('a Read-only user cannot create a DNS record', async () => {
    const cookie = await login(EMAILS.ro);
    const r = await request(app).post('/api/dns/records')
      .set('Cookie', cookie).set('X-Varrok-CSRF', '1')
      .send({ host: 'ro.varrok.local', type: 'A', target: '10.0.0.23' });
    expect(r.status).toBe(403);
  });

  it('a Read-only user can still read DNS records', async () => {
    const cookie = await login(EMAILS.ro);
    const r = await request(app).get('/api/dns/records').set('Cookie', cookie);
    expect(r.status).toBe(200);
  });
});

describe('config-file injection', () => {
  it('rejects a newline-bearing DNS target with 400', async () => {
    const cookie = await login(EMAILS.owner);
    const r = await request(app).post('/api/dns/records')
      .set('Cookie', cookie).set('X-Varrok-CSRF', '1')
      .send({ host: 'inj.varrok.local', type: 'A', target: '10.0.0.5\ndhcp-script=/tmp/x' });
    expect(r.status).toBe(400);
  });
});

describe('privilege escalation', () => {
  it('an Admin cannot promote a user to Owner', async () => {
    const cookie = await login(EMAILS.admin);
    const target = db.select().from(users).where(eq(users.email, EMAILS.ptarget)).get()!;
    const r = await request(app).patch(`/api/users/${target.id}`)
      .set('Cookie', cookie).set('X-Varrok-CSRF', '1')
      .send({ role: 'Owner' });
    expect(r.status).toBe(403);
  });
});

describe('account lockout', () => {
  it('locks the account after repeated failed logins', async () => {
    for (let i = 0; i < 10; i++) {
      await request(app).post('/api/auth/login').send({ email: EMAILS.lock, password: 'wrong' });
    }
    // Even the correct password is now refused — the account is locked.
    const r = await request(app).post('/api/auth/login').send({ email: EMAILS.lock, password: PW });
    expect(r.status).toBe(429);
  });
});

describe('session invalidation', () => {
  it('a password change kills the user’s other sessions', async () => {
    const cookieA = await login(EMAILS.sess);
    const cookieB = await login(EMAILS.sess);
    const chg = await request(app).patch('/api/auth/me')
      .set('Cookie', cookieB).set('X-Varrok-CSRF', '1')
      .send({ currentPassword: PW, newPassword: 'another-strong-passphrase' });
    expect(chg.status).toBe(200);
    // Session A (not used for the change) is now invalid.
    const meA = await request(app).get('/api/auth/me').set('Cookie', cookieA);
    expect(meA.status).toBe(401);
    // Session B (used for the change) survives.
    const meB = await request(app).get('/api/auth/me').set('Cookie', cookieB);
    expect(meB.status).toBe(200);
  });
});
