import { describe, expect, it } from 'vitest';
import type { EquipmentInstance, Exercise, SessionAggregate, SetExclusion, SetValues, WorkoutSet } from '@fizz/schemas';
import { WorkoutSetSchema } from '@fizz/schemas';
import {
  allLeftOutFact,
  buildActiveSetView,
  buildAddExerciseCommand,
  buildSetEditView,
  buildWorkoutSummary,
  calculateNextTargets,
  exclusionAccessibility,
  exclusionAuditLines,
  exclusionFields,
  exclusionPainLine,
  exclusionTag,
  exclusionToast,
  exclusionWords,
  isSetCountable,
  lastComparableSession,
  NBSP,
  normaliseExclusions,
  notCountedLine,
  notComparedText,
  planExclusionMark,
  reduceSession,
  ruleBasis,
  startWorkout,
  summaryHighlight,
  summariseVolume,
  toHistorySessions,
  type CountPurpose,
  type HistorySession,
  type SummaryInput,
} from '../src/index';
import { at, barbell, doubleProgression, exercise, GYM, id, idGen, kg, lb, ms, profile, values } from './fixtures';
import { apply, BENCH as BENCH_ID, expectError, expectOk, logCmd, setsFor, startFixture } from './session-fixture';

const benchSets = (s: SessionAggregate) => setsFor(s, BENCH_ID);

const plain = (s: string | null | undefined) => (s ?? '').replaceAll(NBSP, ' ');
const PURPOSES: CountPurpose[] = ['record', 'e1rm', 'progression', 'comparison', 'trigger', 'volume'];

describe('isSetCountable (active-workout §2.13, AW8)', () => {
  it('a set with no flags counts for everything', () => {
    for (const p of PURPOSES) {
      expect(isSetCountable({}, p)).toBe(true);
      expect(isSetCountable({ exclusions: [] }, p)).toBe(true);
    }
  });

  it('a flagged set counts only for volume', () => {
    for (const reason of ['spotted', 'pain', 'technique', 'other_equipment'] as SetExclusion[]) {
      for (const p of PURPOSES) expect(isSetCountable({ exclusions: [reason] }, p)).toBe(p === 'volume');
    }
  });
});

describe('exclusion words', () => {
  it('normalises to unique reasons in chip order', () => {
    expect(normaliseExclusions(['other_equipment', 'spotted', 'spotted'])).toEqual(['spotted', 'other_equipment']);
    expect(normaliseExclusions(undefined)).toEqual([]);
  });

  it('builds the same words for every place a flagged set appears', () => {
    expect(exclusionTag(['technique', 'spotted'])).toBe('Spotted, form broke');
    expect(exclusionWords(['spotted'])).toBe('spotted');
    expect(notCountedLine(['spotted', 'technique'])).toBe('Spotted, form broke · not counted');
    expect(exclusionAccessibility(['spotted'])).toBe('Spotted: not counted for records or progress.');
    expect(exclusionTag([])).toBeNull();
    expect(notCountedLine(undefined)).toBeNull();
  });

  it('audit lines and toasts say what changed', () => {
    expect(exclusionAuditLines(2, undefined, ['spotted'])).toEqual(['Set 2 marked: spotted']);
    expect(exclusionAuditLines(2, ['spotted'], ['technique'])).toEqual(['Set 2 marked: form broke', 'Set 2 unmarked: spotted']);
    expect(exclusionAuditLines(2, ['spotted'], ['spotted'])).toEqual([]);
    expect(exclusionToast(2, [], ['spotted'])).toBe('Set 2: spotted · not counted for records');
    expect(exclusionToast(2, ['spotted'], [])).toBe('Set 2 counts for records again');
    expect(exclusionToast(2, ['spotted'], ['spotted'])).toBeNull();
    expect(exclusionPainLine('Bench press')).toBe('This also puts a pain flag on Bench press: no increases until you clear it.');
    expect(notComparedText(['spotted'])).toBe('Not compared: the only top set was spotted.');
  });
});

