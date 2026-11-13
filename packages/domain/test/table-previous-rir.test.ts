import { describe, expect, it } from 'vitest';
import type { EquipmentInstance, Exercise, SessionAggregate } from '@fizz/schemas';

import { addWarmupCommand, buildActiveSetView, buildAddExerciseCommand, buildWorkoutTableView, effortRir, lastComparableSession, lastPerSet, NBSP, rirLabel, rirOfRpe, rirWords, rpeOfRir, startWorkout, type DraftEdits, type HistorySession, type PreviousSession, type TableRow } from '../src/index';
import { at, barbell, dumbbells, exercise, GYM, id, idGen, kg, lb, ms, profile, values } from './fixtures';
import { apply, logCmd } from './session-fixture';

/**
 * (Ben, 26 Oct) The active table's PREVIOUS column and RIR cell, in the domain's table view:
 * - PREVIOUS: set n ↔ last time's n-th working set (unchanged rule), and now a `W` row shows last time's warm-up in
 *   the same place, in the same unit and convention, else nothing (rule 6);
 * - RIR replaces RPE in the UI: targets and logged efforts read as RIR = 10 − RPE (8.5 → 1.5), an RIR Ben enters
 *   before logging is his own (full ink) and is logged with the set; warm-ups and timed / cardio sets have none.
 */

const plain = (s: string | null | undefined) => (s ?? '').replaceAll(NBSP, ' ');

function sessionWith(ex: Exercise, eq: EquipmentInstance, unit: 'kg' | 'lb', sets: number, warmups = 0, planned = 100): SessionAggregate {
  const owner = profile({ preferredUnit: unit });
  const ids = idGen(71_000);
  let state = startWorkout({ opId: 'start-p', owner, gymId: GYM, routine: null, exercises: new Map(), gymEquipment: [eq], at: at(0), newId: ids }).aggregate;
  state = apply(state, buildAddExerciseCommand({ opId: 'add-p', owner, exercise: ex, equipmentId: eq.id, at: at(1), newId: ids }));
  const row = state.exercises[0];
  if (row === undefined) throw new Error('no row');
  while (state.sets.filter((s) => s.sessionExerciseId === row.id && s.status !== 'deleted').length < sets) {
    state = apply(state, { type: 'add_set', at: at(2), opId: `add-set-${String(state.sets.length)}`, sessionExerciseId: row.id, newSetId: ids(), setType: null });
  }
  for (const x of state.sets.filter((y) => y.sessionExerciseId === row.id)) state = apply(state, { type: 'edit_planned_set', at: at(3), opId: `plan-${x.id}`, setId: x.id, expectedSetVersion: x.version, patch: { load: unit === 'kg' ? kg(planned, row.loadConvention) : lb(225, row.loadConvention) } });
  for (let i = 0; i < warmups; i += 1) {
    const wu = addWarmupCommand(state, row.id, { opId: `wu-${String(i)}`, at: at(4), newSetId: id(89_000 + i) });
    if (!wu.ok) throw new Error(wu.reason);
    state = apply(state, wu.command);
  }
  return state;
}

const prev = (working: { load: ReturnType<typeof kg> | null; reps: number }[], warmups: { load: ReturnType<typeof kg> | null; reps: number }[] = []): PreviousSession => ({
  sessionId: id(5100),
  performedAtUtc: '2026-10-20T06:00:00.000Z',
  gymId: GYM,
  imported: false,
  sets: working.map((x, index) => ({ index, values: values(x.load, x.reps, { rpe: 8 }) })),
  ...(warmups.length > 0 ? { warmups: warmups.map((x, index) => ({ index, values: values(x.load, x.reps) })) } : {}),
});

const rowsOf = (s: SessionAggregate, previous: Record<string, PreviousSession | null>, edits: DraftEdits | null = null): TableRow[] => {
  const t = buildWorkoutTableView({ aggregate: s, nowMs: ms(10), gymName: 'Main Gym', previous, painFlagged: new Set(), edits });
  return t.blocks.flatMap((b) => (b.kind === 'exercise' ? b.card.rows : b.superset.members.flatMap((m) => m.rows)));
};

const BENCH = exercise(1, 'Bench press');
const bar = barbell({ id: id(710), gymId: GYM });

