import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { ModelEvent, ModelRequest } from '@fizz/coach';
import { addDays, localDateOf, toMs } from '@fizz/domain';

import type { AppServices } from '../src/services/app-services';
import type { TodaySessionData, TodaySelection } from '../src/services/today-session';
import { CONNECTED, replyWith, StepModel, toolCall } from './coach-model';
import { createHarness, logWorkout, setUpGym, TZ, type Harness } from './harness';

/**
 * `todaySession` end to end on real SQLite (workout-builder-v3 §2.0 Today
 * (v2)): the plan's days and Up next, the five controls → the card, nothing
 * written by picking, Start (one tap) from the committed builder draft with
 * the card's own loads and plan-day provenance, Up next moving on, an edited
 * draft never overwritten, stale and duplicate Starts, the strip and the
 * clash line from what Ben logged only, honest review status.
 */

const DAY = 86_400_000;
let h: Harness;
let model: StepModel;
beforeEach(() => {
  model = new StepModel([]);
  // Monday 12 Oct 2026, 08:00 in London.
  h = createHarness('2026-10-12T07:00:00.000Z', { coach: { model: () => model, connection: () => Promise.resolve(CONNECTED) } });
});
afterEach(async () => {
  await h.cleanup();
});

type Ex = [string, Record<string, unknown>?];
const ex = (catalogueId: string, over: Record<string, unknown> = {}) => ({ catalogueId, warmups: null, workingSets: 3, reps: { min: 8, max: 10 }, workSeconds: null, targetRpe: 8, topSet: null, restSeconds: null, superset: null, load: null, ...over });
const kgLoad = (value: number, convention = 'total') => ({ value, unit: 'kg', convention, basis: 'last time, same reps', from: 'own_history', relatedCatalogueId: null });
const FOUR: [string, string | null, Ex[]][] = [
  ['Push', 'push', [['Bench press', { reps: { min: 6, max: 8 }, load: kgLoad(100) }], ['Incline dumbbell press', { load: kgLoad(27.5, 'per_hand') }]]],
  ['Pull', 'pull', [['Lat pulldown', { load: kgLoad(60, 'stack') }], ['Barbell row', { reps: { min: 6, max: 8 }, load: kgLoad(70) }]]],
  ['Legs', 'legs', [['Back squat', { reps: { min: 5, max: 6 }, load: kgLoad(100) }]]],
  ['Upper', null, [['Overhead press', { reps: { min: 6, max: 8 }, load: kgLoad(50) }]]],
];

function usableOf(req: ModelRequest): { catalogueId: string; name: string }[] {
  const block = req.input.find((i) => i.type === 'message' && i.role === 'developer' && i.content.startsWith('YOUR DATA'));
  if (block?.type !== 'message') throw new Error('no context');
  const data = JSON.parse(block.content.slice(block.content.indexOf('\n') + 1)) as { build?: { usable: { catalogueId: string; name: string }[] } };
  if (data.build === undefined) throw new Error('not a build turn');
  return data.build.usable;
}
const planStub = (req: ModelRequest): ModelEvent[] => {
  const usable = usableOf(req);
  const idOf = (name: string) => usable.find((u) => u.name === name)?.catalogueId ?? `missing-${name}`;
  return toolCall('propose_plan', { days: FOUR.map(([dayName, splitDayId, exs]) => ({ dayName, splitDayId, focus: null, minutes: null, exercises: exs.map(([n, over]) => ex(idOf(n), over ?? {})) })), message: 'Push, pull, legs, upper.', minutes: null, gymName: null });
};

async function benWithPlan() {
  const { services: s } = await h.launch();
  const gymId = await setUpGym(h, s);
  await logWorkout(h, s, gymId, [{ exercise: 'Bench press', sets: [{ load: 100, reps: 7, rpe: 8 }, { load: 100, reps: 7, rpe: 8 }] }]);
  h.clockMs += DAY;
  await logWorkout(h, s, gymId, [{ exercise: 'Lat pulldown', sets: [{ load: 60, reps: 10, rpe: 8 }, { load: 60, reps: 10, rpe: 8 }] }]);
  h.clockMs += DAY;
  await logWorkout(h, s, gymId, [{ exercise: 'Back squat', sets: [{ load: 100, reps: 5, rpe: 8 }, { load: 100, reps: 5, rpe: 8 }] }]);
  h.clockMs += DAY;
  model = new StepModel([planStub, () => replyWith('Here is your week.')]);
  const r = await s.coach.send({ entry: { kind: 'today' }, threadId: null, input: { kind: 'words', text: 'Build me a 4-day plan', spoken: false }, turnId: h.ids() });
  const card = r.cards[0]?.record;
  if (card?.detail.kind !== 'build_plan') throw new Error('no plan');
  const planId = card.detail.planId;
  const c = await s.plans.card({ planId, versionN: 1 });
  expect(await s.plans.apply({ planId, versionN: 1, expectedVersion: c?.planVersion ?? 0, mode: 'replace', opId: 'apply-1' })).toMatchObject({ ok: true });
  h.clockMs += 3_600_000;
  return { s, gymId, planId };
}

