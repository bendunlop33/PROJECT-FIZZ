import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { nameKey, type MatchCandidate } from '@fizz/domain';
import type { WeightUnit } from '@fizz/schemas';

import type { ImportDraft } from '../src/import/import-service';
import { totalOptions } from '../src/import/views';
import type { AppServices } from '../src/services/app-services';
import { createHarness, setUpGym, type Harness } from './harness';

/**
 * Review r8, end to end on SQLite through the services with the real
 * catalogue: a remembered barbell answer is filled in only when it is
 * exactly what this import would do (same exercise, bar and bar weight), in
 * kg and lb (B1, B2); a re-map in the same preview clears a "plates only"
 * whose bar changed (S1); a bar is only chosen for "plates only" (S2); and a
 * job paused with a group "plates only" by an earlier build isn't continued
 * (S3).
 */

const B2_HEADER = 'Date,Exercise,Category,Weight,Weight Unit,Reps,Distance,Distance Unit,Time,Comment';
const line = (date: string, name: string, value: number, unit: WeightUnit) => `${date},${name},Other,${String(value)},${unit === 'kg' ? 'kgs' : 'lbs'},8,,,,`;
const file = (date: string, value: number, unit: WeightUnit, name = 'Thing') => [B2_HEADER, line(date, name, value, unit)].join('\n');
const THING = nameKey('Thing');

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
async function commit(d: ImportDraft, op: string): Promise<{ jobId: string; loads: Map<string, unknown> }> {
  const r = await s.imports.commit(d.draftId, d.mappingVersion, op);
  if (!r.ok) throw new Error(r.reason);
  const job = await s.imports.job(r.jobId);
  if (!job) throw new Error('no job');
  return { jobId: r.jobId, loads: new Map(job.rows.flatMap((x) => (x.imported ? [[x.exerciseName, x.imported.load] as const] : []))) };
}
function byKey(d: ImportDraft, key: string): MatchCandidate {
  const c = s.imports.searchExercises(d.draftId, '').find((x) => x.catalogueKey === key);
  if (!c) throw new Error(`no ${key} in the catalogue`);
  return c;
}
const row = (d: ImportDraft) => totalOptions(d.analysis, 'en-GB')?.platesOnly.rows.find((r) => r.key === THING);
const thing = (d: ImportDraft) => d.analysis.total?.exercises.find((e) => e.key === THING);

/** Import A: "Thing" → Choose… Bench press, Plates only, with this Olympic bar weight. */
async function importA(unit: WeightUnit, bar: number, value = 60): Promise<string> {
  let d = await open(file('2026-09-01', value, unit), 'a.csv');
  d = await step(d, { kind: 'name', key: THING, answer: { kind: 'exercise', exerciseId: byKey(d, 'barbell-bench-press').exerciseId } });
  d = await step(d, { kind: 'total_override', key: THING, answer: 'plates_only' });
  d = await step(d, { kind: 'bar_weight', bar: 'barbell', unit, value: bar });
  const a = await commit(d, `op-a-${unit}-${String(bar)}`);
  expect(a.loads.get('Thing')).toEqual({ value: value + bar, unit, convention: 'total' });
  return a.jobId;
}

