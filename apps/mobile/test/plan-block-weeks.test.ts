import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { deloadSetCount, slotsOf, workingCount, type BuilderWorkout } from '@fizz/domain';

import type { AppServices } from '../src/services/app-services';
import type { TodaySessionData } from '../src/services/today-session';
import { finishWorkout } from './finish-workout';
import { createHarness, logWorkout, setUpGym, type Harness } from './harness';

/**
 * (Ben, 23 Oct: a plan's length is its training block, block 1) End to end on real SQLite, offline (no coach): a
 * 6-week Standard plan from the builder; Today's header reads `Week N of 6` from the plan's Apply and his plan
 * workouts (an empty week holds the number); week 6 is the deload (loads −10 % rounded down, a set fewer, the
 * template untouched); Your plan's week strip shows every week, done weeks read-only; a force-close re-derives the
 * same week; `Start next block` opens the builder with the same answers, and a stale Apply is refused (rule 5).
 */

const DAY = 86_400_000;
let h: Harness;
beforeEach(() => {
  // Monday 19 Oct 2026.
  h = createHarness('2026-10-19T07:00:00.000Z');
});
afterEach(async () => {
  await h.cleanup();
});

async function loaded(s: AppServices): Promise<TodaySessionData> {
  const d = await s.todaySession.load();
  if (d === null) throw new Error('no Today');
  return d;
}

/** Today's Push card committed, started and finished (one set logged as planned). */
async function doPush(s: AppServices, gymId: string): Promise<string> {
  const data = await loaded(s);
  const day = data.days.find((d) => d.name === 'Push');
  const controls = day === undefined ? undefined : data.initial[day.key];
  if (day === undefined || controls === undefined) throw new Error('no Push day');
  const c = await s.todaySession.commit(data, { dayKey: day.key, controls }, h.ids());
  if (!c.ok) throw new Error(c.message);
  const r = await s.todaySession.start({ draftId: c.draftId, expectedVersion: c.version, gymId, opId: h.ids(), checkIn: null });
  if (!r.ok) throw new Error('not started');
  const sessionId = r.aggregate.session.id;
  await finishWorkout(h, s, sessionId);
  return sessionId;
}

/** To the next Monday morning. */
function nextMonday(): void {
  const now = new Date(h.clockMs);
  const back = (now.getUTCDay() + 6) % 7;
  h.clockMs = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - back + 7, 7);
}

const pushCard = (s: AppServices, data: TodaySessionData) => {
  const day = data.days.find((d) => d.name === 'Push');
  const controls = day === undefined ? undefined : data.initial[day.key];
  if (day === undefined || controls === undefined) throw new Error('no Push day');
  const card = s.todaySession.card(data, { dayKey: day.key, controls });
  if (card?.draft == null) throw new Error('no card');
  return card;
};
const work = (w: BuilderWorkout) => slotsOf(w.blocks).map((x) => ({ id: x.exerciseId, sets: workingCount(x), top: x.rows.find((r) => r.type !== 'warmup')?.load ?? null, rpe: Math.max(...x.rows.filter((r) => r.type !== 'warmup').map((r) => r.rpe ?? 0)) }));

