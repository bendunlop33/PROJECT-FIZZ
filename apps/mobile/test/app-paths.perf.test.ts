import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { NO_FILTERS, slotsOf } from '@fizz/domain';
import { loadSample, measureBlocking, timingBudget } from '@fizz/domain/testing';

import type { AppServices } from '../src/services/app-services';
import type { TodaySelection, TodaySessionData } from '../src/services/today-session';
import { openTemplate } from '../src/workout/template-editor';
import { bigDataset, type BigDataset } from './perf-dataset';

/**
 * (Ben, 23 Oct: "so slow"; `Set up a plan` took ~20 s on his iPhone) The everyday paths on his real-sized phone:
 * ~800 workouts, ~20k sets, one gym, an applied 4-day builder plan (`perf-dataset.ts`). Each path is what its
 * screen awaits and renders (services and their pure views). Node stands in for Hermes; `npm run
 * test:perf:jitless` runs this file without the JIT too (budgets ×4 there). Before the fix (same dataset, Node):
 * Today 93–202 s, Your workout from Today 223 s, an edit 218 s, from Library 261 s, Plan tab 30 s, plan builder
 * 35 s (details in the perf commit). On a loaded machine budgets scale (`timingBudget`).
 *
 * Cold reads: the first read after a launch decodes his history once (shared by Today, Your workout, the plan
 * builder and Progress, and started in the background at launch by Progress' prewarm); every later read reuses it.
 */

let big: BigDataset;
const timings: string[] = [];
const jitless = process.execArgv.includes('--jitless');
/** Hermes-like runs (no JIT) get 4× the time. */
const slow = jitless ? 4 : 1;
let startLoad = 0;

async function timed<T>(label: string, budgetMs: number, fn: () => Promise<T>): Promise<T> {
  const m = await measureBlocking(fn);
  const budget = timingBudget(budgetMs * slow, startLoad);
  timings.push(`${label}: ${String(Math.round(m.totalMs))} ms (budget ${String(Math.round(budget))})`);
  expect(m.totalMs, label).toBeLessThan(budget);
  return m.result;
}

beforeAll(async () => {
  big = await bigDataset({ plan: false });
  startLoad = loadSample();
}, 1_200_000);
afterAll(async () => {
  console.log(`[App paths]${jitless ? ' (--jitless)' : ''} ${String(big.sessions)} workouts, ${String(big.sets)} sets:\n  ${timings.join('\n  ')}`);
  await big.h.cleanup();
});

/** What Today's screen awaits on open, then the card it renders (the plan's next day, else the first). */
async function todayOpen(s: AppServices): Promise<{ data: TodaySessionData; sel: TodaySelection | null }> {
  await Promise.all([s.yourData.currentGym(), s.today.view(), s.sessions.active(), s.checkIns.unlinked()]);
  const data = await s.todaySession.load();
  if (data === null) throw new Error('no Today');
  const key = data.nextKey ?? data.days[0]?.key ?? null;
  const controls = key === null ? undefined : data.initial[key];
  const sel = key === null || controls === undefined ? null : { dayKey: key, controls };
  if (sel !== null) {
    s.todaySession.card(data, sel);
    await s.todaySession.movedLine(data, sel);
  }
  s.todaySession.strip(data, null);
  return { data, sel };
}

/** Your workout as the page opens it (read, land the coach's changes, its bar, the earlier drafts, Today's options). */
async function yourWorkout(s: AppServices, draftId: string, fromToday: boolean) {
  const snap = await s.builder.read(draftId);
  if (snap === null) throw new Error('no snapshot');
  await s.builder.landCoachChanges(draftId);
  await s.builderCoach.status();
  await s.builder.earlierEdits();
  if (fromToday) await s.builder.todayOptions(draftId);
  return snap;
}

