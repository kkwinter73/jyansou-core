// 局進行（Phase 4a: 鳴きなしの完全ループ）。設計: game-flow-design.md, ADR-0006/0007。
// 状態は不変。遷移は apply(state, action) -> { state, events } の純粋関数。
// 鳴き（チー/ポン/カン）は Phase 4b。ここでは draw/discard(+riichi)/tsumo/ron/pass を扱う。
import type { Tile, Seat, Wind, TileKind } from './types.js';
import type { RngState } from './state.js';
import { DEFAULT_RULE, type RuleConfig } from './rule.js';
import { makeRng, shuffle } from './rng.js';
import { tilesToCounts } from './tiles.js';
import { isWinningHand, isTenpai, waits } from './win.js';
import { evaluateWin, type WinInput, type WinResult } from './yaku.js';

export interface Meld {
  /** Phase 4b で使用。4a では常に空。 */
  type: 'chi' | 'pon' | 'minkan' | 'kakan' | 'ankan';
  tiles: Tile[];
  from: Seat | null;
}

export interface PlayerState {
  concealed: Tile[];
  melds: Meld[];
}

export type Phase = 'draw' | 'discard' | 'afterDiscard' | 'over';

export type GameResult =
  | { type: 'tsumo'; winner: Seat; hand: WinResult; scoreDelta: number[] }
  | { type: 'ron'; winner: Seat; from: Seat; hand: WinResult; scoreDelta: number[] }
  | { type: 'ryuukyoku'; tenpai: Seat[]; scoreDelta: number[] };

export interface GameState {
  rule: RuleConfig;
  rng: RngState;
  wind: Wind; // 場風（東/南）
  dealer: Seat; // 親の席
  honba: number;
  riichiSticks: number; // 供託リーチ棒の本数
  wall: Tile[]; // 全136牌（シャッフル済み）
  liveEnd: number; // 生牌の終端（exclusive）。これ以降は王牌
  drawIndex: number; // 次にツモる生牌の位置
  doraIndicators: Tile[];
  uraIndicators: Tile[];
  hands: PlayerState[]; // 席0..3
  discards: Tile[][];
  riichi: boolean[];
  ippatsu: boolean[];
  tempFuriten: boolean[]; // 同巡内フリテン（次の自分のツモで解除）
  riichiFuriten: boolean[]; // リーチ後の見逃し（恒久フリテン）
  scores: number[];
  turn: Seat;
  phase: Phase;
  drawnTile: Tile | null; // 現在の手番のツモ牌
  lastDiscard: { seat: Seat; tile: Tile } | null;
  pendingRon: Seat[]; // 直前の打牌にロン可能な席
  result: GameResult | null;
}

export type Action =
  | { type: 'draw' }
  | { type: 'discard'; tile: Tile; riichi?: boolean }
  | { type: 'tsumo' }
  | { type: 'ron'; seat: Seat }
  | { type: 'pass'; seat: Seat };

export type GameEvent =
  | { type: 'illegal'; reason: string }
  | { type: 'draw'; seat: Seat; tile: Tile }
  | { type: 'discard'; seat: Seat; tile: Tile; riichi: boolean }
  | { type: 'ronWindow'; seats: Seat[] }
  | { type: 'result'; result: GameResult };

const SEATS: Seat[] = [0, 1, 2, 3];
const WINDS: Wind[] = ['E', 'S', 'W', 'N'];
const nextSeat = (s: Seat): Seat => (((s + 1) % 4) as Seat);

/** 席の自風（親=東）。 */
export function seatWindOf(state: GameState, seat: Seat): Wind {
  return WINDS[(seat - state.dealer + 4) % 4];
}

function sortTiles(tiles: Tile[]): Tile[] {
  return [...tiles].sort((a, b) => a.kind - b.kind || Number(a.red) - Number(b.red) || a.id - b.id);
}

/** 136牌を生成（赤5は各色1枚まで akaCount に従う）。 */
function buildWall(akaCount: number): Tile[] {
  const redKinds = [4, 13, 22].slice(0, Math.max(0, Math.min(akaCount, 3)));
  const tiles: Tile[] = [];
  let id = 0;
  for (let kind = 0; kind < 34; kind++) {
    for (let c = 0; c < 4; c++) {
      tiles.push({ kind, red: redKinds.includes(kind) && c === 0, id: id++ });
    }
  }
  return tiles;
}

function clone(state: GameState): GameState {
  return structuredClone(state);
}

interface DealParams {
  rule: RuleConfig;
  scores: number[];
  wind: Wind;
  dealer: Seat;
  honba: number;
  riichiSticks: number;
}

