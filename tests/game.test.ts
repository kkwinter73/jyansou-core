import { describe, it, expect } from 'vitest';
import { parseHand } from '../src/tiles.js';
import {
  createGame,
  legalActions,
  apply,
  startNextHand,
  finalRanking,
  type GameState,
  type Action,
} from '../src/game.js';
import type { Tile, TileKind, Seat } from '../src/types.js';

let idc = 1000; // createGame の id(0..135) と衝突しない範囲
function tilesFromHand(s: string): Tile[] {
  const counts = parseHand(s);
  const out: Tile[] = [];
  for (let k = 0; k < 34; k++) for (let i = 0; i < counts[k]; i++) out.push({ kind: k, red: false, id: idc++ });
  return out;
}
const T = (kind: TileKind): Tile => ({ kind, red: false, id: idc++ });
const find = (tiles: Tile[], kind: TileKind) => tiles.find((t) => t.kind === kind)!;
const conserved = (s: GameState) => s.scores.reduce((a, b) => a + b, 0) + s.riichiSticks * 1000;

describe('createGame', () => {
  it('配牌の不変条件', () => {
    const g = createGame(42);
    expect(g.wall.length).toBe(136);
    expect(g.hands.every((h) => h.concealed.length === 13)).toBe(true);
    expect(g.drawIndex).toBe(52);
    expect(g.doraIndicators.length).toBe(1);
    expect(g.dealer).toBe(0);
    expect(conserved(g)).toBe(100000);
  });

  it('seed で決定論的・別seedで別配牌', () => {
    const kinds = (g: GameState) => g.hands.map((h) => h.concealed.map((t) => t.kind));
    expect(kinds(createGame(42))).toEqual(kinds(createGame(42)));
    expect(kinds(createGame(42))).not.toEqual(kinds(createGame(43)));
  });
});

describe('完全な局ループ（ツモ切りボット）— 点数保存', () => {
  function playTsumogiri(seed: number): GameState {
    let s = createGame(seed);
    for (let guard = 0; guard < 300 && s.phase !== 'over'; guard++) {
      if (s.phase === 'draw') {
        s = apply(s, { type: 'draw' }).state;
      } else if (s.phase === 'discard') {
        const acts = legalActions(s, s.turn);
        const tsumo = acts.find((a) => a.type === 'tsumo');
        s = apply(s, tsumo ?? { type: 'discard', tile: s.drawnTile! }).state;
      } else if (s.phase === 'afterDiscard' || s.phase === 'afterKakan') {
        const pc = s.pendingCalls.find((p) => !s.callResponses[p.seat])!;
        s = apply(s, { type: 'pass', seat: pc.seat }).state;
      }
    }
    return s;
  }
  it('複数seedで終局し、点の総和が保存される', () => {
    for (const seed of [1, 2, 3, 7, 99, 12345]) {
      const s = playTsumogiri(seed);
      expect(s.phase).toBe('over');
      expect(conserved(s)).toBe(100000);
      expect(s.result).not.toBeNull();
    }
  });
});

function craftedState(overrides: Partial<GameState>): GameState {
  const g = structuredClone(createGame(1));
  // ドラ表示を手牌に絡まない牌(9s→ドラ1s)に固定し、点数を安定させる
  g.doraIndicators = [T(26)];
  g.uraIndicators = [T(26)];
  return { ...g, ...overrides };
}

describe('ツモ和了の点移動', () => {
  it('親 平和ツモ（20符3翻）= 3900オール', () => {
    const hand = tilesFromHand('234567m234567p55s'); // 14枚・和了形
    const s = craftedState({
      turn: 0,
      phase: 'discard',
      hands: [{ concealed: hand, melds: [] }, ...structuredClone(createGame(1).hands).slice(1)],
      drawnTile: find(hand, 13), // 5p をツモった
    });
    const { state, events } = apply(s, { type: 'tsumo' });
    expect(state.phase).toBe('over');
    expect(state.result?.type).toBe('tsumo');
    expect(events.some((e) => e.type === 'result')).toBe(true);
    const r = state.result!;
    expect(r.scoreDelta).toEqual([3900, -1300, -1300, -1300]);
    expect(conserved(state)).toBe(100000);
  });
});

describe('ロンとフリテン', () => {
  function ronSetup(seat2Discards: Tile[]): GameState {
    const seat0 = tilesFromHand('5p19m19p19s1234567z'); // 14枚（非和了）。5pを捨てる
    const seat2 = tilesFromHand('234567m234p67p55s'); // 13枚・5p/8p待ち（門前タンヤオ平和）
    // seat1/seat3 は 5p をポン/チー/ロンできない手（ピンズ無し・5p無し）にして候補を seat2 に限定
    const seat1 = tilesFromHand('123m456m789m99s12z');
    const seat3 = tilesFromHand('123s456s789s99m12z');
    return craftedState({
      turn: 0,
      phase: 'discard',
      hands: [
        { concealed: seat0, melds: [] },
        { concealed: seat1, melds: [] },
        { concealed: seat2, melds: [] },
        { concealed: seat3, melds: [] },
      ],
      discards: [[], [], seat2Discards, []],
      drawnTile: find(seat0, 13),
    });
  }

  it('ロン成立: 子のロンで放銃者から移動', () => {
    const s = ronSetup([]);
    const afterDiscard = apply(s, { type: 'discard', tile: find(s.hands[0].concealed, 13) }).state;
    expect(afterDiscard.phase).toBe('afterDiscard');
    expect(afterDiscard.pendingCalls.map((p) => p.seat)).toContain(2);
    expect(legalActions(afterDiscard, 2).some((a) => a.type === 'ron')).toBe(true);

    const { state } = apply(afterDiscard, { type: 'ron', seat: 2 });
    expect(state.result?.type).toBe('ron');
    if (state.result?.type === 'ron') {
      expect(state.result.winner).toBe(2);
      expect(state.result.from).toBe(0);
    }
    expect(state.scores[2]).toBeGreaterThan(25000);
    expect(state.scores[0]).toBeLessThan(25000);
    expect(conserved(state)).toBe(100000);
  });

  it('河フリテン: 待ち牌(8p)が自分の河にあるとロン不可', () => {
    const s = ronSetup([T(16)]); // 8p を河に置く → フリテン
    const after = apply(s, { type: 'discard', tile: find(s.hands[0].concealed, 13) }).state;
    expect(after.pendingCalls.map((p) => p.seat)).not.toContain(2);
    expect(after.phase).toBe('draw'); // ロンが無いので次の手番へ
    expect(after.turn).toBe(1);
  });
});

