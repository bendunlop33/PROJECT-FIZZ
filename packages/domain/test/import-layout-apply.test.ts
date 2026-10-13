import { describe, expect, it } from 'vitest';
import { EMPTY_LAYOUT_ANSWERS, ImportMappingSpecV1Schema, type CellNotation, type ImportMappingSpecV1, type LayoutAnswers } from '@fizz/schemas';
import { applyImportSpec, buildLayoutReview, readDateCell, readTable, validateImportSpec, type LayoutQuestion, type Table } from '../src';
import { OPTS, answerAll, specOf, tableOf } from './layout-fixtures';

/** `applyImportSpec`: code reads every row (AI2; checks 46, 51, 52). */
const notationQ = (qs: readonly LayoutQuestion[]) => qs.find((q): q is Extract<LayoutQuestion, { kind: 'notation' }> => q.kind === 'notation');

describe('`3x8` (check 46)', () => {
  const t = tableOf('spreadsheet-sets-x-reps.synthetic.csv');
  const s = specOf('spreadsheet-sets-x-reps.spec.json');

  it('asks what it means, with both readings rendered from a real row, nothing selected', () => {
    const q = notationQ(buildLayoutReview(t, s, EMPTY_LAYOUT_ANSWERS, OPTS).questions);
    expect(q).toMatchObject({ column: 3, header: 'Sets x Reps', role: 'sets_reps', answer: null, example: { row: 2, cell: '3x8', load: '100' } });
    expect(q?.options).toEqual([
      { answer: 'sets_x_reps', sets: [{ load: null, reps: 8 }, { load: null, reps: 8 }, { load: null, reps: 8 }] },
      { answer: 'reps_x_sets', sets: Array.from({ length: 8 }, () => ({ load: null, reps: 3 })) },
    ]);
  });

  it('the answer changes the set count; loads come from the Weight column as written', () => {
    const a = answerAll('spreadsheet-sets-x-reps', { notation: { '3': 'sets_x_reps' } }).answers;
    const b = answerAll('spreadsheet-sets-x-reps', { notation: { '3': 'reps_x_sets' } }).answers;
    const rowsA = applyImportSpec(s, a, t, OPTS).rows.filter((r) => r.line === 2);
    const rowsB = applyImportSpec(s, b, t, OPTS).rows.filter((r) => r.line === 2);
    expect(rowsA.map((r) => [r.part, r.weight?.value, r.reps])).toEqual([
      [0, 100, 8],
      [1, 100, 8],
      [2, 100, 8],
    ]);
    expect(rowsB).toHaveLength(8);
    expect(rowsB.every((r) => r.reps === 3 && r.weight?.value === 100)).toBe(true);
  });

  it('dates whose first field is never above 12 ask day/month order, and the answer changes the dates', () => {
    const r = buildLayoutReview(t, s, EMPTY_LAYOUT_ANSWERS, OPTS);
    const q = r.questions.find((x) => x.kind === 'date_order');
    expect(q).toEqual({
      kind: 'date_order',
      answer: null,
      cell: '03/11/2025',
      dayFirst: { date: '2025-11-03', first: '2025-11-03', last: '2025-11-12' },
      monthFirst: { date: '2025-03-11', first: '2025-03-11', last: '2025-12-11' },
    });
    const day = applyImportSpec(s, answerAll('spreadsheet-sets-x-reps', { dateOrder: 'day_first' }).answers, t, OPTS).rows[0];
    const month = applyImportSpec(s, answerAll('spreadsheet-sets-x-reps', { dateOrder: 'month_first' }).answers, t, OPTS).rows[0];
    expect([day?.date, month?.date]).toEqual(['2025-11-03', '2025-03-11']);
  });

  it('a date above 12 settles the order; it isn’t asked', () => {
    const text = 'Date,Exercise,Weight,Sets x Reps\n21/11/2025,Bench,100,3x8\n03/11/2025,Bench,100,3x8\n';
    const tt = readTable(text);
    if (!tt) throw new Error('table');
    const r = buildLayoutReview(tt, { ...s, notes: [] }, EMPTY_LAYOUT_ANSWERS, OPTS);
    expect(r.questions.some((q) => q.kind === 'date_order')).toBe(false);
    expect(r.dateOrder).toEqual({ order: 'day_first', settledBy: '21/11/2025' });
  });

  it('rows wait while any answer is open: nothing is read from a guess', () => {
    expect(applyImportSpec(s, { ...EMPTY_LAYOUT_ANSWERS, recordKind: 'done' }, t, OPTS)).toMatchObject({ rows: [], pending: 10 });
  });
});

