import { describe, it, expect } from 'vitest';
import { parseHand } from '../src/tiles.js';
import { evaluateWin, type WinInput, type WinResult } from '../src/yaku.js';
import type { TileKind } from '../src/types.js';

// 1牌の表記 -> kind
function tile(s: string): TileKind {
  return parseHand(s).findIndex((x) => x > 0);
}
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
const names = (r: WinResult | null) => (r ? r.yaku.map((y) => y.name) : []);
const ymNames = (r: WinResult | null) => (r ? r.yakuman.map((y) => y.name) : []);

describe('特殊形', () => {
  it('七対子', () => {
    const r = evalHand('1133557799m1133p', '3p');
    expect(names(r)).toContain('七対子');
    expect(r!.han).toBe(2);
    expect(r!.yakumanTotal).toBe(0);
  });

  it('国士無双（単一面・単騎でない待ち）', () => {
    const r = evalHand('119m19p19s1234567z', '9m'); // 雀頭は1m、9mで和了
    expect(ymNames(r)).toContain('国士無双');
    expect(r!.yakumanTotal).toBe(1);
  });

  it('国士無双十三面（雀頭牌で和了→ダブル役満）', () => {
    const r = evalHand('119m19p19s1234567z', '1m');
    expect(r!.yakumanTotal).toBe(2);
  });
});

describe('役なし判定', () => {
  it('役がなければ和了不可（null）', () => {
    // 全順子＋客風(南)雀頭の単騎。平和も断么九も成立しない。
    expect(evalHand('234m567m234p567p22z', '2z')).toBeNull();
  });

  it('リーチのみで成立', () => {
    const r = evalHand('234m567m234p567p22z', '2z', { riichi: true });
    expect(names(r)).toEqual(['立直']);
    expect(r!.han).toBe(1);
  });
});

describe('門前手の複合', () => {
  it('平和 + 断么九 + 門前清自摸和', () => {
    const r = evalHand('234567m234567p55s', '5p', { byTsumo: true });
    expect(names(r)).toEqual(expect.arrayContaining(['平和', '断么九', '門前清自摸和']));
    expect(r!.han).toBe(3);
  });

  it('三色同順 + 役牌(白)', () => {
    const r = evalHand('99m234m234p234s555z', '9m');
    expect(names(r)).toEqual(expect.arrayContaining(['三色同順', '役牌(白)']));
  });
});

describe('刻子系', () => {
  it('対々和 + 三暗刻（ロンで1つ明刻化）', () => {
    const r = evalHand('111m333p555s999m77z', '9m'); // ロン、9mシャンポン
    expect(names(r)).toEqual(expect.arrayContaining(['対々和', '三暗刻']));
    expect(r!.yakumanTotal).toBe(0);
  });

  it('四暗刻（同形をツモ→役満）', () => {
    const r = evalHand('111m333p555s999m77z', '9m', { byTsumo: true });
    expect(ymNames(r)).toContain('四暗刻');
    expect(r!.yakumanTotal).toBeGreaterThanOrEqual(1);
  });
});

describe('一色・大物手', () => {
  it('清一色（役満でない）', () => {
    const r = evalHand('123456789m123m99m', '3m');
    expect(names(r)).toContain('清一色');
    expect(r!.yakumanTotal).toBe(0);
  });

  it('大三元', () => {
    const r = evalHand('555666777z234m99p', '9p');
    expect(ymNames(r)).toContain('大三元');
  });
});

describe('ドラ集計', () => {
  it('表ドラ・赤ドラを翻に加算する', () => {
    const r = evalHand('234567m234567p55s', '5p', {
      byTsumo: true,
      doraIndicators: [tile('4m')], // ドラ=5m（手に1枚）
      redCount: 1,
    });
    expect(r!.dora.dora).toBe(1);
    expect(r!.dora.aka).toBe(1);
    // 平和1+断么九1+ツモ1 + ドラ1 + 赤1 = 5
    expect(r!.han).toBe(5);
  });

  it('裏ドラはリーチ時のみ数える', () => {
    const base = { byTsumo: true, uraIndicators: [tile('4m')] };
    expect(evalHand('234567m234567p55s', '5p', base)!.dora.ura).toBe(0);
    expect(evalHand('234567m234567p55s', '5p', { ...base, riichi: true })!.dora.ura).toBe(1);
  });
});

describe('鳴き手', () => {
  it('喰い三色 + 役牌（鳴き三色同順は1翻に喰い下がり）', () => {
    // 手の内 11枚（234m234p234s + 99m雀頭）＋ 發ポン1面子。winは2m。
    const r = evaluateWin({
      concealed: parseHand('234m234p234s99m'),
      called: [{ type: 'pon', tile: tile('6z') }], // 發ポン
      winTile: tile('2m'),
      byTsumo: false,
      seatWind: 'E',
      roundWind: 'E',
    });
    expect(names(r)).toEqual(expect.arrayContaining(['三色同順', '役牌(發)']));
    expect(r!.yaku.find((y) => y.name === '三色同順')!.han).toBe(1); // 喰い下がり
    expect(r!.menzen).toBe(false);
  });
});
