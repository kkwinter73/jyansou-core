// 和了形判定と待ち列挙（Phase 1 の中核）。設計: core-domain-design.md §6。
// 入力は枚数ベクトル Counts。役・点数は別レイヤー（yaku-scoring-design.md, Phase 2-3）。
import type { Counts, TileKind } from './types.js';
import { NUM_KINDS } from './types.js';
import { YAOCHU_KINDS } from './tiles.js';

/** counts(コピー)を melds 個の面子に分解できるか（雀頭は外した後の残り）。 */
function canFormMelds(counts: Counts, melds: number): boolean {
  let i = 0;
  while (i < NUM_KINDS && counts[i] === 0) i++;
  if (i === NUM_KINDS) return melds === 0;
  if (melds === 0) return false;

  // 刻子
  if (counts[i] >= 3) {
    counts[i] -= 3;
    if (canFormMelds(counts, melds - 1)) {
      counts[i] += 3;
      return true;
    }
    counts[i] += 3;
  }
  // 順子（数牌で、i が 7 以下＝1..7 始まりのみ）
  if (i < 27 && i % 9 <= 6 && counts[i + 1] > 0 && counts[i + 2] > 0) {
    counts[i]--;
    counts[i + 1]--;
    counts[i + 2]--;
    const ok = canFormMelds(counts, melds - 1);
    counts[i]++;
    counts[i + 1]++;
    counts[i + 2]++;
    if (ok) return true;
  }
  return false;
}

/** 標準形（雀頭1 + melds 面子）か。 */
export function isStandardWin(counts: Counts, melds = 4): boolean {
  for (let k = 0; k < NUM_KINDS; k++) {
    if (counts[k] >= 2) {
      const work = counts.slice();
      work[k] -= 2;
      if (canFormMelds(work, melds)) return true;
    }
  }
  return false;
}

/** 七対子（7種それぞれちょうど2枚。鳴きなしのみ）。 */
export function isChiitoitsu(counts: Counts): boolean {
  let pairs = 0;
  for (const c of counts) {
    if (c === 2) pairs++;
    else if (c !== 0) return false;
  }
  return pairs === 7;
}

/** 国士無双（么九13種すべて1枚以上 + いずれか1種が2枚）。 */
export function isKokushi(counts: Counts): boolean {
  for (let k = 0; k < NUM_KINDS; k++) {
    if (!YAOCHU_KINDS.includes(k) && counts[k] > 0) return false;
  }
  let hasPair = false;
  for (const k of YAOCHU_KINDS) {
    if (counts[k] === 0) return false;
    if (counts[k] === 2) hasPair = true;
    else if (counts[k] > 2) return false;
  }
  return hasPair;
}

/**
 * 和了形か。calledMelds は副露済み面子数（その分、必要な手の内面子が減る）。
 * 七対子・国士は門前（calledMelds===0）のみ。
 */
export function isWinningHand(counts: Counts, calledMelds = 0): boolean {
  const melds = 4 - calledMelds;
  if (melds < 0) return false;
  if (isStandardWin(counts, melds)) return true;
  if (calledMelds === 0 && (isChiitoitsu(counts) || isKokushi(counts))) return true;
  return false;
}

/** 待ち牌の列挙: 13枚相当の counts に1枚足して和了形になる種。フリテンはここでは考慮しない。 */
export function waits(counts: Counts, calledMelds = 0): TileKind[] {
  const result: TileKind[] = [];
  for (let k = 0; k < NUM_KINDS; k++) {
    if (counts[k] >= 4) continue;
    counts[k]++;
    if (isWinningHand(counts, calledMelds)) result.push(k);
    counts[k]--;
  }
  return result;
}

/** 聴牌か。 */
export function isTenpai(counts: Counts, calledMelds = 0): boolean {
  return waits(counts, calledMelds).length > 0;
}
