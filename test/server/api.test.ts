import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { eq } from 'drizzle-orm';
import { runMigrations } from '../../server/src/db/migrate';
import { db } from '../../server/src/db/client';
import { users, dnsRecords } from '../../server/src/db/schema';
import { hash } from '../../server/src/auth/password';
import { loadUser, requireAuth } from '../../server/src/auth/middleware';
import { config } from '../../server/src/config';
import authRoutes from '../../server/src/auth/routes';
import dnsRoutes from '../../server/src/routes/dns';
import overviewRoutes from '../../server/src/routes/overview';

const app = express();
app.use(express.json());
app.use(cookieParser(config.sessionSecret)); // signed session cookie
app.use(loadUser);
app.use('/api/auth', authRoutes);
app.use('/api/dns', requireAuth, dnsRoutes);
app.use('/api/overview', requireAuth, overviewRoutes);

beforeAll(async () => {
  runMigrations();
  // Scope cleanup to this file's own user — the test DB is shared, so a
  // blanket `delete(users)` would wipe rows other test files depend on.
  db.delete(users).where(eq(users.email, 'test@example.com')).run();
  db.insert(users).values({
    email: 'test@example.com',
    name: 'Tester',
    passwordHash: await hash('s3cret-pw'),
    role: 'Owner',
    status: 'active',
  }).run();
});

afterAll(() => {
  db.delete(dnsRecords).run();
});

async function login(): Promise<string> {
  const r = await request(app)
    .post('/api/auth/login')
    .send({ email: 'test@example.com', password: 's3cret-pw' });
  expect(r.status).toBe(200);
  const setCookie = r.headers['set-cookie'];
  const cookieHeader = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  expect(cookieHeader).toBeTruthy();
  return (cookieHeader as string).split(';')[0]!;
}

describe('API: auth + protected routes', () => {
  it('rejects unauthenticated requests with 401', async () => {
    const r = await request(app).get('/api/dns/records');
    expect(r.status).toBe(401);
  });

  it('rejects bad credentials', async () => {
    const r = await request(app)
      .post('/api/auth/login')
      .send({ email: 'test@example.com', password: 'wrong' });
    expect(r.status).toBe(401);
  });

  it('logs in, returns me, then logs out', async () => {
    const cookie = await login();
    const me = await request(app).get('/api/auth/me').set('Cookie', cookie);
    expect(me.status).toBe(200);
    expect(me.body.user.email).toBe('test@example.com');

    const out = await request(app).post('/api/auth/logout').set('Cookie', cookie);
    expect(out.status).toBe(200);
  });

  it('CRUDs a DNS record once authenticated', async () => {
    const cookie = await login();
    db.delete(dnsRecords).run();

    const create = await request(app)
      .post('/api/dns/records')
      .set('Cookie', cookie)
      .send({ host: 'svc.varrok.local', target: '10.0.0.42', type: 'A', ttl: 300 });
    expect(create.status).toBe(200);
    expect(create.body.record.host).toBe('svc.varrok.local');
    const id = create.body.record.id;

    const list = await request(app).get('/api/dns/records').set('Cookie', cookie);
    expect(list.status).toBe(200);
    expect(list.body.records.map((r: any) => r.host)).toContain('svc.varrok.local');

    const del = await request(app).delete(`/api/dns/records/${id}`).set('Cookie', cookie);
    expect(del.status).toBe(200);

    const after = await request(app).get('/api/dns/records').set('Cookie', cookie);
    expect(after.body.records.find((r: any) => r.id === id)).toBeUndefined();
  });

  it('rejects malformed DNS input with 400', async () => {
    const cookie = await login();
    const r = await request(app)
      .post('/api/dns/records')
      .set('Cookie', cookie)
      .send({ host: '', target: '' });
    expect(r.status).toBe(400);
  });
});
