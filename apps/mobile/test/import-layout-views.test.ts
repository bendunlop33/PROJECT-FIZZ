import { describe, expect, it } from 'vitest';

import { buildImportSample, buildLayoutReview, readTable, validateImportSpec, type LayoutQuestion, type ValueCheckQuestion } from '@fizz/domain';
import { EMPTY_LAYOUT_ANSWERS, ImportMappingSpecV1Schema, type LayoutAnswers, type SpecCheckFailure } from '@fizz/schemas';

import { importCoachStateOf, type LayoutReviewView, type SampleView } from '../src/import/layout-service';
import {
  checkLayoutView,
  checkReasonText,
  coachLine,
  coachRecheckMs,
  importHistoryView,
  layoutGoesLine,
  needsCoachLine,
  newLayoutView,
  notReadableLine,
  questionScreenView,
  readingResultView,
  resultsLayoutLine,
  roleSheetView,
  savedLayoutRowView,
  sendLine,
  sentView,
  valueCheckView,
} from '../src/import/layout-views';
import { layoutFixture } from './import-layout-helpers';

/** Import from any app, the screens' view-models (§9.2, copy §9.5; checks 39, 46, 49, 51). Minimal copy: values and actions. */
const OPTS = { today: '2026-10-12', tz: 'Europe/London' };
const tableOf = (name: string) => {
  const t = readTable(layoutFixture(name));
  if (!t) throw new Error('table');
  return t;
};
const specOf = (name: string) => ImportMappingSpecV1Schema.parse(JSON.parse(layoutFixture(name)));
const sampleOf = (name: string, hidden: number[] = []): SampleView => {
  const b = buildImportSample(tableOf(name), { hidden });
  return { json: b.json, hash: 'h', chars: b.chars, rows: b.rows, columns: b.columns, hiddenCount: b.columns.filter((c) => c.hidden && c.kind !== 'notes').length, instructions: 'x' };
};
function reviewView(name: string, answers: Partial<LayoutAnswers> = {}): LayoutReviewView {
  const table = tableOf(`${name}.synthetic.csv`);
  const all = { ...EMPTY_LAYOUT_ANSWERS, ...answers };
  return { layoutId: 'l', layoutVersion: 1, fileName: `${name}.csv`, kind: 'coach', profileName: null, review: buildLayoutReview(table, specOf(`${name}.spec.json`), all, OPTS), saved: null, newColumns: [], missing: [], canUndo: false, header: table.header, checks: [] };
}

describe('Import history and the coach line (§9.2.1, §9.3.2)', () => {
  it('lists what works offline and what needs the coach, with the coach’s state in one phrase', () => {
    const v = importHistoryView({ coach: { route: 'chatgpt_plan', state: 'ready' }, savedLayouts: 2, blocked: false });
    expect(v.offline.map((o) => o.text)).toEqual(['FitNotes CSV', 'Saved layouts (2)']);
    expect(v.needsCoach).toEqual(['Other apps and spreadsheets (CSV)']);
    expect(v.coach.line).toMatchObject({ icon: 'checkmark.circle.fill', text: 'Coach: ChatGPT plan' });
    expect(importHistoryView({ coach: { route: null, state: 'not_connected' }, savedLayouts: 0, blocked: true })).toMatchObject({
      offline: [{ text: 'FitNotes CSV' }],
      coach: { line: { icon: 'slash.circle', text: 'Coach: not connected' }, fix: { label: 'Connect ›' } },
      blockLine: 'Finish or discard your workout first.',
      primary: { enabled: false },
    });
  });

  it.each([
    ['offline', 'Needs the coach · offline', null],
    ['not_connected', 'Needs the coach · not connected', 'Connect the coach ›'],
    ['signed_out', 'Needs the coach · signed out', 'Sign in ›'],
    ['limit', 'Needs the coach · usage limit reached', 'Manage usage ›'],
    ['unavailable', 'Needs the coach · try later', null],
    ['model_unavailable', 'Needs the coach · model unavailable', 'Choose model ›'],
  ] as const)('%s: %s, no reset time, no other route', (state, text, fix) => {
    const n = needsCoachLine({ route: 'chatgpt_plan', state });
    expect(n?.line.text).toBe(text);
    expect(n?.fix?.label ?? null).toBe(fix);
    expect(JSON.stringify(n)).not.toMatch(/API key|reset|\$/);
  });

  it('files it can’t read say why in one line', () => {
    expect(notReadableLine('spreadsheet_file')).toBe('Spreadsheet file. Export the sheet as CSV.');
    expect(notReadableLine('pdf_or_image')).toBe('Can’t read PDFs or photos. Export a CSV or paste the text.');
    expect(notReadableLine('no_numbers')).toBe('No numbers to import.');
  });
});

