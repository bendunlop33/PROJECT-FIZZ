import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { slotsOf } from '@fizz/domain';
import type { ModelEvent, ModelRequest } from '@fizz/coach';
import type { Routine, SessionAggregate } from '@fizz/schemas';

import type { BuilderSnapshot, BuilderWriteResult } from '../src/builder/builder-service';
import type { AppServices } from '../src/services/app-services';
import { CONNECTED, replyWith, StepModel, toolCall } from './coach-model';
import { createHarness, logWorkout, setUpGym, type Harness } from './harness';

/**
 * (Ben, 22 Oct) The Workout overview is retired: every place that opened a
 * workout before Start opens the builder's Your workout instead. On real
 * SQLite, offline, with no coach call: a library workout, a past workout to
 * do again, a coach chat draft and Up next each open today's builder draft
 * for that target (resumed with its edits on reopen), and Start starts
 * exactly what the page shows through the one Start path: one session per
 * op ID, the library workout credited (rotation and `last done` move on),
 * the chat draft closed with it, a workout in progress refused, and no gym
 * saved as the typical gym first.
 */

const DAY = 86_400_000;
let h: Harness;
let model: StepModel;
beforeEach(() => {
  model = new StepModel([]);
  h = createHarness('2026-10-05T07:00:00.000Z', { coach: { model: () => model, connection: () => Promise.resolve(CONNECTED) } });
});
afterEach(async () => {
  await h.cleanup();
});

const opened = (r: BuilderWriteResult): BuilderSnapshot => {
  if (r.status === 'written' || r.status === 'replayed') return r.snapshot;
  throw new Error(`open ${r.status}: ${r.message}`);
};
const names = (snap: BuilderSnapshot) => slotsOf(snap.workout.blocks).map((sl) => snap.facts[sl.exerciseId]?.name ?? '?');

async function saved(s: AppServices, sessionId: string, name: string): Promise<Routine> {
  const r = await s.routines.saveFrom({ from: { kind: 'session', sessionId }, name, addToRotation: true, opId: `save-${name}` });
  if (!r.ok) throw new Error(r.message);
  return r.routine;
}

/** `Shoulders` done, then Push A, Pull A and Legs A saved into the rotation in that order (Legs A last, so Push A is Up next). */
async function fixture(s: AppServices) {
  const gymId = await setUpGym(h, s);
  const shoulders = await logWorkout(h, s, gymId, [{ exercise: 'Overhead press', sets: [{ load: 40, reps: 8 }, { load: 40, reps: 8 }] }]);
  const named = await s.workout.load(shoulders);
  expect((await s.workout.dispatch(shoulders, { type: 'rename_session', at: h.now(), opId: h.ids(), name: 'Shoulders', expectedVersion: named?.aggregate.session.version ?? 0 })).ok).toBe(true);
  h.clockMs += DAY;
  const push = await logWorkout(h, s, gymId, [
    { exercise: 'Bench press', sets: [{ load: 60, reps: 8, rpe: 8 }, { load: 60, reps: 8, rpe: 8 }, { load: 60, reps: 8, rpe: 8 }] },
    { exercise: 'Lateral raise', sets: [{ load: 8, reps: 12 }, { load: 8, reps: 12 }] },
  ]);
  const pushA = await saved(s, push, 'Push A');
  h.clockMs += DAY;
  const pullA = await saved(s, await logWorkout(h, s, gymId, [{ exercise: 'Barbell row', sets: [{ load: 50, reps: 10 }] }]), 'Pull A');
  h.clockMs += DAY;
  const legsA = await saved(s, await logWorkout(h, s, gymId, [{ exercise: 'Back squat', sets: [{ load: 80, reps: 5 }] }]), 'Legs A');
  h.clockMs += DAY;
  return { gymId, pushA, pullA, legsA, shoulders };
}

