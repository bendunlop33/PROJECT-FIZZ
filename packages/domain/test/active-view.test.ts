import { describe, expect, it } from 'vitest';
import type { EquipmentInstance, Exercise, SessionAggregate } from '@fizz/schemas';

import {
  buildActiveSetView,
  buildAddExerciseCommand,
  buildSetEditView,
  lastComparableSession,
  NBSP,
  startWorkout,
  type ActiveSetView,
  type ActiveViewInput,
  type FocusView,
} from '../src/index';
import { assisted, at, barbell, bodyweightStation, dumbbells, exercise, GYM, id, idGen, kg, lb, ms, profile, stack, values } from './fixtures';
import { apply, logCmd, setsFor, startFixture, BENCH } from './session-fixture';

/** Labels use no-break spaces; tests read them with plain spaces. */
const plain = (s: string | null | undefined) => (s ?? '').replaceAll(NBSP, ' ');

function view(aggregate: SessionAggregate, over: Partial<ActiveViewInput> = {}): ActiveSetView {
  return buildActiveSetView({ aggregate, nowMs: ms(10), gymName: 'Main Gym', previous: {}, painFlagged: new Set(), edits: null, ...over });
}
function focus(v: ActiveSetView): FocusView {
  if (!v.focus) throw new Error(`no focus in phase ${v.phase}`);
  return v.focus;
}

function emptyWith(ex: Exercise, eq: EquipmentInstance | null, unit: 'kg' | 'lb' = 'kg'): SessionAggregate {
  const owner = profile({ preferredUnit: unit });
  const ids = idGen(70_000);
  let state = startWorkout({ opId: 'start-e', owner, gymId: GYM, routine: null, exercises: new Map(), gymEquipment: eq ? [eq] : [], at: at(0), newId: ids }).aggregate;
  state = apply(state, buildAddExerciseCommand({ opId: 'add-1', owner, exercise: ex, equipmentId: eq?.id ?? null, at: at(1), newId: ids }));
  return state;
}