describe('review r8 B1: a remembered "plates only" is filled in only with the bar weight it was given with', () => {
  it('kg: A with a 15 kg bar stores 60 as 75; B (20 kg default) is not filled in, shows last time, and stores nothing unasked', async () => {
    await importA('kg', 15);
    let d = await open(file('2026-10-01', 60, 'kg'), 'b.csv');
    expect(thing(d)).toMatchObject({ exerciseName: 'Bench press', override: null, reading: null, rememberedFits: false });
    expect(d.analysis.ready).toBe(false);
    expect(row(d)?.remembered).toBeNull();
    expect(row(d)?.lastTime?.replace(/\u00a0/g, ' ')).toBe('Last time: plates only + 15 kg Olympic bar. Not filled in: the bar or its weight is different now.');
    // Ben sets the bar back to 15 kg: it fits again, but is still his tap to make.
    d = await step(d, { kind: 'bar_weight', bar: 'barbell', unit: 'kg', value: 15 });
    expect(thing(d)).toMatchObject({ override: null, rememberedFits: true });
    expect(row(d)?.lastTime).toBeNull();
    d = await step(d, { kind: 'total_override', key: THING, answer: 'plates_only' });
    expect(row(d)?.remembered).toBe('Your answer last time');
    expect((await commit(d, 'op-b')).loads.get('Thing')).toEqual({ value: 75, unit: 'kg', convention: 'total' });
  });

  for (const [unit, bar] of [['kg', 20], ['lb', 45]] as const) {
    it(`${unit}: the same bar weight (${String(bar)} ${unit}) is filled in, labelled, and stores the same as last time`, async () => {
      await importA(unit, bar, 100);
      const d = await open(file('2026-10-01', 100, unit), 'b.csv');
      expect(thing(d)).toMatchObject({ override: 'plates_only', rememberedFits: true });
      expect(row(d)?.remembered).toBe('Your answer last time');
      expect(d.analysis.ready).toBe(true);
      expect((await commit(d, `op-b-${unit}`)).loads.get('Thing')).toEqual({ value: 100 + bar, unit, convention: 'total' });
    });
  }

  for (const [given, next] of [['kg', 'lb'], ['lb', 'kg']] as const) {
    it(`${given} → ${next}: a plates-only answer given in ${given} is never filled in for a file in ${next}`, async () => {
      await importA(given, given === 'kg' ? 20 : 45);
      const d = await open(file('2026-10-01', 100, next), 'b.csv');
      expect(thing(d)).toMatchObject({ override: null, reading: null, rememberedFits: false });
      expect(d.analysis.ready).toBe(false);
      expect(d.analysis.fates.map((f) => f.result)).toEqual(['pending']);
    });
  }
});

describe('review r8 B2 and S1: a "plates only" never follows the name to another exercise or bar', () => {
  it('B: "Thing" re-mapped to Trap-bar deadlift drops the filled-in answer and asks; nothing is stored with the trap bar unasked', async () => {
    await importA('kg', 20);
    let d = await open(file('2026-10-01', 60, 'kg'), 'b.csv');
    expect(thing(d)).toMatchObject({ override: 'plates_only', rememberedFits: true });
    d = await step(d, { kind: 'name', key: THING, answer: { kind: 'exercise', exerciseId: byKey(d, 'trap-bar-deadlift').exerciseId } });
    d = await step(d, { kind: 'bar_weight', bar: 'trap_bar', unit: 'kg', value: 25 });
    expect(thing(d)).toMatchObject({ exerciseName: 'Trap-bar deadlift', bar: 'trap_bar', override: null, reading: null, rememberedFits: false });
    expect(row(d)?.remembered).toBeNull();
    expect(row(d)?.lastTime?.replace(/\u00a0/g, ' ')).toBe('Last time: plates only + 20 kg Olympic bar. Not filled in: it was for another exercise.');
    expect(d.analysis.ready).toBe(false);
    // Ben answers it for the trap bar: that is what is stored, and what is remembered next.
    d = await step(d, { kind: 'total_override', key: THING, answer: 'plates_only' });
    expect((await commit(d, 'op-b')).loads.get('Thing')).toEqual({ value: 85, unit: 'kg', convention: 'total' });
  });

  it('S1: in one preview, re-mapping after Plates only clears it when the bar changes, and keeps it when the bar is the same', async () => {
    let d = await open(file('2026-09-01', 60, 'kg'));
    d = await step(d, { kind: 'name', key: THING, answer: { kind: 'exercise', exerciseId: byKey(d, 'barbell-bench-press').exerciseId } });
    d = await step(d, { kind: 'total_override', key: THING, answer: 'plates_only' });
    // Back squat: the same Olympic bar, so the answer means the same: kept.
    d = await step(d, { kind: 'name', key: THING, answer: { kind: 'exercise', exerciseId: byKey(d, 'barbell-back-squat').exerciseId } });
    expect(thing(d)).toMatchObject({ override: 'plates_only', bar: 'barbell' });
    // Trap-bar deadlift: another bar, so it is asked again.
    d = await step(d, { kind: 'name', key: THING, answer: { kind: 'exercise', exerciseId: byKey(d, 'trap-bar-deadlift').exerciseId } });
    expect(thing(d)).toMatchObject({ override: null, reading: null, bar: 'trap_bar' });
    expect(d.analysis.ready).toBe(false);
  });
});

