import { describe, it, expect } from 'vitest';
import { basePoints, computeScore } from '../src/score.js';
import { computeFu, type FuInput } from '../src/fu.js';
import { parseHand } from '../src/tiles.js';
import { evaluateWin, type WinInput, type WinResult } from '../src/yaku.js';
import type { TileKind } from '../src/types.js';
import type { ParsedMeld } from '../src/decompose.js';

const tile = (s: string): TileKind => parseHand(s).findIndex((x) => x > 0);
const seq = (lo: TileKind): ParsedMeld => ({ kind: 'shuntsu', tile: lo, concealed: true, fromCall: false });

describe('basePoints（点数早見表との突合）', () => {
  it('4翻30符 = 1920', () => expect(basePoints(4, 30, 0)).toBe(1920));
  it('3翻40符 = 1280', () => expect(basePoints(3, 40, 0)).toBe(1280));
  it('5翻=満貫(2000) 符に依らない', () => expect(basePoints(5, 30, 0)).toBe(2000));
  it('満貫頭打ち: 4翻40符は2000で頭打ち', () => expect(basePoints(4, 40, 0)).toBe(2000));
  it('跳満6翻=3000 / 倍満8翻=4000 / 三倍満11翻=6000', () => {
    expect(basePoints(6, 30, 0)).toBe(3000);
    expect(basePoints(8, 30, 0)).toBe(4000);
    expect(basePoints(11, 30, 0)).toBe(6000);
  });
  it('数え役満13翻=8000、役満倍数', () => {
    expect(basePoints(13, 30, 0)).toBe(8000);
    expect(basePoints(0, 0, 1)).toBe(8000);
    expect(basePoints(0, 0, 2)).toBe(16000);
  });
});

describe('computeScore（支払い・本場・供託）', () => {
  it('子ロン 30符4翻 = 7700', () => {
    const s = computeScore(basePoints(4, 30, 0), false, false, 0, 0);
    expect(s.payments).toEqual({ type: 'ron', from: 7700 });
    expect(s.total).toBe(7700);
  });
  it('親ロン 30符4翻 = 11600', () => {
    const s = computeScore(basePoints(4, 30, 0), true, false, 0, 0);
    expect(s.payments).toEqual({ type: 'ron', from: 11600 });
  });
  it('子ツモ 30符3翻 = 1000/2000（計4000）', () => {
    const s = computeScore(basePoints(3, 30, 0), false, true, 0, 0);
    expect(s.payments).toEqual({ type: 'tsumo', fromEachNonDealer: 1000, fromDealer: 2000 });
    expect(s.total).toBe(4000);
  });
  it('親ツモ 30符4翻 = 3900 all（計11700）', () => {
    const s = computeScore(basePoints(4, 30, 0), true, true, 0, 0);
    expect(s.payments).toEqual({ type: 'tsumo', fromEachNonDealer: 3900, fromDealer: null });
    expect(s.total).toBe(11700);
  });
  it('子役満ツモ = 8000/16000（計32000）', () => {
    const s = computeScore(basePoints(0, 0, 1), false, true, 0, 0);
    expect(s.payments).toEqual({ type: 'tsumo', fromEachNonDealer: 8000, fromDealer: 16000 });
    expect(s.total).toBe(32000);
  });
  it('本場: 子ロン2本場で +600', () => {
    expect(computeScore(basePoints(4, 30, 0), false, false, 2, 0).payments).toEqual({ type: 'ron', from: 8300 });
  });
  it('供託: リーチ棒1本で total +1000', () => {
    const s = computeScore(2000, false, false, 0, 1);
    expect(s.riichiSticks).toBe(1000);
    expect(s.total).toBe(8000 + 1000);
  });
});

describe('computeFu', () => {
  const baseArgs: FuInput = {
    melds: [seq(0), seq(1), seq(9), seq(18)],
    pair: 4,
    waitType: 'ryanmen',
    byTsumo: false,
    menzen: true,
    seatWind: 'E',
    roundWind: 'E',
    pinfu: false,
    chiitoitsu: false,
  };
  it('七対子=25、平和ツモ=20、平和ロン=30', () => {
    expect(computeFu({ ...baseArgs, chiitoitsu: true })).toBe(25);
    expect(computeFu({ ...baseArgs, pinfu: true, byTsumo: true })).toBe(20);
    expect(computeFu({ ...baseArgs, pinfu: true, byTsumo: false })).toBe(30);
  });
  it('門前ロン + 么九暗刻(+8) = 38 → 切り上げ40', () => {
    const melds: ParsedMeld[] = [
      { kind: 'kotsu', tile: 0, concealed: true, fromCall: false }, // 1m 暗刻 +8
      seq(9),
      seq(18),
      seq(3),
    ];
    expect(computeFu({ ...baseArgs, melds })).toBe(40);
  });
  it('非平和の最低符は30（喰い平和形ロン）', () => {
    expect(computeFu({ ...baseArgs, menzen: false, waitType: 'ryanmen' })).toBe(30);
  });
});

function evalHand(concealed: string, winTile: string, opts: Partial<WinInput> = {}): WinResult | null {
  return evaluateWin({
    concealed: parseHand(concealed),
    winTile: tile(winTile),
    byTsumo: false,
    seatWind: 'E',
    roundWind: 'E',
    ...opts,
  });
}

describe('evaluateWin との統合', () => {
  it('子 平和ツモ（20符3翻）= 700/1300', () => {
    const r = evalHand('234567m234567p55s', '5p', { byTsumo: true, seatWind: 'S' });
    expect(r!.fu).toBe(20);
    expect(r!.han).toBe(3);
    expect(r!.base).toBe(640);
    expect(r!.score.payments).toEqual({ type: 'tsumo', fromEachNonDealer: 700, fromDealer: 1300 });
    expect(r!.score.total).toBe(2700);
  });

  it('子 役満（大三元）ロン = 32000', () => {
    const r = evalHand('555666777z234m99p', '9p', { seatWind: 'S' });
    expect(r!.yakumanTotal).toBeGreaterThanOrEqual(1);
    expect(r!.base).toBe(8000);
    expect(r!.score.payments).toEqual({ type: 'ron', from: 32000 });
  });
});
