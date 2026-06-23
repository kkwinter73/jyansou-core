// 局進行（Phase 4a 鳴きなし + Phase 4b 鳴き）。設計: game-flow-design.md, ADR-0006/0007。
// 状態は不変。遷移は apply(state, action) -> { state, events } の純粋関数。
// 鳴き: チー/ポン/大明槓/暗槓/加槓。優先順位 ロン > ポン/カン > チー。嶺上ツモ・カンドラ・槍槓・喰い替え防止。
// 途中流局: 九種九牌(宣言)・四風連打・四家立直。流し満貫。送り槓(待ち不変の暗槓)。
// 未対応(v1): 四槓散了。
import type { Tile, Seat, Wind, TileKind } from './types.js';
import type { RngState } from './state.js';
import { DEFAULT_RULE, type RuleConfig } from './rule.js';
import { makeRng, shuffle } from './rng.js';
import { tilesToCounts, isYaochu } from './tiles.js';
import { isWinningHand, isTenpai, waits } from './win.js';
import { evaluateWin, type WinInput, type WinResult, type CalledMeld } from './yaku.js';

export interface Meld {
  type: 'chi' | 'pon' | 'minkan' | 'kakan' | 'ankan';
  tiles: Tile[]; // chi/pon=3, kan=4
  from: Seat | null; // 鳴いた相手（ankan は null）
}

export interface PlayerState {
  concealed: Tile[];
  melds: Meld[];
}

export type Phase = 'draw' | 'discard' | 'afterDiscard' | 'afterKakan' | 'over';

export type GameResult =
  | { type: 'tsumo'; winner: Seat; hand: WinResult; scoreDelta: number[] }
  | { type: 'ron'; winner: Seat; from: Seat; hand: WinResult; scoreDelta: number[] }
  | { type: 'ryuukyoku'; tenpai: Seat[]; scoreDelta: number[]; nagashi?: Seat[] }
  | { type: 'abortive'; reason: 'kyuushu' | 'suufon' | 'suucha'; scoreDelta: number[] };

/** 打牌に対して鳴ける席とその選択肢。 */
export interface PendingCall {
  seat: Seat;
  ron: boolean;
  pon: boolean;
  minkan: boolean;
  chi: [Tile, Tile][]; // 手牌から出す2枚の組（複数あり得る）
}

export interface GameState {
  rule: RuleConfig;
  rng: RngState;
  wind: Wind;
  dealer: Seat;
  honba: number;
  riichiSticks: number;
  wall: Tile[];
  liveEnd: number; // 生牌終端（カンごとに減る）
  drawIndex: number;
  doraIndicators: Tile[];
  uraIndicators: Tile[];
  kanCount: number;
  rinshanDrawn: number; // 王牌から引いた嶺上牌の数
  rinshan: boolean; // 直前のツモが嶺上か（嶺上開花用）
  hands: PlayerState[];
  discards: Tile[][];
  riichi: boolean[];
  ippatsu: boolean[];
  tempFuriten: boolean[];
  riichiFuriten: boolean[];
  discardCalledFrom: boolean[]; // この席の打牌が鳴かれたか（流し満貫の判定）
  scores: number[];
  turn: Seat;
  phase: Phase;
  drawnTile: Tile | null;
  lastDiscard: { seat: Seat; tile: Tile } | null;
  pendingCalls: PendingCall[]; // afterDiscard の鳴き候補
  callResponses: Record<number, Action>; // 席 -> 応答
  chankanTile: Tile | null; // 加槓のチャンカン待ち牌
  kuikae: TileKind[]; // 現手番が喰い替えで打てない種（鳴き直後の1打のみ）
  result: GameResult | null;
}

export type Action =
  | { type: 'draw' }
  | { type: 'discard'; tile: Tile; riichi?: boolean }
  | { type: 'tsumo' }
  | { type: 'ron'; seat: Seat }
  | { type: 'pon'; seat: Seat }
  | { type: 'chi'; seat: Seat; tiles: [Tile, Tile] }
  | { type: 'kan'; seat: Seat; kind: 'minkan' | 'ankan' | 'kakan'; tile: TileKind }
  | { type: 'kyuushu'; seat: Seat } // 九種九牌で途中流局を宣言
  | { type: 'pass'; seat: Seat };

export type GameEvent =
  | { type: 'illegal'; reason: string }
  | { type: 'draw'; seat: Seat; tile: Tile; rinshan: boolean }
  | { type: 'discard'; seat: Seat; tile: Tile; riichi: boolean }
  | { type: 'call'; seat: Seat; meld: Meld }
  | { type: 'callWindow'; seats: Seat[] }
  | { type: 'chankanWindow'; seats: Seat[] }
  | { type: 'result'; result: GameResult };