describe('wide set columns (`Set 1 … Set 4`, `100x8`)', () => {
  const t = tableOf('spreadsheet-wide.synthetic.csv');
  const s = specOf('spreadsheet-wide.spec.json');

  it('one notation question for every `Set n` column', () => {
    const qs = buildLayoutReview(t, s, EMPTY_LAYOUT_ANSWERS, OPTS).questions;
    expect(qs.filter((q) => q.kind === 'notation')).toHaveLength(1);
    expect(notationQ(qs)?.options.map((o) => o.sets)).toEqual([[{ load: 100, reps: 8 }], [{ load: 8, reps: 100 }]]);
  });

  it('`100 × 8` gives one set per filled cell, with its own load; empty cells give none', () => {
    const { answers, review } = answerAll('spreadsheet-wide', { notation: { '2': 'load_x_reps' } });
    expect(review.ready).toBe(true);
    const rows = applyImportSpec(s, answers, t, OPTS).rows;
    expect(rows.filter((r) => r.line === 2).map((r) => [r.part, r.weight, r.reps])).toEqual([
      [0, { value: 100, unit: 'kg' }, 8],
      [1, { value: 100, unit: 'kg' }, 8],
      [2, { value: 100, unit: 'kg' }, 7],
    ]);
    expect(rows.filter((r) => r.line === 4)).toHaveLength(4);
    // Bodyweight written as 0: a weight of 0 as written.
    expect(rows.find((r) => r.line === 7)?.weight).toEqual({ value: 0, unit: 'kg' });
  });

  it('the wide file has no unit: `Weight unit` is asked, and rows wait only until it is answered (B1, check 44)', () => {
    const r = buildLayoutReview(t, s, EMPTY_LAYOUT_ANSWERS, OPTS);
    expect(r.questions.map((q) => q.kind)).toEqual(['record_kind', 'unit', 'notation']);
    // Before the notation is answered no load is read yet: no range to show.
    expect(r.questions.find((q) => q.kind === 'unit')).toEqual({ kind: 'unit', answer: null, range: null });
    const after = buildLayoutReview(t, s, { ...EMPTY_LAYOUT_ANSWERS, recordKind: 'done', notation: { '2': 'load_x_reps' } }, OPTS);
    expect(after.pending).toBe(6);
    // The range comes from the loads read from the cells.
    expect(after.questions.find((q) => q.kind === 'unit')).toEqual({ kind: 'unit', answer: null, range: { min: 0, max: 140 } });
    expect(after).toMatchObject({ open: 1, stuck: 0, ready: false });
    const done = buildLayoutReview(t, s, { ...EMPTY_LAYOUT_ANSWERS, recordKind: 'done', notation: { '2': 'load_x_reps' }, unit: 'lb' }, OPTS);
    expect(done).toMatchObject({ open: 0, pending: 0, stuck: 0, ready: true });
    expect(applyImportSpec(s, { ...EMPTY_LAYOUT_ANSWERS, recordKind: 'done', notation: { '2': 'load_x_reps' }, unit: 'lb' }, t, OPTS).rows[0]?.weight).toEqual({ value: 100, unit: 'lb' });
  });
});

