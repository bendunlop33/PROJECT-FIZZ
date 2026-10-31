import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { ModelEvent, ModelRequest } from '@fizz/coach';
import { slotsOf } from '@fizz/domain';
import type { SessionAggregate, WorkoutSet } from '@fizz/schemas';

import type { BuilderSnapshot } from '../src/builder/builder-service';
import type { AppServices } from '../src/services/app-services';
import type { OverviewData } from '../src/services/workout-services';
import { CONNECTED, replyWith, StepModel, toolCall } from './coach-model';
import { createHarness, logWorkout, setUpGym, type Harness } from './harness';

/**
 * The shared warm-up planner (WU1–WU12, approved 22 Oct) end to end on real SQLite: the builder's warm-ups are what
 * Start stores; a coach-built workout's warm-ups (reps only in the draft) get the planner's loads at Start and the
 * workout shows exactly what is stored; warmed exercises (WU2) get none; a fixed count (Ben asked the coach for a
 * number) keeps that count; everything survives a force-close, and a logged warm-up is never changed (rule 2).
 */

const DAY = 86_400_000;
let h: Harness;
let model: StepModel;
beforeEach(() => {
  model = new StepModel([]);
  h = createHarness('2026-10-20T16:00:00.000Z', { coach: { model: () => model, connection: () => Promise.resolve(CONNECTED) } });
});
afterEach(async () => {
  await h.cleanup();
});

async function ben(): Promise<{ s: AppServices; gymId: string }> {
  const { services: s } = await h.launch();
  const gymId = await setUpGym(h, s);
  await logWorkout(h, s, gymId, [
    { exercise: 'Bench press', sets: [{ load: 100, reps: 6, rpe: 8 }, { load: 100, reps: 6, rpe: 8 }, { load: 100, reps: 6, rpe: 8 }] },
    { exercise: 'Incline dumbbell press', sets: [{ load: 27.5, reps: 9, rpe: 8 }, { load: 27.5, reps: 9, rpe: 8 }] },
    { exercise: 'Triceps pushdown', sets: [{ load: 25, reps: 11, rpe: 8 }, { load: 25, reps: 11, rpe: 8 }] },
  ]);
  h.clockMs += DAY;
  return { s, gymId };
}

const ok = <T extends { status: string }>(r: T): Extract<T, { status: 'written' | 'replayed' }> => {
  if (r.status !== 'written' && r.status !== 'replayed') throw new Error(`write ${r.status}`);
  return r as Extract<T, { status: 'written' | 'replayed' }>;
};

type Step = [number | null, number | null];
const stepsOf = (a: SessionAggregate, name: string): Step[] => {
  const ex = a.exercises.find((e) => e.exerciseName === name);
  return a.sets
    .filter((x) => x.sessionExerciseId === ex?.id && x.setType === 'warmup' && x.status !== 'deleted')
    .sort((x, y) => x.index - y.index)
    .map((x) => [x.status === 'completed' ? (x.actual?.load?.value ?? null) : (x.planned.load?.value ?? null), x.status === 'completed' ? (x.actual?.reps ?? null) : (x.planned.reps?.min ?? null)]);
};
const firstWork = (a: SessionAggregate, name: string): WorkoutSet | undefined => {
  const ex = a.exercises.find((e) => e.exerciseName === name);
  return a.sets.filter((x) => x.sessionExerciseId === ex?.id && x.setType !== 'warmup').sort((x, y) => x.index - y.index)[0];
};

/** Every warm-up: a load, lighter than the first working load and climbing to it (rule 4). */
function climbs(a: SessionAggregate, name: string): void {
  const W = firstWork(a, name)?.planned.load?.value ?? null;
  const steps = stepsOf(a, name);
  expect(W).not.toBeNull();
  let prev = -1;
  for (const [load, reps] of steps) {
    expect(load).not.toBeNull();
    expect(load as number).toBeLessThan(W as number);
    expect(load as number).toBeGreaterThan(prev);
    expect(reps as number).toBeLessThanOrEqual(8);
    prev = load as number;
  }
}

/** The workout table's rows for an exercise: what Ben sees on each warm-up (load and reps cells). */
async function shownSteps(s: AppServices, sessionId: string, name: string): Promise<[string | null, string][]> {
  const data = await s.workout.load(sessionId);
  if (data === null) throw new Error('no session');
  const view = s.workout.tableView(data, h.clockMs, null);
  const rows = view.blocks.flatMap((b) => (b.kind === 'exercise' ? (b.card.name === name ? b.card.rows : []) : b.superset.members.filter((m) => m.name === name).flatMap((m) => m.rows)));
  return rows.filter((r) => r.setType === 'warmup').map((r) => [r.cells.load?.replaceAll(' ', ' ') ?? null, r.cells.value]);
}

