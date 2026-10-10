import { describe, expect, it } from 'vitest';
import { SessionAggregateSchema, validate, type ImportAnswers } from '@fizz/schemas';
import {
  aliasesToSave,
  analyseImport,
  anchorUtcFor,
  buildImportedSession,
  customExerciseIdFor,
  isImportMadeExercise,
  legacyCustomExerciseIdFor,
  DEFAULT_ANSWERS,
  importIds,
  importResultsCsv,
  nameKey,
  newExercisesToCreate,
  parseFitNotesCsv,
  planImportRows,
  startingAnswers,
  toHistorySessions,
  type ImportContext,
  type MatchCandidate,
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
    // `Use this` gives the exercise only: `Incline DB Press` isn't one of the incline press's own names and says neither one arm nor two, so its dumbbells are asked on their own, never by the group answer (PM decision, review r5).
    expect(named.perHand).toMatchObject({ answer: null, open: true, pairs: 0, example: null, needsGroup: false, needsCount: 1 });
    // `Flat Barbell Bench Press` names its bar: the barbell group answer reads it.
    expect(named.total).toMatchObject({ answer: null, open: true, grouped: 1, needsGroup: true, needsOwn: 0, bars: [{ bar: 'barbell', units: ['kg'], weight: { kg: 20, lb: 45 }, needed: false, missing: [] }], missingBarWeight: false });
    expect(named.bodyweight).toEqual([]); // Pull-up rows are all 0: nothing to ask
    expect(named.machines).toEqual([{ key: 'lat pulldown (pulley)', name: 'Lat Pulldown (Pulley)', exerciseName: 'Lat pulldown', convention: 'stack', sample: null, mixed: false }]);
    expect(named.questionsOpen).toBe(2);
    expect(named.ready).toBe(false);

    // The group answers alone leave the incline press waiting.
    const grouped = analyseImport(p, ctx(), answers({ names: useSuggestions(first), perHand: 'both', total: 'total' }));
    expect(grouped.ready).toBe(false);
    expect(grouped.fates[2]).toEqual({ result: 'pending', reason: 'per_hand' });
    const done = analyseImport(p, ctx(), answers({ names: useSuggestions(first), perHandOverrides: { [nameKey('Incline DB Press')]: 'both' }, total: 'total' }));
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
    // Both names are the exercises' own (a catalogue name and another name for it), so both are pairs.
    const p = parsed(`${A1}2026-10-01,Incline Dumbbell Bench Press,Chest,22.5,10,,,\n2026-10-01,Dumbbell Curl,Biceps,15,12,,,\n`);
    expect(analyseImport(p, ctx(), DEFAULT_ANSWERS).names.map((n) => n.match.status)).toEqual(['matched', 'matched']);
    const both = analyseImport(p, ctx(), answers({ perHand: 'both' }));
    const each = analyseImport(p, ctx(), answers({ perHand: 'each', perHandOverrides: { [nameKey('Dumbbell Curl')]: 'both' } }));
    const loads = (a: ReturnType<typeof analyseImport>) => a.fates.map((f) => (f.result === 'imported' ? f.set.load?.value : null));
    expect(loads(both)).toEqual([11.25, 7.5]);
    expect(loads(each)).toEqual([22.5, 7.5]);
  });

  describe('one dumbbell or two (review r3 S1)', () => {
    const loads = (a: ReturnType<typeof analyseImport>) => a.fates.map((f) => (f.result === 'imported' ? f.set.load?.value : f.result === 'pending' ? `pending:${f.reason}` : f.result));
    const rows = (a: ReturnType<typeof analyseImport>) => a.perHand?.exercises.map((e) => [e.name, e.implements, e.reading, e.sample]);
    const FILE = `${A1}2026-10-01,Dumbbell Bench Press,Chest,60,8,,,\n2026-10-01,One-Arm DB Row,Back,30,10,,,\n2026-10-01,Goblet Squats,Legs,24,10,,,\n`;
    const names = {
      [nameKey('One-Arm DB Row')]: { kind: 'exercise' as const, exerciseId: idOf('One-arm dumbbell row') },
      [nameKey('Goblet Squats')]: { kind: 'exercise' as const, exerciseId: idOf('Goblet squat') },
    };

    it('"Both dumbbells together" halves two-dumbbell exercises only: a one-arm row and a goblet squat import as written', () => {
      const p = parsed(FILE);
      const open = analyseImport(p, ctx(), answers({ names }));
      // Only the pair waits for the group answer; the one-dumbbell exercises are never asked it.
      expect(open.perHand).toMatchObject({ pairs: 1, needsGroup: true, needsCount: 0, open: true, example: { name: 'Dumbbell Bench Press', value: 60 } });
      expect(loads(open)).toEqual(['pending:per_hand', 30, 24]);
      expect(open.questionsOpen).toBe(1);

      const both = analyseImport(p, ctx(), answers({ names, perHand: 'both' }));
      expect(both.ready).toBe(true);
      expect(loads(both)).toEqual([30, 30, 24]);
      // What each exercise imports as, shown before commit.
      expect(rows(both)).toEqual([
        ['Dumbbell Bench Press', 2, 'both', { value: 60, unit: 'kg', imported: 30 }],
        ['One-Arm DB Row', 1, 'one', { value: 30, unit: 'kg', imported: 30 }],
        ['Goblet Squats', 1, 'one', { value: 24, unit: 'kg', imported: 24 }],
      ]);
      expect(loads(analyseImport(p, ctx(), answers({ names, perHand: 'each' })))).toEqual([60, 30, 24]);
      // The imported set keeps its convention and side: a one-arm row is per dumbbell, per side.
      expect(both.fates[1]).toMatchObject({ result: 'imported', set: { exerciseName: 'One-arm dumbbell row', laterality: 'unilateral', convention: 'per_hand', load: { value: 30, unit: 'kg', convention: 'per_hand' } } });
    });

    it('Ben can say a one-dumbbell exercise was done with two, and a pair exercise with one', () => {
      const p = parsed(FILE);
      const a = analyseImport(p, ctx(), answers({ names, perHand: 'both', perHandOverrides: { [nameKey('One-Arm DB Row')]: 'both', [nameKey('Dumbbell Bench Press')]: 'one' } }));
      expect(loads(a)).toEqual([60, 15, 24]);
      expect(rows(a)?.map((r) => r.slice(0, 3))).toEqual([
        ['Dumbbell Bench Press', 2, 'one'],
        ['One-Arm DB Row', 1, 'both'],
        ['Goblet Squats', 1, 'one'],
      ]);
      // Answered one by one: no pair is left waiting, so the group answer isn't needed.
      const noGroup = analyseImport(p, ctx(), answers({ names, perHandOverrides: { [nameKey('Dumbbell Bench Press')]: 'each' } }));
      expect(noGroup.perHand).toMatchObject({ needsGroup: false, open: false });
      expect(noGroup.ready).toBe(true);
    });

    it('a file with only one-dumbbell exercises needs no dumbbell answer (lb stays lb)', () => {
      const lb = 'Date,Exercise,Category,Weight (lbs),Reps,Distance,Distance Unit,Time\n';
      const a = analyseImport(parsed(`${lb}2026-10-01,One-Arm DB Row,Back,70,10,,,\n2026-10-02,One-Arm DB Row,Back,75,8,,,\n`), ctx(), answers({ names }));
      expect(a.perHand).toMatchObject({ pairs: 0, example: null, needsGroup: false, needsCount: 0, open: false });
      expect(rows(a)).toEqual([['One-Arm DB Row', 1, 'one', { value: 75, unit: 'lb', imported: 75 }]]);
      expect(a.ready).toBe(true);
      expect(a.fates.map((f) => (f.result === 'imported' ? f.set.load : null))).toEqual([
        { value: 70, unit: 'lb', convention: 'per_hand' },
        { value: 75, unit: 'lb', convention: 'per_hand' },
      ]);
    });

    it('an unmatched name added as a new dumbbell exercise is asked on its own: the group answer never applies to it', () => {
      const p = parsed(`${A1}2026-10-01,Dumbbell Bench Press,Chest,60,8,,,\n2026-10-01,Zottman Curl,Biceps,14,10,,,\n`);
      expect(analyseImport(p, ctx(), DEFAULT_ANSWERS).names.find((n) => n.name === 'Zottman Curl')?.match.status).toBe('no_match');
      const added = { [nameKey('Zottman Curl')]: { kind: 'new' as const, equipment: 'dumbbells' as const } };
      const a = analyseImport(p, ctx(), answers({ names: added, perHand: 'both' }));
      expect(loads(a)).toEqual([30, 'pending:per_hand']);
      expect(a.perHand).toMatchObject({ needsGroup: false, needsCount: 1, open: true });
      expect(rows(a)?.[1]).toEqual(['Zottman Curl', null, null, { value: 14, unit: 'kg', imported: null }]);
      expect(a.questionsOpen).toBe(1);
      expect(a.ready).toBe(false);
      const as = (reading: 'one' | 'each' | 'both') => loads(analyseImport(p, ctx(), answers({ names: added, perHand: 'both', perHandOverrides: { [nameKey('Zottman Curl')]: reading } })));
      expect(as('one')).toEqual([30, 14]);
      expect(as('each')).toEqual([30, 14]);
      expect(as('both')).toEqual([30, 7]);
    });

    it('a catalogue exercise done either way (no recorded count) is asked too', () => {
      const slRdl: MatchCandidate = {
        exerciseId: '00000000-0000-4000-8000-00000000e2b4',
        name: 'Single-leg Romanian deadlift',
        aliases: ['Single-leg RDL'],
        catalogueKey: 'dumbbell-single-leg-romanian-deadlift',
        laterality: 'unilateral',
        defaultLoadConvention: 'per_hand',
        compatibleEquipment: ['dumbbells'],
        implements: null,
      };
      const withRdl = ctx({ candidates: [...CANDIDATES, slRdl] });
      const p = parsed(`${A1}2026-10-01,Single-leg RDL,Legs,20,10,,,\n`);
      const a = analyseImport(p, withRdl, answers({ perHand: 'both' }));
      expect(a.names[0]?.match.status).toBe('matched');
      expect(a.perHand).toMatchObject({ pairs: 0, needsCount: 1, open: true });
      expect(loads(a)).toEqual(['pending:per_hand']);
      const one = analyseImport(p, withRdl, answers({ perHandOverrides: { [nameKey('Single-leg RDL')]: 'one' } }));
      expect(loads(one)).toEqual([20]);
      expect(one.ready).toBe(true);
    });
  });

  it('"Plates only" adds the bar weight in the row’s own unit; lb stays lb (check 19)', () => {
    const p = parsed('A1-lb.synthetic.csv');
    const first = analyseImport(p, ctx(), DEFAULT_ANSWERS);
    const a = analyseImport(p, ctx(), answers({ names: useSuggestions(first), total: 'plates_only', perHand: 'each' }));
    expect(a.ready).toBe(true);
    expect(a.total?.bars.map((b) => [b.bar, b.units, b.needed])).toEqual([['barbell', ['lb'], true]]);
    expect(a.fates.map((f) => (f.result === 'imported' ? f.set.load : null))).toEqual([
      { value: 140, unit: 'lb', convention: 'total' },
      { value: 200, unit: 'lb', convention: 'total' },
      { value: 25, unit: 'lb', convention: 'per_hand' },
      { value: 220, unit: 'lb', convention: 'total' },
    ]);
    const kgBar = analyseImport(parsed(`${A1}2026-10-01,Bench press,Chest,60,5,,,\n`), ctx(), answers({ total: 'plates_only', barWeight: { kg: 15, lb: 45 } }));
    expect(kgBar.fates[0]).toMatchObject({ result: 'imported', set: { load: { value: 75, unit: 'kg' } } });
  });

  it('bodyweight exercises with a weight: asked per exercise with the range; a mixed-sign file is never flipped (review B3)', () => {
    // -20 is an assisted set and +10 a weighted one: the usual FitNotes habit.
    const p = parsed(`${A1}2026-10-01,Pull-up,Back,0,10,,,\n2026-10-02,Pull-up,Back,10,6,,,\n2026-10-03,Pull-up,Back,-20,8,,,\n2026-10-03,Push-up,Chest,0,20,,,\n`);
    const a = analyseImport(p, ctx(), DEFAULT_ANSWERS);
    expect(a.bodyweight).toEqual([{ key: 'pull-up', name: 'Pull-up', exerciseName: 'Pull-up', sets: 3, min: -20, max: 10, mixed: true, answer: null }]);
    expect(a.questionsOpen).toBe(1);
    const fates = (x: ReturnType<typeof analyseImport>) => x.fates.map((f) => (f.result === 'imported' ? [f.set.convention, f.set.load?.value ?? null] : f.result === 'pending' ? 'pending' : f.detail));
    // Added: the negative (assisted) set can't be read this way.
    expect(fates(analyseImport(p, ctx(), answers({ bodyweight: { 'pull-up': 'added' } })))).toEqual([
      ['added', 0],
      ['added', 10],
      'Negative weight (-20), but you said weight is added',
      ['bodyweight', null],
    ]);
    // Assistance: the positive (weighted) set is unreadable, never recorded as 10 kg of assistance.
    expect(fates(analyseImport(p, ctx(), answers({ bodyweight: { 'pull-up': 'assistance' } })))).toEqual([
      ['assistance', 0],
      'Positive weight (10), but you said this exercise’s values are assistance and its other values are negative',
      ['assistance', 20],
      ['bodyweight', null],
    ]);
    // Split by sign: every row imports with the right convention.
    const split = analyseImport(p, ctx(), answers({ bodyweight: { 'pull-up': 'split' } }));
    expect(split.ready).toBe(true);
    expect(fates(split)).toEqual([
      ['added', 0],
      ['added', 10],
      ['assistance', 20],
      ['bodyweight', null],
    ]);
    // On one date, assisted and weighted sets of the same exercise become two exercise entries (one convention each).
    const sameDay = parsed(`${A1}2026-10-03,Pull-up,Back,-20,8,,,\n2026-10-03,Pull-up,Back,10,5,,,\n`);
    const rows = planImportRows(sameDay, analyseImport(sameDay, ctx(), answers({ bodyweight: { 'pull-up': 'split' } })), { jobId: JOB, defaultUnit: 'kg' });
    const agg = buildImportedSession({ ownerId: OWNER, jobId: JOB, operationId: OP, tz: 'Europe/London', gymId: null, importedAtUtc: '2026-10-09T10:00:00.000Z', date: '2026-10-03', rows });
    expect(validate(SessionAggregateSchema, agg).ok).toBe(true);
    expect(agg.exercises.map((e) => [e.exerciseName, e.loadConvention])).toEqual([
      ['Pull-up', 'assistance'],
      ['Pull-up', 'added'],
    ]);
    expect(agg.sets.map((x) => x.actual?.load)).toEqual([
      { value: 20, unit: 'kg', convention: 'assistance' },
      { value: 10, unit: 'kg', convention: 'added' },
    ]);
  });

  it('assistance written one way only: positive machine numbers or negative weights are read as assistance', () => {
    const positive = parsed(`${A1}2026-10-01,Pull-up,Back,30,8,,,\n2026-10-02,Pull-up,Back,25,8,,,\n`);
    const pos = analyseImport(positive, ctx(), answers({ bodyweight: { 'pull-up': 'assistance' } }));
    expect(pos.bodyweight[0]).toMatchObject({ min: 25, max: 30, mixed: false });
    expect(pos.fates.map((f) => (f.result === 'imported' ? f.set.load : f.result))).toEqual([
      { value: 30, unit: 'kg', convention: 'assistance' },
      { value: 25, unit: 'kg', convention: 'assistance' },
    ]);
    const negative = parsed(`${A1}2026-10-01,Pull-up,Back,-30,8,,,\n2026-10-02,Pull-up,Back,0,8,,,\n`);
    const neg = analyseImport(negative, ctx(), answers({ bodyweight: { 'pull-up': 'assistance' } }));
    expect(neg.bodyweight[0]).toMatchObject({ min: -30, max: 0, mixed: false });
    expect(neg.fates.map((f) => (f.result === 'imported' ? f.set.load?.value : f.result))).toEqual([30, 0]);
  });

  it('"Plates only" adds each bar’s own weight: an EZ or trap bar never gets the Olympic bar (review S1)', () => {
    const extra: MatchCandidate[] = [
      { exerciseId: '00000000-0000-4000-8000-00000000e2b1', name: 'Trap-bar deadlift', aliases: [], catalogueKey: 'trap-bar-deadlift', laterality: 'bilateral', defaultLoadConvention: 'total', compatibleEquipment: ['trap_bar'], implements: null },
      { exerciseId: '00000000-0000-4000-8000-00000000e2b2', name: 'Kettlebell swing', aliases: [], catalogueKey: 'kettlebell-swing', laterality: 'bilateral', defaultLoadConvention: 'total', compatibleEquipment: ['kettlebell'], implements: null },
      { exerciseId: '00000000-0000-4000-8000-00000000e2b3', name: 'Mystery bar lift', aliases: [], catalogueKey: null, laterality: 'bilateral', defaultLoadConvention: 'total', compatibleEquipment: [], implements: null },
    ];
    const c = ctx({ candidates: [...CANDIDATES, ...extra] });
    const p = parsed(
      `${A1}2026-10-01,Bench press,Chest,60,5,,,\n2026-10-01,EZ-bar skull crusher,Arms,20,10,,,\n2026-10-01,Trap-bar deadlift,Back,100,5,,,\n2026-10-01,Kettlebell swing,Legs,24,15,,,\n2026-10-01,Mystery bar lift,Back,40,5,,,\n`,
    );
    const loads = (x: ReturnType<typeof analyseImport>) => x.fates.map((f) => (f.result === 'imported' ? f.set.load?.value : f.result === 'pending' ? `pending ${f.reason}` : f.detail));

    // The kettlebell has no bar: imported as written and never part of the barbell question.
    const asked = analyseImport(p, c, DEFAULT_ANSWERS);
    expect(asked.total?.exercises.map((e) => e.name)).toEqual(['Bench press', 'EZ-bar skull crusher', 'Trap-bar deadlift', 'Mystery bar lift']);
    expect(asked.barless).toEqual([{ key: 'kettlebell swing', name: 'Kettlebell swing', exerciseName: 'Kettlebell swing' }]);
    expect(loads(asked)[3]).toBe(24);

    // Plates only: the Olympic bar's 20 kg is added to the bench only; EZ and trap bars wait for their own weight.
    const plates = analyseImport(p, c, answers({ total: 'plates_only' }));
    expect(plates.total?.bars).toEqual([
      { bar: 'barbell', units: ['kg'], weight: { kg: 20, lb: 45 }, needed: true, missing: [] },
      { bar: 'ez_bar', units: ['kg'], weight: { kg: null, lb: null }, needed: true, missing: ['kg'] },
      { bar: 'trap_bar', units: ['kg'], weight: { kg: null, lb: null }, needed: true, missing: ['kg'] },
    ]);
    expect(plates.total?.open).toBe(true);
    expect(plates.ready).toBe(false);
    expect(loads(plates)).toEqual([80, 'pending total', 'pending total', 24, 'Plates only (40), but which bar Mystery bar lift uses isn’t recorded, so no bar weight can be added']);

    // With their weights entered, each bar adds its own.
    const entered = analyseImport(p, c, answers({ total: 'plates_only', otherBarWeight: { ez_bar: { kg: 7.5, lb: null }, trap_bar: { kg: 25, lb: null } } }));
    expect(entered.total?.missingBarWeight).toBe(false);
    expect(entered.ready).toBe(true);
    expect(loads(entered).slice(0, 4)).toEqual([80, 27.5, 125, 24]);

    // "Total" for everything needs no bar weight at all.
    const totals = analyseImport(p, c, answers({ total: 'total' }));
    expect(totals.total?.bars.map((b) => [b.bar, b.needed, b.missing])).toEqual([
      ['barbell', false, []],
      ['ez_bar', false, []],
      ['trap_bar', false, []],
    ]);
    expect(loads(totals)).toEqual([60, 20, 100, 24, 40]);
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

  it('Add new makes one custom exercise per name and equipment, with the convention of the equipment Ben picked', () => {
    const p = parsed(`${A1}2026-10-01,Hammer Strength Row,Back,40,10,,,\n2026-10-02,Hammer Strength Row,Back,50,8,,,\n`);
    const a = analyseImport(p, ctx(), answers({ names: { 'hammer strength row': { kind: 'new', equipment: 'plate_loaded_machine' } } }));
    const id = customExerciseIdFor(OWNER, 'hammer strength row', 'plate_loaded_machine');
    expect(a.ready).toBe(true);
    expect(a.fates[0]).toMatchObject({ result: 'imported', set: { exerciseId: id, exerciseName: 'Hammer Strength Row', convention: 'added', load: { value: 40, convention: 'added' } } });
    expect(newExercisesToCreate(a)).toEqual([
      { exerciseId: id, name: 'Hammer Strength Row', laterality: 'bilateral', convention: 'added', bar: 'none', barKnown: true, implements: null, equipment: ['plate_loaded_machine'], newKind: 'plate_loaded_machine' },
    ]);
    expect(aliasesToSave(a)).toEqual([{ key: 'hammer strength row', name: 'Hammer Strength Row', target: { kind: 'exercise', exerciseId: id } }]);
  });

  it('Add new with other equipment is another exercise: the one an earlier answer made is never changed (review r6 B1)', () => {
    const p = parsed(`${A1}2026-10-01,Pull Up Machine,Back,-30,8,,,\n`);
    const key = 'pull up machine';
    const stackId = customExerciseIdFor(OWNER, key, 'weight_stack');
    const assistId = customExerciseIdFor(OWNER, key, 'assisted_stack');
    expect(new Set((['barbell', 'dumbbells', 'weight_stack', 'plate_loaded_machine', 'assisted_stack', 'bodyweight_station'] as const).map((k) => customExerciseIdFor(OWNER, key, k))).size).toBe(6);
    // An earlier import made the stack exercise; the name now says nothing about it (that import was undone).
    const made: MatchCandidate = { exerciseId: stackId, name: 'Pull Up Machine', aliases: [], catalogueKey: null, laterality: 'bilateral', defaultLoadConvention: 'stack', compatibleEquipment: ['weight_stack'], implements: null, importMade: true };
    const c = ctx({ candidates: [...CANDIDATES, made] });
    const a = analyseImport(p, c, answers({ names: { [key]: { kind: 'new', equipment: 'assisted_stack' } } }));
    expect(a.fates[0]).toMatchObject({ result: 'imported', set: { exerciseId: assistId, convention: 'assistance', load: { value: 30, convention: 'assistance' } } });
    expect(newExercisesToCreate(a).map((e) => [e.exerciseId, e.newKind])).toEqual([[assistId, 'assisted_stack']]);
    // Both are an import's own: never matched by their name.
    expect(isImportMadeExercise(OWNER, { id: stackId, name: 'Pull Up Machine', source: 'custom' })).toBe(true);
    expect(isImportMadeExercise(OWNER, { id: assistId, name: 'pull up  MACHINE', source: 'custom' })).toBe(true);
    expect(isImportMadeExercise(OWNER, { id: legacyCustomExerciseIdFor(OWNER, key), name: 'Pull Up Machine', source: 'custom' })).toBe(true);
    expect(isImportMadeExercise(OWNER, { id: '00000000-0000-4000-8000-0000000000aa', name: 'Pull Up Machine', source: 'custom' })).toBe(false);
    expect(isImportMadeExercise(OWNER, { id: stackId, name: 'Pull Up Machine', source: 'catalogue' })).toBe(false);
  });

  it('Add new reuses an exercise an earlier build made for the name only when it is exactly that equipment (review r6 B1)', () => {
    const p = parsed(`${A1}2026-10-01,Zottman Curl,Arms,16,10,,,\n`);
    const key = 'zottman curl';
    const legacy: MatchCandidate = { exerciseId: legacyCustomExerciseIdFor(OWNER, key), name: 'Zottman Curl', aliases: [], catalogueKey: null, laterality: 'bilateral', defaultLoadConvention: 'per_hand', compatibleEquipment: ['dumbbells'], implements: null, importMade: true };
    const c = ctx({ candidates: [...CANDIDATES, legacy] });
    const idFor = (equipment: 'dumbbells' | 'barbell') => {
      const a = analyseImport(p, c, answers({ names: { [key]: { kind: 'new', equipment } } }));
      const r = a.names[0]?.resolution;
      return r?.kind === 'exercise' ? r.exercise.exerciseId : null;
    };
    expect(idFor('dumbbells')).toBe(legacy.exerciseId);
    expect(idFor('barbell')).toBe(customExerciseIdFor(OWNER, key, 'barbell'));
  });

  it('Add new barbell for a name that says Smith: its bar isn’t the Olympic bar, so it is asked on its own (review r6 B2)', () => {
    const p = parsed(`${A1}2026-10-01,Smith Machine Barbell Shrug,Back,60,10,,,\n2026-10-01,Barbell Zottman Curl,Arms,30,10,,,\n`);
    const a = analyseImport(
      p,
      ctx(),
      answers({ names: { 'smith machine barbell shrug': { kind: 'new', equipment: 'barbell' }, 'barbell zottman curl': { kind: 'new', equipment: 'barbell' } }, total: 'plates_only' }),
    );
    expect(a.total?.exercises.map((e) => [e.name, e.known, e.reading, e.sample?.imported])).toEqual([
      ['Smith Machine Barbell Shrug', false, null, null],
      ['Barbell Zottman Curl', true, 'plates_only', 50],
    ]);
    expect(a.fates[0]).toEqual({ result: 'pending', reason: 'total' });
    // Ben's own answer for it reads it.
    const own = analyseImport(p, ctx(), answers({ names: { 'smith machine barbell shrug': { kind: 'new', equipment: 'barbell' }, 'barbell zottman curl': { kind: 'new', equipment: 'barbell' } }, total: 'plates_only', totalOverrides: { 'smith machine barbell shrug': 'total' } }));
    expect(own.fates[0]).toMatchObject({ result: 'imported', set: { load: { value: 60, convention: 'total' } } });
  });

  it('a file with nothing importable is never ready', () => {
    const a = analyseImport(parsed(`${A1}2026-10-01,Treadmill,Cardio,,,5,km,0:25:00\n`), ctx(), DEFAULT_ANSWERS);
    expect(a.questionsOpen).toBe(0);
    expect(a.ready).toBe(false);
  });
});

