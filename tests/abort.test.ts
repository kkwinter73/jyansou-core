import { describe, it, expect } from 'vitest';
import { parseHand } from '../src/tiles.js';
import { createGame, apply, legalActions, startNextHand, type GameState } from '../src/game.js';
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

function craftedState(overrides: Partial<GameState>): GameState {
  const g = structuredClone(createGame(1)); // dealer 0, 東場
  g.doraIndicators = [T(26)];
  g.uraIndicators = [T(26)];
  return { ...g, ...overrides };
}

describe('九種九牌（途中流局）', () => {
  it('么九9種以上の第1ツモで宣言でき、連荘・本場+1', () => {
    const hand = tilesFromHand('19m19p19s1234567z5m'); // 么九13種 + 5m（14枚）
    const s = craftedState({ turn: 0, phase: 'discard', drawnTile: find(hand, 4), hands: [
      { concealed: hand, melds: [] },
      { concealed: tilesFromHand('123m456m789m99s23z'), melds: [] },
      { concealed: tilesFromHand('123s456s789s99m23z'), melds: [] },
      { concealed: tilesFromHand('123m456m789m99p23z'), melds: [] },
    ] });
    expect(legalActions(s, 0).some((a) => a.type === 'kyuushu')).toBe(true);

    const { state } = apply(s, { type: 'kyuushu', seat: 0 });
    expect(state.phase).toBe('over');
    expect(state.result).toEqual({ type: 'abortive', reason: 'kyuushu', scoreDelta: [0, 0, 0, 0] });
    expect(conserved(state)).toBe(100000);

    const next = startNextHand(state);
    if (next.over) throw new Error('終局のはずがない');
    expect(next.state.dealer).toBe(0); // 連荘
    expect(next.state.honba).toBe(1);
  });

  it('鳴きが入っていると宣言できない', () => {
    const hand = tilesFromHand('19m19p19s1234567z5m');
    const s = craftedState({ turn: 0, phase: 'discard', drawnTile: find(hand, 4), hands: [
      { concealed: hand, melds: [] },
      { concealed: tilesFromHand('123m456m99s23z'), melds: [{ type: 'pon', tiles: [T(20), T(20), T(20)], from: 0 }] },
      { concealed: tilesFromHand('123s456s789s99m23z'), melds: [] },
      { concealed: tilesFromHand('123m456m789m99p23z'), melds: [] },
    ] });
    expect(legalActions(s, 0).some((a) => a.type === 'kyuushu')).toBe(false);
  });
});

describe('流し満貫', () => {
  it('全て么九の捨て牌（未鳴き）が流局時に満貫', () => {
    const s = craftedState({
      turn: 0,
      phase: 'draw',
      drawIndex: 122, // 山切れ → ツモで流局
      discards: [
        tilesFromHand('19m19p1z'), // 親(席0)の河は全て么九
        [T(4)], // 他家は通常牌を1枚（流し満貫ではない）
        [T(4)],
        [T(4)],
      ],
    });
    const { state } = apply(s, { type: 'draw' });
    expect(state.result?.type).toBe('ryuukyoku');
    if (state.result?.type === 'ryuukyoku') expect(state.result.nagashi).toEqual([0]);
    // 親の流し満貫 = 12000オール相当
    expect(state.scores).toEqual([25000 + 12000, 25000 - 4000, 25000 - 4000, 25000 - 4000]);
    expect(conserved(state)).toBe(100000);
  });
});

describe('四槓散了', () => {
  const noten = (h: string) => ({ concealed: tilesFromHand(h), melds: [] });

  it('4回目のカンが複数人にまたがると途中流局', () => {
    const seat0 = tilesFromHand('1111m234p567p99s5p'); // 1m×4で暗槓可（13枚）
    const s = craftedState({
      turn: 0,
      phase: 'discard',
      kanCount: 3,
      kansBySeat: [2, 1, 0, 0], // 既に席0が2回・席1が1回（＝複数人）
      drawnTile: find(seat0, 13),
      hands: [
        { concealed: seat0, melds: [] },
        noten('123m456m789m99p23z'),
        noten('123m456m789m99p23z'),
        noten('123m456m789m99p23z'),
      ],
    });
    const afterKan = apply(s, { type: 'kan', seat: 0, kind: 'ankan', tile: 0 }).state;
    expect(afterKan.kanCount).toBe(4);
    const ninesou = find(afterKan.hands[0].concealed, 26); // 9s を捨てる（他家は鳴けない）
    const { state } = apply(afterKan, { type: 'discard', tile: ninesou });
    expect(state.result).toEqual({ type: 'abortive', reason: 'suukaikan', scoreDelta: [0, 0, 0, 0] });
    expect(conserved(state)).toBe(100000);
  });

  it('1人で4つ（四槓子狙い）なら流局しない', () => {
    const seat0 = tilesFromHand('1111m234p567p99s5p');
    const s = craftedState({
      turn: 0,
      phase: 'discard',
      kanCount: 3,
      kansBySeat: [3, 0, 0, 0], // すべて席0
      drawnTile: find(seat0, 13),
      hands: [
        { concealed: seat0, melds: [] },
        noten('123m456m789m99p23z'),
        noten('123m456m789m99p23z'),
        noten('123m456m789m99p23z'),
      ],
    });
    const afterKan = apply(s, { type: 'kan', seat: 0, kind: 'ankan', tile: 0 }).state;
    const ninesou = find(afterKan.hands[0].concealed, 26);
    const { state } = apply(afterKan, { type: 'discard', tile: ninesou });
    expect(state.result).toBeNull(); // 流局しない
    expect(state.phase).toBe('draw');
    expect(state.turn).toBe(1);
  });
});

describe('送り槓（リーチ中の暗槓）', () => {
  it('待ちが変わらない暗槓は許可される', () => {
    const hand = tilesFromHand('2222m345m678p99s56s'); // 222mは固定の刻子、待ちは4s/7s
    const s = craftedState({
      turn: 0,
      phase: 'discard',
      riichi: [true, false, false, false],
      drawnTile: find(hand, 1), // 4枚目の2mをツモ
      hands: [
        { concealed: hand, melds: [] },
        { concealed: tilesFromHand('123m456m789m99s23z'), melds: [] },
        { concealed: tilesFromHand('123s456s789s99m23z'), melds: [] },
        { concealed: tilesFromHand('123m456m789m99p23z'), melds: [] },
      ],
    });
    const kan = legalActions(s, 0).find((a) => a.type === 'kan' && a.kind === 'ankan' && a.tile === 1);
    expect(kan).toBeTruthy();

    const { state } = apply(s, kan!);
    expect(state.hands[0].melds[0].type).toBe('ankan');
    expect(state.riichi[0]).toBe(true); // リーチは継続
    expect(state.drawnTile).not.toBeNull(); // 嶺上ツモ
  });
});
