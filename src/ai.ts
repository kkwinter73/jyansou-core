// 簡易CPU（Phase 4a 用）。chooseAction(state, seat): Action。
// 戦略であってルールではないため core の必須APIとは分離（architecture.md）。
// v1 ヒューリスティック: 和了優先 → 聴牌到達でリーチ/受け入れ最大 → 孤立牌切り。
// 向聴数ベースの本格思考は今後（shanten 実装時）に差し替え可能。
import type { Seat, TileKind, Tile } from './types.js';
import { tilesToCounts, isYaochu } from './tiles.js';
import { waits } from './win.js';
import { legalActions, type GameState, type Action, type PlayerState } from './game.js';

/** 打牌後の手牌の待ち数（広いほど良い）。0 なら聴牌でない。 */
function waitsAfterDiscard(hand: PlayerState, tile: Tile): number {
  const rest = hand.concealed.filter((t) => t.id !== tile.id);
  return waits(tilesToCounts(rest), hand.melds.length).length;
}

/** 牌の有用度（孤立しているほど低い）。最小の牌を切る。 */
function usefulness(counts: number[], kind: TileKind): number {
  let u = counts[kind] * 2; // 対子・刻子は価値が高い
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
    const k = a.tile.kind;
    // 有用度が低いほど捨てる。同点なら么九牌を優先して切る。
    const score = usefulness(counts, k) * 10 - (isYaochu(k) ? 1 : 0);
    if (score < bestScore) {
      bestScore = score;
      best = a;
    }
  }
  return best;
}

/**
 * その席が打つべき手を1つ選ぶ（純粋関数）。合法手が無い席に対して呼んではならない。
 */
export function chooseAction(state: GameState, seat: Seat): Action {
  const acts = legalActions(state, seat);
  if (acts.length === 0) throw new Error(`chooseAction: 席${seat} に合法手がない`);

  if (state.phase === 'draw') return { type: 'draw' };

  // 鳴き局面: 和了（ロン/チャンカン）できるなら取る。鳴き（ポン/チー/カン）はv1では開始しない。
  if (state.phase === 'afterDiscard' || state.phase === 'afterKakan') {
    return acts.find((a) => a.type === 'ron') ?? { type: 'pass', seat };
  }

  // discard 局面
  const tsumo = acts.find((a) => a.type === 'tsumo');
  if (tsumo) return tsumo;

  const hand = state.hands[seat];
  const discards = acts.filter((a) => a.type === 'discard');

  // リーチ宣言できる打牌があれば積極的に宣言（聴牌到達かつ門前・条件成立時のみ legalActions が返す）
  const riichiActs = discards.filter((a) => a.type === 'discard' && a.riichi);
  if (riichiActs.length > 0) return bestByWaits(hand, riichiActs);

  // 聴牌に到達する打牌があればそれを（受け入れ最大）
  const reaching = discards.filter((a) => a.type === 'discard' && waitsAfterDiscard(hand, a.tile) > 0);
  if (reaching.length > 0) return bestByWaits(hand, reaching);

  // それ以外は最も孤立した牌を切る
  return leastUseful(hand, discards);
}
