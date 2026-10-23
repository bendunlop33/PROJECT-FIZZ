import { describe, expect, it } from 'vitest';

import { toMs, weeklyFacts, type ReviewSession, type ReviewSet, type ReviewTemplate, type WeeklyReviewInput } from '@fizz/domain';
import { BUILDER_COACH_TOOL_ARGS, type BuilderMuscleInfo, type Load, type ReviewProposal } from '@fizz/schemas';
import { buildWeeklyRequest, builderModelFor, carriedProposals, checkWeeklyReview, codeProposals, mergeCoachAsks, unansweredAsk, weeklyContextText, weeklyFactTexts } from '../src/index';

/** The weekly review's coach part (workout-builder-v3 §6.1, §6.2): every number checked, tweaks checked and offered only. */

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const BENCH = id(1);
const SQUAT = id(2);
const CURL = id(3);
const LEGS = id(51);
const CHEST = id(50);
const INFO: Record<string, BuilderMuscleInfo> = { [BENCH]: { primaryMuscles: ['chest'] }, [SQUAT]: { primaryMuscles: ['quads'] }, [CURL]: { primaryMuscles: ['hamstrings'] } };
const kg = (value: number): Load => ({ value, unit: 'kg', convention: 'total' });
const work = (load: Load, reps: number): ReviewSet => ({ setType: 'working', load, reps, rpe: null, targetRpe: null, counts: true });
const names: Record<string, string> = { [BENCH]: 'Barbell bench press', [SQUAT]: 'Back squat', [CURL]: 'Leg curl' };
let n = 200;
const sess = (date: string, ex: { exerciseId: string; sets: ReviewSet[]; planned?: number }[], routineId: string | null = null): ReviewSession => {
  n += 1;
  return { sessionId: id(n), name: null, date, startedMs: toMs(`${date}T17:00:00.000Z`), startedAtUtc: `${date}T17:00:00.000Z`, routineId, template: routineId === null ? null : { routineId }, feel: null, plannedReps: null, doneReps: 0, exercises: ex.map((e) => ({ exerciseId: e.exerciseId, name: names[e.exerciseId] ?? 'X', equipmentKind: null, sets: e.sets, plannedWorking: e.planned ?? e.sets.length })) };
};

const templates: ReviewTemplate[] = [
  { planId: id(60), routineId: CHEST, name: 'Chest', version: 2, exercises: [{ exerciseId: BENCH, name: 'Barbell bench press', workingSets: 4 }] },
  { planId: id(60), routineId: LEGS, name: 'Legs', version: 4, exercises: [{ exerciseId: SQUAT, name: 'Back squat', workingSets: 4 }, { exerciseId: CURL, name: 'Leg curl', workingSets: 3 }] },
];
const sessions = [
  sess('2026-09-29', [{ exerciseId: BENCH, sets: [work(kg(90), 6)] }], CHEST),
  sess('2026-10-06', [{ exerciseId: BENCH, sets: [work(kg(92.5), 6)] }], CHEST),
  sess('2026-10-08', [{ exerciseId: SQUAT, sets: [work(kg(120), 5)], planned: 4 }, { exerciseId: CURL, sets: [work(kg(40), 10)], planned: 4 }], LEGS),
  sess('2026-10-13', [{ exerciseId: BENCH, sets: [work(kg(95), 6), work(kg(95), 6), work(kg(95), 6)] }], CHEST),
  sess('2026-10-15', [{ exerciseId: SQUAT, sets: [work(kg(122.5), 5)], planned: 4 }, { exerciseId: CURL, sets: [work(kg(40), 10)], planned: 4 }], LEGS),
];
const input: WeeklyReviewInput = {
  monday: '2026-10-12',
  nowMs: toMs('2026-10-19T09:00:00.000Z'),
  tz: 'Europe/London',
  sessions,
  plans: [{ planId: id(60), appliedAtUtc: '2026-09-01T08:00:00.000Z', untilUtc: null, days: [{ routineId: CHEST, name: 'Chest' }, { routineId: LEGS, name: 'Legs' }, { routineId: id(52), name: 'Back' }], pausedDates: new Set() }],
  aim: null,
  goal: 'muscle',
  info: (x) => INFO[x] ?? null,
  lifts: [BENCH],
  liftTargets: [],
  activities: [{ id: id(70), date: '2026-10-14', kind: 'run', status: 'done', distanceM: 8000 }],
  templates,
  painFlagged: new Set(),
  unit: 'kg',
};
const facts = weeklyFacts(input);
const ctx = { facts, templates, painFlagged: new Set<string>(), prefix: 'r1', taken: [] };

