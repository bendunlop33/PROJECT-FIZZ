import { describe, expect, it } from 'vitest';
import { buildFromSetup, referenceE1rm, slotsOf, type BuilderSetup, type LoadReferences, type RefSession } from '@fizz/domain';
import { builderFixture as F } from '@fizz/domain/testing';
import type { ModelEvent } from '../src/model-port';
import {
  BUILDER_COACH_TOOL,
  type ReviewWorkoutArgs,
} from '@fizz/schemas';
import {
  builderFacts,
  builderModelFor,
  builderWorkoutView,
  buildNudgeRequest,
  buildReviewRequest,
  checkMixPick,
  checkNudge,
  checkReview,
  codeMixPick,
  createBuilderLoadGuard,
  nextMix,
  nudgeContextText,
  nudgeOffer,
  nudgeReviewFacts,
  preSessionSignals,
  requestBuilderTool,
  reviewClaimBase,
  reviewFacts,
  type BuilderCoachEnv,
  type BuilderCoachExtras,
  type BuilderCoachSnapshot,
  type NudgeSession,
  type PreSessionInput,
  type ReviewPlanDay,
} from '../src/index';
import { ScriptedCoachModel } from './fake-model';

const chest: BuilderSetup = { minutes: 60, mainLiftExerciseId: 'bench', supersets: true, groups: [{ group: 'Chest', count: 3 }, { group: 'Arms', count: 1 }, { group: 'Core', count: 1 }] };

function world(pain: Record<string, string> = {}) {
  const ctx = F.context();
  const w = buildFromSetup(chest, F.pool, ctx).workout;
  const snap: BuilderCoachSnapshot = { draftId: 'd1', draftVersion: 2, dayName: 'Chest', minutes: 60, supersets: true, workout: w, revs: {} };
  const p = (id: string) => pain[id] ?? null;
  const env: BuilderCoachEnv = { ctx, usable: (id) => F.info(id) !== null, pain: p, loads: createBuilderLoadGuard({ ctx, refs: (id) => (id === 'bench' ? benchRefs() : null), pain: p }), askedHeavier: false, mainGroup: 'Chest' };
  const key = (id: string) => slotsOf(w.blocks).find((s) => s.exerciseId === id)?.key ?? '';
  return { ctx, w, snap, env, key };
}

function benchRefs(): LoadReferences {
  const s: RefSession = { sessionId: 's1', performedAtUtc: '2026-10-13T10:00:00Z', tz: 'Europe/London', source: 'app', sets: [{ value: 100, reps: 8, rpe: 8 }], top: { value: 100, reps: 8, rpe: 8 } };
  return { exerciseId: 'bench', unit: 'kg', convention: 'total', direction: 'resistance', equipment: F.bar, own: { sessions: [s], e1rm: referenceE1rm(s.sets), gapDays: 7, estOnly: false }, latest: s, all: [s], derived: null, patternE1rms: [], historyVersion: 'h1' };
}

const plan: ReviewPlanDay = {
  planName: '4-day split',
  since: '13 Oct',
  dayName: 'Chest',
  nextDayName: 'Chest',
  nextDayNumber: 1,
  dayCount: 4,
  minutes: 60,
  mainLiftExerciseId: 'bench',
  exercises: [
    { exerciseId: 'bench', workingSets: 4 },
    { exerciseId: 'incline_db', workingSets: 3 },
    { exerciseId: 'cable_fly', workingSets: 3 },
    { exerciseId: 'pushdown', workingSets: 3 },
    { exerciseId: 'crunch', workingSets: 3 },
    { exerciseId: 'machine_press', workingSets: 3 },
  ],
};

describe('review facts: every count from code (§2.9)', () => {
  it('coverage with set counts, variety, and the plan section', () => {
    const { ctx, snap } = world();
    const f = reviewFacts({ snapshot: snap, ctx, groups: ['Chest', 'Arms', 'Core'], plan });
    expect(f.coverage.map((c) => c.focus)).toEqual(['Upper chest', 'Mid chest', 'Triceps', 'Abs']);
    // Bench 4 + fly 3 direct, mid chest; incline 3 direct, upper; triceps half from both presses + pushdown 3.
    expect(f.coverage).toEqual([
      { focus: 'Upper chest', sets: 3 },
      { focus: 'Mid chest', sets: 7 },
      { focus: 'Triceps', sets: 7 },
      { focus: 'Abs', sets: 3 },
    ]);
    expect(f.variety).toBe('2 compound · 3 isolation · free weights and machines');
    expect(f.workingSets).toBe(16);
    expect(f.plan?.title).toBe('4-day split · since 13 Oct');
    expect(f.plan?.lines.map((l) => [l.ok, l.text])).toEqual([
      [true, 'Chest is next (day 1 of 4)'],
      [true, '60 min (plan 60)'],
      [true, 'Main lift Barbell bench press'],
      [false, '5 of 6 planned · missing Machine chest press'],
      [false, '16 working sets (plan 19)'],
    ]);
    expect(f.addBack).toEqual([{ exerciseId: 'machine_press', name: 'Machine chest press', workingSets: 3 }]);
  });

  it('with no plan day there is no Plan section', () => {
    const { ctx, snap } = world();
    expect(reviewFacts({ snapshot: snap, ctx, groups: [], plan: null }).plan).toBeNull();
  });
});

