import { describe, expect, it } from 'vitest';
import { buildFromSetup, getAchievableLoads, referenceE1rm, slotsOf, type BuilderSetup, type BuilderWorkout, type LoadReferences, type RefSession } from '@fizz/domain';
import { builderFixture as F } from '@fizz/domain/testing';
import { BUILDER_COACH_TOOL_ARGS, BuilderEditOpSchema, FillSetupArgsSchema, ProposeWorkoutEditArgsSchema, ReviewWorkoutArgsSchema, type BuilderEditOp } from '@fizz/schemas';
import {
  OUT_OF_DATE_LINE,
  applyBuilderEdits,
  builderFacts,
  builderToolDefinition,
  createBuilderLoadGuard,
  makeBuilderProposal,
  recheckBuilderProposal,
  topLoad,
  type BuilderCoachEnv,
  type BuilderCoachSnapshot,
} from '../src/index';

/**
 * Workout builder v3 coach (§5, S6): strict tool schemas, typed edits with
 * code-made lines, the load guardrail, ⚠ advice and staleness by slot.
 */

const chest: BuilderSetup = {
  minutes: 60,
  mainLiftExerciseId: 'bench',
  supersets: true,
  groups: [
    { group: 'Chest', count: 3 },
    { group: 'Triceps', count: 1 },
    { group: 'Abs', count: 1 },
  ],
};

function snapshotOf(w: BuilderWorkout, over: Partial<BuilderCoachSnapshot> = {}): BuilderCoachSnapshot {
  return { draftId: 'd1', draftVersion: 3, dayName: 'Chest', minutes: 60, supersets: true, workout: w, revs: {}, ...over };
}

function benchRefs(): LoadReferences {
  const s: RefSession = { sessionId: 's1', performedAtUtc: '2026-10-13T10:00:00Z', tz: 'Europe/London', source: 'app', sets: [{ value: 100, reps: 8, rpe: 8 }], top: { value: 100, reps: 8, rpe: 8 } };
  return { exerciseId: 'bench', unit: 'kg', convention: 'total', direction: 'resistance', equipment: F.bar, own: { sessions: [s], e1rm: referenceE1rm(s.sets), gapDays: 7, estOnly: false }, latest: s, all: [s], derived: null, patternE1rms: [], historyVersion: 'h1' };
}

function setup(opts: { pain?: Record<string, string>; askedHeavier?: boolean } = {}) {
  const ctx = F.context();
  const w = buildFromSetup(chest, F.pool, ctx).workout;
  const pain = (id: string) => opts.pain?.[id] ?? null;
  const env: BuilderCoachEnv = {
    ctx,
    usable: (id) => F.info(id) !== null,
    pain,
    loads: createBuilderLoadGuard({ ctx, refs: (id) => (id === 'bench' ? benchRefs() : null), pain }),
    askedHeavier: opts.askedHeavier ?? false,
    mainGroup: 'Chest',
  };
  const key = (id: string) => slotsOf(w.blocks).find((s) => s.exerciseId === id)?.key ?? `missing:${id}`;
  return { ctx, w, env, key, snap: snapshotOf(w) };
}

describe('strict tool schemas', () => {
  it('every builder tool is closed for strict function calling (no extra fields, every field required)', () => {
    const walk = (n: unknown): void => {
      if (Array.isArray(n)) return n.forEach(walk);
      if (n === null || typeof n !== 'object') return;
      const o = n as Record<string, unknown>;
      if (o.type === 'object') {
        expect(o.additionalProperties).toBe(false);
        expect(o.required).toEqual(Object.keys(o.properties as object));
      }
      expect(o).not.toHaveProperty('oneOf');
      Object.values(o).forEach(walk);
    };
    for (const name of Object.keys(BUILDER_COACH_TOOL_ARGS) as (keyof typeof BUILDER_COACH_TOOL_ARGS)[]) walk(builderToolDefinition(name).parameters);
  });

  it('a call with an extra field, an unknown op or a missing field fails the parse', () => {
    expect(BuilderEditOpSchema.safeParse({ op: 'swap', slotKey: 'a', toExerciseId: 'b' }).success).toBe(true);
    expect(BuilderEditOpSchema.safeParse({ op: 'swap', slotKey: 'a', toExerciseId: 'b', weight: 100 }).success).toBe(false);
    expect(BuilderEditOpSchema.safeParse({ op: 'delete_everything', slotKey: 'a' }).success).toBe(false);
    expect(ProposeWorkoutEditArgsSchema.safeParse({ ops: [] }).success).toBe(false);
    expect(FillSetupArgsSchema.safeParse({ dayId: 'pull', minutes: 50, mainLiftCatalogueId: null, supersets: false, groups: null, reply: null, gymId: 'x' }).success).toBe(false);
    expect(ReviewWorkoutArgsSchema.safeParse({ verdict: 'Good', suggestions: [{ ops: [], reason: 'x' }], nextNotes: [] }).success).toBe(false);
  });
});

