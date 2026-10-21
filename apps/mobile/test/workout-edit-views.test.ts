import { describe, expect, it } from 'vitest';
import type { Exercise, SessionAggregate } from '@fizz/schemas';
import { buildWorkoutTableView, startWorkout, type ActiveViewInput, type TargetExplanation } from '@fizz/domain';

import { assisted, at, dumbbells, exercise, GYM, id, idGen, kg, lb, ms, profile, routine, routineExercise, template, values } from '../../../packages/domain/test/fixtures';
import { apply, BENCH, FACE, HANG, logCmd, ROW, setsFor, startFixture } from '../../../packages/domain/test/session-fixture';
import { DRAG, dragStep, dropIndex, dropTargetAt, type DragPhase } from '../src/ui/drag-logic';
import { holdMenu, nextField, popupRowActions, typeMenu } from '../src/ui/exercise-popup-model';
import { popupCellWrite, popupRestCommand, rpeNumber, sessionPopupView, whyWeightLines } from '../src/workout/exercise-popup';
import { buildRounds } from '../src/workout/rounds';

/**
 * workout-table-v3 §7 "Same editing as the builder": the shared pieces' rules
 * (press-and-hold drag, the pop-up's row actions and menus) and the active
 * workout's pop-up view over real domain state (kg/lb, per-hand dumbbells,
 * assisted machines, supersets, done sets).
 */

const input = (aggregate: SessionAggregate, seconds = 10): ActiveViewInput => ({ aggregate, nowMs: ms(seconds), gymName: 'Main Gym', previous: {}, painFlagged: new Set(), edits: null });
const exOf = (s: SessionAggregate, exerciseId: string) => {
  const rounds = buildRounds(buildWorkoutTableView(input(s)), () => null);
  const rowId = s.exercises.find((e) => e.exerciseId === exerciseId)?.id;
  const e = rounds.flatMap((r) => r.exercises).find((x) => x.sessionExerciseId === rowId);
  if (e === undefined) throw new Error('no exercise');
  return e;
};
const popup = (s: SessionAggregate, exerciseId: string) => {
  const v = sessionPopupView({ aggregate: s, exercise: exOf(s, exerciseId), works: 'Chest, front delts, triceps', mayHurt: false });
  if (v === null) throw new Error('no pop-up');
  return v;
};