describe('marking a set (correct_set exclusions, AW6)', () => {
  const afterLog = () => {
    const { state } = startFixture();
    const w = benchSets(state)[1];
    if (!w) throw new Error('fixture');
    const s = apply(state, { ...logCmd(w.id, values(kg(100), 8), 30) });
    return { s, setId: w.id };
  };
  const mark = (s: SessionAggregate, setId: string, exclusions: SetExclusion[], expectedSetVersion: number, opId = 'mark-1', seconds = 40) =>
    reduceSession(s, { type: 'correct_set', at: at(seconds), opId, setId, expectedSetVersion, patch: { exclusions } });
  const setOf = (s: SessionAggregate, setId: string) => s.sets.find((x) => x.id === setId) as WorkoutSet;

  it('marks the set as a versioned, audited correction; values, rest and targets are untouched', () => {
    const { s, setId } = afterLog();
    const r = expectOk(mark(s, setId, ['technique', 'spotted'], 2));
    const set = setOf(r.state, setId);
    expect(set.exclusions).toEqual(['spotted', 'technique']);
    expect(set.actual).toEqual(setOf(s, setId).actual);
    expect(set.version).toBe(3);
    // Marking isn't a value edit: no `Edited` tag of its own.
    expect(set.edited).toBe(false);
    expect(r.state.restTimer).toEqual(s.restTimer);
    expect(r.state.sets.filter((x) => x.id !== setId)).toEqual(s.sets.filter((x) => x.id !== setId));
    expect(r.state.session.version).toBe(s.session.version + 1);
    const entry = r.state.audit.at(-1);
    expect(entry).toMatchObject({ kind: 'corrected', opId: 'mark-1' });
    expect(entry?.before?.exclusions).toBeUndefined();
    expect(entry?.after?.exclusions).toEqual(['spotted', 'technique']);
    expect(r.events).toEqual([{ type: 'SetCorrected', setId, setVersion: 3 }]);
    expect(WorkoutSetSchema.safeParse(set).success).toBe(true);
  });

  it('a retry with the same opId is a duplicate and changes nothing (idempotent)', () => {
    const { s, setId } = afterLog();
    const once = expectOk(mark(s, setId, ['spotted'], 2)).state;
    const again = expectOk(mark(once, setId, ['spotted'], 2));
    expect(again.duplicate).toBe(true);
    expect(again.superseded).toBe(false);
    expect(again.state).toBe(once);
    // Reusing the opId for a different mark is refused, never applied.
    expectError(mark(once, setId, ['pain'], 3), 'operation_id_reused');
  });

  it('a stale set version is rejected, never applied to newer state', () => {
    const { s, setId } = afterLog();
    const once = expectOk(mark(s, setId, ['spotted'], 2)).state;
    expectError(mark(once, setId, ['technique'], 2, 'mark-2'), 'stale_version');
  });

  it('Undo is another versioned correction: [] removes the flags and the field', () => {
    const { s, setId } = afterLog();
    const marked = expectOk(mark(s, setId, ['spotted'], 2)).state;
    const undone = expectOk(mark(marked, setId, [], 3, 'mark-undo')).state;
    const set = setOf(undone, setId);
    expect('exclusions' in set).toBe(false);
    expect(set.version).toBe(4);
    expect(undone.audit.map((a) => a.kind)).toEqual(['logged', 'corrected', 'corrected']);
    // The first mark is now superseded: a retry reports "since changed".
    expect(expectOk(mark(undone, setId, ['spotted'], 2)).superseded).toBe(true);
  });

  it('a value correction keeps the flags; a patch without `exclusions` never drops them', () => {
    const { s, setId } = afterLog();
    const marked = expectOk(mark(s, setId, ['spotted'], 2)).state;
    const fixed = apply(marked, { type: 'correct_set', at: at(50), opId: 'c-reps', setId, expectedSetVersion: 3, patch: { reps: 7 } });
    expect(setOf(fixed, setId)).toMatchObject({ exclusions: ['spotted'], edited: true, actual: { reps: 7 } });
  });

  it('only logged sets can be marked', () => {
    const { s } = afterLog();
    const pending = benchSets(s)[2];
    expectError(mark(s, pending?.id ?? '', ['spotted'], 1), 'set_not_completed');
  });

  it('works on a finished workout (a correction after Finish)', () => {
    const { s, setId } = afterLog();
    const done = apply(s, { type: 'finish', at: at(60), opId: 'fin', expectedVersion: s.session.version, endedAt: null });
    expect(setOf(expectOk(mark(done, setId, ['pain'], 2, 'mark-late', 70)).state, setId).exclusions).toEqual(['pain']);
  });

  it('log_set can log and mark in one commit ("100 for 8, spotted")', () => {
    const { state } = startFixture();
    const w = benchSets(state)[1];
    if (!w) throw new Error('fixture');
    const r = expectOk(reduceSession(state, { ...logCmd(w.id, values(kg(100), 8), 30), exclusions: ['spotted'] } as Parameters<typeof reduceSession>[1]));
    expect(setOf(r.state, w.id).exclusions).toEqual(['spotted']);
    expect(r.state.audit.at(-1)?.after?.exclusions).toEqual(['spotted']);
  });

  it('undoing the log removes the flags with it (a pending set counts as nothing)', () => {
    const { state } = startFixture();
    const w = benchSets(state)[1];
    if (!w) throw new Error('fixture');
    const logged = apply(state, { ...logCmd(w.id, values(kg(100), 8), 30, 'log-x'), exclusions: ['spotted'] } as Parameters<typeof reduceSession>[1]);
    const undone = apply(logged, { type: 'undo_log', at: at(35), opId: 'undo-x', setId: w.id, expectedSetVersion: 2 });
    expect('exclusions' in setOf(undone, w.id)).toBe(false);
    expect(WorkoutSetSchema.safeParse(setOf(undone, w.id)).success).toBe(true);
  });
});

