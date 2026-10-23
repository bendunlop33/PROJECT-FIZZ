import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { slotsOf } from '@fizz/domain';
import type { TrainingGoal } from '@fizz/schemas';

import type { BuilderSnapshot } from '../src/builder/builder-service';
import type { AppServices } from '../src/services/app-services';
import { CONNECTED, StepModel } from './coach-model';
import { createHarness, logWorkout, setUpGym, type Harness } from './harness';

/**
 * D4 (Ben, 22–23 Oct) on real SQLite, offline: Your workout's back-offs come from their reps and effort, rounded down
 * on this gym's bar, inside the band below the top for Ben's goal (Strength 2–8 %, Balanced 4–10 %, Muscle 8–15 %),
 * never at or above the top; a lighter top Ben types drops them by the same %, with Undo; Start plans exactly that,
 * and a force-close keeps it.
 */

const DAY = 86_400_000;
let h: Harness;
beforeEach(() => {
  const model = new StepModel([]);
  h = createHarness('2026-09-10T16:00:00.000Z', { coach: { model: () => model, connection: () => Promise.resolve(CONNECTED) } });
});
afterEach(async () => {
  await h.cleanup();
});

const ok = <T extends { status: string }>(r: T): Extract<T, { status: 'written' | 'replayed' }> => {
  if (r.status !== 'written' && r.status !== 'replayed') throw new Error(`write ${r.status}: ${'message' in r ? String(r.message) : ''}`);
  return r as Extract<T, { status: 'written' | 'replayed' }>;
};
const mainOf = (snap: BuilderSnapshot) => {
  const m = slotsOf(snap.workout.blocks).find((x) => x.main);
  if (m === undefined) throw new Error('no main lift');
  return m;
};
const topOf = (snap: BuilderSnapshot) => mainOf(snap).rows.find((r) => r.type === 'top')?.load ?? null;
const backoffsOf = (snap: BuilderSnapshot) => mainOf(snap).rows.filter((r) => r.type === 'backoff').map((r) => r.load);

async function setGoal(s: AppServices, goal: TrainingGoal): Promise<void> {
  const snap = await s.training.snapshot();
  expect(await s.training.change({ kind: 'goal', goal }, snap?.profile.version ?? 0, `goal-${goal}`)).toMatchObject({ ok: true });
}

/** Rows 100 × 6 @ 8 four days ago, then Set up → Pull with barbell row as the main lift → Next: exercises. */
async function buildPull(s: AppServices, gymId: string, opId: string): Promise<BuilderSnapshot> {
  await logWorkout(h, s, gymId, [{ exercise: 'Barbell row', sets: [{ load: 100, reps: 6, rpe: 8 }, { load: 100, reps: 6, rpe: 8 }, { load: 100, reps: 6, rpe: 8 }] }]);
  h.clockMs += 4 * DAY;
  const base = await s.builder.initialSetup({ dayId: 'pull' });
  const row = (await s.builder.setupFacts(base)).mainLifts.find((m) => m.name === 'Barbell row');
  if (row === undefined) throw new Error('no barbell row');
  return ok(await s.builder.create({ ...base, mainLiftExerciseId: row.id }, opId)).snapshot;
}

