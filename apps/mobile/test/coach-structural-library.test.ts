import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { AppServices } from '../src/services/app-services';
import { CONNECTED, replyWith, StepModel, toolCall } from './coach-model';
import { createHarness, logWorkout, setUpGym, type Harness } from './harness';
import { pageToast } from './overview-driver';

/**
 * Merge of coach tools with the Workouts library: a structural proposal Ben
 * applies from a coach card lands as his own today-edits on the saved
 * workout's overview, and reaches the workout itself only through the
 * library's change-review card (`Update Push A ›`, `applyTodayEdits`, one
 * `update_routine` record by Ben with Undo). No second planning path: the
 * overview's planner and the card's checks are the same ones Ben's own edits
 * use. Real SQLite, scripted model.
 */

const DAY = 86_400_000;
let h: Harness;
let model: StepModel;
beforeEach(() => {
  model = new StepModel([]);
  h = createHarness('2026-10-01T07:00:00.000Z', { coach: { model: () => model, connection: () => Promise.resolve(CONNECTED) } });
});
afterEach(async () => {
  await h.cleanup();
});

const ask = (s: AppServices, text: string) => s.coach.send({ entry: { kind: 'today' }, threadId: null, input: { kind: 'words', text, spoken: false }, turnId: h.ids() });
const plain = (t: string) => t.replaceAll(' ', ' ');

