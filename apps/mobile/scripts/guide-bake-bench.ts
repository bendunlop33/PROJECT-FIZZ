/**
 * Off-device proxy for the guide bake cost (ADR 0014, G14): every bundled guide × every playback frame, `bakeFrame`
 * plus the app's whole-unit path text, reusing held frames as the player does. No Skia: parse and record time is not
 * included, and Node is not Hermes. Run with `--jitless` for the closest proxy:
 *
 *   node --jitless --import ./packages/catalogue/scripts/ts-hooks.ts apps/mobile/scripts/guide-bake-bench.ts [runs] [pt]
 *
 * Dev tooling only; not part of `npm run check` (timings vary by machine).
 */
import { bundledGuides } from '@fizz/catalogue';
import { bakeFrame, heldFrames, playbackTimes } from '@fizz/catalogue/figure';

import { opPathData } from '../src/guide/draw-plan';
import { buildHowToView, bundledHowToSources } from '../src/guide/how-to';

const runs = Number(process.argv[2] ?? 3);
const pt = Number(process.argv[3] ?? 348);
const src = bundledHowToSources();
const library = bundledGuides();

interface Row {
  key: string;
  frames: number;
  baked: number;
  ms: number[];
}
const rows: Row[] = [];
for (const key of library.keys) {
  const g = library.load(key);
  if (!g.ok) throw new Error(`${key} should load`);
  const times = playbackTimes(g.value.prepared.guide);
  const held = heldFrames(g.value.prepared, times);
  rows.push({ key, frames: times.length, baked: held.filter((j) => j < 0).length, ms: [] });
}

let sink = 0;
for (let r = 0; r < runs; r += 1) {
  for (const row of rows) {
    const g = library.load(row.key);
    if (!g.ok) continue;
    const view = buildHowToView({ name: row.key, catalogueKey: row.key }, src);
    const opts = { pt, muscles: view.guide?.muscles ?? null, definition: 'neutral' as const };
    const times = playbackTimes(g.value.prepared.guide);
    const held = heldFrames(g.value.prepared, times);
    const start = performance.now();
    times.forEach((t, i) => {
      if ((held[i] ?? -1) >= 0) return;
      for (const op of bakeFrame(g.value.prepared, g.value.camera, t, [], opts)) {
        if (op.kind === 'path') sink += opPathData(op).length;
      }
    });
    row.ms.push(performance.now() - start);
  }
}

const fmt = (n: number) => (n / 1000).toFixed(2);
console.log(`guide bake proxy: ${runs} runs, ${pt} pt, definition neutral, held frames reused, no Skia (${process.execArgv.includes('--jitless') ? 'jitless' : 'JIT on'})`);
for (const row of [...rows].sort((a, b) => Math.max(...b.ms) - Math.max(...a.ms))) {
  const per = row.ms.map((m) => (m / row.baked).toFixed(1)).join('/');
  console.log(`${row.key.padEnd(30)} ${String(row.frames).padStart(3)} frames (${row.baked} baked)  s: ${row.ms.map(fmt).join(' / ')}  max ${fmt(Math.max(...row.ms))}  ms/frame ${per}`);
}
if (sink < 0) console.log(sink);
