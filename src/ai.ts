// 簡易CPU。chooseAction(state, seat): Action。
// 戦略であってルールではないため core の必須APIとは分離（architecture.md）。
// v2 ヒューリスティック:
//  - 和了できるなら和了（ツモ/ロン/槍槓）。
//  - 鳴き: 役が確定する鳴きのみ。役牌はポン(大明槓せず・アンコ温存)、タンヤオ志向は聴牌到達か打点ありで開く。
//         鳴いて向聴が悪化するなら見送り。他家リーチ中は聴牌になる鳴きのみ(守備優先)。
//  - 打牌: 向聴最小 → 受け入れ「枚数」最大（ukeire）→ 残し打点(ドラ/役牌対子)が高い → 孤立牌、の順で選ぶ。
//         赤は同種なら残す。聴牌でリーチ可能なら宣言。
//  - 押し引き: 他家リーチ時は shouldPush で押す/降りるを決め、降りるならベタオリ（safestDiscard）。
import type { Seat, TileKind, Tile, Wind } from './types.js';
import { tilesToCounts, isYaochu } from './tiles.js';
import { shanten } from './shanten.js';
import { legalActions, seatWindOf, type GameState, type Action, type PlayerState } from './game.js';

const WIND_KIND: Record<Wind, TileKind> = { E: 27, S: 28, W: 29, N: 30 };

function isYakuhai(state: GameState, seat: Seat, kind: TileKind): boolean {
  if (kind >= 31) return true; // 三元牌
  return kind === WIND_KIND[seatWindOf(state, seat)] || kind === WIND_KIND[state.wind];
}


