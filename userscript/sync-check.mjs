// 校验油猴脚本里的链接规则与扩展的单一来源一致。
// 用法：node userscript/sync-check.mjs
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const sharedPath = path.join(root, 'src/shared/link-patterns.js');
const userscriptPath = path.join(root, 'userscript/github-accelerator.user.js');

const patternRe = /'(\*:\/\/[^']+)'/g;

function patternsOf(source) {
  return [...source.matchAll(patternRe)].map((m) => m[1]);
}

const shared = patternsOf(fs.readFileSync(sharedPath, 'utf8'));
const userscript = patternsOf(fs.readFileSync(userscriptPath, 'utf8'));

const same =
  shared.length === userscript.length &&
  shared.every((value, index) => value === userscript[index]);

if (same) {
  console.log(`OK: 链接规则一致（${shared.length} 条）`);
  process.exit(0);
}

console.error('FAIL: 油猴脚本的链接规则与 src/shared/link-patterns.js 不一致');
console.error('  src/shared/link-patterns.js:');
for (const line of shared) console.error('    ' + line);
console.error('  userscript/github-accelerator.user.js:');
for (const line of userscript) console.error('    ' + line);
console.error('请同步两处规则后重试。');
process.exit(1);
