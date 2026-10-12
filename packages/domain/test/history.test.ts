import { describe, expect, it } from 'vitest';
import type { SessionAggregate, SetSide } from '@fizz/schemas';
import { calculateNextTargets, comparableSetsOf, getSetPair, toHistorySessions, type HistorySession } from '../src/index';
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
    const discarded = apply(s, { type: 'discard', at: at(100), opId: 'disc', expectedVersion: s.session.version, confirmedLoggedSets: 1 });
    expect(toHistorySessions(discarded, SPLIT_SQUAT.id)).toEqual([]);

    const done = finish(s, 100);
    const [h] = toHistorySessions(done, SPLIT_SQUAT.id);
    // Its gym, and logged in the app: comparable (review r2 B1).
    expect([h?.gymId, h?.imported]).toEqual([done.session.gymId, false]);
    // Two pending rows became skipped at Finish and are absent.
    expect(h?.sets).toEqual([{ setType: 'working', side: 'both', load: kg(15, 'per_hand'), reps: 9, rpe: null, rir: null }]);
  });
});

describe('imported history (B7: FitNotes as Last and targets, labelled; rule 4)', () => {
  const PAIN_OFF = { active: false, reportedAtUtc: null } as const;
  const imported = (sets: { load: number; reps: number }[], day = '2026-10-08T12:00:00.000Z'): HistorySession => ({
    sessionId: `fitnotes-${day}`,
    performedAtUtc: day,
    equipmentId: null,
    gymId: null,
    imported: true,
    sets: sets.map((x) => ({ setType: 'working', side: 'both', load: kg(x.load, 'per_hand'), reps: x.reps, rpe: null, rir: null })),
  });

  it('a FitNotes workout is marked imported and counts for the rule on any equipment', () => {
    let s = unilateralSession();
    for (const [i, set] of s.sets.entries()) s = log(s, set.id, 10, 10 + i * 60, 'both');
    const done = finish(s, 600);
    const asImported: SessionAggregate = { ...done, session: { ...done.session, source: 'import', gymId: null, importJobId: '00000000-0000-4000-8000-0000000a0c01', localDate: '2026-10-08' } };
    const fromFile = toHistorySessions(asImported, SPLIT_SQUAT.id).map((x) => ({ ...x, equipmentId: null }));
    expect([fromFile[0]?.imported, fromFile[0]?.gymId]).toEqual([true, null]);
    // On today's dumbbells (FitNotes recorded none): every set at the top of the range, so the load goes up, on a real dumbbell.
    const t = next(fromFile);
    expect(t.decision).toBe('increase_load');
    expect(t.sets[0]?.load).toEqual(kg(17.5, 'per_hand'));
    expect(t.loadFeasibility).toBe('checked');
    expect(t.explanation.facts.join(' ')).toMatch(/from FitNotes/);
  });

  it('reads a FitNotes ramp: lighter sets are warm-ups, the top sets are the working sets', () => {
    const h = imported([{ load: 10, reps: 12 }, { load: 15, reps: 10 }, { load: 20, reps: 10 }, { load: 20, reps: 10 }, { load: 20, reps: 10 }]);
    expect(comparableSetsOf(h).map((x) => x.load?.value)).toEqual([20, 20, 20]);
    const t = next([h]);
    // Three sets of 10 at 20 kg each: progress from 20, never from the 10 kg warm-up.
    expect([t.decision, t.sets[0]?.load]).toEqual(['increase_load', kg(22.5, 'per_hand')]);
    expect(t.explanation.facts.join(' ')).toMatch(/lighter sets were read as warm-ups/);
    // Logged in the app, the same sets are read as logged (warm-ups are flagged there).
    expect(comparableSetsOf({ ...h, imported: false })).toHaveLength(5);
  });

  it('never above the equipment max: a FitNotes load heavier than any dumbbell here is held at the heaviest (rule 4)', () => {
    const t = next([imported([{ load: 40, reps: 8 }, { load: 40, reps: 8 }, { load: 40, reps: 8 }])]);
    expect(t.sets.every((x) => x.load !== null && x.load.value <= 30)).toBe(true);
    expect(t.loadFeasibility).toBe('checked');
  });

  it('with no equipment here to check it on, no load is prescribed; with `fitLater` the raw load is kept for the gym fit', () => {
    const h = imported([{ load: 20, reps: 8 }, { load: 20, reps: 8 }, { load: 20, reps: 8 }]);
    const base = { exerciseName: SPLIT_SQUAT.name, measurement: 'reps' as const, history: [h], rule: RULE, equipment: null, unit: 'kg' as const, convention: 'per_hand' as const, pain: PAIN_OFF };
    const t = calculateNextTargets(base);
    expect(t.sets.every((x) => x.load === null)).toBe(true);
    expect(t.explanation.summary).toBe('Pick a load you can do for 8–10 reps.');
    expect(t.explanation.facts.join(' ')).toMatch(/No equipment here to check the FitNotes load/);
    const later = calculateNextTargets({ ...base, fitLater: true });
    expect(later.sets[0]?.load).toEqual(kg(20, 'per_hand'));
  });

  it('another unit or convention is never compared, FitNotes or not', () => {
    const lb: HistorySession = { ...imported([{ load: 20, reps: 10 }]), sets: [{ setType: 'working', side: 'both', load: { value: 45, unit: 'lb', convention: 'per_hand' }, reps: 10, rpe: null, rir: null }] };
    expect(next([lb]).decision).toBe('insufficient_data');
  });

  it('the newest comparable workout wins, logged in the app or FitNotes', () => {
    let s = unilateralSession();
    for (const [i, set] of s.sets.entries()) s = log(s, set.id, 8, 10 + i * 60, 'both');
    const app = toHistorySessions(finish(s, 600), SPLIT_SQUAT.id);
    const older = imported([{ load: 25, reps: 10 }, { load: 25, reps: 10 }, { load: 25, reps: 10 }], '2020-01-01T12:00:00.000Z');
    // The app workout (15 kg each × 8) is newer: hold at 15.
    expect(next([older, ...app]).sets[0]?.load).toEqual(kg(15, 'per_hand'));
  });
});