describe('plan length = block 1: the week, the deload, Your plan’s weeks', () => {
  it('weeks advance with plan workouts, week 6 deloads, done weeks are read-only, force-close safe, next block from the same answers', async () => {
    const { services: s } = await h.launch();
    const gymId = await setUpGym(h, s);
    await logWorkout(h, s, gymId, [{ exercise: 'Bench press', sets: [{ load: 100, reps: 6, rpe: 8 }, { load: 100, reps: 6, rpe: 8 }] }]);
    h.clockMs += 3_600_000;

    // A 6-week Standard PPL plan from the builder, offline.
    const session = await s.planBuilder.open();
    if (session === null) throw new Error('no builder');
    const a = { ...session.answers, split: 'ppl' as const, sessions: 3, days: [0, 2, 4] };
    expect([a.weeks, a.effort]).toEqual([6, 'standard']);
    const built = await s.planBuilder.save(session, a, null, h.ids());
    if (!built.ok) throw new Error('not built');
    const applied = await s.planBuilder.apply({ planId: built.planId, versionN: built.versionN, expectedVersion: built.version, opId: h.ids() });
    if (!applied.ok) throw new Error('not applied');

    // Week 1: Today's header and Your plan's strip.
    expect((await loaded(s)).block).toEqual({ text: 'Week 1 of 6', accessibilityLabel: 'Training block, week 1 of 6', deload: false, done: false });
    let ov = await s.plans.overview();
    expect(ov?.block).toMatchObject({ current: 1, done: false, header: 'Week 1 of 6', line: '6 weeks · Standard · deload week 6' });
    expect(ov?.block?.views).toHaveLength(6);
    const week1Before = JSON.stringify(ov?.block?.views[0]?.days.map((d) => d.rows));

    // Week 1's Push, then the next Monday: week 2. A normal week's workout is not marked (PM, 23 Oct).
    const week1Push = await doPush(s, gymId);
    expect((await s.workout.load(week1Push))?.aggregate.session.deload).toBeUndefined();
    nextMonday();
    expect((await loaded(s)).block?.text).toBe('Week 2 of 6');
    ov = await s.plans.overview();
    const w1 = ov?.block?.views[0];
    expect(w1?.readOnly).toBe(true);
    expect(w1?.days.filter((d) => d.done).map((d) => d.name)).toEqual(['Push']);
    expect(w1?.strip.map((c) => c.state)).toEqual(['done', 'current', 'todo', 'todo', 'todo', 'todo']);
    // A done week's planned rows never change (rule 2).
    expect(JSON.stringify(w1?.days.map((d) => d.rows))).toBe(week1Before);

    // An empty week holds the number (nothing missed).
    nextMonday();
    expect((await loaded(s)).block?.text).toBe('Week 2 of 6');

    // Weeks 2–5 with a plan workout each: week 6 is the deload.
    for (let i = 0; i < 4; i += 1) {
      await doPush(s, gymId);
      nextMonday();
    }
    const deloadWeek = await loaded(s);
    expect(deloadWeek.block).toMatchObject({ text: 'Week 6 of 6 · Deload', deload: true });
    const light = pushCard(s, deloadWeek);
    expect(light.why).toContain('Deload week: −10 % load, 1 set fewer');

    // The same day with the plan paused (no deload): the deload card is a set fewer (min 2), ≤ 90 % load, RPE ≤ 7.
    const inUse = await s.plans.inUse();
    if (inUse === null) throw new Error('no plan');
    const ov6 = await s.plans.overview();
    const paused = await s.plans.pause({ planId: inUse.planId, untilDate: null, expectedVersion: ov6?.planVersion ?? 0, opId: h.ids() });
    if (!paused.ok) throw new Error(paused.message);
    const pausedData = await loaded(s);
    expect(pausedData.block).toBeNull();
    const normal = work(pushCard(s, pausedData).draft?.unfitted ?? { blocks: [], restLevel: 'normal' });
    const lighter = work(light.draft?.unfitted ?? { blocks: [], restLevel: 'normal' });
    expect(lighter.map((x) => x.id)).toEqual(normal.map((x) => x.id));
    for (const [i, n] of normal.entries()) {
      const l = lighter[i];
      expect(l?.sets).toBe(deloadSetCount(n.sets));
      if (n.top !== null && l?.top != null) expect(l.top).toBeLessThanOrEqual(n.top * 0.9 + 1e-6);
      expect(l?.rpe ?? 0).toBeLessThanOrEqual(7);
    }
    const resumed = await s.plans.resumePause({ planId: inUse.planId, expectedVersion: paused.plan.version, opId: h.ids() });
    if (!resumed.ok) throw new Error(resumed.message);

    // Force-close: the week is derived again, the same.
    await h.forceClose();
    let { services: s2 } = await h.launch();
    expect((await loaded(s2)).block?.text).toBe('Week 6 of 6 · Deload');

    // The deload-week workout starts lighter; the plan day's template is never changed by it (rule 2).
    const pushRoutine = (await s2.plans.overview())?.days.find((d) => d.name === 'Push')?.routineId ?? '';
    const before = (await s2.routines.editor({ routineId: pushRoutine, gymId: null }))?.routine ?? null;
    // A stale Start (an older draft version) is refused (rule 5).
    const data6 = await loaded(s2);
    const day6 = data6.days.find((d) => d.name === 'Push');
    const controls6 = day6 === undefined ? undefined : data6.initial[day6.key];
    if (day6 === undefined || controls6 === undefined) throw new Error('no Push day');
    const c6 = await s2.todaySession.commit(data6, { dayKey: day6.key, controls: controls6 }, h.ids());
    if (!c6.ok) throw new Error('no commit');
    const stale = await s2.todaySession.start({ draftId: c6.draftId, expectedVersion: c6.version + 5, gymId, opId: h.ids(), checkIn: null });
    expect(stale.ok).toBe(false);
    const deloadSession = await doPush(s2, gymId);
    // Start planned the deload: the main lift's top set at ≤ 90 % of the same day's normal top, a set fewer.
    const agg = (await s2.workout.load(deloadSession))?.aggregate;
    const main = normal[0];
    const first = agg === undefined ? undefined : [...agg.exercises].sort((x, y) => x.order - y.order)[0];
    const firstSets = agg?.sets.filter((x) => x.sessionExerciseId === first?.id && x.setType !== 'warmup') ?? [];
    expect(first?.exerciseId).toBe(main?.id);
    expect(firstSets).toHaveLength(deloadSetCount(main?.sets ?? 0));
    // (PM, 23 Oct) Start marked it as the deload week's, stored with the workout (survives a relaunch).
    expect(agg?.session.deload).toEqual({ planId: inUse.planId, week: 6, of: 6 });
    const startedTop = firstSets.find((x) => x.setType === 'top')?.planned.load?.value ?? null;
    if (main?.top != null && startedTop !== null) expect(startedTop).toBeLessThanOrEqual(main.top * 0.9 + 1e-6);
    expect(startedTop).not.toBeNull();
    const after = (await s2.routines.editor({ routineId: pushRoutine, gymId: null }))?.routine ?? null;
    expect(before).not.toBeNull();
    expect(after?.version).toBe(before?.version);
    expect(JSON.stringify(after?.exercises)).toBe(JSON.stringify(before?.exercises));

    // Past week 6: the block is done; `Start next block` opens the builder with the same answers.
    nextMonday();
    await h.forceClose();
    ({ services: s2 } = await h.launch());
    expect((await s2.workout.load(deloadSession))?.aggregate.session.deload).toEqual({ planId: inUse.planId, week: 6, of: 6 });
    expect((await loaded(s2)).block).toMatchObject({ text: 'Block done', done: true, deload: false });
    const done = await s2.plans.overview();
    expect(done?.block).toMatchObject({ done: true, current: 6 });
    expect(done?.block?.views.every((v) => v.readOnly)).toBe(true);
    const next = await s2.planBuilder.open({ fromPlanId: inUse.planId });
    expect(next?.answers).toEqual(a);
    expect(next?.draft).toBeNull();
    if (next == null) throw new Error('no builder');
    // (PM, 23 Oct) The next block's lift checks (6-rep estimate, week-1 loads) start from a normal week, never the deload.
    const fromHistory = next.lifts(next.answers).flatMap((l) => (l.from?.kind === 'history' ? [l.from.atUtc] : []));
    expect(fromHistory.length).toBeGreaterThan(0);
    expect(fromHistory).not.toContain(agg?.session.startedAt.utc);
    const block2 = await s2.planBuilder.save(next, next.answers, null, h.ids());
    if (!block2.ok) throw new Error('not built');
    // A stale Apply (an older version) is refused; the right one applies and replaces the finished plan.
    expect((await s2.planBuilder.apply({ planId: block2.planId, versionN: block2.versionN, expectedVersion: block2.version + 1, opId: h.ids() })).ok).toBe(false);
    const applied2 = await s2.planBuilder.apply({ planId: block2.planId, versionN: block2.versionN, expectedVersion: block2.version, opId: h.ids() });
    expect(applied2.ok).toBe(true);
    expect((await s2.plans.inUse())?.planId).toBe(block2.planId);
    expect((await loaded(s2)).block?.text).toBe('Week 1 of 6');
  });

  it('no plan: no block on Today’s header and no weeks on Library', async () => {
    const { services: s } = await h.launch();
    await setUpGym(h, s);
    h.clockMs += DAY;
    expect((await loaded(s)).block).toBeNull();
    expect(await s.plans.overview()).toBeNull();
  });
});
