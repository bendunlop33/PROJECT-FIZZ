import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { nameKey, type MatchCandidate } from '@fizz/domain';
import type { WeightUnit } from '@fizz/schemas';

import type { ImportDraft } from '../src/import/import-service';
import type { AppServices } from '../src/services/app-services';
import { createHarness, setUpGym, type Harness } from './harness';

/**
 * Review round 7's names, end to end on SQLite through the services with the
 * real catalogue, in kg and lb, under the PM decision after review r7: no
 * group answer ever adds a bar weight, and no word in a name decides that a
 * bar is added or which. Under `Add new` → Barbell, `Choose…` and `Use
 * this`, none of these names gets a bar added without Ben's answer for that
 * exercise; with one, the bar added is the one shown for it (the matched
 * exercise's own, or the one he chose).
 */

const B2_HEADER = 'Date,Exercise,Category,Weight,Weight Unit,Reps,Distance,Distance Unit,Time,Comment';
const line = (date: string, name: string, value: number, unit: WeightUnit) => `${date},${name},Other,${String(value)},${unit === 'kg' ? 'kgs' : 'lbs'},8,,,,`;

let h: Harness;
let s: AppServices;
beforeEach(async () => {
  h = createHarness('2026-10-08T17:00:00.000Z');
  s = (await h.launch()).services;
  await setUpGym(h, s);
});
afterEach(async () => {
  await h.cleanup();
});

async function open(text: string): Promise<ImportDraft> {
  const r = await s.imports.open({ name: 'FitNotes_Export.csv', text });
  if (r.kind !== 'preview') throw new Error(r.kind);
  return r.draft;
}
async function step(d: ImportDraft, change: Parameters<AppServices['imports']['answer']>[2]): Promise<ImportDraft> {
  const r = await s.imports.answer(d.draftId, d.mappingVersion, change);
  if (!r.ok) throw new Error(r.reason);
  return r.draft;
}
async function stored(d: ImportDraft, op: string) {
  const r = await s.imports.commit(d.draftId, d.mappingVersion, op);
  if (!r.ok) throw new Error(r.reason);
  const job = await s.imports.job(r.jobId);
  if (!job) throw new Error('no job');
  return new Map(job.rows.flatMap((x) => (x.imported ? [[x.exerciseName, x.imported.load] as const] : [])));
}
function byKey(d: ImportDraft, key: string): MatchCandidate {
  const c = s.imports.searchExercises(d.draftId, '').find((x) => x.catalogueKey === key);
  if (!c) throw new Error(`no ${key} in the catalogue`);
  return c;
}

const TRAP_BARBELL = ['Hex Barbell Deadlift', 'Trap Barbell Shrug', 'Hex Barbell Shrug'] as const;
/** Names that say two bar kinds, or another bar than the exercise's, with the barbell exercise Ben chooses for each. */
const CHOSEN: readonly (readonly [string, string])[] = [
  ['EZ Barbell Curl', 'barbell-curl'],
  ['Barbell EZ Curl', 'barbell-curl'],
  ['EZ Barbell Skullcrusher', 'barbell-curl'],
  ['Olympic EZ Bar Curl', 'barbell-curl'],
  ['Close Grip EZ Barbell Bench', 'barbell-close-grip-bench-press'],
  ['Olympic Hex Bar Deadlift', 'barbell-deadlift'],
  ['Barbell Hex Bar Deadlift', 'barbell-deadlift'],
  ['Barbell Trap Bar Deadlift', 'barbell-deadlift'],
  ['Hex Barbell Deadlift', 'barbell-deadlift'],
  ['Trap Barbell Shrug', 'barbell-deadlift'],
];
const R7_NAMES: readonly string[] = [...new Set([...TRAP_BARBELL, ...CHOSEN.map(([n]) => n)])];

