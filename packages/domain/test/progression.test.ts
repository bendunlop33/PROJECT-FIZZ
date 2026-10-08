import { describe, expect, it } from 'vitest';
import type { EquipmentInstance, Load, ProgressionRule, SetType } from '@fizz/schemas';
import { calculateNextTargets, type HistorySession, type NextTargetsInput } from '../src/index';
import { assisted, barbell, doubleProgression, dumbbells, id, kg, lb, stack, topSetBackoff } from './fixtures';

let sessionN = 700;
function session(
  day: number,
  equipmentId: string | null,
  sets: { load: Load | null; reps: number; rpe?: number; rir?: number; setType?: SetType }[],
): HistorySession {
  sessionN += 1;
  return {
    sessionId: id(sessionN),
    performedAtUtc: `2026-09-${String(day).padStart(2, '0')}T06:00:00.000Z`,
    equipmentId,
    sets: sets.map((s) => ({ setType: s.setType ?? 'working', load: s.load, reps: s.reps, rpe: s.rpe ?? null, rir: s.rir ?? null })),
  };
}

const working = (load: Load | null, reps: number[], rpe?: number) => reps.map((r) => ({ load, reps: r, ...(rpe === undefined ? {} : { rpe }) }));

function input(
  history: HistorySession[],
  equipment: EquipmentInstance | null,
  rule: ProgressionRule = doubleProgression(),
  over: Partial<NextTargetsInput> = {},
): NextTargetsInput {
  return {
    exerciseName: 'Bench press',
    history,
    rule,
    equipment,
    unit: 'kg',
    convention: equipment?.loadConvention ?? 'total',
    pain: { active: false, reportedAtUtc: null },
    ...over,
  };
}

