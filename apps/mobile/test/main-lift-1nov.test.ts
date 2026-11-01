import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { mainLiftDayName, slotsOf, withOneMainLift } from '@fizz/domain';
import type { Routine, SessionAggregate } from '@fizz/schemas';

import type { AppServices } from '../src/services/app-services';
import type { TodaySessionData } from '../src/services/today-session';
import { editableOf } from '../src/workout/template-editor';
import { canMakeMain } from '../src/workout/main-lift-action';
import { createHarness, type Harness } from './harness';

/**
 * (Ben, 1 Nov: "You should be able to change it whenever.") `Make main lift` on real SQLite, offline, no coach: a
 * 6-day PPL plan applied Monday 26 Oct.
 * - the live workout: today only (the session's plan day main lift and name; no set changes; kept across a relaunch),
 *   Undo; then `Every week` (the template's Main flags, key and name; Today's card's Main lift row follows), Undo;
 * - the plan day editor (Save: every week; the key and name follow), Undo;
 * - Your workout (today's draft; Every week? notes the new template version), Undo.
 */

let h: Harness;
beforeEach(() => {
  h = createHarness('2026-10-26T07:00:00.000Z');
});
afterEach(async () => {
  await h.cleanup();
});

async function setUp(s: AppServices): Promise<string> {
  await s.setup.saveUnits('kg');
  const draft = s.coachingKnowledge.buildGymDraft('commercial', 'kg');
  await s.setup.saveGym({ gymId: h.ids(), name: 'Main Gym', draft: { ...draft, items: draft.items.map((i) => ({ ...i, ticked: true })) } });
  await s.setup.complete();
  const session = await s.planBuilder.open();
  if (session === null) throw new Error('no builder');
  const a = { ...session.answers, split: 'ppl' as const, sessions: 6, schedule: 'set' as const, days: [0, 1, 2, 3, 4, 5] };
  const built = await s.planBuilder.save(session, a, null, h.ids());
  if (!built.ok) throw new Error('not built');
  if (!(await s.planBuilder.apply({ planId: built.planId, versionN: built.versionN, expectedVersion: built.version, opId: h.ids() })).ok) throw new Error('not applied');
  const gym = await s.yourData.currentGym();
  if (!gym) throw new Error('no gym');
  return gym.id;
}

async function today(s: AppServices): Promise<TodaySessionData> {
  const d = await s.todaySession.load();
  if (d === null) throw new Error('no Today');
  return d;
}

async function templateOf(s: AppServices, routineId: string): Promise<Routine> {
  const r = (await s.routines.editor({ routineId, gymId: null }))?.routine;
  if (r == null) throw new Error('no template');
  return r;
}

/** Up next's day (Push A): its template, Today's draft and the main lift Today's card names. */
async function upNext(s: AppServices) {
  const d = await today(s);
  const day = d.days.find((x) => x.key === d.nextKey);
  const controls = day === undefined ? undefined : d.initial[day.key];
  if (day === undefined || controls === undefined) throw new Error('no Up next');
  const routineId = day.templates[0]?.routineId;
  if (routineId == null) throw new Error('no template');
  const card = s.todaySession.card(d, { dayKey: day.key, controls });
  return { d, day, controls, routineId, mainName: card?.list.find((r) => r.main)?.fullName ?? null };
}

/** A compound of the day's template that isn't its main lift. */
async function otherCompound(s: AppServices, t: Routine, gymId: string): Promise<{ exerciseId: string; rowId: string; name: string }> {
  const info = (await s.builder.templateOptionsInfo({ gymId, exerciseIds: t.exercises.map((e) => e.exerciseId) })).info;
  const row = [...t.exercises].sort((a, b) => a.order - b.order).find((e) => e.main !== true && info[e.exerciseId]?.role === 'compound');
  if (row === undefined) throw new Error('no other compound');
  return { exerciseId: row.exerciseId, rowId: row.id, name: info[row.exerciseId]?.name ?? '' };
}

