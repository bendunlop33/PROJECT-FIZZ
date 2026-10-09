import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { NBSP } from '@fizz/domain';

import type { ImportDraft } from '../src/import/import-service';
import {
  barWeightEntry,
  bodyweightOptions,
  importedNotListedLine,
  importedSetLines,
  introView,
  namesView,
  openErrorView,
  originalText,
  pastImportRow,
  pausedLine,
  perHandOptions,
  previewView,
  progressView,
  provenanceLines,
  resultsView,
  totalOptions,
  undoAlert,
  undoneToast,
  workoutRows,
  writeFailedLine,
} from '../src/import/views';
import type { AppServices } from '../src/services/app-services';
import { createHarness, setUpGym, type Harness } from './harness';

/** Import screen wording (data-import-export §2.5, §3.4, §5). Synthetic files only. */
const plain = (s: string | null | undefined) => (s ?? '').replaceAll(NBSP, ' ');
const B2 = 'Date,Exercise,Category,Weight,Weight Unit,Reps,Distance,Distance Unit,Time,Comment';
const FILE = [
  B2,
  '2026-09-01,Flat Barbell Bench Press,Chest,100.0,kgs,8,,,,"@8, felt heavy"',
  '2026-09-01,Incline DB Press,Chest,50.0,lbs,10,,,,',
  '2026-09-01,Pull Up,Back,10.0,kgs,6,,,,',
  '2026-09-01,Pull Up,Back,-20.0,kgs,8,,,,',
  '2026-09-02,Treadmill,Cardio,,,,5.0,km,0:25:00,',
  '2026-09-02,Squat,Legs,22,5,kgs,5,,,,',
  '2026-09-02,Mystery Machine,Back,40.0,kgs,10,,,,',
].join('\n');

let h: Harness;
let s: AppServices;
beforeEach(async () => {
  h = createHarness('2026-10-08T17:00:00.000Z');
  s = (await h.launch()).services;
  await setUpGym(h, s);
});
afterEach(async () => {
  await h.cleanup();
});

async function open(text = FILE): Promise<ImportDraft> {
  const r = await s.imports.open({ name: 'FitNotes_Export_2026_10_01.csv', text });
  if (r.kind !== 'preview') throw new Error(r.kind);
  return r.draft;
}
async function step(d: ImportDraft, change: Parameters<AppServices['imports']['answer']>[2]): Promise<ImportDraft> {
  const r = await s.imports.answer(d.draftId, d.mappingVersion, change);
  if (!r.ok) throw new Error(r.reason);
  return r.draft;
}