const SEATS: Seat[] = [0, 1, 2, 3];
const WINDS: Wind[] = ['E', 'S', 'W', 'N'];
const nextSeat = (s: Seat): Seat => (((s + 1) % 4) as Seat);
const distFrom = (from: Seat, s: Seat) => (s - from + 4) % 4;

export function seatWindOf(state: GameState, seat: Seat): Wind {
  return WINDS[(seat - state.dealer + 4) % 4];
}

function isMenzen(hand: PlayerState): boolean {
  return hand.melds.every((m) => m.type === 'ankan');
}

function sortTiles(tiles: Tile[]): Tile[] {
  return [...tiles].sort((a, b) => a.kind - b.kind || Number(a.red) - Number(b.red) || a.id - b.id);
}

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
    kanCount: 0,
    rinshanDrawn: 0,
    rinshan: false,
    hands,
    discards: [[], [], [], []],
    riichi: [false, false, false, false],
    ippatsu: [false, false, false, false],
    tempFuriten: [false, false, false, false],
    riichiFuriten: [false, false, false, false],
    discardCalledFrom: [false, false, false, false],
    scores: [...p.scores],
    turn: p.dealer,
    phase: 'draw',
    drawnTile: null,
    lastDiscard: null,
    pendingCalls: [],
    callResponses: {},
    chankanTile: null,
    kuikae: [],
    result: null,
  };
}

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

function meldToCalled(m: Meld): CalledMeld {
  if (m.type === 'chi') {
    const lo = Math.min(...m.tiles.map((t) => t.kind));
    return { type: 'chi', tile: lo };
  }
  return { type: m.type, tile: m.tiles[0].kind };
}

function winInputFor(
  state: GameState,
  seat: Seat,
  winTile: TileKind,
  winRedTile: boolean,
  byTsumo: boolean,
  chankan: boolean,
): WinInput {
  const counts = tilesToCounts(state.hands[seat].concealed);
  if (!byTsumo) counts[winTile]++;
  const wallEmpty = state.drawIndex >= state.liveEnd;
  let red = state.hands[seat].concealed.filter((t) => t.red).length;
  for (const m of state.hands[seat].melds) red += m.tiles.filter((t) => t.red).length;
  if (!byTsumo && winRedTile) red++;
  return {
    concealed: counts,
    called: state.hands[seat].melds.map(meldToCalled),
    winTile,
    byTsumo,
    seatWind: seatWindOf(state, seat),
    roundWind: state.wind,
    riichi: state.riichi[seat],
    ippatsu: state.ippatsu[seat],
    rinshan: byTsumo && state.rinshan,
    chankan,
    haitei: byTsumo && wallEmpty,
    houtei: !byTsumo && !chankan && wallEmpty,
    doraIndicators: state.doraIndicators.map((t) => t.kind),
    uraIndicators: state.uraIndicators.map((t) => t.kind),
    redCount: red,
    isDealer: seat === state.dealer,
    honba: state.honba,
    riichiSticks: state.riichiSticks,
    rule: state.rule,
  };
}

function canRon(state: GameState, seat: Seat, winTile: TileKind, winRed: boolean, chankan: boolean): boolean {
  const melds = state.hands[seat].melds.length;
  const base = tilesToCounts(state.hands[seat].concealed);
  base[winTile]++;
  if (!isWinningHand(base, melds)) return false;
  if (state.tempFuriten[seat] || state.riichiFuriten[seat]) return false;
  const myWaits = waits(tilesToCounts(state.hands[seat].concealed), melds);
  const discarded = new Set(state.discards[seat].map((t) => t.kind));
  if (myWaits.some((k) => discarded.has(k))) return false;
  return evaluateWin(winInputFor(state, seat, winTile, winRed, false, chankan)) !== null;
}

function canTsumo(state: GameState, seat: Seat): boolean {
  const counts = tilesToCounts(state.hands[seat].concealed);
  if (!isWinningHand(counts, state.hands[seat].melds.length)) return false;
  const drawn = state.drawnTile;
  if (!drawn) return false;
  return evaluateWin(winInputFor(state, seat, drawn.kind, drawn.red, true, false)) !== null;
}

function tenpaiAfterDiscard(concealed: Tile[], discardId: number, melds: number): boolean {
  const rest = concealed.filter((t) => t.id !== discardId);
  return isTenpai(tilesToCounts(rest), melds);
}

