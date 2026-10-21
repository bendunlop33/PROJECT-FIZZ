import { describe, expect, it } from 'vitest';

import { reduceSession, startWorkout, toIso } from '@fizz/domain';
import { at, barbell, exercise, GYM, id, idGen, kg, OWNER, profile, routine, routineExercise, stack, template, T0_MS, TZ, values } from '@fizz/domain/testing';
import { openStore, type Store } from '@fizz/persistence';
import { openNodeDriver } from '@fizz/persistence/node';
import type { Exercise, Routine, SessionAggregate, SessionCommand, TrainingReview, ZonedTimestamp } from '@fizz/schemas';

import type { CoachAvailability } from '../src/coach/coach-service';
import { createWeeklyReviewService } from '../src/reviews/weekly-review-service';
import { StepModel, toolCall } from './coach-model';

/**
 * The weekly auto-review (workout-builder-v3 §6.1, §6.2) over a real SQLite store: code's facts always;
 * the coach only when reachable (`Not reviewed · Offline` otherwise, rule 1); cached by its inputs; every
 * number in the coach's words checked; proposals Apply / Skip / Undo, refused when stale (rule 5).
 */

const BENCH: Exercise = exercise(200, 'Bench press', { primaryMuscles: ['chest'], secondaryMuscles: ['triceps'] });
const CURL: Exercise = exercise(210, 'Leg curl', { primaryMuscles: ['hamstrings'], compatibleEquipment: ['weight_stack'], defaultLoadConvention: 'stack', movementPattern: 'hinge' });
const EXERCISES = new Map([BENCH, CURL].map((e) => [e.id, e]));
const DAY_S = 86_400;
// T0 is Thu 8 Oct 19:00 in Auckland; the reviewed week is Mon 5 – Sun 11 Oct.
const OPEN_MS = T0_MS + 4.5 * DAY_S * 1000;

let wk = 0;
function workout(startS: number, ex: Exercise, sets: readonly { load: number; reps: number; rpe?: number }[]): SessionAggregate {
  wk += 1;
  const conv = ex.defaultLoadConvention;
  const r = routine([routineExercise(900 + wk, { exerciseId: ex.id, equipmentId: conv === 'stack' ? stack().id : barbell().id, setTemplates: sets.map((_, i) => template(90_000 + wk * 10 + i, { targetLoad: kg(sets[0]?.load ?? 20, conv), targetReps: { min: 5, max: 10 } })) })]);
  let s = startWorkout({ opId: `w-${String(wk)}`, owner: profile(), gymId: GYM, routine: { ...r, id: id(5000 + wk) }, exercises: EXERCISES, gymEquipment: [barbell(), stack()], at: at(startS), newId: idGen(2_000_000 + wk * 1000) }).aggregate;
  const apply = (cmd: SessionCommand) => {
    const res = reduceSession(s, cmd);
    if (!res.ok) throw new Error(res.error.message);
    s = res.state;
  };
  let t = startS + 60;
  let n = 0;
  while (s.session.activeSetId !== null && n < sets.length) {
    const set = sets[n] ?? { load: 20, reps: 5 };
    apply({ type: 'log_set', at: at(t), opId: `w-${String(wk)}-${String(n)}`, setId: s.session.activeSetId, values: values(kg(set.load, conv), set.reps, set.rpe === undefined ? {} : { rpe: set.rpe }), restTimerId: id(3_000_000 + wk * 100 + n) });
    t += 120;
    n += 1;
  }
  apply({ type: 'finish', at: at(t), opId: `w-${String(wk)}-f`, expectedVersion: s.session.version, endedAt: null });
  return s;
}

const ONLINE: CoachAvailability = { status: 'ok', model: 'gpt-main' };
const OFFLINE: CoachAvailability = { status: 'offline', model: null };

