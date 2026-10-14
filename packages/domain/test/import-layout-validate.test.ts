import { describe, expect, it } from 'vitest';
import { ImportMappingSpecV1Schema, type ImportMappingSpecV1 } from '@fizz/schemas';
import { readTable, validateImportSpec, type SpecValidation } from '../src';
import { OPTS, layoutSpec, specOf, tableOf } from './layout-fixtures';

/** `validateImportSpec`: the nine checks of §9.2.4 (checks 41, 44). Any failure refuses the whole spec. */
const strong = () => tableOf('strong-new-kg.synthetic.csv');
const spec = (): ImportMappingSpecV1 => specOf('strong-new-kg.spec.json');
const failures = (v: SpecValidation) => (v.ok ? [] : v.failures);

describe('the right spec passes', () => {
  it.each(['strong-new-kg', 'strong-old', 'hevy-kg', 'hevy-lbs', 'hevy-assisted', 'spreadsheet-sets-x-reps', 'spreadsheet-wide', 'liftosaur-like'])('%s', (name) => {
    const v = validateImportSpec(layoutSpec(`${name}.spec.json`), tableOf(`${name}.synthetic.csv`), OPTS);
    expect(v.ok).toBe(true);
    if (v.ok) expect(v.dryRun.read).toBe(v.dryRun.total);
  });
});

describe('check 1: schema', () => {
  it('an unknown field, a missing field or a wrong type is refused', () => {
    expect(failures(validateImportSpec({ ...spec(), extra: 'x' }, strong(), OPTS))).toEqual([{ kind: 'schema' }]);
    const noReps: Record<string, unknown> = { ...spec() };
    delete noReps.reps;
    expect(failures(validateImportSpec(noReps, strong(), OPTS))).toEqual([{ kind: 'schema' }]);
    expect(failures(validateImportSpec({ ...spec(), specVersion: 2 }, strong(), OPTS))).toEqual([{ kind: 'schema' }]);
    expect(failures(validateImportSpec('not a spec', strong(), OPTS))).toEqual([{ kind: 'schema' }]);
  });

  it('a self-check needs 3 to 5 rows (Zod, after the parse)', () => {
    const s = spec();
    expect(ImportMappingSpecV1Schema.safeParse({ ...s, selfCheck: s.selfCheck.slice(0, 2) }).success).toBe(false);
    expect(failures(validateImportSpec({ ...s, selfCheck: s.selfCheck.slice(0, 2) }, strong(), OPTS))).toEqual([{ kind: 'schema' }]);
  });

  it('a delimiter other than the file’s is refused', () => {
    expect(failures(validateImportSpec({ ...spec(), file: { delimiter: ',', headerLine: 1, decimal: '.' } }, strong(), OPTS))).toEqual([{ kind: 'schema' }]);
  });

  it('`unsupported` is its own answer: no sets found', () => {
    expect(validateImportSpec({ ...spec(), unsupported: 'no_set_rows', selfCheck: [] }, strong(), OPTS)).toEqual({ ok: false, unsupported: true, failures: [] });
  });
});

describe('check 2: columns', () => {
  it('a reference whose header isn’t the cell at its index is refused; a made-up name is never kept (AI11)', () => {
    const wrongIndex = { ...spec(), reps: { header: 'Reps', index: 6 } };
    expect(failures(validateImportSpec(wrongIndex, strong(), OPTS))).toEqual([{ kind: 'unknown_column', header: 'Reps' }]);
    const madeUp = { ...spec(), reps: { header: 'Repetitions done', index: 7 } };
    expect(failures(validateImportSpec(madeUp, strong(), OPTS))).toEqual([{ kind: 'unknown_column', header: '' }]);
  });

  it('a column with two roles is refused (notes too)', () => {
    const s = spec();
    expect(failures(validateImportSpec({ ...s, rpe: s.reps }, strong(), OPTS))).toEqual([{ kind: 'two_roles', header: 'Reps' }]);
    expect(failures(validateImportSpec({ ...s, notes: [...s.notes, { header: 'Reps', index: 7 }] }, strong(), OPTS))).toEqual([{ kind: 'two_roles', header: 'Reps' }]);
  });
});

