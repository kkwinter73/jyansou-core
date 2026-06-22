#!/usr/bin/env node
// memory-guard (reminder / PreToolUse) — 個人メモリへの書き込み時に振り直しを促す。
// エージェント本体には「学んだら記憶せよ」という逆向きの常時指示があり得る。
// 横断知識か個人メモかは機械判定できない → block せず減速帯(speed-bump)を置く（guards.md）。
function readStdin() {
  return new Promise((res) => {
    let d = '';
    process.stdin.on('data', (c) => (d += c));
    process.stdin.on('end', () => res(d));
  });
}
const input = JSON.parse((await readStdin()) || '{}');
const p = input.tool_input?.file_path || '';
// 個人メモリの典型パス: ~/.claude/projects/<slug>/memory/ や */memory/*.md
if (!/[/\\](memory)[/\\]/.test(p) && !/[/\\]\.claude[/\\]projects[/\\]/.test(p)) process.exit(0);

const note =
  `[memory-guard] 個人メモリに書き込もうとしています。\n` +
  `その内容が「恒久・横断（複数リポ/他人が参照する）」なら、ここではなく docs-hub の\n` +
  `decisions/ または design/ に書いてください（ADR-0005 / SoTは1か所）。\n` +
  `このセッション限りの作業メモなら、そのまま続行して構いません。`;

process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', additionalContext: note } }));