describe('buildActiveSetView: planned workout', () => {
  it('shows the warm-up with its target, a matching Log label and a deterministic opId', () => {
    const { state } = startFixture();
    const v = view(state);
    const f = focus(v);
    expect(v.phase).toBe('ready');
    expect(v.title).toBe('Push A');
    expect(f.exerciseName).toBe('Bench press');
    expect(plain(f.headerLine)).toBe('Barbell · Warm-up · Set 1 of 3');
    expect(plain(f.target)).toBe('Target 60 kg · 10 reps');
    expect(f.draftSource).toBe('target');
    expect(plain(f.logLabel)).toBe('Log 60 kg × 10');
    expect(v.primary).toEqual({ kind: 'log', label: f.logLabel });
    expect(f.opId).toBe(`log:${f.setId}:0`);
    expect(f.rows.map((r) => [r.number, r.badges.join(''), r.status, plain(r.text)])).toEqual([
      [1, 'W', 'active', 'now'],
      [2, '', 'pending', 'Target 100 kg × 6–8'],
      [3, '', 'pending', 'Target 100 kg × 6–8'],
    ]);
    expect(f.restAfterS).toBe(60);
    expect(v.progress).toEqual({ done: 0, total: 8 });
  });

  it('steps loads through achievable loads only, and the label follows the edit', () => {
    const { state } = startFixture();
    const s = apply(state, logCmd(setsFor(state, BENCH)[0]?.id ?? '', values(kg(60), 10), 5));
    const f = focus(view(s, { nowMs: ms(300) }));
    expect(f.loadField).toMatchObject({ label: 'Load', unitText: 'kg', value: 100, up: { enabled: true, value: 102.5 }, down: { enabled: true, value: 97.5 } });
    const edited = focus(view(s, { nowMs: ms(300), edits: { setId: f.setId, values: values(kg(102.5), 7) } }));
    expect(edited.draftSource).toBe('edited');
    expect(plain(edited.logLabel)).toBe('Log 102.5 kg × 7');
    expect(edited.logValues).toEqual(values(kg(102.5), 7));
  });

  it('after Log: rest runs from the deadline, the just-saved line shows the actual, the next set is focused', () => {
    const { state } = startFixture();
    const warm = setsFor(state, BENCH)[0]?.id ?? '';
    const s = apply(state, logCmd(warm, values(kg(60), 9), 5));
    const v = view(s, { nowMs: ms(35) });
    expect(v.phase).toBe('resting');
    expect(v.rest).toMatchObject({ kind: 'running', remainingMs: 30_000, durationS: 60 });
    expect(v.justSaved).toMatchObject({ setId: warm, setNumber: 1, rpe: null, undoOpId: `undo:${warm}:0` });
    expect(plain(v.justSaved?.text)).toBe('60 kg × 9');
    expect(focus(v).setNumber).toBe(2);
    expect(focus(v).rows[0]).toMatchObject({ status: 'done' });
    expect(plain(focus(v).rows[0]?.text)).toBe('60 kg × 9');
    // Rest ended: count-up, never reset.
    const later = view(s, { nowMs: ms(100) });
    expect(later.rest).toMatchObject({ kind: 'ended', restedMs: 95_000, skipped: false });
  });

  it('names the next exercise before the last set of one, and "last set" at the end', () => {
    const { state } = startFixture();
    const [w, b1, b2] = setsFor(state, BENCH);
    let s = apply(state, logCmd(w?.id ?? '', values(kg(60), 10), 5));
    s = apply(s, logCmd(b1?.id ?? '', values(kg(100), 8), 100));
    const f = focus(view(s, { nowMs: ms(110) }));
    expect(f.setId).toBe(b2?.id);
    expect(f.next).toMatchObject({ kind: 'exercise', name: 'Cable row' });
    expect(plain(f.next?.kind === 'exercise' ? f.next.target : '')).toBe('Target 50 kg stack × 10–12');
  });

  it('paused: Resume is the primary and rest is frozen', () => {
    const { state } = startFixture();
    let s = apply(state, logCmd(setsFor(state, BENCH)[0]?.id ?? '', values(kg(60), 10), 5));
    s = apply(s, { type: 'pause', at: at(20), opId: 'p1' });
    const v = view(s, { nowMs: ms(500) });
    expect(v.primary).toEqual({ kind: 'resume', label: 'Resume' });
    expect(v.rest).toEqual({ kind: 'paused', remainingMs: 45_000 });
    expect(v.paused).toBe(true);
  });

  it('final set done: no rest, primary Finish workout', () => {
    const { state } = startFixture();
    let s = state;
    let t = 5;
    for (const set of [...state.sets]) {
      s = apply(s, { type: 'set_active_set', at: at(t), opId: `a${String(t)}`, setId: set.id, expectedVersion: s.session.version });
      const f = focus(view(s, { nowMs: ms(t) }));
      const vals = f.measurement === 'duration' ? { ...values(null, null), durationS: 45 } : f.logValues;
      s = apply(s, logCmd(set.id, vals, t + 1));
      t += 10;
    }
    const v = view(s, { nowMs: ms(t) });
    expect(v.phase).toBe('all_done');
    expect(v.focus).toBeNull();
    expect(v.primary).toEqual({ kind: 'finish', label: 'Finish workout' });
    expect(v.rest).toBeNull();
    expect(v.progress).toEqual({ done: 8, total: 8 });
  });
});

