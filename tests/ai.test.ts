import { describe, it, expect } from 'vitest';
import { createGame, apply, legalActions, startNextHand, type GameState } from '../src/game.js';
import { chooseAction } from '../src/ai.js';

const conserved = (s: GameState) => s.scores.reduce((a, b) => a + b, 0) + s.riichiSticks * 1000;

/** 全席CPUで現在の局を終局まで進める。 */
function finishHand(start: GameState): GameState {
  let s = start;
  for (let guard = 0; guard < 400 && s.phase !== 'over'; guard++) {
    const seat = s.phase === 'afterDiscard' ? s.pendingRon[0] : s.turn;
    const action = chooseAction(s, seat);
    expect(legalActions(s, seat)).toContainEqual(action); // 必ず合法手
    s = apply(s, action).state;
  }
  return s;
}

describe('CPU 自己対戦', () => {
  it('多数のseedで終局し、合法手のみで進み、点数が保存される', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const s = finishHand(createGame(seed));
      expect(s.phase).toBe('over');
      expect(s.result).not.toBeNull();
      expect(conserved(s)).toBe(100000);
    }
  });

  it('複数局を startNextHand で繋いでも破綻しない', () => {
    let s = createGame(2024);
    for (let hand = 0; hand < 30; hand++) {
      s = finishHand(s);
      expect(s.phase).toBe('over');
      expect(conserved(s)).toBe(100000);
      const next = startNextHand(s);
      if (next.over) {
        expect(next.ranking).toHaveLength(4);
        return; // 終局
      }
      s = next.state;
    }
  });
});
