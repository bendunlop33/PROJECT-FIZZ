import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { slotsOf } from '@fizz/domain';
import type { PlanWarmups, SessionAggregate } from '@fizz/schemas';

import type { BuilderSnapshot } from '../src/builder/builder-service';
import { dayViews, weekRowValue } from '../src/plan-builder/plan-builder-view';
import type { AppServices } from '../src/services/app-services';
import { createHarness, logWorkout, setUpGym, type Harness } from './harness';

/**
 * (Ben, 23 Oct) Your week › Warm-ups (Full / Short / None) end to end on real SQLite, offline: the setting is stored with
 * the plan's answers, each plan day's warm-up time and minutes follow it, and once the plan is applied Today's card,
 * Your workout (the same draft) and Start plan the plan's days' warm-ups that way; Ben's own warm-up on an exercise
 * still wins; a force-close between commit and Start changes nothing.
 */

const DAY = 86_400_000;
let h: Harness;
beforeEach(() => {
  h = createHarness('2026-10-23T07:00:00.000Z');
});
afterEach(async () => {
  await h.cleanup();
});

const ok = <T extends { status: string }>(r: T): Extract<T, { status: 'written' | 'replayed' }> => {
  if (r.status !== 'written' && r.status !== 'replayed') throw new Error(`write ${r.status}`);
  return r as Extract<T, { status: 'written' | 'replayed' }>;
};

async function benWithPlan(warmups: PlanWarmups): Promise<{ s: AppServices; gymId: string }> {
  const { services: s } = await h.launch();
  const gymId = await setUpGym(h, s);
  await logWorkout(h, s, gymId, [
    { exercise: 'Bench press', sets: [{ load: 100, reps: 6, rpe: 8 }, { load: 100, reps: 6, rpe: 8 }] },
    { exercise: 'Triceps pushdown', sets: [{ load: 25, reps: 11, rpe: 8 }, { load: 25, reps: 11, rpe: 8 }] },
  ]);
  h.clockMs += DAY;
  const session = await s.planBuilder.open();
  if (session === null) throw new Error('no session');
  expect(session.answers.warmups).toBe('full');
  const a = { ...session.answers, split: 'ppl' as const, sessions: 3, days: [0, 2, 4], warmups };
  const built = await s.planBuilder.save(session, a, null, h.ids());
  if (!built.ok) throw new Error('not built');
  const applied = await s.planBuilder.apply({ planId: built.planId, versionN: built.versionN, expectedVersion: built.version, opId: h.ids() });
  if (!applied.ok) throw new Error('not applied');
  return { s, gymId };
}

/** Today's Push card committed as today's Your workout draft. */
async function pushDraft(s: AppServices, tag: string): Promise<{ snap: BuilderSnapshot; version: number }> {
  const data = await s.todaySession.load();
  if (data === null) throw new Error('no Today data');
  const day = data.days.find((d) => d.name === 'Push');
  const controls = day === undefined ? undefined : data.initial[day.key];
  if (day === undefined || controls === undefined) throw new Error('no Push day');
  const c = await s.todaySession.commit(data, { dayKey: day.key, controls }, `commit-${tag}`);
  if (!c.ok) throw new Error(c.message);
  const snap = await s.builder.read(c.draftId);
  if (snap === null) throw new Error('no draft');
  return { snap, version: c.version };
}

const warmCounts = (snap: BuilderSnapshot): Record<string, number> => Object.fromEntries(slotsOf(snap.workout.blocks).map((sl) => [snap.facts[sl.exerciseId]?.name ?? sl.exerciseId, sl.rows.filter((r) => r.type === 'warmup').length]));
const storedWarm = (a: SessionAggregate): Record<string, number> => Object.fromEntries(a.exercises.map((e) => [e.exerciseName, a.sets.filter((x) => x.sessionExerciseId === e.id && x.setType === 'warmup' && x.status !== 'deleted').length]));
const mainName = (snap: BuilderSnapshot): string => {
  const m = slotsOf(snap.workout.blocks).find((x) => x.main);
  return m === undefined ? '' : (snap.facts[m.exerciseId]?.name ?? '');
};