describe('weekly review: the claim check on the coach’s words (rule 6)', () => {
  it('numbers code gave pass; a wrong number hides its sentence whole', () => {
    const r = checkWeeklyReview(
      {
        verdict: 'Solid week, 2 of 3 sessions.',
        lines: ['Bench press est. 1RM is up to 114 kg.', 'Chest had 3 sets against a 6–20 range.', 'You ran 1 run this week.', 'Squat hit 130 kg.', 'Bench 1RM 120 kg.', 'You trained 5 sessions.', 'Back is 20% down.'],
        tweaks: [],
      },
      ctx,
    );
    expect(r.verdict).toBe('Solid week, 2 of 3 sessions.');
    expect(r.lines).toEqual(['Bench press est. 1RM is up to 114 kg.', 'Chest had 3 sets against a 6–20 range.', 'You ran 1 run this week.']);
    expect(r.hidden).toEqual(['Squat hit 130 kg.', 'Bench 1RM 120 kg.', 'You trained 5 sessions.', 'Back is 20% down.']);
  });

  it('an un-labelled 1RM is hidden even with the right number (an estimate must say so)', () => {
    expect(checkWeeklyReview({ verdict: 'Bench 1RM 114 kg.', lines: [], tweaks: [] }, ctx).verdict).toBeNull();
  });
});

describe('weekly review: tweaks are checked offers (rule 3, 9), never applied here', () => {
  it('a valid tweak becomes an open proposal with code’s before/after; bad ones are refused', () => {
    const r = checkWeeklyReview(
      {
        verdict: 'Good week',
        lines: [],
        tweaks: [
          { routineId: LEGS, exerciseId: CURL, workingSets: 4, reason: 'Hamstrings had 1 set.' },
          { routineId: id(99), exerciseId: CURL, workingSets: 4, reason: 'x' },
          { routineId: LEGS, exerciseId: BENCH, workingSets: 4, reason: 'x' },
          { routineId: CHEST, exerciseId: BENCH, workingSets: 9, reason: 'x' },
          { routineId: CHEST, exerciseId: BENCH, workingSets: 4, reason: 'x' },
        ],
      },
      ctx,
    );
    expect(r.proposals).toEqual([
      { id: 'r1:coach:0', source: 'coach', change: { kind: 'template_sets', routineId: LEGS, routineName: 'Legs', expectedVersion: 4, exerciseId: CURL, exerciseName: 'Leg curl', fromSets: 3, toSets: 4 }, reason: 'Hamstrings had 1 set.', status: 'open', actionId: null },
    ]);
    expect(r.refused.map((x) => x.why)).toEqual(['not_in_plan', 'not_in_day', 'sets', 'same']);
  });

  it('pain-flagged: never a tweak; a reason with a wrong number is dropped, not rewritten; code’s own proposal wins a duplicate', () => {
    const pain = checkWeeklyReview({ verdict: 'ok', lines: [], tweaks: [{ routineId: LEGS, exerciseId: CURL, workingSets: 4, reason: 'x' }] }, { ...ctx, painFlagged: new Set([CURL]) });
    expect(pain.proposals).toEqual([]);
    expect(pain.refused[0]?.why).toBe('pain');
    const wrong = checkWeeklyReview({ verdict: 'ok', lines: [], tweaks: [{ routineId: LEGS, exerciseId: CURL, workingSets: 5, reason: 'Hamstrings had 9 sets.' }] }, ctx);
    expect(wrong.proposals[0]?.reason).toBeNull();
    const code = codeProposals(facts.edits, 'r1');
    expect(code.map((p) => [p.change.exerciseName, p.change.fromSets, p.change.toSets, p.reason])).toEqual([['Leg curl', 3, 4, '4 sets the last 2 times']]);
    const dup = checkWeeklyReview({ verdict: 'ok', lines: [], tweaks: [{ routineId: LEGS, exerciseId: CURL, workingSets: 5, reason: 'x' }] }, { ...ctx, taken: code });
    expect(dup.refused[0]?.why).toBe('duplicate');
  });
});

describe('weekly review request: one strict tool, the stronger model, Your data labelled', () => {
  it('routes to the main model at high effort with only weekly_review callable', () => {
    const text = weeklyContextText({ week: '2026-10-12', facts: weeklyFactTexts(facts), goal: 'muscle', planDays: templates.map((t) => ({ routineId: t.routineId, name: t.name, exercises: t.exercises })), painFlags: [] });
    const req = buildWeeklyRequest(text, builderModelFor('weekly', { main: 'gpt-main', light: 'gpt-light' }));
    expect(req).toMatchObject({ model: 'gpt-main', effort: 'high', toolChoice: { type: 'function', name: 'weekly_review' } });
    expect(req.tools).toHaveLength(1);
    expect(req.input[0]).toMatchObject({ role: 'developer' });
    expect(JSON.stringify(req.input[0])).toContain('YOUR DATA');
    expect(JSON.stringify(req.input[1])).toContain('COACHING KNOWLEDGE');
    expect(req.instructions).toContain('Never predict');
    expect(BUILDER_COACH_TOOL_ARGS.weekly_review.safeParse({ verdict: 'x', lines: ['a', 'b', 'c', 'd'], tweaks: [] }).success).toBe(false);
  });
});