describe('import preview wording', () => {
  it('names the app and units, lists what needs Ben first, and keeps the primary disabled until answered (check 17)', async () => {
    const d = await open();
    const v = previewView(d, 'en-GB');
    expect(v.detection).toBe('FitNotes (Android) CSV · weights in kg and lb (per set)');
    expect(v.rowsLine).toBe('7 rows · 1 Sept 2026 – 2 Sept 2026');
    // `Pull Up` and `Incline DB Press` match catalogue names, so their convention questions come at once.
    expect(v.questionsTitle).toBe('Needs your answer (3)');
    expect(v.questions.map((q) => [q.line.icon, q.line.text])).toEqual([
      ['exclamationmark.triangle', '2 exercise names to check'],
      ['exclamationmark.triangle', 'Dumbbell weights: each or both?'],
      ['exclamationmark.triangle', 'Pull Up weights: added or assist?'],
    ]);
    expect(v.skipped.map((x) => [x.key, x.line.text, x.line.detail ?? null])).toEqual([
      ['cardio', '1 cardio row (not imported yet)', null],
      ['unreadable', '1 row can’t be read', null],
    ]);
    expect(v.kept.map((k) => k.text)).toContain('FitNotes files have no times. These workouts show the date only.');
    expect(v.kept.map((k) => k.text)).toContain('1 comment, kept with each set as written');
    expect(v.effortReview).toBe('1 comment looks like effort ratings. Kept as notes only · Review');
    expect(v.gymRow).toBe('Gym: Not recorded');
    expect(v.primary).toEqual({ label: 'Answer 3 questions to import', enabled: false });
  });

  it('after the names, each convention is its own question with no option selected (DX6)', async () => {
    let d = await open();
    const names = namesView(d.analysis, (id) => s.imports.candidate(d.draftId, id)?.name ?? null);
    expect(names.rows.map((r) => [r.title, r.status.word, r.status.text, r.actions])).toEqual([
      ['Flat Barbell Bench Press', 'Check', 'Bench press', ['use', 'choose', 'new']],
      ['Mystery Machine', 'No match', 'No match', ['choose', 'new', 'skip']],
    ]);
    expect(names.matchedCount).toBe(2);
    d = await step(d, { kind: 'name', key: 'flat barbell bench press', answer: { kind: 'exercise', exerciseId: names.rows[0]?.suggestionId ?? '' } });
    d = await step(d, { kind: 'name', key: 'mystery machine', answer: { kind: 'skip' } });
    const v = previewView(d, 'en-GB');
    expect(v.questions.map((q) => q.line.text)).toEqual(['Exercise names: 2 checked', 'Dumbbell weights: each or both?', 'Barbell weights: total or plates only?', 'Pull Up weights: added or assist?']);
    expect(v.primary).toEqual({ label: 'Answer 3 questions to import', enabled: false });

    const ph = perHandOptions(d.analysis, 'en-GB');
    expect(ph?.question).toBe('For this exercise, “50” means:');
    expect(ph?.options.map((o) => [o.label, plain(o.detail), o.selected])).toEqual([
      ['Each dumbbell', 'Imported as 50 lb each', false],
      ['Both dumbbells together', 'Imported as 25 lb each', false],
    ]);
    expect(plain(ph?.example)).toBe('Example from your file (1 Sept 2026): Incline DB Press  50 × 10');
    expect(totalOptions(d.analysis)?.options.every((o) => !o.selected)).toBe(true);
    expect(totalOptions(d.analysis)?.barWeights).toEqual([{ bar: 'barbell', unit: 'kg', value: 20, label: 'Bar weight (kg), added to “plates only” values', missing: null }]);
    // -20 and 10 under one exercise: a third answer reads each by its sign (review B3).
    const bw = bodyweightOptions(d.analysis, 'pull up');
    expect(bw?.range).toBe('Values in your file: -20 to 10, some negative');
    expect(bw?.options.map((o) => [o.value, o.label, o.detail, o.selected])).toEqual([
      ['added', 'Weight added to bodyweight', 'Negative values can’t be read this way', false],
      ['assistance', 'Assistance from a machine', 'Negative values are read as assistance; positive values can’t be read this way', false],
      ['split', 'Negative = assistance, positive = added', '-20 is read as 20 assistance; 10 as 10 added', false],
    ]);

    d = await step(d, { kind: 'per_hand', answer: 'each' });
    d = await step(d, { kind: 'total', answer: 'plates_only' });
    d = await step(d, { kind: 'bodyweight', key: 'pull up', answer: 'split' });
    // Once chosen, the answer stays visible even if the values stop spanning zero (review r2 N5).
    const oneWay = { ...d.analysis, bodyweight: d.analysis.bodyweight.map((q) => ({ ...q, min: 5, mixed: false })) };
    expect(bodyweightOptions(oneWay, 'pull up')?.options.map((o) => [o.value, o.selected])).toEqual([['added', false], ['assistance', false], ['split', true]]);
    const ready = previewView(d, 'en-GB');
    expect(ready.questions.map((q) => q.line.text)).toEqual([
      'Exercise names: 2 checked',
      'Dumbbells: each',
      'Barbell: plates only + bar',
      'Pull Up: negative = assistance, positive = added',
    ]);
    expect(ready.questionsTitle).toBe('Your answers');
    expect(ready.primary).toEqual({ label: 'Import 1 workout', enabled: true });
    expect(ready.skipped.map((x) => x.line.text)).toContain('1 set of exercises you chose to skip');
    expect(workoutRows(d.analysis, 0, 'en-GB')).toEqual([{ date: '2026-09-01', text: 'Tue 1 Sept 2026 · 3 exercises · 4 sets' }]);
    // Step 3d: the mapped value and the original row.
    const rows = s.imports.previewRows(d.draftId, '2026-09-01');
    expect(rows.map((r) => (r.fate.result === 'imported' ? [r.fate.set.exerciseName, r.fate.set.load?.value, r.fate.set.convention] : r.fate.result))).toEqual([
      ['Bench press', 120, 'total'],
      ['Incline dumbbell press', 50, 'per_hand'],
      ['Pull-up', 10, 'added'],
      ['Pull-up', 20, 'assistance'],
    ]);
    // "Assistance" never turns the weighted set into assistance: it can't be read that way.
    const assist = await step(d, { kind: 'bodyweight', key: 'pull up', answer: 'assistance' });
    expect(s.imports.previewRows(assist.draftId, '2026-09-01').map((r) => (r.fate.result === 'imported' ? r.fate.set.convention : r.fate.result)).slice(2)).toEqual(['unreadable', 'assistance']);
  });

  it('EZ and trap bars ask for their own weight; the Olympic bar’s 20 kg is never added to them (review S1)', async () => {
    let d = await open([B2, '2026-09-01,Bench press,Chest,60.0,kgs,5,,,,', '2026-09-01,EZ-bar skull crusher,Arms,20.0,kgs,10,,,,', '2026-09-01,Kettlebell swing,Legs,24.0,kgs,15,,,,'].join('\n'));
    d = await step(d, { kind: 'total', answer: 'plates_only' });
    const q = totalOptions(d.analysis);
    expect(q?.options.find((o) => o.value === 'plates_only')?.detail).toBe('Each bar’s own weight below is added');
    expect(q?.barWeights).toEqual([
      { bar: 'barbell', unit: 'kg', value: 20, label: 'Bar weight (kg), added to “plates only” values', missing: null },
      { bar: 'ez_bar', unit: 'kg', value: null, label: 'EZ-bar weight (kg), added to “plates only” values', missing: 'Enter your EZ bar’s weight in kg. Plates-only sets on it can’t be imported without it.' },
    ]);
    const v = previewView(d, 'en-GB');
    expect(v.questions.map((x) => x.line.text)).toEqual(['EZ-bar weight needed for “plates only”']);
    expect(v.primary).toEqual({ label: 'Answer 1 question to import', enabled: false });
    // The kettlebell isn't a barbell question: imported as written.
    expect(v.kept.map((l) => l.text)).toContain('Kettlebell and other no-bar weights imported as written (Kettlebell swing)');

    d = await step(d, { kind: 'bar_weight', bar: 'ez_bar', unit: 'kg', value: 7.5 });
    expect(previewView(d, 'en-GB').primary).toEqual({ label: 'Import 1 workout', enabled: true });
    expect(s.imports.previewRows(d.draftId, '2026-09-01').map((r) => (r.fate.result === 'imported' ? [r.fate.set.exerciseName, r.fate.set.load?.value] : r.fate.result))).toEqual([
      ['Bench press', 80],
      ['Skull crusher', 27.5],
      ['Kettlebell swing', 24],
    ]);
  });

  it('copies the original row as written', () => {
    expect(originalText('B2', ['2026-10-01', 'Flat Barbell Bench Press', 'Chest', '100.0', 'kgs', '8', '', '', '', '@8 felt heavy'])).toBe('Flat Barbell Bench Press · 100.0 kgs · 8 reps · “@8 felt heavy”');
    expect(originalText('A1-kg', ['2024-05-03', 'Treadmill', 'Cardio', '', '', '5', 'km', '25:00'])).toBe('Treadmill · 5 km · 25:00');
    expect(originalText('C', ['2026-10-02', 'Bench', 'Chest', '100', '220.46', '5', '', '', '', '', 'wr'])).toBe('Bench · 100 kg · 220.46 lbs · 5 reps');
  });

  it('explains every file it can’t preview', () => {
    expect(openErrorView({ kind: 'empty' })?.text).toBe('This file is empty.');
    expect(openErrorView({ kind: 'not_csv' })?.text).toBe('This isn’t a CSV file.');
    expect(openErrorView({ kind: 'fitnotes_backup' })?.text).toBe('This looks like a FitNotes backup, not a CSV export. Export a CSV from FitNotes and choose that.');
    expect(openErrorView({ kind: 'unknown_header', firstLine: 'a,b' })).toEqual({ text: 'GymSmarter doesn’t recognise this file’s columns yet. Nothing was guessed.', firstLine: 'a,b', sameFileJobId: null });
    expect(openErrorView({ kind: 'body_tracker', firstLine: 'Date,Weight' })?.text).toBe('This looks like a FitNotes Body Tracker export. Choose the Workout Data export.');
  });
});

