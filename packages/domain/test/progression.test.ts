import { describe, expect, it } from 'vitest';
import type { EquipmentInstance, Load, ProgressionRule, SetSide, SetType } from '@fizz/schemas';
import { calculateNextTargets, formatLoad, type HistorySession, type NextTargetsInput } from '../src/index';
import { assisted, barbell, doubleProgression, dumbbells, id, kg, lb, stack, topSetBackoff } from './fixtures';

let sessionN = 700;
function session(
  day: number,
  equipmentId: string | null,
  sets: { load: Load | null; reps: number; rpe?: number; rir?: number; setType?: SetType; side?: SetSide | null }[],
): HistorySession {
  sessionN += 1;
  return {
    sessionId: id(sessionN),
    performedAtUtc: `2026-09-${String(day).padStart(2, '0')}T06:00:00.000Z`,
    equipmentId,
    sets: sets.map((s) => ({
      setType: s.setType ?? 'working',
      side: s.side ?? null,
      load: s.load,
      reps: s.reps,
      rpe: s.rpe ?? null,
      rir: s.rir ?? null,
    })),
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
    measurement: 'reps',
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
    const t = calculateNextTargets(
      input([session(1, m.id, [{ load: a(15), reps: 8 }, { load: a(20), reps: 8 }, { load: a(20), reps: 8 }])], m),
    );
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

describe('incomplete sessions never progress (review B2, ADR 0003 S3)', () => {
  const bar = barbell();

  it('1 of 3 working sets at the top of the range holds, with an explanation', () => {
    const t = calculateNextTargets(input([session(1, bar.id, working(kg(100), [8]))], bar));
    expect(t.decision).toBe('hold');
    expect(t.sets[0]?.load).toEqual(kg(100));
    expect(t.explanation.facts).toContain('Only 1 of 3 working sets was logged on 2026-09-01; holding.');
    expect(t.explanation.summary).toBe('Stay at 100 kg and work toward 8 reps on every set.');
  });

  it('2 of 3 also holds; 3 of 3 progresses', () => {
    expect(calculateNextTargets(input([session(1, bar.id, working(kg(100), [8, 8]))], bar)).decision).toBe('hold');
    expect(calculateNextTargets(input([session(1, bar.id, working(kg(100), [8, 8, 8]))], bar)).decision).toBe('increase_load');
  });

  it('a session where every set was skipped is the latest session and holds at the last performed load', () => {
    const history = [session(1, bar.id, working(kg(100), [8, 8, 8])), session(4, bar.id, [])];
    const t = calculateNextTargets(input(history, bar));
    expect(t.decision).toBe('hold');
    expect(t.sets[0]?.load).toEqual(kg(100));
    expect(t.explanation.facts).toContain('No working sets were logged on 2026-09-04 (all skipped); holding.');
    expect(t.basedOnSessionIds[0]).toBe(history[1]?.sessionId);
  });

  it('only skipped history and no starting load: no load is invented', () => {
    const t = calculateNextTargets(input([session(4, bar.id, [])], bar));
    expect(t.decision).toBe('insufficient_data');
    expect(t.sets[0]?.load).toBeNull();
  });

  it('top-set rule: a session with back-offs but no top set holds instead of using an older session', () => {
    const top = { load: kg(140), reps: 5, setType: 'top' as const, rpe: 8 };
    const back = { load: kg(125), reps: 8, setType: 'backoff' as const };
    const history = [session(1, bar.id, [top, back]), session(4, bar.id, [back, back])];
    const t = calculateNextTargets(input(history, bar, topSetBackoff()));
    expect(t.decision).toBe('hold');
    expect(t.sets[0]?.load).toEqual(kg(140));
    // Review minor 7: back-offs were logged, so this isn't "all skipped".
    expect(t.explanation.facts).toContain('No top sets were logged on 2026-09-04 (no top set); holding.');
    expect(t.explanation.facts.join(' ')).not.toMatch(/all skipped/);
  });
});

describe('explanations name the prescribed load (review B3)', () => {
  // The rack was edited down to 20 kg; history (off-profile or pre-edit) shows 30 kg each.
  const small = dumbbells({ loads: [5, 10, 15, 20] });
  const each = (v: number) => kg(v, 'per_hand');

  it('all sets at the top, history above the new max: rep step at the real max, and the text says so', () => {
    const t = calculateNextTargets(input([session(1, small.id, working(each(30), [8, 8, 8]))], small));
    expect(t.decision).toBe('increase_reps');
    expect(t.sets[0]?.load).toEqual(each(20));
    expect(t.explanation.summary).toBe('Add a rep: aim for 9 at 20 kg each, because 20 kg each is the heaviest load available on Home dumbbells.');
    expect(t.explanation.summary).not.toMatch(/30 kg/);
    expect(t.explanation.facts).toContain('Last load 30 kg each is no longer available on Home dumbbells; using 20 kg each.');
    expect(t.loadFeasibility).toBe('checked');
  });

  it('hold path: names the held load, not the historical one', () => {
    const t = calculateNextTargets(input([session(1, small.id, working(each(30), [8, 7, 6]))], small));
    expect(t.decision).toBe('hold');
    expect(t.sets[0]?.load).toEqual(each(20));
    expect(t.explanation.summary).toBe('Stay at 20 kg each and work toward 8 reps on every set.');
  });

  it('miss path: "Use" the held load rather than "Repeat" a load that no longer exists', () => {
    const t = calculateNextTargets(input([session(1, small.id, working(each(30), [5, 5, 5]))], small));
    expect(t.decision).toBe('hold_after_miss');
    expect(t.explanation.summary).toBe('Use 20 kg each for 6–8 reps.');
  });

  it('at the rep cap above the max: the cap message names the held load', () => {
    const t = calculateNextTargets(
      input([session(1, small.id, working(each(30), [12, 12, 12]))], small, doubleProgression({ repRange: { min: 8, max: 12 }, ceilingRepCap: 12 })),
    );
    expect(t.decision).toBe('ceiling_reached');
    expect(t.explanation.summary).toMatch(/^Bench press has reached the rep cap \(12\) at 20 kg each because 20 kg each is the heaviest/);
  });

  it('equipment that can make no load prescribes none and is not reported as checked', () => {
    const broken = stack({ minLoad: 60, maxLoad: 70 }); // stack tops out at 50
    for (const reps of [[12, 12, 12], [10, 9, 9], [4, 4, 4]]) {
      const t = calculateNextTargets(input([session(1, broken.id, working(kg(40, 'stack'), reps))], broken));
      expect(t.sets[0]?.load).toBeNull();
      expect(t.loadFeasibility).toBe('infeasible');
      expect(t.explanation.summary).not.toMatch(/40 kg stack and work|Repeat 40/);
    }
  });

  it("R3: a weighted machine with no achievable loads gets 'no_feasible_load', never \"bodyweight\"", () => {
    // Reviewer's probe: cable stack with minLoad 100 (stack tops out at 50).
    const broken = stack({ minLoad: 100 });
    const cases = [
      [8, 8, 8], // would have been increase_reps "at bodyweight"
      [8, 7, 6], // hold path: would have been "Stay at bodyweight"
      [4, 4, 4], // miss path
      [], // all skipped
    ];
    for (const reps of cases) {
      const t = calculateNextTargets(input([session(1, broken.id, working(kg(50, 'stack'), reps))], broken, doubleProgression(), { exerciseName: 'Cable row' }));
      expect(t.decision).toBe('no_feasible_load');
      expect(t.sets.every((x) => x.load === null)).toBe(true);
      expect(t.loadFeasibility).toBe('infeasible');
      expect(t.explanation.summary).toBe(
        "Cable stack can't make any load with its current min/max settings, so no Cable row target is set. Fix the equipment profile.",
      );
      expect(JSON.stringify(t.explanation)).not.toMatch(/bodyweight/);
    }
    // No history and a starting load: still no_feasible_load, not insufficient_data at "bodyweight".
    const fresh = calculateNextTargets(input([], broken, doubleProgression({ startingLoad: kg(40) })));
    expect(fresh.decision).toBe('no_feasible_load');
    expect(JSON.stringify(fresh.explanation)).not.toMatch(/bodyweight/);
  });

  it('R3: a pain flag still wins over infeasible equipment', () => {
    const broken = stack({ minLoad: 100 });
    const t = calculateNextTargets(
      input([session(1, broken.id, working(kg(50, 'stack'), [8, 8, 8]))], broken, doubleProgression(), { pain: { active: true, reportedAtUtc: null } }),
    );
    expect(t.decision).toBe('halted_pain');
    expect(t.sets[0]?.load).toBeNull();
    expect(JSON.stringify(t.explanation)).not.toMatch(/bodyweight/);
  });

  it('R3: formatLoad only calls a null load "bodyweight" when the convention is bodyweight', () => {
    expect(formatLoad(null)).toBe('no load');
    expect(formatLoad(null, 'stack')).toBe('no load');
    expect(formatLoad(null, 'per_hand')).toBe('no load');
    expect(formatLoad(null, 'bodyweight')).toBe('bodyweight');
    expect(formatLoad(null, 'added')).toBe('bodyweight');
  });
});

describe('rule schema (review M1)', () => {
  it('rejects a ceiling rep cap below the top of the rep range', () => {
    expect(() => doubleProgression({ repRange: { min: 8, max: 12 }, ceilingRepCap: 10 })).toThrow(/ceilingRepCap/);
    expect(() => topSetBackoff({ ceilingRepCap: 4 })).toThrow(/ceilingRepCap/);
    expect(() => doubleProgression({ repRange: { min: 8, max: 12 }, ceilingRepCap: 12 })).not.toThrow();
  });

  it('a ceiling result always has a valid rep range', () => {
    const m = stack();
    const t = calculateNextTargets(
      input([session(1, m.id, working(kg(50, 'stack'), [12, 12, 12]))], m, doubleProgression({ repRange: { min: 8, max: 12 }, ceilingRepCap: 12 })),
    );
    for (const set of t.sets) expect(set.reps.min).toBeLessThanOrEqual(set.reps.max);
  });
});

describe('timed exercises (review M2)', () => {
  it('returns an honest unsupported result instead of claiming there is no history', () => {
    const hang: HistorySession = {
      sessionId: id(990),
      performedAtUtc: '2026-09-01T06:00:00.000Z',
      equipmentId: null,
      sets: [{ setType: 'working', side: null, load: null, reps: null, rpe: null, rir: null }],
    };
    const t = calculateNextTargets(
      input([hang], null, doubleProgression(), { exerciseName: 'Dead hang', measurement: 'duration', convention: 'bodyweight' }),
    );
    expect(t.decision).toBe('unsupported');
    expect(t.explanation.summary).toBe("Time-based progression isn't supported yet, so Dead hang targets stay as planned.");
    expect(t.explanation.summary).not.toMatch(/No comparable/);
    expect(t.sets).toEqual([]);
  });
});

function permutations<T>(items: readonly T[]): T[][] {
  if (items.length <= 1) return [[...items]];
  return items.flatMap((item, i) => permutations([...items.slice(0, i), ...items.slice(i + 1)]).map((rest) => [item, ...rest]));
}

describe('determinism', () => {
  const bar = barbell();

  it('the result is identical for every ordering of the history', () => {
    const history = [
      session(1, bar.id, working(kg(100), [8, 8, 8], 8)),
      session(3, bar.id, working(kg(102.5), [6, 5, 5])),
      session(5, bar.id, working(kg(102.5), [5, 5, 4])),
      session(6, id(998), working(kg(120), [8, 8, 8])),
    ];
    const outputs = permutations(history).map((h) => calculateNextTargets(input(h, bar)));
    expect(outputs).toHaveLength(24);
    for (const o of outputs) expect(o).toEqual(outputs[0]);
    expect(outputs[0]?.decision).toBe('reduce_load');
  });

  it('sessions with the same timestamp are ordered by session ID, not input order', () => {
    const a = { ...session(7, bar.id, working(kg(100), [8, 8, 8], 8)), sessionId: id(901) };
    const b = { ...session(7, bar.id, working(kg(100), [6, 6, 6], 8)), sessionId: id(902) };
    const ab = calculateNextTargets(input([a, b], bar));
    const ba = calculateNextTargets(input([b, a], bar));
    expect(ab).toEqual(ba);
    // The higher session ID is treated as the later one.
    expect(ab.decision).toBe('hold');
    expect(ab.basedOnSessionIds).toEqual([id(902), id(901)]);
  });
});

describe('unilateral sides in progression (review R4, ADR 0003)', () => {
  const rack = dumbbells();
  const each = (v: number) => kg(v, 'per_hand');
  type S = { load: Load; reps: number; side: SetSide | null; rpe?: number };
  const L = (reps: number, rpe?: number): S => ({ load: each(20), reps, side: 'left', ...(rpe === undefined ? {} : { rpe }) });
  const R = (reps: number, rpe?: number): S => ({ load: each(20), reps, side: 'right', ...(rpe === undefined ? {} : { rpe }) });
  const B = (reps: number): S => ({ load: each(20), reps, side: 'both' });
  const next = (sets: S[]) =>
    calculateNextTargets(input([session(1, rack.id, sets)], rack, doubleProgression(), { exerciseName: 'Bulgarian split squat' }));

  it('three "both sides" sets at the top progress as before', () => {
    expect(next([B(8), B(8), B(8)]).decision).toBe('increase_load');
  });

  it('three left-only sets never progress: the right side was not trained', () => {
    const t = next([L(8), L(8), L(8)]);
    expect(t.decision).toBe('hold');
    expect(t.sets[0]?.load).toEqual(each(20));
    expect(t.explanation.facts).toContain(
      'None of 3 working sets had both sides logged on 2026-09-01 (left 3, right 0: the right side is behind); holding.',
    );
  });

  it('two sets per side count as two prescribed sets, not four', () => {
    const t = next([L(8), R(8), L(8), R(8)]);
    expect(t.decision).toBe('hold');
    expect(t.explanation.facts).toContain('Only 2 of 3 working sets had both sides logged on 2026-09-01 (left 2, right 2); holding.');
  });

  it('three left + right pairs at the top progress; a mix of both and pairs counts each once', () => {
    expect(next([L(8), R(8), L(8), R(8), L(8), R(8)]).decision).toBe('increase_load');
    expect(next([B(8), L(8), R(8), L(8), R(8)]).decision).toBe('increase_load');
    expect(next([B(8), L(8), R(8)]).decision).toBe('hold');
  });

  it('when the sides differ, hold and say which side lagged', () => {
    const t = next([L(8), R(8), L(8), R(7), L(8), R(8)]);
    expect(t.decision).toBe('hold');
    expect(t.sets[0]?.load).toEqual(each(20));
    expect(t.explanation.facts).toContain(
      "The left side reached 8+ reps on every set but the right side didn't (lowest 7 reps); the load goes up only when both sides do.",
    );
  });

  it('a side over the effort limit also holds and is named', () => {
    const t = next([L(8, 10), R(8, 8), L(8, 8), R(8, 8), L(8, 8), R(8, 8)]);
    expect(t.decision).toBe('hold');
    expect(t.explanation.facts).toContain(
      "The right side reached 8+ reps on every set but the left side didn't (effort above the limit); the load goes up only when both sides do.",
    );
  });

  it('mixed sided and unsided sets can not be paired: hold with an explanation', () => {
    const t = next([L(8), R(8), L(8), R(8), { load: each(20), reps: 8, side: null }, L(8), R(8)]);
    expect(t.decision).toBe('hold');
    expect(t.explanation.facts).toContain(
      "Some Bulgarian split squat sets on 2026-09-01 have a left or right side and others have none, so the sides can't be compared; holding.",
    );
  });
});
