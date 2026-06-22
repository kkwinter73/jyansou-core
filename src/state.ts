// ゲーム状態の型。完全な GameState は core-domain-design.md §4 を参照。
// Phase 1 ではまず PRNG 状態と基本型を確定させ、局ループ実装で段階的に拡張する（ADR-0004）。

/** seed 可能PRNGの内部状態。GameState に内包して apply で持ち回る（ADR-0006 / 0007）。 */
export interface RngState {
  s: number; // mulberry32 の32bit状態
}

// NOTE: GameState / HandState / Meld / Action / GameEvent は game-flow-design.md と
// core-domain-design.md の契約に従い Phase 1 の局ループ実装時に追加する。
// ここに型だけ先行定義せず、実装と同時に入れることで「型はあるが中身が無い」状態を避ける。
