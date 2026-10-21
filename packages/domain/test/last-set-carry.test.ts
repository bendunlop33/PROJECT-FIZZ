import { describe, expect, it } from 'vitest';
import { WorkoutSetSchema, type Exercise, type Load, type SessionAggregate, type SessionCommand, type SetTemplate, type SetValues, type WorkoutSet } from '@fizz/schemas';

import {
  buildActiveSetView,
  buildLockScreenContent,
  buildPlannedSetEditView,
  buildWorkoutTableView,
  newPainFlag,
  carriedLoad,
  NBSP,
  prefillDraft,
  reconcileDraftEdits,
  reduceSession,
  restSetsView,
  saveDraftCommand,
  setGlance,
  spokenSetOf,
  startWorkout,
  type ActiveViewInput,
  type TableRow,
} from '../src/index';
import { assisted, at, barbell, dumbbells, exercise, GYM, id, idGen, kg, lb, ms, profile, routine, routineExercise, template, values } from './fixtures';
import { apply, expectOk, logCmd } from './session-fixture';

/**
 * Last set carries (Ben, 21 Oct 2026; active-workout.md §4.2 rule 2a; review
 * weight-revert-21oct SP1): after he logs a set at a weight other than its
 * target, the later pending sets of that exercise and set type start at his
 * weight in every view. The stored target is never rewritten.
 */

const BENCH = id(300);
const DB = id(301);
const PULL = id(302);

const catalogue = new Map<string, Exercise>([
  [BENCH, exercise(300, 'Bench press')],
  [DB, exercise(301, 'Dumbbell press', { compatibleEquipment: ['dumbbells'], defaultLoadConvention: 'per_hand' })],
  [PULL, exercise(302, 'Assisted pull-up', { compatibleEquipment: ['assisted_stack'], defaultLoadConvention: 'assistance' })],
]);

const W = (n: number, load: number): SetTemplate => template(n, { setType: 'warmup', targetLoad: kg(load), targetReps: { min: 5, max: 5 } });
const WK = (n: number, load: Load, type: SetTemplate['setType'] = 'working'): SetTemplate => template(n, { setType: type, targetLoad: load });

/** Bench: one warm-up and four working sets at 100 (or the given templates); optional DB press and assisted pull-up. */
function start(bench: SetTemplate[] = [W(6001, 60), WK(6002, kg(100)), WK(6003, kg(100)), WK(6004, kg(100)), WK(6005, kg(100))]): SessionAggregate {
  const r = routine([
    routineExercise(600, { exerciseId: BENCH, equipmentId: barbell().id, order: 0, setTemplates: bench }),
    routineExercise(601, { exerciseId: DB, equipmentId: dumbbells().id, order: 1, setTemplates: [WK(6011, kg(20, 'per_hand')), WK(6012, kg(20, 'per_hand')), WK(6013, kg(20, 'per_hand'))] }),
    routineExercise(602, { exerciseId: PULL, equipmentId: assisted().id, order: 2, setTemplates: [WK(6021, kg(30, 'assistance')), WK(6022, kg(30, 'assistance')), WK(6023, kg(30, 'assistance'))] }),
  ]);
  return startWorkout({ opId: 'start-c', owner: profile(), gymId: GYM, routine: r, exercises: catalogue, gymEquipment: [barbell(), dumbbells(), assisted()], at: at(0), newId: idGen() }).aggregate;
}

function setsOf(s: SessionAggregate, exerciseId: string): WorkoutSet[] {
  const ex = s.exercises.find((e) => e.exerciseId === exerciseId);
  return s.sets.filter((x) => x.sessionExerciseId === ex?.id).sort((a, b) => a.index - b.index);
}
const now = (s: SessionAggregate, setId: string): WorkoutSet => {
  const set = s.sets.find((x) => x.id === setId);
  if (!set) throw new Error('set');
  return set;
};

