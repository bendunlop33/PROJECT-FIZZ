import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { ExerciseSchema, validate } from '@fizz/schemas';
import { describe, expect, it } from 'vitest';
import {
  bundledCatalogue,
  catalogueExerciseId,
  CatalogueEntrySchema,
  loadCatalogue,
  MUSCLE_GROUPS,
  MUSCLE_TO_GROUP,
  sha1,
  toExerciseRow,
  uuidV5,
  validateCatalogueFiles,
  type CatalogueEntry,
} from '../src/index';

const DATA = join(import.meta.dirname, '..', 'data', 'exercises');
const read = (key: string): Record<string, unknown> =>
  JSON.parse(readFileSync(join(DATA, `${key}.json`), 'utf8')) as Record<string, unknown>;
const T = '2026-10-09T00:00:00.000Z';

function entry(key: string): CatalogueEntry {
  const e = bundledCatalogue().catalogue.byKey(key);
  if (e === undefined) throw new Error(`No entry ${key}`);
  return e;
}

function basic(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: 1,
    key: 'dumbbell-goblet-squat',
    tier: 'basic',
    name: 'Goblet squat',
    aliases: ['DB goblet squat'],
    family: 'squat',
    movementPattern: 'squat',
    mechanic: 'compound',
    primaryMuscles: ['quads', 'glutes'],
    secondaryMuscles: ['core'],
    compatibleEquipment: ['dumbbells'],
    defaultLoadConvention: 'per_hand',
    measurement: 'reps',
    laterality: 'bilateral',
    provenance: { source: 'fizz', crossCheckedWith: [], copiedFields: [], retrievedOn: '2026-10-09' },
    ...overrides,
  };
}

describe('UUIDv5 catalogue IDs', () => {
  it('matches the RFC example and Python uuid5', () => {
    expect(uuidV5('www.example.com', '6ba7b810-9dad-11d1-80b4-00c04fd430c8')).toBe('2ed6657d-e927-568b-95e1-2665a8aea6a2');
    expect(uuidV5('squat-ü-🏋', '6ba7b810-9dad-11d1-80b4-00c04fd430c8')).toBe('11e2743e-37d6-5912-bad6-f70c5d2be88d');
    expect(catalogueExerciseId('barbell-back-squat')).toBe('ad2ba827-1521-5bcf-a5be-9d73b7632439');
  });

  it('pure SHA-1 matches node:crypto across block boundaries', () => {
    for (const len of [0, 1, 55, 56, 63, 64, 65, 119, 200]) {
      const bytes = Array.from({ length: len }, (_, i) => (i * 37 + 11) % 256);
      const ours = Buffer.from(sha1(bytes)).toString('hex');
      expect(ours).toBe(createHash('sha1').update(Buffer.from(bytes)).digest('hex'));
    }
  });

  it('is stable per key and distinct across keys', () => {
    expect(catalogueExerciseId('sled-push')).toBe(catalogueExerciseId('sled-push'));
    expect(catalogueExerciseId('sled-push')).not.toBe(catalogueExerciseId('sled-pull'));
  });
});

describe('vocabularies', () => {
  it('every muscle maps to one of the 11 filter groups, and every group is used', () => {
    const used = new Set(Object.values(MUSCLE_TO_GROUP));
    expect(MUSCLE_GROUPS).toHaveLength(11);
    for (const g of MUSCLE_GROUPS) expect(used.has(g)).toBe(true);
  });
});

