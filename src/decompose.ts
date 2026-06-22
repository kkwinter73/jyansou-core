// 和了形の全分解列挙と、和了牌の待ち解釈。Phase 2 役判定の土台。
// 設計: core-domain-design.md §6, yaku-scoring-design.md。
import type { Counts, TileKind } from './types.js';
import { NUM_KINDS } from './types.js';

export type MeldKind = 'shuntsu' | 'kotsu' | 'kantsu';

export interface ParsedMeld {
  kind: MeldKind;
  /** shuntsu は最小牌の kind、その他は構成牌の kind。 */
  tile: TileKind;
  /** 暗（手の内/暗槓）か。明（鳴き/ロン完成の刻子）は false。 */
  concealed: boolean;
  /** 副露由来（チー/ポン/カン）か。手の内で作った面子は false。 */
  fromCall: boolean;
}

export interface Decomposition {
  melds: ParsedMeld[]; // 手の内の面子（雀頭を除く）
  pair: TileKind;
}

/** 手の内 counts を melds 個の面子に分解する全パターンを列挙（雀頭は別で外す）。 */
function enumMelds(counts: Counts, melds: number): ParsedMeld[][] {
  if (melds === 0) {
    return counts.every((c) => c === 0) ? [[]] : [];
  }
  let i = 0;
  while (i < NUM_KINDS && counts[i] === 0) i++;
  if (i === NUM_KINDS) return [];

  const results: ParsedMeld[][] = [];
  // 刻子（最小の未消化牌から。これにより分解は一意順で重複しない）
  if (counts[i] >= 3) {
    counts[i] -= 3;
    for (const rest of enumMelds(counts, melds - 1)) {
      results.push([{ kind: 'kotsu', tile: i, concealed: true, fromCall: false }, ...rest]);
    }
    counts[i] += 3;
  }
  // 順子（数牌で 1..7 始まり）
  if (i < 27 && i % 9 <= 6 && counts[i + 1] > 0 && counts[i + 2] > 0) {
    counts[i]--;
    counts[i + 1]--;
    counts[i + 2]--;
    for (const rest of enumMelds(counts, melds - 1)) {
      results.push([{ kind: 'shuntsu', tile: i, concealed: true, fromCall: false }, ...rest]);
    }
    counts[i]++;
    counts[i + 1]++;
    counts[i + 2]++;
  }
  return results;
}

/** 手の内 counts（和了牌を含む）を 雀頭 + neededMelds 面子 に分解する全パターン。 */
export function decomposeStandard(counts: Counts, neededMelds: number): Decomposition[] {
  const work = counts.slice();
  const out: Decomposition[] = [];
  for (let p = 0; p < NUM_KINDS; p++) {
    if (work[p] >= 2) {
      work[p] -= 2;
      for (const melds of enumMelds(work, neededMelds)) {
        out.push({ melds, pair: p });
      }
      work[p] += 2;
    }
  }
  return out;
}

export type WaitType = 'ryanmen' | 'kanchan' | 'penchan' | 'shanpon' | 'tanki';

export interface Interpretation {
  /** 手の内＋副露をまとめた全4面子。ロンで完成した刻子は concealed:false に補正済み。 */
  melds: ParsedMeld[];
  pair: TileKind;
  waitType: WaitType;
}

/**
 * 1つの手の内分解に対し、和了牌 winTile が「最後の1枚」だった解釈をすべて列挙する。
 * 高点法のため、後段で各解釈の最大翻を採る。
 * @param handMelds 手の内分解の面子（すべて concealed:true, fromCall:false）
 * @param calledMelds 副露面子（固定）
 * @param byRon ロン和了か（ロンで完成した刻子は明刻になる）
 */
export function interpretWaits(
  handMelds: ParsedMeld[],
  pair: TileKind,
  calledMelds: ParsedMeld[],
  winTile: TileKind,
  byRon: boolean,
): Interpretation[] {
  const out: Interpretation[] = [];
  const base = () => [...handMelds.map((m) => ({ ...m })), ...calledMelds.map((m) => ({ ...m }))];

  // 単騎（雀頭待ち）
  if (pair === winTile) {
    out.push({ melds: base(), pair, waitType: 'tanki' });
  }

  for (let idx = 0; idx < handMelds.length; idx++) {
    const m = handMelds[idx];
    if (m.kind === 'shuntsu') {
      const lo = m.tile;
      const inSeq = winTile === lo || winTile === lo + 1 || winTile === lo + 2;
      if (!inSeq) continue;
      const loNum = (lo % 9) + 1; // 1..7
      let waitType: WaitType;
      if (winTile === lo + 1) {
        waitType = 'kanchan';
      } else if (winTile === lo) {
        // 残り(lo+1,lo+2)で lo を待っていた。789 を 7 で和了 = ペンチャン
        waitType = loNum === 7 ? 'penchan' : 'ryanmen';
      } else {
        // winTile === lo+2。残り(lo,lo+1)で lo+2 を待っていた。123 を 3 で和了 = ペンチャン
        waitType = loNum === 1 ? 'penchan' : 'ryanmen';
      }
      out.push({ melds: base(), pair, waitType });
    } else if (m.kind === 'kotsu' && m.tile === winTile) {
      // シャンポン。ロンならこの刻子は明刻になる。
      const melds = base();
      if (byRon) melds[idx] = { ...melds[idx], concealed: false };
      out.push({ melds, pair, waitType: 'shanpon' });
    }
  }
  return out;
}