/** Ben's `Use this` on every column still on `Check`. */
function confirmed(table: Table, spec: ImportMappingSpecV1, answers: LayoutAnswers): LayoutAnswers {
  const roles = { ...answers.roles };
  for (const c of buildLayoutReview(table, spec, answers, OPTS).columns) if (c.state === 'check') roles[String(c.index)] = c.role;
  return { ...answers, roles };
}

/** A packed file with no `Weight` column (`3x8 @ 100`, `100x5,100x5`): loads come from the cells, so the unit is asked. */
function packedSpec(header: string, notation: CellNotation, over: Record<string, unknown> = {}): ImportMappingSpecV1 {
  const row = (line: number) => ({ line, date: '2025-09-01', exercise: 'x', load: null, reps: null });
  return ImportMappingSpecV1Schema.parse({
    specVersion: 1,
    file: { delimiter: ',', headerLine: 1, decimal: '.' },
    layout: { kind: 'row_per_exercise_packed', sets: { header, index: 2 }, notation },
    workoutKey: [],
    date: { column: { header: 'Date', index: 0 }, format: 'YYYY-MM-DD' },
    exercise: { header: 'Exercise', index: 1 },
    load: null,
    reps: null,
    setType: null,
    rpe: null,
    notes: [],
    unmapped: [],
    selfCheck: [row(2), row(3), row(4)],
    unsupported: null,
    ...over,
  });
}

describe('packed cells that carry their own loads (B1)', () => {
  it('`3x8 @ 100` with no Weight column asks `Weight unit`; answered, every row is read in that unit', () => {
    const tt = tableOf('spreadsheet-packed-at.synthetic.csv');
    const s = specOf('spreadsheet-packed-at.spec.json');
    expect(validateImportSpec(s, tt, OPTS).ok).toBe(true);
    const fresh = buildLayoutReview(tt, s, EMPTY_LAYOUT_ANSWERS, OPTS);
    expect(fresh.questions.map((q) => q.kind)).toEqual(['record_kind', 'unit', 'notation']);
    const noUnit = buildLayoutReview(tt, s, confirmed(tt, s, { ...EMPTY_LAYOUT_ANSWERS, recordKind: 'done', notation: { '2': 'sets_x_reps' } }), OPTS);
    expect(noUnit).toMatchObject({ open: 1, pending: 4, stuck: 0, ready: false });
    expect(noUnit.questions.find((q) => q.kind === 'unit')).toMatchObject({ range: { min: 12.5, max: 140 } });
    const answers = confirmed(tt, s, { ...EMPTY_LAYOUT_ANSWERS, recordKind: 'done', notation: { '2': 'sets_x_reps' }, unit: 'kg' });
    expect(buildLayoutReview(tt, s, answers, OPTS)).toMatchObject({ open: 0, pending: 0, ready: true });
    const rows = applyImportSpec(s, answers, tt, OPTS).rows;
    expect(rows).toHaveLength(3 + 3 + 5 + 3);
    expect(rows.find((r) => r.exercise === 'Dumbbell Curl')?.weight).toEqual({ value: 12.5, unit: 'kg' });
  });

  it('`3x8` with no load anywhere asks no unit', () => {
    const tt = readTable('Date,Exercise,Sets\n2025-09-01,Pull Up,3x8\n2025-09-03,Dip,3x10\n');
    if (!tt) throw new Error('table');
    expect(buildLayoutReview(tt, packedSpec('Sets', 'sets_x_reps'), EMPTY_LAYOUT_ANSWERS, OPTS).questions.some((q) => q.kind === 'unit')).toBe(false);
  });

  it('`100x5,100x5,100x3` all-sets cells with no Weight column ask the unit', () => {
    const tt = readTable('Date,Exercise,Sets\n2025-09-01,Bench,"100x5,100x5,100x3"\n2025-09-03,Squat,"140x5,140x5"\n');
    if (!tt) throw new Error('table');
    const s = packedSpec('Sets', 'load_x_reps');
    expect(buildLayoutReview(tt, s, EMPTY_LAYOUT_ANSWERS, OPTS).questions.map((q) => q.kind)).toContain('unit');
    const answers = confirmed(tt, s, { ...EMPTY_LAYOUT_ANSWERS, recordKind: 'done', notation: { '2': 'load_x_reps' }, unit: 'lb' });
    expect(buildLayoutReview(tt, s, answers, OPTS)).toMatchObject({ open: 0, pending: 0, ready: true });
    expect(applyImportSpec(s, answers, tt, OPTS).rows.map((r) => r.weight?.unit)).toEqual(['lb', 'lb', 'lb', 'lb', 'lb']);
  });
});