describe('catalogue entry schema', () => {
  it('accepts every committed entry', () => {
    for (const f of readdirSync(DATA)) {
      const r = validate(CatalogueEntrySchema, JSON.parse(readFileSync(join(DATA, f), 'utf8')));
      expect(r, f).toMatchObject({ ok: true });
    }
  });

  it('accepts a basic entry and rejects rich-only fields on it', () => {
    expect(validate(CatalogueEntrySchema, basic()).ok).toBe(true);
    expect(validate(CatalogueEntrySchema, basic({ cues: { setup: ['a', 'b'], execution: ['a', 'b'], faults: ['a', 'b'] } })).ok).toBe(false);
  });

  it('rejects unknown fields, unknown vocabulary and bad keys', () => {
    expect(validate(CatalogueEntrySchema, basic({ colour: 'red' })).ok).toBe(false);
    expect(validate(CatalogueEntrySchema, basic({ primaryMuscles: ['pecs'] })).ok).toBe(false);
    expect(validate(CatalogueEntrySchema, basic({ movementPattern: 'push' })).ok).toBe(false);
    expect(validate(CatalogueEntrySchema, basic({ key: 'Goblet_Squat' })).ok).toBe(false);
    expect(validate(CatalogueEntrySchema, basic({ compatibleEquipment: [] })).ok).toBe(false);
  });

  it('rejects a muscle listed as both primary and secondary', () => {
    expect(validate(CatalogueEntrySchema, basic({ secondaryMuscles: ['quads'] })).ok).toBe(false);
  });

  it('requires a licensed source when fields were copied', () => {
    const prov = { source: 'fizz', crossCheckedWith: [], copiedFields: ['aliases[0]'], retrievedOn: '2026-10-09' };
    expect(validate(CatalogueEntrySchema, basic({ provenance: prov })).ok).toBe(false);
    const withSource = { ...prov, crossCheckedWith: [{ source: 'wger', sourceId: '615', licence: 'CC-BY-SA-4.0', author: 'wger.de' }] };
    expect(validate(CatalogueEntrySchema, basic({ provenance: withSource })).ok).toBe(true);
    const badLicence = { ...prov, crossCheckedWith: [{ source: 'wger', sourceId: '615', licence: 'proprietary', author: 'x' }] };
    expect(validate(CatalogueEntrySchema, basic({ provenance: badLicence })).ok).toBe(false);
  });

  it('enforces cue length and count', () => {
    const squat = read('barbell-back-squat');
    const cues = squat.cues as { setup: string[] };
    const tooLong = { ...squat, cues: { ...cues, setup: ['x'.repeat(61), 'Grip just outside your shoulders'] } };
    expect(validate(CatalogueEntrySchema, tooLong).ok).toBe(false);
    const tooMany = { ...squat, cues: { ...cues, setup: ['a', 'b', 'c', 'd', 'e'] } };
    expect(validate(CatalogueEntrySchema, tooMany).ok).toBe(false);
  });

  it('accepts both tempo shapes and rejects a mix', () => {
    const sled = read('sled-push');
    const brief = sled.guideBrief as Record<string, unknown>;
    expect(validate(CatalogueEntrySchema, sled).ok).toBe(true);
    const mixed = { ...sled, guideBrief: { ...brief, tempo: { stepMs: 1000, stepsPerCycle: 2, downMs: 100 } } };
    expect(validate(CatalogueEntrySchema, mixed).ok).toBe(false);
  });

  it('approval date is set exactly when approved', () => {
    const squat = read('barbell-back-squat');
    expect(validate(CatalogueEntrySchema, { ...squat, review: { status: 'approved', benApprovedOn: null } }).ok).toBe(false);
    expect(validate(CatalogueEntrySchema, { ...squat, review: { status: 'draft', benApprovedOn: '2026-10-09' } }).ok).toBe(false);
    expect(validate(CatalogueEntrySchema, { ...squat, review: { status: 'approved', benApprovedOn: '2026-10-09' } }).ok).toBe(true);
  });

  it('implements (one or two dumbbells) is 1 or 2, and only on per-hand exercises (FitNotes import review r3 S1)', () => {
    expect(validate(CatalogueEntrySchema, basic({ implements: 1 })).ok).toBe(true);
    expect(validate(CatalogueEntrySchema, basic({ implements: 2 })).ok).toBe(true);
    expect(validate(CatalogueEntrySchema, basic({ implements: 3 })).ok).toBe(false);
    expect(validate(CatalogueEntrySchema, basic({ implements: 1, defaultLoadConvention: 'total', compatibleEquipment: ['kettlebell'] })).ok).toBe(false);
  });

  it('records one-dumbbell exercises apart from pairs, and leaves either-way exercises unset', () => {
    const count = (key: string) => entry(key).implements ?? null;
    // One dumbbell or kettlebell: a value written for these is that one implement's weight.
    for (const key of ['dumbbell-one-arm-row', 'dumbbell-goblet-squat', 'dumbbell-pullover', 'dumbbell-three-point-row', 'kettlebell-press', 'dumbbell-concentration-curl', 'dumbbell-one-arm-shoulder-press']) expect(count(key), key).toBe(1);
    // One in each hand, including unilateral leg work (laterality can't tell these from a one-arm row).
    for (const key of ['dumbbell-bench-press', 'dumbbell-curl', 'dumbbell-lateral-raise', 'dumbbell-bulgarian-split-squat', 'dumbbell-walking-lunge']) expect(count(key), key).toBe(2);
    // Commonly done either way: an importer asks (a kickback with one arm or both; a step-up or lunge with a pair or one in a goblet hold; review r4 N3).
    for (const key of ['dumbbell-single-leg-romanian-deadlift', 'dumbbell-triceps-kickback', 'dumbbell-step-up', 'dumbbell-reverse-lunge']) expect(count(key), key).toBeNull();
    for (const e of bundledCatalogue().catalogue.entries) if (e.implements !== undefined) expect(e.defaultLoadConvention, e.key).toBe('per_hand');
  });
});