const findKind = (tiles: Tile[], kind: TileKind) => tiles.find((t) => t.kind === kind);

/** チーで出せる手牌2枚の組を列挙（discard と順子を作る）。 */
function chiPairs(concealed: Tile[], k: TileKind): [Tile, Tile][] {
  if (k >= 27) return [];
  const n = k % 9;
  const out: [Tile, Tile][] = [];
  const tryPair = (a: TileKind, b: TileKind) => {
    const ta = findKind(concealed, a);
    const tb = findKind(concealed, b);
    if (ta && tb) out.push([ta, tb]);
  };
  if (n >= 2) tryPair(k - 2, k - 1);
  if (n >= 1 && n <= 7) tryPair(k - 1, k + 1);
  if (n <= 6) tryPair(k + 1, k + 2);
  return out;
}

/** 喰い替えで打てない種（鳴いた牌＝genbutsu、チーは筋も）。 */
function kuikaeForbidden(meld: Meld, called: Tile): TileKind[] {
  const forbidden = [called.kind];
  if (meld.type === 'chi') {
    const lo = Math.min(...meld.tiles.map((t) => t.kind));
    if (called.kind === lo && lo % 9 <= 5) forbidden.push(lo + 3);
    else if (called.kind === lo + 2 && lo % 9 >= 1) forbidden.push(lo - 1);
  }
  return forbidden;
}

const WIND_KINDS: readonly TileKind[] = [27, 28, 29, 30];
const sameSet = (a: TileKind[], b: TileKind[]) =>
  a.length === b.length && [...a].sort((x, y) => x - y).join(',') === [...b].sort((x, y) => x - y).join(',');

/** 九種九牌の宣言可否（自分の第1ツモ・誰も鳴いていない・么九9種以上）。 */
function canKyuushu(state: GameState, seat: Seat): boolean {
  if (state.phase !== 'discard' || seat !== state.turn || !state.drawnTile) return false;
  if (state.hands.some((h) => h.melds.length > 0)) return false; // 誰かが鳴いていたら不可
  if (state.discards[seat].length > 0) return false; // 第1ツモのみ
  const counts = tilesToCounts(state.hands[seat].concealed);
  let kinds = 0;
  for (let k = 0; k < 34; k++) if (isYaochu(k) && counts[k] > 0) kinds++;
  return kinds >= 9;
}

/** 送り槓: リーチ中の暗槓は「待ちが変わらない」場合のみ許可。 */
function canAnkanInRiichi(state: GameState, seat: Seat, kind: TileKind): boolean {
  const hand = state.hands[seat];
  const drawn = state.drawnTile;
  if (!drawn || drawn.kind !== kind) return false; // ツモ牌での暗槓のみ
  const counts = tilesToCounts(hand.concealed);
  if (counts[kind] !== 4) return false;
  const melds = hand.melds.length;
  const before = tilesToCounts(hand.concealed);
  before[drawn.kind]--; // ツモ牌を除いた＝リーチ時の待ち形
  const wBefore = waits(before, melds);
  const after = tilesToCounts(hand.concealed);
  after[kind] -= 4;
  const wAfter = waits(after, melds + 1);
  return sameSet(wBefore, wAfter);
}