describe('buildActiveSetView: empty workout and equipment conventions', () => {
  it('empty: Add exercise, not All done', () => {
    const state = startWorkout({ opId: 's', owner: profile(), gymId: GYM, routine: null, exercises: new Map(), gymEquipment: [], at: at(0), newId: idGen() }).aggregate;
    const v = view(state);
    expect(v.phase).toBe('empty');
    expect(v.primary).toEqual({ kind: 'add_exercise', label: 'Add exercise' });
  });

  it('per-hand dumbbells (kg): Enter load, steps from the rack, max disabled with a reason, off-profile warning', () => {
    const db = dumbbells();
    const press = exercise(210, 'Dumbbell press', { compatibleEquipment: ['dumbbells'], defaultLoadConvention: 'per_hand' });
    const s = emptyWith(press, db);
    const f = focus(view(s));
    expect(view(s).primary).toEqual({ kind: 'enter', field: 'load', label: 'Enter load' });
    expect(f.target).toBeNull();
    expect(f.loadField).toMatchObject({ label: 'Load each', unitText: 'kg each', value: null, up: { enabled: true, value: 5 }, down: { enabled: false } });
    const atMax = focus(view(s, { edits: { setId: f.setId, values: values(kg(30, 'per_hand'), 10) } }));
    expect(atMax.loadField?.up).toEqual({ enabled: false, reason: `Rack maximum 30${NBSP}kg${NBSP}each` });
    expect(plain(atMax.logLabel)).toBe('Log 30 kg each × 10');
    expect(atMax.offProfileWarning).toBeNull();
    const off = focus(view(s, { edits: { setId: f.setId, values: values(kg(37.5, 'per_hand'), 8) } }));
    expect(plain(off.offProfileWarning)).toBe('37.5 kg each isn’t on Home dumbbells at Main Gym (max 30 kg each). Log it anyway if that’s what you lifted, or update the gym.');
    expect(plain(off.logLabel)).toBe('Log 37.5 kg each × 8');
  });

  it('lb equipment shows lb, never a converted number', () => {
    const db = dumbbells({ unit: 'lb', loads: [10, 15, 20, 25, 30, 35, 40, 45, 50] });
    const press = exercise(211, 'Dumbbell press', { compatibleEquipment: ['dumbbells'], defaultLoadConvention: 'per_hand' });
    const s = emptyWith(press, db, 'lb');
    const f = focus(view(s, { edits: { setId: focus(view(s)).setId, values: values(lb(45, 'per_hand'), 10) } }));
    expect(plain(f.logLabel)).toBe('Log 45 lb each × 10');
    expect(f.loadField).toMatchObject({ unitText: 'lb each', up: { value: 50 }, down: { value: 40 } });
  });

  it('assisted machine: the field reads Assist and + means more assistance', () => {
    const a = assisted();
    const pull = exercise(212, 'Assisted pull-up', { compatibleEquipment: ['assisted_stack'], defaultLoadConvention: 'assistance' });
    const s = emptyWith(pull, a);
    const f = focus(view(s, { edits: { setId: focus(view(s)).setId, values: values(kg(20, 'assistance'), 6) } }));
    expect(f.loadField).toMatchObject({ label: 'Assist', assisted: true, up: { value: 25 }, down: { value: 15 } });
    expect(plain(f.logLabel)).toBe('Log Assist 20 kg × 6');
  });

  it('weight stack and bodyweight: stack suffix; bodyweight has no load field and logs BW', () => {
    const st = stack();
    const row = exercise(213, 'Cable row', { compatibleEquipment: ['weight_stack'], defaultLoadConvention: 'stack' });
    const s = emptyWith(row, st);
    expect(plain(focus(view(s, { edits: { setId: focus(view(s)).setId, values: values(kg(45, 'stack'), 12) } })).logLabel)).toBe('Log 45 kg stack × 12');

    const dip = exercise(214, 'Dip', { compatibleEquipment: ['bodyweight_station'], defaultLoadConvention: 'bodyweight' });
    const b = emptyWith(dip, bodyweightStation());
    const fb = focus(view(b, { edits: { setId: focus(view(b)).setId, values: values(null, 12) } }));
    expect(fb.loadField).toBeNull();
    expect(plain(fb.logLabel)).toBe('Log BW × 12');
    // The label's values are exactly what log_set saves.
    const logged = apply(b, logCmd(fb.setId, fb.logValues, 5));
    expect(logged.sets.find((x) => x.id === fb.setId)?.actual?.load).toEqual({ value: 0, unit: 'kg', convention: 'bodyweight' });
  });

  it('unilateral: Both sides by default; a Left log adds a fixed Right set next', () => {
    const db = dumbbells();
    const split = exercise(215, 'Split squat', { compatibleEquipment: ['dumbbells'], defaultLoadConvention: 'per_hand', laterality: 'unilateral' });
    const s = emptyWith(split, db);
    const f = focus(view(s, { edits: { setId: focus(view(s)).setId, values: values(kg(15, 'per_hand'), 10) } }));
    expect(f.side).toEqual({ kind: 'choice', value: 'both' });
    expect(plain(f.headerLine)).toBe('Dumbbells · Working · Set 1 of 1 · per side');
    expect(plain(f.logLabel)).toBe('Log 15 kg each × 10 per side');
    const left = focus(view(s, { edits: { setId: f.setId, values: values(kg(15, 'per_hand'), 10), side: 'left' } }));
    expect(plain(left.logLabel)).toBe('Log Left · 15 kg each × 10');
    expect(left.logSide).toBe('left');
    const after = apply(s, logCmd(left.setId, left.logValues, 5, 'op-left', 'left'));
    const right = focus(view(after, { nowMs: ms(6) }));
    expect(right.side).toEqual({ kind: 'fixed', value: 'right' });
    expect(right.logSide).toBeUndefined();
    expect(plain(right.logLabel)).toBe('Log Right · 15 kg each × 10');
    expect(right.rows.map((r) => r.badges.join(''))).toEqual(['L', 'R']);
  });

  it('pain-flagged exercises carry the note; it never blocks Log', () => {
    const s = emptyWith(exercise(216, 'Overhead press'), barbell());
    const f = focus(view(s, { painFlagged: new Set([id(216)]), edits: { setId: focus(view(s)).setId, values: values(kg(40), 8) } }));
    expect(f.painFlagged).toBe(true);
    expect(f.logLabel).not.toBeNull();
  });
});

