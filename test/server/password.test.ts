import { describe, it, expect } from 'vitest';
import { hash, verify } from '../../server/src/auth/password';

describe('password', () => {
  it('hashes to a non-plain string', async () => {
    const h = await hash('hunter2');
    expect(h).not.toBe('hunter2');
    expect(h.startsWith('$argon2id$')).toBe(true);
  });

  it('verifies a correct password', async () => {
    const h = await hash('correct horse battery staple');
    await expect(verify(h, 'correct horse battery staple')).resolves.toBe(true);
  });

  it('rejects an incorrect password', async () => {
    const h = await hash('one');
    await expect(verify(h, 'two')).resolves.toBe(false);
  });

  it('produces different hashes for the same input (salted)', async () => {
    const a = await hash('same');
    const b = await hash('same');
    expect(a).not.toBe(b);
  });
});
