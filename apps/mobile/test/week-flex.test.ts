import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ModelEvent, ModelRequest } from '@fizz/coach';

import { activitySavedToast, type ActivityToast } from '../src/activity/activity-toast';
import type { AppServices } from '../src/services/app-services';
import { CONNECTED, replyWith, StepModel, toolCall } from './coach-model';
import { createHarness, logWorkout, setUpGym, type Harness } from './harness';

/**
 * Flex the week around a run (Ben, 20 Oct) end to end, real SQLite. Ben has a
 * 4-day plan (Chest, Shoulders, Back, Legs) and lifts 4 days a week. Monday:
 * Back. Thursday: "long run Saturday" (the coach logs it; Undo; he logs it
 * again from Today's ＋ Activity). Friday: Up next isn't Legs (the day before
 * the run). Ben asks the coach to plan his week around it: a proposal
 * (Chest + Shoulders → Push, this week), Apply, Up next is Push, Undo, Apply
 * again. Next Monday the plan is as it was.
 */

const DAY = 86_400_000;
let h: Harness;
let model: StepModel;
beforeEach(() => {
  model = new StepModel([]);
  // Saturday 17 Oct 2026, 09:00 in London.
  h = createHarness('2026-10-17T08:00:00.000Z', { coach: { model: () => model, connection: () => Promise.resolve(CONNECTED) } });
});
afterEach(async () => {
  await h.cleanup();
});

type Ex = [string, Record<string, unknown>?];
const ex = (catalogueId: string, over: Record<string, unknown> = {}) => ({ catalogueId, warmups: null, workingSets: 3, reps: { min: 8, max: 10 }, workSeconds: null, targetRpe: 8, topSet: null, restSeconds: null, superset: null, load: null, ...over });
const kgLoad = (value: number, convention = 'total') => ({ value, unit: 'kg', convention, basis: 'last time, same reps', from: 'own_history', relatedCatalogueId: null });
const FOUR: [string, Ex[]][] = [
  ['Chest', [['Bench press', { reps: { min: 6, max: 8 }, load: kgLoad(100) }], ['Incline dumbbell press', { load: kgLoad(27.5, 'per_hand') }]]],
  ['Shoulders', [['Overhead press', { reps: { min: 6, max: 8 }, load: kgLoad(50) }], ['Lateral raise', { load: kgLoad(10, 'per_hand') }]]],
  ['Back', [['Lat pulldown', { load: kgLoad(60, 'stack') }], ['Barbell row', { reps: { min: 6, max: 8 }, load: kgLoad(70) }]]],
  ['Legs', [['Back squat', { reps: { min: 5, max: 6 }, load: kgLoad(100) }], ['Leg press', { load: kgLoad(140) }]]],
];

function yourData(req: ModelRequest): Record<string, unknown> {
  const block = req.input.find((i) => i.type === 'message' && i.role === 'developer' && i.content.startsWith('YOUR DATA'));
  if (block?.type !== 'message') throw new Error('no context');
  return JSON.parse(block.content.slice(block.content.indexOf('\n') + 1)) as Record<string, unknown>;
}
const planStub = (req: ModelRequest): ModelEvent[] => {
  const usable = (yourData(req).build as { usable: { catalogueId: string; name: string }[] }).usable;
  const idOf = (name: string) => usable.find((u) => u.name === name)?.catalogueId ?? `missing-${name}`;
  return toolCall('propose_plan', { days: FOUR.map(([dayName, exs]) => ({ dayName, splitDayId: null, focus: null, minutes: null, exercises: exs.map(([n, over]) => ex(idOf(n), over ?? {})) })), message: 'Chest, shoulders, back, legs.', minutes: null, gymName: null });
};
interface WeekView {
  today: string;
  gymDaysLeft: number;
  remaining: { id: string; name: string }[];
  needsReshape: boolean;
  suggestion: { merges: { dayIds: string[]; name: string }[] } | null;
  activities: string[];
}
/** The coach reads YOUR DATA week and proposes its suggestion (Chest + Shoulders → Push). */
const weekStub = (seen: WeekView[]) => (req: ModelRequest): ModelEvent[] => {
  const week = yourData(req).week as WeekView;
  seen.push(week);
  return toolCall('propose_week', { merges: week.suggestion?.merges ?? [], skips: [], message: 'Saturday’s long run.' });
};