async function setUp(opts: { model?: StepModel | null; availability?: () => CoachAvailability } = {}) {
  const store: Store = await openStore(openNodeDriver(':memory:'));
  await store.repos.profiles.save(profile(), null);
  for (const e of EXERCISES.values()) await store.repos.exercises.save(e, null);
  for (const a of [
    workout(-15 * DAY_S, BENCH, [{ load: 90, reps: 6 }]),
    workout(-8 * DAY_S, BENCH, [{ load: 92.5, reps: 6 }]),
    workout(-2 * DAY_S, BENCH, [{ load: 95, reps: 6, rpe: 8 }, { load: 95, reps: 6, rpe: 9 }]),
    workout(0, CURL, [{ load: 40, reps: 10, rpe: 8 }, { load: 40, reps: 10, rpe: 8 }]),
  ])
    await store.repos.sessions.save(a, null);
  let clock = OPEN_MS;
  let n = 0;
  let availability = opts.availability ?? (() => ONLINE);
  const model = opts.model === null ? undefined : (opts.model ?? new StepModel([], { weekly: true }));
  const service = createWeeklyReviewService({
    store: () => store,
    profile: async () => store.repos.profiles.get(OWNER),
    now: (): ZonedTimestamp => ({ utc: toIso(clock), tz: TZ }),
    newId: () => id(7_000_000 + (n += 1)),
    availability: () => Promise.resolve(availability()),
    ...(model === undefined ? {} : { model: () => model }),
    mainLiftIds: () => Promise.resolve(new Set([BENCH.id])),
  });
  return {
    store,
    service,
    model,
    advance: (ms: number) => {
      clock += ms;
    },
    setAvailability: (a: () => CoachAvailability) => {
      availability = a;
    },
  };
}

const verdict = (args: { verdict: string; lines?: string[]; tweaks?: unknown[] }) => () => toolCall('weekly_review', { lines: [], tweaks: [], ...args });