describe('last comparable session (prefill and the Last line)', () => {
  const bar = barbell();
  const hist = (sessionId: number, day: number, equipmentId: string | null, load: ReturnType<typeof kg>) => ({
    sessionId: id(sessionId),
    performedAtUtc: at(-day * 86_400).utc,
    equipmentId,
    gymId: GYM,
    imported: false,
    sets: [{ setType: 'working' as const, side: null, load, reps: 8, rpe: 8, rir: null }],
  });

  it('only like-for-like history is offered: same equipment, unit and convention', () => {
    const ex = { equipmentId: bar.id, unit: 'kg' as const, loadConvention: 'total' as const };
    expect(lastComparableSession([hist(1, 1, id(999), kg(100)), hist(2, 3, bar.id, kg(95))], ex)?.sets[0]?.values.load).toEqual(kg(95));
    expect(lastComparableSession([hist(1, 1, bar.id, lb(225)), hist(2, 3, bar.id, kg(95))], ex)?.performedAtUtc).toBe(at(-3 * 86_400).utc);
    expect(lastComparableSession([hist(1, 1, bar.id, lb(225))], ex)).toBeNull();
  });

  it('an added exercise prefills from last time (effort never prefilled) and shows Last', () => {
    const s = emptyWith(exercise(217, 'Bench press'), bar);
    const sx = s.exercises[0]?.id ?? '';
    const previous = { [sx]: lastComparableSession([hist(2, 7, bar.id, kg(95))], { equipmentId: bar.id, unit: 'kg', loadConvention: 'total' }) };
    const f = focus(view(s, { previous }));
    expect(f.draftSource).toBe('last_session');
    expect(f.draft).toEqual(values(kg(95), 8));
    expect(plain(f.previous?.text)).toBe('95 kg × 8');
    expect(plain(f.logLabel)).toBe('Log 95 kg × 8');
  });
});

describe('buildSetEditView (correction sheet)', () => {
  it('uses the same achievable-load steps and only opens on logged sets', () => {
    const s = emptyWith(exercise(218, 'Bench press'), barbell());
    const setId = s.session.activeSetId ?? '';
    expect(buildSetEditView(s, setId, null)).toBeNull();
    const logged = apply(s, logCmd(setId, values(kg(100), 8), 5));
    const v = buildSetEditView(logged, setId, null);
    expect(v).toMatchObject({ setNumber: 1, changed: false, loadField: { up: { value: 102.5 }, down: { value: 97.5 } }, reps: { up: { value: 9 } } });
    const edited = buildSetEditView(logged, setId, values(kg(100), 7));
    expect(edited?.changed).toBe(true);
    expect(plain(edited?.text)).toBe('100 kg × 7');
  });
});
