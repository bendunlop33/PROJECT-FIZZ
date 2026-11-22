import { describe, expect, it } from 'vitest';
import type { EquipmentInstance, Exercise, SessionAggregate } from '@fizz/schemas';

import { addWarmupCommand, buildAddExerciseCommand, buildWorkoutTableView, lastPerSet, NBSP, setLastText, startWorkout, type PreviousSession, type TableRow } from '../src/index';
import { assisted, at, barbell, dumbbells, exercise, GYM, id, idGen, kg, lb, ms, profile, values } from './fixtures';
import { apply, logCmd } from './session-fixture';

/**
 * (Ben, 26 Oct) Last time on every set row: set n shows last time's n-th working set (warm-ups and the other side
 * of a single-side log don't count), `—` when there's none (never the nearest set, never an estimate; rule 6), in
 * the row's own unit and convention (kg/lb, per-hand dumbbells, assisted).
 */

const plain = (s: string | null | undefined) => (s ?? '').replaceAll(NBSP, ' ');

function sessionWith(ex: Exercise, eq: EquipmentInstance, unit: 'kg' | 'lb', sets: number): SessionAggregate {
  const owner = profile({ preferredUnit: unit });
  const ids = idGen(70_000);
  let state = startWorkout({ opId: 'start-e', owner, gymId: GYM, routine: null, exercises: new Map(), gymEquipment: [eq], at: at(0), newId: ids }).aggregate;
  state = apply(state, buildAddExerciseCommand({ opId: 'add-1', owner, exercise: ex, equipmentId: eq.id, at: at(1), newId: ids }));
  const row = state.exercises[0];
  if (row === undefined) throw new Error('no row');
  while (state.sets.filter((s) => s.sessionExerciseId === row.id && s.status !== 'deleted').length < sets) {
    state = apply(state, { type: 'add_set', at: at(2), opId: `add-set-${String(state.sets.length)}`, sessionExerciseId: row.id, newSetId: ids(), setType: null });
  }
  return state;
}

const prevOf = (list: { load: ReturnType<typeof kg> | null; reps: number }[], imported = false): PreviousSession => ({
  sessionId: id(5000),
  performedAtUtc: '2026-10-01T06:00:00.000Z',
  gymId: GYM,
  imported,
  sets: list.map((x, index) => ({ index, values: values(x.load, x.reps, { rpe: 9 }) })),
});

const rowsOf = (s: SessionAggregate, previous: Record<string, PreviousSession | null>): TableRow[] => {
  const t = buildWorkoutTableView({ aggregate: s, nowMs: ms(10), gymName: 'Main Gym', previous, painFlagged: new Set(), edits: null });
  return t.blocks.flatMap((b) => (b.kind === 'exercise' ? b.card.rows : b.superset.members.flatMap((m) => m.rows)));
};