describe('review r8 S2: a bar is only chosen for "plates only"', () => {
  it('the bar buttons wait for Plates only, the service refuses a bar otherwise, and Total as written drops a chosen bar', async () => {
    let d = await open(file('2026-09-01', 60, 'kg'));
    d = await step(d, { kind: 'name', key: THING, answer: { kind: 'new', equipment: 'barbell' } });
    expect(row(d)?.bars).toEqual([]);
    const refused = await s.imports.answer(d.draftId, d.mappingVersion, { kind: 'total_bar', key: THING, bar: 'ez_bar' });
    expect(refused).toMatchObject({ ok: false, reason: 'invalid', message: 'Choose Plates only for this exercise first' });
    d = await step(d, { kind: 'total_override', key: THING, answer: 'plates_only' });
    expect(row(d)?.bars.map((b) => b.label)).toEqual(['Olympic bar', 'EZ bar', 'Trap bar']);
    d = await step(d, { kind: 'total_bar', key: THING, bar: 'ez_bar' });
    expect(thing(d)).toMatchObject({ bar: 'ez_bar', barChosen: true });
    d = await step(d, { kind: 'total_override', key: THING, answer: 'total' });
    expect(thing(d)).toMatchObject({ bar: 'barbell', barChosen: false });
    expect(d.answers.totalBars).toEqual({});
    const { loads } = await commit(d, 'op-s2');
    expect(loads.get('Thing')).toEqual({ value: 60, unit: 'kg', convention: 'total' });
    // The exercise Add new made is the Olympic one.
    const again = await open(file('2026-10-01', 60, 'kg'), 'b.csv');
    const res = again.analysis.names.find((n) => n.key === THING)?.resolution;
    const made = res?.kind === 'exercise' ? s.imports.candidate(again.draftId, res.exercise.exerciseId) : null;
    expect(made?.compatibleEquipment).toEqual(['barbell']);
  });

  it('Add new with the EZ bar chosen for plates only makes an EZ-bar exercise of its own, never changing the Olympic one made before', async () => {
    let d = await open(file('2026-09-01', 30, 'kg'));
    d = await step(d, { kind: 'name', key: THING, answer: { kind: 'new', equipment: 'barbell' } });
    d = await step(d, { kind: 'total_override', key: THING, answer: 'total' });
    await commit(d, 'op-olympic');
    d = await open(file('2026-09-02', 30, 'kg'), 'b.csv');
    d = await step(d, { kind: 'name', key: THING, answer: { kind: 'new', equipment: 'barbell' } });
    d = await step(d, { kind: 'total_override', key: THING, answer: 'plates_only' });
    d = await step(d, { kind: 'total_bar', key: THING, bar: 'ez_bar' });
    d = await step(d, { kind: 'bar_weight', bar: 'ez_bar', unit: 'kg', value: 8 });
    expect((await commit(d, 'op-ez')).loads.get('Thing')).toEqual({ value: 38, unit: 'kg', convention: 'total' });
    const third = await open(file('2026-09-03', 30, 'kg'), 'c.csv');
    const candidates = s.imports.searchExercises(third.draftId, 'Thing').filter((c) => c.name === 'Thing');
    expect(candidates.map((c) => c.compatibleEquipment).sort()).toEqual([['barbell'], ['ez_bar']]);
  });
});

describe('review r8 S3: a job paused by an earlier build with a group "plates only" is not continued', () => {
  it('Continue import is refused with a reason, writes nothing more, and Undo still works', async () => {
    let d = await open([B2_HEADER, line('2026-09-01', 'Thing', 60, 'kg'), line('2026-09-03', 'Thing', 60, 'kg')].join('\n'));
    d = await step(d, { kind: 'name', key: THING, answer: { kind: 'exercise', exerciseId: byKey(d, 'barbell-bench-press').exerciseId } });
    d = await step(d, { kind: 'total', answer: 'total' });
    let n = 0;
    const r = await s.imports.commit(d.draftId, d.mappingVersion, 'op-1', { onProgress: (w) => (n = w), shouldStop: () => n >= 1 });
    if (!r.ok) throw new Error(r.reason);
    // As an r7 build stored it: the group answer "plates only".
    await h.forceClose();
    const raw = new DatabaseSync(join(h.dir, 'training-1.db'));
    raw.prepare("UPDATE import_jobs SET data = json_set(data, '$.answers.total', 'plates_only') WHERE id = ?").run(r.jobId);
    raw.close();
    s = (await h.launch()).services;
    const resumed = await s.imports.resume(r.jobId);
    expect(resumed).toEqual({ ok: false, reason: 'outdated_answers', jobId: r.jobId, written: 1, total: 2 });
    const job = await s.imports.job(r.jobId);
    expect(job).toMatchObject({ written: 1, total: 2, state: 'paused' });
    expect(await s.imports.revert(r.jobId, job?.job.version ?? 0, 'undo-1')).toMatchObject({ ok: true, workouts: 1 });
  });
});