describe('RIR display helpers (Ben, 26 Oct: RIR replaces RPE in the UI)', () => {
  it('RIR = 10 − RPE; half values stay halves; never below 0', () => {
    expect(rirOfRpe(8)).toBe(2);
    expect(rirOfRpe(8.5)).toBe(1.5);
    expect(rirOfRpe(10)).toBe(0);
    expect(rirOfRpe(10.5)).toBe(0);
    expect(rpeOfRir(1.5)).toBe(8.5);
    expect(rpeOfRir(12)).toBe(1);
  });

  it('a logged effort reads as RIR whichever way it was stored', () => {
    expect(effortRir({ rpe: 9, rir: null })).toBe(1);
    expect(effortRir({ rpe: null, rir: 3 })).toBe(3);
    expect(effortRir({ rpe: null, rir: null })).toBeNull();
    expect(plain(rirLabel({ rpe: 8.5, rir: null }))).toBe('RIR 1.5');
    expect(rirLabel({ rpe: null, rir: null })).toBeNull();
    expect(rirWords(1)).toBe('1 rep in reserve');
    expect(rirWords(2)).toBe('2 reps in reserve');
  });
});

describe('PREVIOUS: warm-ups show their own previous (Ben, 26 Oct)', () => {
  it('W rows match last time’s warm-ups in order; working sets still match working sets', () => {
    const s = sessionWith(BENCH, bar, 'kg', 3, 2);
    const row = s.exercises[0]?.id ?? '';
    const rows = rowsOf(s, { [row]: prev([{ load: kg(100), reps: 8 }, { load: kg(100), reps: 7 }], [{ load: kg(40), reps: 10 }, { load: kg(70), reps: 5 }]) });
    expect(rows.map((r) => [r.setType === 'warmup' ? 'W' : 'S', r.last === null ? '—' : plain(r.last.text)])).toEqual([
      ['W', '40 × 10'],
      ['W', '70 × 5'],
      ['S', '100 × 8'],
      ['S', '100 × 7'],
      ['S', '—'],
    ]);
  });

  it('more warm-ups today than last time: the extra one says — (never the nearest)', () => {
    const s = sessionWith(BENCH, bar, 'kg', 1, 2);
    const row = s.exercises[0]?.id ?? '';
    const rows = rowsOf(s, { [row]: prev([{ load: kg(100), reps: 8 }], [{ load: kg(60), reps: 8 }]) });
    expect(rows.filter((r) => r.setType === 'warmup').map((r) => (r.last === null ? '—' : plain(r.last.text)))).toEqual(['60 × 8', '—']);
  });

  it('no warm-ups last time, or in another unit or convention: — (rule 6)', () => {
    const s = sessionWith(BENCH, bar, 'kg', 1, 1);
    const row = s.exercises[0]?.id ?? '';
    const w = s.sets.find((x) => x.setType === 'warmup')?.id ?? '';
    expect(lastPerSet(s, row, { [row]: prev([{ load: kg(100), reps: 8 }]) }).get(w)).toBeNull();
    expect(lastPerSet(s, row, { [row]: prev([{ load: kg(100), reps: 8 }], [{ load: lb(95), reps: 10 }]) }).get(w)).toBeNull();
  });

  it('lastComparableSession keeps the warm-ups like-for-like (and never lets them into working sets)', () => {
    const ex = s0().exercises[0];
    if (ex === undefined) throw new Error('row');
    const h: HistorySession = {
      sessionId: id(5200),
      performedAtUtc: '2026-10-21T06:00:00.000Z',
      equipmentId: ex.equipmentId ?? null,
      gymId: GYM,
      imported: false,
      sets: [
        { setType: 'warmup', side: null, load: kg(40), reps: 10, rpe: null, rir: null },
        { setType: 'warmup', side: null, load: lb(135), reps: 5, rpe: null, rir: null },
        { setType: 'working', side: null, load: kg(100), reps: 8, rpe: 8, rir: null },
      ],
    };
    const p = lastComparableSession([h], ex);
    expect(p?.sets.map((x) => x.values.reps)).toEqual([8]);
    expect(p?.warmups?.map((x) => [x.values.load?.value, x.values.reps, x.values.rpe])).toEqual([[40, 10, null]]);
  });

  it('per-hand dumbbells read per hand in PREVIOUS (`22.5 × 10`)', () => {
    const DB = exercise(2, 'Dumbbell shoulder press', { compatibleEquipment: ['dumbbells'], defaultLoadConvention: 'per_hand' });
    const s = sessionWith(DB, dumbbells({ id: id(711), gymId: GYM }), 'kg', 2, 0, 20);
    const row = s.exercises[0]?.id ?? '';
    expect(rowsOf(s, { [row]: prev([{ load: kg(22.5, 'per_hand'), reps: 10 }]) }).map((r) => (r.last === null ? '—' : plain(r.last.text)))).toEqual(['22.5 × 10', '—']);
  });

  function s0(): SessionAggregate {
    return sessionWith(BENCH, bar, 'kg', 1);
  }
});