describe('リーチ後はツモ切りのみ', () => {
  it('リーチ中に手牌(ツモ牌以外)を切ろうとしても拒否される', () => {
    const hand = tilesFromHand('234567m234567p55s'); // 13枚相当のテンパイ手 + ツモ
    const drawn = T(33); // ツモ牌=中（手牌に無い独立牌）
    const concealed = [...hand.slice(0, 13), drawn]; // 13 + ツモ = 14
    const s = craftedState({
      turn: 0,
      phase: 'discard',
      riichi: [true, false, false, false],
      drawnTile: drawn,
      hands: [{ concealed, melds: [] }, ...structuredClone(createGame(1).hands).slice(1)],
    });
    // ツモ牌以外（手牌の牌）を切る → 拒否（状態不変）
    const handTile = concealed[0];
    const bad = apply(s, { type: 'discard', tile: handTile });
    expect(bad.events.some((e) => e.type === 'illegal')).toBe(true);
    expect(bad.state).toBe(s); // 状態は変わらない

    // ツモ牌（中）を切る → 通る（ツモ切り）
    const ok = apply(s, { type: 'discard', tile: drawn });
    expect(ok.events.some((e) => e.type === 'illegal')).toBe(false);
    expect(ok.state.discards[0].some((t) => t.id === drawn.id)).toBe(true);
  });
});

describe('流局', () => {
  it('聴牌1人・ノーテン3人 = 3000/−1000', () => {
    const tenpai = tilesFromHand('234567m234567p5s'); // 13枚・5s単騎
    const noten = () => tilesFromHand('1m4m7m1p4p7p1s4s7s1m4p7s2m'); // 明確にノーテン13枚
    const s = craftedState({
      turn: 0,
      phase: 'draw',
      drawIndex: 122, // 山切れ → ツモで流局
      hands: [
        { concealed: tenpai, melds: [] },
        { concealed: noten(), melds: [] },
        { concealed: noten(), melds: [] },
        { concealed: noten(), melds: [] },
      ],
    });
    const { state } = apply(s, { type: 'draw' });
    expect(state.result?.type).toBe('ryuukyoku');
    if (state.result?.type === 'ryuukyoku') expect(state.result.tenpai).toEqual([0]);
    expect(state.scores).toEqual([28000, 24000, 24000, 24000]);
    expect(conserved(state)).toBe(100000);
  });
});

describe('連荘・親送り・順位', () => {
  const overState = (result: GameState['result'], extra: Partial<GameState> = {}): GameState =>
    craftedState({ phase: 'over', result, scores: [25000, 25000, 25000, 25000], ...extra });

  it('親の和了で連荘・本場+1', () => {
    const s = overState({ type: 'tsumo', winner: 0, hand: {} as never, scoreDelta: [0, 0, 0, 0] });
    const n = startNextHand(s);
    expect(n.over).toBe(false);
    if (!n.over) {
      expect(n.state.dealer).toBe(0);
      expect(n.state.honba).toBe(1);
      expect(n.state.wind).toBe('E');
    }
  });

  it('子の和了で親流れ・本場0・東2局', () => {
    const s = overState({ type: 'ron', winner: 1, from: 0, hand: {} as never, scoreDelta: [0, 0, 0, 0] });
    const n = startNextHand(s);
    if (!n.over) {
      expect(n.state.dealer).toBe(1);
      expect(n.state.honba).toBe(0);
      expect(n.state.wind).toBe('E');
    } else {
      throw new Error('終局のはずがない');
    }
  });

  it('南4局・親流れで終局', () => {
    const s = overState({ type: 'ron', winner: 2, from: 3, hand: {} as never, scoreDelta: [0, 0, 0, 0] }, {
      wind: 'S',
      dealer: 3,
    });
    expect(startNextHand(s).over).toBe(true);
  });

  it('トビで終局', () => {
    const s = overState({ type: 'tsumo', winner: 0, hand: {} as never, scoreDelta: [0, 0, 0, 0] }, {
      scores: [60000, 50000, -1000, 16000],
    });
    expect(startNextHand(s).over).toBe(true);
  });

  it('finalRanking: 点数降順、同点は席順', () => {
    const s = craftedState({ scores: [25000, 25000, 30000, 20000] });
    const r = finalRanking(s);
    expect(r.map((e) => e.seat)).toEqual([2, 0, 1, 3]); // 30000 > 25000(席0<席1) > 20000
    expect(r.map((e) => e.rank)).toEqual([1, 2, 3, 4]);
  });
});
