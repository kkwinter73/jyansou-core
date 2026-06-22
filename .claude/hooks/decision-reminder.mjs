#!/usr/bin/env node
// decision-reminder (reminder / PreToolUse) — decisions/ への書き込み時に採録基準を注入する。
// 「これは横断知識か、その場限りか」は機械判定できない → block せず注意文を渡す（guards.md）。
// 止めない: permissionDecision を設定せず additionalContext だけ返す。
function readStdin() {
  return new Promise((res) => {
    let d = '';
    process.stdin.on('data', (c) => (d += c));
    process.stdin.on('end', () => res(d));
  });
}
const input = JSON.parse((await readStdin()) || '{}');
const p = input.tool_input?.file_path || '';
if (!/[/\\]docs[/\\]decisions[/\\]/.test(p)) process.exit(0);

const note =
  `[decision-reminder] ADR(decisions/)を編集中です。載せる前に確認してください:\n` +
  `  1) 複数リポ/他人が参照する横断的な決定か？\n` +
  `  2) コード/スキーマ/Issue を見ても "なぜ" が復元できないか？（特に「あえてやらない」判断）\n` +
  `  3) リポを切り替えても同じことが言えるか？\n` +
  `どれかが No なら decisions/ ではなく リポ固有の docs/adr・設計書・コード・Issue へ。\n` +
  `各行は「決定を1文＋根拠リンク」だけにし、検証/実装詳細はリンク先へ（記録は薄く保つ）。\n` +
  `追加・改番したら docs-hub で \`node scripts/gen-decisions-index.mjs\` を実行。`;

process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', additionalContext: note } }));
