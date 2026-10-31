import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { LoadConvention } from '@fizz/schemas';
import type { ModelEvent, ModelRequest } from '@fizz/coach';
import { addDays, currentDraftVersion, formFromEquipment, localDateOf, toMs, undoableTimeFit, type EquipmentForm } from '@fizz/domain';
import { builderApplyOpId } from '@fizz/coach';

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
  ['Legs', 'legs', [['Back squat', { reps: { min: 5, max: 6 }, load: kgLoad(100) }], ['Leg extension', { load: kgLoad(40, 'stack') }], ['Leg curl', { load: kgLoad(35, 'stack') }]]],
  ['Upper', null, [['Overhead press', { reps: { min: 6, max: 8 }, load: kgLoad(50) }], ['Lateral raise', { load: kgLoad(10, 'per_hand') }], ['Triceps pushdown', { load: kgLoad(30, 'stack') }]]],
];

function usableOf(req: ModelRequest): { catalogueId: string; name: string }[] {
  const block = req.input.find((i) => i.type === 'message' && i.role === 'developer' && i.content.startsWith('YOUR DATA'));
  if (block?.type !== 'message') throw new Error('no context');
  const data = JSON.parse(block.content.slice(block.content.indexOf('\n') + 1)) as { build?: { usable: { catalogueId: string; name: string }[] } };
  if (data.build === undefined) throw new Error('not a build turn');
  return data.build.usable;
}
const planStubOf = (days: typeof FOUR) => (req: ModelRequest): ModelEvent[] => {
  const usable = usableOf(req);
  const idOf = (name: string) => usable.find((u) => u.name === name)?.catalogueId ?? `missing-${name}`;
  return toolCall('propose_plan', { days: days.map(([dayName, splitDayId, exs]) => ({ dayName, splitDayId, focus: null, minutes: null, exercises: exs.map(([n, over]) => ex(idOf(n), over ?? {})) })), message: 'Push, pull, legs, upper.', minutes: null, gymName: null });
};

const planStub = planStubOf(FOUR);

async function benWithPlan(stub = planStub) {
  const { services: s } = await h.launch();
  const gymId = await setUpGym(h, s);
  await logWorkout(h, s, gymId, [{ exercise: 'Bench press', sets: [{ load: 100, reps: 7, rpe: 8 }, { load: 100, reps: 7, rpe: 8 }] }]);
  h.clockMs += DAY;
  await logWorkout(h, s, gymId, [{ exercise: 'Lat pulldown', sets: [{ load: 60, reps: 10, rpe: 8 }, { load: 60, reps: 10, rpe: 8 }] }]);
  h.clockMs += DAY;
  await logWorkout(h, s, gymId, [{ exercise: 'Back squat', sets: [{ load: 100, reps: 5, rpe: 8 }, { load: 100, reps: 5, rpe: 8 }] }]);
  h.clockMs += DAY;
  model = new StepModel([stub, () => replyWith('Here is your week.')]);
  const r = await s.coach.send({ entry: { kind: 'today' }, threadId: null, input: { kind: 'words', text: 'Build me a 4-day plan', spoken: false }, turnId: h.ids() });
  const card = r.cards[0]?.record;
  if (card?.detail.kind !== 'build_plan') throw new Error('no plan');
  const planId = card.detail.planId;
  const c = await s.plans.card({ planId, versionN: 1 });
  expect(await s.plans.apply({ planId, versionN: 1, expectedVersion: c?.planVersion ?? 0, mode: 'replace', opId: 'apply-1' })).toMatchObject({ ok: true });
  h.clockMs += 3_600_000;
  return { s, gymId, planId };
}

