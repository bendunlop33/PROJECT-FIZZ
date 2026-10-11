import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { equipmentContradicts, nameKey, NBSP } from '@fizz/domain';
import type { Load, WeightUnit } from '@fizz/schemas';

import type { ImportDraft } from '../src/import/import-service';
import { perHandOptions, totalOptions } from '../src/import/views';
import type { AppServices } from '../src/services/app-services';
import { createHarness, setUpGym, type Harness } from './harness';

/**
 * FitNotes' published default exercise names against the real catalogue,
 * end to end on SQLite, in kg and in lb (PM decision, review r5).
 *
 * A stored value may differ from the file's only with a source for it:
 * (a) the name is one of the exercise's own names, (b) Ben's own answer, or
 * (c) a word in the FitNotes name. A word suggestion accepted with `Use
 * this` gives the exercise only. The sources are checked here with the
 * test's own reading of the names, not the importer's.
 */
const DEFAULTS: readonly string[] = readFileSync(new URL('./fixtures/fitnotes-default-exercises.txt', import.meta.url), 'utf8')
  .split('\n')
  .map((l) => l.trim())
  .filter((l) => l !== '' && !l.startsWith('#'));

const B2 = 'Date,Exercise,Category,Weight,Weight Unit,Reps,Distance,Distance Unit,Time,Comment';
const DATE = '2026-09-01';
const plain = (s: string) => s.replaceAll(NBSP, ' ');
/** Each name's weight in the file: different for every name, so a mix-up shows. */
const rawOf = (i: number): number => 20 + 2 * i;
const fileOf = (unit: WeightUnit, names: readonly string[] = DEFAULTS): string => [B2, ...names.map((n, i) => `${DATE},${n},Other,${String(rawOf(i))},${unit === 'kg' ? 'kgs' : 'lbs'},8,,,,`)].join('\n');

// The test's own reading of the three sources.
const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();
/** (a) The FitNotes name is the exercise's name or one of its catalogue names. */
const ownName = (name: string, c: { name: string; aliases: readonly string[] }) => [c.name, ...c.aliases].some((x) => norm(x) === norm(name));
/** (c) Words that say two dumbbells. */
const pairWord = (name: string) => /\b(two[- ]?arms?|alternating|alternate|alt|double)\b/i.test(name);
/** (c) Words that say the machine assists. */
const assistWord = (name: string) => /\b(assist|assisted|assistance|gravitron|counter[- ]?weight(ed)?)\b/i.test(name);
/** (c) The word Smith: a Smith machine, whose bar isn't the Olympic bar. */
const smithWord = (name: string) => /\bsmith\b/i.test(name);

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

async function open(text: string): Promise<ImportDraft> {
  const r = await s.imports.open({ name: 'FitNotes_Export.csv', text });
  if (r.kind !== 'preview') throw new Error(r.kind);
  return r.draft;
}
async function step(d: ImportDraft, change: Parameters<AppServices['imports']['answer']>[2]): Promise<ImportDraft> {
  const r = await s.imports.answer(d.draftId, d.mappingVersion, change);
  if (!r.ok) throw new Error(r.reason);
  return r.draft;
}

interface Outcome {
  /** Names asked one by one on the dumbbell question. */
  askedPerHand: string[];
  /** FitNotes name → stored load. */
  stored: Map<string, Load | null>;
  /** FitNotes name → what the dumbbell or barbell screen showed it imports as. */
  shown: Map<string, number | null>;
}

/**
 * Ben at his most trusting: every `Check` accepted with `Use this`; a `No
 * match` with a dumbbell or barbell word added as new with that equipment,
 * any other skipped; "Both dumbbells together" and the barbell group's only
 * answer, "Total as written" (no group answer adds a bar: PM decision after
 * review r7). What is then still asked is answered as written ("One
 * dumbbell"), and each bodyweight exercise as weight added.
 */
