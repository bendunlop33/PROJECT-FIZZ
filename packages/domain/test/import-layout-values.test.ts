import { describe, expect, it } from 'vitest';
import { EMPTY_LAYOUT_ANSWERS, type ImportMappingSpecV1 } from '@fizz/schemas';
import { analyseImport, applyAnswerChange, applyImportSpec, DEFAULT_ANSWERS, nameKey, parseFitNotesCsv, planImportRows, readTable, valueChecksOf, type ImportContext } from '../src';
import { OWNER } from './fixtures';
import { CANDIDATES, idOf } from './import-fixtures';
import { OPTS } from './layout-fixtures';

/** Values to check (AI13, check 51): a jump of more than 2× is asked, nothing selected, and blocks the import. */
const ctx: ImportContext = { ownerId: OWNER, candidates: CANDIDATES, aliases: new Map(), appDates: new Set(), importedDates: new Map(), defaultUnit: 'kg' };
const text = ['Date,Exercise,Weight (kg),Reps', '2025-06-01,Bench Press,100,5', '2025-06-01,Bench Press,100,5', '2025-06-03,Bench Press,225,5', '2025-06-03,Bench Press,225,4', '2025-06-05,Bench Press,102.5,5', '2025-06-07,Bench Press,40,5'].join('\n');
const spec: ImportMappingSpecV1 = {
  specVersion: 1,
  file: { delimiter: ',', headerLine: 1, decimal: '.' },
  layout: { kind: 'row_per_set', setOrder: null },
  workoutKey: [],
  date: { column: { header: 'Date', index: 0 }, format: 'YYYY-MM-DD' },
  exercise: { header: 'Exercise', index: 1 },
  load: { column: { header: 'Weight (kg)', index: 2 }, unit: { kind: 'header_token', column: { header: 'Weight (kg)', index: 2 }, token: 'kg' } },
  reps: { header: 'Reps', index: 3 },
  setType: null,
  rpe: null,
  notes: [],
  unmapped: [],
  selfCheck: [
    { line: 2, date: '2025-06-01', exercise: 'Bench Press', load: 100, reps: 5 },
    { line: 4, date: '2025-06-03', exercise: 'Bench Press', load: 225, reps: 5 },
    { line: 6, date: '2025-06-05', exercise: 'Bench Press', load: 102.5, reps: 5 },
  ],
  unsupported: null,
};
const table = readTable(text);
if (!table) throw new Error('table');
const rows = applyImportSpec(spec, { ...EMPTY_LAYOUT_ANSWERS, recordKind: 'done' }, table, OPTS).rows;
const named = { ...DEFAULT_ANSWERS, names: { [nameKey('Bench Press')]: { kind: 'exercise' as const, exerciseId: idOf('Bench press') } }, total: 'total' as const };

describe('the soft check', () => {
  it('100 → 225 and a fall under half are asked; the value after a flagged one is compared with the last accepted', () => {
    expect(valueChecksOf(rows).map((v) => [v.date, v.value, v.before.value, v.sets])).toEqual([
      ['2025-06-03', 225, 100, 2],
      ['2025-06-07', 40, 102.5, 1],
    ]);
  });

  it('blocks the import until answered, nothing selected', () => {
    const a = analyseImport({ variant: null, rows }, ctx, named);
    expect(a.valueChecks.map((v) => v.answer)).toEqual([null, null]);
    expect(a.counts.byResult.pending).toBe(3);
    expect(a.ready).toBe(false);
  });

  it('`Skip these sets` skips that exercise in that workout; `Import as written` imports it unchanged', () => {
    const [first, second] = analyseImport({ variant: null, rows }, ctx, named).valueChecks;
    let answers = applyAnswerChange(named, { kind: 'value_check', key: first?.key ?? '', answer: 'skip' });
    answers = applyAnswerChange(answers, { kind: 'value_check', key: second?.key ?? '', answer: 'import' });
    const a = analyseImport({ variant: null, rows }, ctx, answers);
    expect(a.ready).toBe(true);
    expect(a.fates.map((f) => f.result)).toEqual(['imported', 'imported', 'skipped_value_to_check', 'skipped_value_to_check', 'imported', 'imported']);
    expect(a.fates[5]).toMatchObject({ set: { load: { value: 40, unit: 'kg' } } });
    const planned = planImportRows({ rows }, a, { jobId: '00000000-0000-4000-8000-00000000a0b3', defaultUnit: 'kg' });
    expect(planned.filter((r) => r.result === 'skipped_value_to_check').map((r) => r.detail)).toEqual(['You chose Skip for this value', 'You chose Skip for this value']);
  });

  it('`Import all as written` answers every open one, and leaves answered ones alone', () => {
    const checks = analyseImport({ variant: null, rows }, ctx, named).valueChecks;
    let answers = applyAnswerChange(named, { kind: 'value_check', key: checks[0]?.key ?? '', answer: 'skip' });
    answers = applyAnswerChange(answers, { kind: 'value_checks_all', keys: checks.map((c) => c.key) });
    expect(Object.values(answers.valueChecks ?? {})).toEqual(['skip', 'import']);
  });

  it('a different unit is never compared (a kg and a lb set aren’t a jump)', () => {
    const mixed = rows.map((r) => (r.line === 4 || r.line === 5 ? { ...r, weight: r.weight ? { ...r.weight, unit: 'lb' as const } : null } : r));
    expect(valueChecksOf(mixed).map((v) => v.date)).toEqual(['2025-06-07']);
  });

  it('FitNotes is unchanged: no soft check (an ADR 0016 change, ADR 0026)', () => {
    const p = parseFitNotesCsv('Date,Exercise,Category,Weight (kgs),Reps,Distance,Distance Unit,Time\n2025-06-01,Bench Press,Chest,100,5,,,\n2025-06-03,Bench Press,Chest,225,5,,,\n', '2026-10-12');
    if (!p.ok) throw new Error('parse');
    const a = analyseImport(p, ctx, named);
    expect(a.valueChecks).toEqual([]);
    expect(a.ready).toBe(true);
  });
});