describe('FitNotes default one-dumbbell names (review r4)', () => {
  const loads = (a: ReturnType<typeof analyseImport>) => a.fates.map((f) => (f.result === 'imported' ? f.set.load?.value : f.result === 'pending' ? `pending:${f.reason}` : f.result));
  /** The two-dumbbell standing press, as in the catalogue (the press the one-arm name's words suggest). */
  const standing: MatchCandidate = {
    exerciseId: '00000000-0000-4000-8000-00000000e2c1',
    name: 'Standing dumbbell shoulder press',
    aliases: ['Standing dumbbell press', 'Standing DB press'],
    catalogueKey: 'dumbbell-standing-shoulder-press',
    laterality: 'bilateral',
    defaultLoadConvention: 'per_hand',
    compatibleEquipment: ['dumbbells'],
    implements: 2,
  };
  /** The dumbbell shoulder press with the catalogue's other name `Seated dumbbell press`, so FitNotes' `Seated Dumbbell Press` is its own name (a pair). */
  const shoulder: MatchCandidate = { ...(CANDIDATES.find((c) => c.name === 'Dumbbell shoulder press') as MatchCandidate), aliases: ['Seated dumbbell press'] };
  const withStanding = (over: Partial<ImportContext> = {}) => ctx({ candidates: [...CANDIDATES.filter((c) => c.exerciseId !== shoulder.exerciseId), shoulder, standing], ...over });
  const FILE = `${A1}2026-09-01,One-Arm Standing Dumbbell Press,Shoulders,22,8,,,\n2026-09-01,Dumbbell Concentration Curl,Biceps,14,10,,,\n2026-09-01,Seated Dumbbell Press,Shoulders,40,8,,,\n`;
  const ONE_ARM = nameKey('One-Arm Standing Dumbbell Press');
  const CONC = nameKey('Dumbbell Concentration Curl');
  const SEATED = nameKey('Seated Dumbbell Press');

  it('S1: a one-arm or concentration name taken as a two-dumbbell exercise by its words is asked, never halved by "Both together"', () => {
    const p = parsed(FILE);
    const first = analyseImport(p, withStanding(), DEFAULT_ANSWERS);
    // The words suggest the pair exercises (as the review's probe found); Ben taps Use this on each.
    expect(first.names.map((n) => [n.name, n.match.status, n.match.exerciseId])).toEqual(
      expect.arrayContaining([
        ['One-Arm Standing Dumbbell Press', 'check', standing.exerciseId],
        ['Dumbbell Concentration Curl', 'check', idOf('Dumbbell curl')],
      ]),
    );
    const names = { ...useSuggestions(first), [SEATED]: { kind: 'exercise' as const, exerciseId: idOf('Dumbbell shoulder press') } };
    const both = analyseImport(p, withStanding(), answers({ names, perHand: 'both' }));
    expect(both.perHand?.exercises.map((e) => [e.name, e.implements, e.reading])).toEqual([
      ['One-Arm Standing Dumbbell Press', null, null],
      ['Dumbbell Concentration Curl', null, null],
      ['Seated Dumbbell Press', 2, 'both'],
    ]);
    expect(both.perHand).toMatchObject({ pairs: 1, needsGroup: false, needsCount: 2, open: true });
    expect(loads(both)).toEqual(['pending:per_hand', 'pending:per_hand', 20]);
    expect(both.ready).toBe(false);
    // Answered as one dumbbell: imported as written, next to the halved pair.
    const one = analyseImport(p, withStanding(), answers({ names, perHand: 'both', perHandOverrides: { [ONE_ARM]: 'one', [CONC]: 'one' } }));
    expect(loads(one)).toEqual([22, 14, 20]);
    expect(one.ready).toBe(true);
  });

  it('S2: Ben’s dumbbell answer is remembered with the name and filled in next time, labelled; the group answer never reaches it', () => {
    const names = { [ONE_ARM]: { kind: 'exercise' as const, exerciseId: standing.exerciseId }, [CONC]: { kind: 'exercise' as const, exerciseId: idOf('Dumbbell curl') }, [SEATED]: { kind: 'exercise' as const, exerciseId: idOf('Dumbbell shoulder press') } };
    const p1 = parsed(FILE);
    const a1 = analyseImport(p1, withStanding(), answers({ names, perHand: 'both', perHandOverrides: { [ONE_ARM]: 'one', [CONC]: 'one' } }));
    // Saved with each name: the per-exercise answers only (the seated press took the group answer).
    expect(aliasesToSave(a1)).toEqual([
      { key: CONC, name: 'Dumbbell Concentration Curl', target: { kind: 'exercise', exerciseId: idOf('Dumbbell curl') }, perHand: 'one' },
      { key: ONE_ARM, name: 'One-Arm Standing Dumbbell Press', target: { kind: 'exercise', exerciseId: standing.exerciseId }, perHand: 'one' },
      { key: SEATED, name: 'Seated Dumbbell Press', target: { kind: 'exercise', exerciseId: idOf('Dumbbell shoulder press') } },
    ]);

    // A month later, a newer export: the names come back through the saved aliases, the answers with them.
    const later = withStanding({
      aliases: new Map(aliasesToSave(a1).map((x) => [x.key, x.target])),
      perHandAnswers: new Map([
        [ONE_ARM, 'one'],
        [CONC, 'one'],
      ]),
    });
    const p2 = parsed(`${A1}2026-10-08,One-Arm Standing Dumbbell Press,Shoulders,24,8,,,\n2026-10-08,Dumbbell Concentration Curl,Biceps,16,10,,,\n2026-10-08,Seated Dumbbell Press,Shoulders,42,8,,,\n`);
    const start = startingAnswers(p2.rows, later, null);
    expect(start).toEqual({ ...DEFAULT_ANSWERS, perHandOverrides: { [ONE_ARM]: 'one', [CONC]: 'one' } });
    const a2 = analyseImport(p2, later, start);
    expect(a2.names.map((n) => [n.name, n.match.status, n.match.via])).toEqual([
      ['Dumbbell Concentration Curl', 'matched', 'alias'],
      ['One-Arm Standing Dumbbell Press', 'matched', 'alias'],
      ['Seated Dumbbell Press', 'matched', 'alias'],
    ]);
    expect(a2.perHand?.exercises.map((e) => [e.name, e.override, e.remembered, e.reading])).toEqual([
      ['One-Arm Standing Dumbbell Press', 'one', 'one', 'one'],
      ['Dumbbell Concentration Curl', 'one', 'one', 'one'],
      ['Seated Dumbbell Press', null, null, null],
    ]);
    // Only the pair waits for the group answer (DX6: it is still never pre-selected). "Both" again: 24 stays 24.
    expect(a2.perHand).toMatchObject({ needsGroup: true, needsCount: 0 });
    expect(loads(analyseImport(p2, later, { ...start, perHand: 'both' }))).toEqual([24, 16, 21]);
    // Unchanged answers are saved again as they are; one Ben clears is forgotten (null), not kept. A remembered name
    // this import used is saved again too (with nothing about its dumbbells), so it stays in effect while this import
    // is, even if the import that taught it is undone (review r5 S2).
    const cleared = analyseImport(p2, later, { ...start, perHand: 'both', perHandOverrides: { [ONE_ARM]: 'one' } });
    expect(aliasesToSave(cleared).map((x) => [x.key, x.target, x.perHand])).toEqual([
      [CONC, { kind: 'exercise', exerciseId: idOf('Dumbbell curl') }, null],
      [ONE_ARM, { kind: 'exercise', exerciseId: standing.exerciseId }, 'one'],
      [SEATED, { kind: 'exercise', exerciseId: idOf('Dumbbell shoulder press') }, undefined],
    ]);
  });

  it('N2: the same file opened again starts from that import’s answers (not its names or a gym that is gone); remembered dumbbell answers win', () => {
    const p = parsed(FILE);
    const earlier: ImportAnswers = {
      ...DEFAULT_ANSWERS,
      names: { [ONE_ARM]: { kind: 'exercise', exerciseId: standing.exerciseId } },
      perHand: 'both',
      perHandOverrides: { [ONE_ARM]: 'each' },
      total: 'plates_only',
      existingDates: 'import',
      gymId: '00000000-0000-4000-8000-0000000009a1',
    };
    const start = startingAnswers(p.rows, { perHandAnswers: new Map([[ONE_ARM, 'one']]) }, { answers: earlier, gymIds: new Set() });
    expect(start).toEqual({ ...earlier, names: {}, gymId: null, perHandOverrides: { [ONE_ARM]: 'one' } });
    const kept = startingAnswers(p.rows, {}, { answers: earlier, gymIds: new Set(['00000000-0000-4000-8000-0000000009a1']) });
    expect(kept.gymId).toBe('00000000-0000-4000-8000-0000000009a1');
    expect(startingAnswers(p.rows, {}, null)).toEqual(DEFAULT_ANSWERS);
  });
});

