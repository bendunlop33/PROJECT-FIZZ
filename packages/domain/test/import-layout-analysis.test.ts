import { describe, expect, it } from 'vitest';
import type { ImportAnswers } from '@fizz/schemas';
import { analyseImport, applyAnswerChange, applyImportSpec, buildImportedSession, DEFAULT_ANSWERS, nameKey, planImportRows, type ImportContext, type SourceSetRow } from '../src';
import { OWNER } from './fixtures';
import { CANDIDATES, idOf } from './import-fixtures';
import { OPTS, answerAll, specOf, tableOf } from './layout-fixtures';

/** Layout rows through the FitNotes pipeline, unchanged from `analyseImport` on (§9.2.6; checks 47, 52). */
const JOB = '00000000-0000-4000-8000-00000000a0b2';
const ctx = (over: Partial<ImportContext> = {}): ImportContext => ({ ownerId: OWNER, candidates: CANDIDATES, aliases: new Map(), appDates: new Set(), importedDates: new Map(), defaultUnit: 'kg', ...over });
const rowsOf = (name: string, over = {}): SourceSetRow[] => applyImportSpec(specOf(`${name}.spec.json`), answerAll(name, over).answers, tableOf(`${name}.synthetic.csv`), OPTS).rows;
const input = (rows: SourceSetRow[]) => ({ variant: null, rows });
/** Ben's answer for each dumbbell exercise on its own: a suggested match gives the exercise only, never its dumbbell count (ADR 0016 r5). */
const eachFor = (...names: string[]): ImportAnswers['perHandOverrides'] => Object.fromEntries(names.map((n) => [nameKey(n), 'each' as const]));
const useSuggestions = (a: ReturnType<typeof analyseImport>): ImportAnswers['names'] =>
  Object.fromEntries(a.names.filter((n) => n.needsAnswer && n.match.exerciseId).map((n) => [n.key, { kind: 'exercise' as const, exerciseId: n.match.exerciseId ?? '' }]));

describe('Strong (new)', () => {
  const rows = rowsOf('strong-new-kg');

  it('names are matched or asked as for FitNotes; dumbbell and bar questions follow (checks 17–18)', () => {
    const first = analyseImport(input(rows), ctx(), DEFAULT_ANSWERS);
    expect(first.variant).toBeNull();
    expect(first.names.map((n) => [n.name, n.match.status])).toEqual([
      ['Squat (Barbell)', 'check'],
      ['Bench Press (Barbell)', 'check'],
      ['Incline Bench Press (Dumbbell)', 'check'],
    ]);
    const named = analyseImport(input(rows), ctx(), { ...DEFAULT_ANSWERS, names: useSuggestions(first) });
    // A suggested match gives the exercise only: its dumbbell count is asked on its own, nothing selected.
    expect(named.perHand?.exercises.map((e) => [e.name, e.implements, e.reading])).toEqual([['Incline Bench Press (Dumbbell)', null, null]]);
    expect(named.perHand?.needsCount).toBe(1);
    expect(named.total?.exercises.map((e) => e.name)).toEqual(['Bench Press (Barbell)', 'Squat (Barbell)']);
    expect(named.ready).toBe(false);
  });

  it('two Strong workouts on one date are two workouts (check 52); the rowing row is listed, not imported', () => {
    const first = analyseImport(input(rows), ctx(), DEFAULT_ANSWERS);
    const a = analyseImport(input(rows), ctx(), { ...DEFAULT_ANSWERS, names: useSuggestions(first), perHandOverrides: eachFor('Incline Bench Press (Dumbbell)'), total: 'total' });
    expect(a.ready).toBe(true);
    expect(a.counts.workouts).toBe(4);
    expect(a.workouts.filter((w) => w.date === '2025-03-04').map((w) => w.startLocal)).toEqual(['07:10', '18:02']);
    expect(a.counts.byResult).toMatchObject({ imported: 14, skipped_unsupported: 1 });
  });

  it('warm-up and drop markers give the set type; RPE comes from its column', () => {
    const first = analyseImport(input(rows), ctx(), DEFAULT_ANSWERS);
    const a = analyseImport(input(rows), ctx(), { ...DEFAULT_ANSWERS, names: useSuggestions(first), perHandOverrides: eachFor('Incline Bench Press (Dumbbell)'), total: 'total' });
    const fate = (line: number) => a.fates[rows.findIndex((r) => r.line === line)];
    expect(fate(2)).toMatchObject({ result: 'imported', set: { setType: 'warmup', reps: 10 } });
    expect(fate(9)).toMatchObject({ result: 'imported', set: { setType: 'drop' } });
    expect(fate(3)).toMatchObject({ result: 'imported', set: { rpe: 8 } });
    expect(fate(4)).toMatchObject({ result: 'imported', set: { rpe: 8.5 } });
    const plain = fate(5);
    expect(plain?.result === 'imported' ? plain.set.setType : 'not imported').toBeUndefined();
  });

  it('each Strong workout is its own session, with sessions and sets in file order', () => {
    const first = analyseImport(input(rows), ctx(), DEFAULT_ANSWERS);
    const a = analyseImport(input(rows), ctx(), { ...DEFAULT_ANSWERS, names: useSuggestions(first), perHandOverrides: eachFor('Incline Bench Press (Dumbbell)'), total: 'total' });
    const planned = planImportRows({ rows }, a, { jobId: JOB, defaultUnit: 'kg' });
    const sessions = new Set(planned.filter((r) => r.result === 'imported' && r.localDate === '2025-03-04').map((r) => r.sessionId));
    expect(sessions.size).toBe(2);
    const evening = planned.find((r) => r.line === 7);
    expect(evening).toMatchObject({ part: 0, startLocal: '18:02' });
    const agg = buildImportedSession({
      ownerId: OWNER,
      jobId: JOB,
      operationId: 'op-1',
      tz: 'Europe/London',
      gymId: null,
      importedAtUtc: '2026-10-12T09:00:00.000Z',
      date: '2025-03-04',
      workoutKey: evening?.workoutKey ?? '',
      startLocal: '18:02',
      rows: planned,
    });
    expect(agg.session.startedAt).toEqual({ utc: '2025-03-04T18:02:00.000Z', tz: 'Europe/London' });
    expect(agg.session.localDate).toBe('2025-03-04');
    expect(agg.session.startOperationId).toBe(`op-1:${evening?.workoutKey ?? ''}`);
    expect(agg.sets.map((s) => [s.setType, s.actual?.load?.value, s.actual?.reps])).toEqual([
      ['working', 100, 5],
      ['working', 100, 5],
      ['drop', 80, 8],
    ]);
  });
});

