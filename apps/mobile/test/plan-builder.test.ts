import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { pbWithSessions } from '@fizz/domain';

import { PB_COPY, checkRows, dayViews, goalsRowValue, prefsRowValue, volumeRows, weekRowValue } from '../src/plan-builder/plan-builder-view';
import { createHarness, logWorkout, setUpGym, type Harness } from './harness';

/**
 * The plan builder end to end on real SQLite (plan-builder.md; gap report V2/V3): Ben's history at his gym → the
 * engine builds a plan offline (no coach connected) → Build writes an open plan → a force-close keeps it → Apply
 * makes its days his plan in use (Library › Your plan and Today read it) → Undo puts back the setup before it.
 */

const DAY = 86_400_000;
let h: Harness;
beforeEach(() => {
  h = createHarness('2026-10-22T07:00:00.000Z');
});
afterEach(async () => {
  await h.cleanup();
});

describe('plan builder', () => {
  it('builds a 4-day plan offline from his history, applies it, Undo puts the setup back', async () => {
    const { services: s } = await h.launch();
    const gymId = await setUpGym(h, s);
    await logWorkout(h, s, gymId, [{ exercise: 'Bench press', sets: [{ load: 100, reps: 6, rpe: 8 }, { load: 100, reps: 6, rpe: 8 }] }]);
    h.clockMs += DAY;

    const session = await s.planBuilder.open();
    if (session === null) throw new Error('no session');
    expect(session.draft).toBeNull();
    // Squat, row and DB shoulder press have no history: Check your lifts comes first.
    expect(session.needsCheck).toBe(true);
    const lifts = session.lifts(session.answers);
    const bench = checkRows(lifts, session.nameOf, () => false).find((r) => r.key === 'barbell-bench-press');
    expect(bench).toMatchObject({ six: '100', est: false, open: false });

    // The ✦ answers: 6 weeks, Standard, Balanced; 4 sessions of 60 min.
    const a = session.answers;
    expect(goalsRowValue(a)).toBe('6 weeks · Standard · Balanced');
    expect(weekRowValue(a)).toBe('4 days · 60 min');
    expect(prefsRowValue(a)).toBe(PB_COPY.none);
    const plan = session.build(a);
    const days = dayViews(plan, a, session.nameOf);
    expect(days.map((d) => d.title)).toEqual(['1 · Upper A', '2 · Lower A', '3 · Upper B', '4 · Lower B']);
    // Bench is Upper B's main lift at its 6-rep estimate with a D4 back-off, snapped to the gym's plates.
    const upperB = days[2];
    expect(upperB?.rows[0]).toMatchObject({ key: 'barbell-bench-press', main: true, scheme: '1 × 6 + 2 × 8 · 100 / 95', kg: null });
    expect(volumeRows(plan, a).map((v) => v.muscle)).toEqual(['Chest', 'Back', 'Shoulders', 'Quads', 'Hamstrings', 'Calves', 'Biceps', 'Triceps', 'Core']);

    // Build writes an open plan; a retried tap with the same op finds it.
    const op = h.ids();
    const built = await s.planBuilder.save(session, a, null, op);
    expect(built).toMatchObject({ ok: true, version: 1, versionN: 1 });
    expect(await s.planBuilder.save(session, a, null, op)).toEqual(built);
    if (!built.ok) throw new Error('not built');
    expect(await s.plans.inUse()).toBeNull();

    // A force-close before Apply keeps the built plan: the builder opens on it with its answers.
    await h.forceClose();
    const { services: s2 } = await h.launch();
    const again = await s2.planBuilder.open();
    expect(again?.draft).toEqual({ planId: built.planId, version: 1, versionN: 1 });
    expect(again?.answers).toEqual(a);

    // A rebuild with new answers is a new version; the old version can't be applied (rule 5).
    if (again == null) throw new Error('no session');
    const five = pbWithSessions(a, 5);
    const v2 = await s2.planBuilder.save(again, five, again.draft, h.ids());
    expect(v2).toMatchObject({ ok: true, version: 2, versionN: 2 });
    const stale = await s2.planBuilder.apply({ planId: built.planId, versionN: 1, expectedVersion: 1, opId: h.ids() });
    expect(stale.ok).toBe(false);
    if (!v2.ok) throw new Error('no v2');

    const applyOp = h.ids();
    const applied = await s2.planBuilder.apply({ planId: v2.planId, versionN: v2.versionN, expectedVersion: v2.version, opId: applyOp });
    expect(applied.ok).toBe(true);
    if (!applied.ok) throw new Error('not applied');
    // A retried Apply replays.
    expect(await s2.planBuilder.apply({ planId: v2.planId, versionN: v2.versionN, expectedVersion: v2.version, opId: applyOp })).toMatchObject({ ok: true, duplicate: true });
    expect(await s2.plans.inUse()).toMatchObject({ planId: v2.planId, name: '5-day plan' });
    const overview = await s2.plans.overview();
    expect(overview?.days.map((d) => d.name)).toEqual(['Push A', 'Pull A', 'Legs', 'Push B', 'Pull B']);

    // Undo: no plan again, exactly as before.
    const undone = await s2.planBuilder.undo({ planId: v2.planId, expectedVersion: applied.plan.version, opId: h.ids() });
    expect(undone.ok).toBe(true);
    expect(await s2.plans.inUse()).toBeNull();
    // A second Undo at the same version is stale.
    expect((await s2.planBuilder.undo({ planId: v2.planId, expectedVersion: applied.plan.version, opId: h.ids() })).ok).toBe(false);
  });

  it('a plan day’s first workout starts from the plan’s week-1 loads', async () => {
    const { services: s } = await h.launch();
    const gymId = await setUpGym(h, s);
    await logWorkout(h, s, gymId, [{ exercise: 'Bench press', sets: [{ load: 100, reps: 6, rpe: 8 }] }]);
    h.clockMs += DAY;
    const session = await s.planBuilder.open();
    if (session === null) throw new Error('no session');
    const a = { ...session.answers, split: 'ppl' as const, sessions: 3, days: [0, 2, 4] };
    const built = await s.planBuilder.save(session, a, null, h.ids());
    if (!built.ok) throw new Error('not built');
    const applied = await s.planBuilder.apply({ planId: built.planId, versionN: built.versionN, expectedVersion: built.version, opId: h.ids() });
    expect(applied.ok).toBe(true);
    const ov = await s.plans.overview();
    const push = ov?.days.find((d) => d.name === 'Push');
    expect(push).toBeDefined();
    const planned = push === undefined ? null : await s.plans.planDay(push.routineId);
    const benchRow = planned?.rows.find((r) => r.name === 'Bench press');
    expect(benchRow).toBeDefined();
    // The app's load text uses non-breaking spaces.
    expect(benchRow?.line.replace(/\s/gu, ' ')).toBe('100 kg top, 2 × 8 · 95 kg');

    // (WU1–WU12) The plan's warm-ups for the main lift are the ones Start plans: the shared planner, same loads and reps.
    const shown = session.build(a).days.flatMap((d) => d.exercises).find((e) => e.key === 'barbell-bench-press' && e.role === 'main')?.main?.warmup ?? [];
    expect(shown.length).toBeGreaterThan(0);
    if (push === undefined) throw new Error('no Push day');
    const started = await s.workout.start({ gymId, opId: h.ids(), checkIn: null, routineOf: push.routineId });
    expect(started.ok).toBe(true);
    const agg = await s.sessions.active();
    if (agg == null) throw new Error('no workout');
    const first = [...agg.exercises].sort((x, y) => x.order - y.order)[0];
    const warm = agg.sets.filter((x) => x.sessionExerciseId === first?.id && x.setType === 'warmup').sort((x, y) => x.index - y.index);
    expect(warm.map((x) => [x.planned.load?.value ?? null, x.planned.reps?.min ?? null])).toEqual(shown.map((w) => [w.load, w.reps]));
  });
});