async function importAll(
  unit: WeightUnit,
  names: readonly string[] = DEFAULTS,
): Promise<Outcome & { answered: Set<string>; added: Map<string, 'dumbbells' | 'barbell'>; exerciseOf: Map<string, { name: string; aliases: readonly string[]; compatibleEquipment: readonly string[]; defaultLoadConvention: string }> }> {
  let d = await open(fileOf(unit, names));
  const answered = new Set<string>();
  const added = new Map<string, 'dumbbells' | 'barbell'>();
  for (const n of d.analysis.names.filter((x) => x.needsAnswer)) {
    if (n.match.exerciseId) d = await step(d, { kind: 'name', key: n.key, answer: { kind: 'exercise', exerciseId: n.match.exerciseId } });
    else if (/\b(dumbbells?|db)\b/i.test(n.name)) {
      d = await step(d, { kind: 'name', key: n.key, answer: { kind: 'new', equipment: 'dumbbells' } });
      added.set(n.name, 'dumbbells');
    } else if (/\bbarbell\b/i.test(n.name)) {
      d = await step(d, { kind: 'name', key: n.key, answer: { kind: 'new', equipment: 'barbell' } });
      added.set(n.name, 'barbell');
    } else d = await step(d, { kind: 'name', key: n.key, answer: { kind: 'skip' } });
  }
  if (d.analysis.perHand) d = await step(d, { kind: 'per_hand', answer: 'both' });
  if (d.analysis.total) d = await step(d, { kind: 'total', answer: 'total' });
  for (const q of d.analysis.bodyweight) {
    d = await step(d, { kind: 'bodyweight', key: q.key, answer: 'added' });
    answered.add(q.name);
  }

  // What is still asked has nothing selected and says so.
  const ph = perHandOptions(d.analysis, 'en-GB');
  const askedPerHand = ph?.ask?.rows.filter((r) => r.choices.every((c) => !c.selected)).map((r) => r.title) ?? [];
  for (const r of ph?.ask?.rows ?? []) expect(plain(r.conversion), r.title).toMatch(/→ not answered yet$/);
  // Every barbell exercise is on the plates-only list with nothing selected, read as written by the group answer.
  for (const r of totalOptions(d.analysis, 'en-GB')?.platesOnly.rows ?? []) {
    expect(r.choices.some((c) => c.selected), r.title).toBe(false);
    expect(plain(r.now), r.title).toMatch(/ total as written$/);
  }
  for (const n of askedPerHand) {
    d = await step(d, { kind: 'per_hand_override', key: nameKey(n), answer: 'one' });
    answered.add(n);
  }
  expect(d.analysis.ready).toBe(true);

  const shown = new Map<string, number | null>();
  for (const e of d.analysis.perHand?.exercises ?? []) shown.set(e.name, e.sample?.imported ?? null);
  for (const e of d.analysis.total?.exercises ?? []) shown.set(e.name, e.sample?.imported ?? null);
  const exerciseOf = new Map(
    d.analysis.names.flatMap((n) => {
      if (n.resolution.kind !== 'exercise') return [];
      const c = s.imports.candidate(d.draftId, n.resolution.exercise.exerciseId);
      return c ? [[n.name, c] as const] : [];
    }),
  );

  const r = await s.imports.commit(d.draftId, d.mappingVersion, `op-${unit}`);
  if (!r.ok) throw new Error(r.reason);
  const rows = (await s.imports.importedRows(r.jobId, DATE))?.rows ?? [];
  const stored = new Map(rows.flatMap((x) => (x.imported ? [[x.exerciseName, x.imported.load] as const] : [])));
  for (const x of rows.filter((y) => y.imported)) expect(x.imported?.unit, x.exerciseName).toBe(unit);
  return { askedPerHand, stored, shown, answered, added, exerciseOf };
}