describe('a word suggestion gives the exercise only (PM decision, review r5)', () => {
  const loads = (a: ReturnType<typeof analyseImport>) => a.fates.map((f) => (f.result === 'imported' ? f.set.load?.value : f.result === 'pending' ? `pending:${f.reason}` : f.result));
  const useAll = (p: ReturnType<typeof parsed>, c: ImportContext = ctx()) => useSuggestions(analyseImport(p, c, DEFAULT_ANSWERS));

  it('S1: FitNotes’ `Dumbbell Preacher Curl` and `Front Dumbbell Raise`, accepted with Use this, are never halved by "Both together"', () => {
    const p = parsed(`${A1}2026-09-01,Dumbbell Preacher Curl,Biceps,20,10,,,\n2026-09-01,Front Dumbbell Raise,Shoulders,16,10,,,\n2026-09-01,Dumbbell Curl,Biceps,24,10,,,\n`);
    const first = analyseImport(p, ctx(), DEFAULT_ANSWERS);
    expect(first.names.map((n) => [n.name, n.match.status, n.match.via, n.match.exerciseId])).toEqual([
      ['Dumbbell Preacher Curl', 'check', 'words', idOf('Dumbbell curl')],
      ['Front Dumbbell Raise', 'check', 'words', idOf('Lateral raise')],
      ['Dumbbell Curl', 'matched', 'name', idOf('Dumbbell curl')],
    ]);
    const names = useAll(p);
    const both = analyseImport(p, ctx(), answers({ names, perHand: 'both' }));
    // Only the curl named by its own name is a pair; the two suggestions are asked, with nothing selected.
    expect(both.perHand?.exercises.map((e) => [e.name, e.implements, e.override, e.reading, e.sample?.imported ?? null])).toEqual([
      ['Dumbbell Preacher Curl', null, null, null, null],
      ['Front Dumbbell Raise', null, null, null, null],
      ['Dumbbell Curl', 2, null, 'both', 12],
    ]);
    expect(both.perHand).toMatchObject({ pairs: 1, needsGroup: false, needsCount: 2, open: true });
    expect(loads(both)).toEqual(['pending:per_hand', 'pending:per_hand', 12]);
    expect(both.ready).toBe(false);
    // Ben's own answer for each (source (b)) is what changes or keeps the value.
    const answered = analyseImport(p, ctx(), answers({ names, perHand: 'both', perHandOverrides: { [nameKey('Dumbbell Preacher Curl')]: 'one', [nameKey('Front Dumbbell Raise')]: 'both' } }));
    expect(loads(answered)).toEqual([20, 8, 12]);
    expect(answered.ready).toBe(true);
  });

  it('a word that says two (source (c)) lets the group answer read a suggested pair; one that says one never takes the pair’s count', () => {
    const p = parsed(`${A1}2026-09-01,Alternating Dumbbell Preacher Curl,Biceps,20,10,,,\n2026-09-01,Single Arm Dumbbell Preacher Curl,Biceps,12,10,,,\n`);
    const names = {
      [nameKey('Alternating Dumbbell Preacher Curl')]: { kind: 'exercise' as const, exerciseId: idOf('Dumbbell curl') },
      [nameKey('Single Arm Dumbbell Preacher Curl')]: { kind: 'exercise' as const, exerciseId: idOf('Dumbbell curl') },
    };
    const a = analyseImport(p, ctx(), answers({ names, perHand: 'both' }));
    expect(a.perHand?.exercises.map((e) => [e.name, e.implements, e.reading])).toEqual([
      ['Alternating Dumbbell Preacher Curl', 2, 'both'],
      ['Single Arm Dumbbell Preacher Curl', null, null],
    ]);
    expect(loads(a)).toEqual([10, 'pending:per_hand']);
  });

  it('a bar is added by the group answer only when the name establishes it; a suggested bar exercise is asked on its own with what it imports as', () => {
    const p = parsed(`${A1}2026-09-01,Decline Bench Press,Chest,60,8,,,\n2026-09-01,Flat Barbell Bench Press,Chest,80,5,,,\n2026-09-02,Flat Bench,Chest,70,5,,,\n`);
    const first = analyseImport(p, ctx(), DEFAULT_ANSWERS);
    expect(first.names.map((n) => [n.name, n.match.status])).toEqual([
      ['Decline Bench Press', 'check'],
      ['Flat Barbell Bench Press', 'check'],
      ['Flat Bench', 'matched'],
    ]);
    const names = useAll(p);
    const plates = analyseImport(p, ctx(), answers({ names, total: 'plates_only' }));
    // `Decline Bench Press` says no bar and isn't the bench press's own name: asked, nothing selected.
    expect(plates.total?.exercises.map((e) => [e.name, e.known, e.override, e.reading, e.sample])).toEqual([
      ['Decline Bench Press', false, null, null, { value: 60, unit: 'kg', imported: null, barWeight: 20 }],
      ['Flat Barbell Bench Press', true, null, 'plates_only', { value: 80, unit: 'kg', imported: 100, barWeight: 20 }],
      ['Flat Bench', true, null, 'plates_only', { value: 70, unit: 'kg', imported: 90, barWeight: 20 }],
    ]);
    expect(plates.total).toMatchObject({ grouped: 2, needsGroup: false, needsOwn: 1, open: true, example: { name: 'Flat Bench', value: 70 } });
    expect(loads(plates)).toEqual(['pending:total', 100, 90]);
    // With no group answer, the group waits and the suggested one is still asked on its own.
    expect(analyseImport(p, ctx(), answers({ names })).total).toMatchObject({ needsGroup: true, needsOwn: 1 });
    // Ben's own answer (source (b)) reads it.
    expect(loads(analyseImport(p, ctx(), answers({ names, total: 'plates_only', totalOverrides: { [nameKey('Decline Bench Press')]: 'plates_only' } })))).toEqual([80, 100, 90]);
    const own = analyseImport(p, ctx(), answers({ names, total: 'plates_only', totalOverrides: { [nameKey('Decline Bench Press')]: 'total' } }));
    expect(loads(own)).toEqual([60, 100, 90]);
    expect(own.ready).toBe(true);
    // An exercise with its own answer is neither counted nor the example for the group (review r5 N4).
    const overridden = analyseImport(p, ctx(), answers({ names, totalOverrides: { [nameKey('Flat Bench')]: 'total' } }));
    expect(overridden.total).toMatchObject({ grouped: 1, example: { name: 'Flat Barbell Bench Press', value: 80 } });
  });

  it('S3: a weight-stack dip machine is never read as assistance; a name that says assisted is', () => {
    const p = parsed(`${A1}2026-09-01,Triceps Dip Machine,Arms,80,10,,,\n2026-09-01,Assisted Dips,Arms,30,8,,,\n`);
    const first = analyseImport(p, ctx(), DEFAULT_ANSWERS);
    expect(first.names.map((n) => [n.name, n.match.status, n.match.exerciseId])).toEqual([
      ['Assisted Dips', 'check', idOf('Assisted dip')],
      ['Triceps Dip Machine', 'no_match', null],
    ]);
    const a = analyseImport(p, ctx(), answers({ names: { ...useAll(p), [nameKey('Triceps Dip Machine')]: { kind: 'new', equipment: 'weight_stack' } } }));
    expect(a.fates.map((f) => (f.result === 'imported' ? f.set.load : f.result))).toEqual([
      { value: 80, unit: 'kg', convention: 'stack' },
      { value: 30, unit: 'kg', convention: 'assistance' },
    ]);
    expect(a.machines.map((m) => [m.name, m.convention])).toEqual([
      ['Triceps Dip Machine', 'stack'],
      ['Assisted Dips', 'assistance'],
    ]);
  });

  it('r6 S3: an assisted exercise’s positive values among negative ones are never read as assistance; each shows what it imports as (r6 N2)', () => {
    const p = parsed(`${A1}2026-09-01,Assisted Dip,Arms,-30,8,,,\n2026-09-02,Assisted Dip,Arms,10,5,,,\n2026-09-02,Assisted Pull Up,Back,40,8,,,\n2026-09-03,Assisted Pull Up,Back,35,8,,,\n`);
    const a = analyseImport(p, ctx(), answers({ names: useAll(p) }));
    expect(a.fates.map((f) => (f.result === 'imported' ? f.set.load : f.result === 'unreadable' ? f.detail : f.result))).toEqual([
      { value: 30, unit: 'kg', convention: 'assistance' },
      'Positive weight (10) on an assisted exercise whose other values are negative, so it may be weight added; not read as assistance',
      { value: 40, unit: 'kg', convention: 'assistance' },
      { value: 35, unit: 'kg', convention: 'assistance' },
    ]);
    expect(a.machines.map((m) => [m.name, m.convention, m.sample, m.mixed])).toEqual([
      ['Assisted Dip', 'assistance', { value: -30, unit: 'kg', imported: 30 }, true],
      ['Assisted Pull Up', 'assistance', { value: 35, unit: 'kg', imported: 35 }, false],
    ]);
    expect(a.ready).toBe(true);
    // All negative: each is that much assistance.
    const neg = analyseImport(parsed(`${A1}2026-09-01,Assisted Dip,Arms,-30,8,,,\n2026-09-02,Assisted Dip,Arms,-25,5,,,\n2026-09-02,Assisted Dip,Arms,0,5,,,\n`), ctx(), DEFAULT_ANSWERS);
    expect(neg.fates.map((f) => (f.result === 'imported' ? f.set.load?.value : f.result))).toEqual([30, 25, 0]);
  });

  it('N4: the dumbbell group question counts and shows only pairs it reads: not one with its own answer', () => {
    const p = parsed(`${A1}2026-09-01,Dumbbell Bench Press,Chest,60,8,,,\n2026-09-02,Dumbbell Curl,Biceps,24,10,,,\n`);
    const a = analyseImport(p, ctx(), answers({ perHandOverrides: { [nameKey('Dumbbell Curl')]: 'one' } }));
    expect(a.perHand).toMatchObject({ pairs: 1, needsGroup: true, example: { name: 'Dumbbell Bench Press', value: 60 } });
    const none = analyseImport(p, ctx(), answers({ perHandOverrides: { [nameKey('Dumbbell Curl')]: 'one', [nameKey('Dumbbell Bench Press')]: 'each' } }));
    expect(none.perHand).toMatchObject({ pairs: 0, needsGroup: false, example: null, open: false });
  });

  it('N3: a kettlebell exercise on the dumbbell question is called a kettlebell', () => {
    const kb: MatchCandidate = { exerciseId: '00000000-0000-4000-8000-00000000e2d1', name: 'Kettlebell press', aliases: [], catalogueKey: 'kettlebell-press', laterality: 'unilateral', defaultLoadConvention: 'per_hand', compatibleEquipment: ['kettlebell'], implements: 1 };
    const a = analyseImport(parsed(`${A1}2026-09-01,Kettlebell Press,Shoulders,24,8,,,\n2026-09-01,Dumbbell Curl,Biceps,24,10,,,\n`), ctx({ candidates: [...CANDIDATES, kb] }), DEFAULT_ANSWERS);
    expect(a.perHand?.exercises.map((e) => [e.name, e.implement, e.reading])).toEqual([
      ['Kettlebell Press', 'kettlebell', 'one'],
      ['Dumbbell Curl', 'dumbbell', null],
    ]);
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
    // FitNotes has no rest: recorded as not recorded, never a 0 s global default (review N6).
    expect(agg.sets.map((s) => s.rest)).toEqual(agg.sets.map(() => ({ seconds: 0, source: 'not_recorded', sourceLabel: 'Not recorded (imported)' })));
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
    expect(history).toEqual([{ sessionId: agg.session.id, performedAtUtc: '2026-10-02T11:00:00.000Z', equipmentId: null, gymId: null, imported: true, sets: [{ setType: 'working', side: null, load: { value: 100, unit: 'kg', convention: 'total' }, reps: 5, rpe: null, rir: null }] }]);
  });

  it('says when a row’s raw text was cut to fit storage, never silently (review N7)', () => {
    const long = 'x'.repeat(25_000);
    const p = parsed(`Date,Exercise,Category,Weight (kgs),Reps,Distance,Distance Unit,Time,Comment\n2026-10-01,Lat pulldown,Back,40,10,,,,${long}\n`);
    const rows = planImportRows(p, analyseImport(p, ctx(), DEFAULT_ANSWERS), { jobId: JOB, defaultUnit: 'kg' });
    expect(rows[0]).toMatchObject({ result: 'imported', detail: 'Stored cut to 64 cells of 20,000 characters each' });
    expect(rows[0]?.cells[8]?.length).toBe(20_000);
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