describe('weekly review claim check: review fixes (b3-wave3-truth B1, B2)', () => {
  it('B1: an est. 1RM never passes as a load Ben lifted; it passes only when the sentence calls it an estimate', () => {
    expect(facts.lifts[0]?.points.map((p) => p.value)).toEqual([108, 111, 114]);
    const r = checkWeeklyReview({ verdict: 'Bench press is up to 114 kg.', lines: ['Bench press reached 114 kg for a single.', 'Bench press est. 1RM is up to 114 kg.', 'Bench press estimated max 114 kg.', 'Bench press moved 95 kg for 6 reps.'], tweaks: [] }, ctx);
    expect(r.verdict).toBeNull();
    expect(r.lines).toEqual(['Bench press est. 1RM is up to 114 kg.', 'Bench press estimated max 114 kg.', 'Bench press moved 95 kg for 6 reps.']);
    expect(r.hidden).toEqual(['Bench press is up to 114 kg.', 'Bench press reached 114 kg for a single.']);
  });

  it('B2: each session count is checked against the fact it names (missed, hard/easy/good, stalled, done)', () => {
    // 2 of 3 plan days done, the week over: 1 missed; no feel taps; nothing stalled.
    expect(facts.week).toMatchObject({ done: 2, planned: 3 });
    expect(facts.missedCount).toBe(1);
    const r = checkWeeklyReview({ verdict: 'You missed 2 sessions.', lines: ['You did 2 hard sessions.', 'You missed 1 session.', 'You trained 2 sessions.', 'Squat stalled for 3 sessions.', 'Nothing felt easy in 2 sessions.'], tweaks: [] }, ctx);
    expect(r.verdict).toBeNull();
    expect(r.lines).toEqual(['You missed 1 session.', 'You trained 2 sessions.']);
    expect(r.hidden).toEqual(['You missed 2 sessions.', 'You did 2 hard sessions.', 'Squat stalled for 3 sessions.', 'Nothing felt easy in 2 sessions.']);
  });

  it('B2: feel counts pass only for the word Ben tapped', () => {
    const felt = weeklyFacts({ ...input, sessions: sessions.map((s) => (s.date === '2026-10-13' ? { ...s, feel: 'hard' as const } : s)) });
    const r = checkWeeklyReview({ verdict: '1 session felt hard.', lines: ['You did 1 hard session.', '2 sessions felt hard.', 'You had 1 easy session.'], tweaks: [] }, { ...ctx, facts: felt });
    expect(r.verdict).toBe('1 session felt hard.');
    expect(r.lines).toEqual(['You did 1 hard session.']);
  });

  it('B2: a stalled count passes as a stall, never as sets', () => {
    const stall = ['2026-09-15', '2026-09-22', '2026-09-29', '2026-10-13'].map((d) => sess(d, [{ exerciseId: SQUAT, sets: [work(kg(120), 5)] }]));
    const f = weeklyFacts({ ...input, sessions: [...sessions.filter((s) => !s.exercises.some((e) => e.exerciseId === SQUAT)), ...stall] });
    expect(f.stalled.map((s) => s.exerciseId)).toEqual([SQUAT]);
    const r = checkWeeklyReview({ verdict: 'Back squat has stalled for 3 sessions.', lines: ['Back squat: 3 sets.'], tweaks: [] }, { ...ctx, facts: f });
    expect(r.verdict).toBe('Back squat has stalled for 3 sessions.');
    expect(r.lines).toEqual([]);
  });
});

