import { describe, it, expect } from 'vitest';
import { parseHand } from '../src/tiles.js';
import { createGame, apply, legalActions, type GameState, type Action, type Meld } from '../src/game.js';
import { chooseAction } from '../src/ai.js';
import { shanten } from '../src/shanten.js';
import { tilesToCounts } from '../src/tiles.js';
import type { Tile, TileKind, Seat } from '../src/types.js';

let idc = 2000;
function tilesFromHand(s: string): Tile[] {
  const counts = parseHand(s);
  const out: Tile[] = [];
  for (let k = 0; k < 34; k++) for (let i = 0; i < counts[k]; i++) out.push({ kind: k, red: false, id: idc++ });
  return out;
}
const T = (kind: TileKind): Tile => ({ kind, red: false, id: idc++ });
const find = (tiles: Tile[], kind: TileKind) => tiles.find((t) => t.kind === kind)!;
const conserved = (s: GameState) => s.scores.reduce((a, b) => a + b, 0) + s.riichiSticks * 1000;

function craftedState(overrides: Partial<GameState>): GameState {
  const g = structuredClone(createGame(1));
  g.doraIndicators = [T(26)]; // ドラ=1s（手牌に絡めない）
  g.uraIndicators = [T(26)];
  return { ...g, ...overrides };
}
const NONCALL_M = () => tilesFromHand('123m456m789m99s23z'); // ピンズ/1z無し → 多くの鳴き不可
const NONCALL_S = () => tilesFromHand('123s456s789s99m23z');

describe('ポン', () => {
  it('ポンで面子化し手番が移る・一発消滅', () => {
    const seat0 = tilesFromHand('1z234m567m234p567p9s'); // 14枚、1zを捨てる
    const seat1 = tilesFromHand('11z147m147s258p9s9p'); // 13枚、1z×2（ポン可）・ノーテン
    const s = craftedState({
      turn: 0,
      phase: 'discard',
      ippatsu: [false, true, false, false],
      hands: [
        { concealed: seat0, melds: [] },
        { concealed: seat1, melds: [] },
        { concealed: NONCALL_M(), melds: [] },
        { concealed: NONCALL_S(), melds: [] },
      ],
    });
    const after = apply(s, { type: 'discard', tile: find(seat0, 27) }).state;
    expect(after.phase).toBe('afterDiscard');
    expect(after.pendingCalls.find((p) => p.seat === 1)?.pon).toBe(true);

    const { state } = apply(after, { type: 'pon', seat: 1 });
    expect(state.turn).toBe(1);
    expect(state.phase).toBe('discard');
    const meld = state.hands[1].melds[0] as Meld;
    expect(meld.type).toBe('pon');
    expect(meld.from).toBe(0);
    expect(meld.tiles.every((t) => t.kind === 27)).toBe(true);
    expect(state.hands[1].concealed).toHaveLength(11);
    expect(state.ippatsu).toEqual([false, false, false, false]); // 鳴きで一発消滅
    expect(conserved(state)).toBe(100000);
  });
});

describe('チー', () => {
  it('上家(席0)からのみチー可・面子化して手番が移る', () => {
    const seat0 = tilesFromHand('3m234p567p234s567s7z'); // 14枚、3mを捨てる
    const seat1 = tilesFromHand('24m234p567p99s123z'); // 2m4m → 3mチー可（次家）
    const seat2 = tilesFromHand('24m234p567p99s123z'); // 同じ牌を持つが次家でないのでチー不可
    const s = craftedState({
      turn: 0,
      phase: 'discard',
      hands: [
        { concealed: seat0, melds: [] },
        { concealed: seat1, melds: [] },
        { concealed: seat2, melds: [] },
        { concealed: NONCALL_S(), melds: [] },
      ],
    });
    const after = apply(s, { type: 'discard', tile: find(seat0, 2) }).state;
    const chi = legalActions(after, 1).find((a) => a.type === 'chi');
    expect(chi).toBeTruthy();
    expect(legalActions(after, 2).some((a) => a.type === 'chi')).toBe(false); // 次家でない

    const { state } = apply(after, chi as Action);
    expect(state.turn).toBe(1);
    expect(state.hands[1].melds[0].type).toBe('chi');
    expect(state.hands[1].concealed).toHaveLength(11);
    expect(conserved(state)).toBe(100000);
  });
});