/** Each slot's first working target in the session is the page's (loads stand as shown). */
function startedAsShown(snap: BuilderSnapshot, a: SessionAggregate | undefined): void {
  expect(a).toBeDefined();
  for (const slot of slotsOf(snap.workout.blocks)) {
    const ex = a?.exercises.find((e) => e.exerciseId === slot.exerciseId);
    expect(ex, snap.facts[slot.exerciseId]?.name).toBeDefined();
    const sets = a?.sets.filter((x) => x.sessionExerciseId === ex?.id && x.setType !== 'warmup') ?? [];
    expect(sets).toHaveLength(slot.rows.filter((r) => r.type !== 'warmup').length);
    const row = slot.rows.find((r) => r.type !== 'warmup');
    const first = [...sets].sort((x, y) => x.index - y.index)[0];
    if (row?.load != null) expect(first?.planned.load?.value).toBe(row.load);
  }
}

/** Log one set and finish. */
async function finish(s: AppServices, sessionId: string): Promise<void> {
  const a = (await s.workout.load(sessionId))?.aggregate;
  const set = a?.sets.find((x) => x.status === 'pending' && x.setType !== 'warmup');
  if (a === undefined || set === undefined) throw new Error('no set');
  const conv = a.exercises.find((e) => e.id === set.sessionExerciseId)?.loadConvention ?? 'total';
  h.clockMs += 60_000;
  expect((await s.workout.dispatch(sessionId, { type: 'log_set', at: h.now(), opId: `log:${set.id}`, setId: set.id, values: { load: set.planned.load ?? { value: 20, unit: 'kg', convention: conv }, reps: 8, durationS: null, rpe: 8, rir: null }, restTimerId: h.ids() })).ok).toBe(true);
  h.clockMs += 60_000;
  const now = await s.workout.load(sessionId);
  expect((await s.workout.dispatch(sessionId, { type: 'finish', at: h.now(), opId: h.ids(), expectedVersion: now?.aggregate.session.version ?? 0, endedAt: null })).ok).toBe(true);
  await h.settle(s);
}

describe('a library workout (Library › Workouts, Exercise detail `Used in`, a Summary’s `Saved as`, the coach’s plan card)', () => {
  it('opens as stored (order, set counts, no Set up), resumes on reopen, and Start credits the workout: Up next moves on', async () => {
    const { services: s } = await h.launch();
    const { gymId, pushA, pullA } = await fixture(s);
    expect((await s.next.preview(gymId))?.routine?.id).toBe(pushA.id);

    const snap = opened(await s.builder.openTarget({ kind: 'routine', routineId: pushA.id }, 'open-push-a'));
    expect(names(snap)).toEqual(['Bench press', 'Lateral raise']);
    expect(snap.name).toBe('Push A');
    expect(snap.from).toEqual({ kind: 'routine', id: pushA.id });
    expect(snap.planDay).toBeNull();
    expect(snap.canSave).toBe(false);
    expect(slotsOf(snap.workout.blocks).map((x) => x.rows.filter((r) => r.type !== 'warmup').length)).toEqual([3, 2]);
    // The same op twice, and a second open the same day: the same draft (rule 5; reopen keeps edits).
    expect(opened(await s.builder.openTarget({ kind: 'routine', routineId: pushA.id }, 'open-push-a')).draftId).toBe(snap.draftId);
    const lateral = slotsOf(snap.workout.blocks)[1];
    if (lateral === undefined) throw new Error('no lateral');
    const edited = opened(await s.builder.edit(snap.draftId, { kind: 'add_set', slotKey: lateral.key }, { opId: 'add-set', basis: { version: snap.version } }));
    const again = opened(await s.builder.openTarget({ kind: 'routine', routineId: pushA.id }, 'open-push-a-2'));
    expect(again.draftId).toBe(snap.draftId);
    expect(again.version).toBe(edited.version);
    // Another workout is its own draft.
    expect(opened(await s.builder.openTarget({ kind: 'routine', routineId: pullA.id }, 'open-pull-a')).draftId).not.toBe(snap.draftId);
    // No prompt: not a plan day (Q11).
    expect(await s.builder.startPrompt(again.draftId)).toBeNull();

    const started = await s.builder.start(again.draftId, { choice: { kind: 'today' }, opId: 'start-push-a', expectedVersion: again.version, checkIn: { kind: 'skipped', atUtc: h.now().utc } });
    expect(started).toMatchObject({ ok: true, duplicate: false });
    if (!started.ok) return;
    // A retry of the same tap: the same session, nothing more written.
    expect(await s.builder.start(again.draftId, { choice: { kind: 'today' }, opId: 'start-push-a', expectedVersion: again.version, checkIn: { kind: 'skipped', atUtc: h.now().utc } })).toMatchObject({ ok: true, sessionId: started.sessionId, duplicate: true });
    const a = (await s.workout.load(started.sessionId))?.aggregate;
    expect(a?.session).toMatchObject({ routineId: pushA.id, routineName: 'Push A', gymId });
    startedAsShown(again, a);
    await finish(s, started.sessionId);
    // Rotation: Push A done, so Pull A is next (as the overview's Start did).
    expect((await s.next.preview(gymId))?.routine?.id).toBe(pullA.id);
    // The draft is closed with its session; a new open today is a fresh draft.
    expect(await s.builder.read(again.draftId)).toMatchObject({ startable: false });
    expect(opened(await s.builder.openTarget({ kind: 'routine', routineId: pushA.id }, 'open-push-a-3')).draftId).not.toBe(again.draftId);
    expect(model.requests).toHaveLength(0);
  });

  it('a deleted workout, or one that isn’t Ben’s, opens nothing', async () => {
    const { services: s } = await h.launch();
    const { pushA } = await fixture(s);
    expect((await s.routines.remove({ routineId: pushA.id, expectedVersion: pushA.version, opId: 'del' })).ok).toBe(true);
    expect(await s.builder.openTarget({ kind: 'routine', routineId: pushA.id }, 'open-gone')).toMatchObject({ status: 'closed', snapshot: null, message: 'That workout wasn’t found.' });
    expect(await s.builder.openTarget({ kind: 'routine', routineId: '00000000-0000-4000-8000-000000000000' }, 'open-none')).toMatchObject({ status: 'closed' });
  });
});

