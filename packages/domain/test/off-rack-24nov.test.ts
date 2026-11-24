import { describe, expect, it } from 'vitest';
import { nextTargetsFor, snapTypedLoad, type HistorySession, type NextTargetRequest } from '../src/index';
import { dumbbells, exercise, GYM, id, kg, lb, OWNER, T0_MS, TZ } from './fixtures';

/** Ben, 24 Nov: his Notes entry said 32 (he meant the 32.5 kg dumbbells); the target came out 30 kg each, a step back. */
const RACK = dumbbells({ loads: [20, 22.5, 25, 27.5, 30, 32.5, 35] });
const DAY = 86_400_000;
const DBSP = exercise(2, 'Dumbbell shoulder press', { primaryMuscles: ['front_delts'], mechanic: 'compound' });

function session(n: number, daysAgo: number, load: number, reps: number[]): HistorySession {
  return {
    sessionId: id(100 + n),
    performedAtUtc: new Date(T0_MS - daysAgo * DAY).toISOString(),
    equipmentId: RACK.id,
    gymId: GYM,
    imported: false,
    routineName: 'Push B',
    sets: reps.map((r) => ({ setType: 'working', side: null, load: kg(load, 'per_hand'), reps: r, rpe: 8, rir: null })),
    tz: TZ,
  };
}
function target(history: HistorySession[]) {
  const req: NextTargetRequest = {
    ownerId: OWNER,
    exerciseId: id(2),
    exerciseName: 'Dumbbell shoulder press',
    measurement: 'reps',
    unit: 'kg',
    convention: 'per_hand',
    equipment: RACK,
    exercise: DBSP,
    rule: null,
    workingSets: 3,
    history,
    painFlags: [],
    sessionPain: { active: false, reportedAtUtc: null },
  };
  const r = nextTargetsFor(req).result;
  return { decision: r.decision, loads: r.sets.filter((s) => s.setType !== 'warmup').map((s) => s.load?.value) };
}

describe('a last load a hair off the rack', () => {
  it('32 kg each × 8,8,8 on a 30 / 32.5 / 35 rack: today is 32.5, never 30', () => {
    expect(target([session(1, 7, 32, [8, 8, 8])])).toEqual({ decision: 'hold', loads: [32.5, 32.5, 32.5] });
    expect(target([session(1, 14, 30, [10, 10, 10]), session(2, 7, 32, [8, 8, 8])]).loads).toEqual([32.5, 32.5, 32.5]);
  });
  it('32 kg each × 10,10,10 (top of range) still goes up, to 35', () => {
    expect(target([session(1, 7, 32, [10, 10, 10])])).toEqual({ decision: 'increase_load', loads: [35, 35, 35] });
  });
  it('a load exactly on the rack is unchanged', () => {
    expect(target([session(1, 7, 32.5, [8, 8, 8])]).loads).toEqual([32.5, 32.5, 32.5]);
  });
});

describe('snapTypedLoad (paste import)', () => {
  it('32 → 32.5 on that rack; on-rack, far-off and other-convention loads stay as typed', () => {
    expect(snapTypedLoad(kg(32, 'per_hand'), RACK)).toEqual({ load: kg(32.5, 'per_hand'), snapped: true });
    expect(snapTypedLoad(kg(30, 'per_hand'), RACK)).toEqual({ load: kg(30, 'per_hand'), snapped: false });
    expect(snapTypedLoad(kg(31.2, 'per_hand'), RACK).snapped).toBe(false);
    expect(snapTypedLoad(kg(32, 'total'), RACK).snapped).toBe(false);
    expect(snapTypedLoad(kg(40, 'per_hand'), RACK).snapped).toBe(false);
    expect(snapTypedLoad(kg(32, 'per_hand'), null).snapped).toBe(false);
  });
  it('lb typed on a lb rack: within 1.1 lb snaps', () => {
    const lbRack = dumbbells({ unit: 'lb', loads: [50, 55, 60, 65, 70] });
    expect(snapTypedLoad(lb(64.5, 'per_hand'), lbRack)).toEqual({ load: lb(65, 'per_hand'), snapped: true });
  });
});
