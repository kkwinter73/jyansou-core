# core 作業ガイド（CLAUDE.md）

`core` = 麻雀エンジン（純粋ロジック）。牌・手牌・牌山・和了判定・役・点数・局進行。**DOM/React/ネットワーク非依存**。

## 最重要（インライン必須・毎回読む）

- **このリポは純粋関数のみ。** `react`/DOM/`fetch`/`localStorage`/`setTimeout` を使わない。`Math.random()` と `Date` を使わない（乱数は `RngState` 経由、ADR-0007）。状態は不変、遷移は `apply(state, action)` で（ADR-0006）。
- **担当リポ外（`../web`, `../docs-hub` 等）を書き換えない。** 読むのは可。必要なら Issue で引き継ぐ（ADR-0005）。scope-guard hook が物理的に拒否する。
- **恒久・横断の知識は個人メモリでなく `../docs-hub` の design/decisions へ。**

## 開発

```bash
npm install
npm test          # vitest
npm run typecheck # tsc --noEmit
```

公開APIは `src/index.ts`。`web`/`server` はここだけを使い、内部表現に依存しない。

## タスク種別 → 参照すべき横断ドキュメント

| やること | まず読む（docs-hub） |
|---|---|
| 牌/手牌/和了判定/待ち | `../docs-hub/docs/design/core-domain-design.md` |
| 役・翻・符・点数 | `../docs-hub/docs/design/yaku-scoring-design.md` |
| 局進行（ツモ/打牌/鳴き/リーチ/流局） | `../docs-hub/docs/design/game-flow-design.md` |
| リポ境界・公開API契約 | `../docs-hub/docs/design/architecture.md` |
| なぜこの設計か | `../docs-hub/docs/decisions-index.md` |
| このリポ内に閉じた設計判断 | `docs/adr/` |

## 実装フェーズ（ADR-0004）

Phase 1-3: 牌・PRNG・和了判定・役・符・点数（実装済み）→ Phase 4a: 局進行・鳴きなし完全ループ（実装済み）→ Phase 4b: **鳴き（チー/ポン/大明槓/暗槓/加槓）実装済み**（`game.ts`。`pendingCalls`/`callResponses` で優先順位 ロン>ポン/カン>チー を解決。嶺上ツモ・カンドラ・槍槓・喰い替え防止・開いた手の点数）→ 残り: 途中流局・流し満貫、リーチ中の暗槓（v1は不可）、CPUの鳴き思考（現状は鳴きを開始せずパス/ロンのみ）。
役・点数の取りこぼしは ADR ではなく `tests/` のテスト表で管理する。既定: 切り上げ満貫なし・数え役満あり（ADR-0004）。`apply` は不変・純粋（ADR-0006）。状態複製は `structuredClone`（globals.d.ts で型補完）。

CPU は `ai.ts` の `chooseAction(state, seat)`（戦略であってルールでないため必須APIと分離。v1は簡易ヒューリスティック）。
