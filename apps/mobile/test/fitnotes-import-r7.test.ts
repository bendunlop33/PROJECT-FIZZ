import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { nameKey, type MatchCandidate } from '@fizz/domain';
import type { WeightUnit } from '@fizz/schemas';

import type { ImportDraft } from '../src/import/import-service';
import type { AppServices } from '../src/services/app-services';
import { createHarness, setUpGym, type Harness } from './harness';

/**
 * Review round 7, end to end on SQLite through the services with the real
 * catalogue, in kg and lb, with "Plates only" for the group:
 * - B1: `Hex Barbell …` / `Trap Barbell …` name the trap bar, never the
 *   Olympic bar, under `Add new` → Barbell, `Use this` and `Choose…`.
 * - B2: a name that says two bar kinds (or `EZ Barbell …` chosen as a
 *   barbell exercise) is asked on its own under `Choose…` and `Use this`,
 *   the same rule `Add new` uses.
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
/** Names that say two bar kinds, or `EZ Barbell`, with the barbell exercise Ben chooses for each. */
const NOT_THE_OLYMPIC_BAR: readonly (readonly [string, string])[] = [
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

describe('review r7 B1: Hex/Trap Barbell names never get the Olympic bar', () => {
  for (const unit of ['kg', 'lb'] as const) {
    it(`in ${unit}: Add new → Barbell reads the trap bar, whose own weight is added`, async () => {
      const trap = unit === 'kg' ? 25 : 55;
      let d = await open([B2_HEADER, ...TRAP_BARBELL.map((n) => line('2026-09-01', n, 100, unit))].join('\n'));
      for (const n of TRAP_BARBELL) d = await step(d, { kind: 'name', key: nameKey(n), answer: { kind: 'new', equipment: 'barbell' } });
      d = await step(d, { kind: 'total', answer: 'plates_only' });
      expect(d.analysis.total?.exercises.map((e) => [e.name, e.known])).toEqual(TRAP_BARBELL.map((n) => [n, true]));
      expect(d.analysis.total?.bars.filter((b) => b.needed).map((b) => b.bar)).toEqual(['trap_bar']);
      expect(d.analysis.ready).toBe(false);
      d = await step(d, { kind: 'bar_weight', bar: 'trap_bar', unit, value: trap });
      expect(d.analysis.ready).toBe(true);
      const loads = await stored(d, `op-r7-b1-${unit}`);
      for (const n of TRAP_BARBELL) expect(loads.get(n), n).toEqual({ value: 100 + trap, unit, convention: 'total' });
    });

    it(`in ${unit}: Choose… the trap-bar deadlift reads the trap bar`, async () => {
      const trap = unit === 'kg' ? 25 : 55;
      let d = await open([B2_HEADER, line('2026-09-01', 'Hex Barbell Deadlift', 100, unit)].join('\n'));
      d = await step(d, { kind: 'name', key: nameKey('Hex Barbell Deadlift'), answer: { kind: 'exercise', exerciseId: byKey(d, 'trap-bar-deadlift').exerciseId } });
      d = await step(d, { kind: 'total', answer: 'plates_only' });
      d = await step(d, { kind: 'bar_weight', bar: 'trap_bar', unit, value: trap });
      expect(d.analysis.ready).toBe(true);
      expect((await stored(d, `op-r7-b1-trap-${unit}`)).get('Hex Barbell Deadlift')).toEqual({ value: 100 + trap, unit, convention: 'total' });
    });
  }
});

describe('review r7 B2: Choose… and Use this follow the Add new rule for names that say another or a second bar', () => {
  for (const unit of ['kg', 'lb'] as const) {
    it(`in ${unit}: Choose… a barbell exercise is asked on its own; "Total" stores the value as entered`, async () => {
      const names = NOT_THE_OLYMPIC_BAR.map(([n]) => n);
      let d = await open([B2_HEADER, ...names.map((n) => line('2026-09-01', n, 30, unit))].join('\n'));
      for (const [n, key] of NOT_THE_OLYMPIC_BAR) d = await step(d, { kind: 'name', key: nameKey(n), answer: { kind: 'exercise', exerciseId: byKey(d, key).exerciseId } });
      d = await step(d, { kind: 'total', answer: 'plates_only' });
      expect(d.analysis.total?.exercises.filter((e) => e.known).map((e) => e.name)).toEqual([]);
      expect(d.analysis.total?.exercises.filter((e) => e.reading === null).map((e) => e.name)).toEqual(names);
      expect(d.analysis.ready).toBe(false);
      for (const n of names) d = await step(d, { kind: 'total_override', key: nameKey(n), answer: 'total' });
      expect(d.analysis.ready).toBe(true);
      const loads = await stored(d, `op-r7-b2-choose-${unit}`);
      for (const n of names) expect(loads.get(n), n).toEqual({ value: 30, unit, convention: 'total' });
    });

    it(`in ${unit}: Use this on a suggestion never gives the Olympic bar`, async () => {
      const names = NOT_THE_OLYMPIC_BAR.map(([n]) => n);
      let d = await open([B2_HEADER, ...names.map((n) => line('2026-09-01', n, 30, unit))].join('\n'));
      for (const n of d.analysis.names.filter((x) => x.needsAnswer && x.match.exerciseId)) d = await step(d, { kind: 'name', key: n.key, answer: { kind: 'exercise', exerciseId: n.match.exerciseId ?? '' } });
      d = await step(d, { kind: 'total', answer: 'plates_only' });
      const suggestedBarbell = (d.analysis.total?.exercises ?? []).filter((e) => names.includes(e.name));
      // The suggestion follows the bar the name says; a second bar word leaves the bar asked.
      const resolved = (n: string) => {
        const r = d.analysis.names.find((x) => x.name === n)?.resolution;
        return r?.kind === 'exercise' ? [r.exercise.bar, r.exercise.barKnown] : null;
      };
      expect(names.map((n) => [n, resolved(n)])).toEqual([
        ['EZ Barbell Curl', ['ez_bar', true]],
        ['Barbell EZ Curl', null],
        ['EZ Barbell Skullcrusher', ['ez_bar', true]],
        ['Olympic EZ Bar Curl', ['ez_bar', false]],
        ['Close Grip EZ Barbell Bench', null],
        ['Olympic Hex Bar Deadlift', ['trap_bar', false]],
        ['Barbell Hex Bar Deadlift', ['trap_bar', false]],
        ['Barbell Trap Bar Deadlift', ['trap_bar', false]],
        ['Hex Barbell Deadlift', ['trap_bar', true]],
        ['Trap Barbell Shrug', null],
      ]);
      for (const e of suggestedBarbell) {
        const res = d.analysis.names.find((x) => x.name === e.name)?.resolution;
        if (res?.kind === 'exercise' && res.exercise.bar === 'barbell') expect(e.known, e.name).toBe(false);
      }
      for (const e of suggestedBarbell) if (e.reading === null) d = await step(d, { kind: 'total_override', key: nameKey(e.name), answer: 'total' });
      for (const b of d.analysis.total?.bars ?? []) for (const u of b.missing) d = await step(d, { kind: 'bar_weight', bar: b.bar, unit: u, value: u === 'kg' ? 10 : 22 });
      for (const n of d.analysis.names.filter((x) => x.needsAnswer)) d = await step(d, { kind: 'name', key: n.key, answer: { kind: 'skip' } });
      expect(d.analysis.ready).toBe(true);
      const olympic = unit === 'kg' ? 20 : 45;
      const loads = await stored(d, `op-r7-b2-use-${unit}`);
      for (const [n, load] of loads) if (names.includes(n)) expect(load?.value, n).not.toBe(30 + olympic);
      expect(loads.get('Close Grip EZ Barbell Bench') ?? null, 'Close Grip EZ Barbell Bench').not.toEqual({ value: 30 + olympic, unit, convention: 'total' });
    });
  }
});