const fmtNum = (n: number | null): string | null => (n === null ? null : Number.isInteger(n) ? String(n) : String(n));

describe('builder → Start: the stored warm-ups are the planner’s and the builder’s', () => {
  it('bench (main, first) gets the WU4 ladder from the bar; warmed exercises get none; Start stores exactly the builder rows; force-close keeps them', async () => {
    const { s, gymId } = await ben();
    const setup = await s.builder.initialSetup({ dayId: 'push' });
    const snap: BuilderSnapshot = ok(await s.builder.create({ ...setup, minutes: 60, supersets: false }, 'create-wu')).snapshot;
    const slots = slotsOf(snap.workout.blocks);
    const bench = slots.find((sl) => snap.facts[sl.exerciseId]?.name === 'Bench press');
    if (bench === undefined) throw new Error('no bench');
    const top = bench.rows.find((r) => r.type === 'top') ?? bench.rows.find((r) => r.type !== 'warmup');
    const warm = bench.rows.filter((r) => r.type === 'warmup');
    // WU4 (heavy band, not warmed, a barbell lift not from the floor): the bar first, then 40 / 60 / 80 %.
    expect(top?.reps).toBeLessThanOrEqual(6);
    expect(warm[0]).toMatchObject({ load: 20, reps: 5 });
    expect(warm.map((r) => r.reps).slice(1)).toEqual([5, 3, 2]);
    for (const r of warm) expect(r.load as number).toBeLessThan(top?.load as number);
    // WU2: anything after the bench that works the chest or pushes horizontally is warmed (no warm-ups).
    for (const sl of slots.slice(slots.indexOf(bench) + 1)) {
      const info = snap.facts[sl.exerciseId];
      if (info?.name === 'Incline dumbbell press' || info?.name === 'Dumbbell bench press') expect(sl.rows.some((r) => r.type === 'warmup')).toBe(false);
    }

    const started = await s.builder.start(snap.draftId, { opId: 'start-wu', expectedVersion: snap.version, gymId });
    if (!started.ok) throw new Error('not started');
    const a = (await s.workout.load(started.sessionId))?.aggregate;
    if (a === undefined) throw new Error('no session');
    for (const sl of slots) {
      const name = snap.facts[sl.exerciseId]?.name ?? '';
      expect(stepsOf(a, name), name).toEqual(sl.rows.filter((r) => r.type === 'warmup').map((r) => [r.load, r.reps]));
    }
    climbs(a, 'Bench press');
    // What the table shows is what's stored.
    expect(await shownSteps(s, a.session.id, 'Bench press')).toEqual(stepsOf(a, 'Bench press').map(([l, r]) => [fmtNum(l), String(r)]));

    // Force-close and relaunch: the same warm-ups.
    await h.forceClose();
    const { services: s2 } = await h.launch();
    const again = (await s2.workout.load(started.sessionId))?.aggregate;
    if (again === undefined) throw new Error('lost');
    expect(stepsOf(again, 'Bench press')).toEqual(stepsOf(a, 'Bench press'));
  });
});

describe('Ben’s own warm-ups stay his (behaviour rule: the planner never overrides what he set)', () => {
  it('a warm-up he deletes stays deleted through later edits, a force-close and Start; slots he didn’t touch are re-planned by place', async () => {
    const { s, gymId } = await ben();
    const setup = await s.builder.initialSetup({ dayId: 'push' });
    let snap: BuilderSnapshot = ok(await s.builder.create({ ...setup, minutes: 60, supersets: false }, 'create-own')).snapshot;
    const withWarm = slotsOf(snap.workout.blocks).find((sl) => !sl.main && sl.rows.some((r) => r.type === 'warmup'));
    if (withWarm === undefined) throw new Error('no accessory with a warm-up');
    const name = snap.facts[withWarm.exerciseId]?.name ?? '';
    const index = withWarm.rows.findIndex((r) => r.type === 'warmup');
    snap = ok(await s.builder.edit(snap.draftId, { kind: 'delete_set', slotKey: withWarm.key, index }, { opId: 'del-warm', basis: { version: snap.version } })).snapshot;
    const after = slotsOf(snap.workout.blocks).find((sl) => sl.key === withWarm.key);
    expect(after?.ownWarmups).toBe(true);
    const left = after?.rows.filter((r) => r.type === 'warmup').length ?? -1;
    expect(left).toBe(withWarm.rows.filter((r) => r.type === 'warmup').length - 1);
    // Another edit elsewhere re-plans by place, but never his slot.
    const other = slotsOf(snap.workout.blocks).find((sl) => sl.key !== withWarm.key && !sl.main);
    if (other !== undefined) snap = ok(await s.builder.edit(snap.draftId, { kind: 'add_set', slotKey: other.key }, { opId: 'add-other', basis: { version: snap.version } })).snapshot;
    await h.forceClose();
    const { services: s2 } = await h.launch();
    const read = await s2.builder.read(snap.draftId);
    if (read === null) throw new Error('gone');
    expect(slotsOf(read.workout.blocks).find((sl) => sl.key === withWarm.key)?.rows.filter((r) => r.type === 'warmup').length).toBe(left);
    const started = await s2.builder.start(read.draftId, { opId: 'start-own', expectedVersion: read.version, gymId });
    if (!started.ok) throw new Error('not started');
    const a = (await s2.workout.load(started.sessionId))?.aggregate;
    if (a === undefined) throw new Error('no session');
    expect(stepsOf(a, name).length).toBe(left);
  });
});