describe('press-and-hold drag (shared; builder §2.3, Q18)', () => {
  const down = (atMs = 0): DragPhase => dragStep({ kind: 'idle' }, { kind: 'down', key: 'a', x: 100, y: 100, atMs }).phase;

  it('a still hold of 320 ms arms it; a finger that moves 8 pt first is a scroll or swipe, never a drag', () => {
    expect(DRAG.holdMs).toBe(320);
    const early = dragStep(down(), { kind: 'hold', atMs: 200, draggable: true });
    expect(early.phase.kind).toBe('pressing');
    const armed = dragStep(down(), { kind: 'hold', atMs: 320, draggable: true });
    expect(armed.effect).toEqual({ kind: 'armed', key: 'a' });
    const scrolled = dragStep(down(), { kind: 'move', x: 100, y: 110 });
    expect(scrolled.phase.kind).toBe('idle');
    expect(dragStep(scrolled.phase, { kind: 'hold', atMs: 400, draggable: true }).phase.kind).toBe('idle');
    // A small wobble keeps the press.
    expect(dragStep(down(), { kind: 'move', x: 103, y: 104 }).phase.kind).toBe('pressing');
  });

  it('held then released without moving opens the menu (the fallback); held then moved drops where the finger lifts', () => {
    const armed = dragStep(down(), { kind: 'hold', atMs: 400, draggable: true }).phase;
    expect(dragStep(armed, { kind: 'up' }).effect).toEqual({ kind: 'menu', key: 'a' });
    const moving = dragStep(armed, { kind: 'move', x: 100, y: 160 }).phase;
    expect(moving.kind).toBe('dragging');
    const further = dragStep(moving, { kind: 'move', x: 100, y: 190 }).phase;
    expect(dragStep(further, { kind: 'up' }).effect).toEqual({ kind: 'drop', key: 'a', y: 190 });
    expect(dragStep(further, { kind: 'cancel' }).effect).toEqual({ kind: 'cancelled' });
  });

  it('a row that can’t move (a done set, a started round) only opens its menu: moving after the hold cancels', () => {
    const armed = dragStep(down(), { kind: 'hold', atMs: 400, draggable: false }).phase;
    expect(dragStep(armed, { kind: 'up' }).effect).toEqual({ kind: 'menu', key: 'a' });
    const moved = dragStep(armed, { kind: 'move', x: 100, y: 140 });
    expect(moved.effect).toEqual({ kind: 'cancelled' });
    expect(moved.phase.kind).toBe('idle');
  });

  it('a drop lands before or after the row under the finger, onto its middle when pairing is allowed; never on itself', () => {
    const frames = [
      { key: 'a', y: 0, h: 50 },
      { key: 'b', y: 50, h: 50 },
      { key: 'c', y: 100, h: 50 },
    ];
    expect(dropTargetAt(frames, 'a', 60, { allowOnto: true })).toEqual({ key: 'b', edge: 'before' });
    expect(dropTargetAt(frames, 'a', 75, { allowOnto: true })).toEqual({ key: 'b', edge: 'onto' });
    expect(dropTargetAt(frames, 'a', 95, { allowOnto: true })).toEqual({ key: 'b', edge: 'after' });
    expect(dropTargetAt(frames, 'a', 75, { allowOnto: false })).toEqual({ key: 'b', edge: 'after' });
    expect(dropTargetAt(frames, 'a', 20, { allowOnto: true })).toBeNull();
    expect(dropTargetAt(frames, 'b', -30, { allowOnto: true })).toEqual({ key: 'a', edge: 'before' });
    expect(dropTargetAt(frames, 'a', 400, { allowOnto: true })).toEqual({ key: 'c', edge: 'after' });
    // The page refuses (a done set, a started round): springs back.
    expect(dropTargetAt(frames, 'c', 10, { allowOnto: false, canDrop: (t) => t.key !== 'a' })).toBeNull();
  });

  it('dropIndex: the dragged row’s new place, null when nothing changes', () => {
    const keys = ['a', 'b', 'c', 'd'];
    expect(dropIndex(keys, 'd', { key: 'a', edge: 'before' })).toBe(0);
    expect(dropIndex(keys, 'a', { key: 'c', edge: 'after' })).toBe(2);
    expect(dropIndex(keys, 'b', { key: 'a', edge: 'after' })).toBeNull();
    expect(dropIndex(keys, 'b', { key: 'c', edge: 'onto' })).toBeNull();
  });
});

describe('pop-up row actions and menus (shared)', () => {
  it('VoiceOver actions and the long-press menu: Change type, Move up/down where possible, Delete', () => {
    const acts = popupRowActions({ canDelete: true, canMoveUp: false, canMoveDown: true });
    expect(acts.map((a) => a.label)).toEqual(['Change type', 'Move down', 'Delete set']);
    const m = holdMenu(acts);
    expect(m.options).toEqual(['Change type', 'Move down', 'Delete set', 'Cancel']);
    expect(m.destructiveButtonIndex).toEqual([2]);
    expect(m.actionAt(1)).toBe('move_down');
    expect(m.actionAt(3)).toBeNull();
  });

  it('the Type picker lists every type with the current one ticked; picking it again changes nothing', () => {
    const m = typeMenu('backoff');
    expect(m.options).toEqual(['Warm-up', 'Working', 'Top set', 'Back-off ✓', 'Drop', 'Cancel']);
    expect(m.typeAt(2)).toBe('top');
    expect(m.typeAt(3)).toBeNull();
    expect(m.typeAt(5)).toBeNull();
  });

  it('Next goes Reps → Kg → RPE → next set, skipping RPE on a warm-up', () => {
    expect(nextField(0, 'kg', 3, (i) => i > 0)).toEqual({ row: 1, field: 'reps' });
    expect(nextField(1, 'kg', 3, (i) => i > 0)).toEqual({ row: 1, field: 'rpe' });
    expect(nextField(2, 'rpe', 3, () => true)).toBeNull();
  });
});

