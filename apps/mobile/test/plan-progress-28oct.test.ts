import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { slotsOf, toIso, workingCount } from '@fizz/domain';
import type { ModelEvent, ModelRequest } from '@fizz/coach';

import type { ImportDraft } from '../src/import/import-service';
import type { AppServices } from '../src/services/app-services';
import type { TodaySessionData } from '../src/services/today-session';
import type { BuilderSnapshot, BuilderWriteResult } from '../src/builder/builder-service';
import { workoutView } from '../src/builder/builder-view';
import { CONNECTED, replyWith, StepModel, toolCall } from './coach-model';
import { createHarness, logWorkout, setUpGym, TZ, type Harness } from './harness';

/**
 * (Ben, 28 Oct) Real SQLite, offline, no coach call:
 * 1. an imported or past-logged workout counts as its plan day (by name, else by lifts; unclear → `Count as Pull?`,
 *    Ben's answer versioned with Undo), for Up next, this week's days and Library › Plan;
 * 2. Up next re-reads after history changes (the screen's redraft is `followUpNext`, tested pure);
 * 5. the one time estimate learns Ben's pace from his own logged times;
 * 6. Your workout's `+` makes today's workout longer (sets, then the main lift, then exercises), today only.
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
const DAYS: [string, string | null, Ex[]][] = [
  ['Push', 'push', [['Bench press', { reps: { min: 6, max: 8 }, load: kgLoad(100) }], ['Incline dumbbell press', { load: kgLoad(27.5, 'per_hand') }], ['Triceps pushdown', { load: kgLoad(30, 'stack') }]]],
  ['Pull', 'pull', [['Barbell row', { reps: { min: 6, max: 8 }, load: kgLoad(70) }], ['Lat pulldown', { load: kgLoad(60, 'stack') }]]],
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

/** Ben with the 3-day plan applied Tue 13 Oct, Push done Mon 12 Oct (before it). */
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
const upNext = async (s: AppServices) => {
  const d = await loaded(s);
  return d.days.find((x) => x.key === d.nextKey)?.name ?? null;
};

const HEADER = 'Date,Exercise,Category,Weight (kgs),Reps,Distance,Distance Unit,Time';
async function importFile(s: AppServices, rows: string[], opId: string): Promise<string> {
  const opened = await s.imports.open({ name: `FitNotes_${opId}.csv`, text: [HEADER, ...rows].join('\n') });
  if (opened.kind !== 'preview') throw new Error(`expected a preview, got ${opened.kind}`);
  let draft: ImportDraft = opened.draft;
  const step = async (change: Parameters<AppServices['imports']['answer']>[2]) => {
    const r = await s.imports.answer(draft.draftId, draft.mappingVersion, change);
    if (!r.ok) throw new Error(r.reason);
    draft = r.draft;
  };
  for (const n of draft.analysis.names.filter((x) => x.needsAnswer)) if (n.match.exerciseId) await step({ kind: 'name', key: n.key, answer: { kind: 'exercise', exerciseId: n.match.exerciseId } });
  if (draft.analysis.total?.open) await step({ kind: 'total', answer: 'total' });
  if (draft.analysis.perHand?.open) await step({ kind: 'per_hand', answer: 'each' });
  const r = await s.imports.commit(draft.draftId, draft.mappingVersion, opId);
  if (!r.ok) throw new Error(r.reason);
  return r.jobId;
}

/** The imported workout on `date`'s ID (History's row). */
async function importedOn(s: AppServices, date: string): Promise<string> {
  const feed = await s.history.feed();
  const row = feed.items.find((i) => i.kind === 'workout' && i.source === 'import' && i.localDate === date);
  if (row?.kind !== 'workout') throw new Error(`no import on ${date}`);
  return row.sessionId;
}
const setsOf = async (s: AppServices, sid: string) => JSON.stringify((await s.workout.load(sid))?.aggregate.sets);