// ---------------------------------------------------------------------------
// A coach-built workout

const ex = (catalogueId: string, over: Record<string, unknown> = {}) => ({ catalogueId, warmups: null, workingSets: 3, reps: { min: 8, max: 10 }, workSeconds: null, targetRpe: 8, topSet: null, restSeconds: null, superset: null, load: null, ...over });

function buildOf(req: ModelRequest): { usable: { catalogueId: string; name: string }[] } {
  const block = req.input.find((i) => i.type === 'message' && i.role === 'developer' && i.content.startsWith('YOUR DATA'));
  if (block?.type !== 'message') throw new Error('no context');
  const data = JSON.parse(block.content.slice(block.content.indexOf('\n') + 1)) as { build?: { usable: { catalogueId: string; name: string }[] } };
  if (data.build === undefined) throw new Error('not a build turn');
  return data.build;
}

function stub(list: readonly [string, Record<string, unknown>][]) {
  return (req: ModelRequest): ModelEvent[] => {
    const b = buildOf(req);
    const idOf = (name: string) => b.usable.find((u) => u.name === name)?.catalogueId ?? `missing-${name}`;
    return toolCall('propose_workout', { name: 'Push', exercises: list.map(([n, over]) => ex(idOf(n), over)), message: 'Here.' });
  };
}

async function coachStart(s: AppServices, gymId: string, list: readonly [string, Record<string, unknown>][], opId: string): Promise<SessionAggregate> {
  model = new StepModel([stub(list), () => replyWith('Done.')]);
  const r = await s.coach.send({ entry: { kind: 'today' }, threadId: null, input: { kind: 'words', text: 'build me a 60-minute push session', spoken: false }, turnId: h.ids() });
  const card = r.cards[0]?.record;
  if (card?.detail.kind !== 'build_workout' || card.status !== 'committed') throw new Error('no draft');
  const p: OverviewData | null = await s.overview.load({ target: { kind: 'coach_draft', draftId: card.detail.draftId }, gymId });
  if (p === null) throw new Error('no overview');
  const started = await s.overview.start({ startOf: p.startOf, gymId, opId, checkIn: { kind: 'skipped', atUtc: h.now().utc }, expectedPreviewKey: p.view.previewKey, draft: p.draft === null ? null : { id: p.draft.id, expectedVersion: p.draft.version } });
  if (!started.ok) throw new Error(started.error.message);
  return started.aggregate;
}