describe('typed edits, code-made lines', () => {
  it('a swap keeps the position and set count; the line is code’s', () => {
    const { snap, env, key } = setup();
    const o = applyBuilderEdits(snap, [{ op: 'swap', slotKey: key('cable_fly'), toExerciseId: 'incline_bb' }], env);
    expect(o.lines).toEqual(['Cable fly → Incline barbell press']);
    const ids = slotsOf(o.workout.blocks).map((s) => s.exerciseId);
    expect(ids.indexOf('incline_bb')).toBe(slotsOf(snap.workout.blocks).findIndex((s) => s.exerciseId === 'cable_fly'));
    expect(o.preconditions).toEqual([{ slotKey: key('cable_fly'), rev: 1 }]);
  });

  it('sets, add, remove, length and unknown slots: lines and notes', () => {
    const { snap, env, key } = setup();
    const o = applyBuilderEdits(
      snap,
      [
        { op: 'sets', slotKey: key('pushdown'), workingSets: 4 },
        { op: 'add', exerciseId: 'hammer', afterSlotKey: null, workingSets: null },
        { op: 'remove', slotKey: 'nope' },
        { op: 'sets', slotKey: key('cable_fly'), workingSets: 25 },
      ],
      env,
    );
    expect(o.lines).toContain('Triceps pushdown: 3 → 4 sets');
    expect(o.lines).toContain('Cable fly: 3 → 10 sets');
    expect(o.lines).toContain('Add Hammer curl');
    expect(o.notes).toContain('Not changed: that exercise isn’t in the workout');
    expect(o.notes.some((n) => n.startsWith('Cable fly: 10 sets (limit 1–10)'))).toBe(true);
    const m = applyBuilderEdits(snap, [{ op: 'minutes', minutes: 45 }], env);
    expect(m.lines[0]).toBe('Length 60 → 45 min');
    expect(m.minutes).toBe(45);
    expect(m.preconditions.some((p) => p.slotKey === '#minutes' && p.rev === 60)).toBe(true);
  });

  it('the main lift never joins a superset or leaves; a pain-flagged or unknown exercise is left out', () => {
    const { snap, env, key } = setup({ pain: { machine_press: 'shoulder flagged 6 Oct' } });
    const o = applyBuilderEdits(
      snap,
      [
        { op: 'superset', slotKey: key('bench'), withSlotKey: key('cable_fly') },
        { op: 'remove', slotKey: key('bench') },
        { op: 'add', exerciseId: 'machine_press', afterSlotKey: null, workingSets: 3 },
        { op: 'add', exerciseId: 'made_up', afterSlotKey: null, workingSets: 3 },
      ],
      env,
    );
    expect(o.lines).toEqual([]);
    expect(o.notes).toEqual(['Not changed: the main lift never joins a superset', 'Not changed: the main lift stays', 'Machine chest press left out · shoulder flagged 6 Oct', "Not changed: that exercise isn't at this gym"]);
  });

  it('a superset against the advice carries ⚠ and the reason; Apply still possible', () => {
    const { snap, env, key } = setup();
    const ops: BuilderEditOp[] = [{ op: 'superset', slotKey: key('incline_db'), withSlotKey: key('cable_fly') }];
    const o = applyBuilderEdits(snap, ops, env);
    expect(o.lines).toEqual(['Superset Incline dumbbell press + Cable fly']);
    expect(o.warnings.some((w) => w.startsWith('⚠ Not recommended: ') && w.includes('so the second one suffers'))).toBe(true);
    const p = makeBuilderProposal({ id: 'p1', snapshot: snap, ops, words: null, facts: builderFacts([]), env }).proposal;
    expect(p).not.toBeNull();
  });
});

