// seed 可能な決定論PRNG（mulberry32）。ADR-0007。
// core 内で Math.random を使わず、状態を引数で持ち回ることで apply の純粋性を保つ。
import type { RngState } from './state.js';

/** seed から初期 RNG 状態を作る。seed の生成は core の外（web/server）の責務。 */
export function makeRng(seed: number): RngState {
  return { s: seed >>> 0 };
}

/** 次の乱数 [0,1) と進めた状態を返す（純粋）。 */
export function nextRng(rng: RngState): { rng: RngState; value: number } {
  let a = (rng.s + 0x6d2b79f5) | 0;
  let t = Math.imul(a ^ (a >>> 15), 1 | a);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  const value = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  return { rng: { s: a >>> 0 }, value };
}

/** [0, n) の整数。 */
export function nextInt(rng: RngState, n: number): { rng: RngState; value: number } {
  const next = nextRng(rng);
  return { rng: next.rng, value: Math.floor(next.value * n) };
}

/** Fisher–Yates シャッフル（純粋。元配列は変更しない）。 */
export function shuffle<T>(rng: RngState, xs: readonly T[]): { rng: RngState; result: T[] } {
  const result = xs.slice();
  let r = rng;
  for (let i = result.length - 1; i > 0; i--) {
    const step = nextInt(r, i + 1);
    r = step.rng;
    const j = step.value;
    const tmp = result[i];
    result[i] = result[j];
    result[j] = tmp;
  }
  return { rng: r, result };
}