describe('1. An imported workout counts as its plan day', () => {
  it('a Pull workout imported for yesterday: Up next becomes Legs, Library › Plan ticks Pull for that day, nothing asked; the workout itself is unchanged', async () => {
    const { s } = await benWithPlan();
    // Thursday 15 Oct.
    h.clockMs += 2 * DAY;
    expect(await upNext(s)).toBe('Pull');
    await importFile(s, ['2026-10-14,Barbell Row,Back,70.0,8,,,', '2026-10-14,Barbell Row,Back,70.0,8,,,', '2026-10-14,Lat Pulldown,Back,60.0,10,,,', '2026-10-14,Lat Pulldown,Back,60.0,10,,,'], 'import-pull');
    expect(await upNext(s)).toBe('Legs');
    const sid = await importedOn(s, '2026-10-14');
    const before = await setsOf(s, sid);
    const overview = await s.plans.overview();
    const pull = overview?.days.find((d) => d.name.startsWith('Pull'));
    expect(pull?.doneOn).toBe('2026-10-14');
    expect(overview?.days.find((d) => d.next)?.name.startsWith('Legs')).toBe(true);
    // Matched for sure: nothing to ask; its sets are as imported (rule 2).
    expect(await s.plans.dayLinkAsk(sid)).toBeNull();
    expect(await setsOf(s, sid)).toBe(before);
    // Today's week: Pull done Wednesday.
    const d = await loaded(s);
    expect(d.week.doneOn[d.days.find((x) => x.name === 'Pull')?.key ?? '']).toBe('2026-10-14');
    // A relaunch reads the same (nothing held in memory).
    await h.forceClose();
    const { services: s2 } = await h.launch();
    expect(await upNext(s2)).toBe('Legs');
  });

  it('Log a past workout of Pull yesterday: Up next becomes Legs', async () => {
    const { s, gymId } = await benWithPlan();
    h.clockMs += 2 * DAY;
    expect(await upNext(s)).toBe('Pull');
    const start = h.clockMs - DAY;
    const started = await s.workout.start({ gymId, opId: 'past-pull', checkIn: null, pastStart: { utc: toIso(start), tz: TZ } });
    if (!started.ok) throw new Error(started.error.message);
    const sid = started.aggregate.session.id;
    for (const name of ['Barbell row', 'Lat pulldown']) {
      const pick = (await s.workout.pickerExercises(sid, name)).find((x) => x.exercise.name === name);
      if (!pick) throw new Error(name);
      const added = await s.workout.addExercise({ sessionId: sid, exerciseId: pick.exercise.id, equipmentId: pick.equipment[0]?.id ?? null, opId: h.ids() });
      if (!added.ok) throw new Error(added.error.message);
      const e = added.aggregate.exercises.at(-1);
      for (const set of added.aggregate.sets.filter((x) => x.sessionExerciseId === e?.id && x.status === 'pending').slice(0, 2)) {
        const r = await s.workout.dispatch(sid, { type: 'log_set', at: h.now(), opId: h.ids(), setId: set.id, values: { load: { value: 60, unit: e?.unit ?? 'kg', convention: e?.loadConvention ?? 'total' }, reps: 8, durationS: null, rpe: null, rir: null }, restTimerId: h.ids() });
        if (!r.ok) throw new Error(r.error.message);
      }
    }
    const back = await s.workout.load(sid);
    const fin = await s.workout.dispatch(sid, { type: 'finish', at: h.now(), opId: 'past-fin', expectedVersion: back?.aggregate.session.version ?? 0, endedAt: { utc: toIso(start + 50 * 60_000), tz: TZ } });
    if (!fin.ok) throw new Error(fin.error.message);
    await h.settle(s);
    expect(await upNext(s)).toBe('Legs');
  });

  it('unclear: `Count as …?` once on its Summary; Count counts it (Up next moves), Undo takes it back, Not a plan day ticks no day', async () => {
    const { s } = await benWithPlan();
    h.clockMs += 2 * DAY;
    // A full-body day: the Legs day's main lift with Push and Pull work as well, no clear match.
    await importFile(s, ['2026-10-14,Barbell Squat,Legs,100.0,5,,,', '2026-10-14,Flat Barbell Bench Press,Chest,80.0,8,,,', '2026-10-14,Lat Pulldown,Back,60.0,10,,,', '2026-10-14,Dumbbell Lateral Raise,Shoulders,10.0,12,,,'], 'import-mixed');
    const sid = await importedOn(s, '2026-10-14');
    const ask = await s.plans.dayLinkAsk(sid);
    expect(ask).not.toBeNull();
    if (ask === null) throw new Error('no ask');
    expect(ask.dayName).toBe('Legs');
    const nextBefore = await upNext(s);

    const counted = await s.plans.answerDayLink({ planId: ask.planId, sessionId: sid, answer: 'count', routineId: ask.routineId, expectedVersion: ask.planVersion, opId: 'count-1' });
    if (!counted.ok) throw new Error(counted.message);
    // Asked once: answered, the question is gone; a retried tap replays (one write).
    expect(await s.plans.dayLinkAsk(sid)).toBeNull();
    expect(await s.plans.answerDayLink({ planId: ask.planId, sessionId: sid, answer: 'count', routineId: ask.routineId, expectedVersion: ask.planVersion, opId: 'count-1' })).toMatchObject({ ok: true, duplicate: true });
    // A stale read (the version before) is refused.
    expect(await s.plans.answerDayLink({ planId: ask.planId, sessionId: sid, answer: 'not_plan_day', routineId: null, expectedVersion: ask.planVersion, opId: 'late' })).toMatchObject({ ok: false, reason: 'stale' });
    const overview = await s.plans.overview();
    expect(overview?.days.find((d) => d.name.startsWith('Legs'))?.doneOn).toBe('2026-10-14');
    expect(await upNext(s)).toBe('Pull');

    // Undo: asked again, the plan reads as before.
    const undone = await s.plans.undoDayLink({ planId: ask.planId, targetOpId: 'count-1', expectedVersion: counted.plan.version, opId: 'undo-1' });
    if (!undone.ok) throw new Error(undone.message);
    expect((await s.plans.dayLinkAsk(sid))?.dayName).toBe('Legs');
    expect(await upNext(s)).toBe(nextBefore);

    // Not a plan day: no plan day ticked by it this week, nothing asked again.
    const again = await s.plans.dayLinkAsk(sid);
    const no = await s.plans.answerDayLink({ planId: ask.planId, sessionId: sid, answer: 'not_plan_day', routineId: null, expectedVersion: again?.planVersion ?? 0, opId: 'no-1' });
    expect(no.ok).toBe(true);
    expect(await s.plans.dayLinkAsk(sid)).toBeNull();
    const after = await s.plans.overview();
    expect(after?.days.filter((d) => d.doneOn === '2026-10-14')).toEqual([]);
  });
});