/** The plan builder's templates carry no `planDay` key (their main lift is the `Main` flag): the key follows only when there is one. */
const keyOf = (t: Routine, exerciseId: string | null) => (t.planDay === undefined ? undefined : exerciseId);
const mainsOf = (r: Routine) => r.exercises.filter((e) => e.main === true).map((e) => e.exerciseId);
const setsShape = (a: SessionAggregate) => a.sets.map((x) => [x.id, x.status, x.setType, x.planned.load?.value ?? null, x.planned.reps?.min ?? null, x.rest.seconds, x.version]);

describe('Make main lift in a live workout', () => {
  it('today only, kept across a relaunch, Undo; then Every week with Undo', async () => {
    const { services: s } = await h.launch();
    const gymId = await setUp(s);
    const n = await upNext(s);
    const template = await templateOf(s, n.routineId);
    const was = template.exercises.find((e) => e.main === true)?.exerciseId ?? null;
    expect(was).not.toBeNull();
    const pick = await otherCompound(s, template, gymId);

    const c = await s.todaySession.commit(n.d, { dayKey: n.day.key, controls: n.controls }, h.ids());
    if (!c.ok) throw new Error(c.message);
    const started = await s.todaySession.start({ draftId: c.draftId, expectedVersion: c.version, gymId, opId: h.ids(), checkIn: null });
    if (!started.ok) throw new Error('not started');
    const sessionId = started.aggregate.session.id;
    const data = await s.workout.load(sessionId);
    if (data === null) throw new Error('no workout');
    const a = data.aggregate;
    const row = a.exercises.find((e) => e.exerciseId === pick.exerciseId);
    const mainRow = a.exercises.find((e) => e.exerciseId === was);
    if (row === undefined || mainRow === undefined) throw new Error('rows missing');
    expect(canMakeMain(data, row.id)).toBe(true);
    expect(canMakeMain(data, mainRow.id)).toBe(false);

    // Log one main-lift set first: a done set never changes.
    const first = a.sets.filter((x) => x.sessionExerciseId === mainRow.id && x.status === 'pending').sort((x, y) => x.index - y.index)[0];
    if (first === undefined) throw new Error('no set');
    const logged = await s.workout.dispatch(sessionId, { type: 'log_set', at: h.now(), opId: 'log-1', setId: first.id, values: { load: first.planned.load ?? { value: 60, unit: 'kg', convention: 'total' }, reps: first.planned.reps?.min ?? 5, durationS: null, rpe: null, rir: null }, restTimerId: h.ids() });
    if (!logged.ok) throw new Error(logged.error.message);
    const before = logged.aggregate;

    const opId = 'make-main-1';
    const cmd = { type: 'set_main_lift' as const, at: h.now(), opId, sessionExerciseId: row.id, expectedVersion: before.session.version };
    const r = await s.workout.dispatch(sessionId, cmd);
    if (!r.ok) throw new Error(r.error.message);
    expect(r.aggregate.session.planDay?.mainLiftExerciseId).toBe(pick.exerciseId);
    expect(r.aggregate.session.routineName).toBe(before.session.routineName === null ? null : mainLiftDayName(before.session.routineName, row.exerciseName));
    expect(setsShape(r.aggregate)).toEqual(setsShape(before));
    // A repeat replays; a stale version is refused (rule 5).
    expect((await s.workout.dispatch(sessionId, cmd)).ok).toBe(true);
    expect((await s.workout.dispatch(sessionId, { ...cmd, opId: 'make-main-stale', sessionExerciseId: mainRow.id })).ok).toBe(false);
    // Today only: the template is as it was.
    expect((await templateOf(s, n.routineId)).version).toBe(template.version);

    // Force-close: the pick is kept, the menu offers the old main lift now, and the +N min fit reads the new one.
    const { services: again } = await h.launch();
    const back = await again.workout.load(sessionId);
    if (back === null) throw new Error('no workout after relaunch');
    expect(back.aggregate.session.planDay?.mainLiftExerciseId).toBe(pick.exerciseId);
    expect([...(back.mainExerciseIds ?? [])]).toEqual([pick.exerciseId]);
    expect(canMakeMain(back, row.id)).toBe(false);
    expect(canMakeMain(back, mainRow.id)).toBe(true);

    // Undo (today): the main lift and name back; still no set change.
    const u = await again.workout.undoOp({ sessionId, targetOpId: opId });
    expect(u.ok).toBe(true);
    const undone = await again.workout.load(sessionId);
    expect(undone?.aggregate.session.planDay?.mainLiftExerciseId).toBe(was);
    expect(undone?.aggregate.session.routineName).toBe(before.session.routineName);
    expect(setsShape(undone?.aggregate ?? before)).toEqual(setsShape(before));

    // Again, then Every week: the template's Main, key and name follow; the old main keeps its sets.
    const r2 = await again.workout.dispatch(sessionId, { ...cmd, opId: 'make-main-2', expectedVersion: undone?.aggregate.session.version ?? 0 });
    if (!r2.ok) throw new Error(r2.error.message);
    const ew = await again.plans.mainLiftEveryWeek({ routineId: n.routineId, exerciseId: pick.exerciseId, opId: 'every-1' });
    if (!ew.ok) throw new Error(ew.message);
    expect((await again.plans.mainLiftEveryWeek({ routineId: n.routineId, exerciseId: pick.exerciseId, opId: 'every-1' })).ok).toBe(true);
    const after = await templateOf(again, n.routineId);
    expect(after.version).toBe(template.version + 1);
    expect(mainsOf(after)).toEqual([pick.exerciseId]);
    expect(after.planDay?.mainLiftExerciseId).toBe(keyOf(template, pick.exerciseId));
    expect(after.name).toBe(mainLiftDayName(template.name, pick.name));
    const oldMain = after.exercises.find((e) => e.exerciseId === was);
    expect(oldMain?.setTemplates).toEqual(template.exercises.find((e) => e.exerciseId === was)?.setTemplates);
    // The done set is as it was.
    expect((await again.workout.load(sessionId))?.aggregate.sets.find((x) => x.id === first.id)).toEqual(before.sets.find((x) => x.id === first.id));

    // Undo (every week): the template, its key and name back.
    const rv = await again.routines.revert({ actionId: ew.actionId, opId: 'every-undo-1' });
    expect(rv.ok).toBe(true);
    const reverted = await templateOf(again, n.routineId);
    expect([reverted.name, reverted.planDay?.mainLiftExerciseId, reverted.exercises.map((e) => e.main)]).toEqual([template.name, template.planDay?.mainLiftExerciseId, template.exercises.map((e) => e.main)]);
  });
});

