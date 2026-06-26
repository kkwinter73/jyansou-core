import { describe, it, expect } from 'vitest';
import { createGame, type GameState } from '../src/game.js';
import type { Tile } from '../src/types.js';
import { chooseAction } from '../src/ai.js';

/** kind 配列から一意 id を振った Tile 配列を作る（赤なし）。 */
function tiles(kinds: number[]): Tile[] {
  return kinds.map((kind, i) => ({ kind, red: false, id: 100 + i }));
}

/** 指定席を「14枚・打牌局面」にした状態を作る（他フィールドは createGame の既定を流用）。 */
function discardState(seat: 0 | 1 | 2 | 3, hand: number[], doraIndicator: number): GameState {
  const s = structuredClone(createGame(1));
  s.phase = 'discard';
  s.turn = seat;
  s.hands[seat].concealed = tiles(hand);
  s.hands[seat].melds = [];
  s.drawnTile = s.hands[seat].concealed[s.hands[seat].concealed.length - 1];
  s.doraIndicators = tiles([doraIndicator]);
  s.riichi = [false, false, false, false];
  return s;
}

describe('chooseAction — 打牌の打点タイブレーク', () => {
  it('受け入れが同じ孤立牌の三択では、ドラを残して非ドラを切る', () => {
    // 789m 789p 789s + 中(33)対子 ではなく白(31)対子。孤立牌は 1m(0)/1p(9)/1s(18)。
    // 3面子+対子+孤立3枚で1向聴。1m/1p/1s は別スートの孤立終端で受け入れ対称。
    // ドラ表示 9m(8) → ドラは 1m(0)。CPU は 1m を残すはず。
    const hand = [6, 7, 8, 15, 16, 17, 24, 25, 26, 31, 31, 0, 9, 18];
    const s = discardState(0, hand, 8);
    const a = chooseAction(s, 0);
    expect(a.type).toBe('discard');
    if (a.type === 'discard') {
      expect(a.tile.kind).not.toBe(0); // ドラ(1m)は切らない
      expect([9, 18]).toContain(a.tile.kind); // 非ドラの孤立牌(1p/1s)を切る
    }
  });

  it('ドラ表示を変えれば残す牌も変わる（1p をドラにすると 1p を残す）', () => {
    // ドラ表示 9p(17) → ドラ 1p(9)。CPU は 1p を残し 1m/1s を切る。
    const hand = [6, 7, 8, 15, 16, 17, 24, 25, 26, 31, 31, 0, 9, 18];
    const s = discardState(0, hand, 17);
    const a = chooseAction(s, 0);
    expect(a.type).toBe('discard');
    if (a.type === 'discard') {
      expect(a.tile.kind).not.toBe(9); // ドラ(1p)は切らない
      expect([0, 18]).toContain(a.tile.kind);
    }
  });
});
