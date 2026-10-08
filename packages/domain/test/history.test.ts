import { describe, expect, it } from 'vitest';
import type { SessionAggregate, SetSide } from '@fizz/schemas';
import { calculateNextTargets, getSetPair, toHistorySessions, type HistorySession } from '../src/index';
import { at, doubleProgression, dumbbells, kg, values } from './fixtures';
import { SPLIT_SQUAT, unilateralSession } from './repository-contract';
import { apply, logCmd } from './session-fixture';

const RULE = doubleProgression({ repRange: { min: 8, max: 10 }, workingSets: 3, maxRpeToProgress: null });

function next(history: HistorySession[]) {
  return calculateNextTargets({
    exerciseName: SPLIT_SQUAT.name,
    measurement: 'reps',
    history,
    rule: RULE,
    equipment: dumbbells(),
    unit: 'kg',
    convention: 'per_hand',
    pain: { active: false, reportedAtUtc: null },
  });
}

/** Log `setId` as `side` (or keep its side), returning the new state. */
function log(s: SessionAggregate, setId: string, reps: number, t: number, side?: SetSide): SessionAggregate {
  return apply(s, logCmd(setId, values(kg(15, 'per_hand'), reps), t, `log-${setId}-${t}`, side));
}

function finish(s: SessionAggregate, t: number): SessionAggregate {
  return apply(s, { type: 'finish', at: at(t), opId: `fin-${t}`, expectedVersion: s.session.version, endedAt: null });
}

describe('toHistorySessions (third-review follow-up 5)', () => {
  it('carries side, so an unpaired third set holds instead of progressing', () => {
    let s = unilateralSession();
    const [a, b, c] = s.sets;
    if (!a || !b || !c) throw new Error('fixture');
    s = log(s, a.id, 10, 60, 'left');
    s = log(s, s.session.activeSetId ?? '', 10, 90);
    s = log(s, b.id, 10, 180, 'left');
    s = log(s, s.session.activeSetId ?? '', 10, 210);
    s = log(s, c.id, 10, 300, 'left');
    // The right side of set 3 is never logged; Finish marks it skipped.
    s = finish(s, 400);

    const history = toHistorySessions(s, SPLIT_SQUAT.id);
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ sessionId: s.session.id, performedAtUtc: s.session.startedAt.utc, equipmentId: dumbbells().id });
    expect(history[0]?.sets.map((x) => x.side)).toEqual(['left', 'left', 'left', 'right', 'right']);
    expect(next(history).decision).toBe('hold');

    // Proof the side matters: with sides dropped, five rows look like five sets and the load would go up.
    const sideless = history.map((h) => ({ ...h, sets: h.sets.map((x) => ({ ...x, side: null })) }));
    expect(next(sideless).decision).toBe('increase_load');
  });

  it('progresses when every prescribed set has both sides at the top of the range', () => {
    let s = unilateralSession();
    for (const [i, set] of s.sets.slice(0, 3).entries()) {
      s = log(s, set.id, 10, 60 + i * 100, 'left');
      s = log(s, s.session.activeSetId ?? '', 10, 90 + i * 100);
    }
    s = finish(s, 500);
    const history = toHistorySessions(s, SPLIT_SQUAT.id);
    expect(history[0]?.sets).toHaveLength(6);
    expect(next(history).decision).toBe('increase_load');
  });

  it('counts an other side whose partner was deleted as a lone side, not a pair', () => {
    let s = unilateralSession();
    const [a] = s.sets;
    if (!a) throw new Error('fixture');
    s = log(s, a.id, 10, 60, 'left');
    const other = s.session.activeSetId ?? '';
    s = log(s, other, 10, 90);
    const logged = s.sets.find((x) => x.id === a.id);
    s = apply(s, { type: 'delete_set', at: at(100), opId: 'del-a', setId: a.id, expectedSetVersion: logged?.version ?? 1 });
    expect(getSetPair(s, other)).toBeNull();
    s = finish(s, 200);

    const [h] = toHistorySessions(s, SPLIT_SQUAT.id);
    expect(h?.sets).toEqual([{ setType: 'working', side: 'right', load: kg(15, 'per_hand'), reps: 10, rpe: null, rir: null }]);
  });

  it('ignores active and discarded sessions, other exercises, and non-completed rows', () => {
    let s = unilateralSession();
    const [a] = s.sets;
    if (!a) throw new Error('fixture');
    s = log(s, a.id, 9, 60, 'both');
    expect(toHistorySessions(s, SPLIT_SQUAT.id)).toEqual([]);
    expect(toHistorySessions(finish(s, 100), 'not-this-exercise')).toEqual([]);
    const discarded = apply(s, { type: 'discard', at: at(100), opId: 'disc', expectedVersion: s.session.version });
    expect(toHistorySessions(discarded, SPLIT_SQUAT.id)).toEqual([]);

    const [h] = toHistorySessions(finish(s, 100), SPLIT_SQUAT.id);
    // Two pending rows became skipped at Finish and are absent.
    expect(h?.sets).toEqual([{ setType: 'working', side: 'both', load: kg(15, 'per_hand'), reps: 9, rpe: null, rir: null }]);
  });
});