/** Your workout on Today's card for `day` (as the screen's Edit does). */
async function edit(s: AppServices, data: TodaySessionData, day: string): Promise<BuilderSnapshot> {
  const key = data.days.find((d) => d.name === day)?.key ?? '';
  const c = data.initial[key];
  if (c === undefined) throw new Error(`no ${day}`);
  const r = await s.todaySession.commit(data, { dayKey: key, controls: { ...c, supersets: false } }, `edit-${day}`);
  if (!r.ok) throw new Error(r.message);
  const snap = await s.builder.read(r.draftId);
  if (snap === null) throw new Error('no draft');
  return snap;
}
const snapOf = (r: BuilderWriteResult): BuilderSnapshot => {
  if (r.status !== 'written' && r.status !== 'replayed') throw new Error(`write ${r.status}: ${r.message}`);
  return r.snapshot;
};
const shape = (x: BuilderSnapshot) => slotsOf(x.workout.blocks).map((sl) => workingCount(sl));

describe('6. Your workout’s + makes today’s workout longer', () => {
  it('on a plan day: accessory sets to 4, then the main lift to 5, then exercises; Undo puts the plan day back; the plan day is untouched; at the end `Nothing more to add`', async () => {
    const { s, gymId } = await benWithPlan();
    const data = await loaded(s);
    let snap = await edit(s, data, 'Push');
    const plan0 = shape(snap);
    expect(plan0).toEqual([3, 3, 3]);
    const routineId = data.days.find((d) => d.name === 'Push')?.templates[0]?.routineId ?? '';
    const storedOf = async () => JSON.stringify((await s.routines.editor({ routineId, gymId }))?.exercises.map((e) => [e.exerciseId, e.setTemplates.length]));
    const stored = await storedOf();
    const keys = slotsOf(snap.workout.blocks).map((x) => x.key);
    /** [main, the plan's two accessories, exercises in all], by slot key (an added exercise can go between them). */
    const state = (x: BuilderSnapshot) => {
      const of = (k: string | undefined) => workingCount(slotsOf(x.workout.blocks).find((y) => y.key === k) ?? { rows: [] });
      return [of(keys[0]), of(keys[1]), of(keys[2]), slotsOf(x.workout.blocks).length];
    };
    const seen: number[][] = [];
    let refused: string | null = null;
    for (let i = 0; i < 30; i += 1) {
      const t = workoutView(snap).time;
      if (t.more === null) break;
      const r = await s.builder.setTime(snap.draftId, t.more, { opId: `more-${String(i)}`, expectedVersion: snap.version, grow: true });
      if (r.status === 'refused') {
        refused = r.message;
        break;
      }
      const next = snapOf(r);
      // Every + moves the estimate up.
      expect(next.minutes).toBeGreaterThan(snap.minutes);
      snap = next;
      seen.push(state(snap));
    }
    // First the accessories (to 4), then the main lift (to 5), then new exercises: in every state along the way, the
    // main lift has grown only with both accessories at 4, and an exercise was added only with the main lift at 5.
    expect(seen.length).toBeGreaterThan(5);
    for (const x of seen) {
      if ((x[0] ?? 0) > 3) expect(x.slice(1, 3)).toEqual([4, 4]);
      if ((x[3] ?? 0) > 3) expect(x[0]).toBe(5);
    }
    expect(seen.some((x) => x[3] === 3 && x[0] === 5)).toBe(true);
    expect(slotsOf(snap.workout.blocks).length).toBe(8);
    expect(refused).toBe('Nothing more to add');
    // The note says what Time did; the plan day as stored never changed.
    expect(workoutView(snap).time.note).not.toBeNull();
    expect(await storedOf()).toBe(stored);
    // The note's Undo: back to the plan day's workout.
    const undo = workoutView(snap).time.undoMinutes;
    if (undo === null) throw new Error('no undo');
    const back = snapOf(await s.builder.setTime(snap.draftId, undo, { opId: 'undo-time', expectedVersion: snap.version }));
    expect(shape(back)).toEqual(plan0);
  });
});

