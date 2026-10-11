import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { ImportDraft } from '../src/import/import-service';
import { namesView } from '../src/import/views';
import type { AppServices } from '../src/services/app-services';
import { createHarness, setUpGym, type Harness } from './harness';

/**
 * The FitNotes `Category` column as a ranking hint for name suggestions,
 * against the real catalogue, end to end (real-file run, 11 Oct 2026).
 * Synthetic rows: only exercise names from that run's findings, with
 * categories as FitNotes (Android) and FitNotes 2 (iPhone) write them.
 */
const B2 = 'Date,Exercise,Category,Weight,Weight Unit,Reps,Distance,Distance Unit,Time,Comment';

type Shown = readonly [status: 'matched' | 'check' | 'no_match', exercise: string | null];
type Case = readonly [name: string, category: string, expected: Shown];

const CASES: readonly Case[] = [
  // Wrong or weak suggestions in the run.
  ['Barbell Leg Curls', 'Legs', ['no_match', null]],
  ['Straight-Arm Cable Pushdown', 'Back', ['matched', 'Straight-arm pulldown']],
  ['Lat Cable Pull', 'Back', ['check', 'Lat pulldown']],
  // No match in the run.
  ['Lat Prayers', 'Back', ['matched', 'Lat prayer']],
  ['Seal Row', 'Back', ['check', 'Barbell seal row']],
  ['Barbell Shrug', 'Back', ['matched', 'Barbell shrug']],
  ['Barbell Calf Raise', 'Legs', ['matched', 'Standing barbell calf raise']],
  // FitNotes' own default names that are unambiguous.
  ['Flat Barbell Bench Press', 'Chest', ['matched', 'Bench press']],
  ['Leg Extension Machine', 'Legs', ['matched', 'Leg extension']],
  ['Seated Calf Raise Machine', 'Legs', ['matched', 'Seated calf raise']],
  ['Lateral Dumbbell Raise', 'Shoulders', ['matched', 'Lateral raise']],
  ['Rope Push Down', 'Triceps', ['matched', 'Rope triceps pushdown']],
  ['Parallel Bar Triceps Dip', 'Triceps', ['matched', 'Dip']],
  ['Chest Dips', 'Chest', ['matched', 'Dip']],
  ['Cable Crossovers', 'Chest', ['matched', 'Cable fly']],
  ['Seated Machine Fly', 'Chest', ['matched', 'Pec deck']],
  ['Rear Delt Machine Fly', 'Shoulders', ['matched', 'Reverse pec deck']],
  ['Rear Delt Dumbell Fly', 'Shoulders', ['matched', 'Dumbbell rear-delt fly']],
  // Can be a 45° extension, a Roman chair or a stack machine: Ben confirms.
  ['Lower Back Extensions', 'Back', ['check', '45° back extension']],
  // Ambiguous (Ben's is a machine; the catalogue has dumbbell, cable and machine flies): never matched or guessed.
  ['Chest Fly', 'Chest', ['no_match', null]],
];

/** FitNotes 2 (iPhone) muscle-level categories give the same hint. */
const IOS_CASES: readonly Case[] = [
  ['Barbell Leg Curls', 'Hamstrings', ['no_match', null]],
  ['Barbell Leg Curls', 'Quadriceps', ['no_match', null]],
  ['Lat Cable Pull', 'Lats', ['check', 'Lat pulldown']],
  ['Barbell Shrug', 'Trapezius', ['matched', 'Barbell shrug']],
  ['Barbell Calf Raise', 'Calves', ['matched', 'Standing barbell calf raise']],
  ['Lower Back Extensions', 'Back (Lower)', ['check', '45° back extension']],
  ['Chest Fly', 'Pectorals', ['no_match', null]],
];

/** A hint only: no category (or one it doesn't know) leaves the words alone, and a category never overrides or makes a match. */
const HINT_ONLY: readonly Case[] = [
  ['Barbell Leg Curls', 'Other', ['check', 'Barbell curl']],
  ['Barbell Leg Curls', '', ['check', 'Barbell curl']],
  ['Barbell Shrug', 'Legs', ['matched', 'Barbell shrug']],
  ['Lat Cable Pull', 'Lats', ['check', 'Lat pulldown']],
];

let h: Harness;
let s: AppServices;
beforeEach(async () => {
  h = createHarness('2026-10-11T17:00:00.000Z');
  s = (await h.launch()).services;
  await setUpGym(h, s);
});
afterEach(async () => {
  await h.cleanup();
});

async function open(rows: readonly (readonly [string, string])[]): Promise<ImportDraft> {
  const text = [B2, ...rows.map(([name, category], i) => `2026-09-01,${name},${category},${String(20 + 2 * i)},kgs,8,,,,`)].join('\n');
  const r = await s.imports.open({ name: 'FitNotes_Export.csv', text });
  if (r.kind !== 'preview') throw new Error(r.kind);
  return r.draft;
}

async function shownFor(cases: readonly Case[]): Promise<Map<string, Shown>> {
  const d = await open(cases.map(([n, c]) => [n, c] as const));
  const out = new Map<string, Shown>();
  for (const n of d.analysis.names) {
    const id = n.match.exerciseId;
    out.set(n.name, [n.match.status, id === null ? null : (s.imports.candidate(d.draftId, id)?.name ?? null)]);
  }
  return out;
}

describe('FitNotes category as a ranking hint (real catalogue)', () => {
  it.each([
    ['FitNotes (Android) categories', CASES],
    ['FitNotes 2 (iPhone) categories', IOS_CASES],
  ] as const)('%s: every name from the run', async (_label, cases) => {
    const shown = await shownFor(cases);
    for (const [name, category, expected] of cases) expect(shown.get(name), `${name} (${category})`).toEqual(expected);
  });

  it.each(HINT_ONLY.map((c) => [c[0], c[1] === '' ? 'blank' : c[1], c] as const))('%s under %s: the category is a hint only', async (_n, _c, c) => {
    const shown = await shownFor([c]);
    expect(shown.get(c[0])).toEqual(c[2]);
  });

  it('a suggestion that loses on muscle group is No match, with the category shown', async () => {
    const d = await open([
      ['Barbell Leg Curls', 'Legs'],
      ['Seal Row', 'Back'],
      ['Mystery Thing', ''],
    ]);
    const view = namesView(d.analysis, (id) => s.imports.candidate(d.draftId, id)?.name ?? null);
    expect(view.rows.map((r) => [r.title, r.status.word, r.status.text])).toEqual([
      ['Barbell Leg Curls', 'No match', 'No match · Legs'],
      ['Mystery Thing', 'No match', 'No match'],
      ['Seal Row', 'Check', 'Barbell seal row'],
    ]);
  });

  it('a name filed under several categories: the hint is all of them, and none when one is unknown', async () => {
    const d = await open([
      ['Barbell Leg Curls', 'Legs'],
      ['Barbell Leg Curls', 'Hamstrings'],
      ['Barbell Leg Curl', 'Legs'],
      ['Barbell Leg Curl', 'Other'],
    ]);
    const by = new Map(d.analysis.names.map((x) => [x.name, x]));
    expect([by.get('Barbell Leg Curls')?.match.status, by.get('Barbell Leg Curls')?.category]).toEqual(['no_match', 'Legs']);
    expect([by.get('Barbell Leg Curl')?.match.status, by.get('Barbell Leg Curl')?.category]).toEqual(['check', 'Legs']);
  });
});
