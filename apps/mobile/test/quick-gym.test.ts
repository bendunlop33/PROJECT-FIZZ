import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { formFromEquipment, type EquipmentForm } from '@fizz/domain';

import { threadRows } from '../src/coach/sheet-view';
import type { AppServices } from '../src/services/app-services';
import { CONNECTED, replyWith, StepModel, toolCall } from './coach-model';
import { createHarness, type Harness } from './harness';

/**
 * Quick gym setup and learning as Ben trains (Ben, 20 Oct; ADR 0029), through
 * the app services: a full gym in one tap, `Not at this gym` leaves the
 * exercise out of the next workout there, `Add 22 kg dumbbells here?`.
 */
let h: Harness;
beforeEach(() => {
  h = createHarness();
});
afterEach(async () => {
  await h.cleanup();
});

async function fullGym(s: AppServices, step = 2.5): Promise<string> {
  await s.setup.saveUnits('kg');
  const gymId = h.ids();
  const r = await s.setup.saveGym({ gymId, name: 'Main gym', draft: s.coachingKnowledge.buildQuickGymDraft({ setup: 'full', unit: 'kg', dumbbellStep: step }), setup: 'full' });
  if (!r.ok) throw new Error(r.message);
  await s.setup.complete();
  return gymId;
}

async function startWith(s: AppServices, gymId: string, name: string, opId: string) {
  const started = await s.workout.start({ gymId, opId, checkIn: null });
  if (!started.ok) throw new Error(started.error.message);
  const sessionId = started.aggregate.session.id;
  const pick = (await s.workout.pickerExercises(sessionId, name)).find((p) => p.exercise.name === name);
  if (!pick) throw new Error(`no ${name}`);
  return { sessionId, pick };
}

describe('quick gym setup', () => {
  it('adds a full gym in one tap: every item assumed, the dumbbell step asked once, Make full gym has nothing to add', async () => {
    const { services: s } = await h.launch();
    const gymId = await fullGym(s, 2);
    const detail = await s.gyms.detail(gymId);
    expect(detail?.gym.setup).toBe('full');
    expect(detail?.equipment.map((e) => [e.equipment.name, e.tag])).toEqual([
      ['Dumbbells', 'Assumed'],
      ['Barbell and plates', 'Assumed'],
      ['Plate-loaded machines', 'Assumed'],
      ['Cable station', 'Assumed'],
      ['Machines', 'Assumed'],
      ['Assisted pull-up / dip machine', 'Assumed'],
      ['Pull-up bar', 'Assumed'],
    ]);
    expect(detail?.equipment[0]?.line).toBe('2–50 kg each');
    expect(detail?.makeFull).toBeNull();
    expect((await s.gyms.list())[0]).toMatchObject({ items: 7, unchecked: 7 });
  });

  it('Make full gym on a small gym keeps his items, adds the rest assumed, and Undo takes it back', async () => {
    const { services: s } = await h.launch();
    await s.setup.saveUnits('kg');
    const gymId = h.ids();
    await s.setup.saveGym({ gymId, name: 'Hotel', draft: s.coachingKnowledge.buildQuickGymDraft({ setup: 'small', unit: 'kg', dumbbells: { max: 20, step: 2 }, extras: [] }), setup: 'small' });
    let detail = await s.gyms.detail(gymId);
    expect(detail?.makeFull).toEqual({ needsDumbbellStep: false });
    const made = await s.gyms.makeFull({ gymId, dumbbellStep: 2.5 });
    if (!made.ok) throw new Error(made.message);
    detail = await s.gyms.detail(gymId);
    expect(detail?.gym.setup).toBe('full');
    expect(detail?.equipment.filter((e) => e.equipment.kind === 'dumbbells').map((e) => e.line)).toEqual(['2–20 kg each']);
    expect(detail?.equipment).toHaveLength(7);
    // A retry of the same edit is a duplicate, not a second set of items.
    expect(await s.gyms.applyEdit(made.edit)).toMatchObject({ ok: true, duplicate: true });
    expect((await s.gyms.detail(gymId))?.equipment).toHaveLength(7);
    expect(await s.gyms.undoEdit(made.edit)).toEqual({ ok: true });
    detail = await s.gyms.detail(gymId);
    expect(detail?.gym.setup).toBe('small');
    expect(detail?.equipment).toHaveLength(1);
    // A second Undo of the same edit is refused: the gym changed since.
    expect((await s.gyms.undoEdit(made.edit)).ok).toBe(false);
  });
});