/** 手牌（手の内＋既存面子）がすべて簡牌（么九なし）か。タンヤオ志向の判定。 */
function handAllSimples(hand: PlayerState): boolean {
  if (hand.concealed.some((t) => isYaochu(t.kind))) return false;
  return hand.melds.every((m) => m.tiles.every((t) => !isYaochu(t.kind)));
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

/**
 * 受け入れ枚数（ukeire）。13枚形 counts から、向聴を縮める有効牌の「残り枚数の合計」。
 * vis は場に見えている枚数（visibleCounts）。残り = 4 - vis[k]。種類数でなく枚数で測る。
 */
export function ukeire(counts: number[], melds: number, vis: number[]): number {
  const base = shanten(counts, melds);
  let total = 0;
  for (let k = 0; k < 34; k++) {
    if (counts[k] >= 4 || !isRelevant(counts, k)) continue; // 孤立して向聴に効かない牌は走査しない
    counts[k]++;
    const after = shanten(counts, melds); // ツモ後14枚の向聴（=有効牌なら base-1）
    counts[k]--;
    if (after < base) total += Math.max(0, 4 - vis[k]);
  }
  return total;
}

/** kind を引いて向聴に効きうるか（同種が手にある／数牌で同色±2に手牌がある）。孤立牌の走査を省く高速化。 */
function isRelevant(counts: number[], kind: TileKind): boolean {
  if (counts[kind] > 0) return true;
  if (kind >= 27) return false; // 孤立した字牌は受けにならない
  const n = kind % 9;
  for (let d = 1; d <= 2; d++) {
    if (n - d >= 0 && counts[kind - d] > 0) return true;
    if (n + d <= 8 && counts[kind + d] > 0) return true;
  }
  return false;
}

/** その種を手に残したい度合い（打点期待）。ドラ＝強く残す、役牌の対子＝残す。同効率時のタイブレーク用。 */
function keepValue(state: GameState, seat: Seat, counts: number[], kind: TileKind): number {
  let v = 0;
  for (const ind of state.doraIndicators) if (doraKindOf(ind.kind) === kind) v += 3;
  if (isYakuhai(state, seat, kind) && counts[kind] >= 2) v += 2;
  return v;
}

/** 種 kind を切るとき、赤を残すため非赤の現物を優先して選ぶ。 */
function pickTileToDiscard(discards: Action[], kind: TileKind): Action {
  const same = discards.filter((a) => a.type === 'discard' && !a.riichi && a.tile.kind === kind);
  return same.find((a) => a.type === 'discard' && !a.tile.red) ?? same[0];
}

/** 鳴き a（ポン/チー）を実行した後の向聴数。calledKind は鳴いた牌の種。 */
function shantenAfterCall(hand: PlayerState, a: Action, calledKind: TileKind): number {
  const c = tilesToCounts(hand.concealed);
  if (a.type === 'pon') c[calledKind] -= 2;
  else if (a.type === 'chi') {
    c[a.tiles[0].kind]--;
    c[a.tiles[1].kind]--;
  }
  return shanten(c, hand.melds.length + 1);
}

/**
 * 鳴きの判断（afterDiscard 用）。**役が確定する鳴きだけ**を候補にする（役牌ポン／タンヤオ志向）。
 *  - 役牌: アガリ牌でアンコが既にある場合や大明槓はしない（アンコ温存・大明槓は損）。ポンのみ。
 *  - タンヤオ: 全簡牌で、么九を含まない順子/刻子。聴牌到達、または打点(ドラ)があり向聴が進むなら鳴く。
 *  - 共通: 鳴いて向聴が悪化するなら見送り。他家リーチ中は聴牌になる鳴きのみ（守備優先）。
 */
function chooseCall(state: GameState, seat: Seat, acts: Action[]): Action {
  const pass: Action = { type: 'pass', seat };
  const hand = state.hands[seat];
  const calledKind = state.lastDiscard!.tile.kind;
  const concealed = tilesToCounts(hand.concealed);
  const shBefore = shanten(concealed, hand.melds.length);
  const value = handValue(state, hand);
  const underThreat = ([0, 1, 2, 3] as Seat[]).some((o) => o !== seat && state.riichi[o]);

  const cands: { act: Action; sh: number }[] = [];

  // 役牌ポン（大明槓はしない／既にアンコなら鳴かずアンコ温存）
  if (isYakuhai(state, seat, calledKind) && concealed[calledKind] === 2) {
    const pon = acts.find((a) => a.type === 'pon');
    if (pon) cands.push({ act: pon, sh: shantenAfterCall(hand, pon, calledKind) });
  }

  // タンヤオ志向（全簡牌・喰い下がってもタンヤオ役が残る）
  if (handAllSimples(hand) && !isYaochu(calledKind)) {
    for (const a of acts) {
      if (a.type === 'pon') {
        cands.push({ act: a, sh: shantenAfterCall(hand, a, calledKind) });
      } else if (a.type === 'chi') {
        if ([a.tiles[0].kind, a.tiles[1].kind].some(isYaochu)) continue; // 么九を含む順子はタンヤオにならない
        cands.push({ act: a, sh: shantenAfterCall(hand, a, calledKind) });
      }
    }
  }
  if (cands.length === 0) return pass;

  const best = cands.sort((x, y) => x.sh - y.sh)[0];

  if (best.sh > shBefore) return pass; // 鳴いて向聴が悪化するなら見送り
  if (underThreat) return best.sh === 0 ? best.act : pass; // リーチ中は聴牌になる鳴きのみ
  if (best.sh === 0) return best.act; // 聴牌は鳴く
  if (best.sh < shBefore) {
    // 向聴が進む鳴き。役牌は速度重視で鳴く。タンヤオは打点(ドラ/赤)があるときだけ開く。
    const isYakuhaiPon = best.act.type === 'pon' && isYakuhai(state, seat, calledKind);
    if (isYakuhaiPon || value >= 2) return best.act;
  }
  return pass;
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

function doraKindOf(ind: TileKind): TileKind {
  if (ind < 27) {
    const s = Math.floor(ind / 9);
    return s * 9 + ((ind % 9) + 1) % 9;
  }
  if (ind < 31) return 27 + ((ind - 27 + 1) % 4);
  return 31 + ((ind - 31 + 1) % 3);
}

/** 手の価値（おおまかな打点期待）。ドラ＋赤＋門前ボーナス。 */
function handValue(state: GameState, hand: PlayerState): number {
  const tiles = [...hand.concealed, ...hand.melds.flatMap((m) => m.tiles)];
  let v = 0;
  for (const ind of state.doraIndicators) {
    const d = doraKindOf(ind.kind);
    v += tiles.filter((t) => t.kind === d).length;
  }
  v += tiles.filter((t) => t.red).length;
  if (hand.melds.every((m) => m.type === 'ankan')) v += 1; // 門前（リーチ/裏期待）
  return v;
}

/**
 * 押すか降りるかの判断（他家リーチがある前提で呼ぶ）。
 * 聴牌は押す／2向聴以上は降りる／1向聴は「手の価値・残り巡目・点棒リード」で判断。
 */
export function shouldPush(state: GameState, seat: Seat, minShanten: number): boolean {
  if (minShanten <= 0) return true; // 聴牌は押す
  if (minShanten >= 2) return false; // 2向聴以上は降りる
  const wallLeft = state.liveEnd - state.drawIndex;
  if (wallLeft < 6) return false; // 終盤の1向聴は降りる
  const others = ([0, 1, 2, 3] as Seat[]).filter((s) => s !== seat).map((s) => state.scores[s]);
  const lead = state.scores[seat] - Math.max(...others);
  const need = lead > 12000 ? 3 : 2; // 大きくリード時は慎重（高い手しか押さない）
  return handValue(state, state.hands[seat]) >= need;
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

    return chooseCall(state, seat, acts);
  }

  // discard 局面
  const tsumo = acts.find((a) => a.type === 'tsumo');
  if (tsumo) return tsumo;

  // v1 では自分から暗槓/加槓はしない（kan アクションは無視）
  const hand = state.hands[seat];
  const melds = hand.melds.length;
  const discards = acts.filter((a) => a.type === 'discard');

  // まず向聴だけを各候補（種ごと）で求める。受け入れ枚数は重いので向聴最小の候補のみ後で計算する。
  const baseCounts = tilesToCounts(hand.concealed);
  const seen = new Set<TileKind>();
  const byTile: { kind: TileKind; sh: number; rest: number[] }[] = [];
  for (const a of discards) {
    if (a.type !== 'discard' || a.riichi || seen.has(a.tile.kind)) continue;
    seen.add(a.tile.kind);
    const rest = baseCounts.slice();
    rest[a.tile.kind]--;
    byTile.push({ kind: a.tile.kind, sh: shanten(rest, melds), rest });
  }
  if (byTile.length === 0) return discards[0]; // 念のため

  const minSh = Math.min(...byTile.map((b) => b.sh));

  // 押し引き: 他家リーチがあり、押す価値が無ければ降りる（手の価値・巡目・点棒で判断）
  const threats = ([0, 1, 2, 3] as Seat[]).filter((o) => o !== seat && state.riichi[o]);
  if (threats.length > 0 && !state.riichi[seat] && !shouldPush(state, seat, minSh)) {
    return safestDiscard(state, seat, hand, discards, threats);
  }

  // 向聴最小の中から打牌を選ぶ。受け入れ枚数が効くのは終盤(1〜2向聴)なのでそこだけ ukeire を計算し、
  // 3向聴以上は孤立牌→残し打点の軽量ヒューリスティックで選ぶ（shanten 連打を避ける高速化）。
  const tied = byTile.filter((b) => b.sh === minSh);
  const vis = visibleCounts(state, seat);
  const scored = tied.map((b) => ({
    kind: b.kind,
    // 受け入れ枚数が効くのは終盤(1〜2向聴)かつ候補が割れた時だけ。それ以外は計算を省く。
    uke: minSh <= 2 && tied.length > 1 ? ukeire(b.rest, melds, vis) : 0,
    keep: keepValue(state, seat, baseCounts, b.kind),
    use: usefulness(baseCounts, b.kind),
  }));
  const best = scored.sort((a, b) => b.uke - a.uke || a.keep - b.keep || a.use - b.use)[0];

  if (minSh === 0) {
    // 聴牌: リーチ可能ならその種で宣言、不可なら通常打牌（赤は残す）。
    const riichi = discards.find((a) => a.type === 'discard' && a.riichi && a.tile.kind === best.kind);
    if (riichi) return riichi;
  }
  return pickTileToDiscard(discards, best.kind);
}
