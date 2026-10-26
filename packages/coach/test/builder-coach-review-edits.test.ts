import { describe, expect, it } from 'vitest';
import { buildFromSetup, referenceE1rm, setWorkingCount, slotsOf, type BuilderSetup, type BuilderSlot, type BuilderWorkout, type LoadReferences, type RefSession } from '@fizz/domain';
import { builderFixture as F } from '@fizz/domain/testing';
import type { ReviewWorkoutArgs } from '@fizz/schemas';
import {
  buildReviewRequest,
  builderWorkoutView,
  checkClaims,
  checkReview,
  claimFacts,
  createBuilderLoadGuard,
  removedClaimExtras,
  reviewClaimBase,
  reviewEditLines,
  reviewEdits,
  reviewFacts,
  reviewLiftFacts,
  topLoad,
  type BuilderCoachEnv,
  type BuilderCoachSnapshot,
  type ReviewEdit,
} from '../src/index';

/**
 * Coach review judges the numbers and Ben's own edits (Ben, 23 Oct: "I thought the whole point was the coach should
 * review the sets and weights as well in context of the goals and history"; workout-builder-v3 §2.9).
 */

const chest: BuilderSetup = { minutes: 60, mainLiftExerciseId: 'bench', supersets: false, groups: [{ group: 'Chest', count: 3 }, { group: 'Arms', count: 1 }, { group: 'Core', count: 1 }] };

const mapSlot = (w: BuilderWorkout, id: string, f: (s: BuilderSlot) => BuilderSlot): BuilderWorkout => ({ ...w, blocks: w.blocks.map((b) => ({ ...b, slots: b.slots.map((s) => (s.exerciseId === id ? f(s) : s)) })) });
const withTop = (s: BuilderSlot, load: number, typed = false): BuilderSlot => ({ ...s, rows: s.rows.map((r) => (r.type === 'top' ? { ...r, load, ...(typed ? { typed: true as const } : {}) } : r)) });

function session(id: string, utc: string, sets: { value: number; reps: number; rpe: number | null }[], deload = false): RefSession {
  const top = sets.reduce((m, s) => (s.value > m.value ? s : m));
  return { sessionId: id, performedAtUtc: utc, tz: 'Europe/London', source: 'app', sets, top, ...(deload ? { deload: true as const } : {}) };
}

/** Bench: his last sessions newest first (a deload week newest), best normal 6-rep load 101 kg. */
function benchRefs(): LoadReferences {
  const all = [
    session('s0', '2026-10-20T10:00:00Z', [{ value: 90, reps: 6, rpe: 6 }], true),
    session('s1', '2026-10-13T10:00:00Z', [{ value: 100, reps: 6, rpe: 8 }, { value: 95, reps: 8, rpe: 8 }]),
    session('s2', '2026-10-09T10:00:00Z', [{ value: 101, reps: 6, rpe: 9 }]),
    session('s3', '2026-10-06T10:00:00Z', [{ value: 97.5, reps: 6, rpe: 8 }]),
    session('s4', '2026-10-02T10:00:00Z', [{ value: 95, reps: 6, rpe: 8 }]),
  ];
  const own = all.slice(1, 4);
  return { exerciseId: 'bench', unit: 'kg', convention: 'total', direction: 'resistance', equipment: F.bar, own: { sessions: own, e1rm: referenceE1rm(own.flatMap((s) => s.sets)), gapDays: 3, estOnly: false }, latest: all[0] ?? null, all, derived: null, patternE1rms: [], historyVersion: 'h1' };
}

