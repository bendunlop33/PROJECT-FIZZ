import { describe, expect, it } from 'vitest';
import { EMPTY_LAYOUT_ANSWERS, type LayoutAnswers } from '@fizz/schemas';
import { applyImportSpec, buildLayoutReview, displacedBy, roleRefusal, type LayoutQuestion } from '../src';
import { OPTS, answerAll, specOf, tableOf } from './layout-fixtures';

/** Check the layout (§9.2.5; checks 43, 44, 45, 50). Nothing is ever pre-selected. */
const review = (name: string, answers: Partial<LayoutAnswers> = {}) => buildLayoutReview(tableOf(`${name}.synthetic.csv`), specOf(`${name}.spec.json`), { ...EMPTY_LAYOUT_ANSWERS, ...answers }, OPTS);
const kinds = (qs: readonly LayoutQuestion[]) => qs.map((q) => (q.kind === 'marker' ? `marker:${q.marker.token}:${q.marker.state}` : q.kind));

describe('columns: named by the header, or the coach’s Check (AI3, check 43)', () => {
  it('Strong (new): every value column is named by its header; the W and D markers are the coach’s Checks', () => {
    const r = review('strong-new-kg');
    expect(r.columns.filter((c) => c.state === 'named').map((c) => c.header)).toEqual(['Workout #', 'Date', 'Exercise Name', 'Set Order', 'Weight (kg)', 'Reps', 'RPE']);
    expect(r.columns.find((c) => c.header === 'Date')?.role).toBe('start_time');
    expect(r.checks).toBe(0);
    expect(kinds(r.questions)).toEqual(['record_kind', 'marker:W:check', 'marker:D:check']);
    expect(r.unit).toEqual({ unit: 'kg', source: 'header', token: 'kg' });
    expect(r.open).toBe(3);
    // The W and D rows wait for Use this; the others read.
    expect(r.pending).toBe(2);
    expect(r.ready).toBe(false);
  });

  it('Liftosaur-like: `Completed …` columns are Checks; their rows stay pending until Use this', () => {
    const t = tableOf('liftosaur-like.synthetic.csv');
    const s = specOf('liftosaur-like.spec.json');
    const r = buildLayoutReview(t, s, { ...EMPTY_LAYOUT_ANSWERS, recordKind: 'done' }, OPTS);
    expect(r.columns.filter((c) => c.state === 'check').map((c) => c.header)).toEqual(['Completed Reps', 'Completed RPE', 'Completed Weight Value', 'Completed Weight Unit']);
    expect(applyImportSpec(s, { ...EMPTY_LAYOUT_ANSWERS, recordKind: 'done' }, t, OPTS)).toMatchObject({ rows: [], pending: 8 });
    const confirmed = answerAll('liftosaur-like');
    expect(confirmed.review.ready).toBe(true);
    const rows = applyImportSpec(s, confirmed.answers, t, OPTS).rows;
    expect(rows.map((x) => [x.exercise, x.weight, x.reps])).toEqual([
      ['Squat', { value: 120, unit: 'kg' }, 3],
      ['Squat', { value: 120, unit: 'kg' }, 3],
      ['Squat', { value: 120, unit: 'kg' }, 5],
      ['Bench Press', { value: 60, unit: 'kg' }, 10],
      ['Bench Press', { value: 60, unit: 'kg' }, 9],
      ['Overhead Press', { value: 45, unit: 'kg' }, 3],
      ['Overhead Press', { value: 45, unit: 'kg' }, 3],
      ['Deadlift', { value: 140, unit: 'kg' }, 3],
    ]);
  });
});

describe('What is this file? (AI4, check 45)', () => {
  it('is asked with nothing selected, and lists target columns', () => {
    const q = review('liftosaur-like').questions[0];
    expect(q).toEqual({ kind: 'record_kind', answer: null, targetColumns: ['Required Reps', 'Required RPE', 'Required Weight Value', 'Required Weight Unit', 'Target Muscles'] });
  });

  it('a plan or template imports nothing', () => {
    const { answers } = answerAll('liftosaur-like');
    const plan = buildLayoutReview(tableOf('liftosaur-like.synthetic.csv'), specOf('liftosaur-like.spec.json'), { ...answers, recordKind: 'plan' }, OPTS);
    expect(plan).toMatchObject({ plan: true, ready: false });
  });

  it('no `Required …` value is ever stored: row 4 stores the 5 reps done, not the 3 required', () => {
    const { answers } = answerAll('liftosaur-like');
    const rows = applyImportSpec(specOf('liftosaur-like.spec.json'), answers, tableOf('liftosaur-like.synthetic.csv'), OPTS).rows;
    expect(rows.find((r) => r.line === 4)?.reps).toBe(5);
  });
});