describe('the weekly review on open', () => {
  it('offline: facts only, `Not reviewed · Offline`; online later: the coach looks once; then cached (no new call)', async () => {
    const model = new StepModel([verdict({ verdict: 'Solid week, 2 workouts.', lines: ['Bench press est. 1RM 114 kg.', 'Bench press hit 130 kg.'] })], { weekly: true });
    const h = await setUp({ model, availability: () => OFFLINE });
    const first = await h.service.runOnOpen();
    expect(first).toMatchObject({ kind: 'not_reviewed', status: 'offline' });
    if (first.kind !== 'not_reviewed') return;
    expect(first.review.subject).toEqual({ kind: 'weekly', weekMonday: '2026-10-05' });
    expect(first.review.coach).toEqual({ status: 'offline' });
    expect(first.review.facts.map((f) => f.kind)).toEqual(expect.arrayContaining(['week_sessions', 'group_sets', 'lift_trend', 'rpe_drift']));
    expect(model.requests).toHaveLength(0);
    const data = await h.service.reviews();
    expect(data?.latest?.verdict).toBe('Not reviewed · Offline');
    expect(data?.latest?.facts[0]).toBe('2 workouts');
    // Still offline on the next open: nothing is rewritten.
    expect(await h.service.runOnOpen()).toMatchObject({ kind: 'not_reviewed', status: 'offline' });
    expect((await h.store.repos.reviews.get(first.review.id))?.version).toBe(first.review.version);

    h.setAvailability(() => ONLINE);
    const second = await h.service.runOnOpen();
    expect(second.kind).toBe('reviewed');
    if (second.kind !== 'reviewed') return;
    // Same inputs: the same review gets its coach part (no new record); the wrong number is hidden.
    expect(second.review.id).toBe(first.review.id);
    expect(second.review.coach).toEqual({ status: 'reviewed', verdict: 'Solid week, 2 workouts.', lines: ['Bench press est. 1RM 114 kg.'], actionIds: [], numbersChecked: true });
    expect(model.requests[0]).toMatchObject({ model: 'gpt-main', effort: 'high', toolChoice: { name: 'weekly_review' } });

    expect(await h.service.runOnOpen()).toMatchObject({ kind: 'cached' });
    expect(model.requests).toHaveLength(1);
    expect((await h.store.repos.reviews.listByOwner(OWNER)).length).toBe(1);
  });

  it('new inputs (a workout logged into the week) make a new review that supersedes the old one', async () => {
    const model = new StepModel([verdict({ verdict: 'Good week' }), verdict({ verdict: 'Better week' })], { weekly: true });
    const h = await setUp({ model });
    const a = await h.service.runOnOpen();
    if (a.kind !== 'reviewed') throw new Error(a.kind);
    // A workout from that Sunday imported late.
    await h.store.repos.sessions.save(workout(2 * DAY_S, BENCH, [{ load: 97.5, reps: 5 }]), null);
    const b = await h.service.runOnOpen();
    if (b.kind !== 'reviewed') throw new Error(b.kind);
    expect(b.review.id).not.toBe(a.review.id);
    const all = await h.store.repos.reviews.listByOwner(OWNER);
    expect(all.find((r) => r.id === a.review.id)).toMatchObject({ status: 'superseded', supersededById: b.review.id });
    expect((await h.service.reviews())?.latest?.verdict).toBe('Better week');
  });

  it('no coach in the build: `Coach not connected`, never a canned reply; a failed call is `failed` and retried next open', async () => {
    const none = await setUp({ model: null });
    expect(await none.service.runOnOpen()).toMatchObject({ kind: 'not_reviewed', status: 'not_connected' });
    expect(await none.service.status()).toBe('Coach not connected');
    const failing = await setUp({ model: new StepModel([() => [{ type: 'error', error: 'usage_limit' }], verdict({ verdict: 'Fine week' })], { weekly: true }) });
    expect(await failing.service.runOnOpen()).toMatchObject({ kind: 'not_reviewed', status: 'failed' });
    expect(await failing.service.runOnOpen()).toMatchObject({ kind: 'reviewed' });
  });

  it('nothing to review with no history', async () => {
    const store = await openStore(openNodeDriver(':memory:'));
    await store.repos.profiles.save(profile(), null);
    const s = createWeeklyReviewService({ store: () => store, profile: () => store.repos.profiles.get(OWNER), now: () => ({ utc: toIso(OPEN_MS), tz: TZ }), newId: () => id(1), availability: () => Promise.resolve(ONLINE) });
    expect(await s.runOnOpen()).toEqual({ kind: 'nothing' });
    expect((await s.reviews())?.latest).toBeNull();
  });

  it('Progress › Reviews: Goal view is this week live (consistency first), lifts default to the main lifts, any logged exercise can be chosen', async () => {
    const h = await setUp({ model: new StepModel([verdict({ verdict: 'ok' })], { weekly: true }) });
    await h.service.runOnOpen();
    const data = await h.service.reviews();
    expect(data?.goal.sections[0]?.kind).toBe('consistency');
    expect(data?.liftsShown.map((l) => l.name)).toEqual(['Bench press']);
    expect(data?.liftsChosen).toBe(false);
    const choices = await h.service.liftChoices();
    expect(choices.map((c) => [c.name, c.shown])).toEqual([['Leg curl', false], ['Bench press', true]]);
  });
});

