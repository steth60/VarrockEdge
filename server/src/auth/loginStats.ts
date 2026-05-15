// In-memory record of web-UI login attempts over a rolling 1h window.
// Feeds the "Auth (web UI)" service-health bar. Resets on process restart —
// that is acceptable for a live health signal.
interface Attempt { ts: number; ok: boolean }

const WINDOW_MS = 3_600_000;
const attempts: Attempt[] = [];

function prune(): void {
  const cutoff = Date.now() - WINDOW_MS;
  while (attempts.length && attempts[0]!.ts < cutoff) attempts.shift();
}

export function recordLogin(ok: boolean): void {
  attempts.push({ ts: Date.now(), ok });
  prune();
}

export function loginStats(): { ok: number; fail: number } {
  prune();
  let ok = 0, fail = 0;
  for (const a of attempts) a.ok ? ok++ : fail++;
  return { ok, fail };
}
