// Lint in chunks (2 Nov): type-aware ESLint over the whole repo in one process ran out of memory on the CI runner
// (5 GB heap). Each chunk gets its own process, so the peak is one package's type program, not the whole repo's.
// Same config and rules as `eslint .`; extra args (e.g. --fix) pass through.
import { spawnSync } from 'node:child_process';
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const dirs = (p) => readdirSync(p).filter((n) => n !== 'node_modules' && statSync(join(p, n)).isDirectory()).map((n) => join(p, n));
const mobile = 'apps/mobile';
const mobileDirs = dirs(mobile).filter((d) => !/\/(ios|android|\.expo)$/.test(d));
const chunks = [...dirs('packages'), ...mobileDirs, ...dirs('scripts')];
// Everything not in a chunk above (root files, apps/mobile's own files): one last run that ignores the chunks.
const rest = ['.', ...chunks.flatMap((c) => ['--ignore-pattern', `${c}/**`])];

const extra = process.argv.slice(2);
let failed = false;
for (const args of [...chunks.map((c) => [c]), rest]) {
  const r = spawnSync(process.execPath, ['--max-old-space-size=5120', 'node_modules/eslint/bin/eslint.js', '--no-warn-ignored', ...args, ...extra], { stdio: 'inherit' });
  if (r.status !== 0) {
    failed = true;
    console.error(`lint failed in: ${args[0] === '.' ? 'root files' : args[0]}`);
  }
}
process.exit(failed ? 1 : 0);