export function legalActions(state: GameState, seat: Seat): Action[] {
  if (state.phase === 'draw') {
    return seat === state.turn ? [{ type: 'draw' }] : [];
  }

  if (state.phase === 'discard') {
    if (seat !== state.turn) return [];
    const acts: Action[] = [];
    const hand = state.hands[seat];
    if (canTsumo(state, seat)) acts.push({ type: 'tsumo' });
    if (canKyuushu(state, seat)) acts.push({ type: 'kyuushu', seat });

    const counts = tilesToCounts(hand.concealed);
    if (!state.riichi[seat]) {
      // 暗槓・加槓
      const seenKan = new Set<TileKind>();
      for (const t of hand.concealed) {
        if (counts[t.kind] === 4 && !seenKan.has(t.kind)) {
          seenKan.add(t.kind);
          acts.push({ type: 'kan', seat, kind: 'ankan', tile: t.kind });
        }
      }
      for (const m of hand.melds) {
        if (m.type === 'pon' && counts[m.tiles[0].kind] >= 1) {
          acts.push({ type: 'kan', seat, kind: 'kakan', tile: m.tiles[0].kind });
        }
      }
    } else {
      // リーチ中: 送り槓（待ち不変の暗槓）のみ
      const drawn = state.drawnTile;
      if (drawn && counts[drawn.kind] === 4 && canAnkanInRiichi(state, seat, drawn.kind)) {
        acts.push({ type: 'kan', seat, kind: 'ankan', tile: drawn.kind });
      }
    }

    // 打牌
    if (state.riichi[seat]) {
      if (state.drawnTile) acts.push({ type: 'discard', tile: state.drawnTile });
      return acts;
    }
    const menzen = isMenzen(hand);
    const canRiichi = menzen && !state.riichi[seat] && state.scores[seat] >= 1000 && state.drawIndex < state.liveEnd;
    const forbid = new Set(state.kuikae);
    const discardActs: Action[] = [];
    const seen = new Set<TileKind>();
    for (const t of hand.concealed) {
      if (seen.has(t.kind)) continue;
      seen.add(t.kind);
      discardActs.push({ type: 'discard', tile: t });
      if (canRiichi && tenpaiAfterDiscard(hand.concealed, t.id, hand.melds.length)) {
        discardActs.push({ type: 'discard', tile: t, riichi: true });
      }
    }
    // 喰い替え禁止牌を除外（全部禁止になるなら適用しない）
    const filtered = discardActs.filter((a) => a.type === 'discard' && !forbid.has(a.tile.kind));
    acts.push(...(filtered.length > 0 ? filtered : discardActs));
    return acts;
  }

  if (state.phase === 'afterDiscard') {
    const pc = state.pendingCalls.find((p) => p.seat === seat);
    if (!pc || state.callResponses[seat]) return [];
    const acts: Action[] = [];
    if (pc.ron) acts.push({ type: 'ron', seat });
    if (pc.pon) acts.push({ type: 'pon', seat });
    if (pc.minkan) acts.push({ type: 'kan', seat, kind: 'minkan', tile: state.lastDiscard!.tile.kind });
    for (const pair of pc.chi) acts.push({ type: 'chi', seat, tiles: pair });
    acts.push({ type: 'pass', seat });
    return acts;
  }

  if (state.phase === 'afterKakan') {
    const pc = state.pendingCalls.find((p) => p.seat === seat);
    if (!pc || state.callResponses[seat]) return [];
    return [{ type: 'ron', seat }, { type: 'pass', seat }];
  }

  return [];
}

function illegal(state: GameState, reason: string): { state: GameState; events: GameEvent[] } {
  return { state, events: [{ type: 'illegal', reason }] };
}

function ryuukyoku(s: GameState): { state: GameState; events: GameEvent[] } {
  const tenpai = SEATS.filter((seat) => isTenpai(tilesToCounts(s.hands[seat].concealed), s.hands[seat].melds.length));
  // 流し満貫: 自分の捨て牌が全て么九 かつ 一度も鳴かれていない
  const nagashi = SEATS.filter(
    (seat) =>
      !s.discardCalledFrom[seat] &&
      s.discards[seat].length > 0 &&
      s.discards[seat].every((t) => isYaochu(t.kind)),
  );
  const delta = [0, 0, 0, 0];
  if (nagashi.length > 0) {
    // 満貫ツモ相当（供託・本場は動かさない）。複数なら各自に支払い。
    for (const w of nagashi) {
      for (const seat of SEATS) {
        if (seat === w) continue;
        const pay = w === s.dealer ? 4000 : seat === s.dealer ? 4000 : 2000;
        delta[seat] -= pay;
        delta[w] += pay;
      }
    }
  } else {
    const t = tenpai.length;
    if (t !== 0 && t !== 4) {
      const recv = 3000 / t;
      const pay = 3000 / (4 - t);
      for (const seat of SEATS) delta[seat] = tenpai.includes(seat) ? recv : -pay;
    }
  }
  for (const seat of SEATS) s.scores[seat] += delta[seat];
  const result: GameResult = { type: 'ryuukyoku', tenpai, scoreDelta: delta };
  if (nagashi.length > 0) result.nagashi = nagashi;
  s.result = result;
  s.phase = 'over';
  return { state: s, events: [{ type: 'result', result }] };
}