describe('New file layout: the send line is the whole consent (check 39)', () => {
  it('is one line, saying what goes and where; hidden columns are counted', () => {
    expect(sendLine(sampleOf('strong-new-kg.synthetic.csv'))).toBe('↑ Sends column names and 15 sample rows, notes hidden, to ChatGPT.');
    expect(sendLine(sampleOf('strong-new-kg.synthetic.csv', [2, 3]))).toBe('↑ Sends column names and 15 sample rows, notes and 2 columns hidden, to ChatGPT.');
    expect(sendLine(sampleOf('hevy-kg.synthetic.csv'))).toBe('↑ Sends column names and 12 sample rows, to ChatGPT.');
    expect(sendLine(sampleOf('strong-new-kg.synthetic.csv'))).not.toContain('\n');
  });

  it('with the coach unusable: no send line, the first line to share, and the right primary', () => {
    const base = { kind: 'new_table' as const, layoutId: 'l', fileName: 'strong_workouts.csv', columns: 13, rows: 4212, firstLine: '"Workout #";"Date"', reused: false, interrupted: false, damaged: [] };
    const sample = sampleOf('strong-new-kg.synthetic.csv');
    expect(newLayoutView({ ...base, coach: { route: 'chatgpt_plan', state: 'ready' } }, sample)).toMatchObject({ counts: '13 columns · 4,212 rows', firstLine: null, needsCoach: null, primary: { label: 'Read with the coach', enabled: true } });
    expect(newLayoutView({ ...base, coach: { route: 'chatgpt_plan', state: 'offline' } }, sample)).toMatchObject({ sendLine: null, firstLine: '"Workout #";"Date"', primary: { label: 'Read with the coach', enabled: false } });
    expect(newLayoutView({ ...base, coach: { route: null, state: 'not_connected' } }, sample).primary).toEqual({ label: 'Choose another file', enabled: true });
    expect(newLayoutView({ ...base, coach: { route: 'chatgpt_plan', state: 'unavailable' } }, sample).primary).toEqual({ label: 'Try again', enabled: true });
    expect(newLayoutView({ ...base, coach: { route: 'chatgpt_plan', state: 'ready' }, interrupted: true, damaged: ['old layout'] }, sample)).toMatchObject({ notice: 'Interrupted.', damaged: ['⚠ Layout “old layout” is damaged'] });
  });

  it('What’s sent shows the literal text; notes columns can’t be switched on', () => {
    const v = sentView(sampleOf('strong-new-kg.synthetic.csv', [2]));
    expect(v.columns[2]).toEqual({ index: 2, header: '“Workout Name”', state: 'off' });
    expect(v.columns[11]).toEqual({ index: 11, header: '“Notes”', state: 'notes' });
    expect(v.text.startsWith('{"kind":"gymsmarter_import_sample","v":1,"delimiter":";"')).toBe(true);
    expect(v.chars).toMatch(/^[\d,]+ characters$/);
  });
});

