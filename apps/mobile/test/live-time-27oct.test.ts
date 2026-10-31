import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { catalogueExerciseId, slotsOf, workingCount } from '@fizz/domain';
import type { ModelEvent, ModelRequest } from '@fizz/coach';
import type { RoutineExercise } from '@fizz/schemas';

import type { BuilderSnapshot, BuilderWriteResult } from '../src/builder/builder-service';
import { workoutView } from '../src/builder/builder-view';
import type { AppServices } from '../src/services/app-services';
import type { TodaySelection, TodaySessionData } from '../src/services/today-session';
import { editorTimeView } from '../src/workout/template-editor';
import { CONNECTED, replyWith, StepModel, toolCall } from './coach-model';
import { createHarness, logWorkout, setUpGym, type Harness } from './harness';

/**
 * (Ben, 27 Oct: "if I add an exercise without changing the time it changes the time automatically, and if I manually
 * change an exercise it should update too") Time shows the live estimate of the workout on the page, by the one
 * estimate (`estimateBuilderSeconds`) on Today's card, Your workout and the workout editor; `Time ±` steps from it and
 * fits; Ben's own edits are never cut to hold the length, and past it the number is in the warning tone. Real SQLite,
 * offline, no coach call for any of it.
 */

const DAY = 86_400_000;
const read = (p: string) => readFileSync(join(__dirname, '..', 'src', p), 'utf8');
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
const DAYS: [string, string | null, Ex[]][] = [
  ['Push', 'push', [['Bench press', { reps: { min: 6, max: 8 }, load: kgLoad(100) }], ['Incline dumbbell press', { load: kgLoad(27.5, 'per_hand') }], ['Triceps pushdown', { load: kgLoad(30, 'stack') }]]],
  ['Pull', 'pull', [['Lat pulldown', { load: kgLoad(60, 'stack') }], ['Barbell row', { reps: { min: 6, max: 8 }, load: kgLoad(70) }]]],
  ['Legs', 'legs', [['Back squat', { reps: { min: 5, max: 6 }, load: kgLoad(100) }]]],
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
  return toolCall('propose_plan', { days: DAYS.map(([dayName, splitDayId, exs]) => ({ dayName, splitDayId, focus: null, minutes: null, exercises: exs.map(([n, over]) => ex(idOf(n), over ?? {})) })), message: 'Push, pull, legs.', minutes: null, gymName: null });
};