describe('Make main lift in the plan day editor', () => {
  it('Save writes every week: one main lift, the key and name follow; Today’s card shows it; Undo puts it back', async () => {
    const { services: s } = await h.launch();
    const gymId = await setUp(s);
    const n = await upNext(s);
    const template = await templateOf(s, n.routineId);
    const pick = await otherCompound(s, template, gymId);
    const edit = editableOf(template);
    const made = withOneMainLift(edit.exercises, edit.exercises.find((e) => e.exerciseId === pick.exerciseId)?.id ?? '');
    if (made === null || made === 'same') throw new Error('no change');
    const saved = await s.routines.update({ routineId: template.id, edit: { ...edit, exercises: made }, expectedVersion: template.version, opId: 'editor-1' });
    if (!saved.ok) throw new Error(saved.message);
    expect(mainsOf(saved.routine)).toEqual([pick.exerciseId]);
    expect(saved.routine.planDay?.mainLiftExerciseId).toBe(keyOf(template, pick.exerciseId));
    expect(saved.routine.name).toBe(mainLiftDayName(template.name, pick.name));
    // A stale save is refused.
    expect((await s.routines.update({ routineId: template.id, edit: { ...edit, exercises: made }, expectedVersion: template.version, opId: 'editor-2' })).ok).toBe(false);
    expect((await upNext(s)).mainName).toBe(pick.name);

    if (saved.actionId === null) throw new Error('no action');
    expect((await s.routines.revert({ actionId: saved.actionId, opId: 'editor-undo' })).ok).toBe(true);
    const back = await templateOf(s, template.id);
    expect([back.name, back.planDay?.mainLiftExerciseId]).toEqual([template.name, template.planDay?.mainLiftExerciseId]);
    expect((await upNext(s)).mainName).toBe(n.mainName);
  });
});