describe('importing, results, past imports and undo wording', () => {
  async function importIt(): Promise<string> {
    let d = await open([B2, '2026-09-01,Lat Pulldown,Back,45.0,kgs,10,,,,', '2026-09-02,Treadmill,Cardio,,,,5.0,km,0:25:00,', '2026-09-03,Lat Pulldown,Back,22,5,kgs,10,,,,'].join('\n'));
    d = (await s.imports.draft(d.draftId)) ?? d;
    const r = await s.imports.commit(d.draftId, d.mappingVersion, 'op-1');
    if (!r.ok) throw new Error(r.reason);
    return r.jobId;
  }

  it('results list every skipped row with its reason (§2.5 step 5)', async () => {
    const jobId = await importIt();
    const job = await s.imports.job(jobId);
    if (!job) throw new Error('no job');
    const v = resultsView(job, 'en-GB');
    expect(v.banner).toEqual({ icon: 'checkmark.circle.fill', tone: 'done', text: 'Import finished' });
    expect(v.headline).toBe('1 workout · 1 set added');
    expect(v.from).toBe('From FitNotes_Export_2026_10_01.csv');
    expect(v.skipped.map((x) => [x.title, x.lines])).toEqual([
      ['1 cardio row', ['Row 3 · 2026-09-02 · Treadmill · 5.0 km · 0:25:00 — cardio isn’t imported yet']],
      ['1 row couldn’t be read', ['Row 4 · 2026-09-03,Lat Pulldown,Back,22,5,kgs,10,,,, — This row has 11 values; the header has 10']],
    ]);
    expect(v.canUndo).toBe(true);
    expect(pastImportRow(job, 'en-GB')).toEqual({
      title: 'FitNotes_Export_2026_10_01.csv',
      subtitle: 'Imported Thu 8 Oct · FitNotes (Android) CSV',
      line: { icon: 'checkmark.circle.fill', tone: 'done', text: 'Finished · 1 workout' },
    });
    expect(undoAlert(job)).toEqual({ title: 'Undo this import?', message: '1 workout from FitNotes_Export_2026_10_01.csv will be hidden from history, Progress and targets. Your other workouts aren’t touched.' });
    const setId = job.rows[0]?.setId ?? '';
    const p = await s.imports.provenance(setId);
    if (!p) throw new Error('no provenance');
    expect(provenanceLines(p, 'en-GB')).toEqual({ source: 'Imported from FitNotes on Thu 8 Oct 2026 · row 2', original: 'Original: Lat Pulldown · 45.0 kgs · 10 reps' });

    const undo = await s.imports.revert(jobId, job.job.version, 'undo-1');
    if (!undo.ok) throw new Error(undo.reason);
    expect(undoneToast(undo.workouts)).toBe('1 workout hidden. You can import the file again.');
    const after = await s.imports.job(jobId);
    if (!after) throw new Error('no job');
    expect(pastImportRow(after, 'en-GB').line).toEqual({ icon: 'slash.circle', tone: 'info', text: 'Undone on Thu 8 Oct · 1 workout hidden' });
    expect(resultsView(after, 'en-GB').canUndo).toBe(false);
    expect(resultsView(after, 'en-GB').imported).toBeNull();
  });

  it('results list the imported workouts; each set shows its file, row and original values (check 24, review S2)', async () => {
    const jobId = await importIt();
    const job = await s.imports.job(jobId);
    if (!job) throw new Error('no job');
    expect(resultsView(job, 'en-GB').imported).toEqual({ title: 'Imported workouts (1)', workouts: [{ date: '2026-09-01', text: 'Tue 1 Sept 2026 · 1 exercise · 1 set' }] });
    const one = await s.imports.importedRows(jobId, '2026-09-01');
    if (!one) throw new Error('no rows');
    expect(one.rows.map((r) => importedSetLines(one.job, r, 'en-GB')).map((l) => ({ ...l, title: plain(l.title) }))).toEqual([
      { title: 'Lat pulldown · imported as 45 kg stack × 10', source: 'Imported from FitNotes on Thu 8 Oct 2026 · row 2', original: 'Original: Lat Pulldown · 45.0 kgs · 10 reps' },
    ]);
    expect((await s.imports.importedRows(jobId, '2026-09-02'))?.rows).toEqual([]);
  });

  it('the same file while its import is unfinished says where it stopped (review N1)', async () => {
    const text = [B2, '2026-09-01,Lat Pulldown,Back,45.0,kgs,10,,,,', '2026-09-03,Lat Pulldown,Back,40.0,kgs,10,,,,'].join('\n');
    const d = await open(text);
    await s.imports.commit(d.draftId, d.mappingVersion, 'op-1', { shouldStop: () => true });
    const again = await s.imports.open({ name: 'renamed.csv', text });
    expect(again).toMatchObject({ kind: 'same_file', state: 'paused', written: 0 });
    expect(openErrorView(again, 'en-GB')?.text).toBe('You started importing this file on Thu 8 Oct. Import paused at 0 of 2 workouts. The 0 are in your history. Continue that import instead.');
  });

  it('intro: blocked by an unfinished workout, or offers Continue for a paused import', async () => {
    const block = { title: 'Push A', startedAtUtc: '2026-10-08T17:02:00.000Z', tz: 'Europe/London' };
    expect(introView({ block, blockTime: '18:02', paused: null })).toEqual({
      blockLine: 'Finish or discard your workout first (Push A, started 18:02).',
      paused: null,
      primary: { label: 'Choose CSV file', enabled: false },
    });
    const d = await open([B2, '2026-09-01,Lat Pulldown,Back,45.0,kgs,10,,,,', '2026-09-03,Lat Pulldown,Back,40.0,kgs,10,,,,'].join('\n'));
    let n = 0;
    await s.imports.commit(d.draftId, d.mappingVersion, 'op-1', { onProgress: (w) => (n = w), shouldStop: () => n >= 1 });
    const paused = await s.imports.paused();
    const v = introView({ block: null, blockTime: '', paused });
    expect(v.paused?.text).toBe('Import paused at 1 of 2 workouts. The 1 is in your history.');
    expect(v.primary).toEqual({ label: 'Continue import', enabled: true });
    // Every workout in but not marked finished (closed right at the end; review B1).
    expect(pausedLine({ written: 2, total: 2 })).toBe('Import not finished. All 2 workouts are in your history; Continue import finishes it.');
    // The same file again while it's unfinished: Continue said once; a running import isn't called paused (review r2 N1).
    const job = paused?.job;
    if (!job) throw new Error('no job');
    expect(openErrorView({ kind: 'same_file', job, written: 2, state: 'paused' }, 'en-GB')?.text).toBe('You started importing this file on Thu 8 Oct. Import not finished. All 2 workouts are in your history. Continue that import instead.');
    expect(openErrorView({ kind: 'same_file', job, written: 1, state: 'running' }, 'en-GB')?.text).toBe('You started importing this file on Thu 8 Oct. It’s importing now: 1 of 2 workouts in.');
    expect(progressView(180, 412)).toEqual({ text: '180 of 412 workouts', fraction: 180 / 412 });
  });
});