function scene(pain: Record<string, string> = {}) {
  const ctx = F.context();
  const built = buildFromSetup(chest, F.pool, ctx).workout;
  const drafted = mapSlot(built, 'bench', (s) => withTop(s, 100));
  const key = (id: string) => slotsOf(drafted.blocks).find((s) => s.exerciseId === id)?.key ?? '';
  // Ben's own edits: bench top 100 → 110 kg (typed), cable fly removed, pushdown 3 → 6 sets, crunch rest → 1:00.
  let mine = mapSlot(drafted, 'bench', (s) => withTop(s, 110, true));
  mine = { ...mine, blocks: mine.blocks.map((b) => ({ ...b, slots: b.slots.filter((s) => s.exerciseId !== 'cable_fly') })).filter((b) => b.slots.length > 0) };
  mine = mapSlot(mine, 'pushdown', (s) => ({ ...setWorkingCount(s, 6), touched: true }));
  mine = mapSlot(mine, 'crunch', (s) => ({ ...s, restS: { ...s.restS, working: 60 }, touched: true }));
  const snap: BuilderCoachSnapshot = { draftId: 'd1', draftVersion: 5, dayName: 'Chest', minutes: 60, supersets: false, workout: mine, revs: {} };
  const p = (id: string) => pain[id] ?? null;
  const refs = (id: string) => (id === 'bench' ? benchRefs() : null);
  const env: BuilderCoachEnv = { ctx, usable: (id) => F.info(id) !== null, pain: p, loads: createBuilderLoadGuard({ ctx, refs, pain: p }), askedHeavier: false, mainGroup: 'Chest' };
  return { ctx, drafted, mine, snap, env, key, refs, pain: p };
}

const byKind = (edits: readonly ReviewEdit[], kind: ReviewEdit['kind']) => edits.find((e) => e.kind === kind);

describe('reviewEdits: Ben’s own edits against what was drafted', () => {
  it('load, sets, rest and a removal, each in code’s words with an ID', () => {
    const { ctx, drafted, mine } = scene();
    const edits = reviewEdits({ drafted: { workout: drafted, minutes: 60 }, workout: mine, minutes: 60, ctx });
    if (edits === null) throw new Error('no edits');
    expect(edits.map((e) => e.text)).toEqual(expect.arrayContaining(['Barbell bench press top 100 → 110 kg', 'Triceps pushdown 3 → 6 sets', 'Cable crunch rest 1:15 → 1:00', 'Cable fly removed']));
    expect(edits.every((e) => e.cause === 'ben')).toBe(true);
    expect(edits.map((e) => e.id)).toEqual(edits.map((_, i) => `e${String(i + 1)}`));
    // Removals come last; the drafted value is kept as `before`.
    expect(edits[edits.length - 1]).toMatchObject({ kind: 'removed', fromExerciseId: 'cable_fly', before: 3 });
    expect(byKind(edits, 'load')).toMatchObject({ before: 100, after: 110 });
    expect(reviewEditLines(edits).find((l) => l.change.startsWith('Barbell'))).toMatchObject({ by: 'Ben' });
  });

  it('nothing edited: no edits; drafted unknown (an older draft): null, never guessed', () => {
    const { ctx, drafted } = scene();
    expect(reviewEdits({ drafted: { workout: drafted, minutes: 60 }, workout: drafted, minutes: 60, ctx })).toEqual([]);
    expect(reviewEdits({ drafted: null, workout: drafted, minutes: 60, ctx })).toBeNull();
  });

  it('a swap (same slot, another exercise), an add, reps, RPE and the length', () => {
    const { ctx, drafted } = scene();
    const fly = slotsOf(drafted.blocks).find((s) => s.exerciseId === 'cable_fly');
    if (fly === undefined) throw new Error('no fly');
    let w = mapSlot(drafted, 'cable_fly', (s) => ({ ...s, exerciseId: 'pec_deck' }));
    w = mapSlot(w, 'incline_db', (s) => ({ ...s, rows: s.rows.map((r) => (r.type === 'warmup' ? r : { ...r, reps: 12, rpe: 9 })) }));
    const added: BuilderSlot = { ...setWorkingCount({ ...fly, key: 'hammer#x', exerciseId: 'hammer' }, 3) };
    w = { ...w, blocks: [...w.blocks, { slots: [added], auto: false }] };
    const edits = reviewEdits({ drafted: { workout: drafted, minutes: 60 }, workout: w, minutes: 45, ctx }) ?? [];
    expect(edits[0]).toMatchObject({ kind: 'minutes', text: 'Length 60 → 45 min' });
    expect(edits.map((e) => e.text)).toEqual(expect.arrayContaining(['Cable fly → Pec deck', 'Hammer curl added (3 sets)', 'Incline dumbbell press RPE 8 → 9']));
    expect(byKind(edits, 'reps')?.text).toMatch(/^Incline dumbbell press \d+ → 12 reps$/);
  });

  it('what Time cut is told apart from his own edits', () => {
    const { ctx, drafted } = scene();
    const flyKey = slotsOf(drafted.blocks).find((s) => s.exerciseId === 'cable_fly')?.key ?? '';
    const pdKey = slotsOf(drafted.blocks).find((s) => s.exerciseId === 'pushdown')?.key ?? '';
    let w = { ...drafted, blocks: drafted.blocks.map((b) => ({ ...b, slots: b.slots.filter((s) => s.key !== flyKey) })).filter((b) => b.slots.length > 0) };
    w = mapSlot(w, 'pushdown', (s) => setWorkingCount(s, 2));
    const edits = reviewEdits({ drafted: { workout: drafted, minutes: 60 }, workout: w, minutes: 45, ctx, time: { dropped: [flyKey], cut: { [pdKey]: 1 } } }) ?? [];
    expect(edits.find((e) => e.kind === 'removed')).toMatchObject({ cause: 'time', text: 'Cable fly left out (Time)' });
    expect(edits.find((e) => e.kind === 'sets')).toMatchObject({ cause: 'time', text: 'Triceps pushdown 3 → 2 sets (Time)' });
    expect(edits.filter((e) => e.cause === 'ben').map((e) => e.kind)).toEqual(['minutes']);
  });

  it('what Time filled above the plan’s length (Today’s card) is Time’s too', () => {
    const { ctx, drafted } = scene();
    const pdKey = slotsOf(drafted.blocks).find((s) => s.exerciseId === 'pushdown')?.key ?? '';
    const fly = slotsOf(drafted.blocks).find((s) => s.exerciseId === 'cable_fly');
    if (fly === undefined) throw new Error('no fly');
    let w = mapSlot(drafted, 'pushdown', (s) => setWorkingCount(s, 4));
    w = { ...w, blocks: [...w.blocks, { slots: [{ ...setWorkingCount({ ...fly, key: 'curl#t', exerciseId: 'curl' }, 2) }], auto: false }] };
    const edits = reviewEdits({ drafted: { workout: drafted, minutes: 60 }, workout: w, minutes: 75, ctx, time: { dropped: [], cut: {}, added: ['curl#t'], raised: { [pdKey]: 1 } } }) ?? [];
    expect(edits.filter((e) => e.cause === 'time').map((e) => e.text)).toEqual(['Triceps pushdown 3 → 4 sets (Time)', 'EZ-bar curl added (2 sets) (Time)']);
  });
});