const plain = (x: string | null | undefined) => (x ?? '').replaceAll(NBSP, ' ');
const input = (aggregate: SessionAggregate, over: Partial<ActiveViewInput> = {}): ActiveViewInput => ({ aggregate, nowMs: ms(1000), gymName: 'Main Gym', previous: {}, painFlagged: new Set(), edits: null, ...over });
const rowOf = (s: SessionAggregate, setId: string, over: Partial<ActiveViewInput> = {}): TableRow => {
  const r = buildWorkoutTableView(input(s, over))
    .blocks.flatMap((b) => (b.kind === 'exercise' ? b.card.rows : b.superset.rounds.flatMap((x) => x.rows)))
    .find((x) => x.setId === setId);
  if (!r) throw new Error('row');
  return r;
};
const loadOf = (s: SessionAggregate, setId: string, painFlagged?: ReadonlySet<string>) => prefillDraft(s, setId, [], { painFlagged }).values.load?.value ?? null;
const log = (s: SessionAggregate, set: WorkoutSet, v: SetValues, t: number) => apply(s, logCmd(set.id, v, t, `log-${set.id}-${String(t)}`));
const select = (s: SessionAggregate, setId: string, opId: string): SessionCommand => ({ type: 'set_active_set', at: at(500), opId, setId, expectedVersion: s.session.version });

/** Warm-up as planned, then b1 at 100 and b2 at 105 against 100. */
function loggedB2At105(): { s: SessionAggregate; w: WorkoutSet; b1: WorkoutSet; b2: WorkoutSet; b3: WorkoutSet; b4: WorkoutSet } {
  let s = start();
  const [w, b1, b2, b3, b4] = setsOf(s, BENCH);
  if (!w || !b1 || !b2 || !b3 || !b4) throw new Error('fixture');
  s = log(s, w, values(kg(60), 5), 60);
  s = log(s, b1, values(kg(100), 8), 300);
  s = log(s, b2, values(kg(105), 8), 600);
  return { s, w, b1, b2, b3, b4 };
}

describe('log b2 at 105 against 100: b3 and b4 start at 105', () => {
  it('prefill, open row, table, Focus list, rest Next, lock screen and voice all say 105; the target stays 100', () => {
    const { s, b3, b4 } = loggedB2At105();
    expect(s.session.activeSetId).toBe(b3.id);
    // The open row's fields (prefill) and the Log label.
    expect(prefillDraft(s, b3.id)).toMatchObject({ values: { load: kg(105), reps: 8 }, source: 'last_set' });
    const focus = buildActiveSetView(input(s)).focus;
    expect(focus?.cells).toEqual({ load: '105', value: '8' });
    expect(focus?.draftSource).toBe('last_set');
    // Table: the open row and the next one.
    expect(rowOf(s, b3.id).cells.load).toBe('105');
    expect(rowOf(s, b4.id).cells.load).toBe('105');
    expect(plain(rowOf(s, b4.id).cells.value)).toBe('6–8');
    expect(rowOf(s, b4.id).accessibilityLabel).toContain('your edit');
    expect(plain(focus?.rows.find((r) => r.setId === b4.id)?.text)).toContain('105');
    // Rest `Next` card, lock screen, the spoken cue.
    expect(plain(restSetsView(s).next?.value)).toBe('105 kg × 6–8');
    expect(plain(setGlance(s, b4.id)?.value)).toBe('105 kg × 6–8');
    expect(plain(buildLockScreenContent(s, ms(700), 'UTC')?.line2)).toBe('Your edit 105 kg × 6–8');
    expect(spokenSetOf(s, b3.id)?.load).toEqual(kg(105));
    // The Edit set sheet opens on what the row shows.
    expect(buildPlannedSetEditView(s, b4.id)?.loadField?.value).toBe(105);
    // Prefill only: the plan record keeps the original target, no draft is written.
    expect(now(s, b3.id).planned.load).toEqual(kg(100));
    expect(now(s, b4.id).planned.load).toEqual(kg(100));
    expect(now(s, b4.id).draft).toBeNull();
  });

  it('logging b3 at the carried 105 records 105 against its 100 target, and b4 keeps 105', () => {
    const fx = loggedB2At105();
    let s = fx.s;
    const { b3, b4 } = fx;
    s = log(s, now(s, b3.id), values(kg(105), 8), 900);
    expect(now(s, b3.id).actual?.load).toEqual(kg(105));
    expect(now(s, b3.id).planned.load).toEqual(kg(100));
    expect(loadOf(s, b4.id)).toBe(105);
  });

  it('Undo is retyping: b3 logged back at 100 ends the carry for b4', () => {
    const fx = loggedB2At105();
    let s = fx.s;
    const { b3, b4 } = fx;
    s = log(s, now(s, b3.id), values(kg(100), 8), 900);
    expect(loadOf(s, b4.id)).toBe(100);
    expect(rowOf(s, b4.id).cells.load).toBe('100');
  });

  it('Undo of the b2 log ends the carry', () => {
    const fx = loggedB2At105();
    let s = fx.s;
    const { b2, b4 } = fx;
    s = expectOk(reduceSession(s, { type: 'undo_log', at: at(610), opId: 'undo-b2', setId: b2.id, expectedSetVersion: now(s, b2.id).version })).state;
    expect(rowOf(s, b4.id).cells.load).toBe('100');
  });

  it('a lighter set carries too (b2 at 95)', () => {
    let s = start();
    const [w, b1, b2, b3] = setsOf(s, BENCH);
    if (!w || !b1 || !b2 || !b3) throw new Error('fixture');
    s = log(s, b1, values(kg(100), 8), 300);
    s = log(s, b2, values(kg(95), 8), 600);
    expect(loadOf(s, b3.id)).toBe(95);
  });

  it('logged as planned: nothing carries (a planned ramp stays)', () => {
    let s = start([WK(6101, kg(100)), WK(6102, kg(102.5)), WK(6103, kg(105))]);
    const [a, b, c] = setsOf(s, BENCH);
    if (!a || !b || !c) throw new Error('fixture');
    s = log(s, a, values(kg(100), 8), 300);
    expect(loadOf(s, b.id)).toBe(102.5);
    expect(loadOf(s, c.id)).toBe(105);
  });
});