describe('check 3: unit evidence (check 44)', () => {
  it('a header token must be a whole word of the load column’s name', () => {
    const s = spec();
    const lyingToken = { ...s, load: { column: s.load?.column ?? { header: '', index: 0 }, unit: { kind: 'header_token' as const, column: { header: 'Weight (kg)', index: 6 }, token: 'lb' as const } } };
    expect(failures(validateImportSpec(lyingToken, strong(), OPTS))).toEqual([{ kind: 'unit_token', token: 'lb' }]);
    // Strong's old export has no unit in `Weight`: a claimed `kg` token is refused.
    const old = specOf('strong-old.spec.json');
    const claim = { ...old, load: { column: { header: 'Weight', index: 5 }, unit: { kind: 'header_token' as const, column: { header: 'Weight', index: 5 }, token: 'kg' as const } } };
    expect(failures(validateImportSpec(claim, tableOf('strong-old.synthetic.csv'), OPTS))).toEqual([{ kind: 'unit_token', token: 'kg' }]);
  });

  it('a unit column must hold only kg/kgs/lb/lbs in the whole file', () => {
    const s = spec();
    const lying = { ...s, unmapped: s.unmapped.filter((c) => c.index !== 2), load: { column: s.load?.column ?? { header: '', index: 0 }, unit: { kind: 'unit_column' as const, column: { header: 'Workout Name', index: 2 } } } };
    expect(failures(validateImportSpec(lying, strong(), OPTS))).toEqual([{ kind: 'unit_column', header: 'Workout Name' }]);
    const mixed = readTable('Date,Exercise,Weight,Unit,Reps\n2025-01-01,Bench,80,kg,8\n2025-01-01,Bench,80,KGS,8\n2025-01-02,Bench,80,stone,8\n');
    if (!mixed) throw new Error('table');
    const mspec = {
      ...s,
      file: { delimiter: ',' as const, headerLine: 1, decimal: '.' as const },
      layout: { kind: 'row_per_set' as const, setOrder: null },
      workoutKey: [],
      date: { column: { header: 'Date', index: 0 }, format: 'YYYY-MM-DD' as const },
      exercise: { header: 'Exercise', index: 1 },
      load: { column: { header: 'Weight', index: 2 }, unit: { kind: 'unit_column' as const, column: { header: 'Unit', index: 3 } } },
      reps: { header: 'Reps', index: 4 },
      setType: null,
      rpe: null,
      notes: [],
      unmapped: [],
      selfCheck: [
        { line: 2, date: '2025-01-01', exercise: 'Bench', load: 80, reps: 8 },
        { line: 3, date: '2025-01-01', exercise: 'Bench', load: 80, reps: 8 },
        { line: 4, date: '2025-01-02', exercise: 'Bench', load: 80, reps: 8 },
      ],
    };
    expect(failures(validateImportSpec(mspec, mixed, OPTS))).toEqual([{ kind: 'unit_column', header: 'Unit' }]);
  });
});

describe('check 4: markers', () => {
  it('a marker the file doesn’t have is refused (its text is model text, not kept)', () => {
    const s = spec();
    const extra = { ...s, setType: { column: { header: 'Set Order', index: 5 }, values: [...(s.setType?.values ?? []), { cell: 'X', meaning: 'warmup' as const }] } };
    expect(failures(validateImportSpec(extra, strong(), OPTS))).toEqual([{ kind: 'marker', token: '' }]);
  });
});

describe('check 5: dates', () => {
  it('a format that doesn’t read every date is refused with the first such cell', () => {
    const s = { ...spec(), date: { column: { header: 'Date', index: 1 }, format: 'YYYY-MM-DD' as const } };
    expect(failures(validateImportSpec(s, strong(), OPTS))).toEqual([{ kind: 'date', cell: '2025-03-04 07:10:00', row: 2 }]);
  });

  it('MM/DD on dates whose first field goes above 12 is refused; DD/MM reads them', () => {
    const t = readTable('Date,Exercise,Weight,Reps\n21/11/2025,Bench,80,8\n03/11/2025,Bench,80,8\n04/11/2025,Squat,100,5\n');
    if (!t) throw new Error('table');
    const base = {
      ...spec(),
      file: { delimiter: ',' as const, headerLine: 1, decimal: '.' as const },
      layout: { kind: 'row_per_set' as const, setOrder: null },
      workoutKey: [],
      exercise: { header: 'Exercise', index: 1 },
      load: { column: { header: 'Weight', index: 2 }, unit: { kind: 'none' as const } },
      reps: { header: 'Reps', index: 3 },
      setType: null,
      rpe: null,
      notes: [],
      unmapped: [],
      selfCheck: [
        { line: 2, date: '2025-11-21', exercise: 'Bench', load: 80, reps: 8 },
        { line: 3, date: '2025-11-03', exercise: 'Bench', load: 80, reps: 8 },
        { line: 4, date: '2025-11-04', exercise: 'Squat', load: 100, reps: 5 },
      ],
    };
    expect(failures(validateImportSpec({ ...base, date: { column: { header: 'Date', index: 0 }, format: 'MM/DD/YYYY' } }, t, OPTS))).toEqual([{ kind: 'date', cell: '21/11/2025', row: 2 }]);
    expect(validateImportSpec({ ...base, date: { column: { header: 'Date', index: 0 }, format: 'DD/MM/YYYY' } }, t, OPTS).ok).toBe(true);
    expect(validateImportSpec({ ...base, date: { column: { header: 'Date', index: 0 }, format: 'day_month_unknown' } }, t, OPTS).ok).toBe(true);
  });
});