describe('reviewLiftFacts: per exercise, code’s facts from his history', () => {
  it('bench: recent sessions (deload marked), est. 1RM labelled, today vs his best recent load for the reps, a stall', () => {
    const { ctx, drafted, mine, refs, pain } = scene();
    const edits = reviewEdits({ drafted: { workout: drafted, minutes: 60 }, workout: mine, minutes: 60, ctx });
    const lifts = reviewLiftFacts({ workout: mine, ctx, refs, pain, targets: [{ exerciseId: 'bench', value: 120, unit: 'kg', convention: 'total', reps: 5, by: '1 Dec' }], edits, drafted: { workout: drafted, minutes: 60 } });
    const bench = lifts.find((l) => l.exerciseId === 'bench');
    if (bench === undefined) throw new Error('no bench');
    expect(bench.facts[0]).toBe('Last sessions, top set: 90 kg × 6 @ RPE 6 (20 Oct, deload week), 100 kg × 6 @ RPE 8 (13 Oct), 101 kg × 6 @ RPE 9 (9 Oct)');
    expect(bench.facts).toContain('His last session of it was a deload week');
    expect(bench.facts.some((f) => /^Est\. 1RM [\d.]+ kg \(estimate\)$/.test(f))).toBe(true);
    // The deload week is left out of his best and the trend (PM, 23 Oct).
    expect(bench.facts).toContain('Best recent load for 6 reps: 101 kg');
    expect(bench.facts).toContain('110 kg today is 9% above his best recent load for 6 reps');
    expect(bench.facts).toContain('Lift target 120 kg × 5 by 1 Dec');
    expect(bench.facts.some((f) => f.startsWith('Est. 1RM by session, newest first:'))).toBe(true);
    expect(bench.claims.percents).toEqual([9]);
    // Est. 1RMs only ever as estimates, never as loads he lifted (rule 6).
    expect(bench.claims.estimates?.length).toBeGreaterThan(0);
    const pd = lifts.find((l) => l.exerciseId === 'pushdown');
    expect(pd?.facts).toContain('No history for this exercise');
    expect(pd?.facts.some((f) => /^6 working sets of Triceps pushdown today; Triceps \d+ working sets in all today$/.test(f))).toBe(true);
  });

  it('a pain flag is a fact: never heavier or harder', () => {
    const { ctx, mine, refs, pain } = scene({ bench: 'shoulder flagged 6 Oct' });
    const bench = reviewLiftFacts({ workout: mine, ctx, refs, pain, targets: [], edits: null, drafted: null }).find((l) => l.exerciseId === 'bench');
    expect(bench?.facts).toContain('Pain flag: shoulder flagged 6 Oct. Never heavier or harder.');
  });

  it('stalled: no new best over his last 3 normal sessions', () => {
    const { ctx, mine, pain } = scene();
    const flat = (): LoadReferences => {
      const all = [session('a', '2026-10-13T10:00:00Z', [{ value: 100, reps: 6, rpe: 9 }]), session('b', '2026-10-09T10:00:00Z', [{ value: 100, reps: 6, rpe: 8 }]), session('c', '2026-10-06T10:00:00Z', [{ value: 100, reps: 6, rpe: 8 }])];
      return { ...benchRefs(), all, latest: all[0] ?? null, own: { sessions: all, e1rm: referenceE1rm(all.flatMap((s) => s.sets)), gapDays: 3, estOnly: false } };
    };
    const bench = reviewLiftFacts({ workout: mine, ctx, refs: (id) => (id === 'bench' ? flat() : null), pain, targets: [], edits: null, drafted: null }).find((l) => l.exerciseId === 'bench');
    expect(bench?.facts).toContain('No new best in his last 3 normal sessions (stalled)');
  });
});