describe('set-type groups', () => {
  it('a warm-up logged heavier never carries, and a warm-up never receives', () => {
    let s = start([W(6201, 60), W(6202, 80), WK(6203, kg(100)), WK(6204, kg(100))]);
    const [w1, w2, b1, b2] = setsOf(s, BENCH);
    if (!w1 || !w2 || !b1 || !b2) throw new Error('fixture');
    s = log(s, w1, values(kg(70), 5), 60);
    expect(loadOf(s, w2.id)).toBe(80);
    expect(loadOf(s, b1.id)).toBe(100);
    // A working set at 105 doesn't reach a warm-up after it either.
    s = log(s, w2, values(kg(80), 5), 120);
    s = log(s, b1, values(kg(105), 8), 300);
    expect(loadOf(s, b2.id)).toBe(105);
    expect(carriedLoad(s, now(s, w2.id))).toBeNull();
  });

  it('a top set’s weight doesn’t carry to back-offs; back-off to back-off does', () => {
    let s = start([WK(6301, kg(120), 'top'), WK(6302, kg(100), 'backoff'), WK(6303, kg(100), 'backoff'), WK(6304, kg(100), 'backoff')]);
    const [top, k1, k2, k3] = setsOf(s, BENCH);
    if (!top || !k1 || !k2 || !k3) throw new Error('fixture');
    s = log(s, top, values(kg(125), 3), 300);
    expect(loadOf(s, k1.id)).toBe(100);
    expect(rowOf(s, k2.id).cells.load).toBe('100');
    s = log(s, now(s, k1.id), values(kg(105), 8), 600);
    expect(loadOf(s, k2.id)).toBe(105);
    expect(rowOf(s, k3.id).cells.load).toBe('105');
  });

  it('drop sets never carry', () => {
    let s = start([WK(6401, kg(100)), WK(6402, kg(80), 'drop'), WK(6403, kg(60), 'drop')]);
    const [a, d1, d2] = setsOf(s, BENCH);
    if (!a || !d1 || !d2) throw new Error('fixture');
    s = log(s, a, values(kg(100), 8), 300);
    s = log(s, d1, values(kg(70), 8), 330);
    expect(loadOf(s, d2.id)).toBe(60);
  });

  it('only later sets: a set logged out of order doesn’t carry back to an earlier one', () => {
    let s = start();
    const [, b1, b2, b3, b4] = setsOf(s, BENCH);
    if (!b1 || !b2 || !b3 || !b4) throw new Error('fixture');
    s = apply(s, select(s, b4.id, 'sel-b4'));
    s = log(s, b4, values(kg(105), 8), 300);
    expect(loadOf(s, b2.id)).toBe(100);
    expect(loadOf(s, b3.id)).toBe(100);
  });
});