describe('effects on progression (built-in rule, §2.13)', () => {
  const bar = barbell();
  let n = 900;
  const hist = (day: number, sets: { load: number; reps: number; ex?: SetExclusion[]; unit?: 'kg' | 'lb' }[]): HistorySession => {
    n += 1;
    return {
      sessionId: id(n),
      performedAtUtc: `2026-09-${String(day).padStart(2, '0')}T06:00:00.000Z`,
      equipmentId: bar.id,
      gymId: null,
      imported: false,
      sets: sets.map((s) => ({ setType: 'working' as const, side: null, load: s.unit === 'lb' ? lb(s.load) : kg(s.load), reps: s.reps, rpe: 8, rir: null, ...(s.ex ? { exclusions: s.ex } : {}) })),
    };
  };
  const run = (history: HistorySession[]) =>
    calculateNextTargets({ exerciseName: 'Bench press', measurement: 'reps', history, rule: doubleProgression(), equipment: bar, unit: 'kg', convention: 'total', pain: { active: false, reportedAtUtc: null } });

  it('a spotted set never earns an increase: 2 of 3 counted holds', () => {
    const t = run([hist(1, [{ load: 100, reps: 8 }, { load: 100, reps: 8 }, { load: 100, reps: 8, ex: ['spotted'] }])]);
    expect(t.decision).toBe('hold');
    expect(t.sets[0]?.load).toEqual(kg(100));
    expect(t.explanation.facts).toContain('Only 2 of 3 working sets counted on 2026-09-01 (1 left out); holding.');
  });

  it('every working set left out: holds on the workout before, and says why', () => {
    const t = run([
      hist(1, [{ load: 95, reps: 7 }, { load: 95, reps: 7 }, { load: 95, reps: 7 }]),
      hist(8, [{ load: 100, reps: 8, ex: ['technique'] }, { load: 100, reps: 8, ex: ['technique'] }, { load: 100, reps: 8, ex: ['spotted'] }]),
    ]);
    expect(t.decision).toBe('hold');
    expect(t.sets[0]?.load).toEqual(kg(95));
    expect(t.explanation.facts).toContain(allLeftOutFact('2026-09-08'));
  });

  it('a set flagged `Other equipment` in another unit doesn’t make the workout incomparable', () => {
    const t = run([hist(1, [{ load: 100, reps: 8 }, { load: 100, reps: 8 }, { load: 100, reps: 8 }, { load: 225, reps: 5, unit: 'lb', ex: ['other_equipment'] }])]);
    expect(t.decision).toBe('increase_load');
    expect(t.sets[0]?.load).toEqual(kg(102.5));
  });

  it('the rule’s basis skips a workout with nothing counted; the reference load ignores flagged sets', () => {
    const earlier = hist(1, [{ load: 95, reps: 7 }, { load: 95, reps: 7 }, { load: 95, reps: 7 }]);
    const allOut = hist(8, [{ load: 100, reps: 8, ex: ['spotted'] }]);
    const t = run([earlier, allOut]);
    const basis = ruleBasis(t, [earlier, allOut], bar.id, 'Pacific/Auckland');
    expect(basis?.sessionId).toBe(earlier.sessionId);
    const mixed = hist(15, [{ load: 90, reps: 8, ex: ['pain'] }, { load: 100, reps: 8 }]);
    const b2 = ruleBasis(run([mixed]), [mixed], bar.id, 'Pacific/Auckland');
    expect(b2?.sets.map((s) => s.exclusions ?? [])).toEqual([['pain'], []]);
  });
});

