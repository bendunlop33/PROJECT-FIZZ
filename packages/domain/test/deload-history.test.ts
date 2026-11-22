import { describe, expect, it } from 'vitest';

import type { EquipmentInstance, Load, SessionAggregate, SessionDeload } from '@fizz/schemas';

import {
  buildPlanFromAnswers,
  calculateNextTargets,
  createMemoryRepositories,
  createSessionService,
  evaluateCoachTrigger,
  exerciseHistoryView,
  loadReferences,
  pbBlockOfPlan,
  pbDeloadAtStart,
  pbHistoryOf,
  pbPlanVersion,
  recentSessionsView,
  skipDeload,
  toHistorySessions,
  toIso,
  toMs,
  trainingOverviewView,
  type HistorySession,
  type NextTargetsInput,
  type TriggerSetInput,
} from '../src/index';
import { assisted, at, barbell, doubleProgression, dumbbells, exercise, GYM, id, idGen, kg, lb, OWNER, profile, stack, T0, T0_MS, TZ, values } from './fixtures';
import { HISTORY_OF, KIT_OF, NOW, answers } from './plan-builder-fixture';
import { apply, BENCH, exercises, logCmd, setsFor, startFixture } from './session-fixture';

/**
 * (PM, 23 Oct) Deload-week sets don't count as normal history: a workout started in the plan's deload week is marked
 * (`WorkoutSession.deload`, stamped at Start), and the built-in rule, next-session targets, lift estimates and the
 * coach's history read skip or label it. `Last`, history and Progress volume still read it as any workout.
 */

const DAY = 86_400_000;
const DELOAD: SessionDeload = { planId: id(9100), week: 6, of: 6 };

let n = 9200;
function hs(daysAgo: number, eq: EquipmentInstance | null, sets: { load: Load; reps: number; rpe?: number }[], deload = false): HistorySession {
  n += 1;
  return {
    sessionId: id(n),
    performedAtUtc: toIso(T0_MS - daysAgo * DAY),
    equipmentId: eq?.id ?? null,
    gymId: eq?.gymId ?? null,
    imported: false,
    sets: sets.map((s) => ({ setType: 'working' as const, side: null, load: s.load, reps: s.reps, rpe: s.rpe ?? null, rir: null })),
    tz: TZ,
    ...(deload ? { deload: true as const } : {}),
  };
}
const three = (load: Load, reps: number, rpe?: number) => [0, 1, 2].map(() => ({ load, reps, ...(rpe === undefined ? {} : { rpe }) }));
const two = (load: Load, reps: number, rpe?: number) => [0, 1].map(() => ({ load, reps, ...(rpe === undefined ? {} : { rpe }) }));

function rule(history: HistorySession[], equipment: EquipmentInstance): NextTargetsInput {
  return { exerciseName: 'Lift', measurement: 'reps', history, rule: doubleProgression(), equipment, unit: equipment.unit, convention: equipment.loadConvention, pain: { active: false, reportedAtUtc: null } };
}

describe('skipDeload', () => {
  it('drops deload sessions while a normal one is left; keeps all of them when every one is a deload', () => {
    type X = { id: string; deload?: true };
    const a: X = { id: 'a' };
    const b: X = { id: 'b', deload: true };
    const c: X = { id: 'c' };
    expect(skipDeload([b, a, c]).map((x) => x.id)).toEqual(['a', 'c']);
    expect(skipDeload([b]).map((x) => x.id)).toEqual(['b']);
    expect(skipDeload([])).toEqual([]);
  });
});