describe('Warm-ups setting flows from the plan builder to Start', () => {
  it('the plan’s day cards show each day’s own warm-up time in their minutes; Short and None show less', async () => {
    const { services: s } = await h.launch();
    const gymId = await setUpGym(h, s);
    await logWorkout(h, s, gymId, [{ exercise: 'Bench press', sets: [{ load: 100, reps: 6, rpe: 8 }] }]);
    h.clockMs += DAY;
    const session = await s.planBuilder.open();
    if (session === null) throw new Error('no session');
    const at = (warmups: PlanWarmups) => session.build({ ...session.answers, warmups });
    const full = at('full');
    expect(new Set(full.days.map((d) => d.warmupS)).size).toBeGreaterThan(1);
    const views = dayViews(full, session.answers, session.nameOf);
    full.days.forEach((d, i) => {
      expect(views[i]?.right).toBe(`${String(d.exercises.length)} ex · ~${String(d.minutes)}′`);
      expect(views[i]?.sub).toContain(`warm-up ${String(Math.max(1, Math.round(d.warmupS / 60)))}′`);
    });
    const none = at('none');
    expect(none.days.every((d) => d.warmupS === 0)).toBe(true);
    expect(dayViews(none, session.answers, session.nameOf).some((v) => v.sub.includes('warm-up'))).toBe(false);
    at('short').days.forEach((d, i) => {
      expect(d.warmupS).toBeLessThan(full.days[i]?.warmupS ?? 0);
    });
    expect(weekRowValue({ ...session.answers, warmups: 'short' })).toBe('4 days · 60 min · short warm-ups');
    expect(weekRowValue({ ...session.answers, warmups: 'none' })).toBe('4 days · 60 min · no warm-ups');
  });

  it('None: Today’s card and Start plan no warm-ups; one Ben adds on Your workout is kept; a force-close keeps it all', async () => {
    const { s, gymId } = await benWithPlan('none');
    const opened = await s.planBuilder.open();
    // No open builder plan once applied; the plan in use keeps its answers.
    expect(opened?.draft).toBeNull();
    const { snap } = await pushDraft(s, 'none');
    expect(Object.values(warmCounts(snap)).every((n) => n === 0)).toBe(true);

    // Your workout's own warm-up editing still overrides, per exercise.
    const main = slotsOf(snap.workout.blocks).find((x) => x.main);
    if (main === undefined) throw new Error('no main lift');
    const edited = ok(await s.builder.edit(snap.draftId, { kind: 'add_warmup', slotKey: main.key }, { opId: 'add-warm', basis: { version: snap.version } })).snapshot;
    const counts = warmCounts(edited);
    expect(counts[mainName(edited)]).toBe(1);
    for (const [name, n] of Object.entries(counts)) if (name !== mainName(edited)) expect(n, name).toBe(0);

    // Force-close and relaunch before Start: the draft is as Ben left it.
    await h.forceClose();
    const { services: s2 } = await h.launch();
    const read = await s2.builder.read(edited.draftId);
    if (read === null) throw new Error('draft lost');
    expect(warmCounts(read)).toEqual(counts);

    const started = await s2.todaySession.start({ draftId: read.draftId, expectedVersion: read.version, gymId, opId: 'start-none', checkIn: null });
    if (!started.ok) throw new Error(started.error.message);
    const stored = storedWarm(started.aggregate);
    expect(stored[mainName(read)]).toBe(1);
    for (const [name, n] of Object.entries(stored)) if (name !== mainName(read)) expect(n, name).toBe(0);
  });

  it('Short: the main lift keeps WU11’s short ladder and other exercises none, on Today, Your workout and Start; Full has more', async () => {
    const { s, gymId } = await benWithPlan('short');
    const { snap } = await pushDraft(s, 'short');
    const name = mainName(snap);
    const counts = warmCounts(snap);
    expect(counts[name]).toBe(2);
    for (const [n, c] of Object.entries(counts)) if (n !== name) expect(c, n).toBe(0);
    const started = await s.todaySession.start({ draftId: snap.draftId, expectedVersion: snap.version, gymId, opId: 'start-short', checkIn: null });
    if (!started.ok) throw new Error(started.error.message);
    expect(storedWarm(started.aggregate)).toEqual(counts);
    // Every stored warm-up is an achievable load below the first working set (rule 4).
    const ex = started.aggregate.exercises.find((e) => e.exerciseName === name);
    const sets = started.aggregate.sets.filter((x) => x.sessionExerciseId === ex?.id).sort((x, y) => x.index - y.index);
    const W = sets.find((x) => x.setType !== 'warmup')?.planned.load?.value ?? 0;
    for (const w of sets.filter((x) => x.setType === 'warmup')) expect(w.planned.load?.value ?? Infinity).toBeLessThan(W);
  });

  it('Full (the default): the main lift gets its full ladder', async () => {
    const { s } = await benWithPlan('full');
    const { snap } = await pushDraft(s, 'full');
    expect(warmCounts(snap)[mainName(snap)]).toBeGreaterThan(2);
  });
});