/** Ben at his gym with the same history and no plan (Today's no-plan card: Other sessions with their controls). */
async function benNoPlan(): Promise<AppServices> {
  const { services: s } = await h.launch();
  const gymId = await setUpGym(h, s);
  await logWorkout(h, s, gymId, [{ exercise: 'Bench press', sets: [{ load: 100, reps: 7, rpe: 8 }, { load: 100, reps: 7, rpe: 8 }] }]);
  h.clockMs += DAY;
  await logWorkout(h, s, gymId, [{ exercise: 'Lat pulldown', sets: [{ load: 60, reps: 10, rpe: 8 }, { load: 60, reps: 10, rpe: 8 }] }]);
  h.clockMs += DAY;
  return s;
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
/** Log every working set and finish (the Summary then reads the workout as done). */
async function finishAll(s: AppServices, sessionId: string): Promise<void> {
  const a = (await s.workout.load(sessionId))?.aggregate;
  if (a === undefined) throw new Error('no workout');
  for (const set of a.sets) {
    if (set.status !== 'pending' || set.setType === 'warmup') continue;
    h.clockMs += 60_000;
    const r = await s.workout.dispatch(sessionId, { type: 'log_set', at: h.now(), opId: `log:${set.id}`, setId: set.id, values: { load: set.planned.load ?? fallbackLoad(a.exercises.find((e) => e.id === set.sessionExerciseId)?.loadConvention ?? 'total'), reps: set.planned.reps?.min ?? 8, durationS: set.planned.durationS, rpe: 8, rir: null }, restTimerId: h.ids() });
    if (!r.ok) throw new Error(r.error.message);
  }
  const now = await s.workout.load(sessionId);
  const fin = await s.workout.dispatch(sessionId, { type: 'finish', at: h.now(), opId: h.ids(), expectedVersion: now?.aggregate.session.version ?? 0, endedAt: null });
  if (!fin.ok) throw new Error(fin.error.message);
  await h.settle(s);
}
const dayKeyOf = (data: TodaySessionData, name: string) => data.days.find((d) => d.name === name)?.key ?? data.others.find((d) => d.name === name)?.key ?? '';
const nbsp = (t: string | null | undefined) => (t ?? '').replaceAll('\u00a0', ' ');

/** A set logged with no planned load: 20 kg, or no external load on a bodyweight exercise (a push-up the builder picked). */
const fallbackLoad = (convention: LoadConvention): { value: number; unit: 'kg'; convention: LoadConvention } => ({ value: convention === 'bodyweight' ? 0 : 20, unit: 'kg', convention });

describe('(Ben, 27 Oct) Rest when short on time: Today’s Time reads it', () => {
  it('Minimum rest (default) shortens accessory rests first; Standard rest never does, it trims sets; the main lift stays first and whole', async () => {
    const { s } = await benWithPlan();
    const data = await loaded(s);
    const pushKey = dayKeyOf(data, 'Push');
    const push = s.todaySession.card(data, sel(data, pushKey));
    if (push === null) throw new Error('no card');
    const shorter = Math.floor((push.minutes - 5) / 5) * 5;
    const byDefault = s.todaySession.card(data, sel(data, pushKey, { minutes: shorter }));
    expect(byDefault?.time?.lines.filter((l) => /rest$/.test(l))).toEqual(['Minimum rest']);

    const snap = await s.training.snapshot();
    if (snap === null) throw new Error('no profile');
    const r = await s.training.change({ kind: 'fit_rest_level', level: 'normal' }, snap.profile.version, 'rest-standard');
    expect(r.ok).toBe(true);
    const again = await loaded(s);
    const standard = s.todaySession.card(again, sel(again, pushKey, { minutes: shorter }));
    expect(standard?.time?.lines.some((l) => /rest$/.test(l))).toBe(false);
    expect(standard?.time?.note).toMatch(/^−\d+ (exercise|exercises|set|sets)$/);
    expect(standard?.rows[0]?.name).toBe('Bench press');
    expect(standard?.rows[0]?.sets).toBe(push.rows[0]?.sets);
  });
});

describe('(Ben, 28 Oct) Rest times: Today’s drafts and Start use Ben’s defaults; an open workout keeps its rests', () => {
  it('his compound and main-lift rests reach the started workout; a change while it is open leaves it as it is', async () => {
    const { s, gymId } = await benWithPlan();
    const restsOf = (a: { exercises: readonly { id: string; exerciseName: string }[]; sets: readonly { sessionExerciseId: string; setType: string; rest: { seconds: number } }[] }, name: string, type: string) => {
      const row = a.exercises.find((e) => e.exerciseName === name)?.id;
      return [...new Set(a.sets.filter((x) => x.sessionExerciseId === row && x.setType === type).map((x) => x.rest.seconds))];
    };
    // Standard: the incline press (a compound accessory) rests 2:00, exactly (Ben, 28 Oct: no longer snapped to his presets).
    const std = await loaded(s);
    const stdKey = dayKeyOf(std, 'Push');
    const before = s.todaySession.card(std, sel(std, stdKey));
    const snap = await s.training.snapshot();
    if (snap === null) throw new Error('no profile');
    let v = snap.profile.version;
    for (const [key, seconds] of [['workingCompound', 150], ['workingMain', 240], ['top', 270]] as const) {
      const r = await s.training.change({ kind: 'rest_default', key, seconds }, v, `rt-${key}`);
      if (!r.ok) throw new Error('not saved');
      v = r.profile.version;
    }
    const data = await loaded(s);
    const key = dayKeyOf(data, 'Push');
    const card = s.todaySession.card(data, sel(data, key));
    // Longer rests: a longer ~N min for the same exercises.
    expect(card?.exerciseCount).toBe(before?.exerciseCount);
    expect(card?.minutes ?? 0).toBeGreaterThan(before?.minutes ?? Infinity);
    const c = await s.todaySession.commit(data, sel(data, key, { minutes: 120 }), 'rt-commit');
    if (!c.ok) throw new Error(c.message);
    const started = await s.todaySession.start({ draftId: c.draftId, expectedVersion: c.version, gymId, opId: 'rt-start', checkIn: null });
    if (!started.ok) throw new Error(started.error.message);
    const a = started.aggregate;
    expect(restsOf(a, 'Incline dumbbell press', 'working')).toEqual([150]);
    const benchWork = [...restsOf(a, 'Bench press', 'top'), ...restsOf(a, 'Bench press', 'working')];
    expect(benchWork.length).toBeGreaterThan(0);
    expect(benchWork.every((x) => x === 270 || x === 240)).toBe(true);

    // Reset while the workout is open: its rests stay as Start stored them (rule 2; an open workout keeps its rests).
    const reset = await s.training.change({ kind: 'reset_rest_defaults' }, v, 'rt-reset');
    expect(reset.ok).toBe(true);
    const open = await s.workout.load(a.session.id);
    expect(open?.aggregate.sets.map((x) => [x.id, x.rest.seconds])).toEqual(a.sets.map((x) => [x.id, x.rest.seconds]));
    expect(open?.restDefaultsS).toEqual({});
  });
});

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

    // A plan in use: the lean card (D3); the plan's own length has no note and nothing to undo.
    expect(push.time).toMatchObject({ note: null, lines: [], undoMinutes: null });
    // A length under the card's own estimate trims: the note after Time and the detail behind it (fit-to-time 22 Oct
    // revision); the main lift stays. (Rests follow Ben's presets, as the builder's do, so the estimate agrees with
    // Your workout.) Undo goes back to the plan's length.
    const shorter = Math.floor((push.minutes - 10) / 5) * 5;
    const short = s.todaySession.card(data, sel(data, pushKey, { minutes: shorter }));
    expect(short?.time?.note).toMatch(/^(−\d+ (exercise|exercises|set|sets)|supersets|medium rest|minimum rest)$/);
    expect(short?.time?.lines[0]).toMatch(/^(Medium|Minimum) rest$/);
    // (Ben, 27 Oct) The number is the trimmed card's estimate, at or under the length asked for.
    expect(short?.time?.length).toBe(shorter);
    expect(short?.time?.minutes).toBe(short?.minutes);
    expect(short?.time?.over).toBe((short?.minutes ?? 0) > shorter);
    expect(short?.time?.undoMinutes).toBe(data.initial[pushKey]?.minutes);
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
      const r = await s.workout.dispatch(a.session.id, { type: 'log_set', at: h.now(), opId: `log:${set.id}`, setId: set.id, values: { load: set.planned.load ?? fallbackLoad(a.exercises.find((e) => e.id === set.sessionExerciseId)?.loadConvention ?? 'total'), reps: set.planned.reps?.min ?? 8, durationS: null, rpe: 8, rir: null }, restTimerId: h.ids() });
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

  it('a draft changed outside Today (the builder) shows as `· edited` and is never overwritten by Today; a version Undo back to Today’s own content is Today’s again (ownership by content)', async () => {
    const { s } = await benWithPlan();
    const data = await loaded(s);
    const key = data.nextKey ?? '';
    const longer = (data.initial[key]?.minutes ?? 45) + 20;
    const c1 = await s.todaySession.commit(data, sel(data, key, { minutes: longer }), 'commit-e1');
    const c2 = await s.todaySession.commit(data, sel(data, key), 'commit-e2');
    if (!c1.ok || !c2.ok) throw new Error('commit');
    expect(c2.draftId).toBe(c1.draftId);
    // The drafts' own versioned Undo back to version 1: Today's content for the longer controls, so still Today's card.
    h.clockMs += 60_000;
    const u = await s.coachDrafts.undoVersion({ draftId: c2.draftId, versionN: 2, expectedVersion: c2.version, opId: 'undo-v2' });
    expect(u).toMatchObject({ ok: true });
    const back = await loaded(s);
    expect(s.todaySession.card(back, sel(back, key))?.title).not.toMatch(/edited/);
    // Ben's edit in the builder: `· edited`, and Today never overwrites it.
    const snap = await s.builder.read(c1.draftId);
    const slot = snap?.workout.blocks.flatMap((b) => b.slots).find((x) => !x.main);
    if (snap === null || slot === undefined) throw new Error('no accessory');
    expect((await s.builder.edit(c1.draftId, { kind: 'add_set', slotKey: slot.key }, { opId: 'e-add-set', basis: { version: snap.version } })).status).toBe('written');
    const again = await loaded(s);
    const view = s.todaySession.card(again, sel(again, key));
    expect(view?.title).toMatch(/· edited$/);
    expect(view?.edited?.draftId).toBe(c1.draftId);
    expect(view?.exerciseCount).toBe(s.todaySession.card(data, sel(data, key, { minutes: longer }))?.exerciseCount);
    // Today's commit hands back the edited draft as it is: nothing is overwritten.
    const kept = await s.todaySession.commit(again, sel(again, key), 'commit-e3');
    expect(kept).toEqual({ ok: true, draftId: c1.draftId, version: view?.edited?.version });
  });

  it('(D3; V5) the card has no Mix it up, with or without a plan: a mix count an older selection carried changes nothing, and no model call', async () => {
    const { s } = await benWithPlan();
    const data = await loaded(s);
    for (const key of [dayKeyOf(data, 'Push'), data.others.find((d) => d.name === 'Push')?.key ?? '']) {
      const calls = model.requests.length;
      const base = s.todaySession.card(data, sel(data, key, { minutes: 75 }));
      const carried = s.todaySession.card(data, sel(data, key, { minutes: 75, mix: 2 }));
      if (base === null || carried === null) throw new Error('no card');
      expect(carried.rows).toEqual(base.rows);
      expect(model.requests.length).toBe(calls);
    }
  });

  it('(V5) no plan: the card has no Mix it up either (it is on Your workout)', async () => {
    const s = await benNoPlan();
    const data = await loaded(s);
    const full = dayKeyOf(data, 'Full body');
    expect(s.todaySession.card(data, sel(data, full, { abs: false, mix: 1 }))?.rows).toEqual(s.todaySession.card(data, sel(data, full, { abs: false }))?.rows);
  });

  it('merge: Today’s draft is the builder’s (codec, per-slot state); an edit in the builder shows `· edited`; Start is one tap, today only; the Summary offers Keep for next time and its Undo restores the plan day once', async () => {
    const { s, gymId } = await benWithPlan();
    const data = await loaded(s);
    const key = dayKeyOf(data, 'Push');
    const card = s.todaySession.card(data, sel(data, key));
    const c = await s.todaySession.commit(data, sel(data, key), 'commit-merge');
    if (!c.ok || card === null) throw new Error('commit');
    // The builder reads Today's draft as its own: same exercises and minutes, slots carry builder state and revs.
    const snap = await s.builder.read(c.draftId);
    if (snap === null) throw new Error('builder can’t read Today’s draft');
    expect(snap.workout.blocks.flatMap((b) => b.slots).map((x) => x.exerciseId)).toEqual(card.draft?.workout.blocks.flatMap((b) => b.slots).map((x) => x.exerciseId));
    const stored = await s.coachDrafts.get(c.draftId);
    const plan = stored?.versions.find((v) => v.n === stored.currentVersion)?.plan;
    expect(plan?.slots.every((x) => x.builder !== undefined && x.rev === 1)).toBe(true);
    // Ben adds a set in the builder to a planned accessory: the card reads `· edited`.
    const planned = new Set(card.draft?.template.exerciseIds ?? []);
    const slot = snap.workout.blocks.flatMap((b) => b.slots).find((x) => !x.main && planned.has(x.exerciseId));
    if (slot === undefined) throw new Error('no accessory');
    const e = await s.builder.edit(c.draftId, { kind: 'add_set', slotKey: slot.key }, { opId: 'merge-add-set', basis: { version: snap.version } });
    expect(e.status).toBe('written');
    const again = await loaded(s);
    const view = s.todaySession.card(again, sel(again, key));
    expect(view?.title).toMatch(/· edited$/);
    const edited = view?.edited;
    if (edited == null) throw new Error('no edited card');
    // (D1) Start: one tap through Today's own Start, today only (the commit hands back the edited draft).
    const c2 = await s.todaySession.commit(again, sel(again, key), 'commit-merge-2');
    expect(c2).toEqual({ ok: true, draftId: edited.draftId, version: edited.version });
    const before = (await s.routines.list()).find((r) => r.id === again.days.find((d) => d.key === key)?.templates[0]?.routineId);
    const started = await s.todaySession.start({ draftId: edited.draftId, expectedVersion: edited.version, gymId, opId: 'merge-start', checkIn: null });
    if (!started.ok) throw new Error(started.error.message);
    const sessionId = started.aggregate.session.id;
    expect((await s.routines.list()).find((r) => r.id === before?.id)?.version).toBe(before?.version);
    await finishAll(s, sessionId);
    const keep = await s.builder.keepNextTimeOf(sessionId);
    expect(keep?.state).toBe('open');
    if (keep?.state !== 'open') return;
    // (Review batch23 S7) Exactly Ben's one change, like with like: the plan day's 3 sets plus his one (Today's own
    // picks and its main lift's top set + back-offs are never lines).
    expect(keep.lines).toEqual([`${snap.facts[slot.exerciseId]?.name ?? ''}: 3 → 4 sets`]);
    expect(await s.builder.keepNextTime(sessionId, 'apply')).toEqual({ ok: true });
    expect((await s.routines.list()).find((r) => r.id === before?.id)?.version).toBe((before?.version ?? 0) + 1);
    expect(await s.builder.undoKeepNextTime(sessionId)).toEqual({ ok: true });
    // Undone once: the row goes, and a retry is still fine.
    expect(await s.builder.keepNextTimeOf(sessionId)).toBeNull();
    expect(await s.builder.undoKeepNextTime(sessionId)).toEqual({ ok: true });
  });

  it('(D1) Today’s own card (its controls, its length) never asks to change the plan: Start, finish, no Keep for next time', async () => {
    const { s, gymId } = await benWithPlan();
    const data = await loaded(s);
    const key = dayKeyOf(data, 'Push');
    const shorter = sel(data, key, { minutes: 30 });
    const c = await s.todaySession.commit(data, shorter, 'commit-short');
    if (!c.ok) throw new Error('commit');
    const started = await s.todaySession.start({ draftId: c.draftId, expectedVersion: c.version, gymId, opId: 'start-short', checkIn: null });
    if (!started.ok) throw new Error(started.error.message);
    await finishAll(s, started.aggregate.session.id);
    expect(await s.builder.keepNextTimeOf(started.aggregate.session.id)).toBeNull();
  });

  it('merge: the coach on Today — a low check-in gets the nudge’s line in Why? with code’s offer; Apply writes it to the card’s draft once and the day goes quiet', async () => {
    const { s } = await benWithPlan();
    const ci = await s.checkIns.record({ checkInId: '0d7f6c2e-4b1a-4c3d-9e8f-1a2b3c4d5e6f', opId: 'ci-1', score: 1 });
    expect(ci.ok).toBe(true);
    model = new StepModel([() => toolCall('pre_session_nudge', { speak: true, line: 'Low check-in today, so a little less volume.' })]);
    const data = await loaded(s);
    const key = data.nextKey ?? '';
    const r = await s.todaySession.review(data, sel(data, key), 'nudge-1');
    if (r?.kind !== 'line' || r.offer === null) throw new Error(`no offer: ${JSON.stringify(r)}`);
    const shown = s.todaySession.card(data, sel(data, key), { nudge: r });
    expect(shown?.why.at(-1)).toBe('✦ Coach: Low check-in today, so a little less volume.');
    expect(shown?.why).not.toContain('Not reviewed');
    // Rule 3: nothing changed until Apply.
    expect(shown?.title).not.toMatch(/edited/);
    const applied = await s.builderCoach.applyNudge({ offer: r.offer, localDate: data.localDate, opId: 'apply-nudge' });
    expect(applied.kind).toBe('applied');
    const after = await loaded(s);
    // The coach's change, applied on Ben's tap, is still Today's card: plain title, its draft shown (integrity B2).
    const eased = s.todaySession.card(after, sel(after, key));
    expect(eased?.edited).toBeNull();
    expect(eased?.title).not.toMatch(/edited/);
    expect(eased?.nudged?.draftId).toBe(r.offer.proposal.draftId);
    const calls = model.requests.length;
    const again = await s.todaySession.review(after, sel(after, key), 'nudge-2');
    expect(again?.kind).toBe('settled');
    expect(model.requests.length).toBe(calls);
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

  it('Build your own from each Other session opens Set up on that session (an unknown day is a custom day, never the split’s first; wiring B1)', async () => {
    const { s } = await benWithPlan();
    const data = await loaded(s);
    expect(data.others.map((o) => o.name)).toEqual(['Full body', 'Upper', 'Push']);
    for (const o of data.others) {
      const setup = await s.builder.initialSetup({ dayId: o.splitDayId });
      expect(setup.dayName).toBe(o.name);
      expect(setup.groups.length).toBeGreaterThan(0);
    }
    const fb = await s.builder.initialSetup({ dayId: 'full_body' });
    expect(fb).toMatchObject({ dayId: 'custom', dayName: 'Full body', groupsEdited: true });
    expect(fb.groups.map((g) => g.group)).toEqual(['Legs', 'Back', 'Chest', 'Core']);
    expect((await s.builder.initialSetup({ dayId: 'push' })).dayId).toBe('push');
    // A day gone from the split: Custom with nothing picked, not Push.
    expect(await s.builder.initialSetup({ dayId: 'gone_day' })).toMatchObject({ dayId: 'custom', dayName: 'Custom', groups: [] });
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

  it('B1: on a clock that moves on every read, Today’s own drafts never read back as `edited` (ownership is by version); a check-in back-out, a reload and a force-close keep the same draft and Start', async () => {
    const { s, gymId } = await benWithPlan();
    // The phone's clock: every `now()` a millisecond later (the harness's is frozen otherwise).
    let ms = h.clockMs;
    Object.defineProperty(h, 'clockMs', {
      get: () => (ms += 1),
      set: (v: number) => {
        ms = v;
      },
      configurable: true,
    });
    const data = await loaded(s);
    const key = data.nextKey ?? '';
    const c1 = await s.todaySession.commit(data, sel(data, key), 'tick-1');
    if (!c1.ok) throw new Error(c1.message);
    // Start → the check-in sheet → back out: nothing else written. The card is Today's, not `edited`.
    let again = await loaded(s);
    expect(s.todaySession.card(again, sel(again, key))?.edited).toBeNull();
    // A changed control is a new version of the same draft, still Today's.
    const longer = (data.initial[key]?.minutes ?? 45) + 15;
    const c2 = await s.todaySession.commit(again, sel(again, key, { minutes: longer }), 'tick-2');
    if (!c2.ok) throw new Error(c2.message);
    expect(c2.draftId).toBe(c1.draftId);
    expect(c2.version).toBe(c1.version + 1);
    again = await loaded(s);
    expect(s.todaySession.card(again, sel(again, key, { minutes: longer }))?.edited).toBeNull();
    // Force-close between commit and Start: the draft survives; the same tap commits to it unchanged and starts.
    await h.forceClose();
    const { services: s2 } = await h.launch();
    const after = await loaded(s2);
    expect(s2.todaySession.card(after, sel(after, key, { minutes: longer }))?.edited).toBeNull();
    const c3 = await s2.todaySession.commit(after, sel(after, key, { minutes: longer }), 'tick-3');
    expect(c3).toEqual(c2);
    const r = await s2.todaySession.start({ draftId: c2.draftId, expectedVersion: c2.version, gymId, opId: 'tick-start', checkIn: null });
    if (!r.ok) throw new Error(JSON.stringify(r.error));
    expect(r.aggregate.session.coachDraft?.draftId).toBe(c2.draftId);
  });

  it('B2: at a gym without the kit, no exercise it can’t do reaches the card (template exercises and main lifts fall through or are named in Why?)', async () => {
    const { s, gymId } = await benWithPlan();
    const planned = await loaded(s);
    // A dumbbell-only gym, selected.
    expect(gymId).not.toBe('');
    const hotelId = h.ids();
    expect(await s.setup.saveGym({ gymId: hotelId, name: 'Hotel', draft: s.coachingKnowledge.buildGymDraft('home_dumbbells', 'kg') })).toEqual({ ok: true });
    expect(await s.gyms.select(hotelId)).toMatchObject({ ok: true });
    const data = await loaded(s);
    const { here } = data.internal;
    // The plan's templates do name things this gym can't do (else the test proves nothing).
    const templateIds = data.days.flatMap((d) => d.templates.flatMap((t) => [...t.exerciseIds, ...(t.mainLiftExerciseId === null ? [] : [t.mainLiftExerciseId])]));
    expect(templateIds.some((id) => !here(id))).toBe(true);
    expect(planned.internal.here(templateIds.find((id) => !here(id)) ?? '')).toBe(true);
    for (const d of data.days) {
      const card = s.todaySession.card(data, sel(data, d.key));
      if (card === null) continue;
      for (const r of card.rows) expect(here(r.exerciseId)).toBe(true);
      expect(card.exerciseCount).toBe(card.rows.length);
      for (const m of card.controls.mainLifts) if (m.exerciseId !== null) expect(here(m.exerciseId)).toBe(true);
      // A main lift the gym can't do: left out and named once, behind Why?.
      const main = d.templates[0]?.mainLiftExerciseId ?? null;
      if (main !== null && !here(main) && d.templates.every((t) => t.mainLiftExerciseId !== null && !here(t.mainLiftExerciseId))) {
        expect(card.why).toContain(`${data.internal.nameOf(main)}: not at this gym`);
      }
    }
  });

  it('B2 / rule 9: a pain-flagged template accessory is left out; a pain-flagged main lift stays held at its last load (with history) or with no load (without), marked and named in Why?', async () => {
    const { s } = await benWithPlan();
    const data = await loaded(s);
    const pushKey = dayKeyOf(data, 'Push');
    const push = data.days.find((d) => d.key === pushKey)?.templates[0];
    const incline = push?.exerciseIds.find((id) => data.internal.nameOf(id) === 'Incline dumbbell press') ?? '';
    const bench = push?.mainLiftExerciseId ?? '';
    expect(s.todaySession.card(data, sel(data, pushKey, { minutes: 75 }))?.rows.some((r) => r.exerciseId === incline)).toBe(true);
    const benchBefore = Number(s.todaySession.card(data, sel(data, pushKey))?.rows.find((r) => r.exerciseId === bench)?.top);
    expect(await s.pain.flagMovement({ exerciseId: incline, exerciseName: 'Incline dumbbell press', opId: 'pain-incline' })).toMatchObject({ ok: true });
    expect(await s.pain.flagMovement({ exerciseId: bench, exerciseName: 'Bench press', opId: 'pain-bench' })).toMatchObject({ ok: true });
    const upperKey = dayKeyOf(data, 'Upper');
    const ohp = data.days.find((d) => d.key === upperKey)?.templates[0]?.mainLiftExerciseId ?? '';
    expect(await s.pain.flagMovement({ exerciseId: ohp, exerciseName: 'Overhead press', opId: 'pain-ohp' })).toMatchObject({ ok: true });

    const flagged = await loaded(s);
    for (const minutes of [45, 60, 75, 90]) {
      const card = s.todaySession.card(flagged, sel(flagged, pushKey, { minutes }));
      expect(card?.rows.some((r) => r.exerciseId === incline)).toBe(false);
      for (const mix of [1, 2, 3]) expect(s.todaySession.card(flagged, sel(flagged, pushKey, { minutes, mix }))?.rows.some((r) => r.exerciseId === incline)).toBe(false);
    }
    // Bench (logged 100 × 7): kept, held no harder than last time, marked.
    const card = s.todaySession.card(flagged, sel(flagged, pushKey));
    const row = card?.rows.find((r) => r.exerciseId === bench);
    expect(row?.held).toBe(true);
    expect(row?.accessibilityLabel).toContain('pain flag, held');
    expect(Number(row?.top)).toBeLessThanOrEqual(100);
    expect(Number(row?.top)).toBeLessThanOrEqual(benchBefore);
    expect(card?.why).toContain('Bench press: pain flag · held');
    // Overhead press (no history of its own): kept, no load at all (never the plan's first load or an estimate).
    const upper = s.todaySession.card(flagged, sel(flagged, upperKey));
    const ohpRow = upper?.rows.find((r) => r.exerciseId === ohp);
    expect(ohpRow?.held).toBe(true);
    expect(ohpRow?.top).toBe('—');
    expect(s.todaySession.card(data, sel(data, upperKey))?.rows.find((r) => r.exerciseId === ohp)?.top).not.toBe('—');
  });

  it('lb end to end: an lb gym and profile → the card in lb, and Start plans exactly the card’s top set in lb', async () => {
    const { s } = await benWithPlan();
    await s.setup.saveUnits('lb');
    const gymId = h.ids();
    expect(await s.setup.saveGym({ gymId, name: 'US Gym', draft: s.coachingKnowledge.buildGymDraft('commercial', 'lb') })).toEqual({ ok: true });
    expect(await s.gyms.select(gymId)).toMatchObject({ ok: true });
    // Bench logged here in lb (kg history from the other gym's kg bar gives no target here: `—`, honest).
    await logWorkout(h, s, gymId, [{ exercise: 'Bench press', sets: [{ load: 205, reps: 8, rpe: 8 }, { load: 205, reps: 8, rpe: 8 }] }]);
    h.clockMs += DAY;
    const data = await loaded(s);
    expect(data.unit).toBe('lb');
    const key = dayKeyOf(data, 'Push');
    const card = s.todaySession.card(data, sel(data, key));
    expect(card?.unit).toBe('lb');
    const top = Number(card?.rows[0]?.top);
    // From 205 × 8 in lb, on lb plates (45 bar, 2.5 lb steps a side): an lb value, rounded to what the bar can make.
    expect(top).toBeGreaterThanOrEqual(185);
    expect(top).toBeLessThanOrEqual(235);
    expect((top - 45) % 5).toBe(0);
    const c = await s.todaySession.commit(data, sel(data, key), 'lb-commit');
    if (!c.ok) throw new Error(c.message);
    const r = await s.todaySession.start({ draftId: c.draftId, expectedVersion: c.version, gymId, opId: 'lb-start', checkIn: null });
    if (!r.ok) throw new Error(JSON.stringify(r.error));
    const bench = r.aggregate.exercises.find((e) => e.exerciseId === card?.rows[0]?.exerciseId);
    const loads = r.aggregate.sets.filter((x) => x.sessionExerciseId === bench?.id && x.setType !== 'warmup').map((x) => x.planned.load);
    expect(loads.every((l) => l?.unit === 'lb')).toBe(true);
    expect(Math.max(...loads.map((l) => l?.value ?? 0))).toBe(top);
  });

  it('lb: the builder writes the same checked-on item as Today (one checkedOnOf: lb bar mass in kg), so an edit keeps it', async () => {
    const { s } = await benWithPlan();
    await s.setup.saveUnits('lb');
    const gymId = h.ids();
    expect(await s.setup.saveGym({ gymId, name: 'US Gym', draft: s.coachingKnowledge.buildGymDraft('commercial', 'lb') })).toEqual({ ok: true });
    expect(await s.gyms.select(gymId)).toMatchObject({ ok: true });
    await logWorkout(h, s, gymId, [{ exercise: 'Bench press', sets: [{ load: 205, reps: 8, rpe: 8 }] }]);
    h.clockMs += DAY;
    const data = await loaded(s);
    const c = await s.todaySession.commit(data, sel(data, dayKeyOf(data, 'Push')), 'lb-checked-commit');
    if (!c.ok) throw new Error(c.message);
    const before = await s.coachDrafts.get(c.draftId);
    if (before === null) throw new Error('no draft');
    const bench = currentDraftVersion(before).plan.slots[0];
    if (bench === undefined) throw new Error('no slot');
    expect(bench.checkedOn).toMatchObject({ unit: 'lb' });
    expect(bench.checkedOn?.barKg).toBeCloseTo(20.41, 1);
    const snap = await s.builder.read(c.draftId);
    if (snap === null) throw new Error('builder can’t read it');
    const r = await s.builder.edit(c.draftId, { kind: 'add_set', slotKey: bench.slotKey }, { opId: 'lb-checked-edit', basis: { version: snap.version } });
    expect(r.status).toBe('written');
    const after = await s.coachDrafts.get(c.draftId);
    expect(currentDraftVersion(after ?? before).plan.slots.find((x) => x.slotKey === bench.slotKey)?.checkedOn).toEqual(bench.checkedOn);
  });

  it('S4: a draft’s pinned loads are re-planned at Start when a pain flag arrives after the commit (held, never the frozen load)', async () => {
    const { s, gymId } = await benWithPlan();
    const data = await loaded(s);
    const key = dayKeyOf(data, 'Push');
    const bench = data.days.find((d) => d.key === key)?.templates[0]?.mainLiftExerciseId ?? '';
    const c = await s.todaySession.commit(data, sel(data, key), 'pain-commit');
    if (!c.ok) throw new Error(c.message);
    // After the commit: a lighter bench session, then a pain flag. The hold is that last load, not the frozen one.
    h.clockMs += 60_000;
    await logWorkout(h, s, gymId, [{ exercise: 'Bench press', sets: [{ load: 80, reps: 8, rpe: 8 }, { load: 80, reps: 8, rpe: 8 }] }]);
    expect(await s.pain.flagMovement({ exerciseId: bench, exerciseName: 'Bench press', opId: 'pain-late' })).toMatchObject({ ok: true });
    const r = await s.todaySession.start({ draftId: c.draftId, expectedVersion: c.version, gymId, opId: 'pain-start', checkIn: null });
    if (!r.ok) throw new Error(JSON.stringify(r.error));
    const row = r.aggregate.exercises.find((e) => e.exerciseId === bench);
    const top = Math.max(...r.aggregate.sets.filter((x) => x.sessionExerciseId === row?.id && x.setType !== 'warmup').map((x) => x.planned.load?.value ?? 0));
    // Committed at about 100; last time 80 × 8 under a pain flag: held at 80, never the frozen load.
    expect(top).toBeGreaterThan(0);
    expect(top).toBeLessThanOrEqual(80);
  });

  it('states through load(): paused (no NEXT), no plan with routines (Other sessions only), offline after a failed coach call', async () => {
    const { s, planId } = await benWithPlan();
    const overview = await s.plans.overview();
    if (overview === null) throw new Error('overview');
    const paused = await s.plans.pause({ planId, untilDate: null, expectedVersion: overview.planVersion, opId: 'pause' });
    if (!paused.ok) throw new Error(paused.message);
    const p = await loaded(s);
    expect(p.status).toBe('paused');
    expect(p.nextKey).toBeNull();
    expect(p.days.length).toBe(4);
    const k = p.days[0]?.key ?? '';
    expect(s.todaySession.card(p, sel(p, k))?.why[0]).toBe('Push: picked by you');

    // A network failure on a coach call: Today says Offline (coach bar and Why?), never a coach line.
    model = new StepModel([() => [{ type: 'error', error: 'network' }]]);
    await s.coach.send({ entry: { kind: 'today' }, threadId: null, input: { kind: 'words', text: 'hi', spoken: false }, turnId: h.ids() }).catch(() => null);
    const off = await loaded(s);
    expect(off.review).toBe('offline');
    expect(off.coachLabel).toBe('Offline');
    expect(s.todaySession.card(off, sel(off, k))?.why.at(-1)).toBe('Not reviewed · Offline');
  });

  it('Ben’s plan from the old plan builder (before v3 templates and migration 30) is his plan on Today: its days, NEXT and a card; never `No plan` (21 Oct)', async () => {
    const { s, planId } = await benWithPlan();
    const before = await loaded(s);
    expect(before.status).toBe('plan');
    // Rewrite the stored plan and its workouts to what the 19 Oct plan builder wrote: `applied.made` one per day with
    // no main lift, workouts with only `createdFromPlan` (no `planDay`), no variations.
    const file = s.developer.databaseNames().current;
    await h.forceClose();
    const db = new DatabaseSync(join(h.dir, file));
    const row = db.prepare('SELECT data FROM plan_drafts WHERE id = ?').get(planId) as { data: string };
    const plan = JSON.parse(row.data) as { applied: { made: Record<string, unknown>[] } };
    for (const m of plan.applied.made) delete m.mainLiftExerciseId;
    db.prepare('UPDATE plan_drafts SET data = ? WHERE id = ?').run(JSON.stringify(plan), planId);
    const routines = db.prepare('SELECT id, data FROM routines').all() as { id: string; data: string }[];
    let old = 0;
    for (const r of routines) {
      const doc = JSON.parse(r.data) as { createdFromPlan?: { planId: string }; planDay?: unknown };
      if (doc.createdFromPlan?.planId !== planId) continue;
      delete doc.planDay;
      old += 1;
      db.prepare('UPDATE routines SET data = ? WHERE id = ?').run(JSON.stringify(doc), r.id);
    }
    expect(old).toBe(4);
    expect((db.prepare('SELECT COUNT(*) AS n FROM plan_day_variations').get() as { n: number }).n).toBe(0);
    db.close();

    const s2 = (await h.launch()).services;
    const data = await loaded(s2);
    expect(data.status).toBe('plan');
    expect(data.days.map((d) => d.name)).toEqual(['Push', 'Pull', 'Legs', 'Upper']);
    expect(data.nextKey).not.toBeNull();
    expect(data.days.map((d) => d.key)).toEqual(before.days.map((d) => d.key));
    const card = s2.todaySession.card(data, sel(data, data.nextKey ?? ''));
    expect(card?.startable).toBe(true);
    // Library › Your plan reads the same plan.
    expect((await s2.plans.overview())?.days.length).toBe(4);
  });

  it('No plan when no plan is in use: an applied plan whose workouts are all deleted reads as none (as Library › Your plan)', async () => {
    const { s, planId } = await benWithPlan();
    const file = s.developer.databaseNames().current;
    await h.forceClose();
    const db = new DatabaseSync(join(h.dir, file));
    for (const r of db.prepare('SELECT id, data FROM routines').all() as { id: string; data: string }[]) {
      const doc = JSON.parse(r.data) as { createdFromPlan?: { planId: string }; deletedAtUtc?: string | null };
      if (doc.createdFromPlan?.planId !== planId) continue;
      doc.deletedAtUtc = '2026-10-15T08:00:00.000Z';
      db.prepare('UPDATE routines SET data = ? WHERE id = ?').run(JSON.stringify(doc), r.id);
    }
    db.close();
    const s2 = (await h.launch()).services;
    expect(await s2.plans.overview()).toBeNull();
    const data = await loaded(s2);
    expect(data.status).toBe('no_plan');
    expect(data.days).toEqual([]);
    expect(data.others.map((d) => d.name)).toEqual(['Full body', 'Upper', 'Push']);
  });

  it('B1 (review today-fix-21oct): a Profile split and his own workouts in rotation, no applied plan → `No plan` with the old Today’s Up next (his own workout, one tap), never only the generic sessions', async () => {
    const { services: s } = await h.launch();
    const gymId = await setUpGym(h, s);
    const snap = await s.training.snapshot();
    if (!snap) throw new Error('snapshot');
    expect(await s.training.change({ kind: 'preset_split', split: 'clsb' }, snap.profile.version, 'split-clsb')).toMatchObject({ ok: true });
    // Back, Shoulders, Legs, Chest: each logged once and saved to the rotation under its split day's name.
    const days: [string, string][] = [['Back', 'Barbell row'], ['Shoulders', 'Overhead press'], ['Legs', 'Back squat'], ['Chest', 'Bench press']];
    for (const [name, exercise] of days) {
      const sessionId = await logWorkout(h, s, gymId, [{ exercise, sets: [{ load: 60, reps: 8, rpe: 8 }, { load: 60, reps: 8, rpe: 8 }] }]);
      const r = await s.routines.saveFrom({ from: { kind: 'session', sessionId }, name, addToRotation: true, opId: `save-${name}` });
      if (!r.ok) throw new Error(r.message);
      h.clockMs += DAY;
    }
    expect(await s.plans.overview()).toBeNull();
    const data = await loaded(s);
    expect(data.status).toBe('no_plan');
    // (V5) The Profile split is the day row; NEXT is the app's one Up next resolver's pick (split due day, then
    // rotation): Back was trained least recently.
    expect(data.days.map((d) => d.name)).toEqual(['Chest', 'Legs', 'Shoulders', 'Back']);
    const up = await s.next.preview(gymId);
    expect(up?.routine).not.toBeNull();
    expect(data.upNext).toEqual({ title: up?.title, routineId: up?.routine?.id ?? null, sourceSessionId: null });
    expect(data.upNext?.title).toBe('Back');
    expect(data.days.find((d) => d.key === data.nextKey)?.name).toBe('Back');
    // His own Back workout leads the card (the routine's exercise).
    expect(s.todaySession.card(data, sel(data, data.nextKey ?? ''))?.rows.some((r) => r.name === 'Barbell row')).toBe(true);
  });

  it('B1: rotation only (no split, no plan) → Up next is the routine after the one done last', async () => {
    const { services: s } = await h.launch();
    const gymId = await setUpGym(h, s);
    for (const [name, exercise] of [['Pull A', 'Lat pulldown'], ['Push A', 'Bench press']] as const) {
      const sessionId = await logWorkout(h, s, gymId, [{ exercise, sets: [{ load: 60, reps: 8, rpe: 8 }] }]);
      const r = await s.routines.saveFrom({ from: { kind: 'session', sessionId }, name, addToRotation: true, opId: `save-${name}` });
      if (!r.ok) throw new Error(r.message);
      h.clockMs += DAY;
    }
    const data = await loaded(s);
    expect(data.status).toBe('no_plan');
    // Push A was done last, so the rotation comes round to Pull A.
    expect(data.upNext?.title).toBe('Pull A');
    expect(data.upNext?.routineId).toBe((await s.next.preview(gymId))?.routine?.id);
    // Today's one-tap Start of it (the screen's `routineOf` start): that routine, once per op ID (a retry is the same workout).
    const routineId = data.upNext?.routineId ?? '';
    const started = await s.workout.start({ gymId, opId: 'up-next-1', checkIn: { kind: 'skipped', atUtc: h.now().utc }, routineOf: routineId });
    if (!started.ok) throw new Error(started.error.message);
    expect(started.aggregate.session.routineId).toBe(routineId);
    const again = await s.workout.start({ gymId, opId: 'up-next-1', checkIn: { kind: 'skipped', atUtc: h.now().utc }, routineOf: routineId });
    expect(again.ok && again.aggregate.session.id).toBe(started.aggregate.session.id);
  });

  it('B1: with a plan in use there is no fallback (the plan’s NEXT is Up next); after the plan ends, Today falls back to the resolver', async () => {
    const { s, gymId, planId } = await benWithPlan();
    const before = await loaded(s);
    expect(before.status).toBe('plan');
    expect(before.upNext).toBeNull();
    const overview = await s.plans.overview();
    if (overview === null) throw new Error('overview');
    expect(await s.plans.end({ planId, expectedVersion: overview.planVersion, opId: 'end-plan' })).toMatchObject({ ok: true });
    const after = await loaded(s);
    expect(after.status).toBe('no_plan');
    const up = await s.next.preview(gymId);
    expect(up).not.toBeNull();
    expect(after.upNext).toEqual({ title: up?.title, routineId: up?.routine?.id ?? null, sourceSessionId: up?.routine ? null : up?.sourceSessionId });
  });

  it('a plan that can’t be read fails the load (the screen says Couldn’t load), never `No plan`', async () => {
    const { s, planId } = await benWithPlan();
    const file = s.developer.databaseNames().current;
    await h.forceClose();
    const db = new DatabaseSync(join(h.dir, file));
    db.prepare("UPDATE plan_drafts SET data = json_set(data, '$.applied', NULL) WHERE id = ?").run(planId);
    db.close();
    const s2 = (await h.launch()).services;
    await expect(s2.todaySession.load()).rejects.toThrow();
  });

  it('`movedLine`: the next day itself has none; another plan day names what moves; an Other session has none', async () => {
    const { s } = await benWithPlan();
    const data = await loaded(s);
    const next = data.nextKey ?? '';
    expect(await s.todaySession.movedLine(data, sel(data, next))).toBeNull();
    const other = data.days.find((d) => d.key !== next);
    if (other === undefined) throw new Error('one day');
    const line = await s.todaySession.movedLine(data, sel(data, other.key));
    const nextName = data.days.find((d) => d.key === next)?.name ?? '';
    expect(line === null || nbsp(line).startsWith(`${nextName} moves`)).toBe(true);
    expect(line).not.toBeNull();
    const o = data.others[0]?.key ?? '';
    expect(await s.todaySession.movedLine(data, sel(data, o))).toBeNull();
  });
});

describe('Wave 2 merge integrity (reviews wave2-integrity, wave2-wiring)', () => {
  async function nudged() {
    const { s, gymId } = await benWithPlan();
    const ci = await s.checkIns.record({ checkInId: '0d7f6c2e-4b1a-4c3d-9e8f-1a2b3c4d5e6f', opId: 'ci-1', score: 1 });
    expect(ci.ok).toBe(true);
    model = new StepModel([() => toolCall('pre_session_nudge', { speak: true, line: 'Low check-in today, so a little less volume.' })]);
    const data = await loaded(s);
    const key = data.nextKey ?? '';
    const r = await s.todaySession.review(data, sel(data, key), 'nudge-1');
    if (r?.kind !== 'line' || r.offer === null) throw new Error(`no offer: ${JSON.stringify(r)}`);
    const before = s.todaySession.card(data, sel(data, key));
    const applied = await s.builderCoach.applyNudge({ offer: r.offer, localDate: data.localDate, opId: 'apply-nudge' });
    expect(applied.kind).toBe('applied');
    return { s, gymId, key, offer: r.offer, before };
  }

  it('B2: the nudge Ben applied is not `· edited`; Start is one tap (no §2.8 prompt) and starts the nudged workout', async () => {
    const { s, gymId, key, offer, before } = await nudged();
    const after = await loaded(s);
    const card = s.todaySession.card(after, sel(after, key));
    expect(card?.edited).toBeNull();
    expect(card?.title).not.toMatch(/edited/);
    expect(card?.nudged?.draftId).toBe(offer.proposal.draftId);
    // Today's commit keeps the nudged draft as it is; Start plans that one.
    const c = await s.todaySession.commit(after, sel(after, key), 'commit-nudged');
    if (!c.ok) throw new Error(c.message);
    expect(c).toEqual({ ok: true, draftId: card?.nudged?.draftId, version: card?.nudged?.version });
    const started = await s.todaySession.start({ draftId: c.draftId, expectedVersion: c.version, gymId, opId: 'start-nudged', checkIn: null });
    if (!started.ok) throw new Error(JSON.stringify(started.error));
    const working = started.aggregate.sets.filter((x) => x.setType !== 'warmup').length;
    const cardWorking = (card?.rows ?? []).reduce((n, row) => n + row.sets, 0);
    expect(cardWorking).toBeGreaterThan(0);
    expect(working).toBe(cardWorking);
    expect(card?.rows).not.toEqual(before?.rows);
    // No offer to write a fatigue-day cut into the plan (D1: the coach's today-only offer isn't Ben's structure).
    await finishAll(s, started.aggregate.session.id);
    expect(await s.builder.keepNextTimeOf(started.aggregate.session.id)).toBeNull();
  });

  it('B2 / wiring S4: Undo after the nudge hands the card back to Today; its controls drive it again', async () => {
    const { s, key, offer } = await nudged();
    const draftId = offer.proposal.draftId;
    const u = await s.builder.undo(draftId, builderApplyOpId(offer.proposal.id), 'undo-nudge');
    expect(u.status).toBe('written');
    const back = await loaded(s);
    const card = s.todaySession.card(back, sel(back, key));
    expect(card?.edited).toBeNull();
    expect(card?.nudged).toBeNull();
    expect(card?.title).not.toMatch(/edited/);
    // The controls drive it: a longer session is a new Today version of the same draft.
    const longer = (back.initial[key]?.minutes ?? 45) + 20;
    const c = await s.todaySession.commit(back, sel(back, key, { minutes: longer }), 'commit-after-undo');
    if (!c.ok) throw new Error(c.message);
    expect(c.draftId).toBe(draftId);
    expect(s.todaySession.card(await loaded(s), sel(back, key, { minutes: longer }))?.edited).toBeNull();
  });

  it('wiring S1 / S4: a control change after the nudge is Today’s card again (the nudge never hides Ben’s change)', async () => {
    const { s, key } = await nudged();
    const after = await loaded(s);
    const longer = (after.initial[key]?.minutes ?? 45) + 20;
    const changed = s.todaySession.card(after, sel(after, key, { minutes: longer }));
    expect(changed?.nudged).toBeNull();
    expect(changed?.edited).toBeNull();
    expect(changed?.controls.minutes).toBe(longer);
    expect(changed?.draft).not.toBeNull();
    // Committing the change writes Today's content for those controls (nothing silently dropped).
    const c = await s.todaySession.commit(after, sel(after, key, { minutes: longer }), 'commit-longer');
    if (!c.ok) throw new Error(c.message);
    const view = s.todaySession.card(await loaded(s), sel(after, key, { minutes: longer }));
    expect(view?.summary).toBe(changed?.summary);
  });

  it('S1: Today’s Start pins the draft version in the write; a change after commit creates nothing (Today and the check-in route)', async () => {
    const { s, gymId } = await benWithPlan();
    const data = await loaded(s);
    const key = dayKeyOf(data, 'Push');
    const c = await s.todaySession.commit(data, sel(data, key), 'commit-fence');
    if (!c.ok) throw new Error(c.message);
    const snap = await s.builder.read(c.draftId);
    const slot = snap?.workout.blocks.flatMap((b) => b.slots).find((x) => !x.main);
    if (snap === null || slot === undefined) throw new Error('no accessory');
    expect((await s.builder.edit(c.draftId, { kind: 'add_set', slotKey: slot.key }, { opId: 'fence-edit', basis: { version: snap.version } })).status).toBe('written');
    // The check-in route's Start (coachDraftOf with the committed version).
    const r = await s.workout.start({ gymId, opId: 'fence-start', checkIn: null, coachDraftOf: c.draftId, builder: { expectedVersion: c.version } });
    expect(r.ok).toBe(false);
    expect(await s.todaySession.start({ draftId: c.draftId, expectedVersion: c.version, gymId, opId: 'fence-start-2', checkIn: null })).toMatchObject({ ok: false });
    expect(await s.sessions.active()).toBeNull();
  });

  it('S3 regression (rule 4): an equipment edit at the same gym between commit and Start snaps the committed loads to what the gym has now', async () => {
    const { s, gymId } = await benWithPlan();
    const data = await loaded(s);
    const key = dayKeyOf(data, 'Push');
    const c = await s.todaySession.commit(data, sel(data, key), 'commit-eq');
    if (!c.ok) throw new Error(c.message);
    const bar = (await s.gyms.detail(gymId))?.equipment.find((e) => e.equipment.kind === 'barbell')?.equipment;
    if (!bar) throw new Error('no bar');
    const fewer = { ...formFromEquipment(bar), plates: [{ mass: 10, count: 2 }] } as EquipmentForm;
    expect((await s.gyms.save({ gymId, equipmentId: bar.id, expectedVersion: bar.version, form: fewer })).ok).toBe(true);
    const started = await s.todaySession.start({ draftId: c.draftId, expectedVersion: c.version, gymId, opId: 'start-eq', checkIn: null });
    if (!started.ok) throw new Error(JSON.stringify(started.error));
    const a = started.aggregate;
    const bench = a.exercises.find((e) => e.equipmentId === bar.id);
    if (bench === undefined) throw new Error('no barbell lift');
    const loads = a.sets.filter((x) => x.sessionExerciseId === bench.id).map((x) => x.planned.load?.value ?? 0);
    // Bar plus 2 × 10 kg is the most this bar can now load.
    if (!('barMass' in bar)) throw new Error('no bar mass');
    expect(loads.length).toBeGreaterThan(0);
    expect(Math.max(...loads)).toBeLessThanOrEqual(bar.barMass + 20);
    expect(Math.max(...loads)).toBeLessThan(100);
  });
});

/**
 * Review build-a S5: the `+N min` fit on a workout started from Today (a plan
 * day with a superset), with the real catalogue's groups and roles: the plan's
 * main lift is never trimmed or dropped, a superset's no-rest `a` stays at no
 * rest, Apply is one write, and `⋯ › Undo fit to time` (undoableTimeFit) puts it back.
 */
describe('+N min fit from a Today Start (b3 merge, review S5)', () => {
  it('a superset day with catalogue info: main lift kept, superset rests intact, Apply then ⋯ Undo', async () => {
    // Push with two isolations from different groups, so Today pairs them.
    const days: typeof FOUR = FOUR.map(([n, id, exs]) => [n, id, id === 'push' ? [...exs, ['Lateral raise', { reps: { min: 12, max: 15 } }], ['Triceps pushdown', { reps: { min: 10, max: 12 } }]] : exs]);
    const { s, gymId } = await benWithPlan(planStubOf(days));
    const data = await loaded(s);
    const key = dayKeyOf(data, 'Push');
    const pick = sel(data, key, { minutes: 75, supersets: true });
    const c = await s.todaySession.commit(data, pick, 'commit-fit');
    if (!c.ok) throw new Error(c.message);
    const started = await s.todaySession.start({ draftId: c.draftId, expectedVersion: c.version, gymId, opId: 'start-fit', checkIn: null });
    if (!started.ok) throw new Error(JSON.stringify(started.error));
    const sessionId = started.aggregate.session.id;
    const w = await s.workout.load(sessionId);
    if (!w) throw new Error('no workout');
    const a = w.aggregate;
    const live = a.exercises.filter((e) => e.removed === undefined);
    // A superset, and real catalogue info for every exercise (not defaults).
    expect(live.some((e) => e.supersetGroup !== null && live.filter((x) => x.supersetGroup === e.supersetGroup).length > 1)).toBe(true);
    for (const e of live) expect(w.builderInfo?.[e.exerciseId]?.group).toBeTruthy();
    // The plan day's main lift reaches the fit (provenance or the draft's main slot).
    const mainId = a.session.planDay?.mainLiftExerciseId ?? null;
    const mains = new Set([...(w.mainExerciseIds ?? []), ...(mainId === null ? [] : [mainId])]);
    expect(mains.size).toBeGreaterThan(0);
    const mainRows = new Set(live.filter((e) => mains.has(e.exerciseId)).map((e) => e.id));
    expect(mainRows.size).toBeGreaterThan(0);

    const offer = s.workout.timeFit(w, 25);
    if (offer === null) throw new Error('no offer');
    const byId = new Map(a.sets.map((x) => [x.id, x]));
    for (const l of offer.lines) if (l.kind === 'sets' || l.kind === 'drop' || l.kind === 'effort') expect(mainRows.has(l.sessionExerciseId)).toBe(false);
    for (const st of offer.steps) {
      if (st.type === 'skip_exercise') expect(mainRows.has(st.sessionExerciseId)).toBe(false);
      if (st.type === 'delete_set') expect(mainRows.has(byId.get(st.setId)?.sessionExerciseId ?? '')).toBe(false);
      if (st.type !== 'edit_planned_set') continue;
      const set = byId.get(st.setId);
      expect(set?.status).toBe('pending');
      expect(st.patch.load).toBeUndefined();
      // A superset's no-rest `a` (and any rest) only ever gets shorter, never added.
      if (st.patch.restS !== undefined) expect(st.patch.restS).toBeLessThan(set?.rest.seconds ?? 0);
    }
    expect(offer.lines.length).toBeGreaterThan(0);

    const applied = await s.workout.applyTimeFit({ sessionId, offer, opId: 'fit-today' });
    expect(applied.ok).toBe(true);
    const after = await s.workout.load(sessionId);
    if (!after) throw new Error('no workout');
    expect(undoableTimeFit(after.aggregate, h.now())).toBe('fit-today');
    const shape = (x: typeof a) => x.sets.map((y) => [y.id, y.status, y.rest.seconds, y.planned.rpeOverride ?? y.planned.rpe]);
    expect(shape(after.aggregate)).not.toEqual(shape(a));
    expect((await s.workout.undoOp({ sessionId, targetOpId: 'fit-today' })).ok).toBe(true);
    const back = await s.workout.load(sessionId);
    expect(shape(back?.aggregate ?? a)).toEqual(shape(a));
    expect(undoableTimeFit(back?.aggregate ?? a, h.now())).toBeNull();
  });
});

describe('builder-loads review B2: a plan day from Today never plans below newer, heavier history', () => {
  it('bench logged at 130 × 8 @ 8 after the plan (its week-1 load from 100 × 7) → Today’s Push card plans from the newer sets, an estimate', async () => {
    const { s, gymId } = await benWithPlan();
    const before = await loaded(s);
    const pushKey = dayKeyOf(before, 'Push');
    const planTop = Number(s.todaySession.card(before, sel(before, pushKey))?.rows[0]?.top);
    expect(planTop).toBeGreaterThan(0);
    expect(planTop).toBeLessThan(110);
    await logWorkout(h, s, gymId, [{ exercise: 'Bench press', sets: [{ load: 130, reps: 8, rpe: 8 }, { load: 130, reps: 8, rpe: 8 }, { load: 130, reps: 8, rpe: 8 }] }]);
    h.clockMs += DAY;
    const after = await loaded(s);
    const card = s.todaySession.card(after, sel(after, dayKeyOf(after, 'Push')));
    expect(card?.rows[0]?.name).toBe('Bench press');
    // 130 × 8 @ 8 → est. max ≈ 173; 6–8 reps @ 8 ≈ 130–137, rounded down on the bar. Never the plan's ~100.
    expect(Number(card?.rows[0]?.top)).toBeGreaterThanOrEqual(125);
  });
});

describe('reps from history (Ben, 21 Oct): a plan day started from Today plans reps from his last session of each exercise', () => {
  it('barbell row (the Pull day’s second lift; the plan says 6–8) last done 3 × 70 × 12 → the started Pull day plans it at 9–12 reps; the main lift keeps its top set', async () => {
    const { s, gymId } = await benWithPlan();
    await logWorkout(h, s, gymId, [{ exercise: 'Barbell row', sets: [{ load: 70, reps: 12 }, { load: 70, reps: 12 }, { load: 70, reps: 12 }] }]);
    h.clockMs += DAY;
    const data = await loaded(s);
    const pullKey = dayKeyOf(data, 'Pull');
    const c = await s.todaySession.commit(data, sel(data, pullKey), 'commit-pull');
    if (!c.ok) throw new Error(c.message);
    const started = await s.todaySession.start({ draftId: c.draftId, expectedVersion: c.version, gymId, opId: 'start-pull', checkIn: { kind: 'skipped', atUtc: h.now().utc } });
    if (!started.ok) throw new Error(JSON.stringify(started.error));
    const a = started.aggregate;
    const reps = (name: string) => {
      const e = a.exercises.find((x) => x.exerciseName === name);
      if (e === undefined) throw new Error(`no ${name}`);
      return a.sets.filter((x) => x.sessionExerciseId === e.id && x.setType !== 'warmup').map((x) => [x.setType, x.planned.reps?.min ?? 0, x.planned.load?.value ?? null] as const);
    };
    const row = reps('Barbell row');
    expect(row.length).toBeGreaterThan(0);
    for (const [type, n, load] of row) {
      expect(type).toBe('working');
      expect(n).toBeGreaterThanOrEqual(9);
      expect(n).toBeLessThanOrEqual(12);
      expect(load ?? 0).toBeGreaterThanOrEqual(70);
    }
    // The main lift (lat pulldown) keeps its top set / back-offs scheme.
    expect(reps('Lat pulldown')[0]?.[0]).toBe('top');
  });
});