describe('the built-in rule and next-session targets skip deload weeks', () => {
  it('kg barbell: the 100 kg week before the deload is the basis, not the 90 kg deload (no drop, no false increase)', () => {
    const bar = barbell();
    const normal = hs(10, bar, three(kg(100), 8, 8));
    const deload = hs(3, bar, two(kg(90), 8, 6), true);
    const t = calculateNextTargets(rule([deload, normal], bar));
    expect(t.basedOnSessionIds[0]).toBe(normal.sessionId);
    expect(t.basedOnSessionIds).not.toContain(deload.sessionId);
    expect(t.decision).toBe('increase_load');
    expect(t.sets).toHaveLength(3);
    expect(t.sets[0]?.load).toEqual(kg(102.5));
    expect(t.explanation.facts).toContain('1 deload-week session was left out.');
    // Without the mark the same 90 kg session would plan from 90 kg.
    const plain: HistorySession = { ...deload };
    delete plain.deload;
    const unmarked = calculateNextTargets(rule([plain, normal], bar));
    expect(unmarked.basedOnSessionIds[0]).toBe(deload.sessionId);
  });

  it('per-hand dumbbells: a deload at 22.5 each never lowers the 25 each the rule holds at', () => {
    const db = dumbbells();
    const normal = hs(9, db, three(kg(25, 'per_hand'), 7, 8));
    const deload = hs(2, db, two(kg(22.5, 'per_hand'), 7, 6), true);
    const t = calculateNextTargets(rule([normal, deload], db));
    expect(t.decision).toBe('hold');
    expect(t.sets[0]?.load).toEqual(kg(25, 'per_hand'));
  });

  it('assisted machine: more assistance in the deload week is not read as a regression', () => {
    const machine = assisted();
    const normal = hs(9, machine, three(kg(20, 'assistance'), 8, 8));
    const deload = hs(2, machine, two(kg(30, 'assistance'), 8, 6), true);
    const t = calculateNextTargets(rule([deload, normal], machine));
    expect(t.basedOnSessionIds[0]).toBe(normal.sessionId);
    // All reps at the top of 6–8: less assistance next (never past the machine's least, rule 4).
    expect(t.decision).toBe('increase_load');
    expect(t.sets[0]?.load).toEqual(kg(15, 'assistance'));
  });

  it('a stall run counts normal weeks only: a deload between two misses never adds a third', () => {
    const bar = barbell();
    const miss1 = hs(20, bar, three(kg(100), 5, 9));
    const deload = hs(12, bar, two(kg(90), 6, 6), true);
    const miss2 = hs(4, bar, three(kg(100), 5, 9));
    const t = calculateNextTargets(rule([miss2, deload, miss1], bar));
    expect(t.basedOnSessionIds).toEqual(expect.not.arrayContaining([deload.sessionId]));
  });

  it('only deload history (first done in a deload week): read as it is (lighter, so it errs light)', () => {
    const bar = barbell();
    const deload = hs(2, bar, two(kg(60), 8, 6), true);
    const t = calculateNextTargets(rule([deload], bar));
    expect(t.basedOnSessionIds).toEqual([deload.sessionId]);
    expect(t.sets[0]?.load?.value).toBeLessThanOrEqual(62.5);
  });

  it('respects the equipment max: the basis week at the top of a stack holds at the max, the deload never decides it', () => {
    const cable = stack();
    const normal = hs(9, cable, three(kg(50, 'stack'), 8, 7));
    const deload = hs(2, cable, two(kg(45, 'stack'), 8, 6), true);
    const t = calculateNextTargets(rule([deload, normal], cable));
    expect(t.basedOnSessionIds[0]).toBe(normal.sessionId);
    expect(t.sets[0]?.load?.value).toBeLessThanOrEqual(50);
  });
});

describe('lift estimates skip deload weeks', () => {
  const ROW = exercise(9301, 'Barbell row', { movementPattern: 'horizontal_pull', mechanic: 'compound', family: 'row' });
  const bar = barbell({ gymId: GYM });
  const ctx = { gym: { id: GYM, name: 'Main gym', equipment: [bar] }, knownEquipment: new Map([[bar.id, bar]]), unit: 'kg' as const };

  it('loadReferences: the estimate (e1RM, last session) comes from the normal weeks; the deload stays in `all`', () => {
    const normal = hs(9, bar, three(kg(100), 8, 8));
    const deload = hs(2, bar, two(kg(90), 6, 6), true);
    const refs = loadReferences({ exercise: ROW, history: [deload, normal], ctx, nowMs: T0_MS });
    expect(refs.own?.sessions.map((s) => s.sessionId)).toEqual([normal.sessionId]);
    // RIR-adjusted Epley: 8 reps @ RPE 8 reads as 10.
    expect(refs.own?.e1rm).toBeCloseTo(100 * (1 + 10 / 30), 6);
    expect(refs.all.map((s) => s.sessionId)).toEqual([deload.sessionId, normal.sessionId]);
    expect(refs.all[0]?.deload).toBe(true);
    // The pain hold still reads the most recent session (the safer, lighter one).
    expect(refs.latest?.sessionId).toBe(deload.sessionId);
    // Only deload history: still an estimate from it.
    expect(loadReferences({ exercise: ROW, history: [deload], ctx, nowMs: T0_MS }).own?.sessions.map((s) => s.sessionId)).toEqual([deload.sessionId]);
  });

  it('pbHistoryOf (6-rep estimate, week-1 loads of the next block): the last normal set, in its unit; sessions still counted', () => {
    const normal = hs(10, null, [{ load: lb(225), reps: 5 }]);
    const deload = hs(3, null, [{ load: lb(205), reps: 4 }], true);
    const h = pbHistoryOf([deload, normal], 'total', T0_MS);
    expect(h?.last).toMatchObject({ value: 225, unit: 'lb', reps: 5, atUtc: normal.performedAtUtc });
    expect(h?.sessions).toBe(2);
    expect(pbHistoryOf([deload], 'total', T0_MS)?.last).toMatchObject({ value: 205, unit: 'lb' });
  });
});

