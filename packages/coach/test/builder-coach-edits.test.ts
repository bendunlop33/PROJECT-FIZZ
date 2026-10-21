import { describe, expect, it } from 'vitest';
import { buildFromSetup, getAchievableLoads, referenceE1rm, slotsOf, type BuilderSetup, type BuilderWorkout, type LoadReferences, type RefSession } from '@fizz/domain';
import { builderFixture as F } from '@fizz/domain/testing';
import { BUILDER_COACH_TOOL_ARGS, BuilderEditOpSchema, FillSetupArgsSchema, ProposeWorkoutEditArgsSchema, ReviewWorkoutArgsSchema, type BuilderEditOp } from '@fizz/schemas';
import {
  OUT_OF_DATE_LINE,
  applyBuilderEdits,
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
