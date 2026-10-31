import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';
import type { SessionAggregate, SessionCommand } from '@fizz/schemas';
import { buildWorkoutTableView, reduceSession, startWorkout, stepRoundCommand, supersetNextCommand, type ActiveViewInput } from '@fizz/domain';

import { assisted, at, exercise, GYM, id, idGen, kg, ms, profile, routine, routineExercise, template, values } from '../../../packages/domain/test/fixtures';
import { apply, BENCH, HANG, ROW, logCmd, setsFor, startFixture } from '../../../packages/domain/test/session-fixture';
import { dropTargetAt, visibleFrames } from '../src/ui/drag-logic';
import { nextFieldByKey, popupRowByKey } from '../src/ui/exercise-popup-model';
import { exerciseActions, popupCellWrite, POPUP_REFUSAL, removePrompt, sessionPopupView } from '../src/workout/exercise-popup';
import { buildRounds } from '../src/workout/rounds';

/**
 * wo-v3b reviews (parity and integrity, 21 Oct): the pop-up keys every edit by the set, never by
 * its position (B1); a Remove confirmation sends exactly what Ben was shown (B2/S3); actions are
 * only offered when they work (S5); drag drops only on rows Ben can see (S2).
 */

const SRC = join(__dirname, '..', 'src');
const read = (...p: string[]) => readFileSync(join(SRC, ...p), 'utf8');

const input = (aggregate: SessionAggregate): ActiveViewInput => ({ aggregate, nowMs: ms(10), gymName: 'Main Gym', previous: {}, painFlagged: new Set(), edits: null });
const rowIdOf = (s: SessionAggregate, exerciseId: string): string => s.exercises.find((e) => e.exerciseId === exerciseId && e.removed === undefined)?.id ?? '';
const popup = (s: SessionAggregate, exerciseId: string) => {
  const rowId = rowIdOf(s, exerciseId);
  const ex = buildRounds(buildWorkoutTableView(input(s)), () => null)
    .flatMap((r) => r.exercises)
    .find((x) => x.sessionExerciseId === rowId);
  if (ex === undefined) throw new Error('no exercise');
  const v = sessionPopupView({ aggregate: s, exercise: ex, works: null, mayHurt: false });
  if (v === null) throw new Error('no pop-up');
  return v;
};

/** Parity B1's scenario: Bench warm-up and Set 1 logged, ⋯ Skip exercise, ＋ Set twice, the second one logged. */
function skippedInTheMiddle(): { s: SessionAggregate; added: [string, string]; skipped: string } {
  let s = startFixture().state;
  const [w, b1, b2] = setsFor(s, BENCH);
  s = apply(s, logCmd(w?.id ?? '', values(kg(60), 10), 60));
  s = apply(s, logCmd(b1?.id ?? '', values(kg(100), 6), 200));
  const bench = rowIdOf(s, BENCH);
  s = apply(s, { type: 'skip_exercise', at: at(210), opId: 'skip-1', sessionExerciseId: bench });
  const x1 = id(95001);
  const x2 = id(95002);
  s = apply(s, { type: 'add_set', at: at(220), opId: 'add-1', sessionExerciseId: bench, newSetId: x1, setType: 'working' });
  s = apply(s, { type: 'add_set', at: at(221), opId: 'add-2', sessionExerciseId: bench, newSetId: x2, setType: 'working' });
  s = apply(s, logCmd(x2, values(kg(100), 5), 300));
  return { s, added: [x1, x2], skipped: b2?.id ?? '' };
}

