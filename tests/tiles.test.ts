import { describe, it, expect } from 'vitest';
import {
  suitOf,
  numberOf,
  isYaochu,
  isHonor,
  parseHand,
  countsToString,
  totalTiles,
} from '../src/tiles.js';

describe('tile helpers', () => {
  it('suitOf', () => {
    expect(suitOf(0)).toBe('m'); // 1m
    expect(suitOf(8)).toBe('m'); // 9m
    expect(suitOf(9)).toBe('p'); // 1p
    expect(suitOf(18)).toBe('s'); // 1s
    expect(suitOf(27)).toBe('z'); // 東
    expect(suitOf(33)).toBe('z'); // 中
  });

  it('numberOf', () => {
    expect(numberOf(0)).toBe(1);
    expect(numberOf(8)).toBe(9);
    expect(numberOf(9)).toBe(1);
    expect(numberOf(27)).toBe(1); // 東=1z
    expect(numberOf(33)).toBe(7); // 中=7z
  });

  it('isYaochu / isHonor', () => {
    expect(isYaochu(0)).toBe(true); // 1m
    expect(isYaochu(8)).toBe(true); // 9m
    expect(isYaochu(4)).toBe(false); // 5m
    expect(isHonor(27)).toBe(true);
    expect(isYaochu(31)).toBe(true); // 白
  });
});

describe('parseHand / countsToString', () => {
  it('parses suited and honors', () => {
    const c = parseHand('123m456p11s'); // 3+3+2 = 8 tiles
    expect(totalTiles(c)).toBe(8);
    expect(c[0]).toBe(1); // 1m
    expect(c[1]).toBe(1); // 2m
    expect(c[9 + 3]).toBe(1); // 4p
    expect(c[18]).toBe(2); // 1s pair
  });

  it('round-trips through countsToString', () => {
    const s = '19m19p19s1234567z';
    expect(countsToString(parseHand(s))).toBe(s);
  });

  it('treats 0 as red five', () => {
    expect(parseHand('0m')[4]).toBe(1); // 0m -> 5m (kind 4)
  });

  it('rejects bad input', () => {
    expect(() => parseHand('12')).toThrow();
    expect(() => parseHand('8z')).toThrow();
  });
});