describe('check 6: decimal comma', () => {
  const base = (delimiter: ',' | ';') => ({
    ...spec(),
    file: { delimiter, headerLine: 1, decimal: ',' as const },
    layout: { kind: 'row_per_set' as const, setOrder: null },
    workoutKey: [],
    date: { column: { header: 'Date', index: 0 }, format: 'YYYY-MM-DD' as const },
    exercise: { header: 'Exercise', index: 1 },
    load: { column: { header: 'Weight', index: 2 }, unit: { kind: 'none' as const } },
    reps: { header: 'Reps', index: 3 },
    setType: null,
    rpe: null,
    notes: [],
    unmapped: [],
    selfCheck: [
      { line: 2, date: '2025-01-01', exercise: 'Curl', load: 22.5, reps: 8 },
      { line: 3, date: '2025-01-01', exercise: 'Curl', load: 20, reps: 10 },
      { line: 4, date: '2025-01-02', exercise: 'Curl', load: 22.5, reps: 8 },
    ],
  });

  it('a semicolon file reads 22,5 as 22.5', () => {
    const t = readTable('Date;Exercise;Weight;Reps\n2025-01-01;Curl;22,5;8\n2025-01-01;Curl;20;10\n2025-01-02;Curl;22,5;8\n');
    if (!t) throw new Error('table');
    expect(validateImportSpec(base(';'), t, OPTS).ok).toBe(true);
  });

  it('a comma file never reads decimal commas: those rows are unreadable, so the self-check and dry run refuse', () => {
    const t = readTable('Date,Exercise,Weight,Reps\n2025-01-01,Curl,"22,5",8\n2025-01-01,Curl,20,10\n2025-01-02,Curl,"22,5",8\n');
    if (!t) throw new Error('table');
    const f = failures(validateImportSpec(base(','), t, OPTS));
    expect(f).toContainEqual({ kind: 'self_check', row: 2 });
    expect(f).toContainEqual({ kind: 'dry_run', percent: 33 });
  });

  it('three digits after a comma (1,000) turn decimal commas off for the file', () => {
    const t = readTable('Date;Exercise;Weight;Reps\n2025-01-01;Curl;22,5;8\n2025-01-01;Curl;20;10\n2025-01-02;Curl;1,000;8\n');
    if (!t) throw new Error('table');
    expect(failures(validateImportSpec(base(';'), t, OPTS))).toContainEqual({ kind: 'self_check', row: 2 });
  });
});

describe('check 7: self-check', () => {
  it('the coach’s own reading of a row must equal code’s reading under its spec', () => {
    const s = spec();
    const off = { ...s, selfCheck: [{ ...s.selfCheck[0], load: 85 } as (typeof s.selfCheck)[number], ...s.selfCheck.slice(1)] };
    expect(failures(validateImportSpec(off, strong(), OPTS))).toEqual([{ kind: 'self_check', row: 3 }]);
    const noLine = { ...s, selfCheck: [{ ...s.selfCheck[0], line: 999 } as (typeof s.selfCheck)[number], ...s.selfCheck.slice(1)] };
    expect(failures(validateImportSpec(noLine, strong(), OPTS))).toEqual([{ kind: 'self_check', row: 0 }]);
  });

  it('a `3x8` read either way matches (Ben answers the orientation later)', () => {
    const s = specOf('spreadsheet-sets-x-reps.spec.json');
    const other = { ...s, selfCheck: s.selfCheck.map((c) => ({ ...c, reps: c.exercise === 'Bench' ? 3 : c.reps })) };
    expect(validateImportSpec(other, tableOf('spreadsheet-sets-x-reps.synthetic.csv'), OPTS).ok).toBe(true);
  });
});

describe('check 8: dry run', () => {
  it('under 95% of rows read is refused with the percentage', () => {
    const s = { ...spec(), reps: { header: 'Workout Name', index: 2 }, unmapped: spec().unmapped.filter((c) => c.index !== 2), selfCheck: spec().selfCheck };
    const f = failures(validateImportSpec(s, strong(), OPTS));
    expect(f).toContainEqual({ kind: 'dry_run', percent: 0 });
  });
});

describe('check 9: target columns (AI4)', () => {
  it('a result role on a target column is refused', () => {
    expect(failures(validateImportSpec(layoutSpec('template-target.spec.json'), tableOf('template-target.synthetic.csv'), OPTS))).toEqual([{ kind: 'target_column', header: 'Target Reps' }]);
    const lift = specOf('liftosaur-like.spec.json');
    const required = { ...lift, reps: { header: 'Required Reps', index: 5 }, unmapped: lift.unmapped.filter((c) => c.index !== 5).concat([{ header: 'Completed Reps', index: 6 }]) };
    expect(failures(validateImportSpec(required, tableOf('liftosaur-like.synthetic.csv'), OPTS))).toEqual([{ kind: 'target_column', header: 'Required Reps' }]);
  });
});