describe('FitNotes’ default names: nothing stored differs from the file without a source for it (PM decision, review r5)', () => {
  for (const unit of ['kg', 'lb'] as const) {
    it(`in ${unit}: every change is from the exercise’s own name, a word in the name, or Ben’s own answer; each shown before commit`, async () => {
      const { askedPerHand, stored, shown, answered, exerciseOf } = await importAll(unit);
      const halved: string[] = [];
      const assisted: string[] = [];
      DEFAULTS.forEach((name, i) => {
        if (!stored.has(name)) return; // skipped (no match, cardio) or unreadable: nothing stored
        const load = stored.get(name) ?? null;
        const raw = rawOf(i);
        const c = exerciseOf.get(name);
        const own = c !== undefined && ownName(name, c);
        const why = `${name} → ${c?.name ?? '?'}: ${String(raw)} ${unit} stored as ${JSON.stringify(load)}`;
        expect(load, why).not.toBeNull();
        if (!load) return;
        expect(load.unit, why).toBe(unit);
        // What the dumbbell or barbell screen showed is what is stored.
        if (shown.has(name)) expect(shown.get(name), why).toBe(load.value);
        if (load.convention === 'assistance') {
          assisted.push(name);
          expect(own || assistWord(name) || answered.has(name), why).toBe(true);
        }
        if (load.value === raw) return;
        if (load.convention === 'per_hand') {
          expect(load.value, why).toBe(raw / 2);
          halved.push(name);
          // The group answer reached it: only a pair known from its own name or a two-dumbbell word.
          expect(own || pairWord(name), why).toBe(true);
          return;
        }
        // No bar is ever added here: only Ben's answer for one exercise adds one (PM decision after review r7).
        expect.fail(`changed without a source: ${why}`);
      });

      // Not vacuous: the sources do change values, and the rest are asked with nothing selected.
      expect(halved.sort()).toEqual([
        'Arnold Dumbbell Press',
        'Dumbbell Curl',
        'Dumbbell Hammer Curl',
        'Flat Dumbbell Bench Press',
        'Flat Dumbbell Fly',
        'Incline Dumbbell Bench Press',
        // A catalogue alias of the lateral raise (a pair), so its own name.
        'Lateral Dumbbell Raise',
        'Seated Dumbbell Press',
      ]);
      expect(assisted).toEqual([]);
      // The dumbbell defaults whose count the name doesn't establish: asked, never halved by the group answer (review r5 S1).
      expect(askedPerHand.sort()).toEqual([
        'Dumbbell Preacher Curl',
        'Dumbbell Row',
        'Front Dumbbell Raise',
        'Incline Dumbbell Fly',
        'Rear Delt Dumbbell Raise',
        'Seated Dumbbell Lateral Raise',
        'Seated Incline Dumbbell Curl',
        'Walking',
      ]);
      // Every barbell default was read as written: the names that say Barbell, BB or EZ-Bar, and the exercises' own names, included.
      for (const n of ['Flat Barbell Bench Press', 'EZ-Bar Curl', 'Deadlift', 'Stiff-Legged Deadlift', 'Barbell Squat']) expect(stored.get(n), n).toMatchObject({ value: rawOf(DEFAULTS.indexOf(n)), convention: 'total' });
      // One-dumbbell defaults read as written.
      for (const n of ['One-Arm Standing Dumbbell Press', 'Dumbbell Concentration Curl', 'Dumbbell Overhead Triceps Extension']) expect(stored.get(n)?.value, n).toBe(rawOf(DEFAULTS.indexOf(n)));
    });
  }

  /** The review's Smith + Barbell and Assisted + Machine names (review r6 B2, B3), with plain Smith and assisted ones. */
  const TRICKY: readonly string[] = [
    'Smith Machine Barbell Squat',
    'Barbell Smith Squat',
    'Barbell Squat (Smith)',
    'Smith Machine Squat (Barbell)',
    'BB Smith Squat',
    'Smith Barbell Bench Press',
    'Smith Machine Bench Press (Barbell)',
    'Barbell Bench Press (Smith Machine)',
    'Smith Machine Incline Barbell Press',
    'Smith Machine Barbell Row',
    'Smith Barbell Row',
    'Smith Machine Deadlift (Barbell)',
    'Squat (Smith Machine)',
    'Assisted Shoulder Press Machine',
    'Assisted Seated Row Machine',
    'Assisted Lat Pull Machine',
    'Assisted Pull Up Machine',
    'Assisted Dip Machine',
    'Machine Assisted Chin Up',
  ];

  for (const unit of ['kg', 'lb'] as const) {
    it(`in ${unit}: a Smith name never gets the Olympic bar and an assisted name is never stored as a load, however trusting Ben is (review r6 B2, B3)`, async () => {
      const { stored, exerciseOf } = await importAll(unit, TRICKY);
      const olympic = unit === 'kg' ? 20 : 45;
      TRICKY.forEach((name, i) => {
        const load = stored.get(name) ?? null;
        const c = exerciseOf.get(name);
        const why = `${name} → ${c?.name ?? '?'}: ${String(rawOf(i))} ${unit} stored as ${JSON.stringify(load)}`;
        if (c && smithWord(name)) expect(smithWord(c.name), why).toBe(true);
        if (c && assistWord(name)) expect(['assistance', 'bodyweight'].includes(c.defaultLoadConvention), why).toBe(true);
        if (!load) return;
        expect(load.unit, why).toBe(unit);
        if (smithWord(name)) expect(load.value, why).not.toBe(rawOf(i) + olympic);
        if (assistWord(name)) expect(['assistance', 'added'].includes(load.convention), why).toBe(true);
        // Nothing here has a source for changing the value, except reading a negative or machine number as assistance.
        expect(load.value, why).toBe(rawOf(i));
      });
      // Not vacuous: the Smith squat and the assisted machines came in.
      expect(stored.get('Squat (Smith Machine)')).toMatchObject({ convention: 'added' });
      expect(stored.get('Smith Machine Barbell Squat')).toMatchObject({ convention: 'added' });
      expect(stored.get('Assisted Pull Up Machine')).toMatchObject({ convention: 'assistance' });
    });
  }

  it('no suggestion contradicts an equipment word in the name; none is an assisted machine or a weight stack for a Smith name (review r4 S3, r5 S3)', async () => {
    const d = await open(fileOf('kg'));
    for (const n of d.analysis.names) {
      const c = n.match.exerciseId === null ? null : s.imports.candidate(d.draftId, n.match.exerciseId);
      if (!c) continue;
      const why = `${n.name} → ${c.name} (${c.compatibleEquipment.join(', ')})`;
      expect(equipmentContradicts(n.name, c), why).toBe(false);
      if (n.match.via === 'words') expect(c.defaultLoadConvention === 'assistance' && !assistWord(n.name), why).toBe(false);
    }
    const shown = (name: string) => {
      const n = d.analysis.names.find((x) => x.name === name);
      const c = n?.match.exerciseId ? s.imports.candidate(d.draftId, n.match.exerciseId) : null;
      return [n?.match.status, c?.name ?? null];
    };
    expect(shown('Smith Machine Overhead Press')).toEqual(['no_match', null]);
    expect(shown('Smith Machine Close Grip Bench Press')).toEqual(['check', 'Smith machine bench press']);
    // FitNotes defaults that are catalogue aliases now match exactly; ambiguous ones stay a Check.
    expect(shown('Parallel Bar Triceps Dip')).toEqual(['matched', 'Dip']);
    expect(shown('Flat Barbell Bench Press')).toEqual(['matched', 'Bench press']);
    expect(shown('Leg Extension Machine')).toEqual(['matched', 'Leg extension']);
    expect(shown('Seated Calf Raise Machine')).toEqual(['matched', 'Seated calf raise']);
    expect(shown('Lateral Dumbbell Raise')).toEqual(['matched', 'Lateral raise']);
    expect(shown('Rope Push Down')).toEqual(['matched', 'Rope triceps pushdown']);
    expect(shown('Seated Machine Fly')).toEqual(['matched', 'Pec deck']);
    expect(shown('Rear Delt Machine Fly')).toEqual(['matched', 'Reverse pec deck']);
    expect(shown('Straight-Arm Cable Pushdown')).toEqual(['matched', 'Straight-arm pulldown']);
    expect(shown('Barbell Shrug')).toEqual(['matched', 'Barbell shrug']);
    expect(shown('Barbell Calf Raise')).toEqual(['matched', 'Standing barbell calf raise']);
    expect(shown('Lat Pulldown (Pulley)')).toEqual(['check', 'Lat pulldown']);
    expect(shown('Seated Cable Row (Pulley)')).toEqual(['check', 'Seated cable row']);
  });
});
