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
  tilesToCounts,
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

export type { RuleConfig } from './rule.js';
export { DEFAULT_RULE } from './rule.js';

export type {
  MeldKind,
  ParsedMeld,
  Decomposition,
  WaitType,
  Interpretation,
} from './decompose.js';
export { decomposeStandard, interpretWaits } from './decompose.js';

export type { CalledMeld, WinInput, YakuHan, WinResult } from './yaku.js';
export { evaluateWin } from './yaku.js';

export type { FuInput } from './fu.js';
export { computeFu } from './fu.js';

export type { ScoreResult, PaymentBreakdown } from './score.js';
export { basePoints, computeScore } from './score.js';

export type {
  Meld,
  PlayerState,
  Phase,
  GameResult,
  PendingCall,
  GameState,
  Action,
  GameEvent,
  RankEntry,
  NextHand,
} from './game.js';
export {
  createGame,
  legalActions,
  apply,
  seatWindOf,
  finalRanking,
  startNextHand,
} from './game.js';

export { chooseAction } from './ai.js';
