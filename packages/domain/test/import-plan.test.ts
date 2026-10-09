import { describe, expect, it } from 'vitest';
import { SessionAggregateSchema, validate, type ImportAnswers } from '@fizz/schemas';
import {
  aliasesToSave,
  analyseImport,
  anchorUtcFor,
  buildImportedSession,
  customExerciseIdFor,
  DEFAULT_ANSWERS,
  importIds,
  importResultsCsv,
  nameKey,
  newExercisesToCreate,
  parseFitNotesCsv,
  planImportRows,
  toHistorySessions,
  type ImportContext,
} from '../src';
import { OWNER } from './fixtures';
import { CANDIDATES, fixture, idOf } from './import-fixtures';

/** The import preview, answers and plan (data-import-export §2.5, checks 17–22). */
const TODAY = '2026-10-09';
const JOB = '00000000-0000-4000-8000-00000000j0b1'.replace('j', 'a');
const OP = 'commit-op-1';

const ctx = (over: Partial<ImportContext> = {}): ImportContext => ({
  ownerId: OWNER,
  candidates: CANDIDATES,
  aliases: new Map(),
  appDates: new Set(),
  importedDates: new Map(),
  defaultUnit: 'kg',
  ...over,
});
const parsed = (textOrFile: string) => {
  const p = parseFitNotesCsv(textOrFile.endsWith('.csv') ? fixture(textOrFile) : textOrFile, TODAY);
  if (!p.ok) throw new Error('not parsed');
  return p;
};
const answers = (over: Partial<ImportAnswers> = {}): ImportAnswers => ({ ...DEFAULT_ANSWERS, ...over });
const useSuggestions = (a: ReturnType<typeof analyseImport>): ImportAnswers['names'] =>
  Object.fromEntries(a.names.filter((n) => n.needsAnswer && n.match.exerciseId).map((n) => [n.key, { kind: 'exercise' as const, exerciseId: n.match.exerciseId ?? '' }]));
const A1 = 'Date,Exercise,Category,Weight (kgs),Reps,Distance,Distance Unit,Time\n';