describe('the claim check with the review’s facts', () => {
  function facts() {
    const { ctx, drafted, mine, refs, pain } = scene();
    const d = { workout: drafted, minutes: 60 };
    const edits = reviewEdits({ drafted: d, workout: mine, minutes: 60, ctx });
    const lifts = reviewLiftFacts({ workout: mine, ctx: { ...ctx }, refs, pain, targets: [], edits, drafted: d });
    return claimFacts([mine], { ctx, minutes: [60], extra: [...lifts.map((l) => l.claims), ...removedClaimExtras(edits, d, ctx)] });
  }

  it('a percentage passes only when code worked it out for the exercise named', () => {
    const f = facts();
    expect(checkClaims('Bench press at 110 kg is 9% above his best recent load for 6 reps.', f).hidden).toEqual([]);
    expect(checkClaims('Bench press is 12% above his best.', f).shown).toBeNull();
    expect(checkClaims('Up 9%.', f).shown).toBeNull();
  });

  it('history loads and drafted values pass for their exercise; an est. 1RM only as an estimate', () => {
    const f = facts();
    expect(checkClaims('Bench press was 100 kg in the draft. Bench press best for 6 reps is 101 kg.', f).hidden).toEqual([]);
    expect(checkClaims('Triceps pushdown went from 3 to 6 sets.', f).hidden).toEqual([]);
    expect(checkClaims('Cable fly had 3 sets.', f).hidden).toEqual([]);
    const e1 = Math.round((referenceE1rm(benchRefs().own?.sessions.flatMap((s) => s.sets) ?? []) ?? 0) * 2) / 2;
    expect(checkClaims(`Bench press 1RM is ${String(e1)} kg.`, f).shown).toBeNull();
    expect(checkClaims(`Bench press est. 1RM is ${String(e1)} kg.`, f).hidden).toEqual([]);
    expect(checkClaims('Bench press at 107.5 kg.', f).shown).toBeNull();
  });

  it('rest times: only the rest code gave for the exercise named', () => {
    const f = facts();
    expect(checkClaims('Cable crunch rest 1:00 is fine.', f).hidden).toEqual([]);
    expect(checkClaims('Cable crunch rest was 1:15.', f).hidden).toEqual([]);
    expect(checkClaims('Cable crunch rest 0:45.', f).shown).toBeNull();
    expect(checkClaims('Cable crunch: 60 s rest is fine.', f).shown).toBeNull();
    expect(checkClaims('Cable crunch 60 s rest is fine.', f).hidden).toEqual([]);
  });
});