describe('Ben’s own edits win', () => {
  it('a draft Ben typed on b4 (before or after the log) keeps his value; untouched b3 takes 105', () => {
    let s = start();
    const [w, b1, b2, b3, b4] = setsOf(s, BENCH);
    if (!w || !b1 || !b2 || !b3 || !b4) throw new Error('fixture');
    s = apply(s, saveDraftCommand({ setId: b4.id, values: values(kg(102.5), 8) }, at(50)));
    s = log(s, b2, values(kg(105), 8), 600);
    expect(loadOf(s, b3.id)).toBe(105);
    expect(loadOf(s, b4.id)).toBe(102.5);
    expect(rowOf(s, b4.id).cells.load).toBe('102.5');
  });

  it('retyping the plan’s 100 over a carried 105 sticks (no flick back to 105)', () => {
    const fx = loggedB2At105();
    let s = fx.s;
    const { b4 } = fx;
    s = apply(s, saveDraftCommand({ setId: b4.id, values: values(kg(100), 8) }, at(700)));
    expect(loadOf(s, b4.id)).toBe(100);
    expect(rowOf(s, b4.id).cells.load).toBe('100');
    expect(plain(setGlance(s, b4.id)?.value)).toBe('100 kg × 6–8');
  });

  it('Ben’s planned edit of b4’s load (pop-up / Edit set) keeps his value; a reps-only edit keeps the carry', () => {
    const fx = loggedB2At105();
    let s = fx.s;
    const { b3, b4 } = fx;
    s = apply(s, { type: 'edit_planned_set', at: at(700), opId: 'edit-b4', setId: b4.id, expectedSetVersion: now(s, b4.id).version, patch: { load: kg(102.5) } });
    expect(loadOf(s, b4.id)).toBe(102.5);
    expect(rowOf(s, b4.id).cells.load).toBe('102.5');
    s = apply(s, { type: 'edit_planned_set', at: at(710), opId: 'edit-b3', setId: b3.id, expectedSetVersion: now(s, b3.id).version, patch: { reps: { min: 6, max: 6 } } });
    expect(rowOf(s, b3.id).cells.load).toBe('105');
    expect(plain(rowOf(s, b3.id).cells.value)).toBe('6');
  });

  it('Edit set back to the plan’s 100 on a carried row is a change, not a no-op', () => {
    const fx = loggedB2At105();
    let s = fx.s;
    const { b4 } = fx;
    const sheet = buildPlannedSetEditView(s, b4.id, { load: 100 });
    expect(sheet?.patch).toMatchObject({ load: kg(100) });
    s = apply(s, { type: 'edit_planned_set', at: at(700), opId: 'edit-b4-100', setId: b4.id, expectedSetVersion: now(s, b4.id).version, patch: { load: kg(100) } });
    expect(rowOf(s, b4.id).cells.load).toBe('100');
  });

  it('a reps edit over a typed 100 on a carried row keeps his 100 (draft not cleared)', () => {
    const fx = loggedB2At105();
    let s = fx.s;
    const { b4 } = fx;
    s = apply(s, saveDraftCommand({ setId: b4.id, values: values(kg(100), 8) }, at(700)));
    s = apply(s, { type: 'edit_planned_set', at: at(710), opId: 'edit-b4-reps', setId: b4.id, expectedSetVersion: now(s, b4.id).version, patch: { reps: { min: 6, max: 6 } } });
    expect(now(s, b4.id).draft?.load).toEqual(kg(100));
    expect(rowOf(s, b4.id).cells.load).toBe('100');
    // The screen's unsaved 100 survives the same change.
    const edits = reconcileDraftEdits({ setId: b4.id, values: values(kg(100), 8), setVersion: now(s, b4.id).version - 1 }, s);
    expect(edits?.values.load).toEqual(kg(100));
  });
});

describe('coach and rule targets', () => {
  const coach = (s: SessionAggregate, setIds: string[], load: number, t: number): SessionAggregate =>
    expectOk(reduceSession(s, { type: 'adjust_pending_targets', at: at(t), opId: `coach-${String(t)}`, expectedVersion: s.session.version, actionId: `act-${String(t)}`, changes: setIds.map((setId) => ({ setId, target: { load: kg(load), reps: { min: 8, max: 8 } } })), removeSetIds: [], addSets: [] })).state;

  it('a coach edit_today after the log wins (newer)', () => {
    const fx = loggedB2At105();
    let s = fx.s;
    const { b3, b4 } = fx;
    s = coach(s, [b3.id, b4.id], 102.5, 700);
    expect(loadOf(s, b3.id)).toBe(102.5);
    expect(rowOf(s, b4.id).cells.load).toBe('102.5');
    expect(plain(buildLockScreenContent(s, ms(710), 'UTC')?.line2)).toContain('102.5');
  });

  it('a coach target set before the log is older: his log wins', () => {
    let s = start();
    const [, b1, b2, b3] = setsOf(s, BENCH);
    if (!b1 || !b2 || !b3) throw new Error('fixture');
    s = coach(s, [b2.id, b3.id], 97.5, 100);
    s = log(s, b1, values(kg(100), 8), 300);
    s = log(s, now(s, b2.id), values(kg(105), 8), 600);
    expect(loadOf(s, b3.id)).toBe(105);
  });
});

