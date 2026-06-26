import { describe, it, expect } from 'vitest';
import { parseHand } from '../src/tiles.js';
import { waits } from '../src/win.js';
import { ukeire } from '../src/ai.js';

const zeros = () => new Array(34).fill(0);

/** vis に手牌自身だけを与えたときの受け入れ枚数 = Σ(待ち種ごとの残り 4-自分の枚数)。 */
const ukeFromHand = (s: string, melds = 0) => {
  const counts = parseHand(s);
  return ukeire(counts, melds, counts.slice());
};

describe('ukeire — 受け入れ枚数', () => {
  it('聴牌の受け入れは waits（待ち種）の残り枚数の合計に一致する', () => {
    const cases: [string, number][] = [
      ['123m456m789m99p13s', 0], // 2s 単独嵌張
      ['234m234p234s78m55z', 0], // 6m/9m 両面
      ['123m456m789m99p11s', 0], // シャンポン 9p/1s 相当
    ];
    for (const [h, melds] of cases) {
      const counts = parseHand(h);
      const ws = waits(counts, melds);
      const expected = ws.reduce((sum, k) => sum + (4 - counts[k]), 0);
      expect(ukeire(counts, melds, counts.slice())).toBe(expected);
      expect(expected).toBeGreaterThan(0);
    }
  });

  it('両面(6m/9m)待ちは vis=空なら 4+4=8 枚', () => {
    const counts = parseHand('234m234p234s78m55z');
    expect(ukeire(counts, 0, zeros())).toBe(8);
  });

  it('和了済み(向聴-1)からは受け入れなし', () => {
    const counts = parseHand('123456789m123p11s');
    expect(ukeire(counts, 0, counts.slice())).toBe(0);
  });

  it('場に見えた牌の分だけ受け入れが減る', () => {
    const counts = parseHand('234m234p234s78m55z'); // 6m/9m 待ち
    const vis = counts.slice();
    vis[5] = 3; // 6m が場に3枚見えている → 残り1
    vis[8] = 4; // 9m は全部見えている → 残り0
    expect(ukeire(counts, 0, vis)).toBe(1);
  });

  it('1向聴は受け入れが正で、聴牌へ進める牌を数える', () => {
    expect(ukeFromHand('123m456m99p13s57s7z')).toBeGreaterThan(0);
  });
});
