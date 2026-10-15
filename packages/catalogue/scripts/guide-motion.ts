/**
 * `npm run guide:motion -- <id>…|--all [--fps=30|60] [--json[=<out>]] [--compare=<dir|baseline.json>] [--guides=<dir>] [--suggest] [--n=2400]`
 *
 * Prints the motion metrics for each guide (ADR 0015, ADR 0017): whether
 * every joint moves in one seamless motion. Exit 1 when any hard or quality
 * metric fails its threshold (warnings never fail). Not part of
 * `npm run check` yet: it joins once all 10 guides pass (ADR 0017).
 *
 * - `--fps`: bake rate the frame metrics use (default `PLAYBACK_FPS`).
 * - `--json`: print the reports as JSON instead of text; `--json=<out>` writes them to a file as well as printing the text.
 * - `--compare`: a baseline, printed as before → after per metric: a JSON file written by `--json=<out>`, or a folder of
 *   guides (`<dir>/<id>/guide.json`) measured the same way.
 * - `--guides`: measure the guides in another folder (`<dir>/<id>/guide.json`) instead of the catalogue's, e.g. a
 *   candidate written by the authoring solver, compared with `--compare=packages/catalogue/guides`.
 * - `--suggest`: chord-length times for pass keys (phases-mode guides) and,
 *   for `drive` guides, the pass-key root.y on the driver's line (D1).
 * - Per-guide allowances (a declared excursion, a relaxed limit) print under the metric they changed, with the reason.
 */
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { GuideSchema } from '../src/figure/guide-schema.ts';
import { measureMotion, motionReportOk, MOTION_SAMPLES, type MotionReport } from '../src/figure/motion-metrics.ts';
import { PLAYBACK_FPS } from '../src/figure/playback.ts';
import { prepareGuide } from '../src/figure/pose.ts';
import { guideIds, loadGuideFile } from './lib/guides.ts';

const USAGE = 'Usage: npm run guide:motion -- <id>…|--all [--fps=30|60] [--json[=<out>]] [--compare=<dir|baseline.json>] [--guides=<dir>] [--suggest] [--n=2400]';
const args = process.argv.slice(2);
const VALUED = ['fps', 'json', 'compare', 'guides', 'n'];
/** `--name=value` or `--name value` (for the options that take one). */
function opt(name: string): string | undefined {
  const eq = args.find((a) => a.startsWith(`--${name}=`));
  if (eq !== undefined) return eq.slice(name.length + 3);
  const i = args.indexOf(`--${name}`);
  const next = i >= 0 ? args[i + 1] : undefined;
  return name !== 'json' && next !== undefined && !next.startsWith('--') ? next : undefined;
}
const positional = args.filter((a, i) => !a.startsWith('--') && !VALUED.some((v) => v !== 'json' && args[i - 1] === `--${v}`));

const guidesDir = opt('guides');
const listDir = (dir: string): string[] =>
  readdirSync(dir)
    .filter((d) => !d.startsWith('_') && !d.startsWith('.') && existsSync(join(dir, d, 'guide.json')))
    .sort();
const ids = args.includes('--all') ? (guidesDir === undefined ? guideIds() : listDir(guidesDir)) : positional;
const n = Number(opt('n') ?? MOTION_SAMPLES);
const fps = Number(opt('fps') ?? PLAYBACK_FPS);
const suggest = args.includes('--suggest');
const jsonOnly = args.includes('--json');
const jsonOut = opt('json');
const comparePath = opt('compare');

if (ids.length === 0 || !Number.isInteger(n) || n < 200 || !Number.isInteger(fps) || fps < 10 || fps > 120) {
  console.log(USAGE);
  process.exit(1);
}

/** The raw guide.json for `id`, from `--guides` or the catalogue. */
function rawGuide(id: string, dir: string | undefined): unknown {
  if (dir === undefined) return loadGuideFile(id).raw;
  return JSON.parse(readFileSync(join(dir, id, 'guide.json'), 'utf8')) as unknown;
}

function measure(id: string, dir: string | undefined): MotionReport | null {
  const parsed = GuideSchema.safeParse(rawGuide(id, dir));
  return parsed.success ? measureMotion(prepareGuide(parsed.data), { n, fps }) : null;
}

