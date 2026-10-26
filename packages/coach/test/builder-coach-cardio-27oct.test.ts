import { describe, expect, it } from 'vitest';
import { applyBuilderEdit, buildFromSetup, estimateBuilderMinutes, fromDraftPlan, isTimedSlot, slotsOf, toDraftPlan, type BuilderContext, type BuilderSetup, type BuilderExtraInfo, type DraftCodecContext } from '@fizz/domain';
import { builderFixture as F } from '@fizz/domain/testing';
import { BuilderEditOpSchema, ProposeWorkoutEditArgsSchema } from '@fizz/schemas';
import { NO_NUMBERS, applyBuilderEdits, buildEditRequest, builderWorkoutView, createBuilderLoadGuard, makeBuilderProposal, recheckBuilderProposal, type BuilderCoachEnv, type BuilderCoachExtras, type BuilderCoachSnapshot } from '../src/index';

/**
 * (Ben, build 403, 26 Oct 18:19) "Add 8 minute bike warm up before legs" → "Bike warm-up isn't available in your
 * exercise list". Exercise bike is in the catalogue (cardio, `erg`), but the builder coach could never add it: it has
 * no builder group, so it was in neither the coach's list nor the add op's checks (refused as "isn't at this gym"),
 * and the add op had no time or "first" to say "8 min warm-up".
 */

const legs: BuilderSetup = { minutes: 60, mainLiftExerciseId: 'squat', supersets: false, groups: [{ group: 'Legs', count: 4 }] };

const TIMED: Record<string, BuilderExtraInfo> = {
  'exercise-bike': { exerciseId: 'exercise-bike', name: 'Exercise bike', measurement: 'cardio', repRange: null },
  'rowing-erg': { exerciseId: 'rowing-erg', name: 'Rowing machine', measurement: 'cardio', repRange: null },
  'battle-ropes': { exerciseId: 'battle-ropes', name: 'Battle ropes', measurement: 'duration', repRange: null },
  'box-jump': { exerciseId: 'box-jump', name: 'Box jump', measurement: 'reps', repRange: { min: 5, max: 5 } },
};

function setup(opts: { timed?: boolean } = {}) {
  const base = F.context();
  const ctx: BuilderContext = opts.timed === false ? base : { ...base, extra: (id) => TIMED[id] ?? null };
  const w = buildFromSetup(legs, F.pool, ctx).workout;
  const pain = () => null;
  const env: BuilderCoachEnv = {
    ctx,
    // As the app's world: builder info, or (with `timed`) a cardio machine.
    usable: (id) => F.info(id) !== null || (opts.timed !== false && TIMED[id] !== undefined),
    pain,
    loads: createBuilderLoadGuard({ ctx, refs: () => null, pain }),
    askedHeavier: false,
    mainGroup: 'Legs',
  };
  const snap: BuilderCoachSnapshot = { draftId: 'd1', draftVersion: 2, dayName: 'Legs', minutes: 60, supersets: false, workout: w, revs: {} };
  return { ctx, env, snap, w };
}

const bike8First = { op: 'add', exerciseId: 'exercise-bike', afterSlotKey: null, workingSets: null, first: true, workSeconds: 480 } as const;