describe('a coach-built workout → Start: the planner fills its warm-ups (the trigger: one rep of rows, 23 Oct)', () => {
  it('warm-ups the coach left to code: bench gets a real ladder at the gym’s loads; a warmed main lift its top step only; an isolation for a new muscle one 50 % × 8; shown == stored; logged warm-ups never change', async () => {
    const { s, gymId } = await ben();
    const a = await coachStart(
      s,
      gymId,
      [
        ['Bench press', { workingSets: 3, reps: { min: 5, max: 5 } }],
        ['Incline dumbbell press', { reps: { min: 8, max: 10 } }],
        ['Triceps pushdown', { reps: { min: 10, max: 12 } }],
      ],
      'start-coach-wu',
    );
    // Bench 5 reps (heavy band), first: bar × 5, then 40 / 60 / 80 % of its working load, snapped down.
    climbs(a, 'Bench press');
    const bench = stepsOf(a, 'Bench press');
    expect(bench[0]).toEqual([20, 5]);
    expect(bench.map(([, r]) => r)).toEqual([5, 5, 3, 2]);
    // Incline press after bench: warmed (same muscle group and pattern, WU2). A coach workout marks its compounds as
    // main lifts (WL9), so it keeps WU5's warmed step only: 80 % × 4 (R 8), snapped down on the dumbbells.
    const incline = stepsOf(a, 'Incline dumbbell press');
    const inclineW = firstWork(a, 'Incline dumbbell press')?.planned.load?.value ?? 0;
    expect(incline.length).toBe(1);
    expect(incline[0]?.[1]).toBe(4);
    expect(incline[0]?.[0] as number).toBeLessThanOrEqual(0.85 * inclineW);
    // Pushdown: triceps not yet worked as a primary muscle → one step, 50 % × 8 (WU7).
    const pd = stepsOf(a, 'Triceps pushdown');
    const pdW = firstWork(a, 'Triceps pushdown')?.planned.load?.value ?? 0;
    expect(pd.length).toBe(1);
    expect(pd[0]?.[1]).toBe(8);
    expect(pd[0]?.[0] as number).toBeLessThanOrEqual(pdW / 2);
    // Shown == stored.
    expect(await shownSteps(s, a.session.id, 'Bench press')).toEqual(bench.map(([l, r]) => [fmtNum(l), String(r)]));

    // Ben logs the first warm-up at his own load; nothing logged is ever re-planned (rule 2), and the rest stay.
    const exRow = a.exercises.find((e) => e.exerciseName === 'Bench press');
    const w1 = a.sets.filter((x) => x.sessionExerciseId === exRow?.id && x.setType === 'warmup').sort((x, y) => x.index - y.index)[0];
    if (w1 === undefined || exRow === undefined) throw new Error('no warm-up');
    const logged = await s.workout.dispatch(a.session.id, { type: 'log_set', at: h.now(), opId: 'log-w1', setId: w1.id, values: { load: { value: 30, unit: 'kg', convention: 'total' }, reps: 8, durationS: null, rpe: null, rir: null }, restTimerId: h.ids() });
    expect(logged.ok).toBe(true);
    await h.forceClose();
    const { services: s2 } = await h.launch();
    const after = (await s2.workout.load(a.session.id))?.aggregate;
    if (after === undefined) throw new Error('lost');
    expect(stepsOf(after, 'Bench press')).toEqual([[30, 8], ...bench.slice(1)]);
  });

  it('a count Ben asked the coach for is kept: 1 warm-up on rows 12 reps → the heaviest step only (≈ 80 %, × 5), never a single rep', async () => {
    const { services: s } = await h.launch();
    const gymId = await setUpGym(h, s);
    await logWorkout(h, s, gymId, [{ exercise: 'Barbell row', sets: [{ load: 90, reps: 12, rpe: 8 }, { load: 90, reps: 12, rpe: 8 }] }]);
    h.clockMs += DAY;
    const a = await coachStart(s, gymId, [['Barbell row', { warmups: 1, workingSets: 3, reps: { min: 12, max: 12 } }]], 'start-rows');
    const W = firstWork(a, 'Barbell row')?.planned.load?.value ?? null;
    const rows = stepsOf(a, 'Barbell row');
    expect(W).not.toBeNull();
    expect(rows.length).toBe(1);
    expect(rows[0]?.[1]).toBe(5);
    expect(rows[0]?.[0] as number).toBeGreaterThanOrEqual(0.7 * (W as number));
    expect(rows[0]?.[0] as number).toBeLessThanOrEqual(0.85 * (W as number));
  });

  it('left to code, rows 12 reps first get WU5’s two steps (50 % × 8, 80 % × 5) and no empty bar (WU9)', async () => {
    const { services: s } = await h.launch();
    const gymId = await setUpGym(h, s);
    await logWorkout(h, s, gymId, [{ exercise: 'Barbell row', sets: [{ load: 90, reps: 12, rpe: 8 }, { load: 90, reps: 12, rpe: 8 }] }]);
    h.clockMs += DAY;
    const a = await coachStart(s, gymId, [['Barbell row', { workingSets: 3, reps: { min: 12, max: 12 } }]], 'start-rows-auto');
    const rows = stepsOf(a, 'Barbell row');
    expect(rows.map(([, r]) => r)).toEqual([8, 5]);
    climbs(a, 'Barbell row');
    expect(rows[0]?.[0]).not.toBe(20);
  });
});