describe('a past workout to do again (Library history)', () => {
  it('opens with the exercises and working sets Ben did, named as the history names it; Start credits no workout', async () => {
    const { services: s } = await h.launch();
    const { shoulders } = await fixture(s);
    const snap = opened(await s.builder.openTarget({ kind: 'session', sourceSessionId: shoulders }, 'open-again'));
    expect(names(snap)).toEqual(['Overhead press']);
    expect(snap.name).toBe('Shoulders');
    expect(snap.from).toEqual({ kind: 'session', id: shoulders });
    expect(snap.canSave).toBe(true);
    expect(slotsOf(snap.workout.blocks)[0]?.rows.filter((r) => r.type !== 'warmup')).toHaveLength(2);
    expect(opened(await s.builder.openTarget({ kind: 'session', sourceSessionId: shoulders }, 'open-again-2')).draftId).toBe(snap.draftId);
    const started = await s.builder.start(snap.draftId, { choice: { kind: 'today' }, opId: 'start-again', expectedVersion: snap.version, checkIn: null });
    expect(started.ok).toBe(true);
    if (!started.ok) return;
    const a = (await s.workout.load(started.sessionId))?.aggregate;
    expect(a?.session.routineId).toBeNull();
    startedAsShown(snap, a);
  });

  it('`⋯ Save to Workouts` saves what the page shows as a new workout, once per op ID', async () => {
    const { services: s } = await h.launch();
    const { gymId, shoulders } = await fixture(s);
    const snap = opened(await s.builder.openTarget({ kind: 'session', sourceSessionId: shoulders }, 'open-save'));
    const src = await s.routines.saveSource({ kind: 'draft', draftId: snap.draftId, gymId }, snap.name);
    expect(src).toMatchObject({ name: 'Shoulders' });
    const r = await s.routines.saveFrom({ from: { kind: 'draft', draftId: snap.draftId, gymId }, name: 'Shoulders', addToRotation: false, opId: 'save-shoulders' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.routine.exercises.map((e) => e.exerciseId)).toEqual(slotsOf(snap.workout.blocks).map((x) => x.exerciseId));
    expect(await s.routines.saveFrom({ from: { kind: 'draft', draftId: snap.draftId, gymId }, name: 'Shoulders', addToRotation: false, opId: 'save-shoulders' })).toMatchObject({ ok: true, duplicate: true });
  });
});

describe('Up next (`next`)', () => {
  it('opens the rotation’s workout, the same draft as opening that workout', async () => {
    const { services: s } = await h.launch();
    const { pushA } = await fixture(s);
    const snap = opened(await s.builder.openTarget({ kind: 'next' }, 'open-next'));
    expect(snap.from).toEqual({ kind: 'routine', id: pushA.id });
    expect(opened(await s.builder.openTarget({ kind: 'routine', routineId: pushA.id }, 'open-push')).draftId).toBe(snap.draftId);
  });
});

describe('Start guards', () => {
  it('a workout in progress: nothing is created and the page is told to go to Today', async () => {
    const { services: s } = await h.launch();
    const { gymId, pushA } = await fixture(s);
    const snap = opened(await s.builder.openTarget({ kind: 'routine', routineId: pushA.id }, 'open-active'));
    const other = await s.workout.start({ gymId, opId: 'empty-1', checkIn: null });
    expect(other.ok).toBe(true);
    const r = await s.builder.start(snap.draftId, { choice: { kind: 'today' }, opId: 'start-blocked', expectedVersion: snap.version, checkIn: null });
    expect(r).toMatchObject({ ok: false, reason: 'active' });
    expect(await s.builder.read(snap.draftId)).toMatchObject({ startable: true });
  });

  it('a stale page (edited since) starts nothing (rule 5)', async () => {
    const { services: s } = await h.launch();
    const { pushA } = await fixture(s);
    const snap = opened(await s.builder.openTarget({ kind: 'routine', routineId: pushA.id }, 'open-stale'));
    const first = slotsOf(snap.workout.blocks)[0];
    if (first === undefined) throw new Error('no slot');
    opened(await s.builder.edit(snap.draftId, { kind: 'add_set', slotKey: first.key }, { opId: 'e1', basis: { version: snap.version } }));
    expect(await s.builder.start(snap.draftId, { choice: { kind: 'today' }, opId: 'start-stale', expectedVersion: snap.version, checkIn: null })).toMatchObject({ ok: false, reason: 'stale' });
    expect(await s.sessions.active()).toBeNull();
  });

  it('no gym (archived): Start saves the typical gym first and starts there; a retry reuses both', async () => {
    let { services: s } = await h.launch();
    const { gymId, pushA } = await fixture(s);
    const file = s.developer.databaseNames().current;
    await h.forceClose();
    const db = new DatabaseSync(join(h.dir, file));
    db.prepare("UPDATE gyms SET data = json_set(data, '$.archivedAtUtc', '2026-10-09T07:30:00.000Z') WHERE id = ?").run(gymId);
    db.close();
    s = (await h.launch()).services;
    expect(await s.yourData.currentGym()).toBeNull();
    const snap = opened(await s.builder.openTarget({ kind: 'routine', routineId: pushA.id }, 'open-nogym'));
    expect(snap.gymId).toBeNull();
    const r = await s.builder.start(snap.draftId, { choice: { kind: 'today' }, opId: 'start-nogym', expectedVersion: snap.version, checkIn: null });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const gyms = await s.yourData.gyms();
    expect(gyms).toHaveLength(1);
    expect(gyms[0]?.id).not.toBe(gymId);
    expect((await s.workout.load(r.sessionId))?.aggregate.session).toMatchObject({ gymId: gyms[0]?.id, routineId: pushA.id });
    expect(await s.builder.start(snap.draftId, { choice: { kind: 'today' }, opId: 'start-nogym', expectedVersion: snap.version, checkIn: null })).toMatchObject({ ok: true, sessionId: r.sessionId, duplicate: true });
    expect(await s.yourData.gyms()).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// A coach chat draft (`Open ›` on the chat's workout card)

function buildOf(req: ModelRequest): { usable: { catalogueId: string; name: string }[] } {
  const block = req.input.find((i) => i.type === 'message' && i.role === 'developer' && i.content.startsWith('YOUR DATA'));
  if (block?.type !== 'message') throw new Error('no context');
  const data = JSON.parse(block.content.slice(block.content.indexOf('\n') + 1)) as { build?: { usable: { catalogueId: string; name: string }[] } };
  if (data.build === undefined) throw new Error('not a build turn');
  return data.build;
}
const ex = (catalogueId: string, over: Record<string, unknown> = {}) => ({ catalogueId, warmups: null, workingSets: 3, reps: { min: 8, max: 10 }, workSeconds: null, targetRpe: 8, topSet: null, restSeconds: null, superset: null, ...over });
function pushStub(req: ModelRequest): ModelEvent[] {
  const b = buildOf(req);
  const idOf = (name: string) => b.usable.find((u) => u.name === name)?.catalogueId ?? `missing-${name}`;
  return toolCall('propose_workout', { name: 'Push', exercises: [ex(idOf('Bench press'), { workingSets: 4, reps: { min: 6, max: 8 } }), ex(idOf('Lateral raise'), { reps: { min: 12, max: 15 } })], message: 'Bench first.' });
}

describe('a coach chat draft', () => {
  it('opens with the coach’s checked plan as it stands (its loads, labelled Coach target), and Start starts the chat draft with it', async () => {
    const { services: s } = await h.launch();
    await fixture(s);
    model = new StepModel([pushStub, () => replyWith('Here it is.')]);
    const result = await s.coach.send({ entry: { kind: 'today' }, threadId: null, input: { kind: 'words', text: 'build me a 45-minute push session', spoken: false }, turnId: h.ids() });
    const card = result.cards[0]?.record;
    if (card?.detail.kind !== 'build_workout' || card.status !== 'committed') throw new Error('no draft');
    const chatId = card.detail.draftId;
    const chat = await s.coachDrafts.get(chatId);
    const calls = model.requests.length;

    const snap = opened(await s.builder.openTarget({ kind: 'coach_draft', draftId: chatId }, 'open-chat'));
    expect(snap.from).toEqual({ kind: 'coach_draft', id: chatId });
    expect(names(snap)).toEqual(['Bench press', 'Lateral raise']);
    expect(snap.draftId).not.toBe(chatId);
    // The coach's loads, unchanged.
    const chatBench = chat?.versions[0]?.plan.slots[0];
    const bench = slotsOf(snap.workout.blocks)[0];
    const chatLoad = chatBench?.setTemplates.find((t) => t.setType !== 'warmup')?.load;
    if (chatLoad?.load != null && (chatLoad.source === 'coach' || chatLoad.source === 'coach_est')) expect(bench?.source).toBe('coach_target');
    expect(bench?.rows.find((r) => r.type !== 'warmup')?.load ?? null).toBe(chatLoad?.load?.value ?? null);
    expect(opened(await s.builder.openTarget({ kind: 'coach_draft', draftId: chatId }, 'open-chat-2')).draftId).toBe(snap.draftId);

    const started = await s.builder.start(snap.draftId, { choice: { kind: 'today' }, opId: 'start-chat', expectedVersion: snap.version, checkIn: null });
    expect(started.ok).toBe(true);
    if (!started.ok) return;
    startedAsShown(snap, (await s.workout.load(started.sessionId))?.aggregate);
    // The chat card reads Started, with the same session.
    expect(await s.coachDrafts.get(chatId)).toMatchObject({ status: 'started', sessionId: started.sessionId });
    // Opening a started chat draft opens nothing; no model call was made by any of it.
    expect(await s.builder.openTarget({ kind: 'coach_draft', draftId: chatId }, 'open-chat-3')).toMatchObject({ status: 'closed' });
    expect(model.requests).toHaveLength(calls);
  });
});
