/**
 * `npm run guide:check <id>|--all [--verify]`: run the automatic guide checks
 * (research §5.6) and write each guide's `meta.json`. With `--verify` (used by
 * `npm run check`), a stale meta.json is an error instead of being rewritten.
 * Exit 1 if any guide fails. Without `--verify` it also refreshes the app's
 * guide index (`src/generated/guide-files.ts`, ADR 0013) when it is stale;
 * `catalogue:validate` fails on a stale index.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { checkGuide, CHECK_FPS, type GuideCheckReport } from '../src/figure/checks.ts';
import type { GuideMeta } from '../src/figure/guide-schema.ts';
import { guideIds, guideIndexSource, loadGuideFile } from './lib/guides.ts';
import { GUIDE_INDEX_FILE } from './lib/paths.ts';

const args = process.argv.slice(2);
const verify = args.includes('--verify');
const ids = args.includes('--all') ? guideIds() : args.filter((a) => !a.startsWith('--'));
if (ids.length === 0) {
  console.log(args.includes('--all') ? 'No guides yet.' : 'Usage: npm run guide:check -- <id>|--all [--verify]');
  process.exitCode = args.includes('--all') ? 0 : 1;
}

function metaOf(id: string, bytes: number, report: GuideCheckReport): GuideMeta | null {
  const g = report.guide;
  if (g === null) return null;
  return {
    schemaVersion: 1,
    exerciseKey: id,
    format: 'fizz-figure-guide@1',
    rig: g.rig,
    view: g.view,
    durationMs: g.durationMs,
    keyframes: g.keyframes.length,
    renderFps: CHECK_FPS,
    frames: Math.round((g.durationMs / 1000) * CHECK_FPS),
    guideBytes: bytes,
    attribution: 'Original figure animation made for Fizz; no third-party media.',
    reviewStatus: g.review.status,
    check: { status: report.ok ? 'pass' : 'fail', failed: report.items.filter((i) => !i.ok).map((i) => i.id), warnings: report.items.filter((i) => i.ok && i.warn === true).map((i) => i.id) },
    focus: report.focus,
  };
}

let failed = 0;
for (const id of ids) {
  const file = loadGuideFile(id);
  const report = checkGuide({ raw: file.raw, bytes: file.bytes, dirKey: id, entry: file.entry });
  console.log(`\n${id}: ${report.ok ? 'PASS' : 'FAIL'} (${report.frames} frames sampled at ${CHECK_FPS} fps + keyframes)`);
  for (const item of report.items) console.log(`  ${item.ok ? (item.warn === true ? 'warn' : 'ok  ') : 'FAIL'} ${item.id.padEnd(16)} ${item.detail}`);
  if (!report.ok) failed += 1;

  const meta = metaOf(id, file.bytes, report);
  if (meta !== null) {
    const metaPath = join(file.dir, 'meta.json');
    const text = `${JSON.stringify(meta, null, 2)}\n`;
    const current = existsSync(metaPath) ? readFileSync(metaPath, 'utf8') : null;
    if (current !== text) {
      if (verify) {
        console.log(`  FAIL meta.json         stale; run \`npm run guide:check ${id}\``);
        failed += 1;
      } else {
        writeFileSync(metaPath, text);
        console.log('  wrote meta.json');
      }
    }
  }
}
if (ids.length > 0) console.log(`\n${ids.length - failed}/${ids.length} guides pass.`);
if (!verify && ids.length > 0) {
  const index = guideIndexSource(guideIds());
  if (!existsSync(GUIDE_INDEX_FILE) || readFileSync(GUIDE_INDEX_FILE, 'utf8') !== index) {
    writeFileSync(GUIDE_INDEX_FILE, index);
    console.log('Wrote src/generated/guide-files.ts (the guides the app bundles).');
  }
}
if (failed > 0) process.exitCode = 1;