describe('loads: checked, rounded down, never past the cap', () => {
  it('“bench heavier” is one step on this bar, within capLastTop (1.2 × last working load) and loadable', () => {
    const { snap, env, key } = setup({ askedHeavier: true });
    const bench = slotsOf(snap.workout.blocks).find((s) => s.exerciseId === 'bench');
    expect(bench && topLoad(bench)).toBe(100);
    const o = applyBuilderEdits(snap, [{ op: 'load', slotKey: key('bench'), direction: 'heavier', value: null, unit: null }], env);
    expect(o.lines).toEqual(['Barbell bench press: 100 → 102.5 kg']);
    const after = slotsOf(o.workout.blocks).find((s) => s.exerciseId === 'bench');
    const loads = getAchievableLoads(F.bar).loads;
    for (const r of after?.rows ?? []) if (r.load !== null) expect(loads).toContain(r.load);
    // Back-offs follow by the formula and warm-ups are rebuilt, all rounded down.
    expect(after?.rows.filter((r) => r.type === 'backoff').every((r) => (r.load ?? 0) < 102.5)).toBe(true);
  });

  it('a value past the cap is clamped to it and rounded down; far past it is refused', () => {
    const { snap, env, key } = setup();
    const capped = applyBuilderEdits(snap, [{ op: 'load', slotKey: key('bench'), direction: null, value: 130, unit: 'kg' }], env);
    const top = topLoad(slotsOf(capped.workout.blocks).find((s) => s.exerciseId === 'bench') ?? { rows: [] });
    expect(top).not.toBeNull();
    expect(top ?? 999).toBeLessThanOrEqual(120);
    expect(capped.lines[0]).toMatch(/^Barbell bench press: 100 → \d+(\.\d+)? kg$/);
    const refused = applyBuilderEdits(snap, [{ op: 'load', slotKey: key('bench'), direction: null, value: 200, unit: 'kg' }], env);
    expect(refused.lines).toEqual([]);
    expect(refused.notes[0]).toMatch(/^Barbell bench press: Not changed: /);
  });

  it('lb asked on a kg bar converts; a stack never goes past its max (rule 4)', () => {
    const { snap, env, key } = setup();
    const lb = applyBuilderEdits(snap, [{ op: 'load', slotKey: key('bench'), direction: null, value: 230, unit: 'lb' }], env);
    expect(lb.lines[0]).toBe('Barbell bench press: 100 → 102.5 kg');
    // 225 lb is 102.06 kg: rounded DOWN, so bench stays 100 (never up to 102.5).
    const down = applyBuilderEdits(snap, [{ op: 'load', slotKey: key('bench'), direction: null, value: 225, unit: 'lb' }], env);
    expect(down.lines).toEqual([]);
    expect(down.notes[0]).toMatch(/^Barbell bench press: stays 100 kg/);
    const stack = applyBuilderEdits(snap, [{ op: 'load', slotKey: key('cable_fly'), direction: null, value: 140, unit: 'kg' }], env);
    const fly = slotsOf(stack.workout.blocks).find((s) => s.exerciseId === 'cable_fly');
    expect(topLoad(fly ?? { rows: [] })).toBe(100);
    expect(stack.notes.some((n) => n.includes('capped at machine max 100 kg'))).toBe(true);
  });

  it('a pain-flagged movement never gets heavier (rule 9)', () => {
    const { snap, env, key } = setup({ pain: { bench: 'shoulder flagged 6 Oct' } });
    const o = applyBuilderEdits(snap, [{ op: 'load', slotKey: key('bench'), direction: 'heavier', value: null, unit: null }], env);
    expect(o.lines).toEqual([]);
    expect(o.notes).toEqual(['Barbell bench press: Not heavier: shoulder flagged 6 Oct']);
    const lighter = applyBuilderEdits(snap, [{ op: 'load', slotKey: key('bench'), direction: 'lighter', value: null, unit: null }], env);
    expect(lighter.lines).toEqual(['Barbell bench press: 100 → 97.5 kg']);
  });

  it('assisted lifts: lighter means more assistance', () => {
    const ctx = F.context();
    const w = buildFromSetup({ minutes: 60, mainLiftExerciseId: null, supersets: false, groups: [{ group: 'Back', count: 1 }] }, () => ['assisted_pullup'], ctx).workout;
    const snap = snapshotOf(w, { dayName: 'Back' });
    const env: BuilderCoachEnv = { ctx, usable: () => true, pain: () => null, loads: createBuilderLoadGuard({ ctx, refs: () => null, pain: () => null }), askedHeavier: false, mainGroup: 'Back' };
    const k = slotsOf(w.blocks)[0]?.key ?? '';
    const o = applyBuilderEdits(snap, [{ op: 'load', slotKey: k, direction: 'lighter', value: null, unit: null }], env);
    expect(o.lines).toEqual(['Assisted pull-up: 25 → 30 kg assist']);
  });
});