describe('validateCatalogueFiles', () => {
  it('reports dangling variation keys as warnings, not errors', () => {
    const r = validateCatalogueFiles([{ fileName: 'barbell-back-squat.json', data: read('barbell-back-squat') }]);
    expect(r.errors).toEqual([]);
    expect(r.warnings.some((w) => w.message.includes('bodyweight-squat'))).toBe(true);
  });

  it('a variation that exists is not dangling', () => {
    const r = validateCatalogueFiles([
      { fileName: 'barbell-back-squat.json', data: read('barbell-back-squat') },
      { fileName: 'machine-leg-press.json', data: read('machine-leg-press') },
    ]);
    expect(r.warnings.some((w) => w.file === 'barbell-back-squat.json' && w.message.includes('machine-leg-press'))).toBe(false);
  });

  it('errors on a key that does not match its file, and on duplicates', () => {
    const r = validateCatalogueFiles([
      { fileName: 'goblet.json', data: basic() },
      { fileName: 'dumbbell-goblet-squat.json', data: basic() },
      { fileName: 'dumbbell-goblet-squat.json', data: basic() },
    ]);
    expect(r.errors.map((e) => e.message)).toEqual([
      "Key dumbbell-goblet-squat doesn't match the file name",
      'Duplicate key, also in dumbbell-goblet-squat.json',
    ]);
  });

  it('warns on an unusual load convention and a shared alias', () => {
    const r = validateCatalogueFiles([
      { fileName: 'dumbbell-goblet-squat.json', data: basic({ defaultLoadConvention: 'stack' }) },
      { fileName: 'kettlebell-goblet-squat.json', data: basic({ key: 'kettlebell-goblet-squat', compatibleEquipment: ['kettlebell'] }) },
    ]);
    expect(r.errors).toEqual([]);
    expect(r.warnings.map((w) => w.path).sort()).toEqual(['aliases', 'aliases', 'defaultLoadConvention']);
  });
});

describe('loader', () => {
  it('loads the bundled catalogue with no issues', () => {
    const { catalogue, issues } = bundledCatalogue();
    expect(issues).toEqual([]);
    expect(catalogue.entries).toHaveLength(readdirSync(DATA).length);
    expect(catalogue.byKey('barbell-back-squat')?.name).toBe('Back squat');
    expect(catalogue.byId(catalogueExerciseId('sled-push'))?.key).toBe('sled-push');
  });

  it('skips an invalid entry and a duplicate key, keeping the rest', () => {
    const { catalogue, issues } = loadCatalogue([basic(), { key: 'broken' }, basic()]);
    expect(catalogue.entries).toHaveLength(1);
    expect(issues.map((i) => [i.index, i.key])).toEqual([
      [1, 'broken'],
      [2, 'dumbbell-goblet-squat'],
    ]);
  });

  it('maps entries to valid Exercise rows with explicit conventions', () => {
    const { catalogue } = bundledCatalogue();
    for (const entry of catalogue.entries) {
      const row = toExerciseRow(entry, T);
      if (!row.ok) continue;
      expect(validate(ExerciseSchema, row.exercise), entry.key).toMatchObject({ ok: true });
      expect(row.exercise.id).toBe(catalogueExerciseId(entry.key));
      expect(row.exercise.catalogueKey).toBe(entry.key);
      expect(row.exercise.defaultLoadConvention).toBe(entry.defaultLoadConvention);
    }
    const db = toExerciseRow(entry('dumbbell-one-arm-row'), T);
    expect(db.ok && db.exercise.defaultLoadConvention).toBe('per_hand');
    expect(db.ok && db.exercise.laterality).toBe('unilateral');
  });

  it('EZ-bar and trap-bar exercises use their own kinds, never the Olympic barbell (slice-3 re-review nit, rule 4)', () => {
    for (const [key, kind] of [['ez-bar-curl', 'ez_bar'], ['ez-bar-skull-crusher', 'ez_bar'], ['trap-bar-deadlift', 'trap_bar']] as const) {
      const row = toExerciseRow(entry(key), T);
      if (!row.ok) throw new Error(key);
      expect(row.exercise.compatibleEquipment, key).toEqual([kind]);
    }
    // No other entry names an EZ or trap bar while listing the barbell.
    for (const e of bundledCatalogue().catalogue.entries) {
      if (/\b(ez|trap|hex)[- ]bar\b/i.test(e.name)) expect(e.compatibleEquipment, e.key).not.toContain('barbell');
    }
  });

  it('does not create a loggable row for a distance exercise', () => {
    const sled = entry('sled-push');
    expect(toExerciseRow(sled, T)).toMatchObject({ ok: false, reason: 'distance_not_loggable' });
  });
});