describe('builder coach: "add 8 min bike warm up" (Ben, 27 Oct)', () => {
  it('repro: with no timed lookup (before), the bike is refused as not at this gym', () => {
    const { snap, env } = setup({ timed: false });
    const o = applyBuilderEdits(snap, [{ op: 'add', exerciseId: 'exercise-bike', afterSlotKey: null, workingSets: null }], env);
    expect(o.lines).toEqual([]);
    expect(o.notes.join(' ')).not.toContain('isn');
    expect(o.notes).toEqual(['Not changed: unknown exercise']);
  });

  it('adds Exercise bike first, as one 8:00 timed set: no reps target, no load, no warm-ups; the line says so', () => {
    const { snap, env } = setup();
    const o = applyBuilderEdits(snap, [bike8First], env);
    expect(o.lines).toEqual(['Add Exercise bike · 8:00 · first']);
    expect(o.warnings).toEqual([]);
    expect(o.notes).toEqual([]);
    const first = slotsOf(o.workout.blocks)[0];
    expect(first?.exerciseId).toBe('exercise-bike');
    expect(first?.rows).toEqual([{ type: 'working', reps: 1, load: null, rpe: null, durationS: 480 }]);
    expect(first !== undefined && isTimedSlot(first)).toBe(true);
    // The rest of the workout is untouched and still in order after it.
    expect(slotsOf(o.workout.blocks).slice(1).map((s) => s.key)).toEqual(slotsOf(snap.workout.blocks).map((s) => s.key));
    // Its 8 minutes count in the estimate.
    expect(o.estimate).toBeGreaterThan(estimateBuilderMinutes(snap.workout, env.ctx));
  });

  it('is a proposal with Apply that re-checks against the draft (rule 3, rule 5) and round-trips the codec', () => {
    const { snap, env, ctx } = setup();
    const p = makeBuilderProposal({ id: 'p1', snapshot: snap, ops: [bike8First], words: 'Add 8 minute bike warm up before legs', check: NO_NUMBERS, env }).proposal;
    expect(p?.lines).toEqual(['Add Exercise bike · 8:00 · first']);
    if (p === null) throw new Error('no proposal');
    const re = recheckBuilderProposal(p, snap, env);
    expect(re.ok).toBe(true);
    if (!re.ok) return;
    const codec: DraftCodecContext = { info: ctx.info, catalogueIdOf: (e) => e, checkedOnOf: () => null };
    const back = fromDraftPlan(toDraftPlan(re.outcome.workout, codec));
    const bike = slotsOf(back.blocks)[0];
    expect(bike?.exerciseId).toBe('exercise-bike');
    expect(bike?.rows.filter((r) => r.type === 'warmup')).toEqual([]);
    expect(bike?.rows.map((r) => r.durationS)).toEqual([480]);
  });

  it('no time asked: 10:00; a time past the limit is clamped and noted; a cool-down (no place) goes last', () => {
    const { snap, env } = setup();
    const a = applyBuilderEdits(snap, [{ op: 'add', exerciseId: 'rowing-erg', afterSlotKey: null, workingSets: null }], env);
    expect(a.lines).toEqual(['Add Rowing machine · 10:00']);
    expect(slotsOf(a.workout.blocks).at(-1)?.exerciseId).toBe('rowing-erg');
    const b = applyBuilderEdits(snap, [{ ...bike8First, workSeconds: 30_000 }], env);
    expect(b.lines).toEqual(['Add Exercise bike · 2:00:00 · first']);
    expect(b.notes).toEqual(['Exercise bike: 2:00:00']);
    const c = applyBuilderEdits(snap, [{ op: 'add', exerciseId: 'battle-ropes', afterSlotKey: null, workingSets: 3, workSeconds: 45 }], env);
    expect(c.lines).toEqual(['Add Battle ropes · 3 × 0:45']);
  });

  it('plyometric reps (box jump, no builder group) go in as reps with no planned load', () => {
    const { snap, env } = setup();
    const o = applyBuilderEdits(snap, [{ op: 'add', exerciseId: 'box-jump', afterSlotKey: null, workingSets: null, first: true, workSeconds: null }], env);
    expect(o.lines).toEqual(['Add Box jump · first']);
    expect(slotsOf(o.workout.blocks)[0]?.rows).toEqual([0, 1, 2].map(() => ({ type: 'working', reps: 5, load: null, rpe: null })));
  });

  it('a cardio machine never replaces a lift (swap is refused with its name, never "not in the list")', () => {
    const { snap, env } = setup();
    const key = slotsOf(snap.workout.blocks).find((s) => !s.main)?.key ?? '';
    const o = applyBuilderEdits(snap, [{ op: 'swap', slotKey: key, toExerciseId: 'exercise-bike' }], env);
    expect(o.lines).toEqual([]);
    expect(o.notes).toEqual(['Not changed: Exercise bike can’t replace a lift']);
  });

  it('an older call with no first / workSeconds still parses; the strict tool asks for both', () => {
    expect(BuilderEditOpSchema.safeParse({ op: 'add', exerciseId: 'x', afterSlotKey: null, workingSets: null }).success).toBe(true);
    expect(ProposeWorkoutEditArgsSchema.safeParse({ ops: [bike8First], reply: 'Added an 8 minute bike warm-up first.' }).success).toBe(true);
  });

  it('the coach sees the bike as 8:00 in the workout, and the cardio list in YOUR DATA', () => {
    const { snap, env } = setup();
    const o = applyBuilderEdits(snap, [bike8First], env);
    const view = builderWorkoutView({ ...snap, workout: o.workout }, env.ctx, o.estimate);
    expect(view.slots[0]).toMatchObject({ exercise: 'Exercise bike', group: 'Cardio', sets: '8:00' });
    const extras: BuilderCoachExtras = { usable: [], otherWork: [{ exerciseId: 'exercise-bike', name: 'Exercise bike', measured: 'cardio' }], painFlags: [], dayNotes: [], plan: null, goal: null, history: [], memories: [] };
    const req = buildEditRequest(builderWorkoutView(snap, env.ctx, 60), extras, 'Add 8 min bike warm up', 'm');
    const data = JSON.stringify(req.input);
    expect(data).toContain('Exercise bike');
    expect(req.instructions).toContain('first=true');
  });
});

describe('Your workout manual Add takes a cardio machine too (Ben, 27 Oct: the picker hid Exercise bike)', () => {
  it('applyBuilderEdit add_exercise: a timed slot at the end; unknown IDs are still refused', () => {
    const { w, ctx } = setup();
    const r = applyBuilderEdit(w, { kind: 'add_exercise', exerciseId: 'exercise-bike' }, ctx);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const last = slotsOf(r.workout.blocks).at(-1);
    expect(last?.exerciseId).toBe('exercise-bike');
    expect(last?.rows).toEqual([{ type: 'working', reps: 1, load: null, rpe: null, durationS: 600 }]);
    expect(r.advice).toBeNull();
    expect(applyBuilderEdit(w, { kind: 'add_exercise', exerciseId: 'nope' }, ctx)).toEqual({ ok: false, reason: 'unknown_exercise' });
  });
});
