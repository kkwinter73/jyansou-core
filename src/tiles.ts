// 牌種ヘルパと手牌表記のパース。設計: core-domain-design.md §1-2。
import type { Counts, Suit, TileKind } from './types.js';
import { NUM_KINDS } from './types.js';

/** 0..8=m, 9..17=p, 18..26=s, 27..33=z */
export function suitOf(kind: TileKind): Suit {
  if (kind < 9) return 'm';
  if (kind < 18) return 'p';
  if (kind < 27) return 's';
  return 'z';
}

/** 数牌は 1..9、字牌は 1..7（東南西北白發中）。 */
export function numberOf(kind: TileKind): number {
  if (kind < 27) return (kind % 9) + 1;
  return kind - 27 + 1;
}

export function isHonor(kind: TileKind): boolean {
  return kind >= 27;
}

/** 数牌の1/9。 */
export function isTerminalNumber(kind: TileKind): boolean {
  return kind < 27 && (kind % 9 === 0 || kind % 9 === 8);
}

/** 么九牌（1/9/字牌）。 */
export function isYaochu(kind: TileKind): boolean {
  return isHonor(kind) || isTerminalNumber(kind);
}

/** 么九牌13種の kind。 */
export const YAOCHU_KINDS: readonly TileKind[] = [
  0, 8, 9, 17, 18, 26, 27, 28, 29, 30, 31, 32, 33,
];

const SUIT_BASE: Record<string, number> = { m: 0, p: 9, s: 18, z: 27 };

/** 牌種を表記へ。例: 0->"1m", 31->"5z"(白) */
export function kindToString(kind: TileKind): string {
  return `${numberOf(kind)}${suitOf(kind)}`;
}

/**
 * 手牌表記を枚数ベクトルへ。例: "123m456p11s", "19m19p19s1234567z"。
 * 赤5は "0m/0p/0s" 表記を 5 として数える（kind は通常5と同じ。red は Tile 側の属性）。
 */
export function parseHand(s: string): Counts {
  const counts: Counts = new Array(NUM_KINDS).fill(0);
  let digits: number[] = [];
  for (const ch of s) {
    if (ch >= '0' && ch <= '9') {
      digits.push(Number(ch));
      continue;
    }
    const base = SUIT_BASE[ch];
    if (base === undefined) throw new Error(`parseHand: 不明な記号 "${ch}"`);
    for (let d of digits) {
      if (ch === 'z') {
        if (d < 1 || d > 7) throw new Error(`parseHand: 字牌は1..7 (${d}z)`);
        counts[base + (d - 1)]++;
      } else {
        if (d === 0) d = 5; // 赤5表記
        if (d < 1 || d > 9) throw new Error(`parseHand: 数牌は1..9 (${d}${ch})`);
        counts[base + (d - 1)]++;
      }
    }
    digits = [];
  }
  if (digits.length) throw new Error('parseHand: 末尾にスート記号がない');
  return counts;
}

/** 枚数ベクトルを表記へ（テスト/デバッグ用）。 */
export function countsToString(counts: Counts): string {
  let out = '';
  for (const suit of ['m', 'p', 's', 'z'] as const) {
    const base = SUIT_BASE[suit];
    const span = suit === 'z' ? 7 : 9;
    let group = '';
    for (let i = 0; i < span; i++) {
      group += String(numberOf(base + i)).repeat(counts[base + i]);
    }
    if (group) out += group + suit;
  }
  return out;
}

/** 総枚数。 */
export function totalTiles(counts: Counts): number {
  return counts.reduce((a, b) => a + b, 0);
}

/** 物理牌の配列を枚数ベクトルへ。 */
export function tilesToCounts(tiles: readonly { kind: TileKind }[]): Counts {
  const counts: Counts = new Array(NUM_KINDS).fill(0);
  for (const t of tiles) counts[t.kind]++;
  return counts;
}