describe('Reading results and check reasons (§9.3.3; checks 41, 49)', () => {
  it.each([
    [{ status: 'failed', reason: 'stopped' }, 'Stopped.', 'Read with the coach'],
    [{ status: 'failed', reason: 'interrupted' }, 'Interrupted.', 'Read with the coach'],
    [{ status: 'failed', reason: 'timeout' }, 'No answer in time.', 'Try again'],
    [{ status: 'failed', reason: 'no_layout_returned' }, 'No layout returned.', 'Try again'],
    [{ status: 'unsupported' }, 'No sets found in this file.', 'Choose another file'],
    [{ status: 'unavailable', reason: 'limit' }, 'Needs the coach · usage limit reached', 'Choose another file'],
  ] as const)('%j → %s', (r, text, primary) => {
    const v = readingResultView(r);
    expect(v.status?.text).toBe(text);
    expect(v.primary?.label).toBe(primary);
  });

  it('a refusal says nothing was sent, never `No layout returned.` (rule 1, review S2)', () => {
    expect(readingResultView({ status: 'refused', reason: 'not_found' })).toMatchObject({ status: { text: 'Choose the file again.' }, primary: { label: 'Choose another file', action: 'choose' }, next: null });
    // The text shown changed: back to the consent with the text as it is now, no status line.
    expect(readingResultView({ status: 'refused', reason: 'sample_changed' })).toEqual({ status: null, reasons: [], primary: null, fix: null, next: 'consent' });
    expect(readingResultView({ status: 'refused', reason: 'workout_unfinished' })).toMatchObject({ status: { text: 'Finish or discard your workout first.' }, primary: null });
    for (const reason of ['not_found', 'sample_changed', 'workout_unfinished'] as const) expect(JSON.stringify(readingResultView({ status: 'refused', reason }))).not.toContain('No layout returned');
  });

  it('every reason comes from the fixed list, with only file text and numbers', () => {
    const all: SpecCheckFailure[] = [
      { kind: 'schema' },
      { kind: 'unknown_column', header: 'Weight' },
      { kind: 'unknown_column', header: '' },
      { kind: 'two_roles', header: 'Reps' },
      { kind: 'unit_token', token: 'kg' },
      { kind: 'unit_column', header: 'Unit' },
      { kind: 'marker', token: '' },
      { kind: 'date', cell: '21/11/2025', row: 4 },
      { kind: 'self_check', row: 1204 },
      { kind: 'dry_run', percent: 61 },
      { kind: 'target_column', header: 'Target Reps' },
    ];
    expect(all.map(checkReasonText)).toEqual([
      'Its answer wasn’t in the expected form.',
      'It names a column “Weight” that isn’t in the file.',
      'It names a column that isn’t in the file.',
      'It uses “Reps” for two things.',
      '“kg” isn’t in the column name.',
      'Not every value in “Unit” is kg or lb.',
      'Its marker isn’t in the file.',
      'Its dates don’t fit “21/11/2025” (row 4).',
      'Its reading of row 1,204 doesn’t match its layout.',
      '61% of rows can be read. 95% is needed.',
      'It puts results in a target column, “Target Reps”.',
    ]);
  });

  it('a hostile spec’s link and "all checked, tap Import" never show (check 49)', () => {
    const v = validateImportSpec(JSON.parse(layoutFixture('hostile.spec.json')), tableOf('strong-new-kg.synthetic.csv'), OPTS);
    if (v.ok || v.unsupported) throw new Error('should be refused');
    const shown = JSON.stringify(readingResultView({ status: 'rejected', reasons: v.failures }));
    expect(shown).not.toMatch(/tap Import|invalid|all checked/i);
    expect(shown).toContain('Layout didn’t pass the checks');
  });
});