describe('checkReview: a sentence with a wrong number is hidden', () => {
  it('verdict and reasons show only with numbers code gave; suggestions are proposals; notes code-worded', () => {
    const { ctx, snap, env, key } = world();
    const f = reviewFacts({ snapshot: snap, ctx, groups: ['Chest', 'Arms', 'Core'], plan });
    const claims = reviewClaimBase(f, { ctx, minutes: [60, 52], plan });
    const args: ReviewWorkoutArgs = {
      verdict: 'Balanced, 16 working sets.',
      editComments: [],
      suggestions: [
        { ops: [{ op: 'swap', slotKey: key('cable_fly'), toExerciseId: 'crossover' }], reason: '2 exercises lead with mid chest.' },
        { ops: [{ op: 'swap', slotKey: key('cable_fly'), toExerciseId: 'crossover' }], reason: 'Same again.' },
        { ops: [{ op: 'sets', slotKey: key('pushdown'), workingSets: 3 }], reason: 'Nothing changes.' },
        { ops: [{ op: 'add', exerciseId: 'hammer', afterSlotKey: null, workingSets: 3 }], reason: 'You have done 14 sets of arms.' },
        // (Ben, 23 Oct) A near-duplicate of the Incline dumbbell press already in: code leaves it out.
        { ops: [{ op: 'swap', slotKey: key('cable_fly'), toExerciseId: 'incline_bb' }], reason: 'More upper chest.' },
      ],
      nextNotes: [{ text: 'Include abs', target: null }, { text: null, target: { exerciseId: 'bench', value: 103, unit: 'kg', reps: 6 } }, { text: 'Go for 12 sets next time', target: null }],
    };
    const r = checkReview({ reviewId: 'r1', args, snapshot: snap, env, claims });
    expect(r.verdict).toBe('Balanced, 16 working sets.');
    expect(r.suggestions.map((s) => [s.action, s.proposal.lines, s.proposal.reason])).toEqual([
      ['Swap', ['Cable fly → Cable crossover'], '2 exercises lead with mid chest.'],
      ['Add', ['Add Hammer curl'], null],
    ]);
    expect(r.leftOut).toEqual(['Incline barbell press: like Incline dumbbell press']);
    expect(r.hidden).toEqual(['You have done 14 sets of arms.', 'Go for 12 sets next time']);
    expect(r.notes).toEqual([
      { id: 'r1:n0', kind: 'text', text: 'Include abs' },
      { id: 'r1:n1', kind: 'target', exerciseId: 'bench', text: 'Barbell bench press top set: 102.5 kg next', value: 102.5, unit: 'kg', convention: 'total', reps: 6 },
    ]);

    const wrong = checkReview({ reviewId: 'r2', args: { ...args, verdict: 'Balanced, 17 working sets.' }, snapshot: snap, env, claims });
    expect(wrong.verdict).toBeNull();
  });

  it('each number is checked against the fact it names, not a pool (review b3-coach B2)', () => {
    const { ctx, snap, env } = world();
    const f = reviewFacts({ snapshot: snap, ctx, groups: ['Chest', 'Arms', 'Core'], plan });
    const claims = reviewClaimBase(f, { ctx, minutes: [60, 52], plan });
    const verdict = (v: string) => checkReview({ reviewId: 'r', args: { verdict: v, editComments: [], suggestions: [], nextNotes: [] }, snapshot: snap, env, claims }).verdict;
    // Wrong: every one of these numbers appears SOMEWHERE in the context (reps, slot keys, loads), but not as this fact.
    for (const bad of ['Balanced, 5 working sets', 'Balanced, 30 working sets', 'Mid chest has 4 sets', 'Only 2 exercises for chest', 'Mid chest 3', 'Three exercises lead with mid chest', 'Bench at 105 kg', 'Up 10%', 'Bench 1RM is 125 kg']) expect([bad, verdict(bad)]).toEqual([bad, null]);
    // Right: each matches its own fact.
    for (const good of ['Balanced, 16 working sets', 'Mid chest has 7 sets', 'Mid chest 7, upper chest 3', '3 exercises for chest', '2 compound and 3 isolation', '60 min', 'Barbell bench press at 100 kg', 'Day 1 of 4', '5 of 6 planned', '16 working sets against the plan’s 19', 'Swap this one for something new']) expect([good, verdict(good)]).toEqual([good, good]);
  });

  it('Update plan day counts a planned exercise’s set change and the main lift (review S10)', () => {
    const { ctx, snap } = world();
    const asIs = { ...plan, exercises: plan.exercises.filter((e) => e.exerciseId !== 'machine_press') };
    expect(reviewFacts({ snapshot: snap, ctx, groups: [], plan: asIs }).plan?.differs).toBe(false);
    const moreSets = { ...asIs, exercises: asIs.exercises.map((e) => (e.exerciseId === 'pushdown' ? { ...e, workingSets: 4 } : e)) };
    expect(reviewFacts({ snapshot: snap, ctx, groups: [], plan: moreSets }).plan).toMatchObject({ differs: true, setsDiffer: ['pushdown'] });
    expect(reviewFacts({ snapshot: snap, ctx, groups: [], plan: { ...asIs, mainLiftExerciseId: 'incline_bb' } }).plan?.differs).toBe(true);
  });

  it('applying one suggestion leaves another usable (different slots)', async () => {
    const { snap, env, key, ctx } = world();
    const claims = { ctx, minutes: [60] };
    const r = checkReview({
      reviewId: 'r3',
      args: { verdict: 'Fine', editComments: [], suggestions: [{ ops: [{ op: 'sets', slotKey: key('cable_fly'), workingSets: 4 }], reason: 'More fly.' }, { ops: [{ op: 'sets', slotKey: key('pushdown'), workingSets: 4 }], reason: 'More triceps.' }], nextNotes: [] },
      snapshot: snap,
      env,
      claims,
    });
    const [a, b] = r.suggestions;
    expect(a && b).toBeTruthy();
    if (a === undefined || b === undefined) return;
    const { recheckBuilderProposal } = await import('../src/index');
    const first = recheckBuilderProposal(a.proposal, snap, env);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const now: BuilderCoachSnapshot = { ...snap, workout: first.outcome.workout, draftVersion: 3, revs: { [key('cable_fly')]: 2 } };
    expect(recheckBuilderProposal(b.proposal, now, env).ok).toBe(true);
    expect(recheckBuilderProposal(a.proposal, now, env).ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------

const set = (reps: number | null, targetRepsMin: number | null, rpe: number | null) => ({ working: true, reps, targetRepsMin, rpe });
const session = (id: string, localDate: string, exercises: NudgeSession['exercises']): NudgeSession => ({ sessionId: id, localDate, exercises });
const quiet: PreSessionInput = {
  today: '2026-10-20',
  recent: [session('s3', '2026-10-17', [{ exerciseId: 'bench', sets: [set(8, 6, 8), set(8, 8, 8)] }]), session('s2', '2026-10-15', [{ exerciseId: 'squat', sets: [set(6, 6, 9)] }]), session('s1', '2026-10-13', [{ exerciseId: 'row', sets: [set(8, 8, 8)] }])],
  checkIn: { id: 'c1', score: 4, localDate: '2026-10-20' },
  offerAtOrBelow: 2,
  activities: [{ id: 'a1', localDate: '2026-10-19', kind: 'run', effort: 'easy', status: 'done' }],
};

describe('pre-session nudge: silent unless a clear real signal (§6.1)', () => {
  const ids = new Set(['bench', 'incline_db', 'cable_fly']);

  it('nothing clear: no signal, so no model call', () => {
    expect(preSessionSignals(quiet, ids, false)).toEqual([]);
    // An easy run, a check-in of 3, two hard sessions out of three: still silent.
    const near: PreSessionInput = { ...quiet, checkIn: { id: 'c1', score: 3, localDate: '2026-10-20' }, recent: [session('a', '2026-10-18', [{ exerciseId: 'bench', sets: [set(6, 6, 9.5)] }]), session('b', '2026-10-16', [{ exerciseId: 'bench', sets: [set(6, 6, 9)] }]), session('c', '2026-10-14', [{ exerciseId: 'bench', sets: [set(6, 6, 8)] }])] };
    expect(preSessionSignals(near, ids, true)).toEqual([]);
    // A hard run the plan only guessed at (planned) never counts; nor a check-in from another day.
    expect(preSessionSignals({ ...quiet, checkIn: { id: 'c0', score: 1, localDate: '2026-10-19' }, activities: [{ id: 'a2', localDate: '2026-10-19', kind: 'run', effort: 'hard', status: 'planned' }] }, ids, true)).toEqual([]);
  });

  it('fires on 3 sessions at RPE 9–10, a big rep miss, a hard run yesterday (legs), a low check-in', () => {
    const hot = [session('a', '2026-10-18', [{ exerciseId: 'bench', sets: [set(6, 6, 9.5)] }]), session('b', '2026-10-16', [{ exerciseId: 'row', sets: [set(6, 6, 9)] }]), session('c', '2026-10-14', [{ exerciseId: 'squat', sets: [set(6, 6, 10)] }])];
    expect(preSessionSignals({ ...quiet, recent: hot }, ids, false)).toEqual([{ kind: 'rpe_high', sessionIds: ['a', 'b', 'c'], meanRpe: 9.5, targetRpe: null }]);
    // The stored fact carries the sessions' own target, or null: never an assumed 8 (rule 6; review S4).
    expect(nudgeReviewFacts([{ kind: 'rpe_high', sessionIds: ['a', 'b', 'c'], meanRpe: 9.5, targetRpe: null }])).toEqual([{ kind: 'rpe_drift', exerciseId: null, sessions: 3, meanRpe: 9.5, targetRpe: null }]);
    const targeted = hot.map((x) => ({ ...x, exercises: x.exercises.map((e) => ({ ...e, sets: e.sets.map((y) => ({ ...y, targetRpe: 7 })) })) }));
    expect(preSessionSignals({ ...quiet, recent: targeted }, ids, false)[0]).toMatchObject({ kind: 'rpe_high', targetRpe: 7 });
    const miss = [session('m', '2026-10-17', [{ exerciseId: 'bench', sets: [set(6, 6, 8), set(3, 6, 10)] }])];
    expect(preSessionSignals({ ...quiet, recent: miss }, ids, false)).toEqual([{ kind: 'rep_miss', exerciseId: 'bench', sessionId: 'm', localDate: '2026-10-17', targetReps: 6, reps: 3 }]);
    const run = { ...quiet, activities: [{ id: 'r', localDate: '2026-10-19', kind: 'run' as const, effort: 'long' as const, status: 'done' as const }] };
    expect(preSessionSignals(run, ids, true)).toEqual([{ kind: 'hard_run', activityId: 'r', localDate: '2026-10-19', effort: 'long' }]);
    expect(preSessionSignals(run, ids, false)).toEqual([]);
    expect(preSessionSignals({ ...quiet, checkIn: { id: 'c9', score: 2, localDate: '2026-10-20' } }, ids, false)).toEqual([{ kind: 'low_check_in', checkInId: 'c9', score: 2 }]);
    expect(nudgeReviewFacts([{ kind: 'low_check_in', checkInId: 'c9', score: 2 }])).toEqual([{ kind: 'check_in', checkInId: 'c9' }]);
  });

  it('the offer is code’s (one step lighter, or a set fewer), applied only on Apply; the line is checked', () => {
    const { snap, env } = world();
    const sig = [{ kind: 'rep_miss' as const, exerciseId: 'bench', sessionId: 'm', localDate: '2026-10-17', targetReps: 6, reps: 3 }];
    const offer = nudgeOffer(sig, snap, env);
    expect(offer?.id).toBe('nudge:rep_miss');
    expect(offer?.proposal.lines).toEqual(['Barbell bench press: 100 → 97.5 kg']);
    const low = nudgeOffer([{ kind: 'low_check_in', checkInId: 'c', score: 2 }], snap, env);
    expect(low?.proposal.lines).toEqual(['Incline dumbbell press: 3 → 2 sets', 'Cable fly: 3 → 2 sets', 'Triceps pushdown: 3 → 2 sets', 'Cable crunch: 3 → 2 sets']);

    const text = nudgeContextText({ day: 'Chest', signals: ['Barbell bench press on 2026-10-17: 3 reps against a target of 6'], offer: offer === null ? null : { id: offer.id, lines: offer.proposal.lines }, extras: { goal: null, painFlags: [] } });
    const facts = builderFacts([text]);
    expect(checkNudge({ speak: true, line: 'Only 3 reps last time: start at 97.5 kg?' }, offer, facts)).toMatchObject({ speak: true, offer: { id: 'nudge:rep_miss' } });
    expect(checkNudge({ speak: true, line: 'You only got 2 reps; drop to 95 kg?' }, offer, facts)).toEqual({ speak: false });
    expect(checkNudge({ speak: false, line: 'x' }, offer, facts)).toEqual({ speak: false });
    expect(checkNudge({ speak: true, line: 'Take it easy today.' }, offer, facts)).toEqual({ speak: true, line: 'Take it easy today.', offer });

    // Light model, low effort, one forced tool; Your data and Coaching knowledge apart.
    const model = builderModelFor('nudge', { main: 'gpt-main', light: 'gpt-light' });
    const req = buildNudgeRequest(text, model);
    expect([req.model, req.effort, req.toolChoice, req.tools.map((t) => t.name)]).toEqual(['gpt-light', 'low', { type: 'function', name: 'pre_session_nudge' }, ['pre_session_nudge']]);
    expect(req.input[0]?.type === 'message' && req.input[0].content.startsWith('YOUR DATA')).toBe(true);
    expect(req.input[1]?.type === 'message' && req.input[1].content.startsWith('COACHING KNOWLEDGE')).toBe(true);
    expect(builderModelFor('review', { main: 'gpt-main', light: 'gpt-light' })).toBe('gpt-main');
  });
});

describe('Mix it up pick', () => {
  it('the coach picks from the shortlist or code picks, labelled; Another cycles', () => {
    const facts = builderFacts(['{"lastDone":"3 weeks"}']);
    expect(checkMixPick({ exerciseId: 'crossover', reason: 'A lower-chest angle.' }, ['pec_deck', 'crossover'], facts)).toEqual({ by: 'coach', exerciseId: 'crossover', reason: 'A lower-chest angle.', order: ['crossover', 'pec_deck'] });
    expect(checkMixPick({ exerciseId: 'dips', reason: 'x' }, ['pec_deck', 'crossover'], facts)).toMatchObject({ by: 'code', exerciseId: 'pec_deck', why: 'off_list' });
    expect(checkMixPick({ exerciseId: 'crossover', reason: 'Not done in 5 weeks.' }, ['crossover'], facts)?.reason).toBeNull();
    expect(codeMixPick([], 'offline')).toBeNull();
    expect(nextMix(['a', 'b', 'c'], 'a')).toEqual({ exerciseId: 'b', index: 2, of: 3 });
    expect(nextMix(['a', 'b', 'c'], 'c')).toEqual({ exerciseId: 'a', index: 1, of: 3 });
  });
});

describe('requests: one forced strict tool, parsed or refused', () => {
  it('a valid call parses; a call with extra fields or another tool is refused; errors pass through', async () => {
    const { ctx, snap } = world();
    const view = builderWorkoutView(snap, ctx, 52);
    const extras: BuilderCoachExtras = { usable: [], painFlags: [], dayNotes: ['Include abs'], plan: null, goal: null, history: [], memories: [] };
    const req = buildReviewRequest(view, extras, ['✓ Mid chest 7'], 'gpt-main');
    expect([req.effort, req.model]).toEqual(['high', 'gpt-main']);
    const call = (name: string, args: unknown): ModelEvent[] => [{ type: 'tool_call', callId: 'c', name, arguments: JSON.stringify(args) }, { type: 'completed' }];
    const good = { verdict: 'Good', editComments: [], suggestions: [], nextNotes: [] };
    const port = new ScriptedCoachModel([call('review_workout', good), call('review_workout', { ...good, score: 9 }), call('fill_setup', good), [{ type: 'error', error: 'network' }]]);
    expect(await requestBuilderTool(port, req, BUILDER_COACH_TOOL.reviewWorkout)).toEqual({ ok: true, args: good });
    expect(await requestBuilderTool(port, req, BUILDER_COACH_TOOL.reviewWorkout)).toEqual({ ok: false, error: 'invalid_args' });
    expect(await requestBuilderTool(port, req, BUILDER_COACH_TOOL.reviewWorkout)).toEqual({ ok: false, error: 'no_answer' });
    expect(await requestBuilderTool(port, req, BUILDER_COACH_TOOL.reviewWorkout)).toEqual({ ok: false, error: 'network' });
  });
});
