import { describe, expect, it } from 'vitest';

import { toMs, weeklyFacts, type ReviewSession, type ReviewSet, type ReviewTemplate, type WeeklyReviewInput } from '@fizz/domain';
import { BUILDER_COACH_TOOL_ARGS, type BuilderMuscleInfo, type Load } from '@fizz/schemas';
import { buildWeeklyRequest, builderModelFor, checkWeeklyReview, codeProposals, weeklyContextText, weeklyFactTexts } from '../src/index';

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
  return { sessionId: id(n), name: null, date, startedMs: toMs(`${date}T17:00:00.000Z`), startedAtUtc: `${date}T17:00:00.000Z`, routineId, template: routineId === null ? null : { routineId }, feel: null, exercises: ex.map((e) => ({ exerciseId: e.exerciseId, name: names[e.exerciseId] ?? 'X', equipmentKind: null, sets: e.sets, plannedWorking: e.planned ?? e.sets.length })) };
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