/** 途中流局（四風連打・四家立直）の判定。成立すれば result/phase を設定して true。 */
function maybeAbort(s: GameState): boolean {
  const total = s.discards.reduce((n, d) => n + d.length, 0);
  const noMelds = s.hands.every((h) => h.melds.length === 0);
  // 四風連打: 最初の4打がすべて同じ風牌・鳴きなし
  if (total === 4 && noMelds && s.discards.every((d) => d.length === 1)) {
    const first = s.discards[0][0].kind;
    if (WIND_KINDS.includes(first) && SEATS.every((seat) => s.discards[seat][0].kind === first)) {
      s.result = { type: 'abortive', reason: 'suufon', scoreDelta: [0, 0, 0, 0] };
      s.phase = 'over';
      return true;
    }
  }
  // 四家立直: 全員リーチ
  if (s.riichi.every((r) => r)) {
    s.result = { type: 'abortive', reason: 'suucha', scoreDelta: [0, 0, 0, 0] };
    s.phase = 'over';
    return true;
  }
  return false;
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
  delta[winner] = res.score.total;
  for (const seat of SEATS) s.scores[seat] += delta[seat];
  s.riichiSticks = 0;
  return delta;
}

function winResult(s: GameState, winner: Seat, byTsumo: boolean, from: Seat | null, hand: WinResult): GameResult {
  const delta = applyWinScore(s, hand, winner, byTsumo, from);
  return byTsumo
    ? { type: 'tsumo', winner, hand, scoreDelta: delta }
    : { type: 'ron', winner, from: from!, hand, scoreDelta: delta };
}

/** 王牌から嶺上牌を引き、カンドラを1枚めくる（s を破壊的に更新）。 */
function drawRinshan(s: GameState, seat: Seat): Tile {
  const deadWall = s.wall.slice(122);
  const idx = s.doraIndicators.length; // 次に公開する指標(0=初期, 1..=カンドラ)
  s.doraIndicators.push(deadWall[4 + 2 * idx]);
  s.uraIndicators.push(deadWall[5 + 2 * idx]);
  const tile = deadWall[s.rinshanDrawn];
  s.rinshanDrawn += 1;
  s.kanCount += 1;
  s.liveEnd -= 1; // 生牌が1枚王牌へ補充される
  s.hands[seat].concealed = sortTiles([...s.hands[seat].concealed, tile]);
  s.drawnTile = tile;
  s.rinshan = true;
  return tile;
}

/** 打牌に対する鳴き候補を集める。 */
function computePendingCalls(s: GameState, discard: Tile, discarder: Seat): PendingCall[] {
  const out: PendingCall[] = [];
  for (const seat of SEATS) {
    if (seat === discarder) continue;
    const ron = canRon(s, seat, discard.kind, discard.red, false);
    // リーチ者は手牌が固定されるため、ロン以外の鳴き（ポン/チー/カン）はできない
    if (s.riichi[seat]) {
      if (ron) out.push({ seat, ron: true, pon: false, minkan: false, chi: [] });
      continue;
    }
    const c = tilesToCounts(s.hands[seat].concealed)[discard.kind];
    const pon = c >= 2;
    const minkan = c >= 3;
    const chi = seat === nextSeat(discarder) ? chiPairs(s.hands[seat].concealed, discard.kind) : [];
    if (ron || pon || minkan || chi.length > 0) out.push({ seat, ron, pon, minkan, chi });
  }
  return out;
}

/** 鳴き（ポン/チー/大明槓）を実行し、捨て牌を河から面子へ移す。 */
function executeCall(s: GameState, action: Action): void {
  const discard = s.lastDiscard!.tile;
  const from = s.lastDiscard!.seat;
  const seat = (action as { seat: Seat }).seat;
  s.discards[from].pop(); // 河から取り上げる
  s.discardCalledFrom[from] = true; // 流し満貫の権利を失う
  const hand = s.hands[seat];
  let meld: Meld;

  if (action.type === 'pon' || (action.type === 'kan' && action.kind === 'minkan')) {
    const need = action.type === 'pon' ? 2 : 3;
    const taken: Tile[] = [];
    // 赤を温存するため非赤から取る
    for (const t of [...hand.concealed].sort((a, b) => Number(a.red) - Number(b.red))) {
      if (t.kind === discard.kind && taken.length < need) taken.push(t);
    }
    hand.concealed = hand.concealed.filter((t) => !taken.includes(t));
    meld = {
      type: action.type === 'pon' ? 'pon' : 'minkan',
      tiles: sortTiles([...taken, discard]),
      from,
    };
  } else if (action.type === 'chi') {
    const ids = new Set(action.tiles.map((t) => t.id));
    hand.concealed = hand.concealed.filter((t) => !ids.has(t.id));
    meld = { type: 'chi', tiles: sortTiles([...action.tiles, discard]), from };
  } else {
    throw new Error('executeCall: 不正な action');
  }

  hand.melds.push(meld);
  s.ippatsu = [false, false, false, false]; // 鳴きで全員の一発消滅
  s.turn = seat;
  s.drawnTile = null;
  s.pendingCalls = [];
  s.callResponses = {};
  s.lastDiscard = null;

  if (meld.type === 'minkan') {
    drawRinshan(s, seat); // 大明槓は嶺上ツモ
    s.kuikae = [];
  } else {
    s.rinshan = false;
    s.kuikae = kuikaeForbidden(meld, discard);
  }
  s.phase = 'discard';
}