describe('D4: back-offs in Your workout follow Ben’s goal', () => {
  const bands: [TrainingGoal | null, number, number][] = [
    [null, 0.04, 0.1],
    ['both', 0.04, 0.1],
    ['strength', 0.02, 0.08],
    ['muscle', 0.08, 0.15],
  ];
  for (const [goal, min, max] of bands) {
    it(`${goal ?? 'no goal (Balanced)'}: every back-off is ${String(min * 100)}–${String(max * 100)} % below the top (rounded down), never at or above it`, async () => {
      const { services: s } = await h.launch();
      const gymId = await setUpGym(h, s);
      if (goal !== null) await setGoal(s, goal);
      const snap = await buildPull(s, gymId, `build-${goal ?? 'none'}`);
      const top = topOf(snap) ?? 0;
      expect(top).toBeGreaterThan(0);
      const b = backoffsOf(snap);
      expect(b.length).toBeGreaterThan(0);
      for (const x of b) {
        expect(x ?? Infinity).toBeLessThanOrEqual(top * (1 - min) + 1e-9);
        expect(x ?? 0).toBeGreaterThan(top * (1 - max) - 2.5);
      }
    });
  }

  it('Today: the card’s workout (committed as today’s Your workout draft) uses the same band (Muscle)', async () => {
    const { services: s } = await h.launch();
    const gymId = await setUpGym(h, s);
    await setGoal(s, 'muscle');
    await logWorkout(h, s, gymId, [{ exercise: 'Bench press', sets: [{ load: 100, reps: 6, rpe: 8 }, { load: 100, reps: 6, rpe: 8 }, { load: 100, reps: 6, rpe: 8 }] }]);
    h.clockMs += 2 * DAY;
    const data = await s.todaySession.load();
    if (data === null) throw new Error('no Today data');
    const day = [...data.days, ...data.others].find((d) => d.name === 'Push');
    const controls = day === undefined ? undefined : data.initial[day.key];
    if (day === undefined || controls === undefined) throw new Error('no Push day');
    const c = await s.todaySession.commit(data, { dayKey: day.key, controls }, 'commit-d4');
    if (!c.ok) throw new Error(c.message);
    const snap = await s.builder.read(c.draftId);
    if (snap === null) throw new Error('no draft');
    const top = topOf(snap) ?? 0;
    expect(top).toBeGreaterThan(0);
    const b = backoffsOf(snap);
    expect(b.length).toBeGreaterThan(0);
    for (const x of b) {
      expect(x ?? Infinity).toBeLessThanOrEqual(top * 0.92 + 1e-9);
      expect(x ?? 0).toBeGreaterThan(top * 0.85 - 2.5);
    }
  });

  it('a lighter top Ben types drops the back-offs by the same %; Undo puts them back; a force-close keeps it; Start plans it', async () => {
    const { services: s } = await h.launch();
    const gymId = await setUpGym(h, s);
    let snap = await buildPull(s, gymId, 'build-lower');
    const t0 = topOf(snap) ?? 0;
    const b0 = backoffsOf(snap);
    const main = mainOf(snap);
    const ti = main.rows.findIndex((r) => r.type === 'top');
    const lighter = t0 - 10;
    const edited = ok(await s.builder.edit(snap.draftId, { kind: 'edit_row', slotKey: main.key, index: ti, patch: { kind: 'load', value: lighter } }, { opId: 'lower-top', basis: { version: snap.version } })).snapshot;
    expect(topOf(edited)).toBe(lighter);
    const b1 = backoffsOf(edited);
    b1.forEach((x, i) => {
      const was = b0[i] ?? 0;
      expect(x ?? Infinity).toBeLessThanOrEqual((was * lighter) / t0 + 1e-9);
      expect(x ?? 0).toBeGreaterThan((was * lighter) / t0 - 2.5);
      expect(x ?? Infinity).toBeLessThan(lighter);
    });
    // The same write again (a lost acknowledgement) is a replay, nothing moves twice.
    const again = await s.builder.edit(snap.draftId, { kind: 'edit_row', slotKey: main.key, index: ti, patch: { kind: 'load', value: lighter } }, { opId: 'lower-top', basis: { version: snap.version } });
    expect(again.status).toBe('replayed');
    expect(backoffsOf(ok(again).snapshot)).toEqual(b1);

    // Undo puts the top and the back-offs back.
    const undone = await s.builder.undo(snap.draftId, 'lower-top', 'undo-lower-top');
    if (undone.snapshot === null) throw new Error('no undo');
    expect(topOf(undone.snapshot)).toBe(t0);
    expect(backoffsOf(undone.snapshot)).toEqual(b0);
    snap = ok(await s.builder.edit(snap.draftId, { kind: 'edit_row', slotKey: main.key, index: ti, patch: { kind: 'load', value: lighter } }, { opId: 'lower-top-2', basis: { version: undone.snapshot.version } })).snapshot;

    // Force-close and relaunch: the draft is stored as edited.
    await h.forceClose();
    const { services: s2 } = await h.launch();
    const read = await s2.builder.read(snap.draftId);
    if (read === null) throw new Error('draft lost');
    expect(topOf(read)).toBe(lighter);
    expect(backoffsOf(read)).toEqual(b1);
    const started = await s2.builder.start(read.draftId, { opId: 'start-lower', expectedVersion: read.version, checkIn: null });
    if (!started.ok) throw new Error(started.message);
    const a = (await s2.workout.load(started.sessionId))?.aggregate;
    const ex = a?.exercises.find((e) => e.exerciseId === mainOf(read).exerciseId);
    const sets = [...(a?.sets.filter((x) => x.sessionExerciseId === ex?.id && x.setType !== 'warmup') ?? [])].sort((x, y) => x.index - y.index);
    expect(sets.filter((x) => x.setType === 'top').map((x) => x.planned.load?.value)).toEqual([lighter]);
    expect(sets.filter((x) => x.setType === 'backoff').map((x) => x.planned.load?.value ?? null)).toEqual(b1);
  });

  it('review B1: the top typed heavier then back restores the back-offs (no ratchet); same op ID replays; force-close; Start plans it', async () => {
    const { services: s } = await h.launch();
    const gymId = await setUpGym(h, s);
    let snap = await buildPull(s, gymId, 'build-ratchet');
    const t0 = topOf(snap) ?? 0;
    const b0 = backoffsOf(snap);
    expect(t0).toBeGreaterThan(0);
    const main = mainOf(snap);
    const ti = main.rows.findIndex((r) => r.type === 'top');
    const typeTop = async (value: number, opId: string) => {
      snap = ok(await s.builder.edit(snap.draftId, { kind: 'edit_row', slotKey: main.key, index: ti, patch: { kind: 'load', value } }, { opId, basis: { version: snap.version } })).snapshot;
    };
    // Heavier, then back to the built top, three times over: the back-offs end where they were built.
    for (let k = 0; k < 3; k += 1) {
      await typeTop(t0 + 5, `up-${String(k)}`);
      expect(backoffsOf(snap)).toEqual(b0);
      await typeTop(t0, `back-${String(k)}`);
      expect(topOf(snap)).toBe(t0);
      expect(backoffsOf(snap)).toEqual(b0);
    }
    // Lighter by 5: the same % below the built back-offs whatever came before.
    await typeTop(t0 - 5, 'down-5');
    const lower = backoffsOf(snap);
    lower.forEach((x, i) => {
      expect(x ?? Infinity).toBeLessThanOrEqual(((b0[i] ?? 0) * (t0 - 5)) / t0 + 1e-9);
      expect(x ?? 0).toBeGreaterThan(((b0[i] ?? 0) * (t0 - 5)) / t0 - 2.5);
    });
    await typeTop(t0 + 10, 'up-10');
    await typeTop(t0 - 5, 'down-5-again');
    expect(backoffsOf(snap)).toEqual(lower);
    await typeTop(t0, 'back-final');
    expect(backoffsOf(snap)).toEqual(b0);

    // The last write again (a lost acknowledgement) is a replay: nothing moves twice.
    const again = await s.builder.edit(snap.draftId, { kind: 'edit_row', slotKey: main.key, index: ti, patch: { kind: 'load', value: t0 } }, { opId: 'back-final', basis: { version: snap.version - 1 } });
    expect(again.status).toBe('replayed');
    expect(backoffsOf(ok(again).snapshot)).toEqual(b0);

    await h.forceClose();
    const { services: s2 } = await h.launch();
    const read = await s2.builder.read(snap.draftId);
    if (read === null) throw new Error('draft lost');
    expect(backoffsOf(read)).toEqual(b0);
    const started = await s2.builder.start(read.draftId, { opId: 'start-ratchet', expectedVersion: read.version, checkIn: null });
    if (!started.ok) throw new Error(started.message);
    const a = (await s2.workout.load(started.sessionId))?.aggregate;
    const ex = a?.exercises.find((e) => e.exerciseId === mainOf(read).exerciseId);
    const sets = [...(a?.sets.filter((x) => x.sessionExerciseId === ex?.id && x.setType !== 'warmup') ?? [])].sort((x, y) => x.index - y.index);
    expect(sets.filter((x) => x.setType === 'top').map((x) => x.planned.load?.value)).toEqual([t0]);
    expect(sets.filter((x) => x.setType === 'backoff').map((x) => x.planned.load?.value ?? null)).toEqual(b0);
  });

  it('review B2: a top reps edit (6 → 10) lowers the top; the back-offs stay below it, and Start plans that', async () => {
    const { services: s } = await h.launch();
    const gymId = await setUpGym(h, s);
    const fresh = await buildPull(s, gymId, 'build-reps');
    const fm = mainOf(fresh);
    const fi = fm.rows.findIndex((r) => r.type === 'top');
    const reps = ok(await s.builder.edit(fresh.draftId, { kind: 'edit_row', slotKey: fm.key, index: fi, patch: { kind: 'reps', reps: 10 } }, { opId: 'top-reps', basis: { version: fresh.version } })).snapshot;
    const t1 = topOf(reps) ?? 0;
    expect(t1).toBeGreaterThan(0);
    expect(t1).toBeLessThan(topOf(fresh) ?? 0);
    const b1 = backoffsOf(reps);
    for (const x of b1) expect(x ?? Infinity).toBeLessThanOrEqual(t1 * 0.96 + 1e-9);
    const started = await s.builder.start(reps.draftId, { opId: 'start-reps', expectedVersion: reps.version, checkIn: null });
    if (!started.ok) throw new Error(started.message);
    const a = (await s.workout.load(started.sessionId))?.aggregate;
    const ex = a?.exercises.find((e) => e.exerciseId === fm.exerciseId);
    const sets = a?.sets.filter((x) => x.sessionExerciseId === ex?.id && x.setType === 'backoff') ?? [];
    expect(sets.map((x) => x.planned.load?.value ?? null)).toEqual(b1);
  });
});