describe('never stuck in silence: open 0 with rows pending always says why', () => {
  const fixtures = ['hevy-kg', 'hevy-lbs', 'hevy-assisted', 'strong-new-kg', 'strong-old', 'spreadsheet-sets-x-reps', 'spreadsheet-wide', 'spreadsheet-packed-at', 'liftosaur-like'];
  it.each(fixtures)('%s: answering every question on the screen leaves no row pending', (name) => {
    const { review } = answerAll(name);
    expect(review.open).toBe(0);
    expect(review.pending).toBe(0);
    expect(review.stuck).toBe(0);
  });

  it('slash dates no single order reads (`21/11` and `11/21`): the rows are counted as stuck, not left silent', () => {
    const tt = readTable('Date,Exercise,Weight (kg),Reps\n21/11/2025,Bench,100,8\n11/21/2025,Bench,100,8\n03/04/2025,Bench,100,8\n');
    if (!tt) throw new Error('table');
    const spec = packedSpec('Reps', 'sets_x_reps', {
      layout: { kind: 'row_per_set', setOrder: null },
      date: { column: { header: 'Date', index: 0 }, format: 'DD/MM/YYYY' },
      load: { column: { header: 'Weight (kg)', index: 2 }, unit: { kind: 'header_token', column: { header: 'Weight (kg)', index: 2 }, token: 'kg' } },
      reps: { header: 'Reps', index: 3 },
    });
    const r = buildLayoutReview(tt, spec, confirmed(tt, spec, { ...EMPTY_LAYOUT_ANSWERS, recordKind: 'done' }), OPTS);
    expect(r.questions.some((q) => q.kind === 'date_order')).toBe(false);
    expect(r).toMatchObject({ open: 0, pending: 2, stuck: 2, ready: false });
  });
});

