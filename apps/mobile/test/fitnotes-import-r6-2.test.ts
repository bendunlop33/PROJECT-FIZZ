import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { nameKey } from '@fizz/domain';
import type { WeightUnit } from '@fizz/schemas';

import type { ImportDraft } from '../src/import/import-service';
import { bodyweightOptions, totalOptions } from '../src/import/views';
import type { AppServices } from '../src/services/app-services';
import { createHarness, setUpGym, type Harness } from './harness';

/**
 * Review round 6.2, end to end on SQLite through the services, in kg and lb.
 * - B1 (as decided after review r7): `Add new` → Barbell never gets a bar
 *   from the group answer, whatever the name says; "Plates only" is chosen
 *   per exercise from a list that shows its bar and conversion.
 * - N1: the sign-split answer on a stack exercise says "on the stack".
 * - N2: an assisted name on a stack exercise whose values are all 0 is
 *   stored as bodyweight, never a 0 stack load.
 * - N4: re-mapping a name so its question means something else clears the
 *   answer.
 */

const B2 = 'Date,Exercise,Category,Weight,Weight Unit,Reps,Distance,Distance Unit,Time,Comment';
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

async function open(text: string, name = 'FitNotes_Export.csv'): Promise<ImportDraft> {
  const r = await s.imports.open({ name, text });
  if (r.kind !== 'preview') throw new Error(r.kind);
  return r.draft;
}
async function step(d: ImportDraft, change: Parameters<AppServices['imports']['answer']>[2]): Promise<ImportDraft> {
  const r = await s.imports.answer(d.draftId, d.mappingVersion, change);
  if (!r.ok) throw new Error(r.reason);
  return r.draft;
}
async function commit(d: ImportDraft, op: string) {
  const r = await s.imports.commit(d.draftId, d.mappingVersion, op);
  if (!r.ok) throw new Error(r.reason);
  const job = await s.imports.job(r.jobId);
  if (!job) throw new Error('no job');
  return job;
}

describe('review r6.2 B1: Add new → Barbell never gives the Olympic bar to a name that doesn’t say it', () => {
  const ASKED = [
    'E-Z Bar Curl',
    'Curl Bar Curl',
    'Hex Deadlift',
    'Trap Deadlift',
    'Safety Squat Bar Squat',
    'SSB Squat',
    'Cambered Bar Bench Press',
    'Swiss Bar Press',
    'Football Bar Press',
    'Multi Grip Bar Press',
    'Buffalo Bar Squat',
    'Axle Press',
    'Log Press',
    'Yoke Walk',
    'Landmine Press',
  ] as const;
  const SAID = ['Barbell Upright Row', 'BB Shrug', 'Olympic Bar Good Morning'] as const;

  for (const unit of ['kg', 'lb'] as const) {
    it(`in ${unit}: no name gets a bar from the group answer, whatever it says; each is listed with its bar and conversion, nothing selected (PM decision after review r7)`, async () => {
      const olympic = unit === 'kg' ? 20 : 45;
      const all = [...ASKED, ...SAID];
      const raw = (i: number) => 40 + 2 * i;
      let d = await open([B2, ...all.map((n, i) => line('2026-09-01', n, raw(i), unit))].join('\n'));
      for (const n of all) d = await step(d, { kind: 'name', key: nameKey(n), answer: { kind: 'new', equipment: 'barbell' } });
      expect(d.analysis.total).toMatchObject({ grouped: all.length, needsGroup: true });
      const view = totalOptions(d.analysis, 'en-GB');
      expect(view?.options.map((o) => o.label)).toEqual(['Total as written']);
      const rows = view?.platesOnly.rows ?? [];
      expect(rows.map((r) => r.title)).toEqual(all);
      rows.forEach((r, i) => {
        expect(r.choices.some((c) => c.selected), r.title).toBe(false);
        expect(r.choices.map((c) => c.label), r.title).toEqual(['Total as written', 'Plates only']);
        expect(r.conversion.replaceAll(' ', ' '), r.title).toBe(`If plates only: ${String(raw(i))} ${unit} → ${String(raw(i) + olympic)} ${unit} total (plates + ${String(olympic)} ${unit} bar)`);
      });

      d = await step(d, { kind: 'total', answer: 'total' });
      expect(d.analysis.ready).toBe(true);
      const job = await commit(d, `op-r62-b1-${unit}`);
      const stored = new Map(job.rows.flatMap((r) => (r.imported ? [[r.exerciseName, r.imported.load] as const] : [])));
      all.forEach((n, i) => {
        expect(stored.get(n), n).toEqual({ value: raw(i), unit, convention: 'total' });
      });

      // A later import of the same names: the group answer still reads them; nothing is pre-selected per exercise.
      const again = await open([B2, ...all.map((n, i) => line('2026-09-08', n, raw(i), unit))].join('\n'), 'second.csv');
      expect(again.analysis.total?.exercises.filter((e) => e.override === null && e.reading === null).map((e) => e.name)).toEqual(all);
    });
  }
});

