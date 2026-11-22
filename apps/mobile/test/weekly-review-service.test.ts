import { describe, expect, it } from 'vitest';

import { CHANGE_TAP_LABEL, changeRowTaps, clearPainFlag, deriveId, newPainFlag, reduceSession, startWorkout, toIso } from '@fizz/domain';
import { at, barbell, exercise, GYM, id, idGen, kg, OWNER, profile, routine, routineExercise, stack, template, T0_MS, TZ, values } from '@fizz/domain/testing';
import { openStore, type Store } from '@fizz/persistence';
import { openNodeDriver } from '@fizz/persistence/node';
import type { CoachModelPort } from '@fizz/coach';
import type { Exercise, ReviewProposal, Routine, SessionAggregate, SessionCommand, TrainingReview, ZonedTimestamp } from '@fizz/schemas';

import type { CoachAvailability } from '../src/coach/coach-service';
import { runChangeTap } from '../src/reviews/change-taps';
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
    const data = await h.service.progress();
    expect(data?.changes).toMatchObject({ tag: 'Not reviewed · Offline', note: null, reviewed: false });
    expect(h.service.factLinesOf(first.review, () => 'Exercise')[0]).toBe('2 workouts');
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
    expect((await h.service.progress())?.changes?.note).toBe('Better week');
  });

  it('no coach in the build: `Coach not connected`, never a canned reply; a failed call is `failed`, not asked again for 6 h (review b3-wave3-truth S4)', async () => {
    const none = await setUp({ model: null });
    expect(await none.service.runOnOpen()).toMatchObject({ kind: 'not_reviewed', status: 'not_connected' });
    expect(await none.service.status()).toBe('Coach not connected');
    const model = new StepModel([() => [{ type: 'error', error: 'usage_limit' }], () => [{ type: 'error', error: 'usage_limit' }], verdict({ verdict: 'Fine week' })], { weekly: true });
    const failing = await setUp({ model });
    const first = await failing.service.runOnOpen();
    expect(first).toMatchObject({ kind: 'not_reviewed', status: 'failed' });
    if (first.kind !== 'not_reviewed') return;
    expect(first.review.coach).toMatchObject({ status: 'failed', atUtc: expect.any(String) as unknown });
    // Back in the app soon after: no new call (Ben's plan allowance).
    failing.advance(60_000);
    expect(await failing.service.runOnOpen()).toMatchObject({ kind: 'not_reviewed', status: 'failed' });
    expect(model.requests).toHaveLength(1);
    // 6 h later it asks again; failing again restarts the wait.
    failing.advance(6 * 3_600_000);
    expect(await failing.service.runOnOpen()).toMatchObject({ kind: 'not_reviewed', status: 'failed' });
    expect(model.requests).toHaveLength(2);
    failing.advance(60_000);
    expect(await failing.service.runOnOpen()).toMatchObject({ kind: 'not_reviewed', status: 'failed' });
    expect(model.requests).toHaveLength(2);
    failing.advance(6 * 3_600_000);
    expect(await failing.service.runOnOpen()).toMatchObject({ kind: 'reviewed' });
    expect(model.requests).toHaveLength(3);
  });

  it('each stored write tells the screens (pending, then the coach’s part); a cached run tells nothing (review b3-wave3-ux B2)', async () => {
    const h = await setUp({ model: new StepModel([verdict({ verdict: 'Good week' })], { weekly: true }) });
    const seen: string[] = [];
    const off = h.service.subscribe(() => {
      seen.push('changed');
    });
    expect(await h.service.runOnOpen()).toMatchObject({ kind: 'reviewed' });
    // The pending write, the coach call going out (`Reviewing…`), the coach's part.
    expect(seen).toEqual(['changed', 'changed', 'changed']);
    expect(await h.service.runOnOpen()).toMatchObject({ kind: 'cached' });
    expect(seen).toHaveLength(3);
    off();
    // Offline: the pending write is told and the run's end; never `Reviewing…` (no call goes out; review
    // progress-v3b-data N1). A later open with nothing new isn't rewritten, and is told once.
    const o = await setUp({ model: new StepModel([], { weekly: true }), availability: () => OFFLINE });
    let n = 0;
    let reviewing = 0;
    o.service.subscribe(() => {
      n += 1;
      void o.service.progress().then((d) => {
        if (d?.changes?.tag === 'Reviewing…') reviewing += 1;
      });
    });
    const first = await o.service.runOnOpen();
    expect(n).toBe(2);
    const before = n;
    await o.service.runOnOpen();
    if (first.kind !== 'not_reviewed') throw new Error(first.kind);
    expect((await o.store.repos.reviews.get(first.review.id))?.version).toBe(first.review.version);
    expect(n - before).toBe(1);
    await new Promise((r) => setTimeout(r, 20));
    expect(reviewing).toBe(0);
    expect((await o.service.progress())?.changes?.tag).toBe('Not reviewed · Offline');
  });

  it('`Reviewing…` while the coach call is out, then the stored result once it returns (review build-b-21oct S2)', async () => {
    const h = await setUp({ model: new StepModel([verdict({ verdict: 'Good week' })], { weekly: true }), availability: () => OFFLINE });
    await h.service.runOnOpen();
    expect((await h.service.progress())?.changes?.tag).toBe('Not reviewed · Offline');
    // Back online, but the call is slow: hold it in the model port.
    let release: (() => void) | null = null;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const inner = h.model ?? new StepModel([], { weekly: true });
    const gated: CoachModelPort = {
      async *stream(req) {
        await gate;
        yield* inner.stream(req);
      },
    };
    let n = 0;
    const slow = createWeeklyReviewService({
      store: () => h.store,
      profile: async () => h.store.repos.profiles.get(OWNER),
      now: (): ZonedTimestamp => ({ utc: toIso(OPEN_MS), tz: TZ }),
      newId: () => id(8_000_000 + (n += 1)),
      availability: () => Promise.resolve(ONLINE),
      model: () => gated,
      mainLiftIds: () => Promise.resolve(new Set([BENCH.id])),
    });
    let told = 0;
    slow.subscribe(() => {
      told += 1;
    });
    const run = slow.runOnOpen();
    for (let i = 0; i < 50 && told === 0; i += 1) await new Promise((r) => setTimeout(r, 5));
    expect((await slow.progress())?.changes?.tag).toBe('Reviewing…');
    (release as unknown as () => void)();
    expect(await run).toMatchObject({ kind: 'reviewed' });
    expect(told).toBeGreaterThanOrEqual(2);
    expect((await slow.progress())?.changes).toMatchObject({ tag: 'Coach', note: 'Good week' });
  });

  it('a coach call that throws: the page is told and `Reviewing…` goes (review progress-v3b-design S4)', async () => {
    const h = await setUp({ model: null, availability: () => OFFLINE });
    await h.service.runOnOpen();
    let n = 0;
    const broken = createWeeklyReviewService({
      store: () => h.store,
      profile: async () => h.store.repos.profiles.get(OWNER),
      now: (): ZonedTimestamp => ({ utc: toIso(OPEN_MS), tz: TZ }),
      newId: () => id(8_100_000 + (n += 1)),
      availability: () => Promise.resolve(ONLINE),
      model: () => {
        throw new Error('port gone');
      },
      mainLiftIds: () => Promise.resolve(new Set([BENCH.id])),
    });
    let told = 0;
    broken.subscribe(() => {
      told += 1;
    });
    expect(await broken.runOnOpen()).toEqual({ kind: 'failed' });
    // `Reviewing…` when the call went out, then told again once it threw.
    expect(told).toBe(2);
    const tag = (await broken.progress())?.changes?.tag;
    expect(tag).toMatch(/^Not reviewed · /);
    expect(tag).not.toBe('Reviewing…');
  });

  it('a new pain flag re-runs the review (its inputs changed; rule 9, review b3-wave3-truth B5)', async () => {
    const h = await setUp({ model: null });
    const a = await h.service.runOnOpen();
    if (a.kind !== 'not_reviewed') throw new Error(a.kind);
    expect(await h.service.runOnOpen()).toMatchObject({ kind: 'not_reviewed' });
    await h.store.repos.painFlags.save(newPainFlag({ id: id(9500), ownerId: OWNER, opId: 'pain-1', exerciseId: CURL.id, exerciseName: CURL.name, area: null, source: 'check_in', checkInId: null, at: at(0) }), null);
    const b = await h.service.runOnOpen();
    if (b.kind !== 'not_reviewed') throw new Error(b.kind);
    expect(b.review.id).not.toBe(a.review.id);
  });

  it('nothing to review with no history', async () => {
    const store = await openStore(openNodeDriver(':memory:'));
    await store.repos.profiles.save(profile(), null);
    const s = createWeeklyReviewService({ store: () => store, profile: () => store.repos.profiles.get(OWNER), now: () => ({ utc: toIso(OPEN_MS), tz: TZ }), newId: () => id(1), availability: () => Promise.resolve(ONLINE) });
    expect(await s.runOnOpen()).toEqual({ kind: 'nothing' });
    expect((await s.progress())?.changes).toBeNull();
  });

  it('Progress (v3): This week live with % of planned reps, lifts default to the main lifts, any logged exercise can be chosen (with reps when not in the plan)', async () => {
    const h = await setUp({ model: new StepModel([verdict({ verdict: 'ok' })], { weekly: true }) });
    await h.service.runOnOpen();
    // Back to Thu 8 Oct, 20:00 (Auckland): the live week is 5–11 Oct.
    h.advance(-4.5 * DAY_S * 1000 + 3_600_000);
    const data = await h.service.progress();
    if (data === null) throw new Error('no data');
    expect(data.week.range).toBe('5–11 Oct');
    // Templates plan 5–10 reps a set (the low end counts): 2 × 6 of 2 × 5 is 120%; 2 × 10 of 2 × 5 is 200%.
    expect(data.week.chips.map((c) => c.line.replaceAll('\u00a0', ' '))).toEqual(['Tue – 120%', 'Thu – 200%']);
    expect(data.week.sessions).toBe('2');
    expect(data.lifts.lifts.map((l) => [l.name, l.colour, l.repsSource])).toEqual([['Bench press', 0, 'logged']]);
    expect(data.lifts.lifts[0]?.points.map((p) => p.value)).toEqual([90, 92.5, 95]);
    expect(data.muscles.rows.map((r) => r.key)).toEqual(['Chest', 'Back', 'Shoulders', 'Quads', 'Hamstrings', 'Calves', 'Biceps', 'Triceps', 'Core']);
    expect(data.liftsChosen).toBe(false);
    const choices = await h.service.liftChoices();
    expect(choices.map((c) => [c.name, c.shown, c.needsReps, c.reps])).toEqual([['Leg curl', false, true, 10], ['Bench press', true, true, 6]]);
  });
});