describe('pop-up rows are keyed by the set, never by position (parity B1)', () => {
  it('a skipped set in the middle: each row’s index is its place in the rows, and the skipped set isn’t a row', () => {
    const { s, added, skipped } = skippedInTheMiddle();
    const v = popup(s, BENCH);
    expect(v.rows.map((r) => r.key)).not.toContain(skipped);
    v.rows.forEach((r, i) => {
      expect(r.index).toBe(i);
    });
    // Set 3 (pending) and Set 4 (logged) are where they are shown.
    const pending = popupRowByKey(v.rows, added[0]);
    const logged = popupRowByKey(v.rows, added[1]);
    expect(pending?.done).toBe(false);
    expect(logged?.done).toBe(true);
  });

  it('typing 10 into Set 3’s Reps writes Set 3’s target, never a correction of the logged Set 4 (rule 2)', () => {
    const { s, added } = skippedInTheMiddle();
    const v = popup(s, BENCH);
    const row = popupRowByKey(v.rows, added[0]);
    if (row === undefined) throw new Error('no row');
    const w = popupCellWrite(s, row.key, 'reps', 10);
    expect(w).toMatchObject({ kind: 'planned', setId: added[0], patch: { reps: { min: 10, max: 10 } } });
    const logged = s.sets.find((x) => x.id === added[1]);
    const after = apply(s, { type: 'edit_planned_set', at: at(400), opId: 'e-1', setId: added[0], expectedSetVersion: w.kind === 'planned' ? w.expectedSetVersion : 0, patch: { reps: { min: 10, max: 10 } } });
    expect(after.sets.find((x) => x.id === added[1])).toEqual(logged);
  });

  it('Next walks the rows by key: Reps → Kg → RPE → the next row’s Reps; null at the end', () => {
    const { s } = skippedInTheMiddle();
    const v = popup(s, BENCH);
    const [first, second] = v.rows;
    const last = v.rows.at(-1);
    if (first === undefined || second === undefined || last === undefined) throw new Error('rows');
    expect(nextFieldByKey(v.rows, first.key, 'reps')).toEqual({ key: first.key, field: 'kg' });
    // The warm-up has no RPE: Kg → the next row's Reps.
    expect(first.noRpe).toBe(true);
    expect(nextFieldByKey(v.rows, first.key, 'kg')).toEqual({ key: second.key, field: 'reps' });
    expect(nextFieldByKey(v.rows, last.key, 'rpe')).toBeNull();
    expect(nextFieldByKey(v.rows, 'gone', 'reps')).toBeNull();
  });

  it('the shared component resolves commit, the − / + bar and Next by key, not by `view.rows[i]`', () => {
    const src = read('ui', 'exercise-popup.tsx');
    expect(src).not.toMatch(/view\.rows\[/);
    expect(src).toContain('popupRowByKey(view.rows, rowKey)');
    expect(src).toContain('popupRowByKey(view.rows, focus.key)');
    expect(src).toContain('nextFieldByKey(view.rows, focus.key, focus.field)');
    expect(src).toContain('void commit(r.key, field, e.nativeEvent.text)');
  });
});

describe('Remove: the confirmation sends what Ben was shown (integrity B2, parity S3)', () => {
  it('with logged sets it asks, with the count; the command is fixed when asked and refused once the workout moved on', () => {
    let s = startFixture().state;
    const [w, b1, b2] = setsFor(s, BENCH);
    s = apply(s, logCmd(w?.id ?? '', values(kg(60), 10), 60));
    s = apply(s, logCmd(b1?.id ?? '', values(kg(100), 6), 200));
    const p = removePrompt(s, rowIdOf(s, BENCH), { opId: 'remove-1', at: at(300) });
    expect(p).toMatchObject({ kind: 'ask', title: 'Remove Bench press?', message: 'Keeps 2 logged sets', command: { confirmedLoggedSets: 2, expectedVersion: s.session.version, opId: 'remove-1' } });
    if (p === null) throw new Error('no prompt');
    // While the dialog is open, the last set is logged from the lock screen.
    const moved = apply(s, logCmd(b2?.id ?? '', values(kg(100), 5), 320));
    const r = reduceSession(moved, p.command);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('stale_version');
  });

  it('without logged sets it goes at once; a finished exercise offers no Remove at all (S5)', () => {
    let s = startFixture().state;
    expect(removePrompt(s, rowIdOf(s, BENCH), { opId: 'r', at: at(1) })?.kind).toBe('now');
    for (const x of setsFor(s, BENCH)) s = apply(s, logCmd(x.id, values(x.planned.load, 8), 100));
    expect(removePrompt(s, rowIdOf(s, BENCH), { opId: 'r', at: at(1) })).toBeNull();
    expect(exerciseActions(s, rowIdOf(s, BENCH)).map((a) => a.name)).not.toContain('remove');
    expect(popup(s, BENCH).canDeleteExercise).toBe(false);
    expect(popup(s, ROW).canDeleteExercise).toBe(true);
  });

  it('the hook sends the bound command on confirm, and works out a no-confirm Remove in turn', () => {
    const src = read('screens', 'workout', 'WorkoutEdits.tsx');
    expect(src).toContain('onPress: () => void sendAsIs(prompt.command, UNDO_TOAST.removed(prompt.name))');
    expect(src).not.toContain('removeExerciseCommand(now');
  });
});

describe('only what works is offered (parity S5, integrity B1)', () => {
  it('＋ Warm-up is off for a superset member, with its own refusal line', () => {
    const s = startFixture().state;
    expect(popup(s, ROW).canAddWarmup).toBe(false);
    expect(popup(s, BENCH).canAddWarmup).toBe(true);
    expect(POPUP_REFUSAL.superset).toBe('No warm-ups in a superset');
  });

  it('Superset with next is off when both sides are already supersets', () => {
    const s0 = startFixture().state;
    expect(popup(s0, BENCH).canSupersetNext).toBe(true);
    // Dead hang up one, then Bench + Dead hang: two supersets side by side.
    const up = stepRoundCommand(s0, rowIdOf(s0, HANG), 'up', { opId: 'm-1', at: at(5) });
    if (!up.ok) throw new Error(up.reason);
    const s1 = apply(s0, up.command);
    const s2 = apply(s1, supersetNextCommand(s1, rowIdOf(s1, BENCH), { opId: 'p-1', at: at(6) }) as SessionCommand);
    expect(popup(s2, HANG).canSupersetNext).toBe(false);
    expect(exerciseActions(s2, rowIdOf(s2, HANG)).map((x) => x.name)).not.toContain('superset_next');
  });

  it('(Ben, 27 Oct) an assisted machine’s typed assistance past its most is kept as typed (never refused or rounded)', () => {
    const PULL = id(270);
    const machine = assisted();
    const r = routine([routineExercise(700, { exerciseId: PULL, equipmentId: machine.id, order: 0, setTemplates: [template(7001, { targetLoad: kg(25, 'assistance') })] })]);
    const s = startWorkout({ opId: 'start-as', owner: profile(), gymId: GYM, routine: r, exercises: new Map([[PULL, exercise(270, 'Assisted pull-up', { compatibleEquipment: ['assisted_stack'], defaultLoadConvention: 'assistance' })]]), gymEquipment: [machine], at: at(0), newId: idGen() }).aggregate;
    const set = s.sets[0];
    if (set === undefined) throw new Error('no set');
    expect(popupCellWrite(s, set.id, 'kg', 70)).toMatchObject({ kind: 'planned', patch: { load: kg(70, 'assistance'), loadAsTyped: true }, note: null });
  });
});

describe('drag drops only on rows Ben can see (parity S2)', () => {
  // A box showing 3 of 6 rows (0–150); rows 4–6 are clipped below it, under the next exercise.
  const frames = Array.from({ length: 6 }, (_, i) => ({ key: `s${String(i + 1)}`, y: i * 50, h: 50 }));
  const box = { y: 0, h: 150 };

  it('rows scrolled out of the box are no drop targets; a finger past its edge lands after the last visible row', () => {
    const seen = visibleFrames(frames, box);
    expect(seen.map((f) => f.key)).toEqual(['s1', 's2', 's3']);
    // A little past the bottom of the box: after Set 3, never before Set 5.
    expect(dropTargetAt(seen, 's1', 210, { allowOnto: false })).toEqual({ key: 's3', edge: 'after' });
    expect(dropTargetAt(frames, 's1', 210, { allowOnto: false })).toEqual({ key: 's5', edge: 'before' });
  });

  it('a row half in view is cut to what shows; scrolled boxes measure from their window', () => {
    const seen = visibleFrames(frames, { y: 25, h: 100 });
    expect(seen).toEqual([
      { key: 's1', y: 25, h: 25 },
      { key: 's2', y: 50, h: 50 },
      { key: 's3', y: 100, h: 25 },
    ]);
    expect(visibleFrames(frames, null)).toEqual(frames);
  });

  it('the round page and the Workout sheet pass their visible window', () => {
    // (Ben, 26 Oct) One scroll per round page: its visible frame is the page's.
    expect(read('screens', 'workout', 'WorkoutTable.tsx')).toContain('viewport={outer}');
    expect(read('screens', 'workout', 'RoundSheets.tsx')).toContain('viewport={listView}');
    expect(read('ui', 'drag-list.tsx')).toContain('visibleFrames([...frames.current.values()], boxWindow.current)');
  });
});

describe('pop-up edits to sets not done yet have Undo (parity S4)', () => {
  it('a pending set’s Kg / Reps / RPE shows `Set N updated · Undo`; rest steps don’t (recorded decision)', () => {
    const src = read('screens', 'workout', 'WorkoutEdits.tsx');
    expect(src).toMatch(/case 'planned': \{[\s\S]{0,600}undoToast\(UNDO_TOAST\.correctedNamed\(row\.spokenName\), opId\)/);
    expect(src).toContain('`set_rest_after` has no `undo_op`');
  });
});
