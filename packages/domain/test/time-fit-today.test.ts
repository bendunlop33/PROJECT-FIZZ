import { describe, expect, it } from 'vitest';
import { SessionAggregateSchema, type BuilderGroup, type Exercise, type SessionAggregate, type WorkoutSet } from '@fizz/schemas';
import { fitTodayCommand, reduceSession, startWorkout, timeFitLineText, timeFitOffer, type BuilderExerciseInfo, type TimeFitOffer } from '../src/index';
import { at, barbell, dumbbells, exercise, GYM, idGen, kg, lb, profile, routine, routineExercise, stack, template, values } from './fixtures';
import { apply, expectError, expectOk, HANG, logCmd, setsFor, startFixture } from './session-fixture';

/*
 * workout-table-v3 §5 (b3 merge): `+N min` offers the builder's fit ladder
 * over the sets left — shorter rests → RPE 9 → fewer sets → drop an
 * exercise, never the main lift — as one offer. Applied only on Ben's Apply
 * (rule 3), versioned (rule 5), one Undo; done sets never change (rule 2).
 */

const BENCH = exercise(701, 'Bench press', { compatibleEquipment: ['barbell'] });
const RAISE = exercise(702, 'Lateral raise', { compatibleEquipment: ['dumbbells'], defaultLoadConvention: 'per_hand' });
const FLY = exercise(703, 'Cable fly', { compatibleEquipment: ['weight_stack'], defaultLoadConvention: 'stack' });
const CRUNCH = exercise(704, 'Cable crunch', { compatibleEquipment: ['weight_stack'], defaultLoadConvention: 'stack' });

const infoOf = (e: Exercise, group: BuilderGroup, role: 'compound' | 'isolation'): BuilderExerciseInfo => ({ exerciseId: e.id, name: e.name, group, role, heavy: role === 'compound', part: group, muscles: [group.toLowerCase()], angle: group, barbell: role === 'compound' });
const INFO = new Map<string, BuilderExerciseInfo>([
  [BENCH.id, infoOf(BENCH, 'Chest', 'compound')],
  [RAISE.id, infoOf(RAISE, 'Shoulders', 'isolation')],
  [FLY.id, infoOf(FLY, 'Chest', 'isolation')],
  [CRUNCH.id, infoOf(CRUNCH, 'Abs', 'isolation')],
]);
const info = (id: string) => INFO.get(id) ?? null;

const three = (n: number, load: ReturnType<typeof kg>, lastRpe = 9) => [n + 1, n + 2, n + 3].map((k, i) => template(k, { targetLoad: load, targetReps: { min: 12, max: 12 }, targetRpe: i === 2 ? lastRpe : 8 }));

/** Bench (warm-up, top, 2 back-offs) then lateral raise (lb, per hand), cable fly, cable crunch: 3 sets each. */
function start(): SessionAggregate {
  const r = routine([
    routineExercise(710, {
      exerciseId: BENCH.id,
      equipmentId: barbell().id,
      order: 0,
      setTemplates: [
        template(7101, { setType: 'warmup', targetLoad: kg(60), targetReps: { min: 8, max: 8 } }),
        template(7102, { setType: 'top', targetLoad: kg(100), targetReps: { min: 5, max: 5 }, targetRpe: 9 }),
        template(7103, { setType: 'backoff', targetLoad: kg(90), targetReps: { min: 8, max: 8 }, targetRpe: 8 }),
        template(7104, { setType: 'backoff', targetLoad: kg(90), targetReps: { min: 8, max: 8 }, targetRpe: 8 }),
      ],
      restBySetType: { warmup: { seconds: 60, presetName: 'Warm-up' }, top: { seconds: 210, presetName: 'Top' }, backoff: { seconds: 180, presetName: 'Heavy' } },
    }),
    routineExercise(711, { exerciseId: RAISE.id, equipmentId: dumbbells({ unit: 'lb' } as never).id, order: 1, setTemplates: three(7110, lb(20, 'per_hand'), 8), restBySetType: { working: { seconds: 90, presetName: 'Iso' } } }),
    routineExercise(712, { exerciseId: FLY.id, equipmentId: stack().id, order: 2, setTemplates: three(7120, kg(25, 'stack')), restBySetType: { working: { seconds: 90, presetName: 'Iso' } } }),
    routineExercise(713, { exerciseId: CRUNCH.id, equipmentId: stack().id, order: 3, setTemplates: three(7130, kg(30, 'stack')), restBySetType: { working: { seconds: 90, presetName: 'Iso' } } }),
  ]);
  return startWorkout({
    opId: 'fit-start',
    owner: profile(),
    gymId: GYM,
    routine: r,
    exercises: new Map([BENCH, RAISE, FLY, CRUNCH].map((e) => [e.id, e])),
    gymEquipment: [barbell(), dumbbells(), stack()],
    at: at(0),
    newId: idGen(72_000),
  }).aggregate;
}