let baseline: Record<string, MotionReport> = {};
if (comparePath !== undefined) {
  if (statSync(comparePath).isDirectory()) {
    const dir = resolve(comparePath);
    for (const id of ids) {
      const r = existsSync(join(dir, id, 'guide.json')) ? measure(id, dir) : null;
      if (r !== null) baseline[id] = r;
    }
  } else baseline = JSON.parse(readFileSync(comparePath, 'utf8')) as Record<string, MotionReport>;
}

const reports: Record<string, MotionReport> = {};
const log = (line: string): void => {
  if (!jsonOnly || jsonOut !== undefined) console.log(line);
};
let failed = 0;

const pad = (s: string, w: number): string => (s.length >= w ? s : s + ' '.repeat(w - s.length));
const num = (x: number | null): string => (x === null ? 'n/a' : Math.abs(x) >= 100 ? x.toFixed(0) : Math.abs(x) >= 1 ? x.toFixed(2) : x.toFixed(4));

for (const id of ids) {
  const report = measure(id, guidesDir);
  if (report === null) {
    log(`\n${id}: schema error (run guide:check)`);
    failed += 1;
    continue;
  }
  reports[id] = report;
  const ok = motionReportOk(report);
  if (!ok) failed += 1;
  const phases = report.phases.map((p) => `${p.from.toFixed(3)}–${p.to.toFixed(3)}`).join(', ');
  log(`\n${id}: ${ok ? 'PASS' : 'FAIL'} (${report.motion}${report.gait ? ', gait' : ''}; ${report.fps} fps; phases ${phases})`);
  const before = baseline[id];
  for (const m of report.metrics) {
    const result = m.ok ? 'PASS' : m.level === 'warn' ? 'WARN' : 'FAIL';
    const prev = before?.metrics.find((b) => b.id === m.id);
    const cmp = before === undefined ? '' : `  [${prev === undefined ? 'new' : num(prev.value)} → ${num(m.value)}]`;
    log(`  ${pad(m.id, 7)}${pad(m.name, 22)}${pad(result, 6)}${pad(m.limit, 30)}${m.where}${cmp}`);
    if (m.allowance !== undefined) log(`         allowance: ${m.allowance}`);
  }
  if (suggest) {
    if (report.suggestions.length === 0) log('  (no pass keys to re-time: add "motion": "phases" and "pass": true on mid keys first)');
    for (const s of report.suggestions) {
      log(`  pass key ${s.key}${s.label === null ? '' : ` ${s.label}`}: t ${s.t.toFixed(4)} → ${s.suggested.toFixed(4)} (chord ${s.share.toFixed(2)})`);
    }
    // Drive guides (E6): the root.y that puts each pass key's knee on its phase's stop-to-stop line (D1).
    for (const d of report.drive) {
      const y = d.suggestedRootY === null ? 'no solution' : d.suggestedRootY.toFixed(4);
      if (d.phi !== null && d.phiLine !== null) {
        const x = d.suggestedRootX === null ? 'no solution' : d.suggestedRootX.toFixed(4);
        log(`  drive key ${d.key}${d.label === null ? '' : ` ${d.label}`}: knee ${d.theta.toFixed(2)}°, shin ${d.phi.toFixed(2)}° (in step: ${d.phiLine.toFixed(2)}°), root ${d.rootX.toFixed(4)}, ${d.rootY.toFixed(4)} → ${x}, ${y}`);
        continue;
      }
      log(`  drive key ${d.key}${d.label === null ? '' : ` ${d.label}`}: knee ${d.theta.toFixed(2)}° (line ${d.line.toFixed(2)}°), root.y ${d.rootY.toFixed(4)} → ${y}`);
    }
  }
}

log(`\n${ids.length - failed}/${ids.length} guides pass the motion thresholds.`);
if (jsonOut !== undefined) {
  writeFileSync(jsonOut, `${JSON.stringify(reports, null, 2)}\n`);
  log(`Wrote ${jsonOut}`);
} else if (jsonOnly) console.log(JSON.stringify(reports, null, 2));
if (failed > 0) process.exitCode = 1;
