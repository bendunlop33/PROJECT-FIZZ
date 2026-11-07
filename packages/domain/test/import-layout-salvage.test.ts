import { describe, expect, it } from 'vitest';
import { readTable, salvageImportSpec, validateImportSpec, buildLayoutReview, formatsReading } from '../src';
import { EMPTY_LAYOUT_ANSWERS } from '@fizz/schemas';
import { fixture } from './import-fixtures';
import { OPTS, layoutSpec, tableOf } from './layout-fixtures';

/**
 * A layout that still fails the checks after one correction (ADR 0026
 * amendment, 13 Oct 2026): code keeps what it can check and Check the
 * layout asks Ben the rest. Synthetic files only.
 */
const STRONG = tableOf('strong-new-kg.synthetic.csv');
const SPEC = layoutSpec('strong-new-kg.spec.json') as Record<string, unknown>;
const failuresOf = (raw: unknown, table = STRONG) => {
  const v = validateImportSpec(raw, table, OPTS);
  if (v.ok || v.unsupported) throw new Error('expected failures');
  return v.failures;
};

describe('salvageImportSpec', () => {
  it('a wrong unit token becomes `none` (code reads the header’s own unit word) and a marker not in the file is dropped', () => {
    const bad = {
      ...SPEC,
      load: { column: { header: 'Weight (kg)', index: 6 }, unit: { kind: 'header_token', column: { header: 'Weight (kg)', index: 6 }, token: 'lbs' } },
      setType: { column: { header: 'Set Order', index: 5 }, values: [{ cell: 'W', meaning: 'warmup' }, { cell: 'X', meaning: 'drop' }] },
    };
    const failed = failuresOf(bad);
    expect(failed).toEqual([{ kind: 'unit_token', token: 'lbs' }, { kind: 'marker', token: '' }]);
    const kept = salvageImportSpec(bad, STRONG, failed, OPTS);
    expect(kept).not.toBeNull();
    if (!kept) return;
    expect(kept.failed).toEqual(failed);
    expect(kept.spec.load?.unit).toEqual({ kind: 'none' });
    expect(kept.spec.setType?.values).toEqual([{ cell: 'W', meaning: 'warmup' }]);
    // The kept layout passes every check; the unit is the header's own word (never the coach's `lbs`), and the file's own markers are asked.
    expect(validateImportSpec(kept.spec, STRONG, OPTS).ok).toBe(true);
    const review = buildLayoutReview(STRONG, kept.spec, EMPTY_LAYOUT_ANSWERS, OPTS);
    expect(review.unit).toEqual({ unit: 'kg', source: 'header', token: 'kg' });
    expect(review.questions.flatMap((q) => (q.kind === 'marker' ? [[q.marker.token, q.marker.state]] : []))).toEqual([
      ['W', 'check'],
      ['D', 'question'],
    ]);
  });

  it('a wrong index moves to the one header cell with that name; a name that isn’t a header is dropped', () => {
    const bad = { ...SPEC, reps: { header: 'Reps', index: 6 }, rpe: { header: 'Effort', index: 8 } };
    const failed = failuresOf(bad);
    const kept = salvageImportSpec(bad, STRONG, failed, OPTS);
    expect(kept?.spec.reps).toEqual({ header: 'Reps', index: 7 });
    expect(kept?.spec.rpe).toBeNull();
  });

  it('a column given two roles keeps the first; a result role on a target column is dropped', () => {
    const twice = { ...SPEC, rpe: { header: 'Reps', index: 7 } };
    const kept = salvageImportSpec(twice, STRONG, failuresOf(twice), OPTS);
    expect(kept?.spec.reps).toEqual({ header: 'Reps', index: 7 });
    expect(kept?.spec.rpe).toBeNull();
    // `Target Reps` as reps: the role is dropped (AI4); with no reps nothing reads, which the screen shows as rows not read.
    const target = tableOf('template-target.synthetic.csv');
    const tSpec = layoutSpec('template-target.spec.json');
    const tFailed = failuresOf(tSpec, target);
    expect(tFailed).toEqual([{ kind: 'target_column', header: 'Target Reps' }]);
    const k = salvageImportSpec(tSpec, target, tFailed, OPTS);
    expect(k?.spec.reps).toBeNull();
    expect(k?.remaining.map((f) => f.kind)).toContain('dry_run');
  });

  it('a date format that doesn’t read the column becomes code’s own reading of it', () => {
    const bad = { ...SPEC, date: { column: { header: 'Date', index: 1 }, format: 'DD/MM/YYYY' } };
    const failed = failuresOf(bad);
    expect(failed[0]?.kind).toBe('date');
    const kept = salvageImportSpec(bad, STRONG, failed, OPTS);
    expect(kept?.spec.date).toEqual({ column: { header: 'Date', index: 1 }, format: 'YYYY-MM-DD HH:mm:ss' });
    expect(kept?.remaining).toEqual([]);
  });

  it('nothing checkable left (no set cells column) is not kept', () => {
    const packed = { ...SPEC, layout: { kind: 'row_per_exercise_packed', sets: { header: 'Sets', index: 3 }, notation: 'sets_x_reps' } };
    expect(salvageImportSpec(packed, STRONG, failuresOf(packed), OPTS)).toBeNull();
    // A spec that doesn't parse, or says unsupported, is never kept.
    expect(salvageImportSpec({ nope: 1 }, STRONG, [{ kind: 'schema' }], OPTS)).toBeNull();
    expect(salvageImportSpec({ ...SPEC, unsupported: 'no_set_rows' }, STRONG, [], OPTS)).toBeNull();
  });
});