const exId = (s: SessionAggregate, e: Exercise) => s.exercises.find((x) => x.exerciseId === e.id)?.id ?? '';
const setsOf = (s: SessionAggregate, e: Exercise): WorkoutSet[] => s.sets.filter((x) => x.sessionExerciseId === exId(s, e)).sort((a, b) => a.index - b.index);
const offer = (s: SessionAggregate, overByMinutes: number, painFlagged?: ReadonlySet<string>): TimeFitOffer => timeFitOffer({ aggregate: s, overByMinutes, info, ...(painFlagged ? { painFlagged } : {}) });
const applyOffer = (s: SessionAggregate, o: TimeFitOffer, opId = 'fit-1', t = 400) => {
  const cmd = fitTodayCommand(o, { opId, at: at(t) });
  if (cmd === null) throw new Error('no command');
  return { cmd, r: reduceSession(s, cmd) };
};
/** The bench warm-up and top set done, so the workout is under way. */
function underWay(): SessionAggregate {
  let s = start();
  const [w, top] = setsOf(s, BENCH);
  s = apply(s, logCmd(w?.id ?? '', values(kg(60), 8), 30));
  s = apply(s, logCmd(top?.id ?? '', values(kg(100), 5), 120));
  return s;
}
const view = (s: SessionAggregate) => s.sets.map((x) => ({ id: x.id, status: x.status, rest: x.rest.seconds, rpe: x.planned.rpeOverride ?? x.planned.rpe, load: x.planned.load }));

describe('timeFitOffer: the builder ladder over the sets left (v3 §5)', () => {
  it('not over: nothing offered', () => {
    expect(offer(underWay(), 0)).toMatchObject({ status: 'none', steps: [], lines: [] });
  });

  it('a little over: shorter rests only, on working sets; warm-ups and done sets never change', () => {
    const s = underWay();
    const o = offer(s, 1);
    expect(o.status).toBe('fitted');
    expect(o.lines).toEqual([{ kind: 'rest', sets: expect.any(Number) as number }]);
    expect(o.lines.map(timeFitLineText)).toEqual(['Shorter rests']);
    for (const st of o.steps) {
      expect(st.type).toBe('edit_planned_set');
      if (st.type !== 'edit_planned_set') continue;
      const set = s.sets.find((x) => x.id === st.setId);
      expect(set?.status).toBe('pending');
      expect(set?.setType).not.toBe('warmup');
      expect(st.patch.restS).toBeLessThan(set?.rest.seconds ?? 0);
      // Never a load, reps or set type (rule 4: no new loads to check).
      expect(Object.keys(st.patch).sort()).toEqual(['restS']);
    }
  });

  it('more over: the ladder in order — rests, then RPE 9 on an accessory’s last set, then fewer accessory sets', () => {
    const s = underWay();
    const o = offer(s, 8);
    expect(o.lines.map(timeFitLineText)).toEqual(['Shorter rests', 'Lateral raise · last set @ 9', 'Cable fly · 3 → 2 sets', 'Cable crunch · 3 → 2 sets']);
    const after = expectOk(applyOffer(s, o).r).state;
    const raise = setsOf(after, RAISE);
    expect(raise.map((x) => x.planned.rpeOverride ?? x.planned.rpe)).toEqual([8, 8, 9]);
    // The lb, per-hand load is as it was (nothing snapped or converted).
    expect(raise.map((x) => x.planned.load)).toEqual(setsOf(s, RAISE).map((x) => x.planned.load));
    expect(setsOf(after, FLY).filter((x) => x.status === 'pending')).toHaveLength(2);
    expect(setsOf(after, FLY).filter((x) => x.status === 'deleted')).toHaveLength(1);
  });

  it('far over: rests, effort, fewer sets, then abs dropped first; the main lift is never trimmed or dropped', () => {
    const s = underWay();
    const o = offer(s, 12);
    const text = o.lines.map(timeFitLineText);
    expect(text[0]).toBe('Shorter rests');
    expect(text).toContain('Cable crunch · skip');
    expect(text.some((t) => t.startsWith('Bench press'))).toBe(false);
    const benchIds = new Set(setsOf(s, BENCH).map((x) => x.id));
    for (const st of o.steps) {
      if (st.type === 'delete_set') expect(benchIds.has(st.setId)).toBe(false);
      if (st.type === 'skip_exercise') expect(st.sessionExerciseId).not.toBe(exId(s, BENCH));
      if (st.type === 'edit_planned_set') expect(st.patch.load).toBeUndefined();
    }
    expect(o.savedMinutes).toBeGreaterThan(0);
    expect(o.afterMinutes).toBeLessThan(o.beforeMinutes);
  });

  it('a pain-flagged accessory is never trimmed, pushed or dropped (rule 9)', () => {
    const s = underWay();
    const o = offer(s, 30, new Set([RAISE.id, CRUNCH.id, FLY.id]));
    const flagged = new Set([exId(s, RAISE), exId(s, FLY), exId(s, CRUNCH)]);
    const flaggedSets = new Set(s.sets.filter((x) => flagged.has(x.sessionExerciseId)).map((x) => x.id));
    for (const st of o.steps) {
      if (st.type === 'skip_exercise') expect(flagged.has(st.sessionExerciseId)).toBe(false);
      if (st.type === 'delete_set') expect(flaggedSets.has(st.setId)).toBe(false);
      if (st.type === 'edit_planned_set' && flaggedSets.has(st.setId)) expect(st.patch.targetRpe).toBeUndefined();
    }
    // Nothing left but rests: the most it can do, honestly `over`.
    expect(o.status).toBe('over');
  });
});