describe('the workout’s exercise pop-up (sessionPopupView)', () => {
  it('bench: W then numbered sets with types, kg header, target RPE, rest per type; Move and Superset with next from the rules', () => {
    const s = startFixture().state;
    const v = popup(s, BENCH);
    expect(v.name).toBe('Bench press');
    expect(v.kgHeader).toBe('Kg');
    expect(v.rows.map((r) => [r.mark, r.typeText, r.repsText, r.kgText, r.done])).toEqual([
      ['W', 'Warm-up', '10', '60', false],
      ['1', 'Working', '6–8', '100', false],
      ['2', 'Working', '6–8', '100', false],
    ]);
    expect(v.rows[0]?.noRpe).toBe(true);
    expect(v.rests.map((r) => [r.label, r.text])).toEqual([
      ['Warm-ups', '1:00'],
      ['Working sets', '3:00'],
    ]);
    expect([v.canMoveUp, v.canMoveDown, v.canSupersetNext, v.canUnlink, v.canSwap]).toEqual([false, true, true, false, true]);
    expect(v.deleteLabel).toBe('Remove');
    expect(v.canAddWarmup).toBe(true);
    // Sets not done yet move; the first can't go up.
    expect(v.rows.map((r) => [r.canMoveUp, r.canMoveDown])).toEqual([
      [false, true],
      [true, true],
      [true, false],
    ]);
  });

  it('done sets show what was logged (green, a correction), can’t move; the round can’t move once started', () => {
    let s = startFixture().state;
    const [w, b1] = setsFor(s, BENCH);
    s = apply(s, logCmd(w?.id ?? '', values(kg(60), 10, { rpe: null }), 60));
    s = apply(s, logCmd(b1?.id ?? '', values(kg(97.5), 7, { rpe: 9 }), 300));
    const v = popup(s, BENCH);
    expect(v.rows.map((r) => [r.mark, r.repsText, r.load, r.rpe, r.done, r.draggable])).toEqual([
      ['W', '10', 60, null, true, false],
      ['1', '7', 97.5, 9, true, false],
      ['2', '6–8', 100, null, false, false],
    ]);
    expect(v.rows[1]?.accessibilityLabel).toContain('RPE 9');
    expect(v.rows[1]?.accessibilityLabel).toContain('done');
    expect([v.canMoveUp, v.canMoveDown]).toEqual([false, false]);
  });

  it('a superset member has one rest, After each round (the last member’s), and Unlink', () => {
    const s = startFixture().state;
    const row = popup(s, ROW);
    const face = popup(s, FACE);
    expect(row.rests.map((r) => r.label)).toEqual(['After each round']);
    expect(row.rests[0]?.seconds).toBe(face.rests[0]?.seconds);
    expect(row.canUnlink).toBe(true);
    expect(row.kgHeader).toBe('Kg');
  });

  it('timed sets show their time in the Reps cell and aren’t typed there; a done exercise has no Swap', () => {
    let s = startFixture().state;
    const v = popup(s, HANG);
    expect(v.rows[0]?.reps).toBeNull();
    expect(v.rows[0]?.editable).toBe(false);
    for (const x of setsFor(s, HANG)) s = apply(s, logCmd(x.id, values(null, null, { durationS: 45 }), 500));
    expect(popup(s, HANG).canSwap).toBe(false);
  });

  it('per-hand dumbbells in lb and an assisted machine keep their unit and convention in the header and cells', () => {
    const CURL = id(270);
    const PULL = id(271);
    const exs = new Map<string, Exercise>([
      [CURL, exercise(270, 'Dumbbell curl', { compatibleEquipment: ['dumbbells'], defaultLoadConvention: 'per_hand' })],
      [PULL, exercise(271, 'Assisted pull-up', { compatibleEquipment: ['assisted_stack'], defaultLoadConvention: 'assistance' })],
    ]);
    const rack = dumbbells({ unit: 'lb', loads: [10, 15, 20, 25, 30, 35] });
    const machine = assisted();
    const r = routine([
      routineExercise(700, { exerciseId: CURL, equipmentId: rack.id, order: 0, setTemplates: [template(7001, { targetLoad: lb(25, 'per_hand'), targetReps: { min: 8, max: 12 } })] }),
      routineExercise(701, { exerciseId: PULL, equipmentId: machine.id, order: 1, setTemplates: [template(7011, { targetLoad: kg(25, 'assistance') })] }),
    ]);
    const s = startWorkout({ opId: 'start-pp', owner: profile({ preferredUnit: 'lb' }), gymId: GYM, routine: r, exercises: exs, gymEquipment: [rack, machine], at: at(0), newId: idGen() }).aggregate;
    const curl = popup(s, CURL);
    expect(curl.kgHeader).toBe('Lb each');
    expect(curl.rows[0]?.kgText).toBe('25 each');
    expect(curl.rows[0]?.accessibilityLabel).toContain('25 pounds each');
    const pull = popup(s, PULL);
    expect(pull.kgHeader).toBe('Kg assist');
    expect(pull.rows[0]?.kgText).toBe('25 assist');
    // No warm-up ramp on an assisted machine (the builder's rule).
    expect(pull.canAddWarmup).toBe(false);
  });

  it('rpeNumber reads the RPE cell: a target, a logged value, never RIR', () => {
    expect(rpeNumber('@9')).toBe(9);
    expect(rpeNumber('8.5')).toBe(8.5);
    expect(rpeNumber('RIR 2')).toBeNull();
    expect(rpeNumber(null)).toBeNull();
  });

  it('Why this weight? reads the stored provenance; Not recorded rather than a guess', () => {
    const exp: TargetExplanation = { setId: 'x', setVersion: 1, recorded: true, basisEdited: null, rows: [{ key: 'set_by', label: 'Set by', lines: ['Built-in progression'], kind: 'app' }, { key: 'last_time', label: 'Last time', lines: ['1 Oct · 100 × 8, 8, 7', 'RPE 8'], kind: 'actual' }] };
    expect(whyWeightLines(exp)).toEqual(['Set by: Built-in progression', 'Last time: 1 Oct · 100 × 8, 8, 7', 'RPE 8']);
    expect(whyWeightLines({ ...exp, recorded: false, rows: [] })).toEqual(['Not recorded']);
    expect(whyWeightLines(null)).toEqual([]);
  });
});

