import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { equipmentContradicts, nameKey, NBSP } from '@fizz/domain';

import type { ImportDraft } from '../src/import/import-service';
import {
  barWeightEntry,
  bodyweightOptions,
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
  // A barbell name that is a Check (FitNotes' own `Flat Barbell Bench Press` is a catalogue alias, so Matched).
  '2026-09-01,Bench Press (Barbell),Chest,100.0,kgs,8,,,,"@8, felt heavy"',
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
    expect(v.kept.map((k) => k.text)).toContain('Date only (no times)');
    expect(v.kept.map((k) => k.text)).toContain('1 comment, kept with each set as written');
    expect(v.effortReview).toBe('1 comment looks like effort ratings. Kept as notes only · Review');
    expect(v.gymRow).toBe('Gym: Not recorded');
    expect(v.primary).toEqual({ label: 'Answer 3 questions to import', enabled: false });
  });

  it('after the names, each convention is its own question with no option selected (DX6)', async () => {
    let d = await open();
    const names = namesView(d.analysis, (id) => s.imports.candidate(d.draftId, id)?.name ?? null);
    expect(names.rows.map((r) => [r.title, r.status.word, r.status.text, r.actions])).toEqual([
      ['Bench Press (Barbell)', 'Check', 'Bench press', ['use', 'choose', 'new']],
      ['Mystery Machine', 'No match', 'No match · Back', ['choose', 'new', 'skip']],
    ]);
    expect(names.matchedCount).toBe(2);
    d = await step(d, { kind: 'name', key: 'bench press (barbell)', answer: { kind: 'exercise', exerciseId: names.rows[0]?.suggestionId ?? '' } });
    d = await step(d, { kind: 'name', key: 'mystery machine', answer: { kind: 'skip' } });
    const v = previewView(d, 'en-GB');
    expect(v.questions.map((q) => q.line.text)).toEqual(['Exercise names: 2 checked', 'Dumbbell weights: each or both?', 'Barbell weights: total as written, or plates only?', 'Pull Up weights: added or assist?']);
    expect(v.primary).toEqual({ label: 'Answer 3 questions to import', enabled: false });

    const ph = perHandOptions(d.analysis, 'en-GB');
    expect(ph?.question).toBe('For this exercise with two dumbbells, “50” means:');
    // A lone two-dumbbell exercise: the options say it all, so no per-exercise list.
    expect([ph?.ask, ph?.rows]).toEqual([null, null]);
    expect(ph?.options.map((o) => [o.label, plain(o.detail), o.selected])).toEqual([
      ['Each dumbbell', 'Imported as 50 lb each', false],
      ['Both dumbbells together', 'Imported as 25 lb each', false],
    ]);
    expect(plain(ph?.example)).toBe('Example from your file (1 Sept 2026): Incline DB Press  50 × 10');
    const tq = totalOptions(d.analysis);
    expect(tq?.options.every((o) => !o.selected)).toBe(true);
    // The group answer is only "Total as written": nothing added (PM decision after review r7).
    expect(tq?.options.map((o) => [o.value, o.label, plain(o.detail)])).toEqual([['total', 'Total as written', 'Nothing added: imported as 100 kg']]);
    // Plates only is chosen per exercise: its bar (the matched exercise's own) and its conversion, nothing selected.
    expect(tq?.platesOnly.rows.map((r) => [r.title, r.barLine, r.bars.map((b) => [b.label, b.selected]), plain(r.conversion), plain(r.now), r.choices.map((c) => [c.label, c.selected])])).toEqual([
      [
        'Bench Press (Barbell)',
        'Bar: Olympic bar (from Bench press)',
        // The bar buttons appear once Plates only is selected (review r8 S2).
        [],
        'If plates only: 100 kg → 120 kg total (plates + 20 kg bar)',
        'Now: 100 kg → not answered yet',
        [['Total as written', false], ['Plates only', false]],
      ],
    ]);
    expect(tq?.barWeights).toEqual([{ bar: 'barbell', unit: 'kg', value: 20, label: 'Bar weight (kg), added to “plates only” values', missing: null }]);
    // -20 and 10 under one exercise: a third answer reads each by its sign (review B3).
    const bw = bodyweightOptions(d.analysis, 'pull up');
    expect(bw?.range).toBe('Values in your file: -20 to 10, some negative');
    expect(bw?.options.map((o) => [o.value, o.label, o.detail, o.selected])).toEqual([
      ['added', 'Weight added to bodyweight', 'Negative values can’t be read this way', false],
      ['assistance', 'Assistance from a machine', 'Negative values are read as assistance; positive values can’t be read this way', false],
      ['split', 'Negative = assistance, positive = added', '-20 is read as 20 assistance; 10 as 10 added', false],
    ]);

    d = await step(d, { kind: 'per_hand', answer: 'each' });
    d = await step(d, { kind: 'total_override', key: 'bench press (barbell)', answer: 'plates_only' });
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
    d = await step(d, { kind: 'total_override', key: 'bench press', answer: 'plates_only' });
    d = await step(d, { kind: 'total_override', key: 'ez-bar skull crusher', answer: 'plates_only' });
    const q = totalOptions(d.analysis);
    expect(q?.platesOnly.rows.map((r) => [r.barLine, plain(r.now)])).toEqual([
      ['Bar: Olympic bar (from Bench press)', 'Now: 60 kg → 80 kg total (plates + 20 kg bar)'],
      ['Bar: EZ bar (from Skull crusher)', 'Now: 20 kg → EZ-bar weight needed'],
    ]);
    expect(q?.barWeights).toEqual([
      { bar: 'barbell', unit: 'kg', value: 20, label: 'Bar weight (kg), added to “plates only” values', missing: null },
      { bar: 'ez_bar', unit: 'kg', value: null, label: 'EZ-bar weight (kg), added to “plates only” values', missing: 'EZ-bar weight needed (kg)' },
    ]);
    const v = previewView(d, 'en-GB');
    // (ADR 0030) A kettlebell swing is one bell, per hand: answered from the catalogue, nothing to ask.
    expect(v.questions.map((x) => x.line.text)).toEqual(['Dumbbells: one dumbbell', 'EZ-bar weight needed for “plates only”']);
    expect(v.questions.filter((x) => !x.answered).map((x) => x.line.text)).toEqual(['EZ-bar weight needed for “plates only”']);
    expect(v.primary).toEqual({ label: 'Answer 1 question to import', enabled: false });
    // The kettlebell isn't a barbell question: one bell's weight, imported as written (per bell since ADR 0030).
    expect(v.kept.map((l) => l.text).some((t) => t.includes('Kettlebell swing'))).toBe(false);

    d = await step(d, { kind: 'bar_weight', bar: 'ez_bar', unit: 'kg', value: 7.5 });
    expect(previewView(d, 'en-GB').primary).toEqual({ label: 'Import 1 workout', enabled: true });
    expect(s.imports.previewRows(d.draftId, '2026-09-01').map((r) => (r.fate.result === 'imported' ? [r.fate.set.exerciseName, r.fate.set.load?.value] : r.fate.result))).toEqual([
      ['Bench press', 80],
      ['Skull crusher', 27.5],
      ['Kettlebell swing', 24],
    ]);
  });

  it('barbell: the group answer only reads weights as written; plates only is chosen per exercise with its bar, changeable (PM decision after review r7)', async () => {
    let d = await open([B2, '2026-09-01,Bench Press (Barbell),Chest,100.0,kgs,5,,,,', '2026-09-01,Stiff-Legged Deadlift,Legs,80.0,kgs,8,,,,', '2026-09-01,Deadlift,Back,140.0,kgs,3,,,,'].join('\n'));
    for (const n of d.analysis.names.filter((x) => x.needsAnswer && x.match.exerciseId)) d = await step(d, { kind: 'name', key: n.key, answer: { kind: 'exercise', exerciseId: n.match.exerciseId ?? '' } });
    const rows = (q: ReturnType<typeof totalOptions>) => q?.platesOnly.rows.map((r) => [r.title, plain(r.conversion), plain(r.now), r.choices.filter((c) => c.selected).map((c) => c.label)]);
    let q = totalOptions(d.analysis, 'en-GB');
    // Every exercise, whatever its name says, is read by the group answer until Ben answers it on its own.
    expect(q?.question).toBe('For these 3 exercises, “100” means:');
    expect(q?.platesOnly).toMatchObject({ title: 'Plates only (bar not counted)?' });
    expect(rows(q)).toEqual([
      ['Bench Press (Barbell)', 'If plates only: 100 kg → 120 kg total (plates + 20 kg bar)', 'Now: 100 kg → not answered yet', []],
      ['Stiff-Legged Deadlift', 'If plates only: 80 kg → 100 kg total (plates + 20 kg bar)', 'Now: 80 kg → not answered yet', []],
      ['Deadlift', 'If plates only: 140 kg → 160 kg total (plates + 20 kg bar)', 'Now: 140 kg → not answered yet', []],
    ]);
    expect(previewView(d, 'en-GB').questions.map((x) => x.line.text)).toEqual(['Exercise names: 2 checked', 'Barbell weights: total as written, or plates only?']);

    // A group "plates only" is refused: it is only ever one exercise's answer.
    const refused = await s.imports.answer(d.draftId, d.mappingVersion, { kind: 'total', answer: 'plates_only' as 'total' });
    expect(refused).toMatchObject({ ok: false, reason: 'invalid', message: 'Plates only is chosen for each exercise, not for the group' });

    d = await step(d, { kind: 'total', answer: 'total' });
    d = await step(d, { kind: 'total_override', key: nameKey('Stiff-Legged Deadlift'), answer: 'plates_only' });
    q = totalOptions(d.analysis, 'en-GB');
    expect(rows(q)).toEqual([
      ['Bench Press (Barbell)', 'If plates only: 100 kg → 120 kg total (plates + 20 kg bar)', 'Now: 100 kg → 100 kg total as written', []],
      ['Stiff-Legged Deadlift', 'If plates only: 80 kg → 100 kg total (plates + 20 kg bar)', 'Now: 80 kg → 100 kg total (plates + 20 kg bar)', ['Plates only']],
      ['Deadlift', 'If plates only: 140 kg → 160 kg total (plates + 20 kg bar)', 'Now: 140 kg → 140 kg total as written', []],
    ]);
    // Ben changes its bar to the trap bar: its weight is asked for, then added.
    d = await step(d, { kind: 'total_bar', key: nameKey('Stiff-Legged Deadlift'), bar: 'trap_bar' });
    q = totalOptions(d.analysis, 'en-GB');
    expect([q?.platesOnly.rows[1]?.barLine, plain(q?.platesOnly.rows[1]?.now)]).toEqual(['Bar: Trap bar (your choice)', 'Now: 80 kg → Trap-bar weight needed']);
    expect(q?.platesOnly.rows[1]?.bars.map((b) => [b.label, b.value, b.selected])).toEqual([['Olympic bar', null, false], ['EZ bar', 'ez_bar', false], ['Trap bar', 'trap_bar', true]]);
    expect(previewView(d, 'en-GB').questions.map((x) => x.line.text)).toEqual(['Exercise names: 2 checked', 'Trap-bar weight needed for “plates only”']);
    d = await step(d, { kind: 'bar_weight', bar: 'trap_bar', unit: 'kg', value: 25 });
    const ready = previewView(d, 'en-GB');
    expect(ready.questions.map((x) => x.line.text)).toEqual(['Exercise names: 2 checked', 'Barbell: 2 total as written · 1 plates only + bar']);
    expect(ready.primary).toEqual({ label: 'Import 1 workout', enabled: true });
    expect(s.imports.previewRows(d.draftId, '2026-09-01').map((r) => (r.fate.result === 'imported' ? r.fate.set.load?.value : r.fate.result))).toEqual([100, 105, 140]);
    // Back to its own bar.
    d = await step(d, { kind: 'total_bar', key: nameKey('Stiff-Legged Deadlift'), bar: null });
    expect(totalOptions(d.analysis, 'en-GB')?.platesOnly.rows[1]?.barLine).toMatch(/^Bar: Olympic bar \(from /);
  });

  it('dumbbells: one-dumbbell exercises are never halved, unknown ones are asked, and each shows what it imports as (review r3 S1)', async () => {
    const DB = [
      B2,
      '2026-09-01,Dumbbell Bench Press,Chest,60.0,kgs,8,,,,',
      '2026-09-01,One-Arm DB Row,Back,30.0,kgs,10,,,,',
      '2026-09-01,Goblet Squats,Legs,24.0,kgs,10,,,,',
      '2026-09-01,Zottman Curl,Arms,14.0,kgs,10,,,,',
    ].join('\n');
    let d = await open(DB);
    // The real catalogue: two names match, the third is checked, and Zottman Curl isn't in it.
    expect(d.analysis.names.map((n) => [n.name, n.match.status])).toEqual([
      ['Zottman Curl', 'no_match'],
      ['Dumbbell Bench Press', 'matched'],
      ['Goblet Squats', 'matched'],
      ['One-Arm DB Row', 'matched'],
    ]);
    d = await step(d, { kind: 'name', key: 'zottman curl', answer: { kind: 'new', equipment: 'dumbbells' } });
    expect(previewView(d, 'en-GB').questions.map((q) => q.line.text)).toEqual(['Exercise names: 1 checked', 'Dumbbell weights: each or both?']);

    const before = perHandOptions(d.analysis, 'en-GB');
    expect(before?.question).toBe('For this exercise with two dumbbells, “60” means:');
    expect(before?.ask).toEqual({
      title: 'One dumbbell or two?',
      lead: 'Choose for each',
      rows: [
        {
          key: 'zottman curl',
          title: 'Zottman Curl',
          conversion: `14${NBSP}kg → not answered yet`,
          remembered: null,
          choices: [
            { value: 'one', label: 'One dumbbell', selected: false },
            { value: 'each', label: 'Each', selected: false },
            { value: 'both', label: 'Both together', selected: false },
          ],
        },
      ],
    });
    const known = (q: ReturnType<typeof perHandOptions>) => q?.rows?.rows.map((r) => [r.title, plain(r.conversion), r.choices.filter((c) => c.selected).map((c) => c.label)]);
    expect(before?.rows?.title).toBe('Different for some?');
    expect(before?.rows?.note).toBe('2 exercises use one dumbbell, so their weights are imported as written.');
    expect(known(before)).toEqual([
      ['Dumbbell Bench Press', '60 kg → not answered yet', ['Same']],
      ['One-Arm DB Row', '30 kg → 30 kg (one dumbbell)', ['One dumbbell']],
      ['Goblet Squats', '24 kg → 24 kg (one dumbbell)', ['One dumbbell']],
    ]);
    // A pair: same as the group, each, or both together. One dumbbell: as written or halved, two choices (review r4 N4).
    expect(before?.rows?.rows.map((r) => r.choices.map((c) => c.label))).toEqual([
      ['Same', 'Each', 'Both together'],
      ['One dumbbell', 'Both together'],
      ['One dumbbell', 'Both together'],
    ]);

    // "Both together" for the pair: the one-arm row and the goblet squat stay as written; the new exercise still waits.
    d = await step(d, { kind: 'per_hand', answer: 'both' });
    expect(known(perHandOptions(d.analysis, 'en-GB'))).toEqual([
      ['Dumbbell Bench Press', '60 kg → 30 kg each', ['Same']],
      ['One-Arm DB Row', '30 kg → 30 kg (one dumbbell)', ['One dumbbell']],
      ['Goblet Squats', '24 kg → 24 kg (one dumbbell)', ['One dumbbell']],
    ]);
    expect(previewView(d, 'en-GB').questions.map((q) => q.line.text)).toEqual(['Exercise names: 1 checked', '1 dumbbell exercise: one dumbbell or two?']);
    expect(previewView(d, 'en-GB').primary).toEqual({ label: 'Answer 1 question to import', enabled: false });

    d = await step(d, { kind: 'per_hand_override', key: 'zottman curl', answer: 'one' });
    expect(perHandOptions(d.analysis, 'en-GB')?.ask?.rows.map((r) => [plain(r.conversion), r.choices.filter((c) => c.selected).map((c) => c.label)])).toEqual([['14 kg → 14 kg (one dumbbell)', ['One dumbbell']]]);
    expect(previewView(d, 'en-GB').questions.map((q) => q.line.text)).toEqual(['Exercise names: 1 checked', 'Dumbbells: 1 both together · 3 one dumbbell']);

    // Ben says he rowed with two dumbbells and wrote the pair: only then is the row halved.
    d = await step(d, { kind: 'per_hand_override', key: 'one-arm db row', answer: 'both' });
    expect(known(perHandOptions(d.analysis, 'en-GB'))?.[1]).toEqual(['One-Arm DB Row', '30 kg → 15 kg each', ['Both together']]);
    // An answer the usual choices don't offer (from an earlier import that read it differently) is still shown, selected.
    d = await step(d, { kind: 'per_hand_override', key: 'one-arm db row', answer: 'each' });
    expect(perHandOptions(d.analysis, 'en-GB')?.rows?.rows[1]?.choices.map((c) => [c.label, c.selected])).toEqual([
      ['One dumbbell', false],
      ['Both together', false],
      ['Each', true],
    ]);
    d = await step(d, { kind: 'per_hand_override', key: 'one-arm db row', answer: null });

    const r = await s.imports.commit(d.draftId, d.mappingVersion, 'op-dumbbells');
    if (!r.ok) throw new Error(r.reason);
    const job = await s.imports.importedRows(r.jobId, '2026-09-01');
    expect(job?.rows.map((x) => [x.imported?.exerciseName, x.imported?.load, x.imported?.laterality])).toEqual([
      ['Dumbbell bench press', { value: 30, unit: 'kg', convention: 'per_hand' }, 'bilateral'],
      ['One-arm dumbbell row', { value: 30, unit: 'kg', convention: 'per_hand' }, 'unilateral'],
      ['Goblet squat', { value: 24, unit: 'kg', convention: 'per_hand' }, 'bilateral'],
      ['Zottman Curl', { value: 14, unit: 'kg', convention: 'per_hand' }, 'bilateral'],
    ]);
    // Ben's answers are kept with the import.
    expect(job?.job.answers).toMatchObject({ perHand: 'both', perHandOverrides: { 'zottman curl': 'one' } });
  });

  type Row = readonly [name: string, kg: number, reps: number];
  /**
   * FitNotes' published defaults (`test/fixtures/fitnotes-default-exercises.txt`; all of them are run end to end in
   * `fitnotes-import-defaults.test.ts`), then common variants that aren't on that list. One set each on 1 Sep.
   */
  const DEFAULTS: readonly Row[] = [
    ['One-Arm Standing Dumbbell Press', 22, 8],
    ['Dumbbell Concentration Curl', 14, 10],
    ['Seated Dumbbell Press', 40, 8],
    ['Flat Dumbbell Bench Press', 60, 8],
    ['Flat Barbell Bench Press', 100, 5],
    ['Barbell Shrug', 100, 10],
    ['Machine Shrug', 80, 10],
    ['EZ-Bar Skullcrusher', 30, 10],
    ['Lateral Machine Raise', 30, 12],
    ['Smith Machine Close Grip Bench Press', 60, 8],
    ['Smith Machine Overhead Press', 40, 8],
    ['Barbell Calf Raise', 80, 12],
  ];
  const VARIANTS: readonly Row[] = [
    ['Dumbbell Skullcrusher', 20, 10],
    ['Triceps Dip Machine', 80, 10],
    ['Dip Machine', 70, 10],
    ['Assisted Dip', 30, 8],
    ['Two-Arm Dumbbell Row', 30, 10],
  ];
  const fileOf = (rows: readonly Row[], date = '2026-09-01') => [B2, ...rows.map(([n, w, r]) => `${date},${n},Other,${String(w)},kgs,${String(r)},,,,`)].join('\n');

  it('FitNotes’ default names against the real catalogue: no suggestion contradicts an equipment or one-arm word in the name (review r4 S3, r5 S3, N1)', async () => {
    const d = await open(fileOf([...DEFAULTS, ...VARIANTS]));
    const by = new Map(d.analysis.names.map((n) => [n.name, n]));
    const exercise = (id: string | null) => (id === null ? null : s.imports.candidate(d.draftId, id));
    for (const [name] of [...DEFAULTS, ...VARIANTS]) {
      const c = exercise(by.get(name)?.match.exerciseId ?? null);
      if (c) expect(equipmentContradicts(name, c), `${name} → ${c.name} (${c.compatibleEquipment.join(', ')})`).toBe(false);
    }
    const shown = (name: string) => {
      const n = by.get(name);
      return [n?.match.status, exercise(n?.match.exerciseId ?? null)?.name ?? null];
    };
    expect(shown('Flat Dumbbell Bench Press')).toEqual(['matched', 'Dumbbell bench press']);
    expect(shown('One-Arm Standing Dumbbell Press')).toEqual(['matched', 'One-arm dumbbell shoulder press']);
    expect(shown('Dumbbell Concentration Curl')).toEqual(['matched', 'Dumbbell concentration curl']);
    expect(shown('Flat Barbell Bench Press')).toEqual(['matched', 'Bench press']);
    expect(shown('EZ-Bar Skullcrusher')).toEqual(['check', 'Skull crusher']);
    // Never the EZ-bar skull crusher, the dumbbell shrug or the calf-raise machine for these: nothing, or one with the right equipment.
    expect(shown('Dumbbell Skullcrusher')).toEqual(['no_match', null]);
    expect(shown('Barbell Shrug')).toEqual(['matched', 'Barbell shrug']);
    expect(shown('Machine Shrug')).toEqual(['no_match', null]);
    expect(shown('Barbell Calf Raise')).toEqual(['check', 'Standing barbell calf raise']);
    expect(shown('Lateral Machine Raise')).toEqual(['check', 'Cable lateral raise']);
    // A Smith machine is its own kind: only a Smith exercise, and only for the same movement (review r5 S3).
    expect(shown('Smith Machine Close Grip Bench Press')).toEqual(['check', 'Smith machine bench press']);
    expect(shown('Smith Machine Overhead Press')).toEqual(['no_match', null]);
    // A machine is never an assisted machine unless the name says assisted: 80 kg of stack is never 80 kg of help (review r5 S3).
    expect(shown('Triceps Dip Machine')).toEqual(['no_match', null]);
    expect(shown('Dip Machine')).toEqual(['no_match', null]);
    expect(shown('Assisted Dip')).toEqual(['matched', 'Assisted dip']);
    // A name that says two arms is never the one-arm row (review r5 N1).
    expect(shown('Two-Arm Dumbbell Row')[1]).not.toBe('One-arm dumbbell row');
    // The machines line names what is read as assistance, with what it imports as (review r6 N2).
    const machines = previewView(d, 'en-GB').kept.find((l) => l.text.startsWith('Machines:'));
    expect(plain(machines?.detail)).toBe('Read as assistance (more weight is easier): Assisted Dip (30 kg → 30 kg assistance)');
  });

  it('an assisted machine written as negative numbers shows its conversion; a positive value among them can’t be read (review r6 S3, N2)', async () => {
    let d = await open([B2, '2026-09-01,Assisted Dip,Arms,-30.0,kgs,8,,,,', '2026-09-02,Assisted Dip,Arms,10.0,kgs,5,,,,', '2026-09-02,Assisted Pull Up,Back,-45.0,lbs,8,,,,'].join('\n'));
    for (const n of d.analysis.names.filter((x) => x.needsAnswer && x.match.exerciseId)) d = await step(d, { kind: 'name', key: n.key, answer: { kind: 'exercise', exerciseId: n.match.exerciseId ?? '' } });
    const v = previewView(d, 'en-GB');
    expect(plain(v.kept.find((l) => l.text.startsWith('Machines:'))?.detail)).toBe(
      'Read as assistance (more weight is easier): Assisted Dip (−30 kg → 30 kg assistance; positive values can’t be read), Assisted Pull Up (−45 lb → 45 lb assistance)',
    );
    expect(v.skipped.find((x) => x.key === 'unreadable')?.line.text).toBe('1 row can’t be read');
    const r = await s.imports.commit(d.draftId, d.mappingVersion, 'op-assisted');
    if (!r.ok) throw new Error(r.reason);
    const rows = (await s.imports.job(r.jobId))?.rows ?? [];
    expect(rows.map((x) => (x.imported?.load ? `${String(x.imported.load.value)} ${x.imported.load.unit} ${x.imported.load.convention}` : x.result))).toEqual(['30 kg assistance', 'unreadable', '45 lb assistance']);
  });

  it('FitNotes’ one-dumbbell defaults are never halved by "Both dumbbells together"; names that don’t say are asked (review r4 S1)', async () => {
    let d = await open(
      fileOf([
        ['One-Arm Standing Dumbbell Press', 22, 8],
        ['Dumbbell Concentration Curl', 14, 10],
        ['Seated Dumbbell Press', 40, 8],
        ['Flat Dumbbell Bench Press', 60, 8],
        ['Dumbbell Row', 30, 10],
        ['Dumbbell Squat', 40, 10],
      ]),
    );
    // Use this on the one Check (Dumbbell Squat → Goblet squat), then "Both together" for the pairs.
    for (const n of d.analysis.names.filter((x) => x.needsAnswer && x.match.exerciseId)) d = await step(d, { kind: 'name', key: n.key, answer: { kind: 'exercise', exerciseId: n.match.exerciseId ?? '' } });
    d = await step(d, { kind: 'per_hand', answer: 'both' });
    const q = perHandOptions(d.analysis, 'en-GB');
    // `Dumbbell Row` is a name of the one-arm row and `Dumbbell Squat` was suggested as the goblet squat, but neither says one: asked, nothing selected.
    expect(q?.ask?.rows.map((r) => [r.title, plain(r.conversion), r.choices.filter((c) => c.selected).length])).toEqual([
      ['Dumbbell Row', '30 kg → not answered yet', 0],
      ['Dumbbell Squat', '40 kg → not answered yet', 0],
    ]);
    expect(q?.rows?.rows.map((r) => [r.title, plain(r.conversion)])).toEqual([
      ['One-Arm Standing Dumbbell Press', '22 kg → 22 kg (one dumbbell)'],
      ['Dumbbell Concentration Curl', '14 kg → 14 kg (one dumbbell)'],
      ['Seated Dumbbell Press', '40 kg → 20 kg each'],
      ['Flat Dumbbell Bench Press', '60 kg → 30 kg each'],
    ]);
    expect(q?.rows?.note).toBe('2 exercises use one dumbbell, so their weights are imported as written.');

    // Ben maps the one-arm press to the two-dumbbell standing press himself (Choose…): still asked, never halved.
    const pair = s.imports.searchExercises(d.draftId, 'standing dumbbell shoulder').find((c) => c.name === 'Standing dumbbell shoulder press');
    d = await step(d, { kind: 'name', key: nameKey('One-Arm Standing Dumbbell Press'), answer: { kind: 'exercise', exerciseId: pair?.exerciseId ?? '' } });
    expect(perHandOptions(d.analysis, 'en-GB')?.ask?.rows.map((r) => [r.title, plain(r.conversion)])).toEqual([
      ['One-Arm Standing Dumbbell Press', '22 kg → not answered yet'],
      ['Dumbbell Row', '30 kg → not answered yet'],
      ['Dumbbell Squat', '40 kg → not answered yet'],
    ]);
    d = await step(d, { kind: 'per_hand_override', key: nameKey('One-Arm Standing Dumbbell Press'), answer: 'one' });
    d = await step(d, { kind: 'per_hand_override', key: nameKey('Dumbbell Row'), answer: 'one' });
    d = await step(d, { kind: 'per_hand_override', key: nameKey('Dumbbell Squat'), answer: 'both' });
    const r = await s.imports.commit(d.draftId, d.mappingVersion, 'op-defaults');
    if (!r.ok) throw new Error(r.reason);
    const job = await s.imports.importedRows(r.jobId, '2026-09-01');
    expect(job?.rows.map((x) => [x.exerciseName, x.imported?.exerciseName, x.imported?.load?.value])).toEqual([
      ['One-Arm Standing Dumbbell Press', 'Standing dumbbell shoulder press', 22],
      ['Dumbbell Concentration Curl', 'Dumbbell concentration curl', 14],
      ['Seated Dumbbell Press', 'Dumbbell shoulder press', 20],
      ['Flat Dumbbell Bench Press', 'Dumbbell bench press', 30],
      ['Dumbbell Row', 'One-arm dumbbell row', 30],
      ['Dumbbell Squat', 'Goblet squat', 20],
    ]);
  });

  it('Ben’s dumbbell answer for an exercise is remembered with its name and filled in for a newer export (review r4 S2)', async () => {
    const ONE_ARM = nameKey('One-Arm Standing Dumbbell Press');
    const first: readonly Row[] = [
      ['One-Arm Standing Dumbbell Press', 22, 8],
      ['Zottman Curl', 14, 10],
      ['Seated Dumbbell Press', 40, 8],
    ];
    let d = await open(fileOf(first));
    // The review's path: Ben maps the one-arm press to the pair press, answers one dumbbell for it and the new Zottman curl, and "both" for the rest.
    const pair = s.imports.searchExercises(d.draftId, 'standing dumbbell shoulder').find((c) => c.name === 'Standing dumbbell shoulder press');
    d = await step(d, { kind: 'name', key: ONE_ARM, answer: { kind: 'exercise', exerciseId: pair?.exerciseId ?? '' } });
    d = await step(d, { kind: 'name', key: 'zottman curl', answer: { kind: 'new', equipment: 'dumbbells' } });
    d = await step(d, { kind: 'per_hand', answer: 'both' });
    d = await step(d, { kind: 'per_hand_override', key: ONE_ARM, answer: 'one' });
    d = await step(d, { kind: 'per_hand_override', key: 'zottman curl', answer: 'one' });
    const r1 = await s.imports.commit(d.draftId, d.mappingVersion, 'op-first');
    if (!r1.ok) throw new Error(r1.reason);

    // A month later: a newer export with the same names and one more workout.
    const newer: readonly Row[] = [
      ['One-Arm Standing Dumbbell Press', 24, 8],
      ['Zottman Curl', 16, 10],
      ['Seated Dumbbell Press', 42, 8],
    ];
    const withoutHeader = (text: string) => text.split('\n').slice(1).join('\n');
    let n = await open(`${fileOf(first)}\n${withoutHeader(fileOf(newer, '2026-10-08'))}`);
    expect(n.analysis.names.map((x) => [x.name, x.match.status, x.match.via])).toEqual([
      ['One-Arm Standing Dumbbell Press', 'matched', 'alias'],
      ['Seated Dumbbell Press', 'matched', 'name'],
      ['Zottman Curl', 'matched', 'alias'],
    ]);
    // Filled in from last time and labelled; the group answer is still asked (never pre-selected, DX6).
    const q = perHandOptions(n.analysis, 'en-GB');
    expect(q?.ask?.rows.map((x) => [x.title, plain(x.conversion), x.remembered, x.choices.filter((c) => c.selected).map((c) => c.label)])).toEqual([
      ['One-Arm Standing Dumbbell Press', '24 kg → 24 kg (one dumbbell)', 'Your answer last time', ['One dumbbell']],
      ['Zottman Curl', '16 kg → 16 kg (one dumbbell)', 'Your answer last time', ['One dumbbell']],
    ]);
    expect(q?.options.map((o) => o.selected)).toEqual([false, false]);
    expect(previewView(n, 'en-GB').questions.map((x) => x.line.text)).toEqual(['Dumbbell weights: each or both?']);
    n = await step(n, { kind: 'per_hand', answer: 'both' });
    const r2 = await s.imports.commit(n.draftId, n.mappingVersion, 'op-second');
    if (!r2.ok) throw new Error(r2.reason);
    const later = await s.imports.importedRows(r2.jobId, '2026-10-08');
    expect(later?.rows.map((x) => [x.exerciseName, x.imported?.load?.value])).toEqual([
      ['One-Arm Standing Dumbbell Press', 24],
      ['Zottman Curl', 16],
      ['Seated Dumbbell Press', 21],
    ]);
    // The import records the answers it used.
    expect(later?.job.answers.perHandOverrides).toEqual({ [ONE_ARM]: 'one', 'zottman curl': 'one' });
  });

  it('a kettlebell exercise on the dumbbell screen says kettlebell, not dumbbell (review r5 N3)', async () => {
    let d = await open(fileOf([['Kettlebell Press', 24, 8], ['Dumbbell Curl', 24, 10], ['Dumbbell Pullover', 30, 10]]));
    d = await step(d, { kind: 'per_hand', answer: 'both' });
    const q = perHandOptions(d.analysis, 'en-GB');
    expect(q?.rows?.rows.map((r) => [r.title, plain(r.conversion), r.choices.map((c) => c.label)])).toEqual([
      ['Kettlebell Press', '24 kg → 24 kg (one kettlebell)', ['One kettlebell', 'Both together']],
      ['Dumbbell Curl', '24 kg → 12 kg each', ['Same', 'Each', 'Both together']],
      ['Dumbbell Pullover', '30 kg → 30 kg (one dumbbell)', ['One dumbbell', 'Both together']],
    ]);
    expect(q?.rows?.note).toBe('2 exercises use one dumbbell or kettlebell, so their weights are imported as written.');
    expect(q?.question).toBe('For this exercise with two dumbbells, “24” means:');
  });

  describe('Undo import takes back what that import taught (review r5 S2)', () => {
    const withoutHeader = (text: string) => text.split('\n').slice(1).join('\n');
    const commit = async (d: ImportDraft, op: string): Promise<string> => {
      const r = await s.imports.commit(d.draftId, d.mappingVersion, op);
      if (!r.ok) throw new Error(r.reason);
      return r.jobId;
    };
    const undo = async (jobId: string) => {
      const job = await s.imports.job(jobId);
      if (!job) throw new Error('no job');
      expect(await s.imports.revert(jobId, job.job.version, `undo-${jobId}`)).toMatchObject({ ok: true });
    };
    const useSuggestions = async (d: ImportDraft): Promise<ImportDraft> => {
      let out = d;
      for (const n of out.analysis.names.filter((x) => x.needsAnswer && x.match.exerciseId)) out = await step(out, { kind: 'name', key: n.key, answer: { kind: 'exercise', exerciseId: n.match.exerciseId ?? '' } });
      return out;
    };
    const names = (d: ImportDraft) => d.analysis.names.map((n) => [n.name, n.match.status, n.match.via, n.needsAnswer]);
    /** Each asked exercise: what it imports as, whether it is labelled as last time's answer, and what is selected. */
    const asked = (d: ImportDraft) => perHandOptions(d.analysis, 'en-GB')?.ask?.rows.map((r) => [r.title, plain(r.conversion), r.remembered, r.choices.filter((c) => c.selected).map((c) => c.label)]);

    it('dumbbell answers: an undone import’s answer is never filled in; the import still in effect’s is, and with none it is asked with nothing selected', async () => {
      const A = fileOf([['Zottman Curl', 16, 10]]);
      let a = await open(A);
      a = await step(a, { kind: 'name', key: 'zottman curl', answer: { kind: 'new', equipment: 'dumbbells' } });
      a = await step(a, { kind: 'per_hand_override', key: 'zottman curl', answer: 'one' });
      const jobA = await commit(a, 'op-a');

      // A newer export: Ben changes the Zottman curl to "Both together", imports it, sees 18 → 9 each, and undoes it.
      const B = `${A}\n${withoutHeader(fileOf([['Zottman Curl', 18, 10]], '2026-09-20'))}`;
      let b = await open(B);
      expect(names(b)).toEqual([['Zottman Curl', 'matched', 'alias', false]]);
      expect(asked(b)).toEqual([['Zottman Curl', '18 kg → 18 kg (one dumbbell)', 'Your answer last time', ['One dumbbell']]]);
      b = await step(b, { kind: 'per_hand_override', key: 'zottman curl', answer: 'both' });
      const jobB = await commit(b, 'op-b');
      expect((await s.imports.importedRows(jobB, '2026-09-20'))?.rows.map((x) => x.imported?.load?.value)).toEqual([9]);
      await undo(jobB);

      // Opened again: the answer in effect is the first import's (one dumbbell), labelled; never "Both together".
      const again = await open(B);
      expect(names(again)).toEqual([['Zottman Curl', 'matched', 'alias', false]]);
      expect(asked(again)).toEqual([['Zottman Curl', '18 kg → 18 kg (one dumbbell)', 'Your answer last time', ['One dumbbell']]]);

      // With the first import undone too, nothing it taught is left: the name is a suggestion (not Matched), and its dumbbells are asked with nothing selected.
      await undo(jobA);
      let none = await open(B);
      expect(names(none)).toEqual([['Zottman Curl', 'check', 'words', true]]);
      none = await useSuggestions(none);
      expect(asked(none)).toEqual([['Zottman Curl', '18 kg → not answered yet', null, []]]);
      expect(none.analysis.ready).toBe(false);
    });

    it('names: an undone import’s `Use this` comes back as a suggestion to check; importing again with other answers teaches those', async () => {
      const rows: readonly Row[] = [
        ['Front Dumbbell Raise', 16, 10],
        ['Dumbbell Preacher Curl', 20, 10],
      ];
      let a = await useSuggestions(await open(fileOf(rows)));
      a = await step(a, { kind: 'per_hand_override', key: nameKey('Front Dumbbell Raise'), answer: 'both' });
      a = await step(a, { kind: 'per_hand_override', key: nameKey('Dumbbell Preacher Curl'), answer: 'one' });
      await undo(await commit(a, 'op-a'));

      // Opened again: both are `Check`s again, and once accepted their dumbbells are asked with nothing selected.
      let again = await open(fileOf(rows));
      expect(names(again)).toEqual([
        ['Dumbbell Preacher Curl', 'check', 'words', true],
        ['Front Dumbbell Raise', 'check', 'words', true],
      ]);
      expect(previewView(again, 'en-GB').questions.map((q) => q.line.text)).toEqual(['2 exercise names to check']);
      again = await useSuggestions(again);
      expect(asked(again)).toEqual([
        ['Front Dumbbell Raise', '16 kg → not answered yet', null, []],
        ['Dumbbell Preacher Curl', '20 kg → not answered yet', null, []],
      ]);
      // This time Ben answers the other way round and imports.
      again = await step(again, { kind: 'per_hand_override', key: nameKey('Front Dumbbell Raise'), answer: 'one' });
      again = await step(again, { kind: 'per_hand_override', key: nameKey('Dumbbell Preacher Curl'), answer: 'each' });
      await commit(again, 'op-a2');

      // A newer export: the new answers are remembered; the undone ones never come back.
      const newer = await open(`${fileOf(rows)}\n${withoutHeader(fileOf([['Front Dumbbell Raise', 18, 10], ['Dumbbell Preacher Curl', 22, 10]], '2026-10-08'))}`);
      expect(names(newer)).toEqual([
        ['Dumbbell Preacher Curl', 'matched', 'alias', false],
        ['Front Dumbbell Raise', 'matched', 'alias', false],
      ]);
      expect(asked(newer)).toEqual([
        ['Front Dumbbell Raise', '18 kg → 18 kg (one dumbbell)', 'Your answer last time', ['One dumbbell']],
        ['Dumbbell Preacher Curl', '22 kg → 22 kg each', 'Your answer last time', ['Each']],
      ]);
      expect(newer.analysis.ready).toBe(true);
    });

    it('a name a later import used stays in effect while that import is, even when the import that taught it is undone', async () => {
      const A = fileOf([['Front Dumbbell Raise', 16, 10]]);
      let a = await useSuggestions(await open(A));
      a = await step(a, { kind: 'per_hand_override', key: nameKey('Front Dumbbell Raise'), answer: 'one' });
      const jobA = await commit(a, 'op-a');
      const B = `${A}\n${withoutHeader(fileOf([['Front Dumbbell Raise', 18, 10]], '2026-10-01'))}`;
      const b = await open(B);
      expect(names(b)).toEqual([['Front Dumbbell Raise', 'matched', 'alias', false]]);
      await commit(b, 'op-b');
      await undo(jobA);
      const c = await open(`${B}\n${withoutHeader(fileOf([['Front Dumbbell Raise', 20, 10]], '2026-10-08'))}`);
      // The second import, still in effect, read it as the lateral raise with one dumbbell: so does this one.
      expect(names(c)).toEqual([['Front Dumbbell Raise', 'matched', 'alias', false]]);
      expect(asked(c)).toEqual([['Front Dumbbell Raise', '20 kg → 20 kg (one dumbbell)', 'Your answer last time', ['One dumbbell']]]);
      // 1 Sep (the undone import's date) is offered again; 1 Oct (the second import's) is skipped.
      expect(c.analysis.workouts.map((w) => w.date)).toEqual(['2026-10-08', '2026-09-01']);
    });

    describe('`Add new` equipment: an import never changes an exercise, so Undo import leaves nothing behind (review r6 B1)', () => {
      /** What a job stored, by date: `value convention`, or the row's result. */
      const stored = async (jobId: string, dates: readonly string[]) => {
        const out: string[] = [];
        for (const date of dates) {
          const rows = (await s.imports.job(jobId))?.rows.filter((r) => r.localDate === date) ?? [];
          for (const r of rows) out.push(r.imported?.load ? `${date} ${String(r.imported.load.value)} ${r.imported.load.convention}` : `${date} ${r.result}`);
        }
        return out;
      };
      const exerciseOf = (d: ImportDraft, name: string) => {
        const n = d.analysis.names.find((x) => x.name === name);
        return n?.resolution.kind === 'exercise' ? n.resolution.exercise : null;
      };

      it('stack, then assisted, then undo: a name an import still in effect mapped to the stack exercise keeps reading as a stack (the review’s six steps)', async () => {
        // 1. `Pull Up Machine` has no match: Ben adds it as a weight stack.
        let a = await open(fileOf([['Pull Up Machine', 40, 10]], '2026-09-01'));
        expect(names(a)).toEqual([['Pull Up Machine', 'no_match', null, true]]);
        a = await step(a, { kind: 'name', key: 'pull up machine', answer: { kind: 'new', equipment: 'weight_stack' } });
        const jobA = await commit(a, 'op-a');
        expect(await stored(jobA, ['2026-09-01'])).toEqual(['2026-09-01 40 stack']);
        const stack = exerciseOf(a, 'Pull Up Machine')?.exerciseId ?? '';

        // 2. `Pullup Mach` is suggested as it; Ben chooses it.
        let a2 = await open(fileOf([['Pullup Mach', 45, 10]], '2026-09-05'));
        expect(names(a2)).toEqual([['Pullup Mach', 'check', 'words', true]]);
        a2 = await step(a2, { kind: 'name', key: 'pullup mach', answer: { kind: 'exercise', exerciseId: stack } });
        const jobA2 = await commit(a2, 'op-a2');
        expect(await stored(jobA2, ['2026-09-05'])).toEqual(['2026-09-05 45 stack']);

        // 3. Ben undoes the first import.
        await undo(jobA);

        // 4. `Pull Up Machine` is now only a suggestion; Ben adds it as an assisted machine.
        let b = await open(fileOf([['Pull Up Machine', -30, 8]], '2026-09-10'));
        expect(names(b)).toEqual([['Pull Up Machine', 'check', 'words', true]]);
        b = await step(b, { kind: 'name', key: 'pull up machine', answer: { kind: 'new', equipment: 'assisted_stack' } });
        const assisted = exerciseOf(b, 'Pull Up Machine')?.exerciseId ?? '';
        expect(assisted).not.toBe(stack);
        const jobB = await commit(b, 'op-b');
        expect(await stored(jobB, ['2026-09-10'])).toEqual(['2026-09-10 30 assistance']);

        // 5. Ben undoes that too.
        await undo(jobB);

        // 6. A newer export: `Pullup Mach` is matched through the second import, still in effect, which read it as a stack.
        const c = await open(fileOf([['Pullup Mach', 45, 10]], '2026-09-05').concat('\n', withoutHeader(fileOf([['Pullup Mach', -20, 8]], '2026-09-20')), '\n', withoutHeader(fileOf([['Pullup Mach', 50, 8]], '2026-09-21'))));
        expect(names(c)).toEqual([['Pullup Mach', 'matched', 'alias', false]]);
        expect(exerciseOf(c, 'Pullup Mach')).toMatchObject({ exerciseId: stack, convention: 'stack' });
        expect(s.imports.candidate(c.draftId, stack)).toMatchObject({ defaultLoadConvention: 'stack', compatibleEquipment: ['weight_stack'] });
        expect(c.analysis.machines.map((m) => [m.name, m.convention])).toEqual([['Pullup Mach', 'stack']]);
        const jobC = await commit(c, 'op-c');
        // Never assistance: the −20 can't be read as a stack weight; 50 is 50 kg on the stack.
        expect(await stored(jobC, ['2026-09-05', '2026-09-20', '2026-09-21'])).toEqual(['2026-09-05 skipped_duplicate', '2026-09-20 unreadable', '2026-09-21 50 stack']);
      });

      it('assisted, then stack, then undo: the assisted exercise stays assisted (the mirror case)', async () => {
        let a = await open(fileOf([['Pull Up Machine', -30, 8]], '2026-09-01'));
        a = await step(a, { kind: 'name', key: 'pull up machine', answer: { kind: 'new', equipment: 'assisted_stack' } });
        const jobA = await commit(a, 'op-a');
        const assisted = exerciseOf(a, 'Pull Up Machine')?.exerciseId ?? '';
        let a2 = await open(fileOf([['Pullup Mach', -25, 8]], '2026-09-05'));
        a2 = await step(a2, { kind: 'name', key: 'pullup mach', answer: { kind: 'exercise', exerciseId: assisted } });
        await commit(a2, 'op-a2');
        await undo(jobA);

        let b = await open(fileOf([['Pull Up Machine', 40, 10]], '2026-09-10'));
        b = await step(b, { kind: 'name', key: 'pull up machine', answer: { kind: 'new', equipment: 'weight_stack' } });
        const jobB = await commit(b, 'op-b');
        expect(await stored(jobB, ['2026-09-10'])).toEqual(['2026-09-10 40 stack']);
        await undo(jobB);

        const c = await open(fileOf([['Pullup Mach', -20, 8]], '2026-09-20').concat('\n', withoutHeader(fileOf([['Pullup Mach', -15, 8]], '2026-09-21'))));
        expect(names(c)).toEqual([['Pullup Mach', 'matched', 'alias', false]]);
        expect(s.imports.candidate(c.draftId, assisted)).toMatchObject({ defaultLoadConvention: 'assistance', compatibleEquipment: ['assisted_stack'] });
        const jobC = await commit(c, 'op-c');
        expect(await stored(jobC, ['2026-09-20', '2026-09-21'])).toEqual(['2026-09-20 20 assistance', '2026-09-21 15 assistance']);
      });

      it('dumbbells, then barbell, then undo: the remembered dumbbell answer applies again and no bar is added', async () => {
        const A = fileOf([['Zottman Curl', 16, 10]]);
        let a = await open(A);
        a = await step(a, { kind: 'name', key: 'zottman curl', answer: { kind: 'new', equipment: 'dumbbells' } });
        a = await step(a, { kind: 'per_hand_override', key: 'zottman curl', answer: 'one' });
        await commit(a, 'op-a');

        const B = `${A}\n${withoutHeader(fileOf([['Zottman Curl', 40, 10]], '2026-09-20'))}`;
        let b = await open(B);
        b = await step(b, { kind: 'name', key: 'zottman curl', answer: { kind: 'new', equipment: 'barbell' } });
        // Nothing is added until Ben answers it on its own (PM decision after review r7).
        expect(b.analysis.total?.exercises.map((e) => [e.name, e.bar, e.reading])).toEqual([['Zottman Curl', 'barbell', null]]);
        b = await step(b, { kind: 'total_override', key: 'zottman curl', answer: 'plates_only' });
        const jobB = await commit(b, 'op-b');
        expect(await stored(jobB, ['2026-09-20'])).toEqual(['2026-09-20 60 total']);
        await undo(jobB);

        let again = await open(B);
        expect(names(again)).toEqual([['Zottman Curl', 'matched', 'alias', false]]);
        expect(again.analysis.total).toBeNull();
        expect(asked(again)).toEqual([['Zottman Curl', '40 kg → 40 kg (one dumbbell)', 'Your answer last time', ['One dumbbell']]]);
        again = await step(again, { kind: 'existing_dates', answer: 'skip' });
        const jobC = await commit(again, 'op-c');
        expect(await stored(jobC, ['2026-09-20'])).toEqual(['2026-09-20 40 per_hand']);
      });
    });

    it('a preview rebuilt after an undo drops the answer that import taught, and keeps the answers Ben gave in this preview (review r6 S1)', async () => {
      // Import A: `Dumbbell Row` (a name of the one-arm row that doesn't say one arm) is asked; Ben answers "Both together".
      const A = fileOf([['Dumbbell Row', 20, 10]]);
      let a = await open(A);
      expect(asked(a)).toEqual([['Dumbbell Row', '20 kg → not answered yet', null, []]]);
      a = await step(a, { kind: 'per_hand_override', key: nameKey('Dumbbell Row'), answer: 'both' });
      const jobA = await commit(a, 'op-a');

      // B's preview opens with that answer filled in and labelled; Ben answers another exercise himself.
      const B = `${A}\n${withoutHeader(fileOf([['Dumbbell Row', 24, 10], ['Dumbbell Preacher Curl', 18, 10]], '2026-09-20'))}`;
      let b = await useSuggestions(await open(B));
      expect(asked(b)).toEqual([
        ['Dumbbell Row', '24 kg → 12 kg each', 'Your answer last time', ['Both together']],
        ['Dumbbell Preacher Curl', '18 kg → not answered yet', null, []],
      ]);
      b = await step(b, { kind: 'per_hand_override', key: nameKey('Dumbbell Preacher Curl'), answer: 'each' });
      expect(b.analysis.ready).toBe(true);

      // A is undone meanwhile: the commit is refused as stale, and the rebuilt preview no longer has A's answer.
      await undo(jobA);
      const r = await s.imports.commit(b.draftId, b.mappingVersion, 'op-b');
      if (r.ok || r.reason !== 'stale') throw new Error(`expected stale, got ${r.ok ? 'ok' : r.reason}`);
      expect(asked(r.draft)).toEqual([
        ['Dumbbell Row', '24 kg → not answered yet', null, []],
        ['Dumbbell Preacher Curl', '18 kg → 18 kg each', null, ['Each']],
      ]);
      expect(r.draft.analysis.ready).toBe(false);
      expect(r.draft.answers.perHandOverrides).toEqual({ [nameKey('Dumbbell Preacher Curl')]: 'each' });
    });
  });

  it('copies the original row as written', () => {
    expect(originalText('B2', ['2026-10-01', 'Flat Barbell Bench Press', 'Chest', '100.0', 'kgs', '8', '', '', '', '@8 felt heavy'])).toBe('Flat Barbell Bench Press · 100.0 kgs · 8 reps · “@8 felt heavy”');
    expect(originalText('A1-kg', ['2024-05-03', 'Treadmill', 'Cardio', '', '', '5', 'km', '25:00'])).toBe('Treadmill · 5 km · 25:00');
    expect(originalText('C', ['2026-10-02', 'Bench', 'Chest', '100', '220.46', '5', '', '', '', '', 'wr'])).toBe('Bench · 100 kg · 220.46 lbs · 5 reps');
  });

  it('explains every file it can’t preview', () => {
    expect(openErrorView({ kind: 'empty' })?.text).toBe('This file is empty.');
    expect(openErrorView({ kind: 'not_csv' })?.text).toBe('This isn’t a CSV file.');
    expect(openErrorView({ kind: 'fitnotes_backup' })?.text).toBe('This is a FitNotes backup, not a CSV. In FitNotes, export a CSV and choose that.');
    expect(openErrorView({ kind: 'unknown_header', firstLine: 'a,b' })).toEqual({ text: 'GymSmarter doesn’t recognise this file’s columns yet.', firstLine: 'a,b', sameFileJobId: null });
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
    expect(pausedLine({ written: 2, total: 2 })).toBe('Import not finished. All 2 workouts are in your history.');
    // The same file again while it's unfinished: Continue said once; a running import isn't called paused (review r2 N1).
    const job = paused?.job;
    if (!job) throw new Error('no job');
    expect(openErrorView({ kind: 'same_file', job, written: 2, state: 'paused', inRecentlyDeleted: 0 }, 'en-GB')?.text).toBe('You started importing this file on Thu 8 Oct. Import not finished. All 2 workouts are in your history. Continue that import instead.');
    expect(openErrorView({ kind: 'same_file', job, written: 1, state: 'running', inRecentlyDeleted: 0 }, 'en-GB')?.text).toBe('You started importing this file on Thu 8 Oct. It’s importing now: 1 of 2 workouts in.');
    expect(progressView(180, 412)).toEqual({ text: '180 of 412 workouts', fraction: 180 / 412 });
  });
});