describe('guardrails', () => {
  it('pain flag on the movement blocks a heavier carry; a lighter one still carries', () => {
    const { s, b3, b4 } = loggedB2At105();
    const pain = new Set([BENCH]);
    expect(loadOf(s, b3.id, pain)).toBe(100);
    expect(rowOf(s, b4.id, { painFlagged: pain }).cells.load).toBe('100');
    expect(plain(restSetsView(s, {}, { painFlagged: pain }).next?.value)).toBe('100 kg × 6–8');
    expect(plain(buildLockScreenContent(s, ms(700), 'UTC', { painFlagged: pain })?.line2)).toBe('Target 100 kg × 6–8');
    expect(spokenSetOf(s, b3.id, [], { painFlagged: pain })?.load).toEqual(kg(100));
    // From the view input's flag list too.
    const flag = newPainFlag({ id: id(990), ownerId: profile().id, opId: 'pain-op', exerciseId: BENCH, exerciseName: 'Bench press', area: null, source: 'workout', checkInId: null, at: at(0) });
    expect(rowOf(s, b4.id, { painFlags: [flag] }).cells.load).toBe('100');

    let light = start();
    const [, l1, l2] = setsOf(light, BENCH);
    if (!l1 || !l2) throw new Error('fixture');
    light = log(light, l1, values(kg(95), 8), 300);
    expect(loadOf(light, l2.id, pain)).toBe(95);
  });

  it('a set logged with pain in this session blocks a heavier carry without any flag list', () => {
    const fx = loggedB2At105();
    let s = fx.s;
    const { b2, b3 } = fx;
    s = apply(s, { type: 'correct_set', at: at(650), opId: 'pain-b2', setId: b2.id, expectedSetVersion: now(s, b2.id).version, patch: { exclusions: ['pain'] } });
    expect(loadOf(s, b3.id)).toBe(100);
  });

  it('unit mismatch doesn’t carry (a lb result on a kg row)', () => {
    const { s, b2, b3 } = loggedB2At105();
    const lbState: SessionAggregate = { ...s, sets: s.sets.map((x) => (x.id === b2.id && x.actual ? { ...x, actual: { ...x.actual, load: lb(230) } } : x)) };
    expect(loadOf(lbState, b3.id)).toBe(100);
    expect(rowOf(lbState, b3.id).cells.load).toBe('100');
    expect(carriedLoad(lbState, now(lbState, b3.id))).toBeNull();
  });

  it('per-hand dumbbells carry per hand, snapped to the rack', () => {
    let s = start();
    const [d1, d2, d3] = setsOf(s, DB);
    if (!d1 || !d2 || !d3) throw new Error('fixture');
    s = apply(s, select(s, d1.id, 'sel-d1'));
    s = log(s, d1, values(kg(22.5, 'per_hand'), 8), 300);
    expect(prefillDraft(s, d2.id).values.load).toEqual(kg(22.5, 'per_hand'));
    expect(rowOf(s, d3.id).cells.load).toBe('22.5');
  });

  it('a logged load the kit can’t make rounds toward easier; never past the max', () => {
    let s = start();
    const [, b1, b2, b3] = setsOf(s, BENCH);
    if (!b1 || !b2 || !b3) throw new Error('fixture');
    s = log(s, b1, values(kg(100), 8), 300);
    // 106 isn't makeable on the bar: 105 (easier), never 107.5.
    s = log(s, b2, values(kg(106), 8), 600);
    expect(loadOf(s, b3.id)).toBe(105);
    // Past the bar's 187.5 kg maximum: the carry stops at the max.
    const heavy: SessionAggregate = { ...s, sets: s.sets.map((x) => (x.id === b2.id && x.actual ? { ...x, actual: { ...x.actual, load: kg(200) } } : x)) };
    expect(carriedLoad(heavy, now(heavy, b3.id))).toEqual(kg(187.5));
  });

  it('assisted machine: less assistance is heavier (blocked by pain), more assistance carries', () => {
    let s = start();
    const [p1, p2, p3] = setsOf(s, PULL);
    if (!p1 || !p2 || !p3) throw new Error('fixture');
    s = apply(s, select(s, p1.id, 'sel-p1'));
    s = log(s, p1, values(kg(25, 'assistance'), 8), 300);
    expect(prefillDraft(s, p2.id).values.load).toEqual(kg(25, 'assistance'));
    expect(loadOf(s, p2.id, new Set([PULL]))).toBe(30);
    s = log(s, now(s, p2.id), values(kg(35, 'assistance'), 8), 600);
    expect(loadOf(s, p3.id, new Set([PULL]))).toBe(35);
  });

  it('restart recovery: the carry is derived from the stored workout, so a reloaded copy shows the same', () => {
    const { s, b4 } = loggedB2At105();
    const reloaded = JSON.parse(JSON.stringify(s)) as SessionAggregate;
    expect(rowOf(reloaded, b4.id).cells.load).toBe('105');
  });

  it('duplicate log op ID: replaying the b2 log changes nothing, the carry stays 105', () => {
    const { s, b2, b3 } = loggedB2At105();
    const again = reduceSession(s, logCmd(b2.id, values(kg(105), 8), 600, `log-${b2.id}-600`));
    const after = again.ok ? again.state : s;
    expect(loadOf(after, b3.id)).toBe(105);
  });
});

