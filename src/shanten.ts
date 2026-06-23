// 向聴数（シャンテン）計算。設計: core-domain-design.md（CPU思考の土台）。
// shanten(counts, melds): -1=和了, 0=聴牌, n=nシャンテン。
// 標準形・七対子・国士無双の最小を返す（七対子/国士は melds===0 のみ）。
import type { Counts } from './types.js';
import { NUM_KINDS } from './types.js';
import { YAOCHU_KINDS } from './tiles.js';

/** 標準形（4面子1雀頭）のシャンテン。melds=副露済み面子数。 */
function standardShanten(counts: Counts, melds: number): number {
  const need = 4 - melds; // 手の内で作る面子数
  const c = counts.slice();
  let best = 8;

  function dfs(i: number, sets: number, partials: number, hasPair: boolean): void {
    if (sets + partials > need) return; // 雀頭を除くブロックは need 個まで
    while (i < NUM_KINDS && c[i] === 0) i++;
    if (i >= NUM_KINDS) {
      const sh = 2 * need - 2 * sets - partials - (hasPair ? 1 : 0);
      if (sh < best) best = sh;
      return;
    }
    // 刻子
    if (c[i] >= 3) {
      c[i] -= 3;
      dfs(i, sets + 1, partials, hasPair);
      c[i] += 3;
    }
    // 順子
    if (i < 27 && i % 9 <= 6 && c[i + 1] > 0 && c[i + 2] > 0) {
      c[i]--; c[i + 1]--; c[i + 2]--;
      dfs(i, sets + 1, partials, hasPair);
      c[i]++; c[i + 1]++; c[i + 2]++;
    }
    // 雀頭（1つだけ）
    if (!hasPair && c[i] >= 2) {
      c[i] -= 2;
      dfs(i, sets, partials, true);
      c[i] += 2;
    }
    // 対子をターツとして
    if (c[i] >= 2) {
      c[i] -= 2;
      dfs(i, sets, partials + 1, hasPair);
      c[i] += 2;
    }
    // 塔子（両面/嵌張）
    if (i < 27 && i % 9 <= 7 && c[i + 1] > 0) {
      c[i]--; c[i + 1]--;
      dfs(i, sets, partials + 1, hasPair);
      c[i]++; c[i + 1]++;
    }
    if (i < 27 && i % 9 <= 6 && c[i + 2] > 0) {
      c[i]--; c[i + 2]--;
      dfs(i, sets, partials + 1, hasPair);
      c[i]++; c[i + 2]++;
    }
    // この牌を1枚浮かせる
    c[i]--;
    dfs(i, sets, partials, hasPair);
    c[i]++;
  }

  dfs(0, 0, 0, false);
  return best;
}

/** 七対子のシャンテン（門前のみ）。 */
function chiitoitsuShanten(counts: Counts): number {
  let pairs = 0;
  let kinds = 0;
  for (let k = 0; k < NUM_KINDS; k++) {
    if (counts[k] >= 1) kinds++;
    if (counts[k] >= 2) pairs++;
  }
  return 6 - pairs + Math.max(0, 7 - kinds);
}

/** 国士無双のシャンテン（門前のみ）。 */
function kokushiShanten(counts: Counts): number {
  let kinds = 0;
  let hasPair = false;
  for (const k of YAOCHU_KINDS) {
    if (counts[k] >= 1) kinds++;
    if (counts[k] >= 2) hasPair = true;
  }
  return 13 - kinds - (hasPair ? 1 : 0);
}

/** 向聴数。-1=和了, 0=聴牌。melds は副露済み面子数。 */
export function shanten(counts: Counts, melds = 0): number {
  let best = standardShanten(counts, melds);
  if (melds === 0) {
    best = Math.min(best, chiitoitsuShanten(counts), kokushiShanten(counts));
  }
  return best;
}