describe('Weight unit (check 44)', () => {
  it('Strong (old) has no unit word: asked with nothing selected, whatever the spec says', () => {
    const r = review('strong-old');
    const unit = r.questions.find((q) => q.kind === 'unit');
    expect(unit).toEqual({ kind: 'unit', answer: null, range: { min: 0, max: 225 } });
    expect(r.unit.source).toBeNull();
  });

  it('the answer reads every weight in that unit, as written (never converted)', () => {
    const t = tableOf('strong-old.synthetic.csv');
    const s = specOf('strong-old.spec.json');
    const lb = applyImportSpec(s, answerAll('strong-old', { unit: 'lb' }).answers, t, OPTS).rows;
    const kg = applyImportSpec(s, answerAll('strong-old', { unit: 'kg' }).answers, t, OPTS).rows;
    expect(lb.filter((r) => r.rowClass === 'strength').map((r) => r.weight)).toContainEqual({ value: 185, unit: 'lb' });
    expect(kg.filter((r) => r.rowClass === 'strength').map((r) => r.weight)).toContainEqual({ value: 185, unit: 'kg' });
  });

  it('`Not right?` on a header unit: Ben’s answer wins', () => {
    const t = tableOf('strong-new-kg.synthetic.csv');
    const s = specOf('strong-new-kg.spec.json');
    const r = buildLayoutReview(t, s, { ...EMPTY_LAYOUT_ANSWERS, unit: 'lb' }, OPTS);
    expect(r.unit).toEqual({ unit: 'lb', source: 'answer', token: null });
    expect(r.questions.find((q) => q.kind === 'unit')).toMatchObject({ answer: 'lb' });
  });

  it('Hevy kg and lb files read their unit from `weight_kg` / `weight_lbs`', () => {
    expect(review('hevy-kg').unit).toEqual({ unit: 'kg', source: 'header', token: 'kg' });
    expect(review('hevy-lbs').unit).toEqual({ unit: 'lb', source: 'header', token: 'lbs' });
  });
});

describe('markers (AI5)', () => {
  it('a marker the coach read is a Check; one it didn’t is asked; the file’s own words are named', () => {
    const r = review('strong-old');
    expect(kinds(r.questions)).toEqual(['record_kind', 'unit', 'marker:W:check', 'marker:Rest Timer:check', 'marker:F:question', 'marker:D:check']);
    const hevy = review('hevy-kg');
    expect(hevy.questions.filter((q) => q.kind === 'marker')).toEqual([]);
  });

  it('`Not a set` rows are skipped; warm-up and drop markers give the set type', () => {
    const { answers } = answerAll('strong-old', { unit: 'lb', markers: { F: 'failure' } });
    const rows = applyImportSpec(specOf('strong-old.spec.json'), answers, tableOf('strong-old.synthetic.csv'), OPTS).rows;
    expect(rows.filter((r) => r.setType === 'not_a_set').map((r) => r.line)).toEqual([5, 11]);
    expect(rows.find((r) => r.line === 2)?.setType).toBe('warmup');
    expect(rows.find((r) => r.line === 10)?.setType).toBe('drop');
    expect(rows.find((r) => r.line === 7)?.setType).toBe('failure');
  });
});

describe('role changes (check 50)', () => {
  it('giving a role to a second column moves the first to Not imported', () => {
    const r = review('strong-new-kg');
    expect(displacedBy(r.columns, 2, 'reps')).toEqual([7]);
    expect(displacedBy(r.columns, 2, 'notes')).toEqual([]);
    // Date and start time are one role family.
    expect(displacedBy(r.columns, 3, 'date')).toEqual([1]);
  });

  it('a role change re-runs the dry run and the examples', () => {
    const before = review('strong-new-kg', { recordKind: 'done' });
    const after = review('strong-new-kg', { recordKind: 'done', roles: { '7': 'not_imported', '3': 'reps' } });
    expect(before.dryRun.read).toBe(15);
    expect(after.columns[3]).toMatchObject({ role: 'reps', state: 'ben' });
    expect(after.examples.map((e) => e.read.sets[0]?.reps)).not.toEqual(before.examples.map((e) => e.read.sets[0]?.reps));
  });

  it('`Weight unit` only on a column of unit words; a result role never on a target column', () => {
    const lift = tableOf('liftosaur-like.synthetic.csv');
    expect(roleRefusal(lift, 14, 'unit')).toBeNull();
    expect(roleRefusal(lift, 3, 'unit')).toBe('not_unit_words');
    expect(roleRefusal(lift, 5, 'reps')).toBe('target_column');
    expect(roleRefusal(lift, 5, 'notes')).toBeNull();
  });
});

describe('worked examples', () => {
  it('cover the first row, a marker, an RPE value and a second workout on one date', () => {
    const r = review('strong-new-kg');
    expect(r.examples.map((e) => e.line)).toEqual([2, 3, 7]);
    expect(r.examples[0]?.read.status).toBe('pending');
    expect(r.examples[0]?.read.waiting).toEqual(['marker']);
  });
});
