import { describe, it, expect } from 'vitest';
import { clamp, makeWave, shift } from '../../web/src/components/primitives';

describe('web utilities', () => {
  it('clamp keeps values within the range', () => {
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(-1, 0, 10)).toBe(0);
    expect(clamp(11, 0, 10)).toBe(10);
    expect(clamp(0, 0, 10)).toBe(0);
    expect(clamp(10, 0, 10)).toBe(10);
  });

  it('makeWave returns n samples centered roughly on `center`', () => {
    const w = makeWave(48, 100, 5);
    expect(w).toHaveLength(48);
    const mean = w.reduce((a, b) => a + b, 0) / w.length;
    expect(Math.abs(mean - 100)).toBeLessThan(5);
    for (const v of w) {
      expect(v).toBeGreaterThan(85);
      expect(v).toBeLessThan(115);
    }
  });

  it('shift drops the head and appends the new value', () => {
    expect(shift([1, 2, 3], 4)).toEqual([2, 3, 4]);
    expect(shift([], 9)).toEqual([9]);
  });
});
