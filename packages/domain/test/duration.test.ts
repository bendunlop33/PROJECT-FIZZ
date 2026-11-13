import { describe, expect, it } from 'vitest';
import type { SessionAggregate } from '@fizz/schemas';

import { estimateRemainingDuration, estimateTimeLeft, paceSamplesOf, roundEstimateMinutes, startWorkout } from '../src/index';
import { at, barbell, GYM, idGen, kg, profile, routine, routineExercise, stack, template, values } from './fixtures';
import { apply, BENCH, exercises, logCmd, ROW, setsFor, startFixture } from './session-fixture';

/** Bench 3 × (rest 180 s), Row 2 × (rest 90 s): 5 pending sets, one changeover. */
function plain(): SessionAggregate {
  const r = routine([
    routineExercise(900, { exerciseId: BENCH, equipmentId: barbell().id, setTemplates: [9001, 9002, 9003].map((n) => template(n, { targetLoad: kg(100) })), restBySetType: { working: { seconds: 180 } } }),
    routineExercise(901, { exerciseId: ROW, equipmentId: stack().id, order: 1, setTemplates: [9011, 9012].map((n) => template(n, { targetLoad: kg(50, 'stack') })), restBySetType: { working: { seconds: 90 } } }),
  ]);
  return startWorkout({ opId: 's', owner: profile(), gymId: GYM, routine: r, exercises, gymEquipment: [barbell(), stack()], at: at(0), newId: idGen(500_000) }).aggregate;
}

describe('estimateRemainingDuration (active-workout §2.15.2)', () => {
  it('rounds: 10 min or more to the nearest 5, under 10 to the nearest minute', () => {
    expect([0, 30, 89, 9 * 60 + 29, 9 * 60 + 31, 16.25 * 60, 17.5 * 60].map(roundEstimateMinutes)).toEqual([0, 1, 1, 9, 10, 15, 20]);
  });

  it('a workout not started: planned rest (not after the last set), default pace, one changeover', () => {
    const e = estimateRemainingDuration(plain());
    // Work 5 × 45 s; rest 180 + 180 + 180 + 90 (none after the last); 1 changeover × 120 s.
    expect(e).toMatchObject({ seconds: 225 + 630 + 120, minutes: 15, plannedRestSeconds: 630, pendingSets: 5, pendingExercises: 2, pace: { source: 'default', secondsPerSet: 45, changeoverSeconds: 120 } });
  });

  it('uses Ben’s recent pace when it has 3 samples; long gaps and paused time are left out', () => {
    let done = plain();
    const bench = setsFor(done, BENCH);
    const row = setsFor(done, ROW);
    // Bench every 240 s (rest 180 → 60 s a set), then 20 min away (left out), then row every 150 s (90 rest → 60).
    done = apply(done, logCmd(bench[0]?.id ?? '', values(kg(100), 8), 100));
    done = apply(done, logCmd(bench[1]?.id ?? '', values(kg(100), 8), 340));
    done = apply(done, logCmd(bench[2]?.id ?? '', values(kg(100), 8), 580));
    done = apply(done, logCmd(row[0]?.id ?? '', values(kg(50, 'stack'), 10), 580 + 1500));
    done = apply(done, logCmd(row[1]?.id ?? '', values(kg(50, 'stack'), 10), 580 + 1650));
    done = apply(done, { type: 'finish', at: at(3000), opId: 'f', expectedVersion: done.session.version, endedAt: null });
    expect(paceSamplesOf(done, Date.parse(at(3000).utc))).toEqual({ set: [60, 60, 60], changeover: [] });
    const e = estimateRemainingDuration(plain(), { recent: [done] });
    expect(e.pace).toMatchObject({ source: 'recent_workouts', secondsPerSet: 60, changeoverSeconds: 120 });
    expect(e.seconds).toBe(5 * 60 + 630 + 120);
  });

  it('timed sets add their planned duration; superset members mid-round count only the transition', () => {
    const e = estimateRemainingDuration(startFixture({ supersetTransitionS: 15 }).state);
    expect(e.pendingSets).toBe(8);
    expect(e.pendingExercises).toBe(4);
    expect(e.seconds).toBeGreaterThan(e.plannedRestSeconds + 8 * 45);
    // Logged sets aren't counted again.
    let s = startFixture().state;
    s = apply(s, logCmd(setsFor(s, BENCH)[0]?.id ?? '', values(kg(60), 10), 10));
    expect(estimateRemainingDuration(s).pendingSets).toBe(7);
  });

  it('is the same estimator as the workout’s Time left line (backlog §4.1: one estimator, not two)', () => {
    const s = startFixture({ supersetTransitionS: 15 }).state;
    const before = estimateRemainingDuration(s);
    const live = estimateTimeLeft(s, { nowMs: Date.parse(s.session.startedAt.utc) });
    expect(live?.seconds).toBe(before.seconds);
    expect(live?.plannedRestSeconds).toBe(before.plannedRestSeconds);
    expect(live?.pendingSets).toBe(before.pendingSets);
  });
});
