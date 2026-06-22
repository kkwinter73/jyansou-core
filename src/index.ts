// @jyansou/core 公開API。web/server はこの入口だけを使う（architecture.md の契約）。
// Phase 1: 牌・PRNG・和了形判定。Phase 2+ で legalActions/apply/evaluateWin を追加。
export type { Tile, TileKind, Suit, Seat, Wind, Counts } from './types.js';
export { NUM_KINDS, TILES_PER_KIND } from './types.js';
export type { RngState } from './state.js';

export {
  suitOf,
  numberOf,
  isHonor,
  isTerminalNumber,
  isYaochu,
  YAOCHU_KINDS,
  kindToString,
  countsToString,
  parseHand,
  totalTiles,
} from './tiles.js';

export { makeRng, nextRng, nextInt, shuffle } from './rng.js';

export {
  isStandardWin,
  isChiitoitsu,
  isKokushi,
  isWinningHand,
  waits,
  isTenpai,
} from './win.js';