describe('history, Last, summary and records', () => {
  const bar = barbell();
  const BENCH: Exercise = exercise(220, 'Bench press');

  function workout(eq: EquipmentInstance, n: number, startS: number, prefix: string): SessionAggregate {
    const owner = profile();
    const ids = idGen(70_000 + startS);
    let s = startWorkout({ opId: `${prefix}-start`, owner, gymId: GYM, routine: null, exercises: new Map(), gymEquipment: [eq], at: at(startS), newId: ids }).aggregate;
    s = apply(s, buildAddExerciseCommand({ opId: `${prefix}-add`, owner, exercise: BENCH, equipmentId: eq.id, at: at(startS + 1), newId: ids }));
    const sx = s.exercises[0]?.id ?? '';
    for (let i = 1; i < n; i += 1) s = apply(s, { type: 'add_set', at: at(startS + 1), opId: `${prefix}-set-${String(i)}`, sessionExerciseId: sx, newSetId: ids(), setType: null });
    return s;
  }
  function logAll(s: SessionAggregate, vals: SetValues[], startS: number): SessionAggregate {
    let out = s;
    vals.forEach((v, i) => {
      const setId = out.session.activeSetId;
      if (setId === null) throw new Error('no active set');
      out = apply(out, logCmd(setId, v, startS + 10 + i * 120, `log-${setId}-${String(i)}`));
    });
    return out;
  }
  function markNth(s: SessionAggregate, i: number, xs: SetExclusion[], seconds: number): SessionAggregate {
    const set = [...s.sets].sort((a, b) => a.index - b.index)[i];
    if (!set) throw new Error('no set');
    return apply(s, { type: 'correct_set', at: at(seconds), opId: `mark-${set.id}`, setId: set.id, expectedSetVersion: set.version, patch: { exclusions: xs } });
  }
  const finish = (s: SessionAggregate, atS: number) => apply(s, { type: 'finish', at: at(atS), opId: `fin-${s.session.id}`, expectedVersion: s.session.version, endedAt: null });
  const summaryInput = (s: SessionAggregate, history: HistorySession[]): SummaryInput => ({
    aggregate: s,
    nowMs: ms(100_000),
    gymName: 'Main Gym',
    history: { [BENCH.id]: [...history, ...toHistorySessions(s, BENCH.id)] },
    rules: {},
    painFlags: [],
    checkIn: null,
    coach: 'not_connected',
  });

  it('toHistorySessions carries the flags; volume still counts the set (AW8)', () => {
    const s = finish(markNth(logAll(workout(bar, 2, 0, 'a'), [values(kg(100), 8), values(kg(100), 8)], 0), 1, ['spotted'], 400), 500);
    const h = toHistorySessions(s, BENCH.id)[0];
    expect(h?.sets.map((x) => x.exclusions ?? null)).toEqual([null, ['spotted']]);
    expect(summariseVolume(s)[0]?.sets).toBe(2);
  });

  it('`Last (date)` shows a flagged set with its words, and still copies its values', () => {
    const prev = finish(markNth(logAll(workout(bar, 1, 0, 'p'), [values(kg(100), 8)], 0), 0, ['spotted'], 300), 400);
    const today = workout(bar, 1, 86_400, 't');
    const previous = lastComparableSession(toHistorySessions(prev, BENCH.id), today.exercises[0] as SessionAggregate['exercises'][number]);
    const view = buildActiveSetView({ aggregate: today, nowMs: ms(86_500), gymName: null, previous: { [today.exercises[0]?.id ?? '']: previous }, painFlagged: new Set(), edits: null });
    expect(plain(view.focus?.previous?.text)).toBe('100 kg × 8 · spotted');
    expect(view.focus?.previous?.values.load).toEqual(kg(100));
  });

  it('done rows, the just-saved line and the correction sheet show the flags', () => {
    const s = markNth(logAll(workout(bar, 2, 0, 'r'), [values(kg(100), 8)], 0), 0, ['spotted'], 200);
    const view = buildActiveSetView({ aggregate: s, nowMs: ms(250), gymName: null, previous: {}, painFlagged: new Set(), edits: null });
    const row = view.focus?.rows[0];
    expect(row).toMatchObject({ exclusions: ['spotted'], exclusionTag: 'Spotted', notCounted: 'Spotted · not counted' });
    expect(view.focus?.rows[1]?.exclusionTag).toBeNull();
    expect(plain(view.justSaved?.text)).toBe('100 kg × 8 · spotted');
    const doneId = row?.setId ?? '';
    const edit = buildSetEditView(s, doneId, null);
    expect(edit).toMatchObject({ exclusions: ['spotted'], changed: false, painLine: null });
    const withPain = buildSetEditView(s, doneId, null, ['pain', 'spotted']);
    expect(withPain).toMatchObject({ exclusions: ['spotted', 'pain'], changed: true, painLine: exclusionPainLine('Bench press') });
    expect(exclusionFields({ status: 'pending', exclusions: ['spotted'] }).exclusions).toEqual([]);
  });

  it('the summary compares the best unflagged set and lists flagged ones with their words', () => {
    const last = finish(logAll(workout(bar, 2, 0, 'l'), [values(kg(95), 8), values(kg(95), 8)], 0), 400);
    const today = finish(markNth(logAll(workout(bar, 2, 86_400, 'd'), [values(kg(110), 3), values(kg(100), 8)], 86_400), 0, ['spotted'], 87_000), 87_100);
    const sum = buildWorkoutSummary(summaryInput(today, toHistorySessions(last, BENCH.id)));
    expect(sum.comparison).toMatchObject({ kind: 'compared' });
    if (sum.comparison?.kind === 'compared') expect(plain(sum.comparison.todayText)).toBe('100 kg × 8');
    expect(plain(sum.exercises[0]?.results)).toContain('· spotted');
    expect(sum.facts.workingSets).toBe(2);
  });

  it('Not compared when today’s only top set was spotted', () => {
    const last = finish(logAll(workout(bar, 1, 0, 'l2'), [values(kg(95), 8)], 0), 400);
    const today = finish(markNth(logAll(workout(bar, 1, 86_400, 'd2'), [values(kg(110), 3)], 86_400), 0, ['spotted'], 87_000), 87_100);
    const sum = buildWorkoutSummary(summaryInput(today, toHistorySessions(last, BENCH.id)));
    expect(sum.comparison).toEqual({ kind: 'not_comparable', text: 'Not compared: the only top set was spotted.' });
  });

  it('a flagged set is never a record (summary highlight), today or before', () => {
    const before = finish(logAll(workout(bar, 1, 0, 'b'), [values(kg(100), 6)], 0), 400);
    const spottedToday = finish(markNth(logAll(workout(bar, 1, 86_400, 'h'), [values(kg(110), 3)], 86_400), 0, ['spotted'], 87_000), 87_100);
    expect(summaryHighlight(spottedToday, { [BENCH.id]: toHistorySessions(before, BENCH.id) })).toBeNull();
    const spottedBefore = finish(markNth(logAll(workout(bar, 1, 0, 'b2'), [values(kg(120), 3)], 0), 0, ['spotted'], 300), 400);
    const today = finish(logAll(workout(bar, 1, 86_400, 'h2'), [values(kg(105), 3)], 86_400), 87_100);
    const hist = [...toHistorySessions(spottedBefore, BENCH.id), ...toHistorySessions(before, BENCH.id)];
    expect(plain(summaryHighlight(today, { [BENCH.id]: hist }))).toBe('Heaviest Bench press set on Olympic bar: 105 kg × 3');
  });
});

describe('planExclusionMark (correction sheet save, AW7)', () => {
  const base = { setNumber: 2, exerciseName: 'Bench press', painFlagActive: false };

  it('ticking Pain sets the movement’s flag only when none is active', () => {
    expect(planExclusionMark({ ...base, prior: [], next: ['pain'] })).toEqual({
      prior: [],
      next: ['pain'],
      setsPainFlag: true,
      toast: 'Set 2: pain · not counted for records · pain flag on Bench press',
    });
    expect(planExclusionMark({ ...base, painFlagActive: true, prior: [], next: ['pain'] }).setsPainFlag).toBe(false);
    // Already marked Pain: saving again sets nothing new.
    expect(planExclusionMark({ ...base, prior: ['pain'], next: ['pain', 'spotted'] }).setsPainFlag).toBe(false);
  });

  it('unticking Pain never clears the movement flag; a patch without exclusions keeps them', () => {
    expect(planExclusionMark({ ...base, prior: ['pain'], next: [] })).toMatchObject({ setsPainFlag: false, toast: 'Set 2 counts for records again' });
    expect(planExclusionMark({ ...base, prior: ['spotted'], next: undefined })).toMatchObject({ next: ['spotted'], toast: null });
  });
});