describe('import preview: questions before anything is saved', () => {
  it('asks about names first, then each load convention, with nothing pre-selected (DX6, check 17)', () => {
    const p = parsed('A1-kg.synthetic.csv');
    const first = analyseImport(p, ctx(), DEFAULT_ANSWERS);
    expect(first.names.map((n) => [n.name, n.match.status, n.needsAnswer])).toEqual([
      ['Flat Barbell Bench Press', 'check', true],
      ['Incline DB Press', 'check', true],
      ['Lat Pulldown (Pulley)', 'check', true],
      ['Pull Up', 'check', true],
    ]);
    expect(first.questionsOpen).toBe(1);
    expect(first.ready).toBe(false);
    expect(first.counts).toMatchObject({ workouts: 2, sets: 5 });
    expect(first.counts.byResult).toMatchObject({ pending: 5, skipped_cardio: 1, skipped_unsupported: 1 });

    const named = analyseImport(p, ctx(), answers({ names: useSuggestions(first) }));
    expect(named.perHand).toMatchObject({ answer: null, open: true, example: { name: 'Incline DB Press', value: 22.5, unit: 'kg', reps: 10 } });
    expect(named.total).toMatchObject({ answer: null, open: true, barWeight: { kg: 20, lb: 45 }, unitsUsed: ['kg'] });
    expect(named.bodyweight).toEqual([]); // Pull-up rows are all 0: nothing to ask
    expect(named.machines).toEqual([{ key: 'lat pulldown (pulley)', name: 'Lat Pulldown (Pulley)', exerciseName: 'Lat pulldown', convention: 'stack' }]);
    expect(named.questionsOpen).toBe(2);
    expect(named.ready).toBe(false);

    const done = analyseImport(p, ctx(), answers({ names: useSuggestions(first), perHand: 'both', total: 'total' }));
    expect(done.questionsOpen).toBe(0);
    expect(done.ready).toBe(true);
    expect(done.fates.map((f) => (f.result === 'imported' ? [f.set.exerciseName, f.set.load] : f.result))).toEqual([
      ['Bench press', { value: 60, unit: 'kg', convention: 'total' }],
      ['Bench press', { value: 80, unit: 'kg', convention: 'total' }],
      ['Incline dumbbell press', { value: 11.25, unit: 'kg', convention: 'per_hand' }],
      ['Pull-up', null],
      ['Lat pulldown', { value: 45, unit: 'kg', convention: 'stack' }],
      'skipped_cardio',
      'skipped_unsupported',
    ]);
    expect(done.counts).toMatchObject({ workouts: 2, sets: 5, exercises: 4 });
    expect(done.workouts).toEqual([
      { date: '2026-09-30', exercises: 1, sets: 1 },
      { date: '2026-09-28', exercises: 3, sets: 4 },
    ]);
  });

  it('"Both dumbbells together" halves the value; "Each dumbbell" keeps it; per-exercise overrides win (check 18)', () => {
    const p = parsed(`${A1}2026-10-01,Incline DB Press,Chest,22.5,10,,,\n2026-10-01,Dumbbell Curl,Biceps,15,12,,,\n`);
    const names = { [nameKey('Incline DB Press')]: { kind: 'exercise' as const, exerciseId: idOf('Incline dumbbell press') } };
    const both = analyseImport(p, ctx(), answers({ names, perHand: 'both' }));
    const each = analyseImport(p, ctx(), answers({ names, perHand: 'each', perHandOverrides: { [nameKey('Dumbbell Curl')]: 'both' } }));
    const loads = (a: ReturnType<typeof analyseImport>) => a.fates.map((f) => (f.result === 'imported' ? f.set.load?.value : null));
    expect(loads(both)).toEqual([11.25, 7.5]);
    expect(loads(each)).toEqual([22.5, 7.5]);
  });

  it('"Plates only" adds the bar weight in the row’s own unit; lb stays lb (check 19)', () => {
    const p = parsed('A1-lb.synthetic.csv');
    const first = analyseImport(p, ctx(), DEFAULT_ANSWERS);
    const a = analyseImport(p, ctx(), answers({ names: useSuggestions(first), total: 'plates_only', perHand: 'each' }));
    expect(a.ready).toBe(true);
    expect(a.total?.unitsUsed).toEqual(['lb']);
    expect(a.fates.map((f) => (f.result === 'imported' ? f.set.load : null))).toEqual([
      { value: 140, unit: 'lb', convention: 'total' },
      { value: 200, unit: 'lb', convention: 'total' },
      { value: 25, unit: 'lb', convention: 'per_hand' },
      { value: 220, unit: 'lb', convention: 'total' },
    ]);
    const kgBar = analyseImport(parsed(`${A1}2026-10-01,Bench press,Chest,60,5,,,\n`), ctx(), answers({ total: 'plates_only', barWeight: { kg: 15, lb: 45 } }));
    expect(kgBar.fates[0]).toMatchObject({ result: 'imported', set: { load: { value: 75, unit: 'kg' } } });
  });

  it('bodyweight exercises with a weight: asked per exercise with the range; added, or assistance (negatives read as assistance)', () => {
    const p = parsed(`${A1}2026-10-01,Pull-up,Back,0,10,,,\n2026-10-02,Pull-up,Back,10,6,,,\n2026-10-03,Pull-up,Back,-20,8,,,\n2026-10-03,Push-up,Chest,0,20,,,\n`);
    const a = analyseImport(p, ctx(), DEFAULT_ANSWERS);
    expect(a.bodyweight).toEqual([{ key: 'pull-up', name: 'Pull-up', exerciseName: 'Pull-up', sets: 3, min: -20, max: 10, answer: null }]);
    expect(a.questionsOpen).toBe(1);
    const added = analyseImport(p, ctx(), answers({ bodyweight: { 'pull-up': 'added' } }));
    expect(added.fates.map((f) => (f.result === 'imported' ? f.set.load : f.result === 'pending' ? 'pending' : f.detail))).toEqual([
      { value: 0, unit: 'kg', convention: 'added' },
      { value: 10, unit: 'kg', convention: 'added' },
      'Negative weight (-20), but you said weight is added',
      null,
    ]);
    const assist = analyseImport(p, ctx(), answers({ bodyweight: { 'pull-up': 'assistance' } }));
    expect(assist.fates.map((f) => (f.result === 'imported' ? [f.set.convention, f.set.load?.value ?? null] : f.result))).toEqual([
      ['assistance', 0],
      ['assistance', 10],
      ['assistance', 20],
      ['bodyweight', null],
    ]);
  });

  it('negative weights elsewhere are unreadable, never guessed', () => {
    const a = analyseImport(parsed(`${A1}2026-10-01,Lat pulldown,Back,-5,10,,,\n`), ctx(), DEFAULT_ANSWERS);
    expect(a.fates[0]).toEqual({ result: 'unreadable', detail: 'Negative weight (-5) on an exercise that doesn’t use assistance' });
  });

  it('FitNotes 2 rows with both weight columns ask once which one was entered; the other is kept as written', () => {
    const p = parsed('C.synthetic.csv');
    const first = analyseImport(p, ctx(), DEFAULT_ANSWERS);
    expect(first.unit).toEqual({ rows: 1, answer: null });
    const base = { names: useSuggestions(first), total: 'total' as const, perHand: 'each' as const };
    const lb = analyseImport(p, ctx(), answers({ ...base, bothColumns: 'lb' }));
    expect(lb.ready).toBe(true);
    expect(lb.fates[4]).toMatchObject({ result: 'imported', set: { load: { value: 220.46, unit: 'lb', convention: 'total' } } });
    const kg = analyseImport(p, ctx(), answers({ ...base, bothColumns: 'kg' }));
    expect(kg.fates[4]).toMatchObject({ result: 'imported', set: { load: { value: 100, unit: 'kg' } } });
    expect(kg.units).toEqual({ kg: 1, lb: 1 });
  });

  it('dates with a workout in the app are skipped by default and listed; "Import them as extra workouts" imports them (check 22)', () => {
    const p = parsed(`${A1}2026-10-01,Lat pulldown,Back,40,10,,,\n2026-10-02,Lat pulldown,Back,45,10,,,\n`);
    const skip = analyseImport(p, ctx({ appDates: new Set(['2026-10-02']) }), DEFAULT_ANSWERS);
    expect(skip.appDates).toEqual({ count: 1, newest: '2026-10-02' });
    expect(skip.fates[1]).toEqual({ result: 'skipped_date_exists', detail: 'This date already has a workout in the app' });
    expect(skip.counts.workouts).toBe(1);
    const extra = analyseImport(p, ctx({ appDates: new Set(['2026-10-02']) }), answers({ existingDates: 'import' }));
    expect(extra.counts.workouts).toBe(2);
  });

  it('dates that came in with an earlier import are always skipped, and the earlier import is named (check 21)', () => {
    const p = parsed(`${A1}2026-10-01,Lat pulldown,Back,40,10,,,\n2026-10-02,Lat pulldown,Back,45,10,,,\n`);
    const earlier = { jobId: '00000000-0000-4000-8000-0000000000e1', fileName: 'FitNotes_Export_old.csv', startedAtUtc: '2026-10-08T18:00:00.000Z', tz: 'Europe/London' };
    const a = analyseImport(p, ctx({ importedDates: new Map([['2026-10-01', earlier]]) }), answers({ existingDates: 'import' }));
    expect(a.fates[0]).toEqual({ result: 'skipped_duplicate', detail: 'Came in with an earlier import (FitNotes_Export_old.csv)' });
    expect(a.alreadyImported).toEqual({ dates: 1, imports: [{ ...earlier, dates: 1 }] });
    expect(a.counts.workouts).toBe(1);
  });

  it('RPE comes only from rows Ben ticked; every comment is kept either way (check 20)', () => {
    const p = parsed('A2-kg.synthetic.csv');
    const base = { names: useSuggestions(analyseImport(p, ctx(), DEFAULT_ANSWERS)), total: 'total' as const, bodyweight: { 'pull up': 'added' as const } };
    const notes = analyseImport(p, ctx(), answers(base));
    expect(notes.effort.candidates.map((c) => [c.row, c.rpe, c.checked])).toEqual([
      [2, 8, false],
      [3, 9, false],
    ]);
    expect(notes.comments).toBe(3);
    expect(notes.fates.every((f) => f.result !== 'imported' || f.set.rpe === null)).toBe(true);
    const reviewed = analyseImport(p, ctx(), answers({ ...base, effort: { mode: 'review', rows: [2] } }));
    expect(reviewed.fates.map((f) => (f.result === 'imported' ? f.set.rpe : 'x'))).toEqual([8, null, null, null]);
  });

  it('Skip leaves an exercise out and the counts drop', () => {
    const p = parsed(`${A1}2026-10-01,Lat pulldown,Back,40,10,,,\n2026-10-01,Mystery Machine,Back,45,10,,,\n`);
    const open = analyseImport(p, ctx(), DEFAULT_ANSWERS);
    expect(open.names.find((n) => n.name === 'Mystery Machine')).toMatchObject({ needsAnswer: true, match: { status: 'no_match' } });
    expect(open.counts.sets).toBe(2);
    const skipped = analyseImport(p, ctx(), answers({ names: { 'mystery machine': { kind: 'skip' } } }));
    expect(skipped.counts.sets).toBe(1);
    expect(skipped.fates[1]).toEqual({ result: 'skipped_exercise', detail: 'You chose Skip for this exercise' });
    expect(skipped.ready).toBe(true);
    expect(aliasesToSave(skipped)).toEqual([{ key: 'mystery machine', name: 'Mystery Machine', target: { kind: 'skip' } }]);
  });

  it('Add new makes one custom exercise per name, with the convention of the equipment Ben picked', () => {
    const p = parsed(`${A1}2026-10-01,Hammer Strength Row,Back,40,10,,,\n2026-10-02,Hammer Strength Row,Back,50,8,,,\n`);
    const a = analyseImport(p, ctx(), answers({ names: { 'hammer strength row': { kind: 'new', equipment: 'plate_loaded_machine' } } }));
    const id = customExerciseIdFor(OWNER, 'hammer strength row');
    expect(a.ready).toBe(true);
    expect(a.fates[0]).toMatchObject({ result: 'imported', set: { exerciseId: id, exerciseName: 'Hammer Strength Row', convention: 'added', load: { value: 40, convention: 'added' } } });
    expect(newExercisesToCreate(a)).toEqual([{ exerciseId: id, name: 'Hammer Strength Row', laterality: 'bilateral', convention: 'added', newKind: 'plate_loaded_machine' }]);
    expect(aliasesToSave(a)).toEqual([{ key: 'hammer strength row', name: 'Hammer Strength Row', target: { kind: 'exercise', exerciseId: id } }]);
  });

  it('a file with nothing importable is never ready', () => {
    const a = analyseImport(parsed(`${A1}2026-10-01,Treadmill,Cardio,,,5,km,0:25:00\n`), ctx(), DEFAULT_ANSWERS);
    expect(a.questionsOpen).toBe(0);
    expect(a.ready).toBe(false);
  });
});