describe('the everyday paths on ~800 workouts', () => {
  it('cold after a launch: Set up a plan and Today read his history once; after the launch pass both are quick', async () => {
    const { h } = big;
    await h.forceClose();
    let s = (await h.launch()).services;
    // Straight after a launch (nothing decoded yet): one pass over his history.
    await timed('Set up a plan, cold (just launched)', 8000, () => s.planBuilder.open());
    await s.progress.prewarm();
    const session = await timed('Set up a plan (after the launch pass)', 300, () => s.planBuilder.open());
    expect(session?.opensOn).toBe('start');
    await h.forceClose();
    s = (await h.launch()).services;
    await timed('Today, cold (just launched, no plan)', 8000, () => todayOpen(s));
  }, 1_200_000);

  it('Today, Time, Your workout, an edit, Library, Plan, the plan builder, Start, logging and Finish', async () => {
    const { h, gymId } = big;
    await h.forceClose();
    const s = (await h.launch()).services;
    await s.progress.prewarm();

    // Today with no plan (the split / Up next card), then again with nothing changed.
    const noPlan = await timed('Today (no plan)', 1500, () => todayOpen(s));
    expect(noPlan.data.status).toBe('no_plan');
    await timed('Today again, nothing changed (no plan)', 100, () => todayOpen(s));

    // The plan builder: open (his lifts), the plan, What to expect, Build; then Apply.
    const built = await timed('Plan builder: open, plan, Build', 600, async () => {
      const session = await s.planBuilder.open();
      if (session === null) throw new Error('no builder');
      const answers = { ...session.answers, split: 'ul' as const, sessions: 4, days: [0, 1, 3, 4] };
      session.lifts(answers);
      session.expect(answers);
      session.build(answers);
      const r = await s.planBuilder.save(session, answers, null, h.ids());
      if (!r.ok) throw new Error(`not built: ${r.reason}`);
      return r;
    });
    expect((await s.planBuilder.apply({ planId: built.planId, versionN: built.versionN, expectedVersion: built.version, opId: h.ids() })).ok).toBe(true);

    // Today with the plan.
    const first = await timed('Today (plan)', 1500, () => todayOpen(s));
    expect(first.data.status).toBe('plan');
    await timed('Today again, nothing changed (plan)', 100, () => todayOpen(s));
    const { data, sel } = first;
    if (sel === null) throw new Error('no card');

    // Time on Today: the card at each step (pure, in render).
    const minutes = [sel.controls.minutes - 15, sel.controls.minutes - 10, sel.controls.minutes - 5, sel.controls.minutes + 5, sel.controls.minutes + 10];
    await timed('Today Time, 5 steps', 250, () => {
      for (const m of minutes) s.todaySession.card(data, { ...sel, controls: { ...sel.controls, minutes: m } });
      return Promise.resolve();
    });

    // Your workout from Today's Edit, an edit there, and Today read again after it.
    const fromToday = await timed('Your workout from Today Edit', 1500, async () => {
      const c = await s.todaySession.commit(data, sel, h.ids());
      if (!c.ok) throw new Error(c.message);
      return yourWorkout(s, c.draftId, true);
    });
    const slot = slotsOf(fromToday.workout.blocks)[0];
    if (slot === undefined) throw new Error('no slot');
    const edit = await timed('Your workout edit (add a set)', 700, () => s.builder.edit(fromToday.draftId, { kind: 'add_set', slotKey: slot.key }, { opId: h.ids(), basis: { version: fromToday.version } }));
    expect(edit.status).toBe('written');
    await timed('Today after an edit', 1000, () => todayOpen(s));

    // Library › Plan, and a plan day's workout opened from it.
    const overview = await timed('Library Plan tab', 500, () => Promise.all([s.plans.overview(), s.plans.previous(), s.coach.availability()]));
    const routineId = overview[0]?.days[1]?.routineId ?? null;
    if (routineId === null) throw new Error('no plan day');
    await timed('Your workout from Library', 1500, async () => {
      const r = await s.builder.openTarget({ kind: 'routine', routineId }, h.ids());
      if (r.snapshot === null) throw new Error('not opened');
      return yourWorkout(s, r.snapshot.draftId, false);
    });

    // (Merged 24 Oct) Coach review's own reads before the model call: what was drafted, Time's cuts, his history per
    // exercise (the builder's cached reads, not a full read per exercise), focus and block week.
    await timed('Coach review context (Your workout)', 800, async () => {
      const w = await s.builder.coachWorld(fromToday.draftId);
      if (w?.review === undefined) throw new Error('no review world');
      for (const x of slotsOf(w.snapshot.workout.blocks)) w.review.refs(x.exerciseId);
      return w;
    });

    // (Merged 24 Oct) The one workout editor on a plan day: open (rows' facts at this gym), then Swap / Add's sheet.
    await timed('Edit workout (one editor): open a plan day, Swap sheet', 1000, async () => {
      const o = await openTemplate(s, { routineId });
      if (o === null) throw new Error('not opened');
      const inWorkout = o.list.map((x) => x.exerciseId);
      return s.builder.templateChoices({ gymId: o.data.gym?.id ?? null, inWorkout, exerciseId: inWorkout[0] ?? null });
    });

    // Library › Exercises, and a search keystroke.
    await timed('Library Exercises', 500, () => s.library.browse({ query: '', filters: NO_FILTERS }));
    await timed('Library Exercises, search "row"', 300, () => s.library.browse({ query: 'row', filters: NO_FILTERS }));

    // Start from Today (one tap) to the workout screen's first render.
    const today2 = (await todayOpen(s)).data;
    const sessionId = await timed('Start (Today, one tap)', 1000, async () => {
      await s.checkIns.gate();
      const c = await s.todaySession.commit(today2, sel, h.ids());
      if (!c.ok) throw new Error(c.message);
      const r = await s.todaySession.start({ draftId: c.draftId, expectedVersion: c.version, gymId, opId: h.ids(), checkIn: null });
      if (!r.ok) throw new Error(r.error.message);
      const d = await s.workout.load();
      if (d === null) throw new Error('no workout');
      s.workout.view(d, h.clockMs, null);
      return r.aggregate.session.id;
    });

    // Logging sets: the write, then what the workout screen reads and renders.
    for (let i = 0; i < 3; i += 1) {
      await timed(`Log a set (${String(i + 1)})`, 300, async () => {
        const d = await s.workout.load(sessionId);
        const setId = d?.aggregate.session.activeSetId ?? null;
        const set = d?.aggregate.sets.find((x) => x.id === setId);
        if (d == null || setId === null || set === undefined) throw new Error('no active set');
        h.clockMs += 90_000;
        const r = await s.workout.dispatch(sessionId, { type: 'log_set', at: h.now(), opId: h.ids(), setId, values: { load: set.planned.load, reps: set.planned.reps?.min ?? 8, durationS: null, rpe: 8, rir: null }, restTimerId: h.ids() });
        if (!r.ok) throw new Error(r.error.message);
        const fresh = await s.workout.load();
        if (fresh === null) throw new Error('no workout');
        s.workout.view(fresh, h.clockMs, null);
        s.workout.tableView(fresh, h.clockMs, null);
      });
    }

    // Finish → Summary (what its screen awaits).
    await timed('Finish and Summary', 800, async () => {
      const d = await s.workout.load(sessionId);
      if (d === null) throw new Error('no workout');
      h.clockMs += 60_000;
      const r = await s.workout.dispatch(sessionId, { type: 'finish', at: h.now(), opId: h.ids(), expectedVersion: d.aggregate.session.version, endedAt: null });
      if (!r.ok) throw new Error(r.error.message);
      await Promise.all([s.workout.summary(sessionId), s.backups.getStatus(), s.pain.active(), s.routines.list(), s.workout.planVsDone(sessionId)]);
      await Promise.all([s.coach.nextTargets(sessionId), s.coach.staleNextTargets(sessionId), s.coach.availability(), s.coach.summaryNote(sessionId), s.coach.ruleResets(sessionId)]);
    });
    await h.settle(s);
    // Today after Finish: one new workout in history (only it is read; the rest is reused).
    await timed('Today after Finish', 1500, () => todayOpen(s));
  }, 1_200_000);
});