describe('checkReview: comments on his edits, offers fenced and guarded', () => {
  function run(args: Partial<ReviewWorkoutArgs>, pain: Record<string, string> = {}) {
    const s = scene(pain);
    const d = { workout: s.drafted, minutes: 60 };
    const edits = reviewEdits({ drafted: d, workout: s.mine, minutes: 60, ctx: s.ctx }) ?? [];
    const lifts = reviewLiftFacts({ workout: s.mine, ctx: s.ctx, refs: s.refs, pain: s.pain, targets: [], edits, drafted: d });
    const f = reviewFacts({ snapshot: s.snap, ctx: s.ctx, groups: ['Chest', 'Arms', 'Core'], plan: null });
    const claims = reviewClaimBase(f, { ctx: s.ctx, minutes: [60], plan: null, extra: [...lifts.map((l) => l.claims), ...removedClaimExtras(edits, d, s.ctx)] });
    const id = (k: ReviewEdit['kind']) => byKind(edits, k)?.id ?? '';
    const full: ReviewWorkoutArgs = { verdict: 'Heavy bench', editComments: [], suggestions: [], nextNotes: [], ...args };
    return { r: checkReview({ reviewId: 'rv', args: full, snapshot: s.snap, env: s.env, claims, edits }), id, s, edits };
  }

  it('a grounded comment with an offer: code’s line, rounded down to the gym’s plates; a fine edit says so with no offer', () => {
    const { s } = run({});
    const benchKey = s.key('bench');
    const pdKey = s.key('pushdown');
    const { r, edits } = run({
      editComments: [
        { editId: 'e1', comment: 'Bench press at 110 kg is 9% above his best recent load for 6 reps.', ops: [{ op: 'load', slotKey: benchKey, direction: null, value: 103, unit: 'kg' }] },
        { editId: 'e2', comment: 'Triceps pushdown at 6 sets is fine today.', ops: [] },
        { editId: 'e99', comment: 'Unknown edit.', ops: [] },
      ],
    });
    expect(edits[0]?.kind).toBe('load');
    expect(edits[1]).toMatchObject({ kind: 'sets', slotKey: pdKey });
    expect(r.edits).toHaveLength(2);
    const bench = r.edits[0];
    expect(bench).toMatchObject({ editId: 'e1', edit: 'Barbell bench press top 100 → 110 kg', comment: 'Bench press at 110 kg is 9% above his best recent load for 6 reps.' });
    expect(bench?.offer?.proposal.lines[0]).toBe('Barbell bench press: 110 → 102.5 kg');
    expect(bench?.offer?.proposal.preconditions).toEqual([{ slotKey: benchKey, rev: 1 }]);
    expect(r.edits[1]).toMatchObject({ editId: 'e2', comment: 'Triceps pushdown at 6 sets is fine today.', offer: null });
  });

  it('taking his edit back with no reason in the facts: the offer is dropped, the comment stays', () => {
    const { s } = run({});
    const { r } = run({ editComments: [{ editId: 'e1', comment: 'Go back to the draft.', ops: [{ op: 'load', slotKey: s.key('bench'), direction: null, value: 100, unit: 'kg' }] }] });
    expect(r.edits).toEqual([expect.objectContaining({ editId: 'e1', comment: 'Go back to the draft.', offer: null })]);
    // Re-adding the fly he removed, with no grounded reason, is dropped too (a suggestion as well as a comment).
    const r2 = run({ suggestions: [{ ops: [{ op: 'add', exerciseId: 'cable_fly', afterSlotKey: null, workingSets: 3 }], reason: 'Put it back.' }] }).r;
    expect(r2.suggestions).toEqual([]);
  });

  it('a comment with a wrong number is hidden; with nothing left and no offer it doesn’t show', () => {
    const { r } = run({ editComments: [{ editId: 'e1', comment: 'Bench press is 20% above his best.', ops: [] }] });
    expect(r.edits).toEqual([]);
    expect(r.hidden).toContain('Bench press is 20% above his best.');
  });

  it('pain-flagged: an offer to go heavier is refused by code (rule 9)', () => {
    const { s } = run({});
    const { r } = run({ editComments: [{ editId: 'e1', comment: 'Bench press could go to 115 kg.', ops: [{ op: 'load', slotKey: s.key('bench'), direction: null, value: 115, unit: 'kg' }] }] }, { bench: 'shoulder flagged 6 Oct' });
    expect(r.edits.every((e) => e.offer === null)).toBe(true);
  });

  it('an edit comment whose offer adds a near-duplicate is left out with its words (Ben, 23 Oct); others still show', () => {
    const { s, edits } = run({});
    const pd = edits.find((e) => e.kind === 'sets')?.id ?? '';
    expect(slotsOf(s.mine.blocks).map((x) => x.exerciseId)).toContain('incline_db');
    const { r } = run({
      editComments: [
        { editId: 'e1', comment: 'Bench press at 110 kg is 9% above his best recent load for 6 reps.', ops: [{ op: 'add', exerciseId: 'incline_bb', afterSlotKey: null, workingSets: 3 }] },
        { editId: pd, comment: 'Triceps pushdown at 6 sets is fine today.', ops: [] },
      ],
      suggestions: [{ ops: [{ op: 'add', exerciseId: 'incline_bb', afterSlotKey: null, workingSets: 3 }], reason: 'More upper chest.' }],
    });
    expect(r.edits.map((e) => e.editId)).toEqual([pd]);
    expect(r.suggestions).toEqual([]);
    expect(r.leftOut).toEqual(['Incline barbell press: like Incline dumbbell press']);
  });

  it('rest, reps and RPE are offers too; rest on the builder’s 15 s steps', () => {
    const { s } = run({});
    const { r } = run({ suggestions: [{ ops: [{ op: 'rest', slotKey: s.key('crunch'), seconds: 100 }], reason: 'Cable crunch rest 1:00 is short.' }, { ops: [{ op: 'rpe', slotKey: s.key('incline_db'), rpe: 9 }], reason: 'Push the incline.' }] });
    expect(r.suggestions.map((x) => x.proposal.lines)).toEqual([['Cable crunch: rest 1:00 → 1:45'], ['Incline dumbbell press: RIR 2 / 1 → 1']]);
    expect(r.suggestions[0]?.proposal.reason).toBe('Cable crunch rest 1:00 is short.');
  });
});