async function loaded(s: AppServices): Promise<TodaySessionData> {
  const d = await s.todaySession.load();
  if (d === null) throw new Error('no data');
  return d;
}
const sel = (data: TodaySessionData, dayKey: string, over: Partial<TodaySelection['controls']> = {}): TodaySelection => {
  const c = data.initial[dayKey];
  if (c === undefined) throw new Error(`no controls for ${dayKey}`);
  return { dayKey, controls: { ...c, ...over } };
};
const dayKeyOf = (data: TodaySessionData, name: string) => data.days.find((d) => d.name === name)?.key ?? data.others.find((d) => d.name === name)?.key ?? '';
const nbsp = (t: string | null | undefined) => (t ?? '').replaceAll('\u00a0', ' ');

describe('Today (v2) session card from the plan', () => {
  it('days in plan order with NEXT; the card from the controls; picking writes nothing; Start in one tap from the committed draft with the card’s loads and plan-day provenance; Up next moves on', async () => {
    const { s, gymId, planId } = await benWithPlan();
    const data = await loaded(s);
    expect(data.status).toBe('plan');
    expect(data.days.map((d) => d.name)).toEqual(['Push', 'Pull', 'Legs', 'Upper']);
    // Up next is the app's own (adaptive plan day): the same day Today's old card named.
    const up = await s.next.preview(gymId);
    expect(data.days.find((d) => d.key === data.nextKey)?.name).toBe(up?.title);
    expect(data.others.map((d) => d.name)).toEqual(['Full body', 'Upper', 'Push']);
    expect(data.review).toBe('not_reviewed');

    const pushKey = dayKeyOf(data, 'Push');
    const push = s.todaySession.card(data, sel(data, pushKey));
    if (push === null) throw new Error('no card');
    expect(push.title).toBe('Push');
    expect(nbsp(push.summary)).toMatch(/^\d+ exercises · ~\d+ min$/);
    expect(push.minutes).toBeLessThanOrEqual(data.initial[pushKey]?.minutes ?? 0);
    expect(push.rows[0]?.name).toBe('Bench press');
    expect(push.why.at(-1)).toBe('Not reviewed');
    // The plan's bench target, through the template's dry run (rounded down here, rule 4).
    expect(Number(push.rows[0]?.top)).toBeGreaterThan(0);

    // Time −15 trims with one line; the main lift stays.
    const short = s.todaySession.card(data, sel(data, pushKey, { minutes: (data.initial[pushKey]?.minutes ?? 60) - 15 }));
    expect(nbsp(short?.fitLine)).toMatch(/^To fit \d+ min: /);
    expect(short?.rows[0]?.name).toBe('Bench press');
    // Supersets off: no pairs.
    expect(s.todaySession.card(data, sel(data, pushKey, { supersets: false }))?.rows.every((r) => r.superset === null)).toBe(true);
    // Abs: the plan has none; on adds one, `plan: off` shows.
    const absOn = s.todaySession.card(data, sel(data, pushKey, { abs: true, minutes: 75 }));
    expect(absOn?.controls.abs).toEqual({ on: true, planOn: false, differs: true });

    // Picking days and controls wrote nothing.
    const before = await s.coachDrafts.list();
    for (const d of [...data.days, ...data.others]) s.todaySession.card(data, sel(data, d.key));
    expect(await s.coachDrafts.list()).toEqual(before);

    // Start: commit (idempotent) then start (one tap from the screen).
    const c1 = await s.todaySession.commit(data, sel(data, pushKey), 'commit-1');
    if (!c1.ok) throw new Error(c1.message);
    expect(await s.todaySession.commit(data, sel(data, pushKey), 'commit-1')).toEqual(c1);
    // The same workout from a new tap: the same draft, no new version.
    expect(await s.todaySession.commit(data, sel(data, pushKey), 'commit-2')).toEqual(c1);
    // A builder draft is never listed FROM COACH.
    expect(await s.coachDrafts.list()).toEqual(before);
    // A changed control: a new version of the same draft (Today's own, so not `edited`).
    const longer = (data.initial[pushKey]?.minutes ?? 45) + 15;
    const c3 = await s.todaySession.commit(data, sel(data, pushKey, { minutes: longer }), 'commit-3');
    if (!c3.ok) throw new Error(c3.message);
    expect(c3.draftId).toBe(c1.draftId);
    expect(c3.version).toBeGreaterThan(c1.version);
    const reloaded = await loaded(s);
    expect(s.todaySession.card(reloaded, sel(reloaded, pushKey))?.edited).toBeNull();

    // A stale version is refused (rule 5); the right one starts.
    expect(await s.todaySession.start({ draftId: c1.draftId, expectedVersion: c1.version, gymId, opId: 'start-stale', checkIn: null })).toMatchObject({ ok: false, error: { code: 'stale_draft' } });
    const card3 = s.todaySession.card(reloaded, sel(reloaded, pushKey, { minutes: longer }));
    const started = await s.todaySession.start({ draftId: c3.draftId, expectedVersion: c3.version, gymId, opId: 'start-1', checkIn: { kind: 'skipped', atUtc: h.now().utc } });
    if (!started.ok) throw new Error(JSON.stringify(started.error));
    const a = started.aggregate;
    expect(a.session.planDay).toMatchObject({ planId, dayIndex: 0 });
    expect(a.session.planDay?.templateRoutineId).not.toBeNull();
    expect(a.session.coachDraft?.draftId).toBe(c3.draftId);
    // The card's top set is what the workout plans (the draft's own loads, pinned).
    const bench = a.exercises.find((e) => e.exerciseId === reloaded.days[0]?.templates[0]?.mainLiftExerciseId);
    const top = a.sets.filter((x) => x.sessionExerciseId === bench?.id && x.setType !== 'warmup').map((x) => x.planned.load?.value ?? 0);
    expect(String(Math.max(...top))).toBe(card3?.rows[0]?.top);
    expect(a.exercises.filter((e) => e.removed === undefined)).toHaveLength(card3?.exerciseCount ?? -1);
    // A repeat of the same tap is the same workout.
    expect(await s.todaySession.start({ draftId: c3.draftId, expectedVersion: c3.version, gymId, opId: 'start-1', checkIn: null })).toMatchObject({ ok: true, duplicate: true });
    const d = await s.coachDrafts.get(c3.draftId);
    expect(d?.status).toBe('started');

    // Finish: Up next credits the plan day it was started as, and moves on.
    for (const set of a.sets) {
      if (set.status !== 'pending' || set.setType === 'warmup') continue;
      h.clockMs += 60_000;
      const r = await s.workout.dispatch(a.session.id, { type: 'log_set', at: h.now(), opId: `log:${set.id}`, setId: set.id, values: { load: set.planned.load ?? { value: 20, unit: 'kg', convention: a.exercises.find((e) => e.id === set.sessionExerciseId)?.loadConvention ?? 'total' }, reps: set.planned.reps?.min ?? 8, durationS: null, rpe: 8, rir: null }, restTimerId: h.ids() });
      if (!r.ok) throw new Error(r.error.message);
    }
    const now = await s.workout.load(a.session.id);
    const fin = await s.workout.dispatch(a.session.id, { type: 'finish', at: h.now(), opId: h.ids(), expectedVersion: now?.aggregate.session.version ?? 0, endedAt: null });
    if (!fin.ok) throw new Error(fin.error.message);
    await h.settle(s);
    const after = await loaded(s);
    expect(after.nextKey).not.toBe(pushKey);
    expect(after.doneToday).toBe(true);
    // The strip shows today's workout done.
    const strip = s.todaySession.strip(after, null);
    expect(strip.find((c) => c.today)?.items[0]).toMatchObject({ kind: 'workout' });
  });

  it('a draft changed outside Today (the builder) shows as `· edited` and is never overwritten by Today', async () => {
    const { s } = await benWithPlan();
    const data = await loaded(s);
    const key = data.nextKey ?? '';
    const longer = (data.initial[key]?.minutes ?? 45) + 20;
    const c1 = await s.todaySession.commit(data, sel(data, key, { minutes: longer }), 'commit-e1');
    const c2 = await s.todaySession.commit(data, sel(data, key), 'commit-e2');
    if (!c1.ok || !c2.ok) throw new Error('commit');
    expect(c2.draftId).toBe(c1.draftId);
    // A write that isn't Today's (here the drafts' own versioned Undo; the builder's edits are the same kind).
    h.clockMs += 60_000;
    const u = await s.coachDrafts.undoVersion({ draftId: c2.draftId, versionN: 2, expectedVersion: c2.version, opId: 'undo-v2' });
    expect(u).toMatchObject({ ok: true });
    const again = await loaded(s);
    const view = s.todaySession.card(again, sel(again, key));
    expect(view?.title).toMatch(/· edited$/);
    expect(view?.edited?.draftId).toBe(c1.draftId);
    expect(view?.exerciseCount).toBe(s.todaySession.card(data, sel(data, key, { minutes: longer }))?.exerciseCount);
    // Today's commit hands back the edited draft as it is: nothing is overwritten.
    const kept = await s.todaySession.commit(again, sel(again, key), 'commit-e3');
    expect(kept).toEqual({ ok: true, draftId: c1.draftId, version: view?.edited?.version });
  });

  it('Mix it up cycles a shortlist (today only); Undo is the code draft again', async () => {
    const { s } = await benWithPlan();
    const data = await loaded(s);
    const key = dayKeyOf(data, 'Push');
    const base = s.todaySession.card(data, sel(data, key, { minutes: 75 }));
    expect(base?.mixAvailable).toBe(true);
    const one = s.todaySession.card(data, sel(data, key, { minutes: 75, mix: 1 }));
    expect(one?.mix?.text).toMatch(/ → .* · today only$/);
    expect(one?.mix?.another).toMatch(/^Another \(1\/\d+\)$/);
    expect(one?.mix?.notReviewed).toBe(true);
    expect(one?.rows[0]?.name).toBe('Bench press');
    expect(s.todaySession.card(data, sel(data, key, { minutes: 75, mix: 0 }))?.rows.map((r) => r.name)).toEqual(base?.rows.map((r) => r.name));
  });

  it('Other sessions: Push from ⋯ starts with no plan day (Up next is credited by what was trained)', async () => {
    const { s, gymId } = await benWithPlan();
    const data = await loaded(s);
    const key = data.others.find((d) => d.name === 'Push')?.key ?? '';
    const card = s.todaySession.card(data, sel(data, key));
    expect(card?.title).toBe('Push');
    const c = await s.todaySession.commit(data, sel(data, key), 'commit-o');
    if (!c.ok) throw new Error(c.message);
    const r = await s.todaySession.start({ draftId: c.draftId, expectedVersion: c.version, gymId, opId: 'start-o', checkIn: null });
    if (!r.ok) throw new Error(JSON.stringify(r.error));
    expect(r.aggregate.session.planDay).toBeUndefined();
  });

  it('the strip and the clash line come only from what Ben logged; the review line says why there is no review', async () => {
    const { services: s } = await h.launch();
    await setUpGym(h, s);
    let data = await loaded(s);
    expect(data.status).toBe('no_plan');
    expect(s.todaySession.strip(data, null).flatMap((c) => c.items).some((i) => i.kind === 'activity')).toBe(false);
    const today = localDateOf(toMs(h.now().utc), TZ);
    const add = await s.activities.add({ id: h.ids(), opId: 'act-1', fields: { kind: 'run', status: 'planned', date: addDays(today, 1), durationS: null, distanceM: 18_000, effort: 'long' } });
    expect(add.ok).toBe(true);
    data = await loaded(s);
    const cells = s.todaySession.strip(data, null);
    const tomorrow = cells.find((c) => c.date === addDays(today, 1));
    expect(tomorrow?.items[0]).toMatchObject({ kind: 'activity', planned: true, text: 'Run 18k' });
    expect(tomorrow?.accessibilityLabel).toContain('Planned');
    // A leg session the day before a long run: the `!` line; Start is still offered.
    const full = data.others.find((d) => d.name === 'Full body');
    const legsCard = full === undefined ? null : s.todaySession.card(data, sel(data, full.key));
    expect(legsCard?.clashLine).toBe('Long run tomorrow: legs fit better another day');
    expect(legsCard?.startable).toBe(true);
    // Without a coach connection: `Not reviewed · Coach not connected`, never a coach line.
    const plain = createHarness('2026-10-12T07:00:00.000Z', { idStart: 900 });
    try {
      const { services: s3 } = await plain.launch();
      await setUpGym(plain, s3);
      const d3 = await loaded(s3);
      const k = d3.others[0]?.key ?? '';
      const view = s3.todaySession.card(d3, sel(d3, k));
      expect(view?.why.at(-1)).toBe('Not reviewed · Coach not connected');
      expect(view?.why.some((l) => l.startsWith('✦'))).toBe(false);
      expect(d3.coachLabel).toBe('Coach');
    } finally {
      await plain.cleanup();
    }
  });
});

