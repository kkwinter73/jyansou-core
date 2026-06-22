---
description: TypeScript 共通規約（core / web 共通）
appliesTo: "**/*.ts, **/*.tsx"
---

# TypeScript 規約（自己完結）

- `strict` 前提。`any` を避け、`unknown` + 絞り込みを使う。公開APIは明示的な型を書く。
- ドメインの識別子は型で守る（例: `Seat = 0|1|2|3`、`TileKind` は 0..33 のブランド付き数値が望ましい）。
- 例外より「結果型」を優先（ルール判定は `null`/結果オブジェクトで失敗を表す）。
- 副作用を持つ関数と純粋関数を混ぜない。`core` は純粋関数のみ（[core ルール](core.md)）。
- import は層をまたいで逆流させない（`core` → `web` 禁止。依存方向は architecture.md）。
- テストは Vitest。ロジックの分岐とリグレッションを `*.test.ts` で固定する。