describe('the coach reads deload weeks labelled, and its trend skips them', () => {
  function workout(day: number, load: number, deload: boolean): SessionAggregate {
    let s = startFixture().state;
    const working = setsFor(s, BENCH).filter((x) => x.setType !== 'warmup');
    working.slice(0, 2).forEach((set, i) => {
      s = apply(s, logCmd(set.id, values(kg(load), 8), 100 + i * 100, `b-${String(day)}-${String(i)}`));
    });
    s = apply(s, { type: 'finish', at: at(900), opId: `fin-${String(day)}`, expectedVersion: s.session.version, endedAt: null });
    const startedAt = { utc: toIso(toMs(T0) + day * DAY), tz: TZ };
    return { ...s, session: { ...s.session, id: id(9400 + day), startedAt, routineName: 'Push A', ...(deload ? { deload: DELOAD } : {}) } };
  }
  const sessions = [workout(0, 95, false), workout(7, 100, false), workout(14, 90, true)];

  it('toHistorySessions carries the mark', () => {
    expect(toHistorySessions(sessions[2] as SessionAggregate, BENCH)[0]?.deload).toBe(true);
    expect(toHistorySessions(sessions[1] as SessionAggregate, BENCH)[0]?.deload).toBeUndefined();
  });

  it('exercise history, recent sessions and the overview mark the deload workout and send the note', () => {
    const v = exerciseHistoryView({ exerciseId: BENCH, exerciseName: 'Bench press', sessions, limit: 5, gymNames: {}, equipmentNames: {} });
    expect(v.sessions.map((x) => x.deload === true)).toEqual([true, false, false]);
    expect(v.deload).toMatch(/lighter on purpose/);
    const r = recentSessionsView({ sessions, count: 5, gymNames: {} });
    expect(r.sessions[0]?.deload).toBe(true);
    expect(r.deload).toMatch(/lighter on purpose/);
    const o = trainingOverviewView({ weeks: 4, nowUtc: toIso(toMs(T0) + 15 * DAY), tz: TZ, sessions, gymNames: {} });
    expect(o.sessions[0]?.deload).toBe(true);
    // Trend: 95 → 100 (up); the 90 kg deload week is not read as `down`.
    expect(o.trends[0]).toMatchObject({ trend: 'up', workouts: 3 });
    expect(o.trends[0]?.latest?.top.replace(/\u00a0/g, ' ')).toBe('100 kg × 8');
    // No deload in the window: no note.
    expect(trainingOverviewView({ weeks: 4, nowUtc: toIso(toMs(T0) + 15 * DAY), tz: TZ, sessions: sessions.slice(0, 2), gymNames: {} }).deload).toBeUndefined();
  });

  it('an easy set in a deload week raises no `rpe_low` offer; a too-hard set still does', () => {
    const set = (rpe: number): TriggerSetInput => ({ id: id(9500), version: 2, setType: 'working', status: 'completed', planned: { reps: { min: 6, max: 8 }, rpe: 7, rir: null }, actual: { reps: 8, rpe, rir: null } });
    expect(evaluateCoachTrigger(set(4), 1)?.kind).toBe('rpe_low');
    expect(evaluateCoachTrigger(set(4), 1, undefined, undefined, { deload: true })).toBeNull();
    expect(evaluateCoachTrigger(set(9), 1, undefined, undefined, { deload: true })?.kind).toBe('rpe_high');
  });
});

