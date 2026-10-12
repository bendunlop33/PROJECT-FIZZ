import { describe, expect, it } from 'vitest';
import type { EquipmentInstance, Exercise, SessionAggregate } from '@fizz/schemas';

import {
  buildActiveSetView,
  buildAddExerciseCommand,
  buildWorkoutTableView,
  NBSP,
  startWorkout,
  tableLogLabel,
  type ActiveViewInput,
  type TableBlock,
  type TableCard,
  type TableRow,
  type WorkoutTableView,
} from '../src/index';
import { assisted, at, barbell, bodyweightStation, dumbbells, exercise, GYM, id, idGen, kg, lb, ms, plateMachine, profile, stack, values } from './fixtures';
import { apply, logCmd, setsFor, startFixture, BENCH, FACE, HANG, ROW } from './session-fixture';

/**
 * The workout Table view (active-workout §2A.12): one list of the whole
 * session, built from the same input and rows as the Focus card. These are
 * the pure checks behind WT1–WT4, WT8, WT15, WT16, WT30–WT33 and WT41.
 */

const plain = (s: string | null | undefined) => (s ?? '').replaceAll(NBSP, ' ');

function input(aggregate: SessionAggregate, over: Partial<ActiveViewInput> = {}): ActiveViewInput {
  return { aggregate, nowMs: ms(10), gymName: 'Main Gym', previous: {}, painFlagged: new Set(), edits: null, ...over };
}
const table = (s: SessionAggregate, over: Partial<ActiveViewInput> = {}): WorkoutTableView => buildWorkoutTableView(input(s, over));

function card(b: TableBlock | undefined): TableCard {
  if (b?.kind !== 'exercise') throw new Error(`not an exercise block: ${String(b?.kind)}`);
  return b.card;
}
const cells = (rows: readonly TableRow[]) => rows.map((r) => [r.state, r.badges.join(''), r.cells.load, plain(r.cells.value), r.effort === null ? null : plain(r.effort)]);

function emptyWith(ex: Exercise, eq: EquipmentInstance | null, unit: 'kg' | 'lb' = 'kg'): SessionAggregate {
  const owner = profile({ preferredUnit: unit });
  const ids = idGen(70_000);
  let state = startWorkout({ opId: 'start-e', owner, gymId: GYM, routine: null, exercises: new Map(), gymEquipment: eq ? [eq] : [], at: at(0), newId: ids }).aggregate;
  state = apply(state, buildAddExerciseCommand({ opId: 'add-1', owner, exercise: ex, equipmentId: eq?.id ?? null, at: at(1), newId: ids }));
  return state;
}

/** Table and Focus agree on the open row and the Log values (WT41). */
function expectAgreement(s: SessionAggregate, over: Partial<ActiveViewInput> = {}): void {
  const t = table(s, over);
  const v = buildActiveSetView(input(s, over));
  expect(t.anchor?.setId ?? null).toBe(v.focus?.setId ?? null);
  const pill = tableLogLabel(v.primary, t.log, { offscreen: false });
  if (v.primary.kind === 'log') expect(pill.label.endsWith(v.primary.label) || pill.label.includes(`${v.primary.label} →`)).toBe(true);
  const open = t.blocks.flatMap((b) => (b.kind === 'exercise' ? b.card.rows : b.superset.rounds.flatMap((r) => r.rows))).filter((r) => r.state === 'open');
  expect(open.map((r) => r.setId)).toEqual(v.focus ? [v.focus.setId] : []);
}

describe('buildWorkoutTableView: a fresh planned workout (WT1)', () => {
  it('opens on set 1 of the first exercise, nothing done, blocks in session order', () => {
    const { state } = startFixture();
    const t = table(state);
    expect(t.doneCount).toBe(0);
    expect(t.empty).toBe(false);
    expect(t.allDone).toBe(false);
    expect(t.blocks.map((b) => [b.kind, b.folded === null])).toEqual([
      ['exercise', true],
      ['superset', true],
      ['exercise', true],
    ]);
    const bench = card(t.blocks[0]);
    expect(t.anchor).toEqual({ blockKey: bench.key, sessionExerciseId: bench.sessionExerciseId, setId: setsFor(state, BENCH)[0]?.id });
    expect(bench.isCurrent).toBe(true);
    expect(bench.columns).toEqual({ kind: 'load_reps', loadLabel: 'KG', valueLabel: 'REPS' });
    expect(plain(bench.subtitle)).toBe('Barbell · No previous result');
    expect(bench.progressText).toBe('0/3');
    expect(cells(bench.rows)).toEqual([
      ['open', 'W', '60', '10', null],
      ['pending', '', '100', '6–8', null],
      ['pending', '', '100', '6–8', null],
    ]);
    const v = buildActiveSetView(input(state));
    expect(plain(tableLogLabel(v.primary, t.log, { offscreen: false }).label)).toBe('Set 1 · Log 60 kg × 10');
    expectAgreement(state);
  });

  it('pending rows read as targets and the open row as current (WT15)', () => {
    const { state } = startFixture();
    const bench = card(table(state).blocks[0]);
    expect(bench.rows[0]?.accessibilityLabel).toBe('Set 1, warm-up, current');
    expect(bench.rows[1]?.accessibilityLabel).toMatch(/^Set 2, target 100 kilograms, 6 to 8 reps/);
    expect(bench.rows[1]?.blockTitle).toBe('Set 2');
    expect(plain(bench.rows[1]?.blockValue)).toMatch(/^Target 100 kg · 6–8 reps/);
  });
});