function dealHand(rng: RngState, p: DealParams): GameState {
  const sh = shuffle(rng, buildWall(p.rule.akaCount));
  const wall = sh.result;
  const hands: PlayerState[] = SEATS.map((s) => ({
    concealed: sortTiles(wall.slice(s * 13, s * 13 + 13)),
    melds: [],
  }));
  const deadWall = wall.slice(122);
  return {
    rule: p.rule,
    rng: sh.rng,
    wind: p.wind,
    dealer: p.dealer,
    honba: p.honba,
    riichiSticks: p.riichiSticks,
    wall,
    liveEnd: 122,
    drawIndex: 52,
    doraIndicators: [deadWall[4]],
    uraIndicators: [deadWall[5]],
    hands,
    discards: [[], [], [], []],
    riichi: [false, false, false, false],
    ippatsu: [false, false, false, false],
    tempFuriten: [false, false, false, false],
    riichiFuriten: [false, false, false, false],
    scores: [...p.scores],
    turn: p.dealer,
    phase: 'draw',
    drawnTile: null,
    lastDiscard: null,
    pendingRon: [],
    result: null,
  };
}

/** 新規対局（東1局・親=席0・25000持ち）。 */
export function createGame(seed: number, rule: RuleConfig = DEFAULT_RULE): GameState {
  return dealHand(makeRng(seed), {
    rule,
    scores: [25000, 25000, 25000, 25000],
    wind: 'E',
    dealer: 0,
    honba: 0,
    riichiSticks: 0,
  });
}

function winInputFor(state: GameState, seat: Seat, winTile: TileKind, byTsumo: boolean): WinInput {
  const counts = tilesToCounts(state.hands[seat].concealed);
  if (!byTsumo) counts[winTile]++; // ロンは和了牌を加える（ツモは既に手に含む）
  const wallEmpty = state.drawIndex >= state.liveEnd;
  let red = state.hands[seat].concealed.filter((t) => t.red).length;
  if (!byTsumo && state.lastDiscard?.tile.red) red++;
  return {
    concealed: counts,
    winTile,
    byTsumo,
    seatWind: seatWindOf(state, seat),
    roundWind: state.wind,
    riichi: state.riichi[seat],
    ippatsu: state.ippatsu[seat],
    haitei: byTsumo && wallEmpty,
    houtei: !byTsumo && wallEmpty,
    doraIndicators: state.doraIndicators.map((t) => t.kind),
    uraIndicators: state.uraIndicators.map((t) => t.kind),
    redCount: red,
    isDealer: seat === state.dealer,
    honba: state.honba,
    riichiSticks: state.riichiSticks,
    rule: state.rule,
  };
}

function canRon(state: GameState, seat: Seat, winTile: TileKind): boolean {
  const melds = state.hands[seat].melds.length;
  const base = tilesToCounts(state.hands[seat].concealed);
  base[winTile]++;
  if (!isWinningHand(base, melds)) return false;
  if (state.tempFuriten[seat] || state.riichiFuriten[seat]) return false;
  // 河フリテン: 自分の待ちのいずれかが自分の河にある
  const myWaits = waits(tilesToCounts(state.hands[seat].concealed), melds);
  const discarded = new Set(state.discards[seat].map((t) => t.kind));
  if (myWaits.some((k) => discarded.has(k))) return false;
  // 役なしはロン不可
  return evaluateWin(winInputFor(state, seat, winTile, false)) !== null;
}

function canTsumo(state: GameState, seat: Seat): boolean {
  const counts = tilesToCounts(state.hands[seat].concealed);
  if (!isWinningHand(counts, state.hands[seat].melds.length)) return false;
  const drawn = state.drawnTile;
  if (!drawn) return false;
  return evaluateWin(winInputFor(state, seat, drawn.kind, true)) !== null;
}

/** 打牌後に聴牌が保たれるか（リーチ可否判定用）。 */
function tenpaiAfterDiscard(concealed: Tile[], discardId: number, melds: number): boolean {
  const rest = concealed.filter((t) => t.id !== discardId);
  return isTenpai(tilesToCounts(rest), melds);
}

/** その席が今打てる合法手。 */
export function legalActions(state: GameState, seat: Seat): Action[] {
  if (state.phase === 'draw') {
    return seat === state.turn ? [{ type: 'draw' }] : [];
  }
  if (state.phase === 'discard') {
    if (seat !== state.turn) return [];
    const acts: Action[] = [];
    if (canTsumo(state, seat)) acts.push({ type: 'tsumo' });
    const hand = state.hands[seat];
    const menzen = hand.melds.length === 0;
    const canRiichi =
      menzen && !state.riichi[seat] && state.scores[seat] >= 1000 && state.drawIndex < state.liveEnd;
    const seen = new Set<TileKind>();
    for (const t of hand.concealed) {
      if (seen.has(t.kind)) continue;
      seen.add(t.kind);
      acts.push({ type: 'discard', tile: t });
      if (canRiichi && tenpaiAfterDiscard(hand.concealed, t.id, hand.melds.length)) {
        acts.push({ type: 'discard', tile: t, riichi: true });
      }
    }
    return acts;
  }
  if (state.phase === 'afterDiscard') {
    if (!state.pendingRon.includes(seat)) return [];
    return [{ type: 'ron', seat }, { type: 'pass', seat }];
  }
  return [];
}