/** afterDiscard の応答が出揃ったら優先順位で解決する。 */
function resolveCalls(s: GameState): { state: GameState; events: GameEvent[] } {
  const responders = s.pendingCalls.map((p) => p.seat);
  if (!responders.every((seat) => s.callResponses[seat])) {
    return { state: s, events: [] }; // まだ待つ
  }
  const from = s.lastDiscard!.seat;
  const discard = s.lastDiscard!.tile;

  const rons = responders.filter((seat) => s.callResponses[seat].type === 'ron');
  if (rons.length > 0) {
    const winner = rons.sort((a, b) => distFrom(from, a) - distFrom(from, b))[0];
    const res = evaluateWin(winInputFor(s, winner, discard.kind, discard.red, false, false))!;
    const result = winResult(s, winner, false, from, res);
    s.result = result;
    s.phase = 'over';
    return { state: s, events: [{ type: 'result', result }] };
  }

  const ponkan = responders.find(
    (seat) => s.callResponses[seat].type === 'pon' || s.callResponses[seat].type === 'kan',
  );
  const chi = responders.find((seat) => s.callResponses[seat].type === 'chi');
  const caller = ponkan ?? chi;
  if (caller !== undefined) {
    const meldType = s.callResponses[caller].type;
    executeCall(s, s.callResponses[caller]);
    const meld = s.hands[caller].melds[s.hands[caller].melds.length - 1];
    const events: GameEvent[] = [{ type: 'call', seat: caller as Seat, meld }];
    if (meldType === 'kan') {
      events.push({ type: 'draw', seat: caller as Seat, tile: s.drawnTile!, rinshan: true });
    }
    return { state: s, events };
  }

  // 全員パス: ロン可能だった見逃しはフリテンに
  for (const p of s.pendingCalls) {
    if (p.ron) {
      s.tempFuriten[p.seat] = true;
      if (s.riichi[p.seat]) s.riichiFuriten[p.seat] = true;
    }
  }
  s.pendingCalls = [];
  s.callResponses = {};
  s.lastDiscard = null;
  if (maybeAbort(s)) return { state: s, events: [{ type: 'result', result: s.result! }] };
  s.turn = nextSeat(from);
  s.phase = 'draw';
  return { state: s, events: [] };
}