describe('after logging (WT2–WT4, WT8, WT15, WT16)', () => {
  function benchDone() {
    const { state } = startFixture();
    const [w, b1, b2] = setsFor(state, BENCH);
    let s = apply(state, logCmd(w?.id ?? '', values(kg(60), 10), 5));
    s = apply(s, logCmd(b1?.id ?? '', values(kg(100), 8, { rpe: 8 }), 200));
    return { s, b2 };
  }

  it('done rows are bright actual values with effort, never a range; the anchor moves on', () => {
    const { s, b2 } = benchDone();
    const t = table(s, { nowMs: ms(210) });
    expect(t.doneCount).toBe(2);
    const bench = card(t.blocks[0]);
    expect(cells(bench.rows)).toEqual([
      ['done', 'W', '60', '10', null],
      ['done', '', '100', '8', 'RPE 8'],
      ['open', '', '100', '6–8', null],
    ]);
    for (const r of bench.rows.filter((x) => x.state === 'done')) expect(r.cells.value).not.toMatch(/–/);
    expect(bench.rows[1]?.accessibilityLabel).toBe('Set 2, done, 100 kilograms, 8 reps, RPE 8');
    expect(bench.rows[1]?.blockTitle).toBe('Set 2 · done');
    expect(plain(bench.rows[1]?.blockValue)).toBe('100 kg × 8 · RPE 8');
    expect(t.anchor?.setId).toBe(b2?.id);
    expect(bench.progressText).toBe('2/3');
    expect(t.blocks[0]?.folded).toBeNull();
    expectAgreement(s, { nowMs: ms(210) });
  });

  it('the last set of an exercise folds it to its actual results, and the next card holds the anchor (WT4)', () => {
    const { s, b2 } = benchDone();
    const s2 = apply(s, logCmd(b2?.id ?? '', values(kg(100), 7), 400));
    const t = table(s2, { nowMs: ms(410) });
    expect(t.doneCount).toBe(3);
    expect(t.blocks[0]?.folded).toMatchObject({ name: 'Bench press', skipped: false });
    expect(plain(t.blocks[0]?.folded?.summary)).toBe('100 × 8, 7');
    expect(t.blocks[0]?.folded?.accessibilityLabel).toBe('Bench press, done, 100 for 8, 7. Expands.');
    const ss = t.blocks[1];
    expect(ss?.kind).toBe('superset');
    expect(t.anchor?.blockKey).toBe(ss?.key);
    expectAgreement(s2, { nowMs: ms(410) });
  });

  it('doneCount counts warm-ups and leaves out skipped and deleted sets (WT8)', () => {
    const { s, b2 } = benchDone();
    const deleted = apply(s, { type: 'delete_set', at: at(300), opId: 'del-1', setId: b2?.id ?? '', expectedSetVersion: s.sets.find((x) => x.id === b2?.id)?.version ?? 1 });
    expect(table(deleted, { nowMs: ms(310) }).doneCount).toBe(2);
    const rowEx = setsFor(s, ROW)[0]?.sessionExerciseId ?? '';
    const skipped = apply(s, { type: 'skip_exercise', at: at(300), opId: 'skip-row', sessionExerciseId: rowEx });
    const t = table(skipped, { nowMs: ms(310) });
    expect(t.doneCount).toBe(2);
  });
});