describe('Start stamps the plan’s deload week (pbDeloadAtStart, session service)', () => {
  const TZL = 'Europe/London';
  const a = answers({ split: 'ppl', sessions: 3, days: [0, 2, 4], weeks: 6, effort: 'standard' });
  const plan = buildPlanFromAnswers({ answers: a, profileSplit: null, kitOf: KIT_OF, historyOf: HISTORY_OF, nowMs: NOW });
  const version = pbPlanVersion({ plan, answers: a, kitOf: KIT_OF, gymId: null, equipmentVersion: 'v', opId: '00000000-0000-4000-8000-00000000c001', at: { utc: '2026-10-12T07:00:00.000Z', tz: TZL }, planId: 'plan-d' });
  const applied = {
    id: 'plan-d',
    status: 'applied' as const,
    versions: [version],
    currentVersion: 1,
    applied: { mode: 'replace' as const, versionN: 1, opId: '00000000-0000-4000-8000-00000000c002', atUtc: '2026-10-12T07:00:00.000Z', made: [], rotationOff: [] },
    pauses: [],
  };
  /** One plan workout a week for `weeks` weeks from Thu 15 Oct. */
  const refs = (weeks: number) => Array.from({ length: weeks }, (_, i) => ({ routineId: null, startedAtUtc: new Date(Date.parse('2026-10-15T08:00:00Z') + i * 7 * DAY).toISOString(), planDay: { planId: 'plan-d', dayIndex: 0 } }));
  const week6Ms = Date.parse('2026-11-19T09:00:00Z');

  it('in week 6 of a 6-week Standard plan: { planId, week 6, of 6 }; week 5: none; paused: none; no plan: none', () => {
    expect(pbBlockOfPlan(applied, refs(5), week6Ms, TZL)).toMatchObject({ week: 6, deload: true });
    expect(pbDeloadAtStart(applied, refs(5), week6Ms, TZL)).toEqual({ planId: 'plan-d', week: 6, of: 6 });
    expect(pbDeloadAtStart(applied, refs(4), Date.parse('2026-11-12T09:00:00Z'), TZL)).toBeNull();
    const pause = { opId: '00000000-0000-4000-8000-00000000c003', fromUtc: '2026-11-18T00:00:00.000Z', untilDate: null, endedAtUtc: null };
    expect(pbDeloadAtStart({ ...applied, pauses: [pause] }, refs(5), week6Ms, TZL)).toBeNull();
    expect(pbDeloadAtStart(null, refs(5), week6Ms, TZL)).toBeNull();
    // Block done: never a deload.
    expect(pbDeloadAtStart(applied, refs(6), Date.parse('2026-11-26T09:00:00Z'), TZL)).toBeNull();
  });

  async function setup() {
    const repos = createMemoryRepositories();
    await repos.profiles.save(profile(), null);
    for (const eq of [barbell(), stack()]) await repos.equipment.save(eq, null);
    for (const ex of exercises.values()) await repos.exercises.save(ex, null);
    const routine = startFixture().input.routine;
    if (!routine) throw new Error('fixture');
    await repos.routines.save(routine, null);
    return repos;
  }

  it('a real start is stamped once; a duplicate opId returns the same session; a failing read starts unmarked', async () => {
    const repos = await setup();
    let calls = 0;
    const svc = createSessionService(repos, idGen(), { deloadAt: () => { calls += 1; return Promise.resolve(DELOAD); } });
    const first = await svc.start({ ownerId: OWNER, gymId: GYM, routineId: id(300), opId: 'start-d1', at: at(0) });
    if (!first.ok) throw new Error('start');
    expect(first.aggregate.session.deload).toEqual(DELOAD);
    expect((await repos.sessions.get(first.aggregate.session.id))?.session.deload).toEqual(DELOAD);
    const again = await svc.start({ ownerId: OWNER, gymId: GYM, routineId: id(300), opId: 'start-d1', at: at(5) });
    expect(again.ok && again.duplicate).toBe(true);
    expect(calls).toBe(1);
    // Commands keep the mark (it's on the session, not the sets).
    const w = setsFor(first.aggregate, BENCH).find((x) => x.setType !== 'warmup');
    if (!w) throw new Error('fixture');
    const logged = await svc.dispatch(first.aggregate.session.id, logCmd(w.id, values(kg(60), 8), 30, 'log-d1'));
    expect(logged.ok && logged.aggregate.session.deload).toEqual(DELOAD);

    const repos2 = await setup();
    const failing = createSessionService(repos2, idGen(), { deloadAt: () => Promise.reject(new Error('locked')) });
    const plain = await failing.start({ ownerId: OWNER, gymId: GYM, routineId: id(300), opId: 'start-d2', at: at(0) });
    expect(plain.ok && plain.aggregate.session.deload).toBeUndefined();
  });

  it('a preview never reads or stamps; a normal week starts unmarked', async () => {
    const repos = await setup();
    let calls = 0;
    const svc = createSessionService(repos, idGen(), { deloadAt: () => { calls += 1; return Promise.resolve(null); } });
    const preview = await svc.startRoutine({ ownerId: OWNER, gymId: GYM, routineId: id(300), opId: 'prev-1', at: at(0), preview: true });
    expect(preview.ok && preview.aggregate.session.deload).toBeUndefined();
    expect(calls).toBe(0);
    const real = await svc.startRoutine({ ownerId: OWNER, gymId: GYM, routineId: id(300), opId: 'start-d3', at: at(0) });
    expect(real.ok && real.aggregate.session.deload).toBeUndefined();
    expect(calls).toBe(1);
  });
});