describe('import wording without a database', () => {
  it('a cleared bar weight warns and goes back to the weight still in use (review r2 S1)', () => {
    const olympic = { value: 20, unit: 'kg' as const, missing: null };
    // Cleared while editing: says what's still added.
    expect(barWeightEntry('', olympic)).toEqual({ save: null, endText: '20', warning: `Enter a bar weight above 0. Until you do, 20${NBSP}kg is added.` });
    expect(barWeightEntry('0', olympic)).toMatchObject({ save: null, endText: '20' });
    expect(barWeightEntry('abc', olympic)).toMatchObject({ save: null, endText: '20' });
    // A new weight is saved; the same weight isn't saved again.
    expect(barWeightEntry('15', olympic)).toEqual({ save: 15, endText: '15', warning: null });
    expect(barWeightEntry('7,5', olympic)).toEqual({ save: 7.5, endText: '7,5', warning: null });
    expect(barWeightEntry('20', olympic)).toEqual({ save: null, endText: '20', warning: null });
    // An EZ bar has no default: an empty field shows what's missing, and nothing is invented.
    const ez = { value: null, unit: 'kg' as const, missing: 'Enter your EZ bar’s weight in kg. Plates-only sets on it can’t be imported without it.' };
    expect(barWeightEntry('', ez)).toEqual({ save: null, endText: '', warning: ez.missing });
    expect(barWeightEntry('0', ez)).toEqual({ save: null, endText: '0', warning: 'Enter a bar weight above 0.' });
    expect(barWeightEntry('10', ez)).toEqual({ save: 10, endText: '10', warning: null });
  });

  it('Past workouts says imported workouts are left out (review r2 B1)', () => {
    expect(importedNotListedLine(1)).toBe('1 workout imported from FitNotes isn’t listed: imported workouts can’t be repeated yet. They’re in Data & backup, under Past imports.');
    expect(importedNotListedLine(412)).toBe('412 workouts imported from FitNotes aren’t listed: imported workouts can’t be repeated yet. They’re in Data & backup, under Past imports.');
  });

  it('a workout whose save wasn’t confirmed is never called failed (review r2 N4)', () => {
    expect(writeFailedLine({ written: 1, date: '2026-09-03', message: 'disk full' }, 'en-GB')).toBe(
      'Workout 2 (Thu 3 Sept 2026) may not have saved: disk full. 1 workout is in before it. Each workout saves whole or not at all; Try again checks and carries on.',
    );
  });
});