describe('supersets in round order (WT33)', () => {
  it('rows group under ROUND n in lifting order; A1 logs into A2 with no rest', () => {
    const { state } = startFixture();
    const [w, b1, b2] = setsFor(state, BENCH);
    let s = apply(state, logCmd(w?.id ?? '', values(kg(60), 10), 5));
    s = apply(s, logCmd(b1?.id ?? '', values(kg(100), 8), 200));
    s = apply(s, logCmd(b2?.id ?? '', values(kg(100), 8), 400));
    const t = table(s, { nowMs: ms(410) });
    const b = t.blocks[1];
    if (b?.kind !== 'superset') throw new Error('superset');
    const ss = b.superset;
    expect(ss.label).toBe('Superset A');
    expect(ss.roundText).toBe('Round 1 of 2');
    expect(ss.members.map((m) => [m.tag, m.name, m.unitCaption])).toEqual([
      ['A1', 'Cable row', 'kg stack'],
      ['A2', 'Face pull', 'kg stack'],
    ]);
    const [r1, r2] = setsFor(s, ROW);
    const [f1, f2] = setsFor(s, FACE);
    expect(ss.rounds.map((r) => [r.n, r.rows.map((x) => x.setId)])).toEqual([
      [1, [r1?.id, f1?.id]],
      [2, [r2?.id, f2?.id]],
    ]);
    expect(ss.rounds[0]?.rows.map((x) => [x.memberTag, x.state])).toEqual([
      ['A1', 'open'],
      ['A2', 'pending'],
    ]);
    const v = buildActiveSetView(input(s, { nowMs: ms(410) }));
    expect(plain(tableLogLabel(v.primary, t.log, { offscreen: false }).label)).toMatch(/^A1 · Log 50 kg stack × \d+ → A2$/);

    // A1 logged: A2 is open in the same round, with no rest; its Log has no arrow (A2 ends the round).
    const s2 = apply(s, logCmd(r1?.id ?? '', values(kg(50, 'stack'), 12), 500));
    const t2 = table(s2, { nowMs: ms(501) });
    expect(t2.anchor?.setId).toBe(f1?.id);
    const v2 = buildActiveSetView(input(s2, { nowMs: ms(501) }));
    expect(v2.rest?.kind).not.toBe('running');
    expect(plain(tableLogLabel(v2.primary, t2.log, { offscreen: false }).label)).toMatch(/^A2 · Log 20 kg stack × \d+$/);
    expectAgreement(s2, { nowMs: ms(501) });
  });
});

