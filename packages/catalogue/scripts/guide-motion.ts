/**
 * `npm run guide:motion -- <id>|--all [--json=<out>] [--compare=<baseline.json>] [--suggest] [--n=2400]`
 *
 * Prints the motion metrics for each guide (ADR 0015): whether every joint
 * moves in one seamless motion. Exit 1 when any hard or quality metric fails
 * its threshold (warnings never fail). Not part of `npm run check` yet: the
 * guides are re-timed against it first.
 *
 * `--json` writes every report (for a later `--compare`), `--compare` prints
 * before → after per metric, `--suggest` prints chord-length times for pass
 * keys (phases-mode guides).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { GuideSchema } from '../src/figure/guide-schema.ts';
import { measureMotion, motionReportOk, MOTION_SAMPLES, type MotionReport } from '../src/figure/motion-metrics.ts';
import { prepareGuide } from '../src/figure/pose.ts';
import { guideIds, loadGuideFile } from './lib/guides.ts';

const args = process.argv.slice(2);
const opt = (name: string): string | undefined => args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const ids = args.includes('--all') ? guideIds() : args.filter((a) => !a.startsWith('--'));
const n = Number(opt('n') ?? MOTION_SAMPLES);
const suggest = args.includes('--suggest');
const jsonOut = opt('json');
const comparePath = opt('compare');

if (ids.length === 0 || !Number.isInteger(n) || n < 200) {
  console.log('Usage: npm run guide:motion -- <id>|--all [--json=<out>] [--compare=<baseline.json>] [--suggest] [--n=2400]');
  process.exit(1);
}

const baseline: Record<string, MotionReport> = comparePath === undefined ? {} : (JSON.parse(readFileSync(comparePath, 'utf8')) as Record<string, MotionReport>);
const reports: Record<string, MotionReport> = {};
let failed = 0;

const pad = (s: string, w: number): string => (s.length >= w ? s : s + ' '.repeat(w - s.length));
const num = (x: number | null): string => (x === null ? 'n/a' : Math.abs(x) >= 100 ? x.toFixed(0) : Math.abs(x) >= 1 ? x.toFixed(2) : x.toFixed(4));

for (const id of ids) {
  const file = loadGuideFile(id);
  const parsed = GuideSchema.safeParse(file.raw);
  if (!parsed.success) {
    console.log(`\n${id}: schema error (run guide:check)`);
    failed += 1;
    continue;
  }
  const report = measureMotion(prepareGuide(parsed.data), { n });
  reports[id] = report;
  const ok = motionReportOk(report);
  if (!ok) failed += 1;
  const phases = report.phases.map((p) => `${p.from.toFixed(3)}–${p.to.toFixed(3)}`).join(', ');
  console.log(`\n${id}: ${ok ? 'PASS' : 'FAIL'} (${report.motion}${report.gait ? ', gait' : ''}; phases ${phases})`);
  const before = baseline[id];
  for (const m of report.metrics) {
    const result = m.ok ? 'PASS' : m.level === 'warn' ? 'WARN' : 'FAIL';
    const prev = before?.metrics.find((b) => b.id === m.id);
    const cmp = prev === undefined ? '' : `  [${num(prev.value)} → ${num(m.value)}]`;
    console.log(`  ${pad(m.id, 7)}${pad(m.name, 22)}${pad(result, 6)}${pad(m.limit, 26)}${m.where}${cmp}`);
  }
  if (suggest) {
    if (report.suggestions.length === 0) console.log('  (no pass keys to re-time: add "motion": "phases" and "pass": true on mid keys first)');
    for (const s of report.suggestions) {
      console.log(`  pass key ${s.key}${s.label === null ? '' : ` ${s.label}`}: t ${s.t.toFixed(4)} → ${s.suggested.toFixed(4)} (chord ${s.share.toFixed(2)})`);
    }
  }
}

console.log(`\n${ids.length - failed}/${ids.length} guides pass the motion thresholds.`);
if (jsonOut !== undefined) {
  writeFileSync(jsonOut, `${JSON.stringify(reports, null, 2)}\n`);
  console.log(`Wrote ${jsonOut}`);
}
if (failed > 0) process.exitCode = 1;
