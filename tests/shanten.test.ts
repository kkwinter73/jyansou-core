import { describe, it, expect } from 'vitest';
import { parseHand } from '../src/tiles.js';
import { shanten } from '../src/shanten.js';

const sh = (s: string, melds = 0) => shanten(parseHand(s), melds);

describe('shanten — 標準形', () => {
  it('和了形は -1', () => {
    expect(sh('123456789m123p11s')).toBe(-1);
    expect(sh('111m234m567m99p234s')).toBe(-1);
  });
  it('聴牌は 0', () => {
    expect(sh('123456789m123p1s')).toBe(0); // 単騎
    expect(sh('123m456m789m99p13s')).toBe(0); // 嵌張(2s待ち)
    expect(sh('123m456m789m99p12s')).toBe(0); // 辺張(3s待ち)
  });
  it('1向聴', () => {
    expect(sh('123m456m789m1p3p1s3s')).toBe(1); // 3面子+2嵌張・雀頭なし
    expect(sh('123m456m99p13s57s7z')).toBe(1); // 2面子+雀頭+2嵌張+浮き
  });
});

describe('shanten — 七対子・国士', () => {
  it('七対子', () => {
    expect(sh('1133557799m1133p')).toBe(-1); // 7対子完成
    expect(sh('11223344556m67m')).toBe(0); // 6対子+2単 → 聴牌
    expect(sh('1122334455m678m')).toBe(0); // 123m123m678m+44m+55m のシャンポン聴牌（標準形が優先）
  });
  it('国士無双', () => {
    expect(sh('19m19p19s1234567z')).toBe(0); // 13面待ち聴牌
    expect(sh('119m19p19s123456z')).toBe(0); // 雀頭あり・1種欠け → 聴牌
    expect(sh('19m19p19s123456z5m')).toBe(1);
  });
});

describe('shanten — 副露あり', () => {
  it('1副露でも標準形を計算', () => {
    // 手の内10枚: 3面子+雀頭 で和了形（melds=1）
    expect(sh('123m456m789m99p', 1)).toBe(-1);
    expect(sh('123m456m789m9p', 1)).toBe(0); // 単騎聴牌
  });
});