/** Review weight-revert-21oct "Carry forward" (CB1, CS1–CS4, CN2). */
describe('review: carry forward fixes', () => {
  const undoLog = (s: SessionAggregate, setId: string, t: number) => expectOk(reduceSession(s, { type: 'undo_log', at: at(t), opId: `undo-${setId}-${String(t)}`, setId, expectedSetVersion: now(s, setId).version })).state;
  const editPlanned = (s: SessionAggregate, setId: string, patch: Extract<SessionCommand, { type: 'edit_planned_set' }>['patch'], t: number) =>
    apply(s, { type: 'edit_planned_set', at: at(t), opId: `edit-${setId}-${String(t)}`, setId, expectedSetVersion: now(s, setId).version, patch });

  describe('CB1: Edit set on a carried row never writes the carry into the target', () => {
    it('an untouched sheet is no change (Save stays off)', () => {
      const { s, b3, b4 } = loggedB2At105();
      for (const set of [b3, b4]) {
        const sheet = buildPlannedSetEditView(s, set.id, {});
        expect(sheet?.loadField?.value).toBe(105);
        expect(sheet?.changed).toBe(false);
        expect(sheet?.patch).toBeNull();
      }
    });

    it('reps-only and rest-only edits send no load; the target keeps 100 and Undo of the b2 log still moves b3 back', () => {
      const fx = loggedB2At105();
      let s = fx.s;
      const { b2, b3, b4 } = fx;
      const reps = buildPlannedSetEditView(s, b3.id, { reps: { min: 6, max: 6 } });
      expect(reps?.patch).toEqual({ reps: { min: 6, max: 6 } });
      const rest = buildPlannedSetEditView(s, b4.id, { restS: now(s, b4.id).rest.seconds + 15 });
      expect(rest?.patch).toEqual({ restS: now(s, b4.id).rest.seconds + 15 });
      if (!reps?.patch || !rest?.patch) throw new Error('patch');
      s = editPlanned(s, b3.id, reps.patch, 700);
      s = editPlanned(s, b4.id, rest.patch, 710);
      expect(now(s, b3.id).planned.load).toEqual(kg(100));
      expect(now(s, b4.id).planned.load).toEqual(kg(100));
      expect(now(s, b3.id).planned.edit?.fields).toEqual(['reps']);
      expect(rowOf(s, b3.id).cells.load).toBe('105');
      expect(rowOf(s, b4.id).cells.load).toBe('105');
      s = undoLog(s, b2.id, 720);
      expect(rowOf(s, b3.id).cells.load).toBe('100');
      expect(rowOf(s, b4.id).cells.load).toBe('100');
    });

    it('a load other than the carry is still a change (100 back, or 107.5)', () => {
      const { s, b3 } = loggedB2At105();
      expect(buildPlannedSetEditView(s, b3.id, { load: 100 })?.patch).toEqual({ load: kg(100) });
      expect(buildPlannedSetEditView(s, b3.id, { load: 107.5 })?.patch).toEqual({ load: kg(107.5) });
      expect(buildPlannedSetEditView(s, b3.id, { load: 105 })?.changed).toBe(false);
    });

    it('a draft load of Ben’s is still his change (Save makes it the target)', () => {
      const fx = loggedB2At105();
      let s = fx.s;
      const { b4 } = fx;
      s = apply(s, saveDraftCommand({ setId: b4.id, values: values(kg(110), 8), carried: kg(105) }, at(700)));
      expect(buildPlannedSetEditView(s, b4.id, {})?.patch).toMatchObject({ load: kg(110) });
    });
  });

  describe('CS1: a carried load saved in a draft follows the carry', () => {
    it('a reps-only draft on b3, then Undo of the b2 log: b3 shows 100 with his reps', () => {
      const fx = loggedB2At105();
      let s = fx.s;
      const { b2, b3 } = fx;
      const focus = buildActiveSetView(input(s)).focus;
      expect(focus?.carriedLoad).toEqual(kg(105));
      s = apply(s, saveDraftCommand({ setId: b3.id, values: values(kg(105), 6), carried: kg(105) }, at(700)));
      expect(now(s, b3.id).draft?.loadCarried).toBe(true);
      expect(rowOf(s, b3.id).cells.load).toBe('105');
      expect(prefillDraft(s, b3.id).values).toMatchObject({ load: kg(105), reps: 6 });
      s = undoLog(s, b2.id, 720);
      expect(rowOf(s, b3.id).cells.load).toBe('100');
      expect(plain(rowOf(s, b3.id).cells.value)).toBe('6');
      const pre = prefillDraft(s, b3.id);
      expect(pre.values.load).toEqual(kg(100));
      expect('loadCarried' in pre.values).toBe(false);
    });

    it('a typed load other than the carry is saved as his own', () => {
      const { s, b3 } = loggedB2At105();
      const after = apply(s, saveDraftCommand({ setId: b3.id, values: values(kg(100), 8), carried: kg(105) }, at(700)));
      expect(now(after, b3.id).draft?.loadCarried).toBeUndefined();
      expect(rowOf(after, b3.id).cells.load).toBe('100');
    });

    it('the marker survives a restart (schema round trip) and a reps edit over it clears the draft', () => {
      const fx = loggedB2At105();
      let s = fx.s;
      const { b4 } = fx;
      s = apply(s, saveDraftCommand({ setId: b4.id, values: values(kg(105), 6), carried: kg(105) }, at(700)));
      expect(WorkoutSetSchema.parse(JSON.parse(JSON.stringify(now(s, b4.id)))).draft?.loadCarried).toBe(true);
      s = editPlanned(s, b4.id, { reps: { min: 6, max: 6 } }, 710);
      expect(now(s, b4.id).draft).toBeNull();
      expect(rowOf(s, b4.id).cells.load).toBe('105');
    });
  });

  describe('CS2: Ben’s own target on the logged set doesn’t stop the carry', () => {
    it('b2 raised to 105 in Edit set and logged at 105: b3 and b4 start at 105', () => {
      let s = start();
      const [w, b1, b2, b3, b4] = setsOf(s, BENCH);
      if (!w || !b1 || !b2 || !b3 || !b4) throw new Error('fixture');
      s = log(s, w, values(kg(60), 5), 60);
      s = log(s, b1, values(kg(100), 8), 300);
      s = editPlanned(s, b2.id, { load: kg(105) }, 400);
      s = log(s, now(s, b2.id), values(kg(105), 8), 600);
      expect(loadOf(s, b3.id)).toBe(105);
      expect(rowOf(s, b4.id).cells.load).toBe('105');
      expect(now(s, b3.id).planned.load).toEqual(kg(100));
    });

    it('b2 raised to 105 but logged at the plan’s 100: nothing carries', () => {
      let s = start();
      const [, b1, b2, b3] = setsOf(s, BENCH);
      if (!b1 || !b2 || !b3) throw new Error('fixture');
      s = log(s, b1, values(kg(100), 8), 300);
      s = editPlanned(s, b2.id, { load: kg(105) }, 400);
      s = log(s, now(s, b2.id), values(kg(100), 8), 600);
      expect(loadOf(s, b3.id)).toBe(100);
    });

    it('a legacy edit record without `fields` reads the same (CN2)', () => {
      let s = start();
      const [, b1, b2, b3] = setsOf(s, BENCH);
      if (!b1 || !b2 || !b3) throw new Error('fixture');
      s = log(s, b1, values(kg(100), 8), 300);
      s = editPlanned(s, b2.id, { load: kg(105) }, 400);
      const legacy = (x: WorkoutSet): WorkoutSet => {
        if (x.id !== b2.id || !x.planned.edit) return x;
        const edit = { ...x.planned.edit };
        delete edit.fields;
        return { ...x, planned: { ...x.planned, edit } };
      };
      s = { ...s, sets: s.sets.map(legacy) };
      expect(now(s, b2.id).planned.edit?.fields).toBeUndefined();
      s = log(s, now(s, b2.id), values(kg(105), 8), 600);
      expect(loadOf(s, b3.id)).toBe(105);
    });
  });

  describe('CS3: a planned ramp logged off target (pending Ben, SPC1)', () => {
    it('ramp 100 / 102.5 / 105 with set 1 at 102.5: the later sets take 102.5 (absolute carry as approved)', () => {
      let s = start([WK(6002, kg(100)), WK(6003, kg(102.5)), WK(6004, kg(105))]);
      const [r1, r2, r3] = setsOf(s, BENCH);
      if (!r1 || !r2 || !r3) throw new Error('fixture');
      s = log(s, r1, values(kg(102.5), 8), 300);
      // Rule 2a carries the logged load as is, so the top set reads lighter than planned. Ben decides (SPC1).
      expect(loadOf(s, r2.id)).toBe(102.5);
      expect(loadOf(s, r3.id)).toBe(102.5);
      expect(now(s, r3.id).planned.load).toEqual(kg(105));
    });

    it('ramp logged on target stays a ramp', () => {
      let s = start([WK(6002, kg(100)), WK(6003, kg(102.5)), WK(6004, kg(105))]);
      const [r1, r2, r3] = setsOf(s, BENCH);
      if (!r1 || !r2 || !r3) throw new Error('fixture');
      s = log(s, r1, values(kg(100), 8), 300);
      expect(loadOf(s, r2.id)).toBe(102.5);
      expect(loadOf(s, r3.id)).toBe(105);
    });
  });

  describe('CS4: pain flags unknown in the reducer and reconcile never drop a typed weight', () => {
    it('flagged bench: Ben types 105 on b4 (no carry shown); a reps-only Edit set keeps it', () => {
      const fx = loggedB2At105();
      let s = fx.s;
      const { b4 } = fx;
      const pain = new Set([BENCH]);
      expect(rowOf(s, b4.id, { painFlagged: pain }).cells.load).toBe('100');
      // The screen knows the flag: no carry, so no marker.
      s = apply(s, saveDraftCommand({ setId: b4.id, values: values(kg(105), 8) }, at(700)));
      expect(rowOf(s, b4.id, { painFlagged: pain }).cells.load).toBe('105');
      const sheet = buildPlannedSetEditView(s, b4.id, { reps: { min: 6, max: 6 } }, { painFlagged: pain });
      expect(sheet?.patch).toMatchObject({ reps: { min: 6, max: 6 } });
      s = editPlanned(s, b4.id, { reps: { min: 6, max: 6 } }, 710);
      expect(now(s, b4.id).draft?.load).toEqual(kg(105));
      expect(rowOf(s, b4.id, { painFlagged: pain }).cells.load).toBe('105');
    });

    it('flagged bench: the screen’s unsaved 105 survives a reps change', () => {
      const fx = loggedB2At105();
      let s = fx.s;
      const { b4 } = fx;
      const version = now(s, b4.id).version;
      s = editPlanned(s, b4.id, { reps: { min: 6, max: 6 } }, 710);
      const edits = reconcileDraftEdits({ setId: b4.id, values: values(kg(105), 8), setVersion: version }, s);
      expect(edits?.values.load).toEqual(kg(105));
    });

    it('flagged bench: Edit set with nothing changed sends nothing', () => {
      const { s, b4 } = loggedB2At105();
      expect(buildPlannedSetEditView(s, b4.id, {}, { painFlagged: new Set([BENCH]) })?.changed).toBe(false);
    });
  });
});