describe('pop-up edits as the workout’s own writes', () => {
  it('a set not done yet: exact reps, a kg rounded toward easier on the bar (said so), a target RPE; never on a warm-up', () => {
    const s = startFixture().state;
    const [w, b1] = setsFor(s, BENCH);
    expect(popupCellWrite(s, b1?.id ?? '', 'reps', 7)).toMatchObject({ kind: 'planned', patch: { reps: { min: 7, max: 7 } } });
    // 21 Oct (R4): rounded back onto the row's own 100 is no change: said where Ben typed, never `updated · Undo`.
    expect(popupCellWrite(s, b1?.id ?? '', 'kg', 101)).toEqual({ kind: 'unchanged', note: 'Nearest here: 100 kg' });
    expect(popupCellWrite(s, b1?.id ?? '', 'kg', 100)).toEqual({ kind: 'unchanged', note: null });
    expect(popupCellWrite(s, b1?.id ?? '', 'kg', 103)).toMatchObject({ kind: 'planned', patch: { load: kg(102.5) }, note: 'Rounded to 102.5 kg' });
    expect(popupCellWrite(s, b1?.id ?? '', 'kg', 102.5)).toMatchObject({ kind: 'planned', note: null });
    expect(popupCellWrite(s, b1?.id ?? '', 'kg', 5)).toEqual({ kind: 'refused', text: 'Lighter than this gym can load' });
    expect(popupCellWrite(s, b1?.id ?? '', 'rpe', 9)).toMatchObject({ kind: 'planned', patch: { targetRpe: 9 } });
    expect(popupCellWrite(s, w?.id ?? '', 'rpe', 9)).toEqual({ kind: 'refused', text: 'Warm-ups have no target effort' });
    expect(popupCellWrite(s, b1?.id ?? '', 'rpe', 9.3)).toEqual({ kind: 'refused', text: 'RPE 1–10' });
    expect(popupCellWrite(s, b1?.id ?? '', 'reps', 0)).toEqual({ kind: 'refused', text: 'Reps 1–100' });
  });

  it('21 Oct: a row with Ben’s own draft shows it in the pop-up; typing the preset back is a real write that clears it', () => {
    let s = startFixture().state;
    const [, b1, b2] = setsFor(s, BENCH);
    s = apply(s, { type: 'save_draft', at: at(20), setId: b1?.id ?? '', values: values(kg(105), 7) });
    const rows = popup(s, BENCH).rows;
    expect(rows.find((r) => r.key === b1?.id)).toMatchObject({ load: 105, reps: 7, repsText: '7' });
    expect(rows.find((r) => r.key === b2?.id)).toMatchObject({ load: 100, repsText: '6–8' });
    // The table's round page agrees (one source).
    expect(exOf(s, BENCH).rows.find((r) => r.setId === b1?.id)?.row.cells.load).toBe('105');
    const w = popupCellWrite(s, b1?.id ?? '', 'kg', 101);
    expect(w).toMatchObject({ kind: 'planned', patch: { load: kg(100) }, note: 'Rounded to 100 kg' });
    expect(popupCellWrite(s, b1?.id ?? '', 'reps', 8)).toMatchObject({ kind: 'planned' });
    const after = apply(s, { type: 'edit_planned_set', at: at(30), opId: 'pop-1', setId: b1?.id ?? '', expectedSetVersion: w.kind === 'planned' ? w.expectedSetVersion : 0, patch: { load: kg(100) } });
    expect(popup(after, BENCH).rows.find((r) => r.key === b1?.id)).toMatchObject({ load: 100 });
    // Reps already exactly the target: nothing to write.
    const exact = apply(after, { type: 'edit_planned_set', at: at(31), opId: 'pop-2', setId: b1?.id ?? '', expectedSetVersion: after.sets.find((x) => x.id === b1?.id)?.version ?? 0, patch: { reps: { min: 8, max: 8 } } });
    expect(popupCellWrite(exact, b1?.id ?? '', 'reps', 8)).toEqual({ kind: 'unchanged', note: null });
  });

  it('a logged set: a correction of what was done, versioned on the set, never rounded (rule 2)', () => {
    let s = startFixture().state;
    const [w] = setsFor(s, BENCH);
    s = apply(s, logCmd(w?.id ?? '', values(kg(60), 10), 60));
    const set = s.sets.find((x) => x.id === w?.id);
    expect(popupCellWrite(s, w?.id ?? '', 'kg', 61)).toEqual({ kind: 'correct', setId: w?.id, expectedSetVersion: set?.version, patch: { load: kg(61) } });
    expect(popupCellWrite(s, w?.id ?? '', 'reps', 9)).toMatchObject({ kind: 'correct', patch: { reps: 9 } });
  });

  it('rest steppers send 15 s steps by set type, within the builder’s limits; a superset’s After each round', () => {
    const s = startFixture().state;
    const bench = s.exercises.find((e) => e.exerciseId === BENCH)?.id ?? '';
    const cmd = popupRestCommand(s, bench, { kind: 'working', seconds: 180 }, -1, { opId: 'r1', at: at(10) });
    expect(cmd).toMatchObject({ type: 'set_rest_after', seconds: 165, scope: 'type' });
    expect(popupRestCommand(s, bench, { kind: 'working', seconds: 360 }, 1, { opId: 'r2', at: at(10) })).toBeNull();
    const row = s.exercises.find((e) => e.exerciseId === ROW)?.id ?? '';
    expect(popupRestCommand(s, row, { kind: 'round', seconds: 90 }, 1, { opId: 'r3', at: at(10) })).toMatchObject({ seconds: 105, scope: 'round' });
  });
});