export function apply(state: GameState, action: Action): { state: GameState; events: GameEvent[] } {
  if (state.phase === 'over') return illegal(state, '局は既に終了している');

  // ===== draw =====
  if (action.type === 'draw') {
    if (state.phase !== 'draw') return illegal(state, 'ツモできる局面ではない');
    if (state.drawIndex >= state.liveEnd) return ryuukyoku(clone(state));
    const s = clone(state);
    s.tempFuriten[s.turn] = false;
    s.rinshan = false;
    const tile = s.wall[s.drawIndex++];
    s.hands[s.turn].concealed = sortTiles([...s.hands[s.turn].concealed, tile]);
    s.drawnTile = tile;
    s.kuikae = [];
    s.phase = 'discard';
    return { state: s, events: [{ type: 'draw', seat: s.turn, tile, rinshan: false }] };
  }

  // ===== tsumo =====
  if (action.type === 'tsumo') {
    if (state.phase !== 'discard') return illegal(state, 'ツモ和了できる局面ではない');
    if (!canTsumo(state, state.turn)) return illegal(state, 'ツモ和了の条件を満たさない');
    const s = clone(state);
    const res = evaluateWin(winInputFor(s, s.turn, s.drawnTile!.kind, s.drawnTile!.red, true, false))!;
    const result = winResult(s, s.turn, true, null, res);
    s.result = result;
    s.phase = 'over';
    return { state: s, events: [{ type: 'result', result }] };
  }

  // ===== 九種九牌（途中流局の宣言）=====
  if (action.type === 'kyuushu') {
    if (action.seat !== state.turn || !canKyuushu(state, action.seat)) {
      return illegal(state, '九種九牌を宣言できない');
    }
    const s = clone(state);
    s.result = { type: 'abortive', reason: 'kyuushu', scoreDelta: [0, 0, 0, 0] };
    s.phase = 'over';
    return { state: s, events: [{ type: 'result', result: s.result }] };
  }

  // ===== 暗槓 / 加槓（自分の手番）=====
  if (action.type === 'kan' && (action.kind === 'ankan' || action.kind === 'kakan')) {
    if (state.phase !== 'discard' || action.seat !== state.turn) return illegal(state, 'カンできる局面ではない');
    const hand = state.hands[state.turn];
    const counts = tilesToCounts(hand.concealed);

    if (action.kind === 'ankan') {
      if (counts[action.tile] !== 4) return illegal(state, '暗槓の条件を満たさない');
      if (state.riichi[state.turn] && !canAnkanInRiichi(state, state.turn, action.tile)) {
        return illegal(state, '送り槓は不可（待ちが変わる）');
      }
      const s = clone(state);
      const taken = s.hands[s.turn].concealed.filter((t) => t.kind === action.tile);
      s.hands[s.turn].concealed = s.hands[s.turn].concealed.filter((t) => t.kind !== action.tile);
      s.hands[s.turn].melds.push({ type: 'ankan', tiles: taken, from: null });
      s.ippatsu = [false, false, false, false];
      s.kuikae = [];
      drawRinshan(s, s.turn);
      return {
        state: s,
        events: [
          { type: 'call', seat: s.turn, meld: s.hands[s.turn].melds[s.hands[s.turn].melds.length - 1] },
          { type: 'draw', seat: s.turn, tile: s.drawnTile!, rinshan: true },
        ],
      };
    }

    // kakan: 既存ポンに4枚目を加える → 槍槓の窓を開く
    const pon = hand.melds.find((m) => m.type === 'pon' && m.tiles[0].kind === action.tile);
    if (!pon || counts[action.tile] < 1) return illegal(state, '加槓の条件を満たさない');
    const s = clone(state);
    const t4 = s.hands[s.turn].concealed.find((t) => t.kind === action.tile)!;
    s.hands[s.turn].concealed = s.hands[s.turn].concealed.filter((t) => t.id !== t4.id);
    const ponMeld = s.hands[s.turn].melds.find((m) => m.type === 'pon' && m.tiles[0].kind === action.tile)!;
    ponMeld.type = 'kakan';
    ponMeld.tiles = sortTiles([...ponMeld.tiles, t4]);
    s.ippatsu = [false, false, false, false];
    // 槍槓: 他家がこの牌でロンできるか
    const pend: PendingCall[] = [];
    for (const seat of SEATS) {
      if (seat === s.turn) continue;
      if (canRon(s, seat, action.tile, t4.red, true)) {
        pend.push({ seat, ron: true, pon: false, minkan: false, chi: [] });
      }
    }
    if (pend.length > 0) {
      s.pendingCalls = pend;
      s.callResponses = {};
      s.chankanTile = t4;
      s.phase = 'afterKakan';
      return { state: s, events: [{ type: 'chankanWindow', seats: pend.map((p) => p.seat) }] };
    }
    drawRinshan(s, s.turn);
    s.kuikae = [];
    return {
      state: s,
      events: [
        { type: 'call', seat: s.turn, meld: ponMeld },
        { type: 'draw', seat: s.turn, tile: s.drawnTile!, rinshan: true },
      ],
    };
  }

  // ===== discard =====
  if (action.type === 'discard') {
    if (state.phase !== 'discard') return illegal(state, '打牌できる局面ではない');
    const turn = state.turn;
    const idx = state.hands[turn].concealed.findIndex((t) => t.id === action.tile.id);
    if (idx < 0) return illegal(state, '手牌にない牌は捨てられない');
    if (state.kuikae.includes(action.tile.kind) && legalActions(state, turn).some((a) => a.type === 'discard' && !state.kuikae.includes(a.tile.kind))) {
      return illegal(state, '喰い替えは禁止');
    }
    const declareRiichi = action.riichi === true;
    if (declareRiichi) {
      const ok =
        isMenzen(state.hands[turn]) &&
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
    s.rinshan = false;
    s.kuikae = [];
    s.lastDiscard = { seat: turn, tile };
    if (declareRiichi) {
      s.riichi[turn] = true;
      s.ippatsu[turn] = true;
      s.scores[turn] -= 1000;
      s.riichiSticks += 1;
    } else {
      s.ippatsu[turn] = false;
    }

    s.pendingCalls = computePendingCalls(s, tile, turn);
    s.callResponses = {};
    const evDiscard: GameEvent = { type: 'discard', seat: turn, tile, riichi: declareRiichi };
    if (s.pendingCalls.length > 0) {
      s.phase = 'afterDiscard';
      return { state: s, events: [evDiscard, { type: 'callWindow', seats: s.pendingCalls.map((p) => p.seat) }] };
    }
    if (maybeAbort(s)) return { state: s, events: [evDiscard, { type: 'result', result: s.result! }] };
    s.turn = nextSeat(turn);
    s.phase = 'draw';
    return { state: s, events: [evDiscard] };
  }

  // ===== afterDiscard の応答（ron/pon/chi/minkan/pass）=====
  if (state.phase === 'afterDiscard') {
    const valid = (action.type === 'ron' || action.type === 'pon' || action.type === 'chi' || action.type === 'kan' || action.type === 'pass');
    const seat = (action as { seat?: Seat }).seat;
    if (!valid || seat === undefined) return illegal(state, '鳴き局面で不正なアクション');
    const allowed = legalActions(state, seat).some((a) => JSON.stringify(a) === JSON.stringify(action));
    if (!allowed) return illegal(state, 'その鳴きは選べない');
    const s = clone(state);
    s.callResponses[seat] = action;
    return resolveCalls(s);
  }

  // ===== afterKakan の応答（チャンカン ron / pass）=====
  if (state.phase === 'afterKakan') {
    const seat = (action as { seat?: Seat }).seat;
    if ((action.type !== 'ron' && action.type !== 'pass') || seat === undefined) {
      return illegal(state, 'チャンカン局面で不正なアクション');
    }
    if (!state.pendingCalls.some((p) => p.seat === seat) || state.callResponses[seat]) {
      return illegal(state, 'チャンカンできない');
    }
    const s = clone(state);
    s.callResponses[seat] = action;
    const responders = s.pendingCalls.map((p) => p.seat);
    if (!responders.every((x) => s.callResponses[x])) return { state: s, events: [] };

    const rons = responders.filter((x) => s.callResponses[x].type === 'ron');
    if (rons.length > 0) {
      const from = s.turn;
      const winner = rons.sort((a, b) => distFrom(from, a) - distFrom(from, b))[0];
      const res = evaluateWin(winInputFor(s, winner, s.chankanTile!.kind, s.chankanTile!.red, false, true))!;
      const result = winResult(s, winner, false, from, res);
      s.result = result;
      s.phase = 'over';
      return { state: s, events: [{ type: 'result', result }] };
    }
    // 全員パス → 加槓続行（嶺上ツモ）。見逃しフリテン
    for (const p of s.pendingCalls) {
      s.tempFuriten[p.seat] = true;
      if (s.riichi[p.seat]) s.riichiFuriten[p.seat] = true;
    }
    s.pendingCalls = [];
    s.callResponses = {};
    s.chankanTile = null;
    drawRinshan(s, s.turn);
    s.kuikae = [];
    s.phase = 'discard';
    return { state: s, events: [{ type: 'draw', seat: s.turn, tile: s.drawnTile!, rinshan: true }] };
  }

  return illegal(state, '不明なアクション');
}

export interface RankEntry {
  seat: Seat;
  score: number;
  rank: number;
}

export function finalRanking(state: GameState): RankEntry[] {
  const sorted = SEATS.map((seat) => ({ seat, score: state.scores[seat] })).sort(
    (a, b) => b.score - a.score || a.seat - b.seat,
  );
  return sorted.map((e, i) => ({ ...e, rank: i + 1 }));
}

export type NextHand = { over: true; ranking: RankEntry[] } | { over: false; state: GameState };

export function startNextHand(state: GameState): NextHand {
  if (state.phase !== 'over' || !state.result) {
    throw new Error('startNextHand: 局がまだ終了していない');
  }
  const res = state.result;
  const dealerKeeps =
    res.type === 'abortive'
      ? true // 途中流局は連荘
      : res.type === 'ryuukyoku'
        ? res.tenpai.includes(state.dealer)
        : res.winner === state.dealer;

  if (state.scores.some((v) => v < 0)) return { over: true, ranking: finalRanking(state) };

  let wind = state.wind;
  let dealer = state.dealer;
  let honba: number;
  if (dealerKeeps) {
    honba = state.honba + 1;
  } else {
    honba = res.type === 'ryuukyoku' ? state.honba + 1 : 0;
    if (dealer === 3) {
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
    riichiSticks: state.riichiSticks,
  });
  return { over: false, state: next };
}