describe('review r6.2 N1, N2, N4: assisted names on a stack exercise', () => {
  for (const unit of ['kg', 'lb'] as const) {
    it(`in ${unit}: the sign split says "on the stack" and stores positive values as stack (N1)`, async () => {
      let d = await open([B2, line('2026-09-01', 'Assisted Lat Pull Machine', -20, unit), line('2026-09-02', 'Assisted Lat Pull Machine', 40, unit)].join('\n'));
      const key = nameKey('Assisted Lat Pull Machine');
      d = await step(d, { kind: 'name', key, answer: { kind: 'new', equipment: 'weight_stack' } });
      const split = bodyweightOptions(d.analysis, key)?.options.find((o) => o.value === 'split');
      expect([split?.label, split?.detail, split?.selected]).toEqual(['Negative = assistance, positive = on the stack', '-20 is read as 20 assistance; 40 as 40 on the stack', false]);
      d = await step(d, { kind: 'bodyweight', key, answer: 'split' });
      const job = await commit(d, `op-n1-${unit}`);
      expect(job.rows.map((r) => r.imported?.load ?? null)).toEqual([
        { value: 20, unit, convention: 'assistance' },
        { value: 40, unit, convention: 'stack' },
      ]);
    });

    it(`in ${unit}: values all 0 are stored as bodyweight with no load, never a 0 stack load (N2)`, async () => {
      let d = await open([B2, line('2026-09-01', 'Assisted Lat Pull Machine', 0, unit)].join('\n'));
      d = await step(d, { kind: 'name', key: nameKey('Assisted Lat Pull Machine'), answer: { kind: 'new', equipment: 'weight_stack' } });
      expect(d.analysis.ready).toBe(true);
      const job = await commit(d, `op-n2-${unit}`);
      expect(job.rows.map((r) => [r.result, r.imported?.load ?? null])).toEqual([['imported', null]]);
    });

    it(`in ${unit}: re-mapping a name so its question means something else clears the answer (N4)`, async () => {
      const name = 'Assisted Lat Pull Machine';
      const key = nameKey(name);
      let d = await open([B2, line('2026-09-01', name, 35, unit)].join('\n'));
      d = await step(d, { kind: 'name', key, answer: { kind: 'new', equipment: 'weight_stack' } });
      d = await step(d, { kind: 'bodyweight', key, answer: 'added' });
      expect(d.analysis.ready).toBe(true);
      d = await step(d, { kind: 'name', key, answer: { kind: 'new', equipment: 'bodyweight_station' } });
      expect(d.analysis.bodyweight.map((q) => [q.loadAs, q.answer])).toEqual([[null, null]]);
      expect(bodyweightOptions(d.analysis, key)?.options.some((o) => o.selected)).toBe(false);
      expect(d.analysis.ready).toBe(false);
      // Mapping to the same meaning keeps the answer.
      d = await step(d, { kind: 'bodyweight', key, answer: 'added' });
      d = await step(d, { kind: 'name', key, answer: { kind: 'new', equipment: 'bodyweight_station' } });
      expect(d.analysis.bodyweight.map((q) => q.answer)).toEqual(['added']);
    });
  }
});