describe('Check the layout (§9.2.5)', () => {
  it('Strong: named columns, the coach’s marker Checks, examples with ? for what waits', () => {
    const v = checkLayoutView(reviewView('strong-new-kg'), 'en-GB');
    expect(v.readLine.text).toBe('15 of 15 rows read');
    expect(v.questionsTitle).toBe('Needs your answer (3)');
    expect(v.questions.map((q) => [q.title, q.answer, q.check])).toEqual([
      ['What is this file?', null, false],
      ['“W” · 1 row', 'Warm-up?', true],
      ['“D” · 1 row', 'Drop set?', true],
    ]);
    expect(v.columns.slice(0, 2)).toEqual([
      { index: 0, header: '“Workout #”', role: 'Which workout', state: 'named', detail: null },
      { index: 1, header: '“Date”', role: 'Start time', state: 'named', detail: null },
    ]);
    expect(v.columns[6]).toMatchObject({ header: '“Weight (kg)”', role: 'Load', state: 'named', detail: 'kg' });
    expect(v.examples[0]).toEqual({ label: 'Row 2', source: '1 · 2025-03-04 07:10:00 · Push · 3600 · Bench Press (Barbell) · W · 40 · 10 · Early session before work, felt a bit stiff', reading: '→ 4 Mar 2025 07:10 · Bench Press (Barbell) · 40\u00a0kg × 10 · ?' });
    expect(v.primary).toEqual({ label: 'Answer 3 questions to continue', enabled: false });
  });

  it('once answered, `Use this layout`; a plan imports nothing', () => {
    const done = checkLayoutView(reviewView('strong-new-kg', { recordKind: 'done', markers: { W: 'warmup', D: 'drop' } }), 'en-GB');
    expect(done.primary).toEqual({ label: 'Use this layout', enabled: true });
    expect(done.examples[0]?.reading).toBe('→ 4 Mar 2025 07:10 · Bench Press (Barbell) · 40\u00a0kg × 10 · Warm-up');
    const plan = checkLayoutView(reviewView('strong-new-kg', { recordKind: 'plan', markers: { W: 'warmup', D: 'drop' } }), 'en-GB');
    expect(plan).toMatchObject({ plan: 'Plans aren’t imported.', primary: { label: 'Choose another file' } });
  });

  it('`3x8` rendered both ways from a real row (check 46); dates asked with both readings', () => {
    const r = reviewView('spreadsheet-sets-x-reps');
    const q = (k: LayoutQuestion['kind']) => r.review.questions.find((x) => x.kind === k) as LayoutQuestion;
    expect(questionScreenView(q('notation'), 'en-GB')).toEqual({
      title: 'What “3x8” means',
      lines: ['Row 2: “3x8”, weight 100'],
      options: [
        { value: 'sets_x_reps', label: '3 sets of 8', detail: '→ 100 × 8, 100 × 8, 100 × 8', selected: false },
        { value: 'reps_x_sets', label: '8 sets of 3', detail: '→ 8 sets of 100 × 3', selected: false },
      ],
    });
    expect(questionScreenView(q('date_order'), 'en-GB').options.map((o) => [o.label, o.detail, o.selected])).toEqual([
      ['Day first: 3 Nov 2025', '3 Nov 2025 – 12 Nov 2025', false],
      ['Month first: 11 Mar 2025', '11 Mar 2025 – 11 Dec 2025', false],
    ]);
    expect(questionScreenView(q('unit'), 'en-GB')).toEqual({ title: 'Weight unit', lines: ['Values: 55 to 165'], options: [{ value: 'kg', label: 'kg', detail: null, selected: false }, { value: 'lb', label: 'lb', detail: null, selected: false }] });
    expect(questionScreenView(q('record_kind'), 'en-GB').options.map((o) => o.selected)).toEqual([false, false]);
  });

  it('the wide file asks `Weight unit` with the loads read from the cells; answered, `Use this layout` (review B1)', () => {
    const fresh = checkLayoutView(reviewView('spreadsheet-wide'), 'en-GB');
    expect(fresh.questions.map((q) => q.title)).toEqual(['What is this file?', 'Weight unit', 'What “100x8” means']);
    const r = reviewView('spreadsheet-wide', { recordKind: 'done', notation: { '2': 'load_x_reps' } });
    const unit = r.review.questions.find((x) => x.kind === 'unit') as LayoutQuestion;
    expect(questionScreenView(unit, 'en-GB').lines).toEqual(['Values: 0 to 140']);
    expect(checkLayoutView(r, 'en-GB')).toMatchObject({ questionsTitle: 'Needs your answer (1)', stuckLine: null, primary: { label: 'Answer 1 question to continue', enabled: false } });
    const done = checkLayoutView(reviewView('spreadsheet-wide', { recordKind: 'done', notation: { '2': 'load_x_reps' }, unit: 'kg' }), 'en-GB');
    expect(done).toMatchObject({ questionsTitle: null, stuckLine: null, primary: { label: 'Use this layout', enabled: true } });
    expect(done.examples[0]?.reading).toBe('→ 1 Sept 2025 · Bench Press · 100\u00a0kg × 8, 100\u00a0kg × 8, 100\u00a0kg × 7');
  });

  it('slash dates in both orders ask the order (review r2 S1); the stuck backstop is never silent (review B1)', () => {
    const text = 'Date,Exercise,Weight (kg),Reps\n21/11/2025,Bench,100,8\n11/21/2025,Bench,100,8\n03/04/2025,Bench,100,8\n';
    const table = readTable(text);
    if (!table) throw new Error('table');
    const spec = ImportMappingSpecV1Schema.parse({
      specVersion: 1,
      file: { delimiter: ',', headerLine: 1, decimal: '.' },
      layout: { kind: 'row_per_set', setOrder: null },
      workoutKey: [],
      date: { column: { header: 'Date', index: 0 }, format: 'DD/MM/YYYY' },
      exercise: { header: 'Exercise', index: 1 },
      load: { column: { header: 'Weight (kg)', index: 2 }, unit: { kind: 'header_token', column: { header: 'Weight (kg)', index: 2 }, token: 'kg' } },
      reps: { header: 'Reps', index: 3 },
      setType: null,
      rpe: null,
      notes: [],
      unmapped: [],
      selfCheck: [1, 2, 3].map((n) => ({ line: n + 1, date: '2025-11-21', exercise: 'Bench', load: 100, reps: 8 })),
      unsupported: null,
    });
    let answers: LayoutAnswers = { ...EMPTY_LAYOUT_ANSWERS, recordKind: 'done' };
    const roles: Record<string, LayoutAnswers['roles'][string]> = {};
    for (const c of buildLayoutReview(table, spec, answers, OPTS).columns) if (c.state === 'check') roles[String(c.index)] = c.role;
    answers = { ...answers, roles };
    const review = buildLayoutReview(table, spec, answers, OPTS);
    const base = { layoutId: 'l', layoutVersion: 1, fileName: 'log.csv', kind: 'coach' as const, profileName: null, review, saved: null, newColumns: [], missing: [], canUndo: false, header: table.header, checks: [] };
    expect(review).toMatchObject({ open: 1, stuck: 0 });
    expect(checkLayoutView(base, 'en-GB').questions.map((q) => q.title)).toContain('Dates like “03/04/2025”');
    expect(checkLayoutView(base, 'en-GB').stuckLine).toBeNull();
    // Answered: the `11/21` row is not read (listed), and 2 of 3 is under 95%.
    const answered = buildLayoutReview(table, spec, { ...answers, dateOrder: 'day_first' }, OPTS);
    const a = checkLayoutView({ ...base, review: answered }, 'en-GB');
    expect(answered).toMatchObject({ open: 0, pending: 0, stuck: 0 });
    expect(a.notReadLine).toBe('1 row not read');
    expect(a.primary.enabled).toBe(false);
    // The backstop: any row still waiting on nothing the screen asks is counted and said.
    const v = checkLayoutView({ ...base, review: { ...answered, stuck: 2, pending: 2, ready: false } }, 'en-GB');
    expect(v.stuckLine).toMatchObject({ tone: 'warning', text: '2 rows can’t be read with this layout.' });
    expect(v.primary.enabled).toBe(false);
  });

  it('a coach layout offers `Read with the coach again`; a saved one doesn’t (§9.3.4)', () => {
    expect(checkLayoutView(reviewView('strong-new-kg'), 'en-GB').readAgain).toBe('Read with the coach again');
    expect(checkLayoutView({ ...reviewView('strong-new-kg'), kind: 'saved' }, 'en-GB').readAgain).toBeNull();
  });

  it('the role sheet: a Check column has nothing selected and shows the suggestion', () => {
    const r = reviewView('liftosaur-like');
    const values = tableOf('liftosaur-like.synthetic.csv').records.map((x) => x.cells[6] ?? '');
    const sheet = roleSheetView(r, 6, values);
    expect(sheet.header).toBe('“Completed Reps”');
    expect(sheet.values).toBe('3, 5, 10, 9');
    expect(sheet.options.filter((o) => o.selected)).toEqual([]);
    expect(sheet.options.find((o) => o.suggested)?.label).toBe('Reps');
  });
});

