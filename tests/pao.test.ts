import { describe, it, expect } from 'vitest';
import { parseHand } from '../src/tiles.js';
import { createGame, apply, type GameState, type Meld } from '../src/game.js';
import type { Tile, TileKind } from '../src/types.js';

let idc = 3000;
function tilesFromHand(s: string): Tile[] {
  const counts = parseHand(s);
  const out: Tile[] = [];
  for (let k = 0; k < 34; k++) for (let i = 0; i < counts[k]; i++) out.push({ kind: k, red: false, id: idc++ });
  return out;
}
const T = (kind: TileKind): Tile => ({ kind, red: false, id: idc++ });
const find = (tiles: Tile[], kind: TileKind) => tiles.find((t) => t.kind === kind)!;
const conserved = (s: GameState) => s.scores.reduce((a, b) => a + b, 0) + s.riichiSticks * 1000;
const pon = (kind: TileKind, from: 0 | 1 | 2 | 3): Meld => ({ type: 'pon', tiles: [T(kind), T(kind), T(kind)], from });

function craftedState(overrides: Partial<GameState>): GameState {
  const g = structuredClone(createGame(1));
  g.doraIndicators = [T(8)]; // ドラ=9m（手牌に絡めない）
  g.uraIndicators = [T(8)];
  return { ...g, ...overrides };
}
const NONCALL_S = () => tilesFromHand('123s456s789s99p44s'); // ピンズ/字牌少 → 1m/中をポン/ロンしない

describe('包の成立検出（executeCall）', () => {
  it('大三元: 3種目の三元牌をポンで包成立、放出者が責任者', () => {
    // 席0: 白暗刻 + 發ポン済 + 中対子（=ポンで大三元確定）
    const seat0 = tilesFromHand('12345m55577z'); // 白白白 中中 + 端数
    const seat2 = tilesFromHand('1234567899p9p77z'); // 14枚、7z(中)を捨てる
    const s = craftedState({
      turn: 2,
      phase: 'discard',
      hands: [
        { concealed: seat0, melds: [pon(32, 1)] }, // 發ポン（from 席1）
        { concealed: NONCALL_S(), melds: [] },
        { concealed: seat2, melds: [] },
        { concealed: NONCALL_S(), melds: [] },
      ],
    });
    const after = apply(s, { type: 'discard', tile: find(seat2, 33) }).state;
    expect(after.pendingCalls.find((p) => p.seat === 0)?.pon).toBe(true);

    const { state } = apply(after, { type: 'pon', seat: 0 });
    expect(state.pao[0]).toEqual({ by: 2, yakuman: '大三元' });
    expect(conserved(state)).toBe(100000);
  });

  it('包は成立しない: 残りの三元牌が刻子で揃っていなければ無効', () => {
    // 席0: 白対子（刻子でない）+ 發ポン + 中対子 → 中ポンしても大三元未確定
    const seat0 = tilesFromHand('123456m5577z'); // 白白 中中 + 端数
    const seat2 = tilesFromHand('1234567899p9p77z');
    const s = craftedState({
      turn: 2,
      phase: 'discard',
      hands: [
        { concealed: seat0, melds: [pon(32, 1)] },
        { concealed: NONCALL_S(), melds: [] },
        { concealed: seat2, melds: [] },
        { concealed: NONCALL_S(), melds: [] },
      ],
    });
    const after = apply(s, { type: 'discard', tile: find(seat2, 33) }).state;
    const { state } = apply(after, { type: 'pon', seat: 0 });
    expect(state.pao[0]).toBeNull();
  });
});

describe('包の点移動（applyWinScore）', () => {
  // 席0(子, dealer=1)が 白暗刻・發暗刻・中ポン・234m・11m待ち の大三元。
  const daisangenHand = (): GameState['hands'] => [
    { concealed: tilesFromHand('1234m555666z'), melds: [pon(33, 1)] }, // 1m2m3m4m 白白白 發發發 + 中ポン
    { concealed: NONCALL_S(), melds: [] },
    { concealed: tilesFromHand('1m234p567p123p345s9s'), melds: [] }, // 1mを持つ（ロン用）
    { concealed: NONCALL_S(), melds: [] },
  ];

  it('大三元ツモ: 責任者が全額（32000）を1人で支払う', () => {
    const hands = daisangenHand();
    hands[0] = { concealed: tilesFromHand('234m555666z11m'), melds: [pon(33, 1)] }; // 11枚（ツモ牌込み・11m雀頭）
    const s = craftedState({
      dealer: 1,
      turn: 0,
      phase: 'discard',
      drawnTile: T(0), // 1m ツモ
      pao: [{ by: 1, yakuman: '大三元' }, null, null, null],
      hands,
    });
    const { state, events } = apply(s, { type: 'tsumo' });
    const res = events.find((e) => e.type === 'result')!;
    if (res.type !== 'result' || res.result.type !== 'tsumo') throw new Error('tsumo結果なし');
    expect(res.result.scoreDelta).toEqual([32000, -32000, 0, 0]);
    expect(conserved(state)).toBe(100000);
  });

  it('包なしの大三元ツモ: 通常分配（親16000・子8000ずつ）', () => {
    const hands = daisangenHand();
    hands[0] = { concealed: tilesFromHand('234m555666z11m'), melds: [pon(33, 1)] };
    const s = craftedState({ dealer: 1, turn: 0, phase: 'discard', drawnTile: T(0), hands });
    const { state, events } = apply(s, { type: 'tsumo' });
    const res = events.find((e) => e.type === 'result')!;
    if (res.type !== 'result' || res.result.type !== 'tsumo') throw new Error('tsumo結果なし');
    expect(res.result.scoreDelta).toEqual([32000, -16000, -8000, -8000]);
    expect(conserved(state)).toBe(100000);
  });

  it('大三元ロン: 責任者と放銃者で折半（各16000）', () => {
    const s = craftedState({
      dealer: 1,
      turn: 2,
      phase: 'discard',
      pao: [{ by: 1, yakuman: '大三元' }, null, null, null], // 責任者=席1、放銃者=席2
      hands: daisangenHand(),
    });
    const after = apply(s, { type: 'discard', tile: find(s.hands[2].concealed, 0) }).state; // 席2が1mを捨てる
    expect(after.pendingCalls.find((p) => p.seat === 0)?.ron).toBe(true);
    const { state, events } = apply(after, { type: 'ron', seat: 0 });
    const res = events.find((e) => e.type === 'result')!;
    if (res.type !== 'result' || res.result.type !== 'ron') throw new Error('ron結果なし');
    expect(res.result.scoreDelta).toEqual([32000, -16000, -16000, 0]);
    expect(conserved(state)).toBe(100000);
  });

  it('大三元ロン: 責任者＝放銃者なら全額負担（32000）', () => {
    const s = craftedState({
      dealer: 1,
      turn: 2,
      phase: 'discard',
      pao: [{ by: 2, yakuman: '大三元' }, null, null, null], // 責任者=放銃者=席2
      hands: daisangenHand(),
    });
    const after = apply(s, { type: 'discard', tile: find(s.hands[2].concealed, 0) }).state;
    const { state, events } = apply(after, { type: 'ron', seat: 0 });
    const res = events.find((e) => e.type === 'result')!;
    if (res.type !== 'result' || res.result.type !== 'ron') throw new Error('ron結果なし');
    expect(res.result.scoreDelta).toEqual([32000, 0, -32000, 0]);
    expect(conserved(state)).toBe(100000);
  });
});
