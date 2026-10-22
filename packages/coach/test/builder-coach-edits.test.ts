import { describe, expect, it } from 'vitest';
import { buildFromSetup, getAchievableLoads, referenceE1rm, slotsOf, toDraftPlan, type BuilderSetup, type BuilderSlot, type BuilderWorkout, type DraftCodecContext, type LoadReferences, type RefSession } from '@fizz/domain';
import { builderFixture as F } from '@fizz/domain/testing';
import { BUILDER_COACH_TOOL_ARGS, BuilderEditOpSchema, FillSetupArgsSchema, ProposeWorkoutEditArgsSchema, ReviewWorkoutArgsSchema, type BuilderEditOp } from '@fizz/schemas';
import {
  OUT_OF_DATE_LINE,
  applyBuilderEdits,
  builderWorkoutView,
  NO_NUMBERS,
  workoutClaimCheck,
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

function refsOf(exerciseId: string, top: { value: number; reps: number; rpe: number }, over: Partial<LoadReferences> = {}): LoadReferences {
  const s: RefSession = { sessionId: `s-${exerciseId}`, performedAtUtc: '2026-10-13T10:00:00Z', tz: 'Europe/London', source: 'app', sets: [top], top };
  return { exerciseId, unit: 'kg', convention: 'total', direction: 'resistance', equipment: F.bar, own: { sessions: [s], e1rm: referenceE1rm(s.sets), gapDays: 7, estOnly: false }, latest: s, all: [s], derived: null, patternE1rms: [], historyVersion: 'h1', ...over };
}
function benchRefs(): LoadReferences {
  return refsOf('bench', { value: 100, reps: 8, rpe: 8 });
}
const flyRefs = (): LoadReferences => refsOf('cable_fly', { value: 90, reps: 12, rpe: 8 }, { convention: 'stack', equipment: F.cable });

function setup(opts: { pain?: Record<string, string>; askedHeavier?: boolean; refs?: (id: string) => LoadReferences | null } = {}) {
  const ctx = F.context();
  const w = buildFromSetup(chest, F.pool, ctx).workout;
  const pain = (id: string) => opts.pain?.[id] ?? null;
  const env: BuilderCoachEnv = {
    ctx,
    usable: (id) => F.info(id) !== null,
    pain,
    loads: createBuilderLoadGuard({ ctx, refs: opts.refs ?? ((id) => (id === 'bench' ? benchRefs() : id === 'cable_fly' ? flyRefs() : null)), pain }),
    askedHeavier: opts.askedHeavier ?? false,
    mainGroup: 'Chest',
  };
  const key = (id: string) => slotsOf(w.blocks).find((s) => s.exerciseId === id)?.key ?? `missing:${id}`;
  return { ctx, w, env, key, snap: snapshotOf(w) };
}

describe('strict tool schemas', () => {
  it('every builder tool is closed for strict function calling (no extra fields, every field required)', () => {
    const walk = (n: unknown): void => {
      if (Array.isArray(n)) {
        n.forEach(walk);
        return;
      }
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
    const p = makeBuilderProposal({ id: 'p1', snapshot: snap, ops, words: null, check: NO_NUMBERS, env }).proposal;
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
    // Fly last 90 × 12: 105 is inside the ceiling but past the stack's 100 max.
    const stack = applyBuilderEdits(snap, [{ op: 'load', slotKey: key('cable_fly'), direction: null, value: 105, unit: 'kg' }], env);
    const fly = slotsOf(stack.workout.blocks).find((s) => s.exerciseId === 'cable_fly');
    expect(topLoad(fly ?? { rows: [] })).toBeLessThanOrEqual(100);
    expect(stack.lines[0]).toMatch(/^Cable fly: \d+ → (\d+) kg$/);
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

describe('the guard fails closed (review b3-coach B3)', () => {
  it('no load reference: a named heavier value is refused; one step or lighter still works', () => {
    const { snap, env, key } = setup({ refs: () => null });
    const fly = applyBuilderEdits(snap, [{ op: 'load', slotKey: key('cable_fly'), direction: null, value: 100, unit: 'kg' }], env);
    expect(fly.lines).toEqual([]);
    expect(fly.notes).toEqual(['Cable fly: Not changed: no reference for that load']);
    const incline = applyBuilderEdits(snap, [{ op: 'load', slotKey: key('incline_db'), direction: null, value: 40, unit: 'kg' }], env);
    expect(incline.lines).toEqual([]);
    const step = applyBuilderEdits(snap, [{ op: 'load', slotKey: key('cable_fly'), direction: 'heavier', value: null, unit: null }], env);
    expect(step.lines).toEqual(['Cable fly: 15 → 20 kg']);
    const lighter = applyBuilderEdits(snap, [{ op: 'load', slotKey: key('cable_fly'), direction: null, value: 10, unit: 'kg' }], env);
    expect(lighter.lines).toEqual(['Cable fly: 15 → 10 kg']);
  });

  it('a lb history on a kg bar still gets the ceiling (units converted, never skipped)', () => {
    const lbBench = (): LoadReferences => refsOf('bench', { value: 220, reps: 8, rpe: 8 }, { unit: 'lb' });
    const { snap, env, key } = setup({ refs: (id) => (id === 'bench' ? lbBench() : null) });
    // 220 lb ≈ 99.8 kg: 160 kg is far past capLastTop and refused, not just rounded to the bar.
    const far = applyBuilderEdits(snap, [{ op: 'load', slotKey: key('bench'), direction: null, value: 160, unit: 'kg' }], env);
    expect(far.lines).toEqual([]);
    expect(far.notes[0]).toMatch(/^Barbell bench press: Not changed: /);
    const near = applyBuilderEdits(snap, [{ op: 'load', slotKey: key('bench'), direction: null, value: 102.5, unit: 'kg' }], env);
    expect(near.lines).toEqual(['Barbell bench press: 100 → 102.5 kg']);
  });

  it('a pain-flagged lift gets no more sets or reps (rule 9; review S2)', () => {
    const { snap, env, key } = setup({ pain: { cable_fly: 'shoulder flagged 6 Oct' } });
    const o = applyBuilderEdits(snap, [{ op: 'sets', slotKey: key('cable_fly'), workingSets: 5 }, { op: 'reps', slotKey: key('cable_fly'), reps: 20 }], env);
    expect(o.lines).toEqual([]);
    expect(o.notes).toEqual(['Cable fly: Not more: shoulder flagged 6 Oct', 'Cable fly: Not more: shoulder flagged 6 Oct']);
    const fewer = applyBuilderEdits(snap, [{ op: 'sets', slotKey: key('cable_fly'), workingSets: 2 }], env);
    expect(fewer.lines).toEqual(['Cable fly: 3 → 2 sets']);
  });

  it('reps or RPE that move the load by formula pass the same ceiling (review S3)', () => {
    const { snap, env, key } = setup();
    // Bench last 100 × 8 @ 8: 1 rep at RPE 10 by formula would pass capLastTop (120).
    const o = applyBuilderEdits(snap, [{ op: 'reps', slotKey: key('bench'), reps: 1 }, { op: 'rpe', slotKey: key('bench'), rpe: 10 }], env);
    const bench = slotsOf(o.workout.blocks).find((s) => s.exerciseId === 'bench');
    expect(topLoad(bench ?? { rows: [] }) ?? 999).toBeLessThanOrEqual(120);
    const none = setup({ refs: () => null });
    const held = applyBuilderEdits(none.snap, [{ op: 'reps', slotKey: none.key('bench'), reps: 1 }], none.env);
    const b = slotsOf(held.workout.blocks).find((s) => s.exerciseId === 'bench');
    expect(topLoad(b ?? { rows: [] })).toBe(100);
    expect(held.notes.some((n) => n.startsWith('Barbell bench press: stays 100 kg · Not changed: no reference for that load'))).toBe(true);
  });
});

describe('staleness by slot (rule 5)', () => {
  it('Ben edited Cable fly since: a proposal touching it is out of date; one touching only bench still applies', () => {
    const { snap, env, key } = setup();
    const fly = makeBuilderProposal({ id: 'p-fly', snapshot: snap, ops: [{ op: 'sets', slotKey: key('cable_fly'), workingSets: 4 }], words: null, check: NO_NUMBERS, env }).proposal;
    const bench = makeBuilderProposal({ id: 'p-bench', snapshot: snap, ops: [{ op: 'load', slotKey: key('bench'), direction: 'lighter', value: null, unit: null }], words: null, check: NO_NUMBERS, env }).proposal;
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

  it('a proposal Ben asked heavier applies with the same guard step; without his request it is refused (integrity B1)', () => {
    const fly15 = (): LoadReferences => refsOf('cable_fly', { value: 90, reps: 15, rpe: 8 }, { convention: 'stack', equipment: F.cable });
    const { snap, env, key } = setup({ askedHeavier: true, refs: (id) => (id === 'cable_fly' ? fly15() : id === 'bench' ? benchRefs() : null) });
    const op: BuilderEditOp = { op: 'load', slotKey: key('cable_fly'), direction: 'heavier', value: 100, unit: 'kg' };
    const asked = makeBuilderProposal({ id: 'p-heavy', snapshot: snap, ops: [op], words: null, check: NO_NUMBERS, env }).proposal;
    expect(asked).not.toBeNull();
    if (asked === null) return;
    expect(asked.askedHeavier).toBe(true);
    // The same op without "heavier" in Ben's words gives a smaller step.
    const plain = makeBuilderProposal({ id: 'p-plain', snapshot: snap, ops: [op], words: null, check: NO_NUMBERS, env: { ...env, askedHeavier: false } }).proposal;
    expect(plain?.lines).not.toEqual(asked.lines);
    // Apply's world env never knows the words; the proposal carries them.
    const applyEnv = { ...env, askedHeavier: false };
    expect(recheckBuilderProposal(asked, snap, applyEnv).ok).toBe(true);
    expect(recheckBuilderProposal({ ...asked, askedHeavier: false }, snap, applyEnv)).toEqual({ ok: false, line: OUT_OF_DATE_LINE });
  });

  it('a length proposal is refused once Set up’s length moved', () => {
    const { snap, env } = setup();
    const p = makeBuilderProposal({ id: 'p-len', snapshot: snap, ops: [{ op: 'minutes', minutes: 45 }], words: null, check: NO_NUMBERS, env }).proposal;
    expect(p).not.toBeNull();
    if (p === null) return;
    expect(recheckBuilderProposal(p, snapshotOf(snap.workout, { minutes: 50 }), env).ok).toBe(false);
    expect(recheckBuilderProposal(p, snap, env).ok).toBe(true);
  });

  it('nothing to change is no proposal; a reason with an invented number is hidden', () => {
    const { snap, env, key, ctx } = setup();
    const none = makeBuilderProposal({ id: 'x', snapshot: snap, ops: [{ op: 'remove', slotKey: key('bench') }], words: 'Done.', check: NO_NUMBERS, env });
    expect(none.proposal).toBeNull();
    const check = workoutClaimCheck(snap.workout, { ctx, minutes: [60] });
    const p = makeBuilderProposal({ id: 'y', snapshot: snap, ops: [{ op: 'sets', slotKey: key('cable_fly'), workingSets: 4 }], words: 'One more set on the fly. You did 27 kg × 8 last time. Cable fly goes to 4 sets.', check, env });
    // `Cable fly … 4 sets` is the change's own after-value; 27 kg belongs to nothing named.
    expect(p.proposal?.reason).toBe('One more set on the fly. Cable fly goes to 4 sets.');
    expect(p.hidden).toEqual(['You did 27 kg × 8 last time.']);
  });

  it('a new ⚠ since the proposal was made is out of date (shown before Apply, never applied unseen)', () => {
    const { snap, env, key } = setup();
    const p = makeBuilderProposal({ id: 'w', snapshot: snap, ops: [{ op: 'superset', slotKey: key('incline_db'), withSlotKey: key('cable_fly') }], words: null, check: NO_NUMBERS, env }).proposal;
    expect(p?.warnings.length).toBeGreaterThan(0);
    if (p === null) return;
    expect(recheckBuilderProposal({ ...p, warnings: [] }, snap, env)).toEqual({ ok: false, line: OUT_OF_DATE_LINE });
  });
});

describe('swap and add follow the builder order and pairing rules (review builder-order S1)', () => {
  const names = (w: BuilderWorkout) => w.blocks.map((b) => b.slots.map((s) => s.exerciseId).join('+'));

  it('a swap that puts a heavy lift into a builder pair splits the pair, with a line', () => {
    const { snap, env } = setup();
    const pair = snap.workout.blocks.find((b) => b.auto && b.slots.length === 2);
    const target = pair?.slots[0];
    if (pair === undefined || target === undefined) throw new Error(`expected a builder pair: ${names(snap.workout).join(' | ')}`);
    const o = applyBuilderEdits(snap, [{ op: 'swap', slotKey: target.key, toExerciseId: 'incline_bb' }], env);
    const swapped = o.workout.blocks.find((b) => b.slots.some((s) => s.exerciseId === 'incline_bb'));
    expect(swapped?.slots).toHaveLength(1);
    expect(o.workout.blocks.some((b) => b.slots.length > 1 && b.slots.some((s) => F.info(s.exerciseId)?.heavy === true))).toBe(false);
    expect(o.lines.some((l) => l.startsWith('Unlink Incline barbell press + '))).toBe(true);
  });

  it('a swap between light lifts keeps the pair', () => {
    const { snap, env } = setup();
    const pair = snap.workout.blocks.find((b) => b.auto && b.slots.length === 2 && b.slots.some((s) => s.exerciseId === 'pushdown'));
    if (pair === undefined) throw new Error('expected pushdown + crunch');
    const o = applyBuilderEdits(snap, [{ op: 'swap', slotKey: pair.slots.find((s) => s.exerciseId === 'pushdown')?.key ?? '', toExerciseId: 'oh_ext' }], env);
    expect(o.workout.blocks.find((b) => b.slots.some((s) => s.exerciseId === 'oh_ext'))?.slots).toHaveLength(2);
    expect(o.lines.some((l) => l.startsWith('Unlink'))).toBe(false);
  });

  it('an add with no anchor goes in its band: a heavy compound before the lighter ones and the isolations, an isolation before abs', () => {
    const { snap, env } = setup();
    const rank = (id: string) => {
      const i = F.info(id);
      if (i === null) return 3;
      if (i.group === 'Abs') return 4;
      if (i.role !== 'compound') return 3;
      return i.heavy ? 1 : 2;
    };
    const heavy = applyBuilderEdits(snap, [{ op: 'add', exerciseId: 'incline_bb', afterSlotKey: null, workingSets: null }], env);
    const at = heavy.workout.blocks.findIndex((b) => b.slots.some((s) => s.exerciseId === 'incline_bb'));
    expect(heavy.workout.blocks.slice(0, at).every((b) => b.slots.every((s) => s.main || rank(s.exerciseId) <= 1)), names(heavy.workout).join(' | ')).toBe(true);
    const iso = applyBuilderEdits(snap, [{ op: 'add', exerciseId: 'hammer', afterSlotKey: null, workingSets: null }], env);
    const i = iso.workout.blocks.findIndex((b) => b.slots.some((s) => s.exerciseId === 'hammer'));
    expect(iso.workout.blocks.slice(i + 1).every((b) => b.slots.some((s) => F.info(s.exerciseId)?.group === 'Abs')), names(iso.workout).join(' | ')).toBe(true);
    expect(iso.workout.blocks.slice(0, i).every((b) => b.slots.every((s) => rank(s.exerciseId) <= 3 || s.main) || b.slots.some((s) => rank(s.exerciseId) < 3)), names(iso.workout).join(' | ')).toBe(true);
  });
});

describe('a saved rep range through the coach (retire-overview final re-review F1, S1, S2; verification F2, S4)', () => {
  /** Bench as a library workout's `Five` opens it: 5 × 3–6 @ 100, with the saved workout's reasons. */
  function ranged() {
    const t = setup({ askedHeavier: true });
    const bench = slotsOf(t.w.blocks).find((x) => x.exerciseId === 'bench') as BuilderSlot;
    const saved: BuilderSlot = {
      ...bench,
      source: 'saved',
      why: ['Saved workout', 'Max here'],
      // As `fromPlannedWorkout` opens a saved workout: no e1RM anchor, so a reps edit keeps the saved kg.
      anchorE1rm: null,
      rows: [...bench.rows.filter((r) => r.type === 'warmup'), ...[0, 1, 2, 3, 4].map(() => ({ type: 'working' as const, reps: 3, repsMax: 6, load: 100, rpe: 8 }))],
    };
    const w: BuilderWorkout = { ...t.w, blocks: t.w.blocks.map((b) => ({ ...b, slots: b.slots.map((x) => (x.key === bench.key ? saved : x)) })) };
    return { ...t, w, snap: snapshotOf(w), benchKey: bench.key };
  }
  const codec = (ctx: ReturnType<typeof F.context>): DraftCodecContext => ({ info: ctx.info, catalogueIdOf: (e) => e, checkedOnOf: () => null });

  it('F1: a coach load change keeps 3–6: the only line is the load, and the encoded plan Start reads is 5 × {3, 6}', () => {
    const { snap, env, ctx, benchKey } = ranged();
    const o = applyBuilderEdits(snap, [{ op: 'load', slotKey: benchKey, direction: 'heavier', value: null, unit: null }], env);
    expect(o.lines).toEqual(['Barbell bench press: 100 → 102.5 kg']);
    const after = slotsOf(o.workout.blocks).find((x) => x.key === benchKey);
    expect(after?.rows.filter((r) => r.type !== 'warmup').map((r) => [r.reps, r.repsMax, r.load])).toEqual(Array.from({ length: 5 }, () => [3, 6, 102.5]));
    const enc = toDraftPlan(o.workout, codec(ctx)).slots.find((x) => x.slotKey === benchKey);
    expect(enc?.setTemplates.filter((t) => t.setType !== 'warmup').map((t) => t.reps)).toEqual(Array.from({ length: 5 }, () => ({ min: 3, max: 6 })));
  });

  it('F1: a typed kg gives way to the coach’s load (no `typed`, no `roundedFrom` left behind)', () => {
    const { snap, env, benchKey } = ranged();
    const bench = slotsOf(snap.workout.blocks).find((x) => x.key === benchKey) as BuilderSlot;
    const i = bench.rows.findIndex((r) => r.type !== 'warmup');
    bench.rows[i] = { ...(bench.rows[i] as BuilderSlot['rows'][number]), typed: true, roundedFrom: 101 };
    const o = applyBuilderEdits(snap, [{ op: 'load', slotKey: benchKey, direction: null, value: 102.5, unit: 'kg' }], env);
    const rows = slotsOf(o.workout.blocks).find((x) => x.key === benchKey)?.rows.filter((r) => r.type !== 'warmup') ?? [];
    expect(rows.map((r) => [r.load, r.typed ?? null, r.roundedFrom ?? null, r.repsMax ?? null])).toEqual(Array.from({ length: 5 }, () => [102.5, null, null, 6]));
  });

  it('S1: after the coach’s load change the saved workout’s reasons are gone, from the slot and from every encoded set', () => {
    const { snap, env, ctx, benchKey } = ranged();
    const o = applyBuilderEdits(snap, [{ op: 'load', slotKey: benchKey, direction: 'heavier', value: null, unit: null }], env);
    const after = slotsOf(o.workout.blocks).find((x) => x.key === benchKey);
    expect(after?.why).toBeUndefined();
    expect(after?.source).toBe('coach_target');
    const enc = toDraftPlan(o.workout, codec(ctx)).slots.find((x) => x.slotKey === benchKey);
    expect(enc?.builder?.why).toBeUndefined();
    for (const t of enc?.setTemplates ?? []) expect([t.load?.notes, t.load?.held]).toEqual([[], false]);
    // A slot the coach didn't touch keeps its reasons.
    const untouched = applyBuilderEdits(snap, [{ op: 'sets', slotKey: benchKey, workingSets: 5 }], env);
    expect(slotsOf(untouched.workout.blocks).find((x) => x.key === benchKey)?.why).toEqual(['Saved workout', 'Max here']);
  });

  it('S2: the coach is shown `5 × 3–6`, and a reply quoting the range passes the claim check (a wrong top is still hidden)', () => {
    const { snap, ctx, w, benchKey } = ranged();
    expect(builderWorkoutView(snap, ctx, 52).slots.find((x) => x.slotKey === benchKey)?.sets).toBe('5 × 3–6 @ 100 kg');
    // Fixed reps still read as one number.
    const fly = slotsOf(w.blocks).find((x) => x.exerciseId === 'cable_fly');
    expect(builderWorkoutView(snap, ctx, 52).slots.find((x) => x.slotKey === fly?.key)?.sets).toMatch(/^\d+ × \d+ @ /);
    const check = workoutClaimCheck(w, { ctx, minutes: [60] });
    expect(check('Bench press is 5 × 3–6 at 100 kg.', null).shown).toBe('Bench press is 5 × 3–6 at 100 kg.');
    expect(check('Keep bench press at 3–6 reps.', null).shown).toBe('Keep bench press at 3–6 reps.');
    expect(check('Keep bench press at 6 reps.', null).shown).toBe('Keep bench press at 6 reps.');
    expect(check('Keep bench press at 3–8 reps.', null).shown).toBeNull();
    expect(check('Bench press is 5 × 3–8 at 100 kg.', null).shown).toBeNull();
  });

  const benchRows = (o: { workout: BuilderWorkout }, key: string) => slotsOf(o.workout.blocks).find((x) => x.key === key)?.rows.filter((r) => r.type !== 'warmup') ?? [];

  it('F2: a coach `reps` op at the range’s bottom shows `3–6 → 3 reps` beside the load, and Start reads what the card shows', () => {
    const { snap, env, ctx, benchKey } = ranged();
    const o = applyBuilderEdits(snap, [{ op: 'reps', slotKey: benchKey, reps: 3 }, { op: 'load', slotKey: benchKey, direction: 'heavier', value: null, unit: null }], env);
    expect(o.lines).toEqual(['Barbell bench press: 3–6 → 3 reps', 'Barbell bench press: 100 → 102.5 kg']);
    const enc = toDraftPlan(o.workout, codec(ctx)).slots.find((x) => x.slotKey === benchKey);
    expect(enc?.setTemplates.filter((t) => t.setType !== 'warmup').map((t) => t.reps)).toEqual(Array.from({ length: 5 }, () => ({ min: 3, max: 3 })));
    // With a sets change, both lines.
    expect(applyBuilderEdits(snap, [{ op: 'reps', slotKey: benchKey, reps: 3 }, { op: 'sets', slotKey: benchKey, workingSets: 6 }], env).lines).toEqual(['Barbell bench press: 5 → 6 sets', 'Barbell bench press: 3–6 → 3 reps']);
    // The before is the range, not its bottom.
    expect(applyBuilderEdits(snap, [{ op: 'reps', slotKey: benchKey, reps: 6 }], env).lines[0]).toBe('Barbell bench press: 3–6 → 6 reps');
  });

  it('F2: a lone `reps 3` on 3–6 is a change with a line, so it comes back as a proposal (it used to give nothing)', () => {
    const { snap, env, benchKey } = ranged();
    const r = makeBuilderProposal({ id: 'p-reps', snapshot: snap, ops: [{ op: 'reps', slotKey: benchKey, reps: 3 }], words: null, check: NO_NUMBERS, env });
    expect(r.proposal?.lines).toEqual(['Barbell bench press: 3–6 → 3 reps']);
    expect(benchRows(r.outcome, benchKey).map((x) => [x.reps, x.repsMax ?? null])).toEqual(Array.from({ length: 5 }, () => [3, null]));
    // Ops that leave the reps alone still give no reps line.
    expect(applyBuilderEdits(snap, [{ op: 'rpe', slotKey: benchKey, rpe: 7 }], env).lines.some((l) => l.endsWith(' reps'))).toBe(false);
  });

  it('F2: back-offs changed by a `reps` or `rpe` op show even when the Top set’s value stays (no change behind another line)', () => {
    const { env, w, benchKey } = ranged();
    const bench = slotsOf(w.blocks).find((x) => x.key === benchKey) as BuilderSlot;
    const topBack: BuilderSlot = {
      ...bench,
      rows: [...bench.rows.filter((r) => r.type === 'warmup'), { type: 'top', reps: 5, load: 100, rpe: 8 }, ...[0, 1, 2].map(() => ({ type: 'backoff' as const, reps: 8, load: 85, rpe: 7 }))],
    };
    const tw: BuilderWorkout = { ...w, blocks: w.blocks.map((b) => ({ ...b, slots: b.slots.map((x) => (x.key === benchKey ? topBack : x)) })) };
    const s = snapshotOf(tw);
    expect(applyBuilderEdits(s, [{ op: 'reps', slotKey: benchKey, reps: 5 }], env).lines).toContain('Barbell bench press: 5 / 8 → 5 reps');
    expect(applyBuilderEdits(s, [{ op: 'rpe', slotKey: benchKey, rpe: 8 }], env).lines).toContain('Barbell bench press: RPE 8 / 7 → 8');
    // Fewer sets drops back-offs: that's the sets line alone.
    expect(applyBuilderEdits(s, [{ op: 'sets', slotKey: benchKey, workingSets: 1 }], env).lines).toEqual(['Barbell bench press: 4 → 1 sets']);
  });

  it('S4: a sets change written `from 4 × 6 to 5 × 6` passes (its `5` is sets, not a range’s top); a wrong count is still hidden', () => {
    const { snap, env, ctx, w, benchKey } = ranged();
    const bench = slotsOf(w.blocks).find((x) => x.key === benchKey) as BuilderSlot;
    const four: BuilderSlot = { ...bench, rows: [...bench.rows.filter((r) => r.type === 'warmup'), ...[0, 1, 2, 3].map(() => ({ type: 'working' as const, reps: 6, load: 100, rpe: 8 }))] };
    const fw: BuilderWorkout = { ...w, blocks: w.blocks.map((b) => ({ ...b, slots: b.slots.map((x) => (x.key === benchKey ? four : x)) })) };
    const o = applyBuilderEdits({ ...snap, workout: fw }, [{ op: 'sets', slotKey: benchKey, workingSets: 5 }], env);
    expect(o.lines).toEqual(['Barbell bench press: 4 → 5 sets']);
    const check = workoutClaimCheck(fw, { ctx, minutes: [60] });
    expect(check('Bench press goes from 4 × 6 to 5 × 6.', o).shown).toBe('Bench press goes from 4 × 6 to 5 × 6.');
    expect(check('Bench press goes from 4 × 6 to 7 × 6.', o).shown).toBeNull();
    // A range's top with nothing after it is still checked as reps.
    expect(check('Bench press goes from 4 × 6 to 5 × 6–9.', o).shown).toBeNull();
  });

  it('`@` before a load is the load: the form the coach is shown passes, a wrong load is hidden, `@ 8` is still RPE', () => {
    const { ctx, w } = ranged();
    const check = workoutClaimCheck(w, { ctx, minutes: [60] });
    expect(check('Bench press is 5 × 3–6 @ 100 kg.', null).shown).toBe('Bench press is 5 × 3–6 @ 100 kg.');
    expect(check('Bench press is 5 × 3–6 @ 100kg.', null).shown).toBe('Bench press is 5 × 3–6 @ 100kg.');
    expect(check('Bench press is 5 × 3–6 @ 105 kg.', null).shown).toBeNull();
    expect(check('Bench press is 5 × 3–6 @ 8.', null).shown).toBe('Bench press is 5 × 3–6 @ 8.');
    expect(check('Bench press is 5 × 3–6 @ 9.', null).shown).toBeNull();
    expect(check('Bench press is 5 × 3–6 @ 8 kg.', null).shown).toBeNull();
  });
});