describe('import wording without a database', () => {
  it('a cleared bar weight warns and goes back to the weight still in use (review r2 S1)', () => {
    const olympic = { value: 20, unit: 'kg' as const, missing: null };
    // Cleared while editing: says what's still added.
    expect(barWeightEntry('', olympic)).toEqual({ save: null, endText: '20', warning: `Enter a bar weight above 0. Until you do, 20${NBSP}kg is added to plates-only values.` });
    expect(barWeightEntry('0', olympic)).toMatchObject({ save: null, endText: '20' });
    expect(barWeightEntry('abc', olympic)).toMatchObject({ save: null, endText: '20' });
    // A new weight is saved; the same weight isn't saved again.
    expect(barWeightEntry('15', olympic)).toEqual({ save: 15, endText: '15', warning: null });
    expect(barWeightEntry('7,5', olympic)).toEqual({ save: 7.5, endText: '7,5', warning: null });
    expect(barWeightEntry('20', olympic)).toEqual({ save: null, endText: '20', warning: null });
    // An EZ bar has no default: an empty field shows what's missing, and nothing is invented.
    const ez = { value: null, unit: 'kg' as const, missing: 'EZ-bar weight needed (kg)' };
    expect(barWeightEntry('', ez)).toEqual({ save: null, endText: '', warning: ez.missing });
    expect(barWeightEntry('0', ez)).toEqual({ save: null, endText: '0', warning: 'Enter a bar weight above 0.' });
    expect(barWeightEntry('10', ez)).toEqual({ save: 10, endText: '10', warning: null });
  });

  it('a bar weight above the maximum is refused in the app’s words, never saved (review r3 N1)', () => {
    const olympic = { value: 20, unit: 'kg' as const, missing: null };
    expect(barWeightEntry('200', olympic)).toEqual({ save: null, endText: '20', warning: `Enter a bar weight up to 100${NBSP}kg. Until you do, 20${NBSP}kg is added to plates-only values.` });
    expect(barWeightEntry('100', olympic)).toEqual({ save: 100, endText: '100', warning: null });
    const lb = { value: 45, unit: 'lb' as const, missing: null };
    expect(barWeightEntry('220', lb)).toMatchObject({ save: 220, warning: null });
    expect(barWeightEntry('450', lb)).toEqual({ save: null, endText: '45', warning: `Enter a bar weight up to 220${NBSP}lb. Until you do, 45${NBSP}lb is added to plates-only values.` });
    const ez = { value: null, unit: 'kg' as const, missing: 'EZ-bar weight needed (kg)' };
    expect(barWeightEntry('150', ez)).toEqual({ save: null, endText: '150', warning: `Enter a bar weight up to 100${NBSP}kg.` });
  });

  it('a workout whose save wasn’t confirmed is never called failed (review r2 N4)', () => {
    expect(writeFailedLine({ written: 1, date: '2026-09-03', message: 'disk full' }, 'en-GB')).toBe(
      'Workout 2 (Thu 3 Sept 2026) may not have saved: disk full. 1 workout is in before it.',
    );
  });
});
