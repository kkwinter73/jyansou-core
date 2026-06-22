// ルール設定。既定値は ADR-0004 / yaku-scoring-design.md に準拠。
export interface RuleConfig {
  /** 喰いタンあり（鳴き断么九を認める）。 */
  kuitan: boolean;
  /** 赤ドラ枚数（各色5に何枚。0で赤なし）。Phase 2 では集計のみ参照。 */
  akaCount: number;
  /** ダブル役満を認めるか（Phase 3 の点数で本格適用。Phase 2 は倍数のみ）。 */
  doubleYakuman: boolean;
}

export const DEFAULT_RULE: RuleConfig = {
  kuitan: true,
  akaCount: 3,
  doubleYakuman: true,
};
