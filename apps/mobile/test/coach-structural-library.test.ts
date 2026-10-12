import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { AppServices } from '../src/services/app-services';
import { CONNECTED, replyWith, StepModel, toolCall } from './coach-model';
import { createHarness, logWorkout, setUpGym, type Harness } from './harness';

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
});