describe('learning the gym as he trains', () => {
  it('Not at this gym: marked, gone from the next workout there, Put back brings it back', async () => {
    const { services: s } = await h.launch();
    const gymId = await fullGym(s);
    const first = await startWith(s, gymId, 'Leg extension', 'start-1');
    expect(first.pick.equipment.map((e) => e.name)).toEqual(['Cable station', 'Machines']);

    const marked = await s.gyms.markNotHere({ gymId, exerciseId: first.pick.exercise.id });
    if (!marked.ok) throw new Error(marked.message);
    expect(marked.edit.lines).toEqual(['Leg extension: not here']);
    expect((await s.gyms.detail(gymId))?.notHere).toEqual([{ exerciseId: first.pick.exercise.id, name: 'Leg extension' }]);
    // Again: nothing more to mark.
    expect(await s.gyms.markNotHere({ gymId, exerciseId: first.pick.exercise.id })).toMatchObject({ ok: false, reason: 'nothing' });
    // Today keeps the gym as it started; the swap sheet still opens.
    expect((await s.workout.pickerExercises(first.sessionId, 'Leg extension')).find((p) => p.exercise.name === 'Leg extension')?.equipment).toHaveLength(2);
    const data = await s.workout.load();
    await s.workout.dispatch(first.sessionId, { type: 'discard', at: h.now(), opId: 'discard-1', expectedVersion: data?.aggregate.session.version ?? 0, confirmedLoggedSets: 0 });

    // The next workout at this gym can't plan it; cable exercises still can.
    const next = await startWith(s, gymId, 'Leg extension', 'start-2');
    expect(next.pick.equipment).toEqual([]);
    expect((await s.workout.pickerExercises(next.sessionId, 'Lat pulldown')).find((p) => p.exercise.name === 'Lat pulldown')?.equipment.length).toBeGreaterThan(0);
    const d2 = await s.workout.load();
    await s.workout.dispatch(next.sessionId, { type: 'discard', at: h.now(), opId: 'discard-2', expectedVersion: d2?.aggregate.session.version ?? 0, confirmedLoggedSets: 0 });

    const back = await s.gyms.putBack({ gymId, exerciseId: first.pick.exercise.id });
    expect(back.ok).toBe(true);
    expect((await s.gyms.detail(gymId))?.notHere).toEqual([]);
    const third = await startWith(s, gymId, 'Leg extension', 'start-3');
    expect(third.pick.equipment).toHaveLength(2);
  });

  it('Add 22 kg dumbbells here?: offered on the typed load, saved confirmed, today takes it, Undo puts the rack back', async () => {
    const { services: s } = await h.launch();
    const gymId = await fullGym(s, 2.5);
    const { sessionId, pick } = await startWith(s, gymId, 'Dumbbell bench press', 'start-1');
    const rack = pick.equipment[0];
    expect(rack?.name).toBe('Dumbbells');
    const added = await s.workout.addExercise({ sessionId, exerciseId: pick.exercise.id, equipmentId: rack?.id ?? null, opId: 'add-1' });
    if (!added.ok) throw new Error(added.error.message);
    let data = await s.workout.load();
    if (!data) throw new Error('no workout');
    const setId = data.aggregate.session.activeSetId ?? '';
    const typed = { setId, values: { load: { value: 22, unit: 'kg' as const, convention: 'per_hand' as const }, reps: 10, durationS: null, rpe: null, rir: null } };
    let focus = s.workout.view(data, h.clockMs, typed).focus;
    expect(focus?.offProfileWarning).not.toBeNull();
    expect(focus?.gymLearn?.text).toBe('Add 22 kg dumbbells here?');
    const learn = focus?.gymLearn?.learn;
    if (!learn) throw new Error('no chip');

    const r = await s.gyms.learnInWorkout({ sessionId, learn, opId: 'learn-1' });
    if (!r.ok) throw new Error(r.message);
    expect(r.refreshed).toBe(true);
    const saved = (await s.gyms.item(rack?.id ?? ''))?.equipment;
    expect(saved?.kind === 'dumbbells' && saved.loads).toContain(22);
    // Review S1: one dumbbell doesn't confirm the rack.
    expect(saved?.detailsSource).toBe('preset');
    data = await s.workout.load();
    if (!data) throw new Error('no workout');
    focus = s.workout.view(data, h.clockMs, typed).focus;
    expect(focus?.offProfileWarning).toBeNull();
    expect(focus?.gymLearn).toBeNull();

    // Undo: today's refresh and the gym, both back.
    expect(await s.gyms.undoLearnInWorkout({ sessionId, edit: r.edit, refreshed: r.refreshed, opId: 'undo-learn-1' })).toEqual({ ok: true, todayKept: false });
    const back = (await s.gyms.item(rack?.id ?? ''))?.equipment;
    expect(back?.kind === 'dumbbells' && back.loads).not.toContain(22);
    expect(back?.detailsSource).toBe('preset');
    data = await s.workout.load();
    if (!data) throw new Error('no workout');
    expect(s.workout.view(data, h.clockMs, typed).focus?.gymLearn?.text).toBe('Add 22 kg dumbbells here?');
  });
});

