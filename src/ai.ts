// 簡易CPU（Phase 4a/4b 用）。chooseAction(state, seat): Action。
// 戦略であってルールではないため core の必須APIとは分離（architecture.md）。
// v1 ヒューリスティック:
//  - 和了できるなら和了（ツモ/ロン/槍槓）。
//  - 鳴き: 役牌(三元/自風/場風)はポン/カン。タンヤオ志向(全簡牌)で聴牌到達ならポン/チー。それ以外は門前維持。
//  - 打牌: 聴牌到達でリーチ/受け入れ最大 → 孤立牌切り。
//  向聴数ベースの本格思考は今後（shanten 実装時）に差し替え可能。
import type { Seat, TileKind, Tile, Wind } from './types.js';
import { tilesToCounts, isYaochu } from './tiles.js';
import { waits, isTenpai } from './win.js';
import { legalActions, seatWindOf, type GameState, type Action, type PlayerState } from './game.js';

const WIND_KIND: Record<Wind, TileKind> = { E: 27, S: 28, W: 29, N: 30 };

function isYakuhai(state: GameState, seat: Seat, kind: TileKind): boolean {
  if (kind >= 31) return true; // 三元牌
  return kind === WIND_KIND[seatWindOf(state, seat)] || kind === WIND_KIND[state.wind];
}

/** counts(手の内) が melds 個の確定面子のもとで聴牌可能か（1枚切れば聴牌になる形か）。 */
function tenpaiable(counts: number[], melds: number): boolean {
  for (let k = 0; k < 34; k++) {
    if (counts[k] === 0) continue;
    counts[k]--;
    const t = isTenpai(counts, melds);
    counts[k]++;
    if (t) return true;
  }
  return false;
}

/** 手牌（手の内＋既存面子）がすべて簡牌（么九なし）か。タンヤオ志向の判定。 */
function handAllSimples(hand: PlayerState): boolean {
  if (hand.concealed.some((t) => isYaochu(t.kind))) return false;
  return hand.melds.every((m) => m.tiles.every((t) => !isYaochu(t.kind)));
}

function waitsAfterDiscard(hand: PlayerState, tile: Tile): number {
  const rest = hand.concealed.filter((t) => t.id !== tile.id);
  return waits(tilesToCounts(rest), hand.melds.length).length;
}

function usefulness(counts: number[], kind: TileKind): number {
  let u = counts[kind] * 2;
  if (kind < 27) {
    const n = kind % 9;
    if (n >= 1 && counts[kind - 1] > 0) u++;
    if (n >= 2 && counts[kind - 2] > 0) u++;
    if (n <= 7 && counts[kind + 1] > 0) u++;
    if (n <= 6 && counts[kind + 2] > 0) u++;
  }
  return u;
}

function bestByWaits(hand: PlayerState, acts: Action[]): Action {
  let best = acts[0];
  let bestW = -1;
  for (const a of acts) {
    if (a.type !== 'discard') continue;
    const w = waitsAfterDiscard(hand, a.tile);
    if (w > bestW) {
      bestW = w;
      best = a;
    }
  }
  return best;
}

function leastUseful(hand: PlayerState, acts: Action[]): Action {
  const counts = tilesToCounts(hand.concealed);
  let best = acts[0];
  let bestScore = Infinity;
  for (const a of acts) {
    if (a.type !== 'discard') continue;
    const score = usefulness(counts, a.tile.kind) * 10 - (isYaochu(a.tile.kind) ? 1 : 0);
    if (score < bestScore) {
      bestScore = score;
      best = a;
    }
  }
  return best;
}

/** タンヤオ志向で、聴牌に到達する全簡牌のポン/チーを1つ選ぶ（なければ null）。 */
function tanyaoCall(state: GameState, seat: Seat, acts: Action[]): Action | null {
  const hand = state.hands[seat];
  if (!handAllSimples(hand)) return null;
  const calledKind = state.lastDiscard!.tile.kind;
  if (isYaochu(calledKind)) return null;

  for (const a of acts) {
    if (a.type === 'pon') {
      const counts = tilesToCounts(hand.concealed);
      counts[calledKind] -= 2;
      if (tenpaiable(counts, hand.melds.length + 1)) return a;
    } else if (a.type === 'chi') {
      const kinds = [a.tiles[0].kind, a.tiles[1].kind, calledKind];
      if (kinds.some((k) => isYaochu(k))) continue;
      const counts = tilesToCounts(hand.concealed);
      counts[a.tiles[0].kind]--;
      counts[a.tiles[1].kind]--;
      if (tenpaiable(counts, hand.melds.length + 1)) return a;
    }
  }
  return null;
}

/** その席が打つべき手を1つ選ぶ（純粋関数）。合法手が無い席に対して呼んではならない。 */
export function chooseAction(state: GameState, seat: Seat): Action {
  const acts = legalActions(state, seat);
  if (acts.length === 0) throw new Error(`chooseAction: 席${seat} に合法手がない`);

  if (state.phase === 'draw') return { type: 'draw' };

  // 鳴き/和了の応答局面
  if (state.phase === 'afterDiscard' || state.phase === 'afterKakan') {
    const ron = acts.find((a) => a.type === 'ron');
    if (ron) return ron;
    if (state.phase === 'afterKakan') return { type: 'pass', seat };

    const calledKind = state.lastDiscard!.tile.kind;
    // 役牌はポン/カン（確定役・速度）
    if (isYakuhai(state, seat, calledKind)) {
      const kan = acts.find((a) => a.type === 'kan');
      if (kan) return kan;
      const pon = acts.find((a) => a.type === 'pon');
      if (pon) return pon;
    }
    // タンヤオ志向の鳴き
    const call = tanyaoCall(state, seat, acts);
    if (call) return call;
    return { type: 'pass', seat };
  }

  // discard 局面
  const tsumo = acts.find((a) => a.type === 'tsumo');
  if (tsumo) return tsumo;

  // v1 では自分から暗槓/加槓はしない（kan アクションは無視）
  const hand = state.hands[seat];
  const discards = acts.filter((a) => a.type === 'discard');

  const riichiActs = discards.filter((a) => a.type === 'discard' && a.riichi);
  if (riichiActs.length > 0) return bestByWaits(hand, riichiActs);

  const reaching = discards.filter((a) => a.type === 'discard' && waitsAfterDiscard(hand, a.tile) > 0);
  if (reaching.length > 0) return bestByWaits(hand, reaching);

  return leastUseful(hand, discards);
}