describe('coach structural Apply on a library workout → the library change-review card', () => {
  it('remove + reorder: shown as Ben’s edits on the overview, listed on `Update Push A`, and written to the workout only by its Apply (with Undo)', async () => {
    const { services: s } = await h.launch();
    const gymId = await setUpGym(h, s);
    const first = await logWorkout(h, s, gymId, [
      { exercise: 'Bench press', sets: [{ load: 60, reps: 8 }, { load: 60, reps: 8 }] },
      { exercise: 'Lateral raise', sets: [{ load: 10, reps: 12 }] },
      { exercise: 'Triceps pushdown', sets: [{ load: 25, reps: 12 }] },
    ]);
    h.clockMs += DAY;
    const saved = await s.routines.saveFromSession({ sessionId: first, name: 'Push A', opId: 'save-push-a' });
    if (!saved.ok) throw new Error(saved.message);
    const started = await s.workout.start({ gymId, opId: 'start-routine', checkIn: null, routineOf: saved.routine.id });
    if (!started.ok) throw new Error(started.error.message);
    const agg = started.aggregate;
    h.clockMs += 60_000;
    const idOf = (name: string) => agg.exercises.find((e) => e.exerciseName === name)?.exerciseId;
    model = new StepModel([
      () =>
        toolCall('propose_next_workout_change', {
          sourceSessionId: agg.session.id,
          sourceVersion: agg.session.version,
          changes: [
            { change: 'remove', exerciseId: idOf('Triceps pushdown') },
            { change: 'reorder', exerciseIds: [idOf('Lateral raise'), idOf('Bench press')] },
          ],
          reason: 'Shorter.',
        }),
      () => replyWith('Try that.'),
    ]);
    const r = await ask(s, 'Drop the triceps pushdown next time and do laterals first');
    const card = r.cards[0]?.record;
    if (card?.detail.kind !== 'propose_next_workout_change') throw new Error('no card');
    expect(card.detail.basis).toEqual({ kind: 'routine', routineId: saved.routine.id });
    const routineBefore = (await s.routines.list()).find((x) => x.id === saved.routine.id);

    // Apply: the overview of Push A shows the changes as today's edits; the saved workout is unchanged (rule 2).
    const applied = await s.coach.tapProposal(card.actionId, 'apply');
    if (!applied.ok) throw new Error('not applied');
    const target = { kind: 'routine' as const, routineId: saved.routine.id };
    const page = await s.overview.load({ target, gymId });
    if (page === null) throw new Error('no overview');
    expect(page.view.rows.filter((x) => x.edit?.kind !== 'skipped').map((x) => x.name)).toEqual(['Lateral raise', 'Bench press']);
    expect((await s.routines.list()).find((x) => x.id === saved.routine.id)?.version).toBe(routineBefore?.version);

    // The library's change-review card lists them: the removal (unchecked, TE15) and the order.
    const review = page.templateCard;
    if (review === null) throw new Error('no change-review card');
    expect(review.lines.map((l) => [l.kind, l.checked])).toEqual([
      ['order', true],
      ['remove', false],
    ]);
    expect(plain(review.lines.find((l) => l.kind === 'remove')?.text ?? '')).toBe('Triceps pushdown');

    // Ben ticks both and applies: one `update_routine` record by Ben, the workout changes; Undo puts it back.
    const done = await s.routines.applyTodayEdits({
      target,
      gymId,
      routineId: review.routineId,
      expectedRoutineVersion: review.routineVersion,
      draft: { id: review.draftId, expectedVersion: review.draftVersion },
      lineKeys: review.lines.map((l) => l.key),
      opId: 'update-push-a',
    });
    if (!done.ok) throw new Error(done.message);
    expect(done.action).toMatchObject({ author: 'ben', detail: { kind: 'update_routine' } });
    const order = (ex: readonly { exerciseId: string; order: number }[]) => [...ex].sort((a, b) => a.order - b.order).map((e) => e.exerciseId);
    expect(order(done.routine.exercises)).toEqual([idOf('Lateral raise'), idOf('Bench press')]);
    const reverted = await s.routines.revert({ actionId: done.action.actionId, opId: 'update-push-a-undo' });
    if (!reverted.ok) throw new Error(reverted.message);
    expect(order(reverted.routine.exercises)).toEqual([idOf('Bench press'), idOf('Lateral raise'), idOf('Triceps pushdown')]);
  });

  /** Push A saved from a logged workout, its overview open, and Dumbbell bench press added there by Ben (§11 `add`). */
  async function pushAWithAdd() {
    const { services: s } = await h.launch();
    const gymId = await setUpGym(h, s);
    const first = await logWorkout(h, s, gymId, [
      { exercise: 'Bench press', sets: [{ load: 60, reps: 8 }, { load: 60, reps: 8 }] },
      { exercise: 'Lateral raise', sets: [{ load: 10, reps: 12 }] },
      { exercise: 'Triceps pushdown', sets: [{ load: 25, reps: 12 }] },
    ]);
    h.clockMs += DAY;
    const saved = await s.routines.saveFromSession({ sessionId: first, name: 'Push A', opId: 'save-push-a' });
    if (!saved.ok) throw new Error(saved.message);
    const started = await s.workout.start({ gymId, opId: 'start-routine', checkIn: null, routineOf: saved.routine.id });
    if (!started.ok) throw new Error(started.error.message);
    const agg = started.aggregate;
    h.clockMs += 60_000;
    const target = { kind: 'routine' as const, routineId: saved.routine.id };
    const page = await s.overview.load({ target, gymId });
    const sheet = await s.overview.addCandidates({ target, gymId, query: 'dumbbell bench', showAll: false });
    const pick = sheet?.rows.find((r) => r.name === 'Dumbbell bench press');
    if (page === null || pick === undefined) throw new Error('no overview or no dumbbell bench');
    const added = await s.overview.edit({ target, gymId, expectedDraftVersion: page.draft?.version ?? null, opId: 'ben-add', edit: { kind: 'add', exerciseId: pick.exerciseId } });
    if (!added.ok) throw new Error('not added');
    const idOf = (name: string) => agg.exercises.find((e) => e.exerciseName === name)?.exerciseId;
    return { s, gymId, target, agg, idOf, dumbbellBench: pick.exerciseId };
  }

  it('with an exercise Ben added today: remove + reorder applies whole, the added one kept at the end (review B2)', async () => {
    const { s, gymId, target, agg, idOf } = await pushAWithAdd();
    model = new StepModel([
      () =>
        toolCall('propose_next_workout_change', {
          sourceSessionId: agg.session.id,
          sourceVersion: agg.session.version,
          changes: [
            { change: 'remove', exerciseId: idOf('Triceps pushdown') },
            { change: 'reorder', exerciseIds: [idOf('Lateral raise'), idOf('Bench press')] },
          ],
          reason: 'Shorter.',
        }),
      () => replyWith('Try that.'),
    ]);
    const r = await ask(s, 'Drop the pushdown next time and do laterals first');
    const card = r.cards[0]?.record;
    if (card?.detail.kind !== 'propose_next_workout_change') throw new Error('no card');
    const applied = await s.coach.tapProposal(card.actionId, 'apply');
    if (!applied.ok) throw new Error('not applied');
    const page = await s.overview.load({ target, gymId });
    expect(page?.coachRefused).toBe(0);
    expect(page?.view.rows.map((x) => [x.name, x.edit?.kind ?? null])).toEqual([
      ['Lateral raise', null],
      ['Bench press', null],
      ['Triceps pushdown', 'skipped'],
      ['Dumbbell bench press', 'added'],
    ]);
    // A second load writes nothing more.
    const again = await s.overview.load({ target, gymId });
    expect(again?.draft?.version).toBe(page?.draft?.version);
    expect(again?.coachRefused).toBe(0);
  });

  it('one change refused here: none of the Apply is written (review B2)', async () => {
    const { s, gymId, target, agg, idOf, dumbbellBench } = await pushAWithAdd();
    const before = await s.overview.load({ target, gymId });
    // The swap's exercise is the one Ben added today, so the draft refuses it; the removal must not land alone.
    model = new StepModel([
      () =>
        toolCall('propose_next_workout_change', {
          sourceSessionId: agg.session.id,
          sourceVersion: agg.session.version,
          changes: [
            { change: 'remove', exerciseId: idOf('Triceps pushdown') },
            { change: 'swap', fromExerciseId: idOf('Bench press'), toExerciseId: dumbbellBench },
          ],
          reason: 'Shoulder.',
        }),
      () => replyWith('Try that.'),
    ]);
    const r = await ask(s, 'Drop the pushdown and swap bench for dumbbells next time');
    const card = r.cards[0]?.record;
    if (card?.detail.kind !== 'propose_next_workout_change') throw new Error('no card');
    const applied = await s.coach.tapProposal(card.actionId, 'apply');
    if (!applied.ok) throw new Error('not applied');
    const page = await s.overview.load({ target, gymId });
    expect(page?.coachRefused).toBe(1);
    expect(page?.draft?.version).toBe(before?.draft?.version);
    expect(page?.view.rows.map((x) => [x.name, x.edit?.kind ?? null])).toEqual([
      ['Bench press', null],
      ['Lateral raise', null],
      ['Triceps pushdown', null],
      ['Dumbbell bench press', 'added'],
    ]);
    // Ben takes his add back: the whole Apply lands then, both changes together.
    const added = page?.view.rows.find((x) => x.name === 'Dumbbell bench press');
    if (added?.edit?.kind !== 'added' || !page?.draft) throw new Error('no add');
    expect((await s.overview.undoEdit({ target, gymId, expectedDraftVersion: page.draft.version, opId: 'ben-remove-add', editId: added.edit.editId })).ok).toBe(true);
    const after = await s.overview.load({ target, gymId });
    expect(after?.coachRefused).toBe(0);
    expect(after?.view.rows.map((x) => [x.name, x.edit?.kind ?? null])).toEqual([
      ['Dumbbell bench press', 'swapped'],
      ['Lateral raise', null],
      ['Triceps pushdown', 'skipped'],
    ]);
    // It landed later than the tap, so the page says so once (merge r2 S2); a further load has nothing to say.
    expect(after?.coachLanded).toBe(1);
    expect(after === null ? null : pageToast(after, new Set())?.text).toBe('Coach change applied');
    const later = await s.overview.load({ target, gymId });
    expect(later?.coachLanded).toBe(0);
    expect(later?.draft?.version).toBe(after?.draft?.version);
  });

  it('an Apply that lands first time is not announced as late (merge r2 S2)', async () => {
    const { s, gymId, target, agg, idOf } = await pushAWithAdd();
    model = new StepModel([
      () =>
        toolCall('propose_next_workout_change', {
          sourceSessionId: agg.session.id,
          sourceVersion: agg.session.version,
          changes: [{ change: 'remove', exerciseId: idOf('Triceps pushdown') }],
          reason: 'Shorter.',
        }),
      () => replyWith('Try that.'),
    ]);
    const r = await ask(s, 'Drop the pushdown next time');
    const card = r.cards[0]?.record;
    if (card?.detail.kind !== 'propose_next_workout_change') throw new Error('no card');
    if (!(await s.coach.tapProposal(card.actionId, 'apply')).ok) throw new Error('not applied');
    const page = await s.overview.load({ target, gymId });
    expect(page?.view.rows.find((x) => x.name === 'Triceps pushdown')?.edit?.kind).toBe('skipped');
    expect(page?.coachLanded).toBe(0);
  });

  it('a coach reorder keeps the exercise Ben added where he placed it (merge r2 S1)', async () => {
    const { s, gymId, target, agg, idOf } = await pushAWithAdd();
    // Ben moves his added Dumbbell bench press to the top.
    const page = await s.overview.load({ target, gymId });
    const keys = page?.view.rows.map((x) => x.slotKey) ?? [];
    const addedKey = page?.view.rows.find((x) => x.name === 'Dumbbell bench press')?.slotKey;
    if (addedKey === undefined) throw new Error('no add');
    const moved = await s.overview.edit({ target, gymId, expectedDraftVersion: page?.draft?.version ?? null, opId: 'ben-order', edit: { kind: 'order', slotKeys: [addedKey, ...keys.filter((k) => k !== addedKey)] } });
    if (!moved.ok) throw new Error('not moved');
    model = new StepModel([
      () =>
        toolCall('propose_next_workout_change', {
          sourceSessionId: agg.session.id,
          sourceVersion: agg.session.version,
          changes: [{ change: 'reorder', exerciseIds: [idOf('Lateral raise'), idOf('Bench press'), idOf('Triceps pushdown')] }],
          reason: 'Shoulders fresh.',
        }),
      () => replyWith('Try that.'),
    ]);
    const r = await ask(s, 'Do laterals first next time');
    const card = r.cards[0]?.record;
    if (card?.detail.kind !== 'propose_next_workout_change') throw new Error('no card');
    if (!(await s.coach.tapProposal(card.actionId, 'apply')).ok) throw new Error('not applied');
    const after = await s.overview.load({ target, gymId });
    expect(after?.coachRefused).toBe(0);
    // Still ahead of Bench press, the slot it preceded; not moved to the end.
    expect(after?.view.rows.map((x) => x.name)).toEqual(['Lateral raise', 'Dumbbell bench press', 'Bench press', 'Triceps pushdown']);
  });
});
