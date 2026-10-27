import { describe, expect, it } from 'vitest';
import { SessionAggregateSchema, type BuilderGroup, type Exercise, type SessionAggregate, type WorkoutSet } from '@fizz/schemas';
import { fitTodayCommand, reduceSession, startWorkout, timeFitLineText, timeFitOffer, undoableTimeFit, type BuilderExerciseInfo, type TimeFitOffer } from '../src/index';
import { at, barbell, dumbbells, exercise, GYM, idGen, kg, lb, profile, routine, routineExercise, stack, template, values } from './fixtures';
import { apply, BENCH as SS_BENCH, expectError, expectOk, FACE, HANG, logCmd, ROW, setsFor, startFixture } from './session-fixture';

/*
 * workout-table-v3 §5 (b3 merge): `+N min` offers the builder's fit ladder
 * over the sets left — shorter rests → RPE 9 → the cheapest cut (fit-to-time
 * 22 Oct revision: a set or a whole exercise, least training lost per minute),
 * never the main lift — as one offer. Applied only on Ben's Apply
 * (rule 3), versioned (rule 5), one Undo; done sets never change (rule 2).
 */

const BENCH = exercise(701, 'Bench press', { compatibleEquipment: ['barbell'] });
const RAISE = exercise(702, 'Lateral raise', { compatibleEquipment: ['dumbbells'], defaultLoadConvention: 'per_hand' });
const FLY = exercise(703, 'Cable fly', { compatibleEquipment: ['weight_stack'], defaultLoadConvention: 'stack' });
const CRUNCH = exercise(704, 'Cable crunch', { compatibleEquipment: ['weight_stack'], defaultLoadConvention: 'stack' });
const PLANK = exercise(705, 'Plank', { measurement: 'duration', compatibleEquipment: ['bodyweight_station'], defaultLoadConvention: 'bodyweight' });

const infoOf = (e: Exercise, group: BuilderGroup, role: 'compound' | 'isolation'): BuilderExerciseInfo => ({ exerciseId: e.id, name: e.name, group, role, heavy: role === 'compound', part: group, muscles: [group.toLowerCase()], angle: group === 'Core' ? 'Abs' : group, barbell: role === 'compound' });
const INFO = new Map<string, BuilderExerciseInfo>([
  [BENCH.id, infoOf(BENCH, 'Chest', 'compound')],
  [RAISE.id, infoOf(RAISE, 'Shoulders', 'isolation')],
  [FLY.id, infoOf(FLY, 'Chest', 'isolation')],
  [CRUNCH.id, infoOf(CRUNCH, 'Core', 'isolation')],
  [PLANK.id, infoOf(PLANK, 'Core', 'isolation')],
]);
const info = (id: string) => INFO.get(id) ?? null;

const three = (n: number, load: ReturnType<typeof kg>, lastRpe = 9) => [n + 1, n + 2, n + 3].map((k, i) => template(k, { targetLoad: load, targetReps: { min: 12, max: 12 }, targetRpe: i === 2 ? lastRpe : 8 }));