describe('import plan: frozen rows and imported workouts', () => {
  const plan = () => {
    const p = parsed('B1.synthetic.csv');
    const first = analyseImport(p, ctx(), DEFAULT_ANSWERS);
    const a = analyseImport(p, ctx(), answers({ names: useSuggestions(first), total: 'total', perHand: 'each' }));
    return { p, a, rows: planImportRows(p, a, { jobId: JOB, defaultUnit: 'kg' }) };
  };

  it('keeps every source row; imported rows get stable IDs; mixed units stay separate, never converted', () => {
    const { rows } = plan();
    expect(rows.map((r) => [r.row, r.result, r.imported?.unit ?? null, r.imported?.exerciseOrder ?? null, r.imported?.setIndex ?? null])).toEqual([
      [2, 'imported', 'kg', 0, 0],
      [3, 'imported', 'lb', 1, 0],
      [4, 'imported', 'kg', 2, 0],
      [5, 'unreadable', null, null, null],
    ]);
    expect(rows[3]).toMatchObject({ detail: 'Weight unit isn’t kg or lb (stone)', cells: ['2026-10-02', 'Leg Press', 'Legs', '150.0', 'stone', '10', '', '', ''], sessionId: null });
    expect(rows[0]?.setId).toBe(importIds.set(JOB, 2));
    expect(rows[0]?.sessionId).toBe(importIds.session(JOB, '2026-10-02'));
    expect(plan().rows).toEqual(rows);
  });

  it('refuses to plan while a question is open', () => {
    const p = parsed('B1.synthetic.csv');
    expect(() => planImportRows(p, analyseImport(p, ctx(), DEFAULT_ANSWERS), { jobId: JOB, defaultUnit: 'kg' })).toThrow('still has questions');
  });

  it('builds a valid, finished, date-only workout from the rows', () => {
    const { rows } = plan();
    const agg = buildImportedSession({ ownerId: OWNER, jobId: JOB, operationId: OP, tz: 'Europe/London', gymId: null, importedAtUtc: '2026-10-09T10:00:00.000Z', date: '2026-10-02', rows });
    expect(validate(SessionAggregateSchema, agg).ok).toBe(true);
    expect(agg.session).toMatchObject({
      status: 'finished',
      source: 'import',
      importJobId: JOB,
      localDate: '2026-10-02',
      gymId: null,
      endedAt: null,
      startOperationId: `${OP}:2026-10-02`,
      startedAt: { utc: '2026-10-02T11:00:00.000Z', tz: 'Europe/London' },
    });
    expect(agg.exercises.map((e) => [e.exerciseName, e.unit, e.loadConvention, e.equipmentId])).toEqual([
      ['Bench press', 'kg', 'total', null],
      ['Dumbbell curl', 'lb', 'per_hand', null],
      ['Leg press', 'kg', 'added', null],
    ]);
    expect(agg.sets.map((s) => [s.status, s.setType, s.actual?.load?.value, s.actual?.reps])).toEqual([
      ['completed', 'working', 100, 5],
      ['completed', 'working', 30, 10],
      ['completed', 'working', 140, 10],
    ]);
    expect(agg.audit.map((e) => [e.kind, e.atUtc])).toEqual([
      ['logged', '2026-10-09T10:00:00.000Z'],
      ['logged', '2026-10-09T10:00:00.000Z'],
      ['logged', '2026-10-09T10:00:00.000Z'],
    ]);
    const history = toHistorySessions(agg, idOf('Bench press'));
    expect(history).toEqual([{ sessionId: agg.session.id, performedAtUtc: '2026-10-02T11:00:00.000Z', equipmentId: null, sets: [{ setType: 'working', side: null, load: { value: 100, unit: 'kg', convention: 'total' }, reps: 5, rpe: null, rir: null }] }]);
  });

  it('the ordering anchor is noon local on the date, across a clock change', () => {
    expect(anchorUtcFor('2026-03-29', 'Europe/London')).toBe('2026-03-29T11:00:00.000Z');
    expect(anchorUtcFor('2026-01-15', 'Pacific/Auckland')).toBe('2026-01-14T23:00:00.000Z');
  });

  it('row-by-row results CSV quotes values and defuses formula-like text (rule 8)', () => {
    const { rows } = plan();
    const evil = { ...rows[3], exerciseName: '=HYPERLINK("x")', row: 6 } as (typeof rows)[number];
    const csv = importResultsCsv([...rows, evil]);
    expect(csv.split('\r\n')).toEqual([
      'row,date,exercise,result,detail',
      '2,2026-10-02,Flat Barbell Bench Press,imported,',
      '3,2026-10-02,Dumbbell Curl,imported,',
      '4,2026-10-02,Leg Press,imported,',
      '5,2026-10-02,Leg Press,unreadable,Weight unit isn’t kg or lb (stone)',
      '6,2026-10-02,"\'=HYPERLINK(""x"")",unreadable,Weight unit isn’t kg or lb (stone)',
      '',
    ]);
  });
});
