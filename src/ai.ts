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
import { shanten } from './shanten.js';
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

/** 見えている牌の枚数（自分の手牌+全副露+全河+ドラ表示）。壁/字牌残数の判定に使う。 */
function visibleCounts(state: GameState, seat: Seat): number[] {
  const v = new Array(34).fill(0);
  const add = (ts: readonly { kind: TileKind }[]) => {
    for (const t of ts) v[t.kind]++;
  };
  add(state.hands[seat].concealed);
  for (const s of [0, 1, 2, 3] as Seat[]) for (const m of state.hands[s].melds) add(m.tiles);
  for (const d of state.discards) add(d);
  add(state.doraIndicators);
  return v;
}

/** kind をある1人のリーチ者(河=threatRiver)に切る危険度。0=現物、大きいほど危険。 */
function dangerVsThreat(kind: TileKind, threatRiver: Set<TileKind>, vis: number[]): number {
  if (threatRiver.has(kind)) return 0; // 現物
  if (kind >= 27) {
    const unseen = 4 - vis[kind]; // 字牌は残り枚数が少ないほど安全（単騎/シャンポンのみ）
    return unseen <= 1 ? 1 : unseen === 2 ? 3 : 6;
  }
  const suit = Math.floor(kind / 9) * 9;
  const n = (kind % 9) + 1; // 1..9
  let d = n === 1 || n === 9 ? 5 : n === 2 || n === 8 ? 7 : 9; // 中張ほど危険
  const gen = (num: number) => num >= 1 && num <= 9 && threatRiver.has(suit + num - 1);
  const lowSuji = n >= 4 && gen(n - 3); // 下側の両面を否定
  const highSuji = n <= 6 && gen(n + 3); // 上側の両面を否定
  if (n >= 4 && n <= 6) d -= lowSuji && highSuji ? 5 : lowSuji || highSuji ? 2 : 0;
  else d -= lowSuji || highSuji ? 3 : 0; // 1-3/7-9 は片筋で大きく安全
  const wall = (num: number) => num >= 1 && num <= 9 && vis[suit + num - 1] >= 4; // ノーチャンス
  if (n >= 2 && wall(n - 1)) d -= 2;
  if (n <= 8 && wall(n + 1)) d -= 2;
  return Math.max(1, d);
}

/**
 * ベタオリ: リーチ者への危険度（現物/筋/壁/字牌残数）が最小の牌を切る。
 * 複数リーチには最悪ケース（max）を最小化。同点なら孤立牌を選ぶ。
 */
function safestDiscard(state: GameState, seat: Seat, hand: PlayerState, discards: Action[], threats: Seat[]): Action {
  const counts = tilesToCounts(hand.concealed);
  const vis = visibleCounts(state, seat);
  const rivers = threats.map((o) => new Set(state.discards[o].map((t) => t.kind)));
  let best: Action | null = null;
  let bestDanger = Infinity;
  let bestUse = Infinity;
  const seen = new Set<TileKind>();
  for (const a of discards) {
    if (a.type !== 'discard' || a.riichi || seen.has(a.tile.kind)) continue;
    seen.add(a.tile.kind);
    const danger = Math.max(...rivers.map((r) => dangerVsThreat(a.tile.kind, r, vis)));
    const use = usefulness(counts, a.tile.kind);
    if (danger < bestDanger || (danger === bestDanger && use < bestUse)) {
      best = a;
      bestDanger = danger;
      bestUse = use;
    }
  }
  return best ?? discards[0];
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
  const melds = hand.melds.length;
  const discards = acts.filter((a) => a.type === 'discard');

  // 各打牌候補（種ごと）について、切った後の向聴数を求める
  const seen = new Set<TileKind>();
  const byTile: { act: Action; kind: TileKind; sh: number }[] = [];
  for (const a of discards) {
    if (a.type !== 'discard' || a.riichi || seen.has(a.tile.kind)) continue;
    seen.add(a.tile.kind);
    const rest = tilesToCounts(hand.concealed);
    rest[a.tile.kind]--;
    byTile.push({ act: a, kind: a.tile.kind, sh: shanten(rest, melds) });
  }
  if (byTile.length === 0) return discards[0]; // 念のため

  const minSh = Math.min(...byTile.map((b) => b.sh));
  const bestActs = byTile.filter((b) => b.sh === minSh).map((b) => b.act);

  // 押し引き: 他家リーチがあり自分が非聴牌なら降りる（現物優先）
  const threats = ([0, 1, 2, 3] as Seat[]).filter((o) => o !== seat && state.riichi[o]);
  if (threats.length > 0 && minSh >= 1 && !state.riichi[seat]) {
    return safestDiscard(state, seat, hand, discards, threats);
  }

  if (minSh === 0) {
    // 聴牌: リーチ可能なら宣言（受け入れ最大）、不可なら受け入れ最大で打牌
    const riichiKinds = new Set(bestActs.map((a) => (a.type === 'discard' ? a.tile.kind : -1)));
    const riichiActs = discards.filter(
      (a) => a.type === 'discard' && a.riichi && riichiKinds.has(a.tile.kind),
    );
    if (riichiActs.length > 0) return bestByWaits(hand, riichiActs);
    return bestByWaits(hand, bestActs);
  }
  // 向聴を縮める打牌の中で、最も孤立した牌を切る
  return leastUseful(hand, bestActs);
}