describe('優先順位', () => {
  it('ロン > ポン（同じ打牌にロンとポンが競合したらロン）', () => {
    const seat0 = tilesFromHand('1z234m567m234p567p9s'); // 1zを捨てる
    const seat1 = tilesFromHand('11z147m147s258p9s9p'); // 1zポン可・ノーテン
    // seat2: 1z単騎テンパイ（混一色）でロン可
    const seat2 = tilesFromHand('123m456m789m222z1z'); // 123m456m789m+南刻+1z単騎 → 1zで和了(混一)
    const s = craftedState({
      turn: 0,
      phase: 'discard',
      hands: [
        { concealed: seat0, melds: [] },
        { concealed: seat1, melds: [] },
        { concealed: seat2, melds: [] },
        { concealed: NONCALL_S(), melds: [] },
      ],
    });
    const after = apply(s, { type: 'discard', tile: find(seat0, 27) }).state;
    // seat1=ポン応答, seat2=ロン応答 → ロンが優先
    const s1 = apply(after, { type: 'pon', seat: 1 }).state;
    const { state } = apply(s1, { type: 'ron', seat: 2 });
    expect(state.result?.type).toBe('ron');
    if (state.result?.type === 'ron') expect(state.result.winner).toBe(2);
    expect(conserved(state)).toBe(100000);
  });
});

describe('暗槓', () => {
  it('暗槓で嶺上ツモ・カンドラが1枚増える・王牌補充で生牌が1減る', () => {
    const seat0 = tilesFromHand('1111z234m567m234p5p'); // 1z×4（暗槓可）
    const s = craftedState({
      turn: 0,
      phase: 'discard',
      hands: [
        { concealed: seat0, melds: [] },
        { concealed: NONCALL_M(), melds: [] },
        { concealed: NONCALL_S(), melds: [] },
        { concealed: NONCALL_M(), melds: [] },
      ],
    });
    const before = { dora: s.doraIndicators.length, live: s.liveEnd };
    const kan = legalActions(s, 0).find((a) => a.type === 'kan' && a.kind === 'ankan');
    expect(kan).toBeTruthy();
    const { state } = apply(s, kan as Action);
    expect(state.hands[0].melds[0].type).toBe('ankan');
    expect(state.doraIndicators.length).toBe(before.dora + 1); // カンドラ
    expect(state.liveEnd).toBe(before.live - 1); // 王牌補充
    expect(state.drawnTile).not.toBeNull(); // 嶺上ツモ
    expect(state.rinshan).toBe(true);
    expect(state.phase).toBe('discard');
  });
});

describe('加槓と槍槓', () => {
  it('加槓を他家が槍槓ロンできる', () => {
    const pon: Meld = { type: 'pon', tiles: [T(2), T(2), T(2)], from: 1 }; // 3mポン済み
    const seat0 = tilesFromHand('3m234p567p99s12z'); // 11枚、3m加槓可
    const seat2 = tilesFromHand('12m456m789m234p11p'); // 3m待ち（槍槓ロン）
    const s = craftedState({
      turn: 0,
      phase: 'discard',
      hands: [
        { concealed: seat0, melds: [pon] },
        { concealed: NONCALL_S(), melds: [] },
        { concealed: seat2, melds: [] },
        { concealed: NONCALL_S(), melds: [] },
      ],
    });
    const kan = legalActions(s, 0).find((a) => a.type === 'kan' && a.kind === 'kakan');
    expect(kan).toBeTruthy();
    const after = apply(s, kan as Action).state;
    expect(after.phase).toBe('afterKakan');
    expect(after.pendingCalls.map((p) => p.seat)).toContain(2);

    const { state } = apply(after, { type: 'ron', seat: 2 });
    expect(state.result?.type).toBe('ron');
    if (state.result?.type === 'ron') {
      expect(state.result.winner).toBe(2);
      expect(state.result.from).toBe(0);
      expect(state.result.hand.yaku.map((y) => y.name)).toContain('槍槓');
    }
    expect(conserved(state)).toBe(100000);
  });
});

