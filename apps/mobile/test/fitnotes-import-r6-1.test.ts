import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { nameKey } from '@fizz/domain';
import type { WeightUnit } from '@fizz/schemas';

import type { ImportDraft } from '../src/import/import-service';
import { bodyweightOptions, totalOptions } from '../src/import/views';
import type { AppServices } from '../src/services/app-services';
import { createHarness, setUpGym, type Harness } from './harness';

/**
 * Review round 6.1, end to end on SQLite through the services, in kg and lb.
 * - B1 (as decided after review r7): `Add new` → Barbell never takes a bar
 *   from the name; a bar is added only by Ben's answer for one exercise,
 *   on the bar he chose, never the Olympic bar unless he chose it.
 * - S1: an assisted name mapped to a weight-stack exercise (`Choose…` or
 *   `Add new`) asks how its values read, with nothing selected.
 * - S2: a positive value among negative ones in the file isn't read as
 *   assistance, whatever was imported before.
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

describe('review r6.1 B1, as decided after review r7: Add new → Barbell never takes a bar from the name; Ben chooses it per exercise', () => {
  const NAMES = ['EZ Bar Upright Row', 'Trap Bar Jump Squat', 'Upright Row (EZ Bar)', 'EZ Bar Close Grip Press', 'Trap Bar Farmers Walk'] as const;
  const barOf = (n: string) => (/ez/i.test(n) ? 'ez_bar' : 'trap_bar');

  for (const unit of ['kg', 'lb'] as const) {
    it(`in ${unit}: the group answer stores every name as written; plates only on the bar Ben chose adds that bar's own weight, never the Olympic bar's`, async () => {
      const olympic = unit === 'kg' ? 20 : 45;
      const weight = { ez_bar: unit === 'kg' ? 8 : 18, trap_bar: unit === 'kg' ? 27 : 60 } as const;
      const extra = ['Barbell Upright Row', 'Dumbbell Thing Press', 'Smith Upright Row'];
      const all = [...NAMES, ...extra];
      const raw = (i: number) => 30 + 2 * i;
      let d = await open([B2, ...all.map((n, i) => line('2026-09-01', n, raw(i), unit))].join('\n'));
      for (const n of all) d = await step(d, { kind: 'name', key: nameKey(n), answer: { kind: 'new', equipment: 'barbell' } });
      d = await step(d, { kind: 'total', answer: 'total' });

      // Every name is read by the group answer as written; each row shows the Olympic bar of the exercise Add new makes, nothing selected.
      const rows = totalOptions(d.analysis, 'en-GB')?.platesOnly.rows ?? [];
      expect(rows.map((r) => [r.title, r.bars.find((b) => b.selected)?.label, r.choices.some((c) => c.selected)])).toEqual(all.map((n) => [n, 'Olympic bar', false]));
      expect(d.analysis.ready).toBe(true);

      // Ben chooses plates only for the EZ and trap names, and their bars.
      for (const n of NAMES) {
        d = await step(d, { kind: 'total_override', key: nameKey(n), answer: 'plates_only' });
        d = await step(d, { kind: 'total_bar', key: nameKey(n), bar: barOf(n) });
      }
      const q = d.analysis.total;
      expect(q?.bars.find((b) => b.bar === 'ez_bar')?.missing).toEqual([unit]);
      expect(q?.bars.find((b) => b.bar === 'trap_bar')?.missing).toEqual([unit]);
      for (const bar of ['ez_bar', 'trap_bar'] as const) d = await step(d, { kind: 'bar_weight', bar, unit, value: weight[bar] });
      expect(d.analysis.ready).toBe(true);
      // What the barbell screen shows is the conversion with the bar's own weight.
      for (const [i, n] of NAMES.entries()) expect(d.analysis.total?.exercises.find((e) => e.name === n)?.sample?.imported, n).toBe(raw(i) + weight[barOf(n)]);

      const job = await commit(d, `op-b1-${unit}`);
      const stored = new Map(job.rows.flatMap((r) => (r.imported ? [[r.exerciseName, r.imported.load] as const] : [])));
      NAMES.forEach((n, i) => {
        const load = stored.get(n);
        const why = `${n}: ${String(raw(i))} ${unit} stored as ${JSON.stringify(load)}`;
        expect(load?.unit, why).toBe(unit);
        expect(load?.value, why).not.toBe(raw(i) + olympic);
      });
      for (const [i, n] of NAMES.entries()) expect(stored.get(n)?.value, n).toBe(raw(i) + weight[barOf(n)]);
      // No answer of its own: as written, whatever the name says.
      expect(stored.get('Barbell Upright Row')?.value).toBe(raw(5));
      expect(stored.get('Dumbbell Thing Press')?.value).toBe(raw(6));
      expect(stored.get('Smith Upright Row')?.value).toBe(raw(7));

      // The exercise is made with the bar Ben chose, so later logging uses that bar too; the others with the Olympic bar.
      const again = await open([B2, ...all.map((n, i) => line('2026-09-02', n, raw(i), unit))].join('\n'), 'second.csv');
      for (const n of all) {
        const res = again.analysis.names.find((x) => x.name === n)?.resolution;
        const c = res?.kind === 'exercise' ? s.imports.candidate(again.draftId, res.exercise.exerciseId) : null;
        expect(c?.compatibleEquipment, n).toEqual([(NAMES as readonly string[]).includes(n) ? barOf(n) : 'barbell']);
      }
      // And Ben's answers are filled in, labelled as his answer last time.
      const next = totalOptions(again.analysis, 'en-GB')?.platesOnly.rows ?? [];
      for (const n of NAMES) expect(next.find((r) => r.title === n)?.remembered, n).toBe('Your answer last time');
      for (const n of extra) expect(next.find((r) => r.title === n)?.remembered ?? null, n).toBeNull();
    });
  }
});

describe('review r6.1 S1: an assisted name mapped to a weight stack is asked, never stored as a load unasked', () => {
  for (const unit of ['kg', 'lb'] as const) {
    it(`in ${unit}: Choose… a stack exercise and Add new → Weight stack both ask, with nothing selected`, async () => {
      let d = await open([B2, line('2026-09-01', 'Assisted Shoulder Press Machine', 40, unit), line('2026-09-01', 'Assisted Lat Pull Machine', 35, unit), line('2026-09-02', 'Assisted Lat Pull Machine', 30, unit)].join('\n'));
      const stack = s.imports.searchExercises(d.draftId, 'shoulder press').find((c) => c.defaultLoadConvention === 'stack');
      if (!stack) throw new Error('no stack shoulder press in the catalogue');
      d = await step(d, { kind: 'name', key: nameKey('Assisted Shoulder Press Machine'), answer: { kind: 'exercise', exerciseId: stack.exerciseId } });
      d = await step(d, { kind: 'name', key: nameKey('Assisted Lat Pull Machine'), answer: { kind: 'new', equipment: 'weight_stack' } });
      expect(d.analysis.ready).toBe(false);
      expect(d.analysis.bodyweight.map((q) => [q.name, q.loadAs, q.answer])).toEqual([
        ['Assisted Shoulder Press Machine', 'stack', null],
        ['Assisted Lat Pull Machine', 'stack', null],
      ]);
      const opts = bodyweightOptions(d.analysis, nameKey('Assisted Lat Pull Machine'));
      expect(opts?.options.map((o) => [o.label, o.selected])).toEqual([
        ['Weight on the stack', false],
        ['Assistance from a machine', false],
      ]);
      expect(d.analysis.fates.map((f) => f.result)).toEqual(['pending', 'pending', 'pending']);

      d = await step(d, { kind: 'bodyweight', key: nameKey('Assisted Shoulder Press Machine'), answer: 'added' });
      d = await step(d, { kind: 'bodyweight', key: nameKey('Assisted Lat Pull Machine'), answer: 'assistance' });
      const job = await commit(d, `op-s1-${unit}`);
      expect(job.rows.map((r) => [r.exerciseName, r.imported?.load ?? null])).toEqual([
        ['Assisted Shoulder Press Machine', { value: 40, unit, convention: 'stack' }],
        ['Assisted Lat Pull Machine', { value: 35, unit, convention: 'assistance' }],
        ['Assisted Lat Pull Machine', { value: 30, unit, convention: 'assistance' }],
      ]);
    });
  }
});

describe('review r6.1 S2: the mixed-sign rule reads the whole file, whatever was imported before', () => {
  const name = 'Assisted Dip';
  const outcome = async (draft: ImportDraft, op: string) => {
    let d = draft;
    const n = d.analysis.names.find((x) => x.name === name);
    if (n?.needsAnswer) d = await step(d, { kind: 'name', key: n.key, answer: { kind: 'new', equipment: 'assisted_stack' } });
    for (const q of d.analysis.bodyweight) d = await step(d, { kind: 'bodyweight', key: q.key, answer: 'assistance' });
    const job = await commit(d, op);
    return job.rows.filter((r) => r.localDate === '2026-09-20').map((r) => [r.result, r.imported?.load ?? null]);
  };

  it('in one file: the 10 among −30 is unreadable', async () => {
    const d = await open([B2, line('2026-09-01', name, -30, 'kg'), line('2026-09-20', name, 10, 'kg')].join('\n'));
    expect(await outcome(d, 'op-one')).toEqual([['unreadable', null]]);
  });

  it('across two imports (a later full export): the 10 is still unreadable, never 10 kg of assistance', async () => {
    const first = await open([B2, line('2026-09-01', name, -30, 'kg')].join('\n'), 'first.csv');
    expect((await outcome(first, 'op-a')).length).toBe(0);
    const later = await open([B2, line('2026-09-01', name, -30, 'kg'), line('2026-09-20', name, 10, 'kg'), line('2026-09-27', 'Push Up', 0, 'kg')].join('\n'), 'later.csv');
    expect(later.analysis.fates[0]?.result).toBe('skipped_duplicate');
    expect(await outcome(later, 'op-b')).toEqual([['unreadable', null]]);
  });
});
