import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { toMs } from '@fizz/domain';

import type { AppServices } from '../src/services/app-services';
import type { TodaySessionData } from '../src/services/today-session';
import { finishWorkout } from './finish-workout';
import { createHarness, logWorkout, setUpGym, type Harness } from './harness';

/**
 * (Ben, 31 Oct 17:57: "Up next shows Push B; it should be Pull B") Synthetic data of the same shape as his week, on
 * real SQLite. A 6-day Set days plan (Mon Push A … Sat Legs B). Done: Legs Mon (off-plan), a pull workout Tue logged
 * off the plan (no plan day, as an import has none), Push A Wed (started as the plan day), Legs B Fri. Thu: Push B
 * started and discarded after a few seconds; Push B moved Thu → Fri. Sat morning: Push B moved onto Sat with the day
 * sheet.
 *
 * - With no move onto today: Pull B (pull last Tue, push last Wed). The discarded Push B, the off-plan pull and the
 *   `Push A` name all read correctly.
 * - With Push B moved onto today: Push B (rule 5 of `up-next-order.ts`: a day Ben moved onto the planning day this
 *   week is first of the open days). Undo of that move gives Pull B back.
 */

let h: Harness;
beforeEach(() => {
  h = createHarness('2026-10-26T07:00:00.000Z');
});
afterEach(async () => {
  await h.cleanup();
});

async function loaded(s: AppServices): Promise<TodaySessionData> {
  const d = await s.todaySession.load();
  if (d === null) throw new Error('no Today');
  return d;
}
const nextName = (d: TodaySessionData) => d.days.find((x) => x.key === d.nextKey)?.name ?? null;

async function applyPlan(s: AppServices): Promise<void> {
  const session = await s.planBuilder.open();
  if (session === null) throw new Error('no builder');
  const a = { ...session.answers, split: 'ppl' as const, sessions: 6, schedule: 'set' as const, days: [0, 1, 2, 3, 4, 5] };
  const built = await s.planBuilder.save(session, a, null, h.ids());
  if (!built.ok) throw new Error('not built');
  const applied = await s.planBuilder.apply({ planId: built.planId, versionN: built.versionN, expectedVersion: built.version, opId: h.ids() });
  if (!applied.ok) throw new Error('not applied');
}

/** Starts a plan day from Today's card at `at`: finished a minute later, or discarded at once (`discard`). */
async function startDay(s: AppServices, gymId: string, at: string, name: string, discard = false): Promise<void> {
  h.clockMs = Date.parse(at);
  const d = await loaded(s);
  const day = d.days.find((x) => x.name === name);
  const controls = day === undefined ? undefined : d.initial[day.key];
  if (day === undefined || controls === undefined) throw new Error(`no ${name}`);
  const c = await s.todaySession.commit(d, { dayKey: day.key, controls }, h.ids());
  if (!c.ok) throw new Error(c.message);
  const r = await s.todaySession.start({ draftId: c.draftId, expectedVersion: c.version, gymId, opId: h.ids(), checkIn: null });
  if (!r.ok) throw new Error('not started');
  const id = r.aggregate.session.id;
  if (discard) {
    h.clockMs += 3_000;
    const a = await s.workout.load(id);
    const out = await s.workout.dispatch(id, { type: 'discard', at: h.now(), opId: h.ids(), expectedVersion: a?.aggregate.session.version ?? 0, confirmedLoggedSets: 0 });
    if (!out.ok) throw new Error(out.error.message);
    return;
  }
  h.clockMs += 60_000;
  await finishWorkout(h, s, id);
}

async function bensWeek(s: AppServices): Promise<void> {
  const gymId = await setUpGym(h, s);
  await applyPlan(s);
  h.clockMs = Date.parse('2026-10-26T18:37:00.000Z');
  await logWorkout(h, s, gymId, [
    { exercise: 'Back squat', sets: [{ load: 100, reps: 5 }, { load: 100, reps: 5 }, { load: 100, reps: 5 }] },
    { exercise: 'Romanian deadlift', sets: [{ load: 80, reps: 8 }, { load: 80, reps: 8 }] },
  ]);
  // Tue: a pull workout with no plan day (as an imported one).
  h.clockMs = Date.parse('2026-10-27T18:30:00.000Z');
  await logWorkout(h, s, gymId, [
    { exercise: 'Barbell row', sets: [{ load: 60, reps: 8 }, { load: 60, reps: 8 }, { load: 60, reps: 8 }] },
    { exercise: 'Lat pulldown', sets: [{ load: 50, reps: 10 }, { load: 50, reps: 10 }] },
  ]);
  await startDay(s, gymId, '2026-10-28T18:04:00.000Z', 'Push A');
  // Thu: Push B started and discarded; then moved Thu → Fri.
  await startDay(s, gymId, '2026-10-29T15:31:00.000Z', 'Push B', true);
  const ov = await s.plans.overview();
  if (ov == null) throw new Error('no plan');
  expect(await s.plans.weekChange({ planId: ov.planId, expectedVersion: ov.planVersion, opId: 'push-b-fri', change: { kind: 'place', moves: [{ dayIndex: 3, weekday: 4 }] } })).toMatchObject({ ok: true });
  await startDay(s, gymId, '2026-10-30T20:12:00.000Z', 'Legs B');
}

describe('Up next on Sat 31 after Ben’s week (Ben, 31 Oct 17:57)', () => {
  it('no move onto today: Pull B (the discarded Push B, the off-plan pull and the Push A name all read right)', async () => {
    const { services: s } = await h.launch();
    await bensWeek(s);
    h.clockMs = toMs('2026-10-31T17:57:00.000Z');
    expect(nextName(await loaded(s))).toBe('Pull B');
  });

  it('Push B moved onto Sat with the day sheet: Push B (his move wins, rule 5); Undo gives Pull B back', async () => {
    const { services: s } = await h.launch();
    await bensWeek(s);
    h.clockMs = toMs('2026-10-31T10:34:00.000Z');
    const ov = await s.plans.overview();
    if (ov == null) throw new Error('no plan');
    const moved = await s.plans.weekChange({ planId: ov.planId, expectedVersion: ov.planVersion, opId: 'push-b-sat', change: { kind: 'place', moves: [{ dayIndex: 3, weekday: 5 }] } });
    expect(moved).toMatchObject({ ok: true });
    h.clockMs = toMs('2026-10-31T17:57:00.000Z');
    const d = await loaded(s);
    expect(nextName(d)).toBe('Push B');
    expect(s.todaySession.week(d, nextName(d)).slice(5).map((t) => `${t.date.slice(8)} ${t.marks.map((m) => `${m.shape}:${m.colour}`).join(' ')}`)).toEqual(['31 ring:push', '01 ring:pull']);
    const now = await s.plans.overview();
    if (now == null) throw new Error('no plan');
    expect(await s.plans.undoWeekChange({ planId: now.planId, expectedVersion: now.planVersion, opId: 'undo-push-b-sat' })).toMatchObject({ ok: true });
    expect(nextName(await loaded(s))).toBe('Pull B');
  });
});