describe('fit_today_to_time: Apply and Undo', () => {
  it('Apply changes only pending sets, as one version bump; Undo puts every one back exactly', () => {
    const s = underWay();
    const o = offer(s, 12);
    const { r } = applyOffer(s, o);
    const after = expectOk(r).state;
    expect(after.session.version).toBe(s.session.version + 1);
    expect(SessionAggregateSchema.safeParse(after).success).toBe(true);
    // Done sets are as they were (rule 2).
    for (const done of s.sets.filter((x) => x.status === 'completed')) expect(after.sets.find((x) => x.id === done.id)).toEqual(done);
    expect(setsOf(after, CRUNCH).every((x) => x.status === 'skipped')).toBe(true);
    // Undo, after a JSON round trip (a relaunch reads the stored workout).
    const stored = SessionAggregateSchema.parse(JSON.parse(JSON.stringify(after)));
    const back = expectOk(reduceSession(stored, { type: 'undo_op', at: at(420), opId: 'undo-fit-1', targetOpId: 'fit-1' })).state;
    expect(view(back)).toEqual(view(s));
  });

  it('a stale offer is refused once the workout moved on (rule 5)', () => {
    const s = underWay();
    const o = offer(s, 12);
    const [, , b1] = setsOf(s, BENCH);
    const moved = apply(s, logCmd(b1?.id ?? '', values(kg(90), 8), 300));
    expectError(applyOffer(moved, o).r, 'stale_version');
  });

  it('a replayed Apply (same opId) changes nothing', () => {
    const s = underWay();
    const o = offer(s, 12);
    const { cmd, r } = applyOffer(s, o);
    const once = expectOk(r).state;
    const twice = reduceSession(once, cmd);
    expect(twice.ok && twice.duplicate).toBe(true);
    expect(twice.state).toBe(once);
  });

  it('Undo after Ben logged a set whose rest the fit shortened: the logged set stays, the rest comes back', () => {
    const s = underWay();
    const o = offer(s, 12);
    const after = expectOk(applyOffer(s, o).r).state;
    const [, , b1] = setsOf(after, BENCH);
    expect(b1?.planned.edit?.opId).toBe('fit-1:0');
    const logged = apply(after, logCmd(b1?.id ?? '', values(kg(90), 8), 500));
    const back = expectOk(reduceSession(logged, { type: 'undo_op', at: at(520), opId: 'undo-fit-2', targetOpId: 'fit-1' })).state;
    expect(back.sets.find((x) => x.id === b1?.id)?.status).toBe('completed');
    expect(setsOf(back, CRUNCH).every((x) => x.status === 'pending')).toBe(true);
    const [, , , b2] = setsOf(back, BENCH);
    expect(b2?.rest.seconds).toBe(setsOf(s, BENCH)[3]?.rest.seconds);
  });
});

describe('supersets and timed sets', () => {
  it('a superset keeps its no-rest a → b; only rests that exist get shorter; a timed exercise is left alone', () => {
    const { state } = startFixture();
    const o = timeFitOffer({ aggregate: state, overByMinutes: 30, info: () => null });
    const byId = new Map(state.sets.map((x) => [x.id, x]));
    const hang = new Set(setsFor(state, HANG).map((x) => x.id));
    for (const st of o.steps) {
      if (st.type === 'edit_planned_set' && st.patch.restS !== undefined) {
        expect(byId.get(st.setId)?.rest.seconds ?? 0).toBeGreaterThan(st.patch.restS);
      }
      if (st.type === 'delete_set') expect(hang.has(st.setId)).toBe(false);
      if (st.type === 'skip_exercise') expect(state.exercises.find((e) => e.id === st.sessionExerciseId)?.exerciseId).not.toBe(HANG);
    }
    const cmd = fitTodayCommand(o, { opId: 'fit-ss', at: at(10) });
    if (cmd !== null) expectOk(reduceSession(state, cmd));
  });
});