describe('PBs need the lift’s whole history (review progress-v3b-design S2, data S3)', () => {
  it('a lift whose history can’t be read shows no PB (no ring, tag or `New best`), never one judged on the loaded weeks only (rule 6)', async () => {
    const h = await setUp({ model: null });
    expect((await h.service.progress())?.lifts.lifts.find((l) => l.exerciseId === BENCH.id)?.latestPb).toBe(true);
    const broken: Store = { ...h.store, listExerciseHistory: () => Promise.reject(new Error('read failed')) };
    const service = createWeeklyReviewService({ store: () => broken, profile: async () => h.store.repos.profiles.get(OWNER), now: (): ZonedTimestamp => ({ utc: toIso(OPEN_MS), tz: TZ }), newId: () => id(8_200_000), availability: () => Promise.resolve(OFFLINE), mainLiftIds: () => Promise.resolve(new Set([BENCH.id])) });
    const bench = (await service.progress())?.lifts.lifts.find((l) => l.exerciseId === BENCH.id);
    expect(bench?.latestPb).toBe(false);
    expect(bench?.points.some((p) => p.pb)).toBe(false);
    const sessions = await h.store.repos.sessions.listFinishedBetweenReadable(OWNER, toIso(OPEN_MS - 30 * DAY_S * 1000), toIso(OPEN_MS));
    const newest = [...sessions.sessions].filter((a) => a.exercises.some((e) => e.exerciseId === BENCH.id)).sort((a, b) => (a.session.startedAt.utc < b.session.startedAt.utc ? 1 : -1))[0];
    expect(await h.service.sessionBests(newest?.session.id ?? '')).toHaveLength(1);
    expect(await service.sessionBests(newest?.session.id ?? '')).toEqual([]);
  });

  it('history is read once per lift while the finished workouts are the same; a new or changed workout reads it again', async () => {
    const h = await setUp({ model: null });
    let reads = 0;
    const counted: Store = {
      ...h.store,
      listExerciseHistory: (owner, ex) => {
        reads += 1;
        return h.store.listExerciseHistory(owner, ex);
      },
    };
    const service = createWeeklyReviewService({ store: () => counted, profile: async () => h.store.repos.profiles.get(OWNER), now: (): ZonedTimestamp => ({ utc: toIso(OPEN_MS), tz: TZ }), newId: () => id(8_300_000), availability: () => Promise.resolve(OFFLINE), mainLiftIds: () => Promise.resolve(new Set([BENCH.id])) });
    const first = (await service.progress())?.lifts;
    expect(reads).toBe(1);
    await service.progress();
    await service.sessionBests('none');
    expect(reads).toBe(1);
    // A heavier older bench imported: read again, and the PB goes (it no longer beats every earlier set).
    await h.store.repos.sessions.save(workout(-200 * DAY_S, BENCH, [{ load: 120, reps: 6 }]), null);
    const after = (await service.progress())?.lifts;
    expect(reads).toBe(2);
    expect(first?.lifts.find((l) => l.exerciseId === BENCH.id)?.latestPb).toBe(true);
    expect(after?.lifts.find((l) => l.exerciseId === BENCH.id)?.latestPb).toBe(false);
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
        { id: 'p1', source: 'code', change: { kind: 'template_sets', routineId: legs.id, routineName: 'Legs', expectedVersion: legs.version, exerciseId: CURL.id, exerciseName: 'Leg curl', fromSets: 3, toSets: 4 }, reason: '2 sets the last 2 times', status: 'open', actionId: null },
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

  it('Undo is refused once that exercise’s sets changed again since (rule 5); another edit to the routine stays and doesn’t block it', async () => {
    const h = await withProposal();
    await h.service.applyProposal({ reviewId: id(9400), proposalId: 'p1', opId: 'tap-1' });
    const now = await h.store.repos.routines.get(h.legs.id);
    if (now === null) throw new Error('missing');
    const ex = now.exercises[0];
    if (ex === undefined) throw new Error('missing');
    await h.store.repos.routines.save({ ...now, exercises: [{ ...ex, setTemplates: [...ex.setTemplates, { ...ex.setTemplates[0], id: id(95_009) } as (typeof ex.setTemplates)[number]] }], version: now.version + 1 }, now.version);
    expect(await h.service.undoProposal({ reviewId: id(9400), proposalId: 'p1', opId: 'undo-1' })).toMatchObject({ ok: false, reason: 'changed_since' });
    expect(await workingOf(h.store, h.legs.id)).toBe(5);

    const h2 = await withProposal();
    await h2.service.applyProposal({ reviewId: id(9400), proposalId: 'p1', opId: 'tap-1' });
    const n2 = await h2.store.repos.routines.get(h2.legs.id);
    if (n2 === null) throw new Error('missing');
    await h2.store.repos.routines.save({ ...n2, name: 'Legs B', version: n2.version + 1 }, n2.version);
    expect(await h2.service.undoProposal({ reviewId: id(9400), proposalId: 'p1', opId: 'undo-1' })).toMatchObject({ ok: true, proposal: { status: 'undone' } });
    expect(await workingOf(h2.store, h2.legs.id)).toBe(3);
    expect((await h2.store.repos.routines.get(h2.legs.id))?.name).toBe('Legs B');
  });

  it('Apply is refused once the exercise is pain-flagged after the review (rule 9; review b3-wave3-truth B5)', async () => {
    const h = await withProposal();
    await h.store.repos.painFlags.save(newPainFlag({ id: id(9501), ownerId: OWNER, opId: 'pain-2', exerciseId: CURL.id, exerciseName: CURL.name, area: null, source: 'check_in', checkInId: null, at: at(0) }), null);
    // Held for the pain flag, and said so (review build-b-21oct S3), never `Out of date`.
    expect(await h.service.applyProposal({ reviewId: id(9400), proposalId: 'p1', opId: 'tap-1' })).toMatchObject({ ok: false, reason: 'pain', message: 'Held · pain' });
    expect(await workingOf(h.store, h.legs.id)).toBe(3);
    expect((await h.store.repos.routines.get(h.legs.id))?.version).toBe(h.legs.version);
    expect((await h.store.repos.reviews.get(id(9400)))?.proposals?.find((p) => p.id === 'p1')).toMatchObject({ status: 'stale', held: 'pain' });
  });

  it('`Held · pain` only while the flag is active: cleared, the change reads `Out of date` (review progress-v3b S1/S3)', async () => {
    const h = await withProposal();
    const flag = newPainFlag({ id: id(9504), ownerId: OWNER, opId: 'pain-5', exerciseId: CURL.id, exerciseName: CURL.name, area: null, source: 'check_in', checkInId: null, at: at(0) });
    await h.store.repos.painFlags.save(flag, null);
    expect(await h.service.applyProposal({ reviewId: id(9400), proposalId: 'p1', opId: 'tap-1' })).toMatchObject({ ok: false, reason: 'pain' });
    const row = async () => (await h.service.progress())?.changes?.asks.concat((await h.service.progress())?.changes?.rows ?? []).find((r) => r.id === 'p1');
    expect(await row()).toMatchObject({ statusText: 'Held · pain', canApply: false });
    await h.store.repos.painFlags.save(clearPainFlag(flag, at(60)), flag.version);
    expect(await row()).toMatchObject({ statusText: 'Out of date', canApply: false });
    expect(await workingOf(h.store, h.legs.id)).toBe(3);
  });

  it('a force-close between Apply’s write and its mark: the next tap marks it applied (one write, Undo kept); the same for Undo (review b3-wave3-truth S3)', async () => {
    const h = await withProposal();
    await h.service.applyProposal({ reviewId: id(9400), proposalId: 'p1', opId: 'tap-1' });
    // The mark lost: put the proposal back to open, as if the app died after the template write.
    const lose = async (status: 'open' | 'applied') => {
      const r = await h.store.repos.reviews.get(id(9400));
      if (r === null) throw new Error('missing');
      const actionId = r.proposals?.find((p) => p.id === 'p1')?.actionId ?? null;
      // The mark (and its op) never landed (review progress-v3-design S7: this helper wrote nothing before).
      const w = await h.store.repos.reviews.update(OWNER, { ...r, version: r.version + 1, opIds: [...r.opIds.filter((o) => !o.endsWith(':mark')), `lose-${status}`], proposals: (r.proposals ?? []).map((p) => (p.id === 'p1' ? { ...p, status, actionId: status === 'open' ? null : actionId } : p)) }, r.version, `lose-${status}`);
      expect(w.status).toBe('written');
    };
    await lose('open');
    const again = await h.service.applyProposal({ reviewId: id(9400), proposalId: 'p1', opId: 'tap-2' });
    expect(again).toMatchObject({ ok: true, proposal: { status: 'applied', canUndo: true } });
    expect((await h.store.repos.routines.get(h.legs.id))?.version).toBe(h.legs.version + 1);
    expect(await workingOf(h.store, h.legs.id)).toBe(4);
    await h.service.undoProposal({ reviewId: id(9400), proposalId: 'p1', opId: 'undo-1' });
    await lose('applied');
    expect(await h.service.undoProposal({ reviewId: id(9400), proposalId: 'p1', opId: 'undo-2' })).toMatchObject({ ok: true, proposal: { status: 'undone' } });
    expect(await workingOf(h.store, h.legs.id)).toBe(3);
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

describe('Coach’s changes (Progress v3, rule 3): small changes applied with Undo, Redo, Got it', () => {
  /** A stored review from a real run, then given open proposals (as a run that stored them and was force-closed before applying). */
  async function stored(model: StepModel | null = null) {
    const h = await setUp({ model });
    const first = await h.service.runOnOpen();
    if (first.kind !== 'not_reviewed' && first.kind !== 'reviewed') throw new Error(first.kind);
    const legs: Routine = { ...routine([routineExercise(960, { exerciseId: CURL.id, setTemplates: [template(96_000, { targetLoad: kg(40, 'stack') }), template(96_001, { targetLoad: kg(40, 'stack') }), template(96_002, { targetLoad: kg(40, 'stack') })] })]), id: id(9310), name: 'Legs' };
    await h.store.repos.routines.save(legs, null);
    const r = first.review;
    // p1 is the coach's CA8-small change (one set fewer, with its reason): the review applies it. p2 adds a set nobody asked for: an offer (D2).
    const proposals: ReviewProposal[] = [
      { id: 'p1', source: 'coach', change: { kind: 'template_sets', routineId: legs.id, routineName: 'Legs', expectedVersion: legs.version, exerciseId: CURL.id, exerciseName: 'Leg curl', fromSets: 3, toSets: 2 }, reason: 'Legs ran long', status: 'open', actionId: null },
      { id: 'p2', source: 'coach', change: { kind: 'template_sets', routineId: legs.id, routineName: 'Legs', expectedVersion: legs.version, exerciseId: CURL.id, exerciseName: 'Leg curl', fromSets: 3, toSets: 4 }, reason: 'Legs ran short', status: 'open', actionId: null },
    ];
    expect(await h.store.repos.reviews.update(OWNER, { ...r, proposals, version: r.version + 1, opIds: [...r.opIds, 'seed-proposals'] }, r.version, 'seed-proposals')).toMatchObject({ status: 'written' });
    return { ...h, legs, reviewId: r.id };
  }
  const workingOf = async (store: Store, rid: string) => (await store.repos.routines.get(rid))?.exercises[0]?.setTemplates.filter((t) => t.setType !== 'warmup').length;

  it('the next open applies the small change itself (recorded with reason and author), once; the offer is never written; Apply on it once stale is refused (rules 3, 5; D2)', async () => {
    const h = await stored();
    const run = await h.service.runOnOpen();
    if (run.kind === 'nothing' || run.kind === 'failed') throw new Error(run.kind);
    expect(run.review.proposals?.map((p) => [p.id, p.status])).toEqual([['p1', 'applied'], ['p2', 'open']]);
    expect(await workingOf(h.store, h.legs.id)).toBe(2);
    const actionId = run.review.proposals?.[0]?.actionId ?? '';
    expect(await h.store.repos.coach.getAction(actionId)).toMatchObject({ author: 'coach', reason: 'Legs ran long', detail: { kind: 'update_routine' } });
    // Another open: nothing written twice, and the offer still waits for Ben.
    await h.service.runOnOpen();
    expect((await h.store.repos.routines.get(h.legs.id))?.version).toBe(h.legs.version + 1);
    let view = (await h.service.progress())?.changes;
    expect(view?.rows.map((r) => [r.exercise, r.after, r.status, r.canUndo])).toEqual([['Leg curl', '2 sets', 'applied', true]]);
    expect(view?.asks.map((r) => [r.exercise, r.after, r.status, r.offer, r.statusText, r.canApply])).toEqual([['Leg curl', '4 sets', 'open', true, null, true]]);
    expect(view?.collapsed).toBe('1 change for next week · 1 to review');
    // Ben taps Apply on the offer: made against 3 sets, the plan has 2 now, so it is refused and nothing is written (rule 5).
    expect(await h.service.applyProposal({ reviewId: h.reviewId, proposalId: 'p2', opId: 'apply-p2' })).toMatchObject({ ok: false, reason: 'out_of_date' });
    expect(await workingOf(h.store, h.legs.id)).toBe(2);
    view = (await h.service.progress())?.changes;
    expect(view?.asks.map((r) => [r.exercise, r.status, r.statusText, r.canApply])).toEqual([['Leg curl', 'stale', 'Out of date', false]]);
  });

  it('a pain flag since the review: the small change isn’t applied (rule 9)', async () => {
    const h = await stored();
    await h.store.repos.painFlags.save(newPainFlag({ id: id(9502), ownerId: OWNER, opId: 'pain-3', exerciseId: CURL.id, exerciseName: CURL.name, area: null, source: 'check_in', checkInId: null, at: at(0) }), null);
    await h.service.runOnOpen();
    expect(await workingOf(h.store, h.legs.id)).toBe(3);
  });

  it('Undo, then Redo while the template is as the change left it; Redo refused once Ben changed the sets since (rule 5)', async () => {
    const h = await stored();
    await h.service.runOnOpen();
    expect(await h.service.undoProposal({ reviewId: h.reviewId, proposalId: 'p1', opId: 'undo-a' })).toMatchObject({ ok: true, proposal: { status: 'undone' } });
    expect(await workingOf(h.store, h.legs.id)).toBe(3);
    // The next open doesn't put it back: an undone change stays undone.
    await h.service.runOnOpen();
    expect(await workingOf(h.store, h.legs.id)).toBe(3);
    expect(await h.service.redoProposal({ reviewId: h.reviewId, proposalId: 'p1', opId: 'redo-a' })).toMatchObject({ ok: true, proposal: { status: 'applied', canUndo: true } });
    expect(await workingOf(h.store, h.legs.id)).toBe(2);
    // The same tap again: one write.
    const v = (await h.store.repos.routines.get(h.legs.id))?.version;
    await h.service.redoProposal({ reviewId: h.reviewId, proposalId: 'p1', opId: 'redo-a' });
    expect((await h.store.repos.routines.get(h.legs.id))?.version).toBe(v);
    await h.service.undoProposal({ reviewId: h.reviewId, proposalId: 'p1', opId: 'undo-b' });
    const now = await h.store.repos.routines.get(h.legs.id);
    if (now === null) throw new Error('missing');
    const ex = now.exercises[0];
    if (ex === undefined) throw new Error('missing');
    await h.store.repos.routines.save({ ...now, exercises: [{ ...ex, setTemplates: [...ex.setTemplates, { ...ex.setTemplates[0], id: id(96_009) } as (typeof ex.setTemplates)[number]] }], version: now.version + 1 }, now.version);
    expect(await h.service.redoProposal({ reviewId: h.reviewId, proposalId: 'p1', opId: 'redo-b' })).toMatchObject({ ok: false, reason: 'changed_since' });
    expect(await workingOf(h.store, h.legs.id)).toBe(4);
  });

  it('NEW until Got it (versioned, idempotent; a tap on an older version is refused); kept through a re-run with nothing new', async () => {
    const h = await setUp({ model: null });
    const run = await h.service.runOnOpen();
    if (run.kind !== 'not_reviewed') throw new Error(run.kind);
    const before = (await h.service.progress())?.changes;
    expect(before?.isNew).toBe(true);
    expect(await h.service.markSeen({ reviewId: run.review.id, expectedVersion: (before?.version ?? 0) - 1, opId: 'seen-0' })).toBe(false);
    expect(await h.service.markSeen({ reviewId: run.review.id, expectedVersion: before?.version ?? 0, opId: 'seen-1' })).toBe(true);
    expect(await h.service.markSeen({ reviewId: run.review.id, expectedVersion: before?.version ?? 0, opId: 'seen-1' })).toBe(true);
    expect((await h.service.progress())?.changes?.isNew).toBe(false);
    // A pain flag re-runs the review with nothing new to show: still seen.
    await h.store.repos.painFlags.save(newPainFlag({ id: id(9503), ownerId: OWNER, opId: 'pain-4', exerciseId: CURL.id, exerciseName: CURL.name, area: null, source: 'check_in', checkInId: null, at: at(0) }), null);
    const again = await h.service.runOnOpen();
    if (again.kind !== 'not_reviewed') throw new Error(again.kind);
    expect(again.review.id).not.toBe(run.review.id);
    expect((await h.service.progress())?.changes?.isNew).toBe(false);
  });

  it('the coach’s part arriving later is news: NEW again', async () => {
    const model = new StepModel([verdict({ verdict: 'Solid week' })], { weekly: true });
    const h = await setUp({ model, availability: () => OFFLINE });
    const run = await h.service.runOnOpen();
    if (run.kind !== 'not_reviewed') throw new Error(run.kind);
    await h.service.markSeen({ reviewId: run.review.id, expectedVersion: run.review.version, opId: 'seen-1' });
    expect((await h.service.progress())?.changes?.isNew).toBe(false);
    h.setAvailability(() => ONLINE);
    await h.service.runOnOpen();
    expect((await h.service.progress())?.changes).toMatchObject({ isNew: true, note: 'Solid week', tag: 'Coach' });
  });
});

describe('Coach’s changes: two exercises on one plan day, restart safety, honest states (reviews progress-v3 B1–B3, S5–S7)', () => {
  const ROW: Exercise = BENCH;
  /** Legs with Leg curl and a second exercise, and a review whose changes are `extra` (open; by default one set fewer, CA8-small). */
  async function twoOnLegs(extra: (legs: Routine) => ReviewProposal[], more: { stalled?: readonly string[] } = {}) {
    const h = await setUp({ model: null });
    const first = await h.service.runOnOpen();
    if (first.kind !== 'not_reviewed') throw new Error(first.kind);
    const three = (base: number) => [template(base, { targetLoad: kg(40, 'stack') }), template(base + 1, { targetLoad: kg(40, 'stack') }), template(base + 2, { targetLoad: kg(40, 'stack') })];
    const legs: Routine = { ...routine([routineExercise(970, { exerciseId: CURL.id, setTemplates: three(97_000) }), routineExercise(971, { exerciseId: ROW.id, setTemplates: three(97_100) })]), id: id(9320), name: 'Legs' };
    await h.store.repos.routines.save(legs, null);
    const r = first.review;
    // `stalled`: the week's own facts flag these lifts as stalled (code's `stalled_lift`, as a run stores them).
    const facts = [...r.facts, ...(more.stalled ?? []).map((exerciseId) => ({ kind: 'stalled_lift' as const, exerciseId, sessions: 3 }))];
    expect(await h.store.repos.reviews.update(OWNER, { ...r, facts, proposals: extra(legs), version: r.version + 1, opIds: [...r.opIds, 'seed-two'] }, r.version, 'seed-two')).toMatchObject({ status: 'written' });
    return { ...h, legs, reviewId: r.id };
  }
  /** `e…`: code's own (Ben's repeated edit); any other ID is the coach's. */
  const change = (legs: Routine, pid: string, ex: Exercise, name: string, reason: string | null, toSets = 2): ReviewProposal => ({
    id: pid,
    source: pid.startsWith('e') ? 'code' : 'coach',
    change: { kind: 'template_sets', routineId: legs.id, routineName: 'Legs', expectedVersion: legs.version, exerciseId: ex.id, exerciseName: name, fromSets: 3, toSets },
    reason,
    status: 'open',
    actionId: null,
  });
  const setsOf = async (store: Store, rid: string) => (await store.repos.routines.get(rid))?.exercises.map((e) => e.setTemplates.filter((t) => t.setType !== 'warmup').length);
  const statuses = async (store: Store, reviewId: string) => (await store.repos.reviews.get(reviewId))?.proposals?.map((p) => [p.id, p.status]);
  const loseMark = async (store: Store, reviewId: string, pid: string, to: Partial<ReviewProposal>) => {
    const r = await store.repos.reviews.get(reviewId);
    if (r === null) throw new Error('missing');
    // As if the app died after the write: the mark (and its op) never landed.
    const op = `lose-${pid}-${String(r.version)}`;
    const w = await store.repos.reviews.update(OWNER, { ...r, version: r.version + 1, opIds: [...r.opIds.filter((o) => !o.endsWith(':mark')), op], proposals: (r.proposals ?? []).map((p) => (p.id === pid ? { ...p, ...to } : p)) }, r.version, op);
    expect(w.status).toBe('written');
  };

  it('two small changes on the same plan day are both applied; Undo of one leaves the other; Redo puts it back (review progress-v3-data B1)', async () => {
    const h = await twoOnLegs((legs) => [change(legs, 'p1', CURL, 'Leg curl', 'Legs ran long'), change(legs, 'c1', ROW, 'Bench press', 'Bench ran long')]);
    await h.service.runOnOpen();
    expect(await statuses(h.store, h.reviewId)).toEqual([['p1', 'applied'], ['c1', 'applied']]);
    expect(await setsOf(h.store, h.legs.id)).toEqual([2, 2]);
    expect(await h.service.undoProposal({ reviewId: h.reviewId, proposalId: 'p1', opId: 'u1' })).toMatchObject({ ok: true, proposal: { status: 'undone' } });
    expect(await setsOf(h.store, h.legs.id)).toEqual([3, 2]);
    expect(await h.service.redoProposal({ reviewId: h.reviewId, proposalId: 'p1', opId: 'r1' })).toMatchObject({ ok: true, proposal: { status: 'applied', canUndo: true } });
    expect(await setsOf(h.store, h.legs.id)).toEqual([2, 2]);
    // Undo of the second, after the first was redone: only its own exercise.
    expect(await h.service.undoProposal({ reviewId: h.reviewId, proposalId: 'c1', opId: 'u2' })).toMatchObject({ ok: true });
    expect(await setsOf(h.store, h.legs.id)).toEqual([2, 3]);
    // The applies are recorded as undone in the action log, each with its own undo record.
    const c1 = (await h.store.repos.reviews.get(h.reviewId))?.proposals?.find((p) => p.id === 'c1');
    expect((await h.store.repos.coach.getAction(c1?.actionId ?? ''))?.undoneBy).not.toBeNull();
  });

  it('a small change with no reason (the number check hid it) is never applied automatically: an offer, Apply applies it (review progress-v3-design B3)', async () => {
    const h = await twoOnLegs((legs) => [change(legs, 'c1', CURL, 'Leg curl', null)]);
    await h.service.runOnOpen();
    expect(await setsOf(h.store, h.legs.id)).toEqual([3, 3]);
    const view = (await h.service.progress())?.changes;
    expect(view?.rows).toEqual([]);
    expect(view?.asks.map((r) => [r.exercise, r.status, r.offer, r.statusText, r.canApply, r.canUndo])).toEqual([['Leg curl', 'open', true, null, true, false]]);
    expect(await h.service.applyProposal({ reviewId: h.reviewId, proposalId: 'c1', opId: 'tap' })).toMatchObject({ ok: true, proposal: { status: 'applied' } });
    expect(await setsOf(h.store, h.legs.id)).toEqual([2, 3]);
    expect((await h.store.repos.coach.getAction((await h.store.repos.reviews.get(h.reviewId))?.proposals?.[0]?.actionId ?? ''))?.author).toBe('ben');
  });

  it('a small change not applied yet is shown `Not applied`, never as made; the page is told only after the apply lands (review progress-v3-design B1)', async () => {
    const h = await twoOnLegs((legs) => [change(legs, 'p1', CURL, 'Leg curl', 'Legs ran long')]);
    const before = (await h.service.progress())?.changes;
    expect(before?.rows).toEqual([]);
    expect(before?.asks[0]).toMatchObject({ status: 'open', statusText: 'Not applied', canApply: true });
    expect(before?.asks[0]?.accessibilityLabel).toContain('Not applied');
    const seen: string[][] = [];
    const off = h.service.subscribe(() => {
      void h.service.progress().then((d) => seen.push((d?.changes?.rows ?? []).map((r) => r.status)));
    });
    await h.service.runOnOpen();
    off();
    await new Promise((r) => setTimeout(r, 50));
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.every((s) => s.every((x) => x === 'applied'))).toBe(true);
    expect((await h.service.progress())?.changes?.rows.map((r) => [r.status, r.statusText, r.canUndo])).toEqual([['applied', null, true]]);
  });

  it('a force-close between the automatic apply’s write and its mark: the next open marks it, one write (review progress-v3-design S7)', async () => {
    const h = await twoOnLegs((legs) => [change(legs, 'p1', CURL, 'Leg curl', 'Legs ran long')]);
    await h.service.runOnOpen();
    const v = (await h.store.repos.routines.get(h.legs.id))?.version;
    await loseMark(h.store, h.reviewId, 'p1', { status: 'open', actionId: null });
    await h.service.runOnOpen();
    expect(await statuses(h.store, h.reviewId)).toEqual([['p1', 'applied']]);
    expect((await h.store.repos.routines.get(h.legs.id))?.version).toBe(v);
    expect(await setsOf(h.store, h.legs.id)).toEqual([2, 3]);
  });

  it('a force-close between Redo’s write and its mark: the next Redo (a new tap) marks it applied with Undo, one write (review progress-v3-design B2)', async () => {
    const h = await twoOnLegs((legs) => [change(legs, 'p1', CURL, 'Leg curl', 'Legs ran long')]);
    await h.service.runOnOpen();
    await h.service.undoProposal({ reviewId: h.reviewId, proposalId: 'p1', opId: 'u1' });
    const undone = (await h.store.repos.reviews.get(h.reviewId))?.proposals?.[0];
    await h.service.redoProposal({ reviewId: h.reviewId, proposalId: 'p1', opId: 'r1' });
    const v = (await h.store.repos.routines.get(h.legs.id))?.version;
    // The mark lost: back to undone with the undone apply's record, as if the app died after the write.
    await loseMark(h.store, h.reviewId, 'p1', { status: 'undone', actionId: undone?.actionId ?? null });
    expect(await h.service.redoProposal({ reviewId: h.reviewId, proposalId: 'p1', opId: 'r2-new-tap' })).toMatchObject({ ok: true, proposal: { status: 'applied', canUndo: true } });
    expect((await h.store.repos.routines.get(h.legs.id))?.version).toBe(v);
    expect(await setsOf(h.store, h.legs.id)).toEqual([2, 3]);
    // And Undo still works.
    expect(await h.service.undoProposal({ reviewId: h.reviewId, proposalId: 'p1', opId: 'u2' })).toMatchObject({ ok: true, proposal: { status: 'undone' } });
    expect(await setsOf(h.store, h.legs.id)).toEqual([3, 3]);
  });

  it('a force-close between Undo’s write and its mark: the next Undo (a new tap) marks it, one write', async () => {
    const h = await twoOnLegs((legs) => [change(legs, 'p1', CURL, 'Leg curl', 'Legs ran long')]);
    await h.service.runOnOpen();
    const applied = (await h.store.repos.reviews.get(h.reviewId))?.proposals?.[0];
    await h.service.undoProposal({ reviewId: h.reviewId, proposalId: 'p1', opId: 'u1' });
    const v = (await h.store.repos.routines.get(h.legs.id))?.version;
    await loseMark(h.store, h.reviewId, 'p1', { status: 'applied', actionId: applied?.actionId ?? null });
    expect(await h.service.undoProposal({ reviewId: h.reviewId, proposalId: 'p1', opId: 'u2-new-tap' })).toMatchObject({ ok: true, proposal: { status: 'undone' } });
    expect((await h.store.repos.routines.get(h.legs.id))?.version).toBe(v);
  });

  it('Got it after the automatic apply moved the review: still marked; new coach words are not (review progress-v3-design S5)', async () => {
    const h = await twoOnLegs((legs) => [change(legs, 'p1', CURL, 'Leg curl', 'Legs ran long')]);
    const shown = (await h.service.progress())?.changes;
    await h.service.runOnOpen();
    expect(await h.service.markSeen({ reviewId: h.reviewId, expectedVersion: shown?.version ?? 0, opId: 'seen-a', contentKey: shown?.contentKey ?? '' })).toBe(true);
    expect((await h.service.progress())?.changes?.isNew).toBe(false);
    // A key that doesn't match what is stored (news since): refused.
    const h2 = await twoOnLegs((legs) => [change(legs, 'p1', CURL, 'Leg curl', 'Legs ran long')]);
    const shown2 = (await h2.service.progress())?.changes;
    await h2.service.runOnOpen();
    expect(await h2.service.markSeen({ reviewId: h2.reviewId, expectedVersion: shown2?.version ?? 0, opId: 'seen-b', contentKey: 'something else' })).toBe(false);
  });

  it('collapses once Ben acted on every change himself (Undo, Skip); the automatic applies alone don’t (review progress-v3-design S6)', async () => {
    const h = await twoOnLegs((legs) => [change(legs, 'p1', CURL, 'Leg curl', 'Legs ran long'), change(legs, 'c1', ROW, 'Bench press', null)]);
    await h.service.runOnOpen();
    expect((await h.service.progress())?.changes?.isNew).toBe(true);
    await h.service.undoProposal({ reviewId: h.reviewId, proposalId: 'p1', opId: 'u1' });
    expect((await h.service.progress())?.changes?.isNew).toBe(true);
    await h.service.skipProposal({ reviewId: h.reviewId, proposalId: 'c1', opId: 'k1' });
    expect((await h.service.progress())?.changes?.isNew).toBe(false);
  });

  describe('D2 (Ben, 23 Oct): the review never applies an unasked change outside CA8 small', () => {
    // The review's own apply has one deterministic record per change: none may exist for an offer.
    const autoRecord = async (store: Store, reviewId: string, pid: string) => store.repos.coach.getAction(deriveId(`review-apply:${deriveId(`${reviewId}|${pid}`)}`));

    it('an added set (the coach’s, or code’s from Ben’s repeated edit) is an offer: no open writes it; Apply writes once as Ben’s, Undo restores', async () => {
      const h = await twoOnLegs((legs) => [change(legs, 'e1', CURL, 'Leg curl', '4 sets the last 2 times', 4), change(legs, 'c1', ROW, 'Bench press', 'Chest under plan', 4)]);
      const v0 = (await h.store.repos.routines.get(h.legs.id))?.version;
      for (let i = 0; i < 3; i += 1) await h.service.runOnOpen();
      expect(await setsOf(h.store, h.legs.id)).toEqual([3, 3]);
      expect((await h.store.repos.routines.get(h.legs.id))?.version).toBe(v0);
      expect(await statuses(h.store, h.reviewId)).toEqual([['e1', 'open'], ['c1', 'open']]);
      expect(await autoRecord(h.store, h.reviewId, 'e1')).toBeNull();
      expect(await autoRecord(h.store, h.reviewId, 'c1')).toBeNull();
      const view = (await h.service.progress())?.changes;
      expect(view?.rows).toEqual([]);
      expect(view?.asks.map((r) => [r.exercise, r.before, r.after, r.when, r.offer, r.statusText, r.canApply])).toEqual([
        ['Leg curl', '3 sets', '4 sets', 'future Legs days', true, null, true],
        ['Bench press', '3 sets', '4 sets', 'future Legs days', true, null, true],
      ]);
      // Both wait for Ben: the collapsed line says so (review v5offers 3).
      expect(view?.collapsed).toBe('2 to review');
      // Ben applies one: written once (a double tap replays), recorded as his.
      expect(await h.service.applyProposal({ reviewId: h.reviewId, proposalId: 'c1', opId: 'apply-c1' })).toMatchObject({ ok: true, proposal: { status: 'applied', canUndo: true } });
      expect(await h.service.applyProposal({ reviewId: h.reviewId, proposalId: 'c1', opId: 'apply-c1' })).toMatchObject({ ok: true });
      expect(await setsOf(h.store, h.legs.id)).toEqual([3, 4]);
      expect((await h.store.repos.routines.get(h.legs.id))?.version).toBe((v0 ?? 0) + 1);
      const c1 = (await h.store.repos.reviews.get(h.reviewId))?.proposals?.find((p) => p.id === 'c1');
      expect((await h.store.repos.coach.getAction(c1?.actionId ?? ''))?.author).toBe('ben');
      // The other is skipped: nothing changes, and a later open doesn't apply it.
      expect(await h.service.skipProposal({ reviewId: h.reviewId, proposalId: 'e1', opId: 'skip-p1' })).toMatchObject({ ok: true, proposal: { status: 'skipped' } });
      await h.service.runOnOpen();
      expect(await setsOf(h.store, h.legs.id)).toEqual([3, 4]);
      expect(await h.service.undoProposal({ reviewId: h.reviewId, proposalId: 'c1', opId: 'undo-c1' })).toMatchObject({ ok: true, proposal: { status: 'undone' } });
      expect(await setsOf(h.store, h.legs.id)).toEqual([3, 3]);
    });

    it('code’s own change (Ben’s repeated edit) is always an offer, even one set fewer: no open writes it, Apply writes it as Ben’s (D1; review v5offers B1)', async () => {
      const h = await twoOnLegs((legs) => [change(legs, 'e1', CURL, 'Leg curl', '2 sets the last 2 times')]);
      const v0 = (await h.store.repos.routines.get(h.legs.id))?.version;
      for (let i = 0; i < 3; i += 1) await h.service.runOnOpen();
      expect(await setsOf(h.store, h.legs.id)).toEqual([3, 3]);
      expect((await h.store.repos.routines.get(h.legs.id))?.version).toBe(v0);
      expect(await autoRecord(h.store, h.reviewId, 'e1')).toBeNull();
      const view = (await h.service.progress())?.changes;
      expect(view?.rows).toEqual([]);
      expect(view?.asks.map((r) => [r.exercise, r.after, r.offer, r.statusText, r.canApply])).toEqual([['Leg curl', '2 sets', true, null, true]]);
      expect(await h.service.applyProposal({ reviewId: h.reviewId, proposalId: 'e1', opId: 'apply-e1' })).toMatchObject({ ok: true, proposal: { status: 'applied' } });
      expect(await setsOf(h.store, h.legs.id)).toEqual([2, 3]);
      const e1 = (await h.store.repos.reviews.get(h.reviewId))?.proposals?.find((p) => p.id === 'e1');
      expect((await h.store.repos.coach.getAction(e1?.actionId ?? ''))?.author).toBe('ben');
    });

    it('an offer Ben was shown stays an offer on a re-run whose facts would call it small (review v5offers 4)', async () => {
      // Bench press is stalled in the reviewed week, so the coach's one set fewer on it is a stall response: an offer.
      const h = await twoOnLegs((legs) => [change(legs, 'c1', ROW, 'Bench press', 'Bench ran long')], { stalled: [ROW.id] });
      await h.service.runOnOpen();
      expect(await statuses(h.store, h.reviewId)).toEqual([['c1', 'open']]);
      expect((await h.service.progress())?.changes?.asks.map((r) => [r.id, r.offer, r.canApply])).toEqual([['c1', true, true]]);
      // One more workout that week: new inputs, a new review whose facts no longer flag Bench press as stalled.
      await h.store.repos.sessions.save(workout(1 * DAY_S, CURL, [{ load: 40, reps: 10, rpe: 8 }]), null);
      const again = await h.service.runOnOpen();
      if (again.kind === 'nothing' || again.kind === 'failed') throw new Error(again.kind);
      expect(again.review.id).not.toBe(h.reviewId);
      expect(again.review.facts.some((f) => f.kind === 'stalled_lift' && f.exerciseId === ROW.id)).toBe(false);
      expect(again.review.proposals?.map((p) => [p.id, p.status, p.offer])).toEqual([['c1', 'open', true]]);
      expect(await setsOf(h.store, h.legs.id)).toEqual([3, 3]);
      expect(await autoRecord(h.store, again.review.id, 'c1')).toBeNull();
      expect((await h.service.progress())?.changes?.asks.map((r) => [r.id, r.offer, r.canApply])).toEqual([['c1', true, true]]);
      // Only Ben's Apply writes it.
      expect(await h.service.applyProposal({ reviewId: again.review.id, proposalId: 'c1', opId: 'apply-c1' })).toMatchObject({ ok: true, proposal: { status: 'applied' } });
      expect(await setsOf(h.store, h.legs.id)).toEqual([3, 2]);
    });

    it('Apply → Undo → Redo on an offer, tapped the way the screens tap (`changeRowTaps` → `runChangeTap`): Redo writes once, Undo again (review v5offers B2)', async () => {
      const h = await twoOnLegs((legs) => [change(legs, 'c1', CURL, 'Leg curl', 'Legs ran short', 4)]);
      await h.service.runOnOpen();
      const row = async () => {
        const r = (await h.service.progress())?.changes?.asks.find((x) => x.id === 'c1');
        if (r === undefined) throw new Error('no row');
        return r;
      };
      /** The one button a row shows with this label, run as the screen runs it. */
      const tap = async (label: string, opId: string) => {
        const r = await row();
        const t = changeRowTaps(r).find((x) => CHANGE_TAP_LABEL[x] === label);
        if (t === undefined) throw new Error(`no ${label} on ${r.status}: ${changeRowTaps(r).join(',')}`);
        return runChangeTap(h.service, t, { reviewId: h.reviewId, proposalId: r.id, opId });
      };
      expect(changeRowTaps(await row()).map((t) => CHANGE_TAP_LABEL[t])).toEqual(['Apply', 'Skip']);
      expect(await tap('Apply', 'a1')).toMatchObject({ ok: true, proposal: { status: 'applied' } });
      expect(await setsOf(h.store, h.legs.id)).toEqual([4, 3]);
      expect(await tap('Undo', 'u1')).toMatchObject({ ok: true, proposal: { status: 'undone' } });
      expect(await setsOf(h.store, h.legs.id)).toEqual([3, 3]);
      expect(changeRowTaps(await row()).map((t) => CHANGE_TAP_LABEL[t])).toEqual(['Redo']);
      const v = (await h.store.repos.routines.get(h.legs.id))?.version ?? 0;
      expect(await tap('Redo', 'r1')).toMatchObject({ ok: true, proposal: { status: 'applied', canUndo: true } });
      expect(await setsOf(h.store, h.legs.id)).toEqual([4, 3]);
      expect((await h.store.repos.routines.get(h.legs.id))?.version).toBe(v + 1);
      // Recorded as Ben's; Undo again restores it.
      const c1 = (await h.store.repos.reviews.get(h.reviewId))?.proposals?.find((p) => p.id === 'c1');
      expect((await h.store.repos.coach.getAction(c1?.actionId ?? ''))?.author).toBe('ben');
      expect(await tap('Undo', 'u2')).toMatchObject({ ok: true, proposal: { status: 'undone' } });
      expect(await setsOf(h.store, h.legs.id)).toEqual([3, 3]);
    });

    it('a move of more than one set is an offer, even downwards', async () => {
      const h = await twoOnLegs((legs) => [change(legs, 'c1', CURL, 'Leg curl', 'Legs ran long', 1)]);
      await h.service.runOnOpen();
      expect(await setsOf(h.store, h.legs.id)).toEqual([3, 3]);
      expect((await h.service.progress())?.changes?.asks.map((r) => [r.after, r.offer, r.canApply])).toEqual([['1 set', true, true]]);
      expect(await h.service.applyProposal({ reviewId: h.reviewId, proposalId: 'c1', opId: 'apply' })).toMatchObject({ ok: true });
      expect(await setsOf(h.store, h.legs.id)).toEqual([1, 3]);
    });

    it('on a lift the week flags as stalled, even one set fewer is a stall response: asked, never applied by the review (rule 8)', async () => {
      const h = await twoOnLegs((legs) => [change(legs, 'c1', CURL, 'Leg curl', 'Leg curl has stalled'), change(legs, 'p1', ROW, 'Bench press', 'Bench ran long')], { stalled: [CURL.id] });
      await h.service.runOnOpen();
      // Bench press isn't stalled: its one set fewer is applied; Leg curl's waits for Ben.
      expect(await setsOf(h.store, h.legs.id)).toEqual([3, 2]);
      expect(await statuses(h.store, h.reviewId)).toEqual([['c1', 'open'], ['p1', 'applied']]);
      const view = (await h.service.progress())?.changes;
      expect(view?.rows.map((r) => r.exercise)).toEqual(['Bench press']);
      expect(view?.asks.map((r) => [r.exercise, r.offer, r.statusText, r.canApply])).toEqual([['Leg curl', true, null, true]]);
      expect(await h.service.applyProposal({ reviewId: h.reviewId, proposalId: 'c1', opId: 'apply' })).toMatchObject({ ok: true, proposal: { status: 'applied' } });
      expect(await setsOf(h.store, h.legs.id)).toEqual([2, 2]);
    });
  });

  it('an older week’s review isn’t `for next week` (review progress-v3-data S5)', async () => {
    const h = await twoOnLegs((legs) => [change(legs, 'p1', CURL, 'Leg curl', 'Legs ran long')]);
    await h.service.runOnOpen();
    expect((await h.service.progress())?.changes).toMatchObject({ current: true, right: 'for next week', isNew: true });
    h.advance(21 * DAY_S * 1000);
    const later = (await h.service.progress())?.changes;
    expect(later).toMatchObject({ current: false, isNew: false, right: 'w/c 5 Oct', collapsed: '1 change' });
  });
});