describe('review r7 names under the PM decision after r7: no bar is added without the exercise’s own answer', () => {
  for (const unit of ['kg', 'lb'] as const) {
    const olympic = unit === 'kg' ? 20 : 45;
    const trap = unit === 'kg' ? 25 : 55;

    it(`in ${unit}: Add new → Barbell: every name is stored as written; plates only for one adds the bar shown for it`, async () => {
      let d = await open([B2_HEADER, ...R7_NAMES.map((n) => line('2026-09-01', n, 100, unit))].join('\n'));
      for (const n of R7_NAMES) d = await step(d, { kind: 'name', key: nameKey(n), answer: { kind: 'new', equipment: 'barbell' } });
      // Every one is shown with the Olympic bar of the exercise Add new makes, never a bar read from its words.
      expect(d.analysis.total?.exercises.map((e) => [e.name, e.bar, e.barChosen, e.override])).toEqual(R7_NAMES.map((n) => [n, 'barbell', false, null]));
      d = await step(d, { kind: 'total', answer: 'total' });
      expect(d.analysis.ready).toBe(true);
      // Ben reads one as plates only and changes its bar to the trap bar: only that one changes.
      d = await step(d, { kind: 'total_override', key: nameKey('Hex Barbell Deadlift'), answer: 'plates_only' });
      d = await step(d, { kind: 'total_bar', key: nameKey('Hex Barbell Deadlift'), bar: 'trap_bar' });
      expect(d.analysis.ready).toBe(false);
      d = await step(d, { kind: 'bar_weight', bar: 'trap_bar', unit, value: trap });
      const loads = await stored(d, `op-r7-new-${unit}`);
      for (const n of R7_NAMES) expect(loads.get(n), n).toEqual({ value: n === 'Hex Barbell Deadlift' ? 100 + trap : 100, unit, convention: 'total' });
    });

    it(`in ${unit}: Choose…: every name is stored as written; plates only shows and adds the chosen exercise's own bar`, async () => {
      let d = await open([B2_HEADER, ...CHOSEN.map(([n]) => line('2026-09-01', n, 30, unit))].join('\n'));
      for (const [n, key] of CHOSEN) d = await step(d, { kind: 'name', key: nameKey(n), answer: { kind: 'exercise', exerciseId: byKey(d, key).exerciseId } });
      expect(d.analysis.total?.exercises.every((e) => e.reading === null && !e.barChosen)).toBe(true);
      d = await step(d, { kind: 'total', answer: 'total' });
      expect(d.analysis.ready).toBe(true);
      // `Olympic EZ Bar Curl` as plates only: the barbell curl's own bar, the Olympic bar, is what is shown and added.
      d = await step(d, { kind: 'total_override', key: nameKey('Olympic EZ Bar Curl'), answer: 'plates_only' });
      expect(d.analysis.total?.exercises.find((e) => e.name === 'Olympic EZ Bar Curl')).toMatchObject({ exerciseBar: 'barbell', bar: 'barbell', sample: { imported: 30 + olympic, platesOnly: 30 + olympic } });
      const loads = await stored(d, `op-r7-choose-${unit}`);
      for (const [n] of CHOSEN) expect(loads.get(n), n).toEqual({ value: n === 'Olympic EZ Bar Curl' ? 30 + olympic : 30, unit, convention: 'total' });
    });

    it(`in ${unit}: Choose… the trap-bar deadlift: its trap bar is shown for plates only and its own weight added`, async () => {
      let d = await open([B2_HEADER, line('2026-09-01', 'Hex Barbell Deadlift', 100, unit)].join('\n'));
      d = await step(d, { kind: 'name', key: nameKey('Hex Barbell Deadlift'), answer: { kind: 'exercise', exerciseId: byKey(d, 'trap-bar-deadlift').exerciseId } });
      d = await step(d, { kind: 'total', answer: 'total' });
      expect(d.analysis.total?.exercises[0]).toMatchObject({ bar: 'trap_bar', reading: 'total' });
      d = await step(d, { kind: 'total_override', key: nameKey('Hex Barbell Deadlift'), answer: 'plates_only' });
      d = await step(d, { kind: 'bar_weight', bar: 'trap_bar', unit, value: trap });
      expect(d.analysis.ready).toBe(true);
      expect((await stored(d, `op-r7-trap-${unit}`)).get('Hex Barbell Deadlift')).toEqual({ value: 100 + trap, unit, convention: 'total' });
    });

    it(`in ${unit}: Use this on every suggestion: nothing is stored differently from the file`, async () => {
      let d = await open([B2_HEADER, ...R7_NAMES.map((n) => line('2026-09-01', n, 30, unit))].join('\n'));
      for (const n of d.analysis.names.filter((x) => x.needsAnswer && x.match.exerciseId)) d = await step(d, { kind: 'name', key: n.key, answer: { kind: 'exercise', exerciseId: n.match.exerciseId ?? '' } });
      for (const n of d.analysis.names.filter((x) => x.needsAnswer)) d = await step(d, { kind: 'name', key: n.key, answer: { kind: 'skip' } });
      if (d.analysis.total) d = await step(d, { kind: 'total', answer: 'total' });
      for (const q of d.analysis.bodyweight) d = await step(d, { kind: 'bodyweight', key: q.key, answer: 'added' });
      if (d.analysis.perHand) d = await step(d, { kind: 'per_hand', answer: 'each' });
      for (const e of d.analysis.perHand?.exercises ?? []) if (e.reading === null) d = await step(d, { kind: 'per_hand_override', key: e.key, answer: 'one' });
      expect(d.analysis.ready).toBe(true);
      const loads = await stored(d, `op-r7-use-${unit}`);
      expect(loads.size).toBeGreaterThan(0);
      for (const [n, load] of loads) expect(load?.value, n).toBe(30);
    });
  }
});
