// ルール設定。既定値は ADR-0004 / yaku-scoring-design.md に準拠。
export interface RuleConfig {
  /** 喰いタンあり（鳴き断么九を認める）。 */
  kuitan: boolean;
  /** 赤ドラ枚数（各色5に何枚。0で赤なし）。Phase 2 では集計のみ参照。 */
  akaCount: number;
  /** ダブル役満を認めるか（Phase 3 の点数で本格適用。Phase 2 は倍数のみ）。 */
  doubleYakuman: boolean;
  /** 対局形式。'tonpuu'=東風戦（東のみ）/ 'hanchan'=半荘（東南）。終局位置の判定に使う（game-flow-design.md）。 */
  gameLength: 'tonpuu' | 'hanchan';
  /** アガリやめ／テンパイやめ。オーラスで親が連荘条件を満たし、かつ親がトップなら終局する。false なら延長戦に入る。 */
  agariyame: boolean;
  /** トビ終了の閾値。点数がこの値を下回った者が出たら終局。null でトビなし。 */
  tobiThreshold: number | null;
}

export const DEFAULT_RULE: RuleConfig = {
  kuitan: true,
  akaCount: 3,
  doubleYakuman: true,
  gameLength: 'hanchan',
  agariyame: true,
  tobiThreshold: 0,
};
