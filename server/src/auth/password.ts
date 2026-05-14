import argon2 from 'argon2';

const OPTS: argon2.Options = {
  type: argon2.argon2id,
  memoryCost: 19456, // 19 MiB
  timeCost: 2,
  parallelism: 1,
};

export function hash(plain: string): Promise<string> {
  return argon2.hash(plain, OPTS);
}

export function verify(hashed: string, plain: string): Promise<boolean> {
  return argon2.verify(hashed, plain);
}