describe('Make main lift on Your workout', () => {
  it('today’s draft first (Undo), then Every week? on the template; the draft isn’t shown as changed; Undo', async () => {
    const { services: s } = await h.launch();
    const gymId = await setUp(s);
    const n = await upNext(s);
    const template = await templateOf(s, n.routineId);
    const pick = await otherCompound(s, template, gymId);
    const c = await s.todaySession.commit(n.d, { dayKey: n.day.key, controls: n.controls }, h.ids());
    if (!c.ok) throw new Error(c.message);
    const snap = await s.builder.read(c.draftId);
    if (snap === null) throw new Error('no draft');
    const slot = slotsOf(snap.workout.blocks).find((x) => x.exerciseId === pick.exerciseId);
    const main = slotsOf(snap.workout.blocks).find((x) => x.main);
    if (slot === undefined || main === undefined) throw new Error('slots missing');

    const opId = 'yw-main-1';
    const w = await s.builder.edit(c.draftId, { kind: 'make_main', slotKey: slot.key }, { opId, basis: { version: snap.version } });
    if (w.status !== 'written' || w.snapshot === null) throw new Error(`not written: ${w.status} ${'message' in w ? String(w.message) : ''} ${JSON.stringify(slotsOf(snap.workout.blocks).map((x) => [x.exerciseId === pick.exerciseId, x.main]))}`);
    const after = slotsOf(w.snapshot.workout.blocks);
    expect(after.filter((x) => x.main).map((x) => x.exerciseId)).toEqual([pick.exerciseId]);
    // Every row keeps its planned values (the old main keeps its top set and back-offs).
    expect(after.map((x) => x.rows)).toEqual(slotsOf(snap.workout.blocks).map((x) => x.rows));
    expect(w.toast?.text).toBe(`${pick.name} · main lift`);
    expect(w.snapshot.setup.mainLiftExerciseId).toBe(pick.exerciseId);
    expect((await s.builder.edit(c.draftId, { kind: 'make_main', slotKey: slot.key }, { opId: 'yw-main-again', basis: { version: w.snapshot.version } })).status).toBe('refused');

    const ew = await s.builder.mainLiftEveryWeek(c.draftId, { exerciseId: pick.exerciseId, opId: 'yw-every-1' });
    if (!ew.ok) throw new Error(ew.message);
    const t = await templateOf(s, template.id);
    expect([t.version, t.planDay?.mainLiftExerciseId, mainsOf(t)]).toEqual([template.version + 1, keyOf(template, pick.exerciseId), [pick.exerciseId]]);
    expect(ew.snapshot?.planDayChanged ?? null).toBeNull();

    const u = await s.builder.mainLiftEveryWeek(c.draftId, { undo: ew.actionId, opId: 'yw-every-undo' });
    expect(u.ok).toBe(true);
    expect(mainsOf(await templateOf(s, template.id))).toEqual(mainsOf(template));
    expect(u.ok && u.snapshot?.planDayChanged).toBeFalsy();

    // Today's Undo: the draft's main lift back.
    const un = await s.builder.undo(c.draftId, opId, 'yw-main-undo');
    expect([un.status, 'message' in un ? un.message : null]).toEqual(['written', null]);
    expect(slotsOf(un.snapshot?.workout.blocks ?? []).filter((x) => x.main).map((x) => x.exerciseId)).toEqual([main.exerciseId]);
  });
});
