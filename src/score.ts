// 点数計算（Phase 3）。設計: yaku-scoring-design.md, ADR-0004。
// 切り上げ満貫なし（既定）。数え役満(13翻以上)は役満扱い(8000)。

const ceil100 = (x: number) => Math.ceil(x / 100) * 100;

/** 基本点。役満は 8000×倍数。満貫以上は固定。4翻以下は fu×2^(2+han)（満貫頭打ち）。 */
export function basePoints(han: number, fu: number, yakumanTotal: number): number {
  if (yakumanTotal > 0) return 8000 * yakumanTotal;
  if (han >= 13) return 8000; // 数え役満
  if (han >= 11) return 6000; // 三倍満
  if (han >= 8) return 4000; // 倍満
  if (han >= 6) return 3000; // 跳満
  if (han >= 5) return 2000; // 満貫
  return Math.min(fu * Math.pow(2, 2 + han), 2000); // 満貫頭打ち
}

export type PaymentBreakdown =
  | { type: 'ron'; from: number } // 放銃者の支払い（本場込み）
  | { type: 'tsumo'; fromEachNonDealer: number; fromDealer: number | null }; // 親和了は fromDealer=null

export interface ScoreResult {
  base: number;
  /** 和了者の獲得合計（手の点 + 本場 + 供託リーチ棒）。 */
  total: number;
  /** 供託（リーチ棒）の点（total に含む）。 */
  riichiSticks: number;
  payments: PaymentBreakdown;
}

/**
 * 点の動きを計算する。
 * @param isDealer 和了者が親か
 * @param honba 本場
 * @param riichiSticks 場の供託リーチ棒の本数
 */
export function computeScore(
  base: number,
  isDealer: boolean,
  byTsumo: boolean,
  honba: number,
  riichiSticks: number,
): ScoreResult {
  const sticks = riichiSticks * 1000;

  if (!byTsumo) {
    const mult = isDealer ? 6 : 4;
    const from = ceil100(base * mult) + 300 * honba;
    return { base, payments: { type: 'ron', from }, total: from + sticks, riichiSticks: sticks };
  }

  if (isDealer) {
    const each = ceil100(base * 2) + 100 * honba;
    return {
      base,
      payments: { type: 'tsumo', fromEachNonDealer: each, fromDealer: null },
      total: each * 3 + sticks,
      riichiSticks: sticks,
    };
  }

  const eachChild = ceil100(base * 1) + 100 * honba;
  const fromDealer = ceil100(base * 2) + 100 * honba;
  return {
    base,
    payments: { type: 'tsumo', fromEachNonDealer: eachChild, fromDealer },
    total: eachChild * 2 + fromDealer + sticks,
    riichiSticks: sticks,
  };
}