describe('CPUの鳴き思考', () => {
  it('役牌（白）はポンする', () => {
    const seat0 = tilesFromHand('5z234m567m234p567p9s'); // 白を捨てる
    const seat1 = tilesFromHand('55z147m147s258p9s9p'); // 白×2・ノーテン（席1）
    const s = craftedState({
      turn: 0,
      phase: 'discard',
      hands: [
        { concealed: seat0, melds: [] },
        { concealed: seat1, melds: [] },
        { concealed: NONCALL_M(), melds: [] },
        { concealed: NONCALL_S(), melds: [] },
      ],
    });
    const after = apply(s, { type: 'discard', tile: find(seat0, 31) }).state;
    expect(chooseAction(after, 1).type).toBe('pon');
  });

  it('役牌でもタンヤオでもない鳴きはパス（門前維持）', () => {
    const seat0 = tilesFromHand('9m234m567m234p567p1s'); // 9mを捨てる
    const seat1 = tilesFromHand('99m119p119s12345z'); // 9m×2だが么九だらけ（タンヤオ不可）
    const s = craftedState({
      turn: 0,
      phase: 'discard',
      hands: [
        { concealed: seat0, melds: [] },
        { concealed: seat1, melds: [] },
        { concealed: NONCALL_M(), melds: [] },
        { concealed: NONCALL_S(), melds: [] },
      ],
    });
    const after = apply(s, { type: 'discard', tile: find(seat0, 8) }).state;
    expect(after.pendingCalls.find((p) => p.seat === 1)?.pon).toBe(true); // ポンは可能
    expect(chooseAction(after, 1).type).toBe('pass'); // でも見送る
  });
});

describe('CPUの打牌（向聴最小化）', () => {
  it('向聴数が最小になる牌を切る', () => {
    const hand = tilesFromHand('234m567m678p234s9s1z'); // 14枚: 4面子+9s+1z（雀頭なし→聴牌到達可能）
    const s = craftedState({
      turn: 0,
      phase: 'discard',
      drawnTile: find(hand, 30), // 1z
      hands: [{ concealed: hand, melds: [] }, ...structuredClone(createGame(1).hands).slice(1)],
    });
    const action = chooseAction(s, 0);
    expect(action.type).toBe('discard');
    if (action.type !== 'discard') return;

    const afterChosen = tilesToCounts(hand);
    afterChosen[action.tile.kind]--;
    const chosenSh = shanten(afterChosen, 0);

    let best = 99;
    const full = tilesToCounts(hand);
    for (let k = 0; k < 34; k++) {
      if (full[k] > 0) {
        const r = tilesToCounts(hand);
        r[k]--;
        best = Math.min(best, shanten(r, 0));
      }
    }
    expect(chosenSh).toBe(best); // 最小向聴の打牌を選ぶ
    expect(best).toBe(0); // この手は聴牌到達可能
  });
});

describe('鳴きまくりボットの自己対戦', () => {
  function callerBot(s: GameState, seat: Seat): Action {
    const acts = legalActions(s, seat);
    if (s.phase === 'afterDiscard' || s.phase === 'afterKakan') {
      return (
        acts.find((a) => a.type === 'ron') ??
        acts.find((a) => a.type === 'kan') ??
        acts.find((a) => a.type === 'pon') ??
        acts.find((a) => a.type === 'chi') ??
        { type: 'pass', seat }
      );
    }
    if (s.phase === 'draw') return { type: 'draw' };
    const tsumo = acts.find((a) => a.type === 'tsumo');
    if (tsumo) return tsumo;
    const kan = acts.find((a) => a.type === 'kan'); // 暗槓/加槓を積極的に
    if (kan) return kan;
    return acts.find((a) => a.type === 'discard')!;
  }

  it('鳴き・カンを多用しても終局し、合法手のみで進み、点数が保存される', () => {
    for (let seed = 1; seed <= 30; seed++) {
      let s = createGame(seed);
      for (let guard = 0; guard < 1000 && s.phase !== 'over'; guard++) {
        const seat =
          s.phase === 'afterDiscard' || s.phase === 'afterKakan'
            ? s.pendingCalls.find((p) => !s.callResponses[p.seat])!.seat
            : s.turn;
        const action = callerBot(s, seat);
        expect(legalActions(s, seat)).toContainEqual(action);
        s = apply(s, action).state;
      }
      expect(s.phase).toBe('over');
      expect(conserved(s)).toBe(100000);
    }
  });
});