async function benWithPlan() {
  const { services: s } = await h.launch();
  const gymId = await setUpGym(h, s);
  await logWorkout(h, s, gymId, [{ exercise: 'Bench press', sets: [{ load: 100, reps: 7, rpe: 8 }, { load: 100, reps: 7, rpe: 8 }] }]);
  h.clockMs += DAY;
  model = new StepModel([planStub, () => replyWith('Here is your week.')]);
  const r = await s.coach.send({ entry: { kind: 'today' }, threadId: null, input: { kind: 'words', text: 'Build me a 3-day plan', spoken: false }, turnId: h.ids() });
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
const dayKeyOf = (data: TodaySessionData, name: string) => data.days.find((d) => d.name === name)?.key ?? '';
const snapOf = (r: BuilderWriteResult): BuilderSnapshot => {
  if (r.status !== 'written' && r.status !== 'replayed') throw new Error(`write ${r.status}: ${r.message}`);
  return r.snapshot;
};

/** Today's `Edit`: the card committed as today's draft, then Your workout on it (as the screen does). */
async function edit(s: AppServices, data: TodaySessionData, selection: TodaySelection): Promise<BuilderSnapshot> {
  const c = await s.todaySession.commit(data, selection, 'edit-1');
  if (!c.ok) throw new Error(c.message);
  const snap = await s.builder.read(c.draftId);
  if (snap === null) throw new Error('no draft');
  return snap;
}

/** Today's card for the day now (after Your workout's writes). */
async function cardTime(s: AppServices, key: string) {
  const data = await loaded(s);
  const card = s.todaySession.card(data, sel(data, key));
  if (card === null || card.time === null) throw new Error('no card');
  return { card, time: card.time };
}

const counts = (x: BuilderSnapshot) => Object.fromEntries(slotsOf(x.workout.blocks).map((sl) => [sl.key, workingCount(sl)]));
const FLY = catalogueExerciseId('cable-fly');

describe('Your workout: Time is the live estimate, and Today’s card agrees', () => {
  it('adding an exercise raises the number, removing it lowers it; Today’s card shows the same minutes each time', async () => {
    const { s } = await benWithPlan();
    const data = await loaded(s);
    const key = dayKeyOf(data, 'Push');
    const snap0 = await edit(s, data, sel(data, key, { supersets: false }));
    const v0 = workoutView(snap0).time;
    expect(v0.minutes).toBe(snap0.minutes);
    expect(v0.length).toBe(snap0.setup.minutes);
    expect((await cardTime(s, key)).time.minutes).toBe(v0.minutes);

    // Ben adds an exercise without touching Time: the number goes up at once; nothing he had is cut to hold the length.
    const added = snapOf(await s.builder.edit(snap0.draftId, { kind: 'add_exercise', exerciseId: FLY }, { opId: 'add-fly', basis: { version: snap0.version } }));
    const v1 = workoutView(added).time;
    expect(v1.minutes).toBe(added.minutes);
    expect(v1.minutes).toBeGreaterThan(v0.minutes);
    expect(v1.length).toBe(v0.length);
    for (const [k, n] of Object.entries(counts(snap0))) expect(counts(added)[k]).toBe(n);
    expect(v1.over).toBe(v1.minutes > v1.length);
    const c1 = await cardTime(s, key);
    expect(c1.card.edited?.draftId).toBe(added.draftId);
    expect(c1.time.minutes).toBe(v1.minutes);
    expect(c1.card.minutes).toBe(v1.minutes);
    expect(c1.time.over).toBe(v1.over);

    // A set more on it: up again; then removing the exercise brings it back down.
    const fly = slotsOf(added.workout.blocks).find((sl) => sl.exerciseId === FLY);
    if (fly === undefined) throw new Error('no fly');
    const more = snapOf(await s.builder.edit(added.draftId, { kind: 'add_set', slotKey: fly.key }, { opId: 'fly-set', basis: { version: added.version } }));
    expect(workoutView(more).time.minutes).toBeGreaterThan(v1.minutes);
    const removed = snapOf(await s.builder.edit(more.draftId, { kind: 'delete_exercise', slotKey: fly.key }, { opId: 'del-fly', basis: { version: more.version } }));
    const v2 = workoutView(removed).time;
    expect(v2.minutes).toBeLessThan(workoutView(more).time.minutes);
    expect(v2.minutes).toBe(v0.minutes);
    expect((await cardTime(s, key)).time.minutes).toBe(v2.minutes);
  });

  it('Time − then add an exercise: the number rises above the fitted length in the warning tone; nothing of Ben’s is cut; Today agrees', async () => {
    const { s } = await benWithPlan();
    const data = await loaded(s);
    const key = dayKeyOf(data, 'Push');
    const snap0 = await edit(s, data, sel(data, key, { supersets: false }));
    const to = workoutView(snap0).time.less;
    if (to === null) throw new Error('no less');
    const fitted = snapOf(await s.builder.setTime(snap0.draftId, to, { opId: 'time-less', expectedVersion: snap0.version }));
    const vf = workoutView(fitted).time;
    // After the fit the number is the new estimate (at or under the length it fitted to), not the length itself.
    expect(vf.length).toBe(to);
    expect(vf.minutes).toBe(fitted.minutes);
    expect(vf.minutes).toBeLessThanOrEqual(to);
    expect(vf.over).toBe(false);

    // Ben adds an exercise and sets on it until it is past the length: his edits stand, the number follows them.
    let snap = snapOf(await s.builder.edit(fitted.draftId, { kind: 'add_exercise', exerciseId: FLY }, { opId: 'add-fly', basis: { version: fitted.version } }));
    const fly = slotsOf(snap.workout.blocks).find((sl) => sl.exerciseId === FLY);
    if (fly === undefined) throw new Error('no fly');
    for (let i = 0; i < 4 && !workoutView(snap).time.over; i += 1) snap = snapOf(await s.builder.edit(snap.draftId, { kind: 'add_set', slotKey: fly.key }, { opId: `fly-set-${String(i)}`, basis: { version: snap.version } }));
    const v = workoutView(snap);
    expect(v.time.minutes).toBe(snap.minutes);
    expect(v.time.minutes).toBeGreaterThan(to);
    expect(v.time.length).toBe(to);
    expect(v.time.over).toBe(true);
    expect(v.overLine).toBe(`⚠ Over ${String(to)} min`);
    // Not cut to hold the length: every exercise the fit left is still there with its sets, and the fly with Ben's.
    for (const [k, n] of Object.entries(counts(fitted))) expect(counts(snap)[k]).toBe(n);
    expect(counts(snap)[fly.key]).toBeGreaterThanOrEqual(workingCount(fly));
    // Today's card: the same number, in the same tone.
    const c = await cardTime(s, key);
    expect(c.time.minutes).toBe(v.time.minutes);
    expect(c.time.over).toBe(true);
    expect(c.time.overText?.replace('\u00a0', ' ')).toBe(`⚠ Over ${String(to)} min`);
    // `+` goes on from the estimate; the steps are the same on both.
    expect(v.time.more).toBeGreaterThan(v.time.minutes);
    expect(c.time.more).toBe(v.time.more);
    expect(c.time.less).toBe(v.time.less);
  });

  it('an untouched card: the Time number is the card’s estimate (its summary’s), and a step moves it', async () => {
    const { s } = await benWithPlan();
    const data = await loaded(s);
    const key = dayKeyOf(data, 'Push');
    const card = s.todaySession.card(data, sel(data, key));
    if (card === null || card.time === null) throw new Error('no card');
    expect(card.time.minutes).toBe(card.minutes);
    expect(card.time.length).toBe(data.initial[key]?.minutes);
    const to = card.time.less;
    if (to === null) throw new Error('no less');
    const shorter = s.todaySession.card(data, sel(data, key, { minutes: to }));
    expect(shorter?.time?.minutes).toBe(shorter?.minutes);
    expect(shorter?.time?.minutes ?? 0).toBeLessThan(card.time.minutes);
  });
});

describe('the workout editor: Time is the live estimate, by the same estimate', () => {
  const slot = (key: string, n: number, sets: number): RoutineExercise => ({
    id: h.ids(),
    exerciseId: catalogueExerciseId(key),
    equipmentId: null,
    order: n,
    supersetGroup: null,
    setTemplates: Array.from({ length: sets }, () => ({ id: h.ids(), setType: 'working' as const, targetLoad: null, targetReps: { min: 8, max: 10 }, targetDurationS: null, targetRpe: 8, targetRir: null, restOverrideS: null })),
    restBySetType: {},
    transitionRestS: null,
    progressionRuleId: null,
  });

  it('the editor’s estimate is Your workout’s for the same workout; add raises it, remove lowers it; a fit then an add goes past the length', async () => {
    const { services: s } = await h.launch();
    const gymId = await setUpGym(h, s);
    const exercises = [slot('barbell-bench-press', 0, 3), slot('cable-triceps-pushdown', 1, 3), slot('dumbbell-lateral-raise', 2, 3)];
    const made = await s.routines.create({ edit: { name: 'Push A', exercises }, opId: 'new-push' });
    if (!made.ok) throw new Error(made.message);
    const stored = made.routine.exercises;
    const est0 = await s.routines.estimate({ exercises: stored, gymId });
    // Your workout opened on the same workout: the same minutes.
    const opened = snapOf(await s.builder.openTarget({ kind: 'routine', routineId: made.routine.id }, 'open-push'));
    expect(est0).toBe(opened.minutes);
    expect(est0).toBe(workoutView(opened).time.minutes);

    // Add an exercise: up. Remove one: down.
    const plus = [...stored, slot('cable-fly', 3, 3)];
    const est1 = await s.routines.estimate({ exercises: plus, gymId });
    expect(est1 ?? 0).toBeGreaterThan(est0 ?? 0);
    const est2 = await s.routines.estimate({ exercises: stored.slice(0, 2), gymId });
    expect(est2 ?? 0).toBeLessThan(est0 ?? 0);
    // A rest change on the page moves it too.
    const restful = stored.map((e, i): RoutineExercise => (i === 1 ? { ...e, restBySetType: { working: { seconds: 240 } } } : e));
    const est3 = await s.routines.estimate({ exercises: restful, gymId });
    expect(est3 ?? 0).toBeGreaterThan(est0 ?? 0);

    // The editor's row: the estimate, steps from it; a fit to `−`, then Ben adds an exercise: past that length, warned.
    const v0 = editorTimeView({ estimate: est0, length: null, fitted: false });
    if (v0 === null || v0.less === null) throw new Error('no time');
    expect(v0).toMatchObject({ minutes: est0, over: false });
    const fit = await s.routines.fitTemplate({ exercises: stored, gymId, minutes: v0.less, defaultRestS: 120 });
    if (fit === null) throw new Error('no fit');
    const fittedEst = await s.routines.estimate({ exercises: fit.exercises, gymId });
    expect(Math.round(fit.seconds / 60)).toBe(fittedEst);
    const vf = editorTimeView({ estimate: fittedEst, length: v0.less, fitted: true });
    expect(vf?.minutes).toBe(fittedEst);
    expect(vf?.over).toBe(false);
    const afterAdd = await s.routines.estimate({ exercises: [...fit.exercises, slot('cable-fly', 3, 4)], gymId });
    const va = editorTimeView({ estimate: afterAdd, length: v0.less, fitted: false });
    expect(va?.minutes).toBe(afterAdd);
    expect(va?.minutes ?? 0).toBeGreaterThan(v0.less);
    expect(va?.over).toBe(true);
  });
});

describe('the screens show the service’s live number (no estimate of their own)', () => {
  it('Your workout, Today’s card and the editor pass the estimate, its warning tone and its steps', () => {
    const page = read('screens/builder/BuilderWorkoutScreen.tsx');
    expect(page).toContain('over={v.time.over}');
    // (Redesign v3) Today's card shows the live estimate (`Est. time`) and the warning; its steps are Your workout's.
    const card = read('screens/today/TodaySession.tsx');
    expect(card).toContain('todayCardRows(view, gymLabel)');
    expect(card).toContain('time?.overText != null');
    expect(read('today/today-view.ts')).toContain('TODAY_V2_COPY.minutesValue(v.time?.minutes ?? v.minutes)');
    const editor = read('screens/builder/EditWorkoutScreen.tsx');
    expect(editor).toContain('editorTimeView({ estimate: minutes, length: timeLength, fitted: fit !== null })');
    expect(editor).toContain('over={time?.over ?? false}');
    for (const src of [page, card, editor, read('screens/TodayScreen.tsx')]) {
      expect(src).not.toContain('stepTimeMinutes');
      expect(src).not.toContain('estimateBuilder');
    }
    expect(editor).not.toContain('fit?.target');
  });
});

describe('a plan day’s template in the editor: the same minutes as Today’s card', () => {
  it('the editor times the day as Today drafts it; add raises it; saved, Today’s card shows what the editor showed', async () => {
    const { s, gymId } = await benWithPlan();
    const data = await loaded(s);
    const key = dayKeyOf(data, 'Push');
    const card = s.todaySession.card(data, sel(data, key));
    const routineId = data.days.find((d) => d.key === key)?.templates[0]?.routineId ?? '';
    const ed = await s.routines.editor({ routineId, gymId });
    if (ed === null || card === null || card.time === null) throw new Error('no editor');
    // The plan's length for the day is the editor's length, as on the card.
    expect(ed.planMinutes).toBe(card.time.length);
    const est0 = await s.routines.estimate({ exercises: ed.exercises, gymId, routineId });
    expect(est0).toBe(card.minutes);
    expect(editorTimeView({ estimate: est0, length: ed.planMinutes ?? null, fitted: false })?.minutes).toBe(card.time.minutes);

    // Ben adds an exercise (4 sets) on the page: the number goes up before he saves.
    const fly: RoutineExercise = { ...(ed.exercises[ed.exercises.length - 1] as RoutineExercise), id: h.ids(), exerciseId: FLY, order: ed.exercises.length, supersetGroup: null, setTemplates: Array.from({ length: 4 }, () => ({ id: h.ids(), setType: 'working' as const, targetLoad: null, targetReps: { min: 10, max: 12 }, targetDurationS: null, targetRpe: 8, targetRir: null, restOverrideS: null })) };
    const list = [...ed.exercises, fly];
    const est1 = await s.routines.estimate({ exercises: list, gymId, routineId });
    expect(est1 ?? 0).toBeGreaterThan(est0 ?? 0);
    // Removing one lowers it.
    const est2 = await s.routines.estimate({ exercises: ed.exercises.slice(0, -1), gymId, routineId });
    expect(est2 ?? 0).toBeLessThan(est0 ?? 0);

    // Saved: Today's card for the day shows the minutes the editor showed (it is under the plan's length here).
    const saved = await s.routines.update({ routineId, edit: { name: ed.routine?.name ?? 'Push', exercises: list }, expectedVersion: ed.routine?.version ?? 0, opId: 'save-plan-day' });
    expect(saved.ok).toBe(true);
    const after = await loaded(s);
    const card2 = s.todaySession.card(after, sel(after, key));
    expect(card2?.time?.over).toBe(false);
    expect(card2?.minutes).toBe(est1);
    expect(card2?.time?.minutes).toBe(est1);
  });
});