async function doDay(s: AppServices, gymId: string, routineId: string): Promise<string> {
  const started = await s.workout.start({ gymId, opId: `start-${routineId}-${String(h.clockMs)}`, checkIn: null, routineOf: routineId });
  if (!started.ok) throw new Error(started.error.message);
  const id = started.aggregate.session.id;
  for (const set of started.aggregate.sets) {
    if (set.status !== 'pending' || set.setType === 'warmup') continue;
    h.clockMs += 60_000;
    const conv = started.aggregate.exercises.find((e) => e.id === set.sessionExerciseId)?.loadConvention ?? 'total';
    const r = await s.workout.dispatch(id, { type: 'log_set', at: h.now(), opId: `log:${set.id}`, setId: set.id, values: { load: set.planned.load ?? { value: 20, unit: 'kg', convention: conv }, reps: set.planned.reps?.max ?? 8, durationS: null, rpe: 8, rir: null }, restTimerId: h.ids() });
    if (!r.ok) throw new Error(r.error.message);
  }
  h.clockMs += 60_000;
  const now = await s.workout.load(id);
  const fin = await s.workout.dispatch(id, { type: 'finish', at: h.now(), opId: h.ids(), expectedVersion: now?.aggregate.session.version ?? 0, endedAt: null });
  if (!fin.ok) throw new Error(fin.error.message);
  await h.settle(s);
  return id;
}

const say = async (s: AppServices, text: string) => s.coach.send({ entry: { kind: 'today' }, threadId: null, input: { kind: 'words', text, spoken: false }, turnId: h.ids() });
const upNext = async (s: AppServices, gymId: string) => {
  const p = await s.next.preview(gymId);
  return { title: p?.title ?? null, why: p?.why ?? null };
};
const sp = (t: string | null | undefined) => (t ?? '').replaceAll(' ', ' ');

/** Sat/Sun: chest and shoulders before the plan; Monday 19: the 4-day plan applied, aim 4 a week, then Back. */
async function benWithPlan() {
  const { services: s } = await h.launch();
  const gymId = await setUpGym(h, s);
  await logWorkout(h, s, gymId, [{ exercise: 'Bench press', sets: [{ load: 100, reps: 7, rpe: 8 }, { load: 100, reps: 7, rpe: 8 }] }]);
  h.clockMs += DAY;
  await logWorkout(h, s, gymId, [{ exercise: 'Overhead press', sets: [{ load: 50, reps: 7, rpe: 8 }, { load: 50, reps: 7, rpe: 8 }] }]);
  // Monday 19 Oct, 08:00.
  h.clockMs = Date.parse('2026-10-19T07:00:00.000Z');
  const snap = await s.training.snapshot();
  if (!snap) throw new Error('snapshot');
  expect(await s.training.change({ kind: 'days_per_week', days: 4 }, snap.profile.version, 'days-4')).toMatchObject({ ok: true });
  model = new StepModel([planStub, () => replyWith('Here is your week.')]);
  const r = await say(s, 'Build me a 4-day plan');
  const card = r.cards[0]?.record;
  if (card?.detail.kind !== 'build_plan') throw new Error('no plan');
  const planId = card.detail.planId;
  const c = await s.plans.card({ planId, versionN: 1 });
  expect(await s.plans.apply({ planId, versionN: 1, expectedVersion: c?.planVersion ?? 0, mode: 'replace', opId: 'apply-1' })).toMatchObject({ ok: true });
  const active = await s.plans.active();
  const byName = new Map(active?.days.map((d) => [d.name, d.routineId]));
  const day = (n: string) => byName.get(n) ?? '';
  h.clockMs += 3_600_000;
  await doDay(s, gymId, day('Back'));
  return { s, gymId, planId, day };
}

