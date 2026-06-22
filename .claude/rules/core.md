---
description: core リポの純粋性と決定論を守るためのルール（ADR-0002 / 0006 / 0007）
appliesTo: core リポの src/**
---

# core 実装ルール（自己完結）

`core` は麻雀ルールの純粋ロジック。**副作用・環境依存を持ち込まない**。

- `react` / DOM (`document`,`window`) / `fetch` / `localStorage` / `setTimeout` を import・使用しない。
- `Math.random()` と `Date.now()` / `new Date()` を使わない。乱数は引数で受け取る seed 可能PRNG（`RngState`）から取り、PRNG状態は `GameState` に内包して持ち回る（ADR-0007）。
- ゲーム状態は不変。状態を破壊的に変更しない。遷移は `apply(state, action) -> { state, events }` の純粋関数で表す（ADR-0006）。
- 非合法な操作は例外を投げず、状態を変えずに理由付きイベントで返す。`legalActions` が合法手だけを列挙する。
- 公開APIは `architecture.md` の契約に従う。`web`/`server` は core の内部表現に依存しない。
- 牌・手牌・和了判定の表現は `core-domain-design.md`、役/点数は `yaku-scoring-design.md`、進行は `game-flow-design.md` を唯一の参照源とする。
