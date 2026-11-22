import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildExercisePickerView, NO_FILTERS, slotsOf } from '@fizz/domain';
import { loadSample, measureBlocking, timingBudget } from '@fizz/domain/testing';

import type { AppServices } from '../src/services/app-services';
import type { TodaySelection, TodaySessionData } from '../src/services/today-session';
import { buildRounds } from '../src/workout/rounds';
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
 * Cold reads (ADR 0032, Ben-approved 24 Oct): history reads read the stored per-workout history summaries, so the
 * first read after a launch decodes nothing (before: ~4 s Node, ~8 s jitless on this dataset); every later read
 * reuses what it parsed. The launch's background work waits until the first screen has read (`backgroundGate`).
 */

let big: BigDataset;
const timings: string[] = [];
const jitless = process.execArgv.includes('--jitless');
/** Hermes-like runs (no JIT) get 4× the time. */
const slow = jitless ? 4 : 1;
let startLoad = 0;

/** `jitlessMs`: the budget without the JIT, when it isn't 4× the Node one (the cold reads' targets, ADR 0032). */
async function timed<T>(label: string, budgetMs: number, fn: () => Promise<T>, jitlessMs?: number): Promise<T> {
  const m = await measureBlocking(fn);
  const budget = timingBudget(jitless && jitlessMs !== undefined ? jitlessMs : budgetMs * slow, startLoad);
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

/** A gate the test opens: the launch's background work waits for it (`backgroundGate`), as the phone's `afterLaunch` does. */
function launchGate(): { wait: () => Promise<void>; open: () => void } {
  let open = (): void => undefined;
  const p = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { wait: () => p, open };
}

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
  it('cold after a launch: Set up a plan and Today read stored history summaries, not every workout (ADR 0032)', async () => {
    const { h } = big;
    await h.forceClose();
    // As on the phone (`afterLaunch`), the launch's background work starts once the first screen has read.
    let gate = launchGate();
    let s = (await h.launch({ backgroundGate: gate.wait })).services;
    // Straight after a launch (nothing read yet): his history from the stored summaries (Ben, 24 Oct: < 500 ms, < 1.5 s jitless).
    await timed('Set up a plan, cold (just launched)', 500, () => s.planBuilder.open(), 1500);
    gate.open();
    await s.progress.prewarm();
    const session = await timed('Set up a plan (after the launch pass)', 300, () => s.planBuilder.open());
    expect(session?.opensOn).toBe('start');
    await h.forceClose();
    gate = launchGate();
    s = (await h.launch({ backgroundGate: gate.wait })).services;
    await timed('Today, cold (just launched, no plan)', 500, () => todayOpen(s), 1500);
    gate.open();
  }, 1_200_000);

  it('cold with the launch’s background work at once (a catch-up backup and the integrity check competing): still quick', async () => {
    const { h } = big;
    await h.forceClose();
    // No gate: the backup's export and the integrity check's engine pass each hold the database in one turn.
    const s = (await h.launch()).services;
    await timed('Today, cold, background work at once', 4000, () => todayOpen(s));
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

    // (Ben, 26 Oct) History from Today's `All history ›`: six weeks of stored summaries and activities, then `Show more`.
    const page = await timed('History (first six weeks)', 500, () => Promise.all([s.history.feed(), s.history.recentlyDeletedCount()]));
    expect(page[0].items.length).toBeGreaterThan(0);
    if (page[0].olderFrom !== null) {
      const from = page[0].olderFrom;
      await timed('History, Show more', 700, () => s.history.feed({ from }));
    }

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
      // (Ben, 25 Oct) The sheet reads every exercise at the editor's gym alongside its suggestions.
      return Promise.all([s.builder.templateChoices({ gymId: o.data.gym?.id ?? null, inWorkout, exerciseId: inWorkout[0] ?? null }), s.exercisePicker.forTemplate(o.data.gym?.id ?? null)]);
    });

    // (Ben, 25 Oct) Your workout's Swap sheet with every exercise: the suggestions and the full list read once on open
    // (what the sheet awaits, then its first render), then a search keystroke and a chip (pure over that read, no I/O).
    const swapSlot = slotsOf(fromToday.workout.blocks)[1] ?? slot;
    const inWorkout = slotsOf(fromToday.workout.blocks).map((x) => x.exerciseId);
    const sheet = await timed('Swap sheet (Your workout): open with every exercise', 800, async () => {
      const [choices, index] = await Promise.all([s.builder.exerciseChoices(fromToday.draftId, { slotKey: swapSlot.key }), s.exercisePicker.forDraft(fromToday.draftId)]);
      const suggested = (choices?.sections ?? []).flatMap((x) => x.items.map((i) => i.exerciseId));
      const v = buildExercisePickerView({ index, query: '', group: null, exclude: inWorkout, suggested });
      return { index, suggested, v };
    });
    expect(sheet.index.entries.length).toBeGreaterThan(150);
    expect(sheet.v.sections.length).toBeGreaterThan(4);
    await timed('Swap sheet: a search keystroke ("romanain")', 30, () => {
      const v = buildExercisePickerView({ index: sheet.index, query: 'romanain', group: null, exclude: inWorkout, suggested: sheet.suggested });
      expect(v.sections[0]?.parts[0]?.rows.some((r) => r.name === 'Romanian deadlift')).toBe(true);
      return Promise.resolve(v);
    });
    await timed('Swap sheet: the Legs chip (full list part)', 30, () => Promise.resolve(buildExercisePickerView({ index: sheet.index, query: '', group: 'Legs', exclude: inWorkout, suggested: sheet.suggested })));

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

    // (Ben, 25 Oct) Swap mid-workout: the suggestions and every exercise, read once on open, then its first render.
    await timed('Swap sheet (workout in progress): open with every exercise', 800, async () => {
      const d = await s.workout.load(sessionId);
      const row = d?.aggregate.exercises.find((e) => e.removed === undefined);
      if (d == null || row === undefined) throw new Error('no row');
      const [choices, index] = await Promise.all([s.workoutEdit.choices(sessionId, { sessionExerciseId: row.id }), s.exercisePicker.forSession(sessionId, row.id)]);
      const live = d.aggregate.exercises.filter((e) => e.removed === undefined).map((e) => e.exerciseId);
      return buildExercisePickerView({ index, query: '', group: null, exclude: live, suggested: (choices?.sections ?? []).flatMap((x) => x.items.map((i) => i.exerciseId)) });
    });

    // (Ben, 26 Oct) The table with a last-time line on every row (pure, in render), the pop-up's History (one read),
    // and the PB mark: its context read once per workout, then a pure check per log.
    const loaded = await s.workout.load(sessionId);
    if (loaded === null) throw new Error('no workout');
    const rounds = await timed('Workout table render with last-time lines', 50, () => {
      const t = s.workout.tableView(loaded, h.clockMs, null);
      return Promise.resolve(buildRounds(t, () => null, null));
    });
    expect(rounds.flatMap((r) => r.exercises.flatMap((e) => e.rows)).some((r) => r.row.last !== null)).toBe(true);
    const firstRow = loaded.aggregate.exercises.find((e) => e.removed === undefined);
    if (firstRow === undefined) throw new Error('no row');
    const glance = await timed('Exercise pop-up History open', 150, () => s.workout.exerciseGlance(sessionId, firstRow.id));
    expect(glance?.rows.length ?? 0).toBeGreaterThan(0);
    const bests = await timed('PB context (once per workout)', 1500, () => s.reviews.liveBestsContext());
    if (bests !== null) {
      // The first check (at open, in render) learns each lift's earlier best; every log after it is the warm one.
      await timed('PB check, first (pure, at open)', 30, () => Promise.resolve(s.reviews.liveNewBests(bests, loaded.aggregate)));
      await timed('PB check on a log (pure, warm)', 10, () => Promise.resolve(s.reviews.liveNewBests(bests, loaded.aggregate)));
    }

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