describe('flex the week around a run (Ben, 20 Oct)', () => {
  it('long run Saturday → Friday not Legs → coach merges Chest + Shoulders into Push → Apply → Undo → Apply → next week reverts', async () => {
    const { s, gymId } = await benWithPlan();
    // Legs was never trained: Up next.
    expect(await upNext(s, gymId)).toEqual({ title: 'Legs', why: null });

    // Thursday 22 Oct, 10:00: "long run Saturday". Ben's own words: logged at once, with Undo on the card.
    h.clockMs = Date.parse('2026-10-22T09:00:00.000Z');
    model = new StepModel([() => toolCall('log_activity', { kind: 'run', status: 'planned', date: '2026-10-24', durationMin: null, distanceKm: null, effort: 'long', reason: 'Ben has a long run on Saturday.' }), () => replyWith('Noted.')]);
    const told = await say(s, 'long run Saturday');
    const logged = told.cards.find((c) => c.record.detail.kind === 'log_activity')?.record;
    expect(logged).toMatchObject({ status: 'committed', detail: { fields: { kind: 'run', status: 'planned', date: '2026-10-24', effort: 'long' } } });
    expect(sp((await s.activities.recent())[0]?.detail)).toBe('Planned · long');
    // Two days before the run: legs is fine.
    expect((await upNext(s, gymId)).title).toBe('Legs');
    // Undo on the card takes it out; Ben logs it again himself from Today's ＋ Activity.
    expect((await s.coach.undo(logged?.actionId ?? '', 'undo-run')).result).toMatchObject({ status: 'written' });
    expect(await s.activities.recent()).toEqual([]);
    const added = await s.activities.add({ id: h.ids(), fields: { kind: 'run', status: 'planned', date: '2026-10-24', durationS: null, distanceM: null, effort: 'long' }, opId: 'sheet-run' });
    expect(added).toMatchObject({ ok: true, duplicate: false });

    // Friday 23 Oct, 08:00: the day before the long run. Up next isn't Legs.
    h.clockMs = Date.parse('2026-10-23T07:00:00.000Z');
    const friday = await upNext(s, gymId);
    expect(friday.title).not.toBe('Legs');
    expect(friday).toEqual({ title: 'Chest', why: null });
    let v = await s.plans.overview();
    expect(v?.activities.map(sp)).toEqual(['Run · Sat · long']);
    expect(v?.daysThisWeek.text).toBe('1 of 4');
    // Runs never count as gym days.
    expect((await s.plans.consistency())?.thisWeek.text).toBe('1/4');

    // "Plan my week around it": the coach proposes (rule 3); nothing changes until Apply.
    const seen: WeekView[] = [];
    model = new StepModel([weekStub(seen), () => replyWith('Want me to merge Chest and Shoulders into Push this week?')]);
    const asked = await say(s, "I've got a long run Saturday, plan my week around it");
    expect(seen[0]).toMatchObject({ today: '2026-10-23', gymDaysLeft: 2, needsReshape: true, remaining: [{ name: 'Chest' }, { name: 'Shoulders' }, { name: 'Legs' }] });
    expect(seen[0]?.activities.map(sp)).toEqual(['Run · Sat 2026-10-24 · planned · long']);
    const proposal = asked.cards.find((c) => c.record.detail.kind === 'propose_week')?.record;
    expect(proposal?.status).toBe('proposed');
    const card = await s.week.card(proposal?.actionId ?? '');
    expect(card).toMatchObject({
      scope: 'This week',
      before: [{ name: 'Chest' }, { name: 'Shoulders' }, { name: 'Legs' }],
      after: [{ name: 'Push', note: 'Chest + Shoulders' }, { name: 'Legs' }],
      state: { kind: 'open' },
    });
    expect((await upNext(s, gymId)).title).toBe('Chest');

    // Apply: Up next is the merged Push day; a double tap applies once; Your plan shows the change.
    const applied = await s.week.apply({ actionId: proposal?.actionId ?? '', opId: 'week-apply-1' });
    expect(applied).toMatchObject({ ok: true, duplicate: false });
    expect(await s.week.apply({ actionId: proposal?.actionId ?? '', opId: 'week-apply-1' })).toMatchObject({ ok: true, duplicate: true });
    expect(await s.week.apply({ actionId: proposal?.actionId ?? '', opId: 'week-apply-2' })).toMatchObject({ ok: false, reason: 'stale' });
    expect(await upNext(s, gymId)).toEqual({ title: 'Push', why: null });
    v = await s.plans.overview();
    expect(v?.weekChange?.text).toBe('This week: Push (Chest + Shoulders)');
    expect(v?.daysThisWeek.text).toBe('1 of 3');
    // The merged day is this week's only: not in the library or the rotation.
    expect((await s.routines.list()).map((r) => r.name)).not.toContain('Push');
    // The merged day holds both days' exercises (main lifts first), at achievable loads.
    const push = await s.next.preview(gymId);
    expect(push?.exercises.map((e) => e.exerciseName)).toEqual(expect.arrayContaining(['Bench press', 'Overhead press', 'Incline dumbbell press', 'Lateral raise']));
    // Each day's loads as its own day would plan them at this gym (snapped, rule 4).
    expect(sp(push?.targets.find((t) => t.exerciseName === 'Bench press')?.line)).toBe('Target 100 kg × 6–8 · 3 sets');
    expect(sp(push?.targets.find((t) => t.exerciseName === 'Overhead press')?.line)).toBe('Target 50 kg × 6–8 · 3 sets');

    // Undo: the plan's own days again.
    if (!applied.ok) throw new Error('apply');
    expect(await s.week.undo({ weekPlanId: applied.week.id, expectedVersion: applied.week.version, opId: 'week-undo-1' })).toMatchObject({ ok: true });
    expect(await s.week.undo({ weekPlanId: applied.week.id, expectedVersion: applied.week.version, opId: 'week-undo-2' })).toMatchObject({ ok: false, reason: 'stale' });
    expect((await upNext(s, gymId)).title).toBe('Chest');
    expect((await s.plans.overview())?.weekChange).toBeNull();
    expect((await s.week.card(proposal?.actionId ?? ''))?.state).toEqual({ kind: 'undone' });

    // Asked again: a new proposal; Apply; Ben does Push today.
    model = new StepModel([weekStub(seen), () => replyWith('Want me to merge them?')]);
    const again = (await say(s, 'rejig my week around the run')).cards.find((c) => c.record.detail.kind === 'propose_week')?.record;
    expect(await s.week.apply({ actionId: again?.actionId ?? '', opId: 'week-apply-3' })).toMatchObject({ ok: true });
    const pushId = (await s.next.preview(gymId))?.routine?.id ?? '';
    h.clockMs += 3_600_000;
    await doDay(s, gymId, pushId);
    v = await s.plans.overview();
    expect(v?.daysThisWeek.text).toBe('2 of 3');
    expect(v?.days.filter((d) => d.state === 'done').map((d) => d.name)).toEqual(['Chest', 'Shoulders', 'Back']);

    // Next Monday (26 Oct, after the clocks go back): the plan as it was, no write needed.
    h.clockMs = Date.parse('2026-10-26T08:00:00.000Z');
    v = await s.plans.overview();
    expect(v?.weekChange).toBeNull();
    expect(v?.daysThisWeek.text).toBe('0 of 4');
    expect(v?.activities).toEqual([]);
    const monday = await upNext(s, gymId);
    expect(monday.title).not.toBe('Push');
    expect(['Chest', 'Shoulders', 'Back', 'Legs']).toContain(monday.title);
    expect(await s.week.card(again?.actionId ?? '')).toMatchObject({ state: { kind: 'applied' } });
  });

  it('a proposal after which the week moved on (a workout logged) is stale: Apply changes nothing', async () => {
    const { s, gymId } = await benWithPlan();
    h.clockMs = Date.parse('2026-10-23T07:00:00.000Z');
    await s.activities.add({ id: h.ids(), fields: { kind: 'run', status: 'planned', date: '2026-10-24', durationS: null, distanceM: 18_000, effort: null }, opId: 'sheet-run' });
    const seen: WeekView[] = [];
    model = new StepModel([weekStub(seen), () => replyWith('Want me to merge Chest and Shoulders?')]);
    const proposal = (await say(s, 'plan my week around my long run')).cards.find((c) => c.record.detail.kind === 'propose_week')?.record;
    expect(proposal?.status).toBe('proposed');
    // Ben trains chest before tapping Apply.
    h.clockMs += 3_600_000;
    await logWorkout(h, s, gymId, [{ exercise: 'Bench press', sets: [{ load: 100, reps: 7, rpe: 8 }] }]);
    expect((await s.week.card(proposal?.actionId ?? ''))?.state).toEqual({ kind: 'stale' });
    expect(await s.week.apply({ actionId: proposal?.actionId ?? '', opId: 'apply-stale' })).toMatchObject({ ok: false, reason: 'stale' });
    expect((await s.plans.overview())?.weekChange).toBeNull();
  });

  it('code opens the week offer once for the week as it is: not again after it was offered, until the week changes (review S1)', async () => {
    const { s, gymId } = await benWithPlan();
    h.clockMs = Date.parse('2026-10-23T07:00:00.000Z');
    await s.activities.add({ id: h.ids(), fields: { kind: 'run', status: 'planned', date: '2026-10-24', durationS: null, distanceM: null, effort: 'long' }, opId: 'sheet-run' });
    const tools = (i: number) => (model.requests[i]?.tools ?? []).map((t) => t.name);
    const seen: WeekView[] = [];
    // Turn 1, a general question: code sees a short week, so the coach may offer (a proposal).
    model = new StepModel([weekStub(seen), () => replyWith('Want me to merge Chest and Shoulders this week?')]);
    const first = (await say(s, 'how is my week looking?')).cards.find((c) => c.record.detail.kind === 'propose_week')?.record;
    expect(tools(0)).toContain('propose_week');
    expect(first?.status).toBe('proposed');
    // Turn 2, another topic, Ben ignored the offer: not opened again, and the week isn't flagged to the model.
    model = new StepModel([(req) => {
      seen.push(yourData(req).week as WeekView);
      return replyWith('Protein and carbs.');
    }]);
    await say(s, 'what should I eat after training?');
    expect(tools(0)).not.toContain('propose_week');
    expect(seen[1]).toMatchObject({ needsReshape: false, suggestion: null });
    // Ben's own ask still opens it.
    model = new StepModel([weekStub(seen), () => replyWith('Here it is again.')]);
    await say(s, 'plan my week around my long run');
    expect(tools(0)).toContain('propose_week');
    // The week changes (Ben trains): code may offer again for the new week.
    h.clockMs += 3_600_000;
    await doDay(s, gymId, (await s.next.preview(gymId))?.routine?.id ?? '');
    model = new StepModel([(req) => {
      seen.push(yourData(req).week as WeekView);
      return replyWith('Nice.');
    }]);
    await say(s, 'how is my week looking now?');
    const last = seen[seen.length - 1];
    expect(last).toMatchObject({ gymDaysDone: 2, needsReshape: true });
    expect(tools(0)).toContain('propose_week');
  });

  it('the coach raised an activity (Ben didn’t ask): an offer; Log logs it once; Undo', async () => {
    const { s } = await benWithPlan();
    h.clockMs = Date.parse('2026-10-22T09:00:00.000Z');
    model = new StepModel([() => toolCall('log_activity', { kind: 'run', status: 'done', date: '2026-10-21', durationMin: 95, distanceKm: null, effort: null, reason: 'Ben mentioned a run.' }), () => replyWith('Want me to log that run?')]);
    const r = await say(s, 'Legs feel heavy today');
    const offer = r.cards.find((c) => c.record.detail.kind === 'log_activity')?.record;
    expect(offer).toMatchObject({ status: 'proposed', detail: { activityId: null, fields: { date: '2026-10-21', status: 'done', durationS: 5700, effort: null } } });
    expect(await s.activities.recent()).toEqual([]);
    expect(await s.coach.activityOffer(offer?.actionId ?? '')).toEqual({ kind: 'open' });
    const logged = await s.coach.logOfferedActivity(offer?.actionId ?? '');
    expect(logged).toMatchObject({ kind: 'logged', record: { status: 'committed', detail: { proposalId: offer?.actionId } } });
    expect(await s.coach.logOfferedActivity(offer?.actionId ?? '')).toMatchObject({ kind: 'logged' });
    expect(await s.activities.recent()).toHaveLength(1);
    expect((await s.coach.activityOffer(offer?.actionId ?? '')).kind).toBe('logged');
    if (logged.kind !== 'logged') throw new Error('log');
    expect((await s.coach.undo(logged.record.actionId, 'undo-offered')).result).toMatchObject({ status: 'written' });
    expect(await s.activities.recent()).toEqual([]);
  });

  it('Progress › Calendar: delete an activity, then the toast’s Undo brings it back; an edit’s Undo puts it back (review B2)', async () => {
    const { services: s } = await h.launch();
    await setUpGym(h, s);
    h.clockMs = Date.parse('2026-10-22T09:00:00.000Z');
    const add = await s.activities.add({ id: h.ids(), fields: { kind: 'run', status: 'done', date: '2026-10-21', durationS: null, distanceM: 18_000, effort: null }, opId: 'cal-run' });
    if (!add.ok) throw new Error('add');
    const onDay = async () => (await s.progress.calendar('2026-10'))?.view.activityDays['2026-10-21']?.map((r) => sp(r.detail)) ?? [];
    expect(await onDay()).toEqual(['18 km']);
    let shown: ActivityToast | null = null;
    let n = 0;
    const deps = {
      undo: s.activities.undo,
      newOpId: () => `toast-undo-${String((n += 1))}`,
      changed: () => undefined,
      show: (t: ActivityToast | null) => {
        shown = t;
      },
    };

    // Delete from the calendar's sheet: the toast says so, with Undo.
    const del = await s.activities.remove({ activityId: add.activity.id, expectedVersion: add.activity.version, opId: 'cal-delete' });
    expect(del.ok).toBe(true);
    expect(await onDay()).toEqual([]);
    const toast = activitySavedToast({ kind: 'deleted', activityId: add.activity.id, opId: 'cal-delete' }, deps);
    expect(toast).toMatchObject({ text: 'Activity deleted', action: 'Undo' });
    toast.onAction?.();
    await vi.waitFor(async () => {
      expect(await onDay()).toEqual(['18 km']);
    });
    expect(shown).toBeNull();
    // A second tap on the same toast: one Undo (its op ID replays), the run stays.
    toast.onAction?.();
    await vi.waitFor(async () => {
      expect((await s.activities.get(add.activity.id))?.opIds).toContain('toast-undo-1');
    });
    expect(await onDay()).toEqual(['18 km']);

    // Edit from the calendar, then Undo: the fields as they were.
    const cur = await s.activities.get(add.activity.id);
    if (cur === null) throw new Error('gone');
    expect(await s.activities.edit({ activityId: cur.id, expectedVersion: cur.version, fields: { ...cur.fields, distanceM: 21_000 }, opId: 'cal-edit' })).toMatchObject({ ok: true });
    expect(await onDay()).toEqual(['21 km']);
    activitySavedToast({ kind: 'edited', activityId: cur.id, opId: 'cal-edit' }, deps).onAction?.();
    await vi.waitFor(async () => {
      expect(await onDay()).toEqual(['18 km']);
    });
  });

  it('only leg days: Legs anyway, and Why? names the run (the day before a planned one, the day after a done one)', async () => {
    const { services: s } = await h.launch();
    const gymId = await setUpGym(h, s);
    await logWorkout(h, s, gymId, [{ exercise: 'Back squat', sets: [{ load: 100, reps: 5, rpe: 8 }] }]);
    h.clockMs = Date.parse('2026-10-19T07:00:00.000Z');
    const legsOnly = (req: ModelRequest): ModelEvent[] => {
      const usable = (yourData(req).build as { usable: { catalogueId: string; name: string }[] }).usable;
      const idOf = (name: string) => usable.find((u) => u.name === name)?.catalogueId ?? `missing-${name}`;
      return toolCall('propose_plan', { days: [{ dayName: 'Legs', splitDayId: null, focus: null, minutes: null, exercises: [ex(idOf('Back squat'), { reps: { min: 5, max: 6 }, load: kgLoad(100) }), ex(idOf('Leg press'), { load: kgLoad(140) })] }], message: 'Legs.', minutes: null, gymName: null });
    };
    model = new StepModel([legsOnly, () => replyWith('Legs.')]);
    const card = (await say(s, 'Build me a 1-day plan')).cards[0]?.record;
    if (card?.detail.kind !== 'build_plan') throw new Error('no plan');
    const c = await s.plans.card({ planId: card.detail.planId, versionN: 1 });
    expect(await s.plans.apply({ planId: card.detail.planId, versionN: 1, expectedVersion: c?.planVersion ?? 0, mode: 'replace', opId: 'apply-legs' })).toMatchObject({ ok: true });
    // Friday, a long run planned for Saturday: the only day is Legs, so Legs, with the run behind Why?.
    h.clockMs = Date.parse('2026-10-23T07:00:00.000Z');
    const run = await s.activities.add({ id: h.ids(), fields: { kind: 'run', status: 'planned', date: '2026-10-24', durationS: 100 * 60, distanceM: null, effort: null }, opId: 'sat-run' });
    expect(await upNext(s, gymId)).toEqual({ title: 'Legs', why: 'Long run tomorrow' });
    // Sunday, the run marked done: Legs, `Long run yesterday`. Monday: nothing near.
    if (!run.ok) throw new Error('run');
    h.clockMs = Date.parse('2026-10-25T08:00:00.000Z');
    expect(await s.activities.edit({ activityId: run.activity.id, expectedVersion: run.activity.version, fields: { ...run.activity.fields, status: 'done' }, opId: 'run-done' })).toMatchObject({ ok: true });
    expect(await upNext(s, gymId)).toEqual({ title: 'Legs', why: 'Long run yesterday' });
    h.clockMs = Date.parse('2026-10-26T08:00:00.000Z');
    expect(await upNext(s, gymId)).toEqual({ title: 'Legs', why: null });
  });

  it('without a plan: the same offer on split days (Push + Pull → Upper), and the run rule on split Up next', async () => {
    const { services: s } = await h.launch();
    const gymId = await setUpGym(h, s);
    // Sat 17, Sun 18: push and pull; legs never. Ben's split is Push/Pull/Legs (the default); 3 days a week.
    await logWorkout(h, s, gymId, [{ exercise: 'Bench press', sets: [{ load: 100, reps: 7, rpe: 8 }, { load: 100, reps: 7, rpe: 8 }] }]);
    h.clockMs += DAY;
    await logWorkout(h, s, gymId, [{ exercise: 'Lat pulldown', sets: [{ load: 60, reps: 10, rpe: 8 }, { load: 60, reps: 10, rpe: 8 }] }]);
    const snap = await s.training.snapshot();
    if (!snap) throw new Error('snapshot');
    expect(await s.training.change({ kind: 'days_per_week', days: 3 }, snap.profile.version, 'days-3')).toMatchObject({ ok: true });
    // Saturday 24 Oct, 09:00: Ben ran 18 km yesterday.
    h.clockMs = Date.parse('2026-10-24T08:00:00.000Z');
    await s.activities.add({ id: h.ids(), fields: { kind: 'run', status: 'done', date: '2026-10-23', durationS: null, distanceM: 18_000, effort: null }, opId: 'fri-run' });
    // Legs is due (never trained), but not the day after a long run.
    const sat = await upNext(s, gymId);
    expect(sat.title).not.toBe('Legs');
    // Two days left (Sat, Sun) for three split days with nothing done this week: the coach may offer.
    const seen: WeekView[] = [];
    model = new StepModel([weekStub(seen), () => replyWith('Want me to merge push and pull into Upper this week?')]);
    const proposal = (await say(s, 'can you rejig my week')).cards.find((c) => c.record.detail.kind === 'propose_week')?.record;
    expect(seen[0]).toMatchObject({ gymDaysLeft: 2, needsReshape: true, suggestion: { merges: [{ name: 'Upper' }] } });
    expect(await s.week.apply({ actionId: proposal?.actionId ?? '', opId: 'split-apply' })).toMatchObject({ ok: true });
    const upper = await s.next.preview(gymId);
    expect(upper?.title).toBe('Upper');
    expect(upper?.exercises.map((e) => e.exerciseName)).toEqual(expect.arrayContaining(['Bench press', 'Lat pulldown']));
    // Next week: the split's own days again.
    h.clockMs = Date.parse('2026-10-26T08:00:00.000Z');
    expect((await upNext(s, gymId)).title).not.toBe('Upper');
  });
});