describe('the review request', () => {
  it('YOUR DATA carries his edits, per-exercise facts, focus, block week, readiness and targets; the instructions say comment on his edits first', () => {
    const s = scene();
    const d = { workout: s.drafted, minutes: 60 };
    const edits = reviewEdits({ drafted: d, workout: s.mine, minutes: 60, ctx: s.ctx }) ?? [];
    const lifts = reviewLiftFacts({ workout: s.mine, ctx: s.ctx, refs: s.refs, pain: s.pain, targets: [], edits, drafted: d });
    const view = builderWorkoutView(s.snap, s.ctx, 58);
    expect(view.slots.find((x) => x.exerciseId === 'crunch')).toMatchObject({ rest: '1:00' });
    expect(view.slots.find((x) => x.exerciseId === 'bench')?.rpe).toBe('8');
    const req = buildReviewRequest(view, { usable: [], painFlags: [], dayNotes: [], plan: null, goal: 'strength', history: [], memories: [] }, ['16 working sets'], 'm', { yourEdits: reviewEditLines(edits), lifts: lifts.map((l) => ({ slotKey: l.slotKey, exercise: l.exercise, facts: l.facts })), focus: 'Strength', blockWeek: 'Week 3 of 6', readiness: 'Check-in 2 of 5 today', liftTargets: [] });
    const data = req.input.find((i) => i.type === 'message' && i.content.startsWith('YOUR DATA'));
    const body = data?.type === 'message' ? (JSON.parse(data.content.slice(data.content.indexOf('\n') + 1)) as Record<string, unknown>) : {};
    expect(body).toMatchObject({ focus: 'Strength', blockWeek: 'Week 3 of 6', readiness: 'Check-in 2 of 5 today' });
    expect(body.yourEdits).toEqual(expect.arrayContaining([{ editId: 'e1', change: 'Barbell bench press top 100 → 110 kg', by: 'Ben' }]));
    expect(JSON.stringify(body.lifts)).toContain('110 kg today is 9% above his best recent load for 6 reps');
    expect(req.instructions).toMatch(/Comment first on Ben’s own edits/);
    expect(req.instructions).toMatch(/Never take an edit back just because it differs from the draft/);
    expect(topLoad(slotsOf(s.mine.blocks).find((x) => x.exerciseId === 'bench') ?? { rows: [] })).toBe(110);
  });
});