describe('Hevy (check 47)', () => {
  it('kg and lb files keep their numbers and units as written', () => {
    const kg = rowsOf('hevy-kg');
    const lb = rowsOf('hevy-lbs');
    expect(kg.find((r) => r.line === 3)?.weight).toEqual({ value: 80, unit: 'kg' });
    expect(lb.find((r) => r.line === 3)?.weight).toEqual({ value: 185, unit: 'lb' });
  });

  it('dumbbells: per hand, both together or each is asked; both halves the value', () => {
    const rows = rowsOf('hevy-kg');
    const first = analyseImport(input(rows), ctx(), DEFAULT_ANSWERS);
    const names = useSuggestions(first);
    const asked = analyseImport(input(rows), ctx(), { ...DEFAULT_ANSWERS, names, total: 'total' });
    expect(asked.perHand?.open).toBe(true);
    const both = analyseImport(input(rows), ctx(), { ...DEFAULT_ANSWERS, names, total: 'total', perHandOverrides: { [nameKey('Incline Bench Press (Dumbbell)')]: 'both', [nameKey('Bicep Curl (Dumbbell)')]: 'each' } });
    const incline = both.fates[rows.findIndex((r) => r.line === 5)];
    expect(incline).toMatchObject({ result: 'imported', set: { load: { value: 12, unit: 'kg', convention: 'per_hand' } } });
    const each = analyseImport(input(rows), ctx(), { ...DEFAULT_ANSWERS, names, total: 'total', perHandOverrides: eachFor('Incline Bench Press (Dumbbell)', 'Bicep Curl (Dumbbell)') });
    expect(each.fates[rows.findIndex((r) => r.line === 5)]).toMatchObject({ result: 'imported', set: { load: { value: 24, unit: 'kg', convention: 'per_hand' } } });
  });

  it('`Pull Up (Assisted)` reads as assistance; an unmarked custom name is asked', () => {
    const rows = rowsOf('hevy-assisted');
    const first = analyseImport(input(rows), ctx(), DEFAULT_ANSWERS);
    expect(first.names.map((n) => [n.name, n.match.status, n.needsAnswer])).toEqual([
      ['Gravitron Thing', 'no_match', true],
      ['Pull Up (Assisted)', 'check', true],
    ]);
    const a = analyseImport(input(rows), ctx(), { ...DEFAULT_ANSWERS, names: { ...useSuggestions(first), [nameKey('Gravitron Thing')]: { kind: 'skip' } } });
    expect(a.ready).toBe(true);
    expect(a.fates[0]).toMatchObject({ result: 'imported', set: { exerciseId: idOf('Assisted pull-up'), load: { value: 20, unit: 'kg', convention: 'assistance' } } });
    expect(a.fates[2]).toMatchObject({ result: 'skipped_exercise' });
  });
});

describe('duplicates against existing history (AI7, check 52)', () => {
  const rows = rowsOf('hevy-kg');
  const first = analyseImport(input(rows), ctx(), DEFAULT_ANSWERS);
  const ready: ImportAnswers = { ...DEFAULT_ANSWERS, names: useSuggestions(first), total: 'total', perHandOverrides: eachFor('Incline Bench Press (Dumbbell)', 'Bicep Curl (Dumbbell)') };

  it('dates from an earlier import still in effect are always skipped', () => {
    const earlier = { jobId: '00000000-0000-4000-8000-00000000e011', fileName: 'FitNotes_Export.csv', startedAtUtc: '2026-10-01T09:00:00.000Z', tz: 'Europe/London' };
    const a = analyseImport(input(rows), ctx({ importedDates: new Map([['2025-12-22', earlier]]) }), ready);
    expect(a.counts.byResult.skipped_duplicate).toBe(7);
    expect(a.alreadyImported).toEqual({ dates: 1, imports: [{ ...earlier, dates: 1 }] });
    expect(a.counts.workouts).toBe(2);
  });

  it('dates with a workout logged in the app default to skip; Ben can import them', () => {
    const skip = analyseImport(input(rows), ctx({ appDates: new Set(['2025-12-24']) }), ready);
    // Two squat sets; the treadmill row on that date is cardio, listed as such.
    expect(skip.counts.byResult.skipped_date_exists).toBe(2);
    const imp = analyseImport(input(rows), ctx({ appDates: new Set(['2025-12-24']) }), applyAnswerChange(ready, { kind: 'existing_dates', answer: 'import' }));
    expect(imp.counts.byResult.skipped_date_exists).toBe(0);
  });
});