describe('every set kind has a row (WT30–WT32, WT41)', () => {
  it('timed bodyweight: TIME only; the pill reads Start', () => {
    const { state } = startFixture();
    const hangSet = setsFor(state, HANG)[0]?.id ?? '';
    const s = apply(state, { type: 'set_active_set', at: at(3), opId: 'a-hang', setId: hangSet, expectedVersion: state.session.version });
    const t = table(s);
    const hang = card(t.blocks[2]);
    expect(hang.columns).toEqual({ kind: 'time', loadLabel: null, valueLabel: 'TIME' });
    expect(cells(hang.rows)).toEqual([['open', '', null, '0:45', null]]);
    const v = buildActiveSetView(input(s));
    expect(plain(tableLogLabel(v.primary, t.log, { offscreen: false }).label)).toBe('Set 1 · Start 0:45');
    const logged = apply(s, logCmd(hangSet, values(null, null, { durationS: 38 }), 60));
    const done = card(table(logged, { nowMs: ms(61) }).blocks[2]);
    expect(cells(done.rows)).toEqual([['done', '', null, '0:38', null]]);
    expect(done.rows[0]?.accessibilityLabel).toBe('Set 1, done, 38 seconds');
  });

  it('per-hand dumbbells, lb, stack, assisted, bodyweight, added and plate-loaded keep their convention in the label, numbers in the cells', () => {
    const cases: [Exercise, EquipmentInstance | null, 'kg' | 'lb', string | null, string, string][] = [
      [exercise(210, 'Dumbbell press', { compatibleEquipment: ['dumbbells'], defaultLoadConvention: 'per_hand' }), dumbbells(), 'kg', 'KG', 'Dumbbells · kg each', '22.5'],
      [exercise(211, 'Dumbbell press', { compatibleEquipment: ['dumbbells'], defaultLoadConvention: 'per_hand' }), dumbbells({ unit: 'lb', loads: [10, 20, 45, 50] }), 'lb', 'LB', 'Dumbbells · lb each', '45'],
      [exercise(213, 'Cable row', { compatibleEquipment: ['weight_stack'], defaultLoadConvention: 'stack' }), stack(), 'kg', 'KG', 'Cable / stack · kg stack', '45'],
      [exercise(212, 'Assisted pull-up', { compatibleEquipment: ['assisted_stack'], defaultLoadConvention: 'assistance' }), assisted(), 'kg', 'ASSIST KG', 'Assisted machine · kg assist', '20'],
      [exercise(214, 'Dip', { compatibleEquipment: ['bodyweight_station'], defaultLoadConvention: 'bodyweight' }), bodyweightStation(), 'kg', null, 'Bodyweight', '—'],
      [exercise(217, 'Weighted dip', { compatibleEquipment: [], defaultLoadConvention: 'added' }), null, 'kg', '+KG', '', '10'],
      [exercise(218, 'Leg press', { compatibleEquipment: ['plate_loaded_machine'], defaultLoadConvention: 'added' }), plateMachine(), 'kg', 'KG', 'Plate-loaded machine', '80'],
    ];
    for (const [ex, eq, unit, loadLabel, header, value] of cases) {
      const s = emptyWith(ex, eq, unit);
      const t = table(s);
      const c = card(t.blocks[0]);
      expect(c.columns.loadLabel, ex.name).toBe(loadLabel);
      expect(plain(c.headerLine), ex.name).toBe(header);
      const setId = t.anchor?.setId ?? '';
      const v = buildActiveSetView(input(s));
      const f = v.focus;
      if (!f) throw new Error('focus');
      const n = Number(value);
      const load = ex.defaultLoadConvention === 'bodyweight' ? null : unit === 'lb' ? lb(n, ex.defaultLoadConvention) : kg(n, ex.defaultLoadConvention);
      const edited = buildActiveSetView(input(s, { edits: { setId, values: values(load, 8) } }));
      const done = apply(s, logCmd(setId, edited.focus?.logValues ?? values(load, 8), 30));
      const row = card(table(done, { nowMs: ms(31) }).blocks[0]).rows[0];
      expect(row?.state, ex.name).toBe('done');
      expect(row?.cells, ex.name).toEqual({ load: loadLabel === null ? null : value, value: '8' });
      expectAgreement(s, { edits: { setId, values: values(load, 8) } });
    }
  });

  it('assisted reads its assistance, never a bare load, to VoiceOver', () => {
    const s = emptyWith(exercise(212, 'Assisted pull-up', { compatibleEquipment: ['assisted_stack'], defaultLoadConvention: 'assistance' }), assisted());
    const setId = table(s).anchor?.setId ?? '';
    const done = apply(s, logCmd(setId, values(kg(20, 'assistance'), 6), 30));
    expect(card(table(done, { nowMs: ms(31) }).blocks[0]).rows[0]?.accessibilityLabel).toBe('Set 1, done, 20 kilograms of assistance, 6 reps');
  });

  it('distance: DIST column, metres in the cell', () => {
    const sled = exercise(231, 'Sled push', { measurement: 'distance', compatibleEquipment: [], defaultLoadConvention: 'added' });
    const s = emptyWith(sled, null);
    const c = card(table(s).blocks[0]);
    expect(c.columns).toEqual({ kind: 'load_distance', loadLabel: '+KG', valueLabel: 'DIST' });
    const setId = table(s).anchor?.setId ?? '';
    const done = apply(s, logCmd(setId, values(kg(40, 'added'), null, { distanceM: 20 }), 30));
    expect(cells(card(table(done, { nowMs: ms(31) }).blocks[0]).rows)).toEqual([['done', '', '40', '20 m', null]]);
  });

  it('unilateral: a Left log auto-advances to the fixed Right row; rows carry L and R', () => {
    const split = exercise(215, 'Split squat', { compatibleEquipment: ['dumbbells'], defaultLoadConvention: 'per_hand', laterality: 'unilateral' });
    const s = emptyWith(split, dumbbells());
    const setId = table(s).anchor?.setId ?? '';
    expect(plain(card(table(s).blocks[0]).headerLine)).toBe('Dumbbells · kg each · per side');
    const after = apply(s, logCmd(setId, values(kg(15, 'per_hand'), 10), 5, 'op-left', 'left'));
    const t = table(after, { nowMs: ms(6) });
    const c = card(t.blocks[0]);
    expect(c.rows.map((r) => [r.badges.join(''), r.state])).toEqual([
      ['L', 'done'],
      ['R', 'open'],
    ]);
    expect(c.rows[0]?.accessibilityLabel).toBe('Set 1, left side, done, 15 kilograms each, 10 reps');
    expectAgreement(after, { nowMs: ms(6) });
  });

  it('a skipped exercise folds to Skipped', () => {
    const { state } = startFixture();
    const benchEx = setsFor(state, BENCH)[0]?.sessionExerciseId ?? '';
    const s = apply(state, { type: 'skip_exercise', at: at(5), opId: 'skip', sessionExerciseId: benchEx });
    const t = table(s, { nowMs: ms(6) });
    expect(t.blocks[0]?.folded).toEqual({ name: 'Bench press', summary: null, skipped: true, accessibilityLabel: 'Bench press, skipped. Expands.' });
    expect(card(t.blocks[0]).rows.every((r) => r.state === 'skipped')).toBe(true);
    expect(t.doneCount).toBe(0);
  });

  it('a pain-flagged exercise carries the badge; the open row and Log are unchanged (WT34)', () => {
    const s = emptyWith(exercise(216, 'Overhead press'), barbell());
    const plainT = table(s);
    const flagged = table(s, { painFlagged: new Set([id(216)]) });
    expect(card(flagged.blocks[0]).painBadge).toBe(true);
    expect(card(plainT.blocks[0]).painBadge).toBe(false);
    expect(flagged.anchor).toEqual(plainT.anchor);
  });
});