/** Bench (warm-up, top, 2 back-offs) then lateral raise (lb, per hand), cable fly, cable crunch: 3 sets each; `plank`: then a timed plank, 3 × 45 s. */
function start(opts: { plank?: boolean } = {}): SessionAggregate {
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
    ...(opts.plank === true
      ? [routineExercise(714, { exerciseId: PLANK.id, order: 4, setTemplates: [7141, 7142, 7143].map((k) => template(k, { targetReps: null, targetDurationS: 45 })), restBySetType: { working: { seconds: 90, presetName: 'Iso' } } })]
      : []),
  ]);
  return startWorkout({
    opId: 'fit-start',
    owner: profile(),
    gymId: GYM,
    routine: r,
    exercises: new Map([BENCH, RAISE, FLY, CRUNCH, PLANK].map((e) => [e.id, e])),
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
function underWay(opts: { plank?: boolean } = {}): SessionAggregate {
  let s = start(opts);
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
    expect(o.lines.length).toBeGreaterThan(0);
    expect(o.lines.every((l) => l.kind === 'rest')).toBe(true);
    // One line per exercise with before → after (rule 2: the change is shown, not summarised).
    for (const t of o.lines.map(timeFitLineText)) expect(t).toMatch(/ rest \d+:\d\d → \d+:\d\d$/);
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

  it('more over: the ladder in order — rests, then RPE 9 on an accessory’s last set, then the cheapest cut (one lateral raise set is enough)', () => {
    const s = underWay();
    // (Ben, 27 Oct) The bench's rests never shorten for time, so 5 over (was 7) is where one raise set is enough.
    const o = offer(s, 5);
    expect(o.lines.map(timeFitLineText)).toEqual([
      'Lateral raise rest 1:30 → 1:00',
      'Cable fly rest 1:30 → 1:00',
      'Cable crunch rest 1:30 → 1:00',
      // Review S2: an exercise that loses a set and has its new last set pushed shows both.
      'Lateral raise 3 → 2 sets',
      'Lateral raise last set @8 → @9',
    ]);
    const after = expectOk(applyOffer(s, o).r).state;
    const raise = setsOf(after, RAISE);
    expect(raise.filter((x) => x.status === 'pending').map((x) => x.planned.rpeOverride ?? x.planned.rpe)).toEqual([8, 9]);
    expect(raise.filter((x) => x.status === 'deleted')).toHaveLength(1);
    // The lb, per-hand load is as it was (nothing snapped or converted).
    expect(raise.filter((x) => x.status === 'pending').map((x) => x.planned.load)).toEqual(setsOf(s, RAISE).slice(0, 2).map((x) => x.planned.load));
    expect(setsOf(after, FLY).filter((x) => x.status === 'pending')).toHaveLength(3);
  });

  it('far over: rests, then the cheapest cut: the other group’s isolation (a lateral raise on a chest day) is skipped first; the main lift is never trimmed or dropped', () => {
    const s = underWay();
    const o = offer(s, 12);
    const text = o.lines.map(timeFitLineText);
    expect(text[0]).toBe('Cable fly rest 1:30 → 1:00');
    expect(text).toContain('Skip: Lateral raise');
    expect(text).not.toContain('Skip: Cable fly');
    // (Ben, 27 Oct) The main lift: its sets, loads and rests never change for time (its rests did shorten before).
    expect(text.some((t) => t.startsWith('Bench press'))).toBe(false);
    const benchIds = new Set(setsOf(s, BENCH).map((x) => x.id));
    for (const st of o.steps) {
      if (st.type === 'delete_set' || st.type === 'edit_planned_set') expect(benchIds.has(st.setId)).toBe(false);
      if (st.type === 'skip_exercise') expect(st.sessionExerciseId).not.toBe(exId(s, BENCH));
      if (st.type === 'edit_planned_set') expect(st.patch.load).toBeUndefined();
    }
    expect(o.savedMinutes).toBeGreaterThan(0);
    expect(o.afterMinutes).toBeLessThan(o.beforeMinutes);
  });

  it('the draft’s main lifts (two on a plan day) are never trimmed or dropped', () => {
    const s = underWay();
    const o = timeFitOffer({ aggregate: s, overByMinutes: 30, info, mainExerciseIds: new Set([BENCH.id, RAISE.id]) });
    const raise = exId(s, RAISE);
    expect(o.lines.some((l) => (l.kind === 'sets' || l.kind === 'drop') && l.sessionExerciseId === raise)).toBe(false);
    expect(o.lines.some((l) => l.kind === 'drop')).toBe(true);
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
    // Nothing left to change: every accessory is flagged and the main lift's rests never shorten for time (Ben, 27 Oct;
    // before, its rests made this an `over` offer), so there is no offer.
    expect(o.status).toBe('none');
    expect(o.steps).toEqual([]);
  });
});

describe('left exactly as they are: Ben’s own edits, pain flags, timed exercises (review build-a B1)', () => {
  const touchedSets = (o: TimeFitOffer): Set<string> => new Set(o.steps.flatMap((st) => (st.type === 'edit_planned_set' || st.type === 'delete_set' ? [st.setId] : [])));

  it('a rest Ben set himself is never shortened, nor anything else on that exercise', () => {
    let s = underWay();
    const b1 = setsOf(s, BENCH)[2];
    s = apply(s, { type: 'edit_planned_set', at: at(200), opId: 'ben-rest', setId: b1?.id ?? '', expectedSetVersion: b1?.version ?? 0, patch: { restS: 300 } });
    for (const over of [1, 8, 12]) {
      const o = offer(s, over);
      const hit = touchedSets(o);
      for (const set of setsOf(s, BENCH)) expect(hit.has(set.id)).toBe(false);
      expect(o.lines.some((l) => l.name === 'Bench press')).toBe(false);
      if (o.steps.length > 0) {
        const after = expectOk(applyOffer(s, o).r).state;
        expect(after.sets.find((x) => x.id === b1?.id)?.rest.seconds).toBe(300);
      }
    }
  });

  // Review build-a R1: "Rest after" (`set_rest_after`) is the main way Ben sets a rest mid-workout.
  const restAfter = (s: SessionAggregate, setId: string, seconds: number, scope: 'set' | 'exercise', opId: string): SessionAggregate =>
    apply(s, { type: 'set_rest_after', at: at(200), opId, setId, seconds, scope, expectedVersion: s.session.version });

  it('a rest Ben set for one set with "Rest after" is never shortened, nor anything else on that exercise (review R1)', () => {
    let s = underWay();
    const fly2 = setsOf(s, FLY)[1];
    s = restAfter(s, fly2?.id ?? '', 240, 'set', 'ben-rest-after-set');
    // Kept across a relaunch (the stored workout, parsed back).
    s = SessionAggregateSchema.parse(JSON.parse(JSON.stringify(s)));
    expect(s.sets.find((x) => x.id === fly2?.id)?.rest.byOpId).toBe('ben-rest-after-set');
    const flyIds = new Set(setsOf(s, FLY).map((x) => x.id));
    for (const over of [1, 8, 30]) {
      const o = offer(s, over);
      for (const id of touchedSets(o)) expect(flyIds.has(id)).toBe(false);
      expect(o.steps.some((st) => st.type === 'skip_exercise' && st.sessionExerciseId === exId(s, FLY))).toBe(false);
      expect(o.lines.some((l) => l.name === 'Cable fly')).toBe(false);
      if (o.steps.length > 0) {
        const after = expectOk(applyOffer(s, o).r).state;
        expect(after.sets.find((x) => x.id === fly2?.id)?.rest.seconds).toBe(240);
      }
    }
  });

  it('a rest Ben set for the whole exercise with "Rest after" is never shortened, the main lift included (review R1)', () => {
    let s = underWay();
    const b1 = setsOf(s, BENCH)[2];
    s = restAfter(s, b1?.id ?? '', 300, 'exercise', 'ben-rest-after-ex');
    const pendingBench = setsOf(s, BENCH).filter((x) => x.status === 'pending');
    expect(pendingBench.map((x) => x.rest.seconds)).toEqual([300, 300]);
    for (const over of [1, 8, 30]) {
      const o = offer(s, over);
      const hit = touchedSets(o);
      for (const set of setsOf(s, BENCH)) expect(hit.has(set.id)).toBe(false);
      expect(o.lines.some((l) => l.name === 'Bench press')).toBe(false);
      if (o.steps.length > 0) {
        const after = expectOk(applyOffer(s, o).r).state;
        for (const set of pendingBench) expect(after.sets.find((x) => x.id === set.id)?.rest.seconds).toBe(300);
      }
    }
  });

  it('a superset member whose rest Ben set with "Rest after": the round keeps its rests, nothing in it is cut (review R1)', () => {
    const { state } = startFixture();
    const ssInfo = new Map<string, BuilderExerciseInfo>([
      [SS_BENCH, { exerciseId: SS_BENCH, name: 'Bench press', group: 'Chest', role: 'compound', heavy: true, part: 'Chest', muscles: ['chest'], angle: 'Chest', barbell: true }],
      [ROW, { exerciseId: ROW, name: 'Cable row', group: 'Back', role: 'isolation', heavy: false, part: 'Back', muscles: ['back'], angle: 'Back', barbell: false }],
      [FACE, { exerciseId: FACE, name: 'Face pull', group: 'Shoulders', role: 'isolation', heavy: false, part: 'Shoulders', muscles: ['shoulders'], angle: 'Shoulders', barbell: false }],
    ]);
    const face1 = setsFor(state, FACE)[0];
    const s = apply(state, { type: 'set_rest_after', at: at(10), opId: 'ben-ss-rest', setId: face1?.id ?? '', seconds: 150, scope: 'set', expectedVersion: state.session.version });
    const faceIds = new Set(setsFor(s, FACE).map((x) => x.id));
    const exIdOf = (a: SessionAggregate, e: string) => a.exercises.find((x) => x.exerciseId === e)?.id ?? '';
    for (const over of [1, 8, 30]) {
      const o = timeFitOffer({ aggregate: s, overByMinutes: over, info: (id) => ssInfo.get(id) ?? null });
      for (const id of touchedSets(o)) expect(faceIds.has(id)).toBe(false);
      // The round's rests stay as they are; the face pull (Ben's rest) is left exactly as it is. The other member may still lose sets or be skipped (later steps of the ladder).
      const rowIds = new Set(setsFor(s, ROW).map((x) => x.id));
      for (const st of o.steps) if (st.type === 'edit_planned_set' && rowIds.has(st.setId)) expect(st.patch.restS).toBeUndefined();
      expect(o.lines.some((l) => l.kind === 'rest' && (l.name === 'Cable row' || l.name === 'Face pull'))).toBe(false);
      expect(o.lines.some((l) => l.name === 'Face pull')).toBe(false);
      expect(o.steps.some((st) => st.type === 'skip_exercise' && st.sessionExerciseId === exIdOf(s, FACE))).toBe(false);
      const cmd = fitTodayCommand(o, { opId: `fit-ss-${String(over)}`, at: at(20) });
      if (cmd !== null) expect(expectOk(reduceSession(s, cmd)).state.sets.find((x) => x.id === face1?.id)?.rest.seconds).toBe(150);
    }
  });

  it('a pain-flagged exercise’s rests are never shortened (rule 9: no added density)', () => {
    const s = underWay();
    const flyIds = new Set(setsOf(s, FLY).map((x) => x.id));
    for (const over of [1, 8, 30]) {
      const o = offer(s, over, new Set([FLY.id]));
      for (const id of touchedSets(o)) expect(flyIds.has(id)).toBe(false);
      expect(o.lines.some((l) => l.name === 'Cable fly')).toBe(false);
    }
  });

  it('a timed exercise’s rests are never shortened', () => {
    const s = underWay({ plank: true });
    const plankIds = new Set(setsOf(s, PLANK).map((x) => x.id));
    expect(plankIds.size).toBe(3);
    for (const over of [1, 8, 30]) {
      const o = offer(s, over);
      for (const id of touchedSets(o)) expect(plankIds.has(id)).toBe(false);
      expect(o.steps.some((st) => st.type === 'skip_exercise' && st.sessionExerciseId === exId(s, PLANK))).toBe(false);
      expect(o.lines.some((l) => l.name === 'Plank')).toBe(false);
    }
  });

  it('the fit’s own earlier change isn’t taken for Ben’s: a second offer can still trim (review N4)', () => {
    const s = underWay();
    const first = offer(s, 1);
    const after = expectOk(applyOffer(s, first).r).state;
    const second = offer(after, 8);
    expect(second.lines.some((l) => l.kind === 'sets' || l.kind === 'effort' || l.kind === 'drop')).toBe(true);
  });
});

describe('the target never collapses (review S3)', () => {
  it('far more over than the ladder should save: fitted to half the sets left, honestly `over`, the main lift kept', () => {
    const s = underWay();
    const o = offer(s, 300);
    expect(o.status).toBe('over');
    expect(o.targetMinutes).toBeGreaterThanOrEqual(Math.floor(o.beforeMinutes / 2));
    // Fitted to that target, never past it by more than one cut (the cheapest cut can save more than needed).
    expect(o.afterMinutes).toBeLessThanOrEqual(o.targetMinutes);
    expect(o.afterMinutes).toBeGreaterThan(0);
    expect(o.savedMinutes).toBeGreaterThan(0);
    // Not everything droppable goes: at least one accessory stays.
    const skipped = new Set(o.steps.flatMap((st) => (st.type === 'skip_exercise' ? [st.sessionExerciseId] : [])));
    expect(skipped.has(exId(s, BENCH))).toBe(false);
    expect([RAISE, FLY, CRUNCH].some((e) => !skipped.has(exId(s, e)))).toBe(true);
  });

  it('within what it should save: `fitted`, target = sets left − overrun', () => {
    const o = offer(underWay(), 2);
    expect(o.status).toBe('fitted');
    expect(o.targetMinutes).toBeLessThan(o.beforeMinutes);
  });
});

describe('undoableTimeFit: `⋯ › Undo fit to time` while Undo would go through (review S1)', () => {
  it('none before a fit; the fit after Apply (also after a relaunch); none once undone', () => {
    const s = underWay();
    expect(undoableTimeFit(s, at(390))).toBeNull();
    const after = expectOk(applyOffer(s, offer(s, 12)).r).state;
    expect(undoableTimeFit(after, at(410))).toBe('fit-1');
    const stored = SessionAggregateSchema.parse(JSON.parse(JSON.stringify(after)));
    expect(undoableTimeFit(stored, at(410))).toBe('fit-1');
    const back = expectOk(reduceSession(stored, { type: 'undo_op', at: at(420), opId: 'undo-fit-1', targetOpId: 'fit-1' })).state;
    expect(undoableTimeFit(back, at(430))).toBeNull();
  });

  it('the latest fit only', () => {
    const s = underWay();
    const one = expectOk(applyOffer(s, offer(s, 1), 'fit-a', 400).r).state;
    const two = expectOk(applyOffer(one, offer(one, 8), 'fit-b', 500).r).state;
    expect(undoableTimeFit(two, at(510))).toBe('fit-b');
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
    expect(setsOf(after, RAISE).every((x) => x.status === 'skipped')).toBe(true);
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
    // (Ben, 27 Oct) A cable fly set: the bench's rests are no longer the fit's to shorten.
    const o = offer(s, 3);
    const after = expectOk(applyOffer(s, o).r).state;
    const [f1, f2] = setsOf(after, FLY);
    expect(f1?.planned.edit?.opId).toMatch(/^fit-1:\d+$/);
    expect(f2?.rest.seconds).toBe(60);
    const logged = apply(after, logCmd(f1?.id ?? '', values(kg(25, 'stack'), 12), 500));
    const back = expectOk(reduceSession(logged, { type: 'undo_op', at: at(520), opId: 'undo-fit-2', targetOpId: 'fit-1' })).state;
    expect(back.sets.find((x) => x.id === f1?.id)?.status).toBe('completed');
    expect(setsOf(back, FLY)[1]?.rest.seconds).toBe(setsOf(s, FLY)[1]?.rest.seconds);
    expect(setsOf(back, BENCH).map((x) => x.rest.seconds)).toEqual(setsOf(s, BENCH).map((x) => x.rest.seconds));
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

describe('(Ben, 27 Oct) the main lift’s rests never change; accessory rests only as far as `Rest when short on time`', () => {
  const lines = (o: TimeFitOffer) => o.lines.map(timeFitLineText);

  it('the main lift’s rests are never in the offer, even longer than the builder’s default, at any overrun', () => {
    // Bench back-offs at 4:00 (the routine's, not Ben's edit): still never shortened for time.
    let s = start();
    s = { ...s, sets: s.sets.map((x) => (x.sessionExerciseId === exId(s, BENCH) && x.setType === 'backoff' ? { ...x, rest: { ...x.rest, seconds: 240 } } : x)) };
    const [w, top] = setsOf(s, BENCH);
    s = apply(s, logCmd(w?.id ?? '', values(kg(60), 8), 30));
    s = apply(s, logCmd(top?.id ?? '', values(kg(100), 5), 120));
    const benchIds = new Set(setsOf(s, BENCH).map((x) => x.id));
    for (const n of [1, 3, 5, 12, 30]) {
      const o = offer(s, n);
      expect(lines(o).some((t) => t.startsWith('Bench press')), `${String(n)} over`).toBe(false);
      for (const st of o.steps) if (st.type === 'edit_planned_set' || st.type === 'delete_set') expect(benchIds.has(st.setId)).toBe(false);
    }
  });

  it('Minimum rest (default): isolation rests to 1:00; Medium rest: 1:15 and no lower; Standard rest: no rest change, sets instead', () => {
    const s = underWay();
    const at3 = (fitRestLevel?: 'normal' | 'shorter' | 'shortest') => timeFitOffer({ aggregate: s, overByMinutes: 3, info, ...(fitRestLevel === undefined ? {} : { fitRestLevel }) });
    expect(lines(at3())).toEqual(['Lateral raise rest 1:30 → 1:00', 'Cable fly rest 1:30 → 1:00', 'Cable crunch rest 1:30 → 1:00']);
    expect(lines(at3('shortest'))).toEqual(lines(at3()));
    const medium = at3('shorter');
    expect(medium.lines.filter((l) => l.kind === 'rest').map(timeFitLineText)).toEqual(['Lateral raise rest 1:30 → 1:15', 'Cable fly rest 1:30 → 1:15', 'Cable crunch rest 1:30 → 1:15']);
    expect(medium.lines.some((l) => l.kind === 'sets')).toBe(true);
    const standard = at3('normal');
    expect(standard.lines.some((l) => l.kind === 'rest')).toBe(false);
    expect(standard.lines.some((l) => l.kind === 'sets')).toBe(true);
    expect(standard.lines.some((l) => l.kind === 'drop')).toBe(false);
    for (const o of [at3(), medium, standard]) expect(o.status).toBe('fitted');
  });

  it('a compound accessory’s rest goes to 1:30 and no lower', () => {
    // The lateral raise read as a compound accessory (2:00 by the routine) for this check.
    const s0 = start();
    const s1 = { ...s0, sets: s0.sets.map((x) => (x.sessionExerciseId === exId(s0, RAISE) ? { ...x, rest: { ...x.rest, seconds: 120 } } : x)) };
    const [w, top] = setsOf(s1, BENCH);
    let s = apply(s1, logCmd(w?.id ?? '', values(kg(60), 8), 30));
    s = apply(s, logCmd(top?.id ?? '', values(kg(100), 5), 120));
    const compoundInfo = (id: string) => (id === RAISE.id ? { ...infoOf(RAISE, 'Shoulders', 'compound'), heavy: false, barbell: false } : info(id));
    for (const n of [2, 4, 8]) {
      const o = timeFitOffer({ aggregate: s, overByMinutes: n, info: compoundInfo });
      const raise = o.lines.filter((l) => l.kind === 'rest' && l.sessionExerciseId === exId(s, RAISE));
      for (const l of raise) if (l.kind === 'rest') expect(l.toS, `${String(n)} over`).toBe(90);
      expect(raise.length, `${String(n)} over`).toBeGreaterThan(0);
    }
  });
});

describe('rule F (Ben, 27 Oct): the arm isolation goes first on a day whose main group isn’t Arms', () => {
  // The same workout with its second exercise read as an arm isolation (a pushdown): Bench is the main lift, so Chest.
  const armInfo = (id: string): BuilderExerciseInfo | null => {
    const i = info(id);
    return id === RAISE.id && i !== null ? { ...i, group: 'Arms', part: 'triceps' } : i;
  };
  const armOffer = (s: SessionAggregate, overByMinutes: number) => timeFitOffer({ aggregate: s, overByMinutes, info: armInfo });

  it('at every overrun: the fly or the crunch loses a set only once the arm isolation is left out; done sets and the bench never change', () => {
    const s = underWay();
    const arm = exId(s, RAISE);
    let sawArmOut = false;
    let sawOthersCut = false;
    for (let n = 1; n <= 30; n += 1) {
      const o = armOffer(s, n);
      const armOut = o.lines.some((l) => l.kind === 'drop' && l.sessionExerciseId === arm);
      const othersCut = o.lines.some((l) => (l.kind === 'drop' || l.kind === 'sets') && l.sessionExerciseId !== arm);
      if (othersCut) expect(armOut, `${String(n)} over`).toBe(true);
      sawArmOut ||= armOut;
      sawOthersCut ||= othersCut;
      for (const st of o.steps) {
        const id = st.type === 'skip_exercise' ? null : st.setId;
        const set = s.sets.find((x) => x.id === id);
        if (set !== undefined) expect(set.status).toBe('pending');
        expect(st.type === 'skip_exercise' && st.sessionExerciseId === exId(s, BENCH)).toBe(false);
        if (set !== undefined) expect(set.sessionExerciseId).not.toBe(exId(s, BENCH));
      }
    }
    expect(sawArmOut).toBe(true);
    expect(sawOthersCut).toBe(true);
  });

  it('read as a Shoulders isolation instead, the same overrun trims rather than leaving it out', () => {
    const s = underWay();
    const raise = exId(s, RAISE);
    const n = Array.from({ length: 30 }, (_, i) => i + 1).find((k) => armOffer(s, k).lines.some((l) => l.kind === 'drop' && l.sessionExerciseId === raise));
    expect(n).toBeDefined();
    const plain = offer(s, n ?? 0);
    expect(plain.lines.some((l) => l.kind === 'drop' && l.sessionExerciseId === raise)).toBe(false);
  });
});
