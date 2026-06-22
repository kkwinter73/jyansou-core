import { describe, it, expect } from 'vitest';
import { parseHand } from '../src/tiles.js';
import { isWinningHand, isChiitoitsu, isKokushi, waits, isTenpai } from '../src/win.js';

describe('isWinningHand — standard form (4 melds + pair)', () => {
  it('accepts a complete standard hand', () => {
    expect(isWinningHand(parseHand('123456789m123p11s'))).toBe(true);
  });
  it('accepts triplets + sequences + pair', () => {
    expect(isWinningHand(parseHand('111m234m567m99p234s'))).toBe(true);
  });
  it('rejects an incomplete hand', () => {
    expect(isWinningHand(parseHand('123456789m123p1s'))).toBe(false); // 13枚=未完成
  });
  it('rejects 14 tiles with no valid decomposition', () => {
    expect(isWinningHand(parseHand('123456789m1234p1s'))).toBe(false);
  });
});

describe('isWinningHand — special forms', () => {
  it('chiitoitsu (seven pairs)', () => {
    const c = parseHand('1133557799m1133p');
    expect(isChiitoitsu(c)).toBe(true);
    expect(isWinningHand(c)).toBe(true);
  });
  it('four-of-a-kind is NOT chiitoitsu', () => {
    expect(isChiitoitsu(parseHand('1111335577m1133p'))).toBe(false);
  });
  it('kokushi (thirteen orphans)', () => {
    const c = parseHand('119m19p19s1234567z'); // 1m が雀頭
    expect(isKokushi(c)).toBe(true);
    expect(isWinningHand(c)).toBe(true);
  });
  it('special forms require concealed (calledMelds=0)', () => {
    const c = parseHand('1133557799m1133p');
    expect(isWinningHand(c, 1)).toBe(false);
  });
});

describe('waits / tenpai', () => {
  it('tanki (single) wait', () => {
    expect(waits(parseHand('123456789m123p1s'))).toEqual([18]); // 1s 単騎
  });
  it('ryanmen (two-sided) wait', () => {
    // 123m456m789m + 23p + 11s雀頭 → 1p(9) / 4p(12) 待ち
    expect(waits(parseHand('123456789m23p11s')).sort((a, b) => a - b)).toEqual([9, 12]);
  });
  it('isTenpai', () => {
    expect(isTenpai(parseHand('123456789m23p11s'))).toBe(true);
    expect(isTenpai(parseHand('125578m349p13s47z'))).toBe(false);
  });
});
