import { describe, it, expect } from 'vitest';
import { createGame, type GameState } from '../src/game.js';
import type { Tile, Seat } from '../src/types.js';
import { chooseAction } from '../src/ai.js';

let nextId = 200;
function tiles(kinds: number[]): Tile[] {
  return kinds.map((kind) => ({ kind, red: false, id: nextId++ }));
}
const t = (kind: number): Tile => ({ kind, red: false, id: nextId++ });

interface Pending {
  pon?: boolean;
  minkan?: boolean;
  chi?: [Tile, Tile][];
}

/** 指定席を afterDiscard（鳴き応答）局面にした状態を作る。discarder が discardKind を切った想定。 */
function afterDiscard(
  seat: Seat,
  concealed: number[],
  discardKind: number,
  pending: Pending,
  opts: { dora?: number; riichiSeat?: Seat } = {},
): GameState {
  const s = structuredClone(createGame(1));
  const discarder = ((seat + 3) % 4) as Seat; // 上家が切った想定（チー可能な位置）
  s.phase = 'afterDiscard';
  s.hands[seat].concealed = tiles(concealed);
  s.hands[seat].melds = [];
  s.lastDiscard = { seat: discarder, tile: t(discardKind) };
  s.pendingCalls = [
    { seat, ron: false, pon: !!pending.pon, minkan: !!pending.minkan, chi: pending.chi ?? [] },
  ];
  s.callResponses = {};
  s.riichi = [false, false, false, false];
  if (opts.riichiSeat !== undefined) s.riichi[opts.riichiSeat] = true;
  if (opts.dora !== undefined) s.doraIndicators = tiles([opts.dora]);
  return s;
}

const HAKU = 31; // 白（役牌）

describe('chooseAction — 鳴き判断', () => {
  it('役牌のアンコは大明槓もポンもせず温存する（パス）', () => {
    // 白アンコ(3枚)を持ち、4枚目が出た → minkan/pon 可能だが鳴かない。
    const concealed = [HAKU, HAKU, HAKU, 1, 2, 3, 4, 5, 6, 10, 11, 12, 20];
    const s = afterDiscard(1, concealed, HAKU, { pon: true, minkan: true });
    expect(chooseAction(s, 1)).toEqual({ type: 'pass', seat: 1 });
  });

  it('役牌の対子は、向聴が進むならポンする', () => {
    // 白対子 + 234m 567m 9s9s 1p3p 9m。ポンで2向聴→聴牌方向に前進。
    const concealed = [HAKU, HAKU, 1, 2, 3, 4, 5, 6, 26, 26, 9, 11, 8];
    const s = afterDiscard(1, concealed, HAKU, { pon: true });
    expect(chooseAction(s, 1)).toEqual({ type: 'pon', seat: 1 });
  });

  it('他家リーチ中は、聴牌にならない役牌ポンは見送る（守備優先）', () => {
    // ポンしても1向聴止まりの手。リーチ者がいればパス、いなければポン。
    const concealed = [HAKU, HAKU, 1, 2, 3, 4, 5, 6, 26, 26, 9, 13, 8];
    const open = afterDiscard(1, concealed, HAKU, { pon: true });
    expect(chooseAction(open, 1)).toEqual({ type: 'pon', seat: 1 });

    const threatened = afterDiscard(1, concealed, HAKU, { pon: true }, { riichiSeat: 0 });
    expect(chooseAction(threatened, 1)).toEqual({ type: 'pass', seat: 1 });
  });

  it('タンヤオ志向で聴牌に到達するチーは鳴く', () => {
    // 全簡牌。567p 234s 8m8m 3p4p 8s + 5m6m。7m(6) を 5m6m でチー → 聴牌(タンヤオ)。
    const concealed = [13, 14, 15, 19, 20, 21, 7, 7, 11, 12, 4, 5, 25];
    const chi: [Tile, Tile][] = [[t(4), t(5)]]; // 5m,6m
    const s = afterDiscard(1, concealed, 6, { chi });
    const a = chooseAction(s, 1);
    expect(a.type).toBe('chi');
  });
});