describe('learning the gym: review fixes', () => {
  async function dumbbellSet(s: AppServices, gymId: string) {
    const { sessionId, pick } = await startWith(s, gymId, 'Dumbbell bench press', 'start-1');
    const rack = pick.equipment[0];
    const added = await s.workout.addExercise({ sessionId, exerciseId: pick.exercise.id, equipmentId: rack?.id ?? null, opId: 'add-1' });
    if (!added.ok) throw new Error(added.error.message);
    return { sessionId, rackId: rack?.id ?? '' };
  }

  it('S3: Undo after a set was logged on the learned dumbbell puts the gym back and says today keeps it', async () => {
    const { services: s } = await h.launch();
    const gymId = await fullGym(s, 2.5);
    const { sessionId, rackId } = await dumbbellSet(s, gymId);
    let data = await s.workout.load();
    if (!data) throw new Error('no workout');
    const setId = data.aggregate.session.activeSetId ?? '';
    const values = { load: { value: 22, unit: 'kg' as const, convention: 'per_hand' as const }, reps: 10, durationS: null, rpe: null, rir: null };
    const learn = s.workout.view(data, h.clockMs, { setId, values }).focus?.gymLearn?.learn;
    if (!learn) throw new Error('no chip');
    const r = await s.gyms.learnInWorkout({ sessionId, learn, opId: 'learn-1' });
    if (!r.ok) throw new Error(r.message);
    expect(r.refreshed).toBe(true);
    const logged = await s.workout.dispatch(sessionId, { type: 'log_set', at: h.now(), opId: 'log-22', setId, values, restTimerId: h.ids() });
    expect(logged.ok).toBe(true);

    expect(await s.gyms.undoLearnInWorkout({ sessionId, edit: r.edit, refreshed: r.refreshed, opId: 'undo-learn-1' })).toEqual({ ok: true, todayKept: true });
    const back = (await s.gyms.item(rackId))?.equipment;
    expect(back?.kind === 'dumbbells' && back.loads).not.toContain(22);
    data = await s.workout.load();
    // Today's snapshot keeps the version with 22 kg (the one its logged set was made on).
    expect(data?.aggregate.session.equipmentSnapshot.some((e) => e.id === rackId && e.kind === 'dumbbells' && e.loads.includes(22))).toBe(true);
  });

  it('B2: Leg extension goes up in 7 kg? gives leg extension its own stack; other machines keep the assumed 5s', async () => {
    const { services: s } = await h.launch();
    const gymId = await fullGym(s);
    const { sessionId, pick } = await startWith(s, gymId, 'Leg extension', 'start-1');
    const machines = pick.equipment.find((e) => e.name === 'Machines');
    const added = await s.workout.addExercise({ sessionId, exerciseId: pick.exercise.id, equipmentId: machines?.id ?? null, opId: 'add-1' });
    if (!added.ok) throw new Error(added.error.message);
    const data = await s.workout.load();
    if (!data) throw new Error('no workout');
    const setId = data.aggregate.session.activeSetId ?? '';
    const typed = { setId, values: { load: { value: 7, unit: 'kg' as const, convention: 'stack' as const }, reps: 12, durationS: null, rpe: null, rir: null } };
    const chip = s.workout.view(data, h.clockMs, typed).focus?.gymLearn;
    expect(chip?.text).toBe('Leg extension goes up in 7 kg?');
    if (!chip) throw new Error('no chip');
    const r = await s.gyms.learnInWorkout({ sessionId, learn: chip.learn, opId: 'learn-1' });
    if (!r.ok) throw new Error(r.message);
    // A double tap: already saved, nothing more.
    expect(await s.gyms.learnInWorkout({ sessionId, learn: chip.learn, opId: 'learn-2' })).toMatchObject({ ok: false, reason: 'nothing' });

    const detail = await s.gyms.detail(gymId);
    expect(detail?.equipment.find((e) => e.equipment.name === 'Machines')?.tag).toBe('Assumed');
    expect(detail?.equipment.find((e) => e.equipment.name === 'Leg extension')).toMatchObject({ tag: null, line: expect.stringContaining('7') as unknown });
    expect(detail?.notHere).toEqual([]);
    const machinesNow = (await s.gyms.item(machines?.id ?? ''))?.equipment;
    expect(machinesNow?.kind === 'weight_stack' && machinesNow.stackLoads.slice(0, 2)).toEqual([5, 10]);

    // The picker: leg extension is on its own stack; another machine exercise still on the shared ones.
    expect((await s.workout.pickerExercises(sessionId, 'Leg extension')).find((p) => p.exercise.name === 'Leg extension')?.equipment.map((e) => e.name)).toEqual(['Cable station', 'Leg extension']);
    const pulldown = (await s.workout.pickerExercises(sessionId, 'Lat pulldown')).find((p) => p.exercise.name === 'Lat pulldown');
    expect(pulldown?.equipment.map((e) => e.name)).toEqual(['Cable station', 'Machines']);
  });
});