describe('dates, times and zones (AI6)', () => {
  it('Hevy `22 Dec 2025, 08:00`: two workouts on one date are two workout keys with their times as written', () => {
    const { answers } = answerAll('hevy-kg');
    const rows = applyImportSpec(specOf('hevy-kg.spec.json'), answers, tableOf('hevy-kg.synthetic.csv'), OPTS).rows;
    const day = rows.filter((r) => r.date === '2025-12-22');
    expect([...new Set(day.map((r) => r.workoutKey))]).toEqual(['2025-12-22T08:00:00', '2025-12-22T17:30:00']);
    expect([...new Set(day.map((r) => r.startLocal))]).toEqual(['08:00', '17:30']);
  });

  it('Strong `Workout #` keys each workout, whatever its time', () => {
    const { answers } = answerAll('strong-new-kg');
    const rows = applyImportSpec(specOf('strong-new-kg.spec.json'), answers, tableOf('strong-new-kg.synthetic.csv'), OPTS).rows;
    const keys = [...new Set(rows.filter((r) => r.date === '2025-03-04').map((r) => r.workoutKey))];
    expect(keys).toHaveLength(2);
    expect(keys.every((k) => k?.startsWith('2025-03-04~'))).toBe(true);
  });

  it('a file with dates only keys workouts by date', () => {
    const { answers } = answerAll('spreadsheet-wide', { notation: { '2': 'load_x_reps' } });
    const rows = applyImportSpec(specOf('spreadsheet-wide.spec.json'), answers, tableOf('spreadsheet-wide.synthetic.csv'), OPTS).rows;
    expect([...new Set(rows.map((r) => r.workoutKey))]).toEqual(['2025-09-01', '2025-09-03', '2025-09-05']);
    expect(rows.every((r) => r.startLocal === null)).toBe(true);
  });

  it('unix seconds are read in the import’s zone (the date can differ by zone)', () => {
    // 2025-01-01T23:30:00Z
    const cell = '1735774200';
    expect(readDateCell(cell, 'unix_seconds', { order: null, tz: 'Europe/London' })).toEqual({ date: '2025-01-01', time: '23:30', timeFull: '23:30:00' });
    expect(readDateCell(cell, 'unix_seconds', { order: null, tz: 'Pacific/Auckland' })).toEqual({ date: '2025-01-02', time: '12:30', timeFull: '12:30:00' });
  });

  it('closed formats are strict: no zone suffix, no impossible dates, English months only', () => {
    expect(readDateCell('2025-02-30', 'YYYY-MM-DD', { order: null, tz: 'UTC' })).toBeNull();
    expect(readDateCell('2025-03-04T07:10:00Z', 'YYYY-MM-DDTHH:mm:ss', { order: null, tz: 'UTC' })).toBeNull();
    expect(readDateCell('22 Dez 2025, 08:00', 'D MMM YYYY, HH:mm', { order: null, tz: 'UTC' })).toBeNull();
    expect(readDateCell('22 September 2025, 08:00', 'D MMM YYYY, HH:mm', { order: null, tz: 'UTC' })?.date).toBe('2025-09-22');
    expect(readDateCell('03/04/2025', 'day_month_unknown', { order: null, tz: 'UTC' })).toBeNull();
  });
});

describe('hard limits (AI13, check 51)', () => {
  const text = [
    'Date,Exercise,Weight (kg),Reps',
    '2025-01-01,Bench,80,8',
    '2025-01-01,Bench,80,1001',
    '2025-01-01,Leg Press,1600,10',
    '1999-12-31,Bench,80,8',
    '2026-12-01,Bench,80,8',
    ...Array.from({ length: 20 }, (_, i) => `2025-01-${String(i + 2).padStart(2, '0')},Bench,80,8`),
  ].join('\n');
  const t = readTable(text);
  if (!t) throw new Error('table');
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
      { line: 2, date: '2025-01-01', exercise: 'Bench', load: 80, reps: 8 },
      { line: 7, date: '2025-01-02', exercise: 'Bench', load: 80, reps: 8 },
      { line: 8, date: '2025-01-03', exercise: 'Bench', load: 80, reps: 8 },
    ],
    unsupported: null,
  };

  it('make rows unreadable with their reason, and count as read in the dry run', () => {
    const v = validateImportSpec(spec, t, OPTS);
    expect(v.ok).toBe(true);
    const rows = applyImportSpec(spec, { ...EMPTY_LAYOUT_ANSWERS, recordKind: 'done' }, t, OPTS).rows;
    expect(rows.filter((r) => r.rowClass === 'unreadable').map((r) => [r.line, r.problem])).toEqual([
      [3, 'Over 1,000 reps'],
      [4, 'Over 1,500 kg'],
      [5, 'Before 2000'],
      [6, 'After today'],
    ]);
  });

  it('the lb limit is 3,000 lb (never converted)', () => {
    const lb = readTable(text.replace('Weight (kg)', 'Weight (lb)').replace('1600', '2900'));
    if (!lb) throw new Error('table');
    const s = { ...spec, load: { column: { header: 'Weight (lb)', index: 2 }, unit: { kind: 'header_token' as const, column: { header: 'Weight (lb)', index: 2 }, token: 'lb' as const } } };
    const rows = applyImportSpec(s, { ...EMPTY_LAYOUT_ANSWERS, recordKind: 'done' }, lb, OPTS).rows;
    expect(rows.find((r) => r.line === 4)).toMatchObject({ rowClass: 'strength', weight: { value: 2900, unit: 'lb' } });
  });
});