describe('the RIR cell (Ben, 26 Oct)', () => {
  it('a set not done yet shows its target as RIR (dimmed); warm-ups none', () => {
    let s = sessionWith(BENCH, bar, 'kg', 2, 1);
    const working = s.sets.filter((x) => x.setType !== 'warmup' && x.status === 'pending');
    const first = working[0];
    if (first === undefined) throw new Error('set');
    s = apply(s, { type: 'set_target_rpe', at: at(5), opId: 'trpe', expectedVersion: s.session.version, scope: { kind: 'set', setId: first.id }, rpe: 8.5 });
    const rows = rowsOf(s, {});
    expect(rows.find((r) => r.setType === 'warmup')?.rir).toBeNull();
    const r = rows.find((x) => x.setId === first.id);
    expect(r?.rir).toMatchObject({ text: '1.5', value: 1.5, target: true });
    expect(r?.accessibilityLabel).toContain('target 1.5 reps in reserve');
  });

  it('a done set shows what was logged as RIR (an RPE 8 reads 2; an RIR 3 reads 3)', () => {
    let s = sessionWith(BENCH, bar, 'kg', 2);
    const [a, b] = s.sets.filter((x) => x.status === 'pending');
    s = apply(s, logCmd(a?.id ?? '', values(kg(100), 8, { rpe: 8 }), 60));
    s = apply(s, logCmd(b?.id ?? '', values(kg(100), 7, { rir: 3 }), 120));
    const rows = rowsOf(s, {});
    expect(rows.map((r) => [r.state, r.rir?.text ?? null, r.rir?.target ?? null])).toEqual([
      ['done', '2', false],
      ['done', '3', false],
    ]);
  });

  it('an RIR Ben enters before logging is his own (full ink) and is logged with the set; never prefilled from history', () => {
    const s = sessionWith(BENCH, bar, 'kg', 2);
    const open = s.sets.find((x) => x.id === s.session.activeSetId);
    if (open === undefined) throw new Error('open');
    const input = { aggregate: s, nowMs: ms(10), gymName: 'Main Gym', previous: { [s.exercises[0]?.id ?? '']: prev([{ load: kg(100), reps: 8 }]) }, painFlagged: new Set<string>() };
    // History's effort is never prefilled.
    const before = buildActiveSetView({ ...input, edits: null });
    expect(before.focus?.logValues.rir).toBeNull();
    expect(before.focus?.logValues.rpe).toBeNull();
    const draft = before.focus?.draft;
    if (draft === undefined) throw new Error('draft');
    const edits: DraftEdits = { setId: open.id, values: { ...draft, rir: 2 }, setVersion: open.version };
    const after = buildActiveSetView({ ...input, edits });
    expect(after.focus?.logValues.rir).toBe(2);
    expect(rowsOf(s, {}, edits).find((r) => r.setId === open.id)?.rir).toMatchObject({ text: '2', target: false });
    // Logged: it is the set's actual effort.
    const logged = apply(s, logCmd(open.id, after.focus?.logValues ?? values(kg(100), 8), 60));
    expect(logged.sets.find((x) => x.id === open.id)?.actual?.rir).toBe(2);
  });

  it('a saved draft keeps it across a restart (the set’s draft)', () => {
    let s = sessionWith(BENCH, bar, 'kg', 1);
    const open = s.sets.find((x) => x.id === s.session.activeSetId);
    if (open === undefined) throw new Error('open');
    s = apply(s, { type: 'save_draft', at: at(6), setId: open.id, values: { ...values(kg(100), 8), rir: 1 } });
    const v = buildActiveSetView({ aggregate: s, nowMs: ms(10), gymName: 'Main Gym', previous: {}, painFlagged: new Set(), edits: null });
    expect(v.focus?.logValues.rir).toBe(1);
    expect(rowsOf(s, {}).find((r) => r.setId === open.id)?.rir).toMatchObject({ text: '1', target: false });
  });
});