describe('weekly proposals: Apply / Skip / Undo, refused when stale (rule 5)', () => {
  async function withProposal() {
    const h = await setUp({ model: null });
    const legs: Routine = { ...routine([routineExercise(950, { exerciseId: CURL.id, setTemplates: [template(95_000, { targetLoad: kg(40, 'stack') }), template(95_001, { targetLoad: kg(40, 'stack') }), template(95_002, { targetLoad: kg(40, 'stack') })] })]), id: id(9300), name: 'Legs' };
    await h.store.repos.routines.save(legs, null);
    const review: TrainingReview = {
      id: id(9400),
      ownerId: OWNER,
      version: 1,
      createdAtUtc: toIso(OPEN_MS),
      updatedAtUtc: toIso(OPEN_MS),
      subject: { kind: 'weekly', weekMonday: '2026-10-05' },
      inputsHash: 'h',
      facts: [],
      coach: { status: 'offline' },
      status: 'current',
      supersededById: null,
      opIds: ['seed'],
      createdAt: { utc: toIso(OPEN_MS), tz: TZ },
      proposals: [
        { id: 'p1', source: 'code', change: { kind: 'template_sets', routineId: legs.id, routineName: 'Legs', expectedVersion: legs.version, exerciseId: CURL.id, exerciseName: 'Leg curl', fromSets: 3, toSets: 4 }, reason: '4 sets the last 2 times', status: 'open', actionId: null },
        { id: 'p2', source: 'coach', change: { kind: 'template_sets', routineId: legs.id, routineName: 'Legs', expectedVersion: legs.version, exerciseId: CURL.id, exerciseName: 'Leg curl', fromSets: 3, toSets: 2 }, reason: null, status: 'open', actionId: null },
      ],
    };
    await h.store.repos.reviews.record(OWNER, review);
    return { ...h, legs };
  }
  const workingOf = async (store: Store, rid: string) => (await store.repos.routines.get(rid))?.exercises[0]?.setTemplates.filter((t) => t.setType !== 'warmup').length;

  it('Apply writes the template’s next version with a record; a double tap writes once; Undo restores; nothing else changed', async () => {
    const h = await withProposal();
    const r = await h.service.applyProposal({ reviewId: id(9400), proposalId: 'p1', opId: 'tap-1' });
    expect(r).toMatchObject({ ok: true, line: 'Leg curl on Legs: 3 → 4 sets', proposal: { status: 'applied', canUndo: true } });
    expect(await workingOf(h.store, h.legs.id)).toBe(4);
    expect((await h.store.repos.routines.get(h.legs.id))?.version).toBe(h.legs.version + 1);
    expect(await h.service.applyProposal({ reviewId: id(9400), proposalId: 'p1', opId: 'tap-1' })).toMatchObject({ ok: true });
    expect((await h.store.repos.routines.get(h.legs.id))?.version).toBe(h.legs.version + 1);
    // The other proposal was made against the version before: out of date now.
    expect(await h.service.applyProposal({ reviewId: id(9400), proposalId: 'p2', opId: 'tap-2' })).toMatchObject({ ok: false, reason: 'out_of_date' });
    expect((await h.store.repos.reviews.get(id(9400)))?.proposals?.find((p) => p.id === 'p2')?.status).toBe('stale');
    const u = await h.service.undoProposal({ reviewId: id(9400), proposalId: 'p1', opId: 'undo-1' });
    expect(u).toMatchObject({ ok: true, proposal: { status: 'undone' } });
    expect(await workingOf(h.store, h.legs.id)).toBe(3);
  });

  it('Undo is refused once the template changed again since (rule 5)', async () => {
    const h = await withProposal();
    await h.service.applyProposal({ reviewId: id(9400), proposalId: 'p1', opId: 'tap-1' });
    const now = await h.store.repos.routines.get(h.legs.id);
    if (now === null) throw new Error('missing');
    await h.store.repos.routines.save({ ...now, name: 'Legs B', version: now.version + 1 }, now.version);
    expect(await h.service.undoProposal({ reviewId: id(9400), proposalId: 'p1', opId: 'undo-1' })).toMatchObject({ ok: false, reason: 'changed_since' });
    expect(await workingOf(h.store, h.legs.id)).toBe(4);
  });

  it('Skip changes nothing in the plan and survives a re-run of the review', async () => {
    const h = await withProposal();
    expect(await h.service.skipProposal({ reviewId: id(9400), proposalId: 'p2', opId: 'skip-1' })).toMatchObject({ ok: true, proposal: { status: 'skipped' } });
    expect(await workingOf(h.store, h.legs.id)).toBe(3);
    // A re-run with new inputs carries Ben's answers over.
    const run = await h.service.runOnOpen();
    if (run.kind !== 'not_reviewed') throw new Error(run.kind);
    expect(run.review.id).not.toBe(id(9400));
    expect(run.review.proposals?.map((p) => [p.id, p.status])).toEqual([['p2', 'skipped']]);
  });
});