describe('Last and all done', () => {
  it('the header shows the last comparable session as actual results with its date', () => {
    const { state } = startFixture();
    const benchEx = setsFor(state, BENCH)[0]?.sessionExerciseId ?? '';
    const previous = {
      [benchEx]: {
        sessionId: id(900),
        performedAtUtc: '2026-10-01T06:00:00.000Z',
        gymId: GYM,
        sets: [8, 8, 7].map((reps, index) => ({ index, values: values(kg(100), reps) })),
      },
    };
    const c = card(table(state, { previous }).blocks[0]);
    expect(plain(c.subtitle)).toBe('Barbell · Last 1 Oct: 100 × 8, 8, 7');
  });

  it('after the last pending set: all done, no anchor, every block folded, Finish is the primary', () => {
    const s = emptyWith(exercise(216, 'Overhead press'), barbell());
    const setId = table(s).anchor?.setId ?? '';
    const done = apply(s, logCmd(setId, values(kg(40), 8), 30));
    const t = table(done, { nowMs: ms(31) });
    expect(t.allDone).toBe(true);
    expect(t.anchor).toBeNull();
    expect(t.log).toBeNull();
    expect(t.blocks.every((b) => b.folded !== null)).toBe(true);
    const v = buildActiveSetView(input(done, { nowMs: ms(31) }));
    // An open-ended workout keeps Add exercise (WT-D11); a planned one gets Finish.
    expect(tableLogLabel(v.primary, t.log, { offscreen: false }).label).toBe(v.openEnded ? 'Add exercise' : 'Finish workout');
  });

  it('a planned workout, all logged, offers Finish only then (WT28)', () => {
    const { state } = startFixture();
    let s = state;
    let t = 5;
    for (;;) {
      const v = buildActiveSetView(input(s, { nowMs: ms(t) }));
      expect(v.primary.kind).not.toBe('finish');
      const f = v.focus;
      if (!f) break;
      const vals = f.measurement === 'duration' ? values(null, null, { durationS: 40 }) : f.logValues;
      s = apply(s, logCmd(f.setId, vals, t + 1));
      t += 400;
      if (buildWorkoutTableView(input(s, { nowMs: ms(t) })).allDone) break;
    }
    const v = buildActiveSetView(input(s, { nowMs: ms(t) }));
    expect(v.primary).toEqual({ kind: 'finish', label: 'Finish workout' });
  });
});

describe('tableLogLabel', () => {
  it('names the exercise first only while the open row is off-screen; the values are the primary label', () => {
    const { state } = startFixture();
    const t = table(state);
    const v = buildActiveSetView(input(state));
    expect(tableLogLabel(v.primary, t.log, { offscreen: true })).toEqual({ lead: 'Bench press', label: tableLogLabel(v.primary, t.log, { offscreen: false }).label });
    expect(tableLogLabel({ kind: 'resume', label: 'Resume' }, t.log, { offscreen: true })).toEqual({ lead: null, label: 'Resume' });
    expect(tableLogLabel({ kind: 'stop_work', label: 'Stop' }, t.log, { offscreen: false })).toEqual({ lead: null, label: 'Stop' });
    expect(tableLogLabel({ kind: 'enter', label: 'Enter load', field: 'load' }, t.log, { offscreen: false })).toEqual({ lead: null, label: 'Enter load' });
  });
});
