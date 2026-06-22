#!/usr/bin/env node
// scope-guard (block / PreToolUse) — 担当リポ外への書き込みを拒否する。
// ADR-0005「1セッション=1担当リポ」の物理的裏打ち（docs-hub/docs/dev-environment/guards.md）。
//
// 型の選定: 編集先パスは機械的に確実判定できる → block が適切。
// 対象は file_path を持つ編集ツールのみ。Bash のコマンド文字列からの書き込み検出は
// false-negative が多く「効かないガード」になるため、あえて対象にしない（guards.md の原則4）。
//
// 例外許可: リポ直下の `.claude/cross-repo-allowlist`（1行1パス、空行/# はコメント）に
//           列挙された隣接リポへの書き込みだけ通す。
import { readFileSync, existsSync, realpathSync } from 'node:fs';
import { resolve, join } from 'node:path';

const TOOLS = new Set(['Write', 'Edit', 'MultiEdit', 'NotebookEdit']);

function readStdin() {
  return new Promise((res) => {
    let d = '';
    process.stdin.on('data', (c) => (d += c));
    process.stdin.on('end', () => res(d));
  });
}
function emit(obj) {
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', ...obj } }));
  process.exit(0);
}
function real(p) { try { return realpathSync(p); } catch { return resolve(p); } }
function isInside(child, parent) {
  const c = real(child), p = real(parent);
  return c === p || c.startsWith(p.endsWith('/') ? p : p + '/');
}

const input = JSON.parse((await readStdin()) || '{}');
if (!TOOLS.has(input.tool_name)) process.exit(0); // 対象外ツールは素通り

const repoRoot = process.env.CLAUDE_PROJECT_DIR || input.cwd || process.cwd();
const filePath = input.tool_input?.file_path || input.tool_input?.notebook_path;
if (!filePath) process.exit(0); // パス不明なら判定不能 → 通常フローへ

if (isInside(filePath, repoRoot)) process.exit(0); // 担当リポ内 → OK

// allowlist 判定
const allowlistPath = join(repoRoot, '.claude', 'cross-repo-allowlist');
if (existsSync(allowlistPath)) {
  const allowed = readFileSync(allowlistPath, 'utf8')
    .split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
  for (const entry of allowed) {
    const base = resolve(repoRoot, entry); // 親からの相対 (../core 等) を解決
    if (isInside(filePath, base)) process.exit(0);
  }
}

emit({
  permissionDecision: 'deny',
  permissionDecisionReason:
    `[scope-guard] 担当リポ外への書き込みを拒否しました。\n` +
    `  編集先: ${real(filePath)}\n  担当リポ: ${real(repoRoot)}\n` +
    `1セッション=1担当リポ (ADR-0005)。他リポの変更が必要なら、ここで書かず Issue を立てて引き継いでください。\n` +
    `所有関係のある隣接リポなら .claude/cross-repo-allowlist に追記してください。`,
});