describe('ISO dates with an offset in the layout path (`YYYY-MM-DDTHH:mm:ssZ`)', () => {
  it('reads FitNotes 2’s `StartTime` as an instant in the import’s zone', () => {
    const table = readTable(fixture('D.synthetic.csv'));
    if (!table) throw new Error('table');
    expect(formatsReading(table.records.map((r) => r.cells[1] ?? ''), 'Europe/London')).toEqual(['YYYY-MM-DDTHH:mm:ssZ']);
    const ref = (header: string) => ({ header, index: table.header.indexOf(header) });
    const spec = {
      specVersion: 1,
      file: { delimiter: ',', headerLine: 1, decimal: '.' },
      layout: { kind: 'row_per_set', setOrder: null },
      workoutKey: [],
      date: { column: ref('StartTime'), format: 'YYYY-MM-DDTHH:mm:ss' },
      exercise: ref('Exercise'),
      load: { column: ref('Weight'), unit: { kind: 'none' } },
      reps: ref('Reps'),
      setType: { column: ref('Status'), values: [{ cell: 'Done', meaning: 'working' }, { cell: 'NotStarted', meaning: 'not_a_set' }] },
      rpe: ref('RPE'),
      notes: [ref('Note')],
      unmapped: ['Name', 'EndTime', 'BodyWeight', 'Equipment', 'Time', 'Distance', 'IsWarmup', 'RIR', 'Categories'].map(ref),
      selfCheck: [
        { line: 2, date: '2026-03-02', exercise: 'Bench Press', load: 40, reps: 10 },
        { line: 3, date: '2026-03-02', exercise: 'Bench Press', load: 80, reps: 8 },
        { line: 4, date: '2026-03-02', exercise: 'Bench Press', load: 80, reps: 8 },
      ],
      unsupported: null,
    };
    // The wall-clock format can't read `…Z`: the exact failure Ben's file hit.
    expect(validateImportSpec(spec, table, OPTS)).toMatchObject({ ok: false, failures: [{ kind: 'date', row: 2 }] });
    const fixed = { ...spec, date: { ...spec.date, format: 'YYYY-MM-DDTHH:mm:ssZ' } };
    expect(validateImportSpec(fixed, table, OPTS)).toMatchObject({ ok: true });
  });
});