describe('the coach updates a gym (update_gym)', () => {
  let model: StepModel;
  beforeEach(() => {
    model = new StepModel([]);
    h = createHarness('2026-10-20T07:00:00.000Z', { coach: { model: () => model, connection: () => Promise.resolve(CONNECTED) } });
  });
  const say = (s: AppServices, text: string) => s.coach.send({ entry: { kind: 'today' }, threadId: null, input: { kind: 'words', text, spoken: false }, turnId: h.ids() });

  it('"this gym has no leg press": applied at once, the card has Undo; the coach sees "full gym (assumed)"', async () => {
    const { services: s } = await h.launch();
    const gymId = await fullGym(s);
    model = new StepModel([() => toolCall('update_gym', { gymName: null, changes: [{ op: 'not_here', exerciseId: 'machine-leg-press' }], reason: 'Ben said so', benAsked: true, benQuote: 'this gym has no leg press' }), () => replyWith('Got it.')]);
    const r = await say(s, 'this gym has no leg press');
    expect(JSON.stringify(model.requests[0]?.input ?? '')).toContain('full gym (assumed)');
    const card = r.cards.find((c) => c.record.detail.kind === 'update_gym')?.record;
    expect(card).toMatchObject({ status: 'committed', detail: { lines: ['Leg press: not here'] } });
    expect((await s.gyms.detail(gymId))?.notHere.map((x) => x.name)).toEqual(['Leg press']);
    const thread = await s.coach.loadThread(r.threadId);
    const row = thread === null ? undefined : threadRows(thread).find((x) => x.kind === 'card' && x.card.actionId === card?.actionId);
    expect(row?.kind === 'card' ? [row.card.status.word, row.card.canUndo] : null).toEqual(['Applied', true]);
    await s.coach.undo(card?.actionId ?? '', 'u1');
    expect((await s.gyms.detail(gymId))?.notHere).toEqual([]);
  });

  it('the coach’s own idea is a card: Apply saves exactly it once; a gym changed since is Out of date', async () => {
    const { services: s } = await h.launch();
    const gymId = await fullGym(s);
    const step = () => toolCall('update_gym', { gymName: null, changes: [{ op: 'dumbbells', max: 40, step: 2 }], reason: 'your logs', benAsked: false, benQuote: null });
    model = new StepModel([step, () => replyWith('Want me to update the dumbbells?'), step, () => replyWith('Want me to update the dumbbells?')]);
    const r = await say(s, 'the dumbbells here go up in 2s maybe? what do you think');
    const card = r.cards.find((c) => c.record.detail.kind === 'update_gym')?.record;
    expect(card?.status).toBe('proposed');
    expect((await s.gyms.detail(gymId))?.equipment[0]?.line).toBe('2.5–50 kg each');
    const applied = await s.coach.tapGymProposal(card?.actionId ?? '', 'apply');
    expect(applied.ok).toBe(true);
    expect((await s.gyms.detail(gymId))?.equipment[0]?.line).toBe('2–40 kg each');
    expect(await s.coach.tapGymProposal(card?.actionId ?? '', 'apply')).toEqual({ ok: false, state: 'applied' });

    // A second suggestion, then Ben edits the rack himself: Apply is refused, nothing changes.
    const r2 = await say(s, 'the dumbbells here go up in 2s maybe? what do you think');
    const card2 = r2.cards.find((c) => c.record.detail.kind === 'update_gym')?.record;
    const rack = (await s.gyms.detail(gymId))?.equipment[0]?.equipment;
    if (!rack) throw new Error('no rack');
    await s.gyms.save({ gymId, equipmentId: rack.id, expectedVersion: rack.version, form: { ...(formFromEquipment(rack) as Extract<EquipmentForm, { kind: 'dumbbells' }>), range: { from: 2, to: 30, step: 2 }, missing: [], extra: [] } });
    expect(await s.coach.tapGymProposal(card2?.actionId ?? '', 'apply')).toEqual({ ok: false, state: 'out_of_date' });
    expect((await s.gyms.detail(gymId))?.equipment[0]?.line).toBe('2–30 kg each');
  });

  it('S5: a card tapped again after Ben undid its Apply, and two taps at once, apply at most once', async () => {
    const { services: s } = await h.launch();
    const gymId = await fullGym(s);
    const step = () => toolCall('update_gym', { gymName: null, changes: [{ op: 'dumbbells', max: 40, step: 2 }], reason: 'your logs', benAsked: false, benQuote: null });
    model = new StepModel([step, () => replyWith('Want me to update the dumbbells?')]);
    const r = await say(s, 'the dumbbells here go up in 2s maybe? what do you think');
    const card = r.cards.find((c) => c.record.detail.kind === 'update_gym')?.record;
    const [a, b] = await Promise.all([s.coach.tapGymProposal(card?.actionId ?? '', 'apply'), s.coach.tapGymProposal(card?.actionId ?? '', 'apply')]);
    // The same tap twice is one apply (one op ID): a replay, or refused as applied.
    const oks = [a, b].flatMap((x) => (x.ok ? [x.record.actionId] : []));
    expect(new Set(oks).size).toBe(1);
    const applied = a.ok ? a.record : b.ok ? b.record : null;
    expect((await s.gyms.detail(gymId))?.equipment[0]?.line).toBe('2–40 kg each');
    await s.coach.undo(applied?.actionId ?? '', 'undo-apply');
    expect((await s.gyms.detail(gymId))?.equipment[0]?.line).toBe('2.5–50 kg each');
    // The stale card can't apply again over Ben's Undo.
    expect((await s.coach.tapGymProposal(card?.actionId ?? '', 'apply')).ok).toBe(false);
    expect((await s.gyms.detail(gymId))?.equipment[0]?.line).toBe('2.5–50 kg each');
  });
});