/** A workout logged live at Ben's pace: each set `setS`, rests `rest × scale`, `changeS` between exercises. */
async function logAtPace(s: AppServices, gymId: string, names: string[], o: { setS: number; scale: number; changeS: number }) {
  const started = await s.workout.start({ gymId, opId: `start-${String(h.clockMs)}`, checkIn: { kind: 'skipped', atUtc: h.now().utc } });
  if (!started.ok) throw new Error(started.error.message);
  const sid = started.aggregate.session.id;
  for (const name of names) {
    const pick = (await s.workout.pickerExercises(sid, name)).find((x) => x.exercise.name === name);
    if (!pick) throw new Error(name);
    const added = await s.workout.addExercise({ sessionId: sid, exerciseId: pick.exercise.id, equipmentId: pick.equipment[0]?.id ?? null, opId: h.ids() });
    if (!added.ok) throw new Error(added.error.message);
    const e = added.aggregate.exercises.at(-1);
    const sets = added.aggregate.sets.filter((x) => x.sessionExerciseId === e?.id && x.status === 'pending' && x.setType !== 'warmup');
    for (const [k, set] of sets.entries()) {
      h.clockMs += (k === 0 ? o.changeS + o.setS : set.rest.seconds * o.scale + o.setS) * 1000;
      const r = await s.workout.dispatch(sid, { type: 'log_set', at: h.now(), opId: h.ids(), setId: set.id, values: { load: set.planned.load ?? { value: 40, unit: e?.unit ?? 'kg', convention: e?.loadConvention ?? 'total' }, reps: set.planned.reps?.min ?? 10, durationS: null, rpe: null, rir: null }, restTimerId: h.ids() });
      if (!r.ok) throw new Error(r.error.message);
    }
  }
  const data = await s.workout.load(sid);
  const fin = await s.workout.dispatch(sid, { type: 'finish', at: h.now(), opId: h.ids(), expectedVersion: data?.aggregate.session.version ?? 0, endedAt: null });
  if (!fin.ok) throw new Error(fin.error.message);
  await h.settle(s);
}

describe('5. The time estimate learns Ben’s pace', () => {
  it('after 3 slow timed workouts the same plan day reads longer on Today’s card, Your workout and the editor; imports never count', async () => {
    const { s, gymId } = await benWithPlan();
    const before = await loaded(s);
    const key = before.days.find((d) => d.name === 'Push')?.key ?? '';
    const sel = (d: TodaySessionData) => ({ dayKey: key, controls: d.initial[key] ?? before.initial[key]! });
    const card0 = s.todaySession.card(before, sel(before));
    // Imported history (no times) leaves the estimate as it was.
    await importFile(s, ['2026-10-01,Leg Extension,Legs,50.0,10,,,', '2026-10-01,Leg Extension,Legs,50.0,10,,,', '2026-10-02,Seated Calf Raise,Legs,40.0,12,,,'], 'import-old');
    const afterImport = await loaded(s);
    expect(s.todaySession.card(afterImport, sel(afterImport))?.minutes).toBe(card0?.minutes);
    // Three workouts (not on the plan's exercises) with rests run 40% over and slow changeovers.
    for (let i = 0; i < 3; i += 1) {
      h.clockMs += DAY;
      await logAtPace(s, gymId, ['Leg extension', 'Seated calf raise'], { setS: 50, scale: 1.4, changeS: 150 });
    }
    const after = await loaded(s);
    const card1 = s.todaySession.card(after, sel(after));
    expect(card1?.minutes ?? 0).toBeGreaterThan((card0?.minutes ?? 0) + 3);
    // Your workout and the editor time it the same way.
    const snap = await edit(s, after, 'Push');
    expect(workoutView(snap).time.minutes).toBeGreaterThan((card0?.minutes ?? 0) + 3);
    const routineId = after.days.find((d) => d.name === 'Push')?.templates[0]?.routineId ?? '';
    const ed = await s.routines.editor({ routineId, gymId });
    const est = await s.routines.estimate({ exercises: ed?.exercises ?? [], gymId, routineId });
    expect(est).toBe(card1?.minutes);
  });
});