describe('Values to check, saved layouts, results (§9.2.6, §9.2.9, §9.2.10)', () => {
  it('shows file values, never a ratio', () => {
    const q: ValueCheckQuestion = { key: 'k', workoutKey: '2025-06-12', date: '2025-06-12', name: 'Bench Press (Barbell)', nameKey: 'bench press (barbell)', value: 225, reps: 5, unit: 'kg', before: { value: 100, reps: 5, date: '2025-06-10' }, sets: 5, answer: null };
    expect(valueCheckView(q, 'en-GB')).toEqual({ title: 'Bench Press (Barbell) · 12 Jun 2025', line: '225 × 5 · before: 100 × 5', skip: 'Skip these 5 sets', answer: null });
  });

  it('saved layout rows and lines', () => {
    expect(savedLayoutRowView({ id: 'i', name: 'strong_workouts', columns: 13, unit: 'kg', imports: 2, lastUsed: { utc: '2026-10-01T09:00:00.000Z', tz: 'Europe/London' }, state: 'in_use', version: 2 }, 'en-GB')).toEqual({ title: 'strong_workouts', subtitle: '13 columns · kg · 2 imports · 1 Oct', state: null });
    expect(savedLayoutRowView({ id: 'i', name: 'x', columns: 5, unit: null, imports: 0, lastUsed: null, state: 'not_in_use', version: 1 }).state?.text).toBe('Not in use: its import was undone');
    expect(layoutGoesLine('strong_workouts')).toBe('The layout “strong_workouts” goes too.');
    expect(resultsLayoutLine({ kind: 'coach', profileName: 'strong_workouts', savedProfileId: 'p' })).toBe('Layout saved: strong_workouts');
    expect(resultsLayoutLine({ kind: 'saved', profileName: 'strong_workouts', savedProfileId: null })).toBe('Layout: strong_workouts');
  });

  it('the coach line never names another route', () => {
    for (const state of ['ready', 'not_connected', 'offline', 'signed_out', 'limit', 'unavailable', 'model_unavailable'] as const) {
      expect(JSON.stringify(coachLine({ route: 'chatgpt_plan', state }))).not.toMatch(/API key|OpenAI/);
    }
  });
});

describe('coach states that aren’t `not connected` (review r3 N2, N3)', () => {
  it('an account or region that can’t be used says so, with the connection screen as its fix', () => {
    expect(importCoachStateOf('not_eligible', true)).toBe('not_eligible');
    expect(importCoachStateOf('region', true)).toBe('not_eligible');
    expect(importCoachStateOf('not_connected', true)).toBe('not_connected');
    expect(coachLine({ route: 'chatgpt_plan', state: 'not_eligible' }).line.text).toBe('Coach: this account can’t be used');
    expect(needsCoachLine({ route: 'chatgpt_plan', state: 'not_eligible' })).toMatchObject({ line: { text: 'Needs the coach · this account can’t be used' }, fix: { label: 'Connect the coach ›' } });
  });

  it('offline and unavailable are read again until the coach can read; other states wait for Ben', () => {
    expect(coachRecheckMs('offline')).toBe(15_000);
    expect(coachRecheckMs('unavailable')).toBe(15_000);
    for (const st of ['ready', 'not_connected', 'signed_out', 'limit', 'model_unavailable', 'not_eligible'] as const) expect(coachRecheckMs(st)).toBeNull();
  });
});