function illegal(state: GameState, reason: string): { state: GameState; events: GameEvent[] } {
  return { state, events: [{ type: 'illegal', reason }] };
}

/** 流局（荒牌平局）。聴牌料を移動して終局。 */
function ryuukyoku(s: GameState): { state: GameState; events: GameEvent[] } {
  const tenpai = SEATS.filter((seat) => isTenpai(tilesToCounts(s.hands[seat].concealed), s.hands[seat].melds.length));
  const delta = [0, 0, 0, 0];
  const t = tenpai.length;
  if (t !== 0 && t !== 4) {
    const recv = 3000 / t;
    const pay = 3000 / (4 - t);
    for (const seat of SEATS) delta[seat] = tenpai.includes(seat) ? recv : -pay;
  }
  for (const seat of SEATS) s.scores[seat] += delta[seat];
  const result: GameResult = { type: 'ryuukyoku', tenpai, scoreDelta: delta };
  s.result = result;
  s.phase = 'over';
  return { state: s, events: [{ type: 'result', result }] };
}

function applyWinScore(s: GameState, res: WinResult, winner: Seat, byTsumo: boolean, from: Seat | null): number[] {
  const delta = [0, 0, 0, 0];
  const pay = res.score.payments;
  if (byTsumo && pay.type === 'tsumo') {
    for (const seat of SEATS) {
      if (seat === winner) continue;
      delta[seat] = -(seat === s.dealer && pay.fromDealer !== null ? pay.fromDealer : pay.fromEachNonDealer);
    }
  } else if (!byTsumo && pay.type === 'ron' && from !== null) {
    delta[from] = -pay.from;
  }
  delta[winner] = res.score.total; // 他家の支払い合計 + 供託（本場込み）
  for (const seat of SEATS) s.scores[seat] += delta[seat];
  s.riichiSticks = 0;
  return delta;
}