describe('staleness by slot (rule 5)', () => {
  it('Ben edited Cable fly since: a proposal touching it is out of date; one touching only bench still applies', () => {
    const { snap, env, key } = setup();
    const fly = makeBuilderProposal({ id: 'p-fly', snapshot: snap, ops: [{ op: 'sets', slotKey: key('cable_fly'), workingSets: 4 }], words: null, facts: builderFacts([]), env }).proposal;
    const bench = makeBuilderProposal({ id: 'p-bench', snapshot: snap, ops: [{ op: 'load', slotKey: key('bench'), direction: 'lighter', value: null, unit: null }], words: null, facts: builderFacts([]), env }).proposal;
    expect(fly && bench).toBeTruthy();
    if (fly === null || bench === null) return;
    // Ben's own edit on Cable fly bumps its revision and the draft version.
    const edited = applyBuilderEdits(snap, [{ op: 'sets', slotKey: key('cable_fly'), workingSets: 2 }], env).workout;
    const now = snapshotOf(edited, { draftVersion: 4, revs: { [key('cable_fly')]: 2 } });
    expect(recheckBuilderProposal(fly, now, env)).toEqual({ ok: false, line: OUT_OF_DATE_LINE });
    const ok = recheckBuilderProposal(bench, now, env);
    expect(ok.ok).toBe(true);
    // The other draft, or a deleted slot: refused too.
    expect(recheckBuilderProposal(bench, { ...now, draftId: 'd2' }, env).ok).toBe(false);
  });

  it('a length proposal is refused once Set up’s length moved', () => {
    const { snap, env } = setup();
    const p = makeBuilderProposal({ id: 'p-len', snapshot: snap, ops: [{ op: 'minutes', minutes: 45 }], words: null, facts: builderFacts([]), env }).proposal;
    expect(p).not.toBeNull();
    if (p === null) return;
    expect(recheckBuilderProposal(p, snapshotOf(snap.workout, { minutes: 50 }), env).ok).toBe(false);
    expect(recheckBuilderProposal(p, snap, env).ok).toBe(true);
  });

  it('nothing to change is no proposal; a reason with an invented number is hidden', () => {
    const { snap, env, key } = setup();
    const none = makeBuilderProposal({ id: 'x', snapshot: snap, ops: [{ op: 'remove', slotKey: key('bench') }], words: 'Done.', facts: builderFacts([]), env });
    expect(none.proposal).toBeNull();
    const facts = builderFacts(['{"sets":"3 × 8 @ 20 kg"}']);
    const p = makeBuilderProposal({ id: 'y', snapshot: snap, ops: [{ op: 'sets', slotKey: key('cable_fly'), workingSets: 4 }], words: 'One more set on the fly. You did 27 kg × 8 last time.', facts, env });
    expect(p.proposal?.reason).toBe('One more set on the fly.');
    expect(p.hidden).toEqual(['You did 27 kg × 8 last time.']);
  });
});