describe('lastPerSet', () => {
  const BENCH = exercise(1, 'Bench press');
  const bar = barbell({ id: id(700), gymId: GYM });

  it('set n gets last time’s n-th working set; an extra set gets none; effort is never copied', () => {
    const s = sessionWith(BENCH, bar, 'kg', 4);
    const row = s.exercises[0]?.id ?? '';
    const rows = rowsOf(s, { [row]: prevOf([{ load: kg(100), reps: 8 }, { load: kg(100), reps: 7 }, { load: kg(95), reps: 8 }]) });
    expect(rows.map((r) => (r.last === null ? '—' : plain(r.last.text)))).toEqual(['100 × 8', '100 × 7', '95 × 8', '—']);
    expect(rows[0]?.last?.values).toMatchObject({ load: kg(100), reps: 8, rpe: null, rir: null });
    expect(rows[0]?.last?.accessibilityLabel).toBe('Last time 100 kilograms, 8 reps');
  });

  it('no comparable history: every row says — (rule 6)', () => {
    const s = sessionWith(BENCH, bar, 'kg', 3);
    expect(rowsOf(s, {}).map((r) => r.last)).toEqual([null, null, null]);
  });

  it('warm-ups have none and don’t shift the numbering', () => {
    let s = sessionWith(BENCH, bar, 'kg', 2);
    const row = s.exercises[0]?.id ?? '';
    for (const x of s.sets.filter((y) => y.sessionExerciseId === row)) s = apply(s, { type: 'edit_planned_set', at: at(3), opId: `plan-${x.id}`, setId: x.id, expectedSetVersion: x.version, patch: { load: kg(100) } });
    const wu = addWarmupCommand(s, row, { opId: 'wu', at: at(3), newSetId: id(88_001) });
    if (!wu.ok) throw new Error(wu.reason);
    s = apply(s, wu.command);
    const map = lastPerSet(s, row, { [row]: prevOf([{ load: kg(100), reps: 8 }, { load: kg(97.5), reps: 8 }]) });
    const sets = s.sets.filter((x) => x.sessionExerciseId === row);
    const warm = sets.find((x) => x.setType === 'warmup');
    expect(map.get(warm?.id ?? '')).toBeNull();
    const working = sets.filter((x) => x.setType !== 'warmup').sort((a, b) => a.index - b.index);
    expect(working.map((x) => plain(map.get(x.id)?.text))).toEqual(['100 × 8', '97.5 × 8']);
  });

  it('lb stays lb; per-hand dumbbells read per hand; assisted reads the assistance', () => {
    const lbBench = sessionWith(BENCH, barbell({ id: id(701), gymId: GYM, unit: 'lb' }), 'lb', 1);
    expect(plain(rowsOf(lbBench, { [lbBench.exercises[0]?.id ?? '']: prevOf([{ load: lb(225), reps: 5 }]) })[0]?.last?.text)).toBe('225 × 5');
    const DB = exercise(2, 'Dumbbell bench press', { compatibleEquipment: ['dumbbells'], defaultLoadConvention: 'per_hand' });
    const db = sessionWith(DB, dumbbells({ id: id(702), gymId: GYM }), 'kg', 1);
    const dbRow = rowsOf(db, { [db.exercises[0]?.id ?? '']: prevOf([{ load: kg(27.5, 'per_hand'), reps: 9 }]) })[0];
    expect(plain(dbRow?.last?.text)).toBe('27.5 × 9');
    expect(dbRow?.last?.accessibilityLabel).toMatch(/27\.5/);
    const PULL = exercise(3, 'Assisted pull-up', { compatibleEquipment: ['assisted_stack'], defaultLoadConvention: 'assistance', movementPattern: 'vertical_pull' });
    const ap = sessionWith(PULL, assisted({ id: id(703), gymId: GYM }), 'kg', 1);
    expect(plain(rowsOf(ap, { [ap.exercises[0]?.id ?? '']: prevOf([{ load: kg(20, 'assistance'), reps: 8 }]) })[0]?.last?.text)).toBe('20 × 8');
  });

  it('a done row keeps its last line (what it was compared with) and FitNotes history reads the same', () => {
    let s = sessionWith(BENCH, bar, 'kg', 2);
    const row = s.exercises[0]?.id ?? '';
    const first = s.sets.filter((x) => x.sessionExerciseId === row).sort((a, b) => a.index - b.index)[0];
    s = apply(s, logCmd(first?.id ?? '', values(kg(102.5), 8), 60));
    const rows = rowsOf(s, { [row]: prevOf([{ load: kg(100), reps: 8 }, { load: kg(100), reps: 7 }], true) });
    expect(rows.map((r) => [r.state, plain(r.last?.text)])).toEqual([
      ['done', '100 × 8'],
      ['open', '100 × 7'],
    ]);
    expect(rows[0]?.last?.imported).toBe(true);
  });

  it('setLastText: bodyweight shows reps only; timed shows the time', () => {
    expect(plain(setLastText(values(null, 12), { measurement: 'reps', loadConvention: 'bodyweight' }, null))).toBe('12');
    expect(plain(setLastText({ load: null, reps: null, durationS: 45 }, { measurement: 'duration', loadConvention: 'bodyweight' }, null))).toBe('0:45');
    expect(plain(setLastText(values(kg(10, 'added'), 8), { measurement: 'reps', loadConvention: 'added' }, null))).toBe('10 × 8');
  });
});