export function apply(state: GameState, action: Action): { state: GameState; events: GameEvent[] } {
  if (state.phase === 'over') return illegal(state, '局は既に終了している');

  // --- draw ---
  if (action.type === 'draw') {
    if (state.phase !== 'draw') return illegal(state, 'ツモできる局面ではない');
    if (state.drawIndex >= state.liveEnd) return ryuukyoku(clone(state)); // 山切れ→流局
    const s = clone(state);
    s.tempFuriten[s.turn] = false; // 同巡フリテン解除
    const tile = s.wall[s.drawIndex++];
    s.hands[s.turn].concealed = sortTiles([...s.hands[s.turn].concealed, tile]);
    s.drawnTile = tile;
    s.phase = 'discard';
    return { state: s, events: [{ type: 'draw', seat: s.turn, tile }] };
  }

  // --- tsumo ---
  if (action.type === 'tsumo') {
    if (state.phase !== 'discard') return illegal(state, 'ツモ和了できる局面ではない');
    if (!canTsumo(state, state.turn)) return illegal(state, 'ツモ和了の条件を満たさない');
    const s = clone(state);
    const res = evaluateWin(winInputFor(s, s.turn, s.drawnTile!.kind, true))!;
    const delta = applyWinScore(s, res, s.turn, true, null);
    const result: GameResult = { type: 'tsumo', winner: s.turn, hand: res, scoreDelta: delta };
    s.result = result;
    s.phase = 'over';
    return { state: s, events: [{ type: 'result', result }] };
  }

  // --- discard ---
  if (action.type === 'discard') {
    if (state.phase !== 'discard') return illegal(state, '打牌できる局面ではない');
    const turn = state.turn;
    const idx = state.hands[turn].concealed.findIndex((t) => t.id === action.tile.id);
    if (idx < 0) return illegal(state, '手牌にない牌は捨てられない');
    const declareRiichi = action.riichi === true;
    if (declareRiichi) {
      const menzen = state.hands[turn].melds.length === 0;
      const ok =
        menzen &&
        !state.riichi[turn] &&
        state.scores[turn] >= 1000 &&
        state.drawIndex < state.liveEnd &&
        tenpaiAfterDiscard(state.hands[turn].concealed, action.tile.id, state.hands[turn].melds.length);
      if (!ok) return illegal(state, 'リーチの条件を満たさない');
    }
    const s = clone(state);
    const [tile] = s.hands[turn].concealed.splice(idx, 1);
    s.discards[turn].push(tile);
    s.drawnTile = null;
    s.lastDiscard = { seat: turn, tile };
    if (declareRiichi) {
      s.riichi[turn] = true;
      s.ippatsu[turn] = true;
      s.scores[turn] -= 1000;
      s.riichiSticks += 1;
    } else {
      s.ippatsu[turn] = false; // 自分の一発の窓を閉じる
    }
    // ロン可能な席を集める
    s.pendingRon = SEATS.filter((seat) => seat !== turn && canRon(s, seat, tile.kind));
    if (s.pendingRon.length > 0) {
      s.phase = 'afterDiscard';
      return {
        state: s,
        events: [
          { type: 'discard', seat: turn, tile, riichi: declareRiichi },
          { type: 'ronWindow', seats: s.pendingRon },
        ],
      };
    }
    s.turn = nextSeat(turn);
    s.phase = 'draw';
    return { state: s, events: [{ type: 'discard', seat: turn, tile, riichi: declareRiichi }] };
  }

  // --- ron ---
  if (action.type === 'ron') {
    if (state.phase !== 'afterDiscard' || !state.pendingRon.includes(action.seat)) {
      return illegal(state, 'ロンできる局面ではない');
    }
    const s = clone(state);
    const winTile = s.lastDiscard!.tile;
    const res = evaluateWin(winInputFor(s, action.seat, winTile.kind, false))!;
    const delta = applyWinScore(s, res, action.seat, false, s.lastDiscard!.seat);
    const result: GameResult = {
      type: 'ron',
      winner: action.seat,
      from: s.lastDiscard!.seat,
      hand: res,
      scoreDelta: delta,
    };
    s.result = result;
    s.phase = 'over';
    return { state: s, events: [{ type: 'result', result }] };
  }

  // --- pass（ロン見逃し）---
  if (action.type === 'pass') {
    if (state.phase !== 'afterDiscard' || !state.pendingRon.includes(action.seat)) {
      return illegal(state, '見逃しできる局面ではない');
    }
    const s = clone(state);
    s.tempFuriten[action.seat] = true;
    if (s.riichi[action.seat]) s.riichiFuriten[action.seat] = true;
    s.pendingRon = s.pendingRon.filter((x) => x !== action.seat);
    if (s.pendingRon.length === 0) {
      s.turn = nextSeat(s.lastDiscard!.seat);
      s.phase = 'draw';
    }
    return { state: s, events: [] };
  }

  return illegal(state, '不明なアクション');
}

export interface RankEntry {
  seat: Seat;
  score: number;
  rank: number;
}

/** 順位（点数降順、同点は起家=席0に近い順）。 */
export function finalRanking(state: GameState): RankEntry[] {
  const sorted = SEATS.map((seat) => ({ seat, score: state.scores[seat] }))
    .sort((a, b) => b.score - a.score || a.seat - b.seat);
  return sorted.map((e, i) => ({ ...e, rank: i + 1 }));
}

export type NextHand =
  | { over: true; ranking: RankEntry[] }
  | { over: false; state: GameState };

/** 局終了後、次局を配る（連荘/親送り/本場/場風を確定）。終局なら順位を返す。 */
export function startNextHand(state: GameState): NextHand {
  if (state.phase !== 'over' || !state.result) {
    throw new Error('startNextHand: 局がまだ終了していない');
  }
  const res = state.result;
  const dealerKeeps =
    res.type === 'ryuukyoku' ? res.tenpai.includes(state.dealer) : res.winner === state.dealer;

  // トビ（誰かが0点未満）→ 終局
  if (state.scores.some((v) => v < 0)) {
    return { over: true, ranking: finalRanking(state) };
  }

  let wind = state.wind;
  let dealer = state.dealer;
  let honba: number;
  if (dealerKeeps) {
    honba = state.honba + 1; // 連荘
  } else {
    honba = res.type === 'ryuukyoku' ? state.honba + 1 : 0; // 流局は親流れでも本場+1、和了は0
    if (dealer === 3) {
      // 親が一周 → 場風が進む（東→南）。南4局終了なら終局。
      if (wind === 'E') {
        wind = 'S';
        dealer = 0;
      } else {
        return { over: true, ranking: finalRanking(state) };
      }
    } else {
      dealer = nextSeat(dealer);
    }
  }

  const next = dealHand(state.rng, {
    rule: state.rule,
    scores: state.scores,
    wind,
    dealer,
    honba,
    riichiSticks: state.riichiSticks, // 供託は持ち越し
  });
  return { over: false, state: next };
}