describe('double progression', () => {
  const bar = barbell();

  it('adds load when every working set hits the top of the range within the effort limit', () => {
    const t = calculateNextTargets(input([session(1, bar.id, working(kg(100), [8, 8, 8], 8))], bar));
    expect(t.decision).toBe('increase_load');
    expect(t.sets).toHaveLength(3);
    expect(t.sets[0]).toEqual({ setType: 'working', load: kg(102.5), reps: { min: 6, max: 8 } });
    expect(t.loadFeasibility).toBe('checked');
    expect(t.rule).toMatchObject({ method: 'double_progression', version: 1 });
    expect(t.explanation.summary).toBe('Increase to 102.5 kg for 6–8 reps.');
  });

  it('holds when reps are inside the range', () => {
    const t = calculateNextTargets(input([session(1, bar.id, working(kg(100), [8, 7, 6]))], bar));
    expect(t.decision).toBe('hold');
    expect(t.sets[0]?.load).toEqual(kg(100));
  });

  it('holds when reps hit the top but effort exceeded the limit', () => {
    const t = calculateNextTargets(input([session(1, bar.id, working(kg(100), [8, 8, 8], 10))], bar));
    expect(t.decision).toBe('hold');
    expect(t.explanation.facts.join(' ')).toMatch(/effort was above/);
  });

  it('says so when effort was not recorded and uses reps alone', () => {
    const t = calculateNextTargets(input([session(1, bar.id, working(kg(100), [8, 8, 8]))], bar));
    expect(t.decision).toBe('increase_load');
    expect(t.explanation.facts).toContain("Effort wasn't recorded for 3 sets; reps alone were used.");
  });

  it('respects RIR criteria without mixing it with RPE', () => {
    const rule = doubleProgression({ maxRpeToProgress: null, minRirToProgress: 2 });
    const hard = session(1, bar.id, [8, 8, 8].map((r) => ({ load: kg(100), reps: r, rir: 1 })));
    expect(calculateNextTargets(input([hard], bar, rule)).decision).toBe('hold');
    const ok = session(2, bar.id, [8, 8, 8].map((r) => ({ load: kg(100), reps: r, rir: 2 })));
    expect(calculateNextTargets(input([ok], bar, rule)).decision).toBe('increase_load');
  });

  it('one bad session holds; it is not treated as a trend', () => {
    const history = [session(1, bar.id, working(kg(100), [8, 7, 7])), session(4, bar.id, working(kg(100), [6, 5, 4]))];
    const t = calculateNextTargets(input(history, bar));
    expect(t.decision).toBe('hold_after_miss');
    expect(t.sets[0]?.load).toEqual(kg(100));
    expect(t.explanation.facts.join(' ')).toMatch(/bad day, not a trend \(1 of 2/);
  });

  it('a repeated trend reduces load, rounded down to an achievable load', () => {
    const history = [session(1, bar.id, working(kg(100), [5, 5, 4])), session(4, bar.id, working(kg(100), [5, 4, 4]))];
    const t = calculateNextTargets(input(history, bar));
    expect(t.decision).toBe('reduce_load');
    expect(t.sets[0]?.load).toEqual(kg(90));
    expect(t.basedOnSessionIds).toHaveLength(2);
  });

  it('misses at different loads are not a trend', () => {
    const history = [session(1, bar.id, working(kg(97.5), [5, 5, 4])), session(4, bar.id, working(kg(100), [5, 4, 4]))];
    expect(calculateNextTargets(input(history, bar)).decision).toBe('hold_after_miss');
  });

  it('uses the latest session by date regardless of input order, and corrected values as given', () => {
    const history = [session(9, bar.id, working(kg(95), [8, 8, 8])), session(2, bar.id, working(kg(100), [8, 8, 8]))];
    const t = calculateNextTargets(input(history, bar));
    expect(t.sets[0]?.load).toEqual(kg(97.5));
  });

  it('pain flag halts progression for the movement without raising targets', () => {
    const t = calculateNextTargets(
      input([session(1, bar.id, working(kg(100), [8, 8, 8], 7))], bar, doubleProgression(), {
        pain: { active: true, reportedAtUtc: '2026-09-02T07:00:00.000Z' },
      }),
    );
    expect(t.decision).toBe('halted_pain');
    expect(t.sets[0]?.load).toEqual(kg(100));
    expect(t.explanation.summary).toBe('Progression for Bench press is paused because pain was reported on 2026-09-02. Targets are not increased.');
    expect(t.explanation.summary).not.toMatch(/injur|strain|tendin/i);
  });

  it('insufficient data: bounded starting load rounded to the equipment, or no load', () => {
    const none = calculateNextTargets(input([], bar));
    expect(none.decision).toBe('insufficient_data');
    expect(none.sets[0]?.load).toBeNull();
    const start = calculateNextTargets(input([], bar, doubleProgression({ startingLoad: { value: 61, unit: 'kg' } })));
    expect(start.sets[0]?.load).toEqual(kg(60));
  });

  it('only compares like-for-like: other equipment, units or conventions are excluded', () => {
    const otherBar = id(999);
    const history = [
      session(1, bar.id, working(kg(100), [8, 7, 6])),
      session(5, otherBar, working(kg(120), [8, 8, 8])),
      session(6, bar.id, working(lb(225), [8, 8, 8])),
    ];
    const t = calculateNextTargets(input(history, bar));
    expect(t.decision).toBe('hold');
    expect(t.sets[0]?.load).toEqual(kg(100));
    expect(t.explanation.facts[0]).toMatch(/2 earlier sessions were left out/);
  });

  it('ignores warm-up sets', () => {
    const s = session(1, bar.id, [{ load: kg(60), reps: 3, setType: 'warmup' }, ...working(kg(100), [8, 8, 8])]);
    expect(calculateNextTargets(input([s], bar)).decision).toBe('increase_load');
  });
});

describe('equipment ceilings and feasibility', () => {
  it('home dumbbells top out at 30 kg each: progress reps instead of prescribing 32.5', () => {
    const db = dumbbells();
    const t = calculateNextTargets(
      input([session(1, db.id, working(kg(30, 'per_hand'), [8, 9, 8]))], db, doubleProgression({ repRange: { min: 8, max: 8 } })),
    );
    expect(t.decision).toBe('increase_reps');
    expect(t.sets[0]).toEqual({ setType: 'working', load: kg(30, 'per_hand'), reps: { min: 9, max: 9 } });
    expect(t.explanation.summary).toMatch(/30 kg each is the heaviest load available on Home dumbbells/);
  });

  it('machine at its maximum: never imaginary extra weight; stops at the rep cap', () => {
    const m = stack();
    const atMax = session(1, m.id, working(kg(50, 'stack'), [12, 12, 12]));
    const t = calculateNextTargets(input([atMax], m, doubleProgression({ repRange: { min: 8, max: 12 }, ceilingRepCap: 12 })));
    expect(t.decision).toBe('ceiling_reached');
    expect(t.sets[0]?.load).toEqual(kg(50, 'stack'));
    expect(t.explanation.summary).toMatch(/Consider a substitution/);
  });

  it('increment smaller than the equipment step uses the next achievable load', () => {
    const db = dumbbells({ loads: [10, 12, 14, 16, 18, 20] });
    const t = calculateNextTargets(
      input([session(1, db.id, working(kg(14, 'per_hand'), [8, 8, 8]))], db, doubleProgression({ loadIncrement: { value: 1, unit: 'kg' } })),
    );
    expect(t.sets[0]?.load).toEqual(kg(16, 'per_hand'));
  });

  it('a jump larger than the rule allows progresses reps instead', () => {
    const db = dumbbells({ loads: [10, 12.5, 15, 20] });
    const t = calculateNextTargets(
      input(
        [session(1, db.id, working(kg(15, 'per_hand'), [8, 8, 8]))],
        db,
        doubleProgression({ maxLoadJump: { value: 2.5, unit: 'kg' } }),
      ),
    );
    expect(t.decision).toBe('increase_reps');
    expect(t.sets[0]?.load).toEqual(kg(15, 'per_hand'));
    expect(t.explanation.summary).toMatch(/bigger jump than the rule allows/);
  });

  it('lb equipment with a kg increment converts explicitly and rounds to real plates', () => {
    const lbBar = barbell({ unit: 'lb', barMass: 45, plates: [{ mass: 45, count: 4 }, { mass: 5, count: 2 }, { mass: 2.5, count: 2 }] });
    const t = calculateNextTargets(input([session(1, lbBar.id, working(lb(135), [8, 8, 8]))], lbBar, doubleProgression(), { unit: 'lb' }));
    expect(t.sets[0]?.load).toEqual(lb(140));
  });

  it('without an equipment profile, loads are marked unchecked', () => {
    const t = calculateNextTargets(input([session(1, null, working(kg(100), [8, 8, 8]))], null));
    expect(t.sets[0]?.load).toEqual(kg(102.5));
    expect(t.loadFeasibility).toBe('unchecked');
  });

  it('a held load that is no longer on the equipment is rounded toward easier and explained', () => {
    const db = dumbbells({ loads: [10, 15, 20] });
    const t = calculateNextTargets(input([session(1, db.id, working(kg(17.5, 'per_hand'), [8, 7, 6]))], db));
    expect(t.sets[0]?.load).toEqual(kg(15, 'per_hand'));
    expect(t.explanation.facts.join(' ')).toMatch(/no longer available/);
  });

  it('bodyweight: progresses reps only', () => {
    const t = calculateNextTargets(
      input([session(1, null, working(null, [8, 8, 8]))], null, doubleProgression(), { convention: 'bodyweight' }),
    );
    expect(t.decision).toBe('increase_reps');
    expect(t.sets[0]).toEqual({ setType: 'working', load: null, reps: { min: 9, max: 9 } });
    expect(t.loadFeasibility).toBe('not_applicable');
  });
});

describe('assisted machines (more assistance = easier)', () => {
  const m = assisted();
  const a = (v: number) => kg(v, 'assistance');

  it('progression reduces assistance', () => {
    const t = calculateNextTargets(input([session(1, m.id, working(a(20), [8, 8, 8]))], m));
    expect(t.decision).toBe('increase_load');
    expect(t.sets[0]?.load).toEqual(a(15));
    expect(t.explanation.summary).toBe('Reduce assistance to assist 15 kg for 6–8 reps.');
  });

  it('the easiest counted set (most assistance) is the reference load', () => {
    const t = calculateNextTargets(input([session(1, m.id, [{ load: a(15), reps: 8 }, { load: a(20), reps: 8 }])], m));
    expect(t.sets[0]?.load).toEqual(a(15));
  });

  it('a reduction after a trend means MORE assistance', () => {
    const history = [session(1, m.id, working(a(20), [4, 4, 4])), session(3, m.id, working(a(20), [5, 4, 4]))];
    const t = calculateNextTargets(input(history, m));
    expect(t.decision).toBe('reduce_load');
    expect(t.sets[0]?.load).toEqual(a(25));
  });

  it('at minimum assistance, progress reps', () => {
    const t = calculateNextTargets(input([session(1, m.id, working(a(5), [8, 8, 8]))], m));
    expect(t.decision).toBe('increase_reps');
    expect(t.explanation.summary).toMatch(/least-assisted/);
  });

  it('top-set/back-off is not supported on assisted machines', () => {
    expect(calculateNextTargets(input([], m, topSetBackoff())).decision).toBe('unsupported');
  });
});

describe('top set / back-off', () => {
  const bar = barbell();
  const top = (load: number, reps: number, rpe?: number) => ({ load: kg(load), reps, setType: 'top' as const, ...(rpe === undefined ? {} : { rpe }) });
  const back = (load: number, reps: number) => ({ load: kg(load), reps, setType: 'backoff' as const });

  it('progresses the top set and derives back-offs as a rounded-down percentage', () => {
    const t = calculateNextTargets(input([session(1, bar.id, [top(140, 5, 8.5), back(125, 8), back(125, 8)])], bar, topSetBackoff()));
    expect(t.decision).toBe('increase_load');
    expect(t.sets).toEqual([
      { setType: 'top', load: kg(142.5), reps: { min: 3, max: 5 } },
      { setType: 'backoff', load: kg(127.5), reps: { min: 6, max: 8 } },
      { setType: 'backoff', load: kg(127.5), reps: { min: 6, max: 8 } },
    ]);
    expect(t.explanation.facts.join(' ')).toMatch(/90% of the top set, rounded down to 127.5 kg/);
  });

  it('back-off performance does not drive the decision; the top set does', () => {
    const t = calculateNextTargets(input([session(1, bar.id, [top(140, 4), back(125, 3), back(125, 3)])], bar, topSetBackoff()));
    expect(t.decision).toBe('hold');
    expect(t.sets[0]?.load).toEqual(kg(140));
  });

  it('a missed top set holds once, then reduces on a trend', () => {
    const one = [session(1, bar.id, [top(140, 2)])];
    expect(calculateNextTargets(input(one, bar, topSetBackoff())).decision).toBe('hold_after_miss');
    const two = [...one, session(4, bar.id, [top(140, 2)])];
    const t = calculateNextTargets(input(two, bar, topSetBackoff()));
    expect(t.decision).toBe('reduce_load');
    expect(t.sets[0]?.load).toEqual(kg(125));
  });

  it('pain halts the top set too', () => {
    const t = calculateNextTargets(
      input([session(1, bar.id, [top(140, 5, 7)])], bar, topSetBackoff(), { pain: { active: true, reportedAtUtc: null } }),
    );
    expect(t.decision).toBe('halted_pain');
    expect(t.sets[0]?.load).toEqual(kg(140));
  });
});

describe('determinism', () => {
  it('same input, same output', () => {
    const bar = barbell();
    const i = input([session(1, bar.id, working(kg(100), [8, 8, 8], 8))], bar);
    expect(calculateNextTargets(i)).toEqual(calculateNextTargets(i));
  });
});