describe('a re-run review: the coach’s unanswered asks (review build-b-21oct S1, progress-v3b-data B1)', () => {
  const ask = (over: Partial<ReviewProposal> = {}): ReviewProposal => ({ id: 'old:coach:0', source: 'coach', change: { kind: 'template_sets', routineId: LEGS, routineName: 'Legs', expectedVersion: 4, exerciseId: CURL, exerciseName: 'Leg curl', fromSets: 3, toSets: 4 }, reason: 'You missed 1 session. Leg curl: keep going.', status: 'open', actionId: null, ...over });
  // The Back day done on Sat: 3 of 3, nothing missed now.
  const after = weeklyFacts({ ...input, sessions: [...sessions, sess('2026-10-17', [{ exerciseId: BENCH, sets: [work(kg(60), 10)] }], id(52))] });

  it('a carried ask’s reason is checked again against the new facts: a number that no longer holds is hidden (rule 6)', () => {
    expect(after.missedCount).toBe(0);
    expect(carriedProposals([ask()], { facts, painFlagged: new Set() })[0]?.reason).toBe('You missed 1 session. Leg curl: keep going.');
    expect(carriedProposals([ask()], { facts: after, painFlagged: new Set() })[0]?.reason).toBe('Leg curl: keep going.');
    expect(carriedProposals([ask({ reason: 'You missed 1 session.' })], { facts: after, painFlagged: new Set() })[0]?.reason).toBeNull();
    // Out of date (not answered by Ben): checked too. Ben's answers keep their words as he saw them.
    expect(carriedProposals([ask({ status: 'stale' })], { facts: after, painFlagged: new Set() })[0]?.reason).toBe('Leg curl: keep going.');
    expect(carriedProposals([ask({ status: 'applied', actionId: 'a' })], { facts: after, painFlagged: new Set() })[0]?.reason).toBe('You missed 1 session. Leg curl: keep going.');
  });

  it('an open ask on a movement with a pain flag now is dropped (rule 9); code’s out-of-date ones are made again, not carried', () => {
    expect(carriedProposals([ask()], { facts, painFlagged: new Set([CURL]) })).toEqual([]);
    const code = codeProposals([{ routineId: LEGS, routineName: 'Legs', exerciseId: CURL, exerciseName: 'Leg curl', fromSets: 3, toSets: 4, sessions: 2, expectedVersion: 4 }], 'old');
    // Out of date: made again from this week's facts, never carried (an open one carries while its edit holds, below).
    expect(carriedProposals(code.map((p) => ({ ...p, id: `${p.id}:s`, status: 'stale' as const })), { facts, painFlagged: new Set() })).toEqual([]);
    expect(carriedProposals([ask({ status: 'skipped' })], { facts, painFlagged: new Set([CURL]) }).map((p) => p.status)).toEqual(['skipped']);
  });

  it('code’s open offer carries over (its ID kept) only while the week still holds the same edit, never on a pain-flagged movement (review v5offers N1)', () => {
    const edit = { routineId: LEGS, routineName: 'Legs', exerciseId: CURL, exerciseName: 'Leg curl', fromSets: 3, toSets: 4, sessions: 2, expectedVersion: 4 };
    const [old] = codeProposals([edit], 'old');
    if (old === undefined) throw new Error('no code proposal');
    const holding = { ...facts, edits: [edit] };
    expect(carriedProposals([old], { facts: holding, painFlagged: new Set() }).map((p) => [p.id, p.status])).toEqual([[old.id, 'open']]);
    // The edit went (or became another count): the old offer goes too.
    expect(carriedProposals([old], { facts: { ...facts, edits: [] }, painFlagged: new Set() })).toEqual([]);
    expect(carriedProposals([old], { facts: { ...facts, edits: [{ ...edit, toSets: 2 }] }, painFlagged: new Set() })).toEqual([]);
    expect(carriedProposals([old], { facts: holding, painFlagged: new Set([CURL]) })).toEqual([]);
  });

  it('a fresh coach tweak replaces an unanswered ask for the same exercise; never one Ben answered, or code’s', () => {
    const fresh = ask({ id: 'new:coach:0', change: { ...ask().change, toSets: 2 }, reason: 'Fresh.' });
    expect(mergeCoachAsks([ask()], [fresh]).map((p) => [p.id, p.change.toSets])).toEqual([['new:coach:0', 2]]);
    expect(mergeCoachAsks([ask({ status: 'stale', held: 'pain' })], [fresh]).map((p) => p.id)).toEqual(['new:coach:0']);
    for (const status of ['applied', 'skipped', 'undone'] as const) expect(mergeCoachAsks([ask({ status })], [fresh]).map((p) => p.id)).toEqual(['old:coach:0']);
    expect(mergeCoachAsks([ask({ source: 'code' })], [fresh]).map((p) => p.id)).toEqual(['old:coach:0']);
    // A tweak that replaces an offer stays an offer (review v5offers 4); one that replaces a plain ask doesn't gain the mark.
    expect(mergeCoachAsks([ask({ offer: true })], [fresh])[0]).toMatchObject({ id: 'new:coach:0', offer: true });
    expect(mergeCoachAsks([ask()], [fresh])[0]?.offer).toBeUndefined();
    // Another exercise is added; at most 4.
    const other = (n: number) => ask({ id: `o${String(n)}`, change: { ...ask().change, exerciseId: id(400 + n) } });
    expect(mergeCoachAsks([ask(), other(1), other(2)], [fresh, other(3), other(4)]).map((p) => p.id)).toEqual(['new:coach:0', 'o1', 'o2', 'o3']);
    expect(unansweredAsk(ask())).toBe(true);
    expect(unansweredAsk(ask({ source: 'code' }))).toBe(false);
  });
});
