import { describe, it, expect } from 'vitest';
import { makeRng, nextRng, shuffle } from '../src/rng.js';

describe('seedable PRNG (ADR-0007)', () => {
  it('is deterministic for the same seed', () => {
    const seq = (seed: number) => {
      let r = makeRng(seed);
      const out: number[] = [];
      for (let i = 0; i < 5; i++) {
        const n = nextRng(r);
        r = n.rng;
        out.push(n.value);
      }
      return out;
    };
    expect(seq(42)).toEqual(seq(42));
    expect(seq(42)).not.toEqual(seq(43));
  });

  it('produces values in [0, 1)', () => {
    let r = makeRng(12345);
    for (let i = 0; i < 1000; i++) {
      const n = nextRng(r);
      r = n.rng;
      expect(n.value).toBeGreaterThanOrEqual(0);
      expect(n.value).toBeLessThan(1);
    }
  });

  it('shuffle is a reproducible permutation', () => {
    const xs = Array.from({ length: 136 }, (_, i) => i);
    const a = shuffle(makeRng(7), xs);
    const b = shuffle(makeRng(7), xs);
    expect(a.result).toEqual(b.result); // 再現性
    expect(a.result).not.toEqual(xs); // 実際に混ざる
    expect([...a.result].sort((x, y) => x - y)).toEqual(xs); // 要素は保存（順列）
    expect(xs[0]).toBe(0); // 元配列は不変
  });
});
