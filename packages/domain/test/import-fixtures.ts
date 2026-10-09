import { readFileSync } from 'node:fs';
import { starterExercises, type MatchCandidate } from '../src';

/** Shared test data for the import tests. FitNotes fixtures are synthetic (see fixtures/fitnotes/README.md). */
export const fixture = (name: string): string => readFileSync(new URL(`./fixtures/fitnotes/${name}`, import.meta.url), 'utf8');

const ALIASES: Record<string, string[]> = {
  'Bench press': ['Barbell bench press', 'Flat bench press', 'Flat bench', 'BB bench press'],
  'Back squat': ['Barbell back squat', 'Squat'],
  'Lateral raise': ['Dumbbell lateral raise', 'Side raise'],
  'Triceps pushdown': ['Cable pushdown', 'Rope pushdown'],
};
export const CANDIDATES: MatchCandidate[] = [
  ...starterExercises('2026-10-01T00:00:00.000Z').map((e) => ({
    exerciseId: e.id,
    name: e.name,
    aliases: ALIASES[e.name] ?? [],
    catalogueKey: e.catalogueKey ?? null,
    laterality: e.laterality,
    defaultLoadConvention: e.defaultLoadConvention,
    compatibleEquipment: e.compatibleEquipment,
  })),
  {
    exerciseId: '00000000-0000-4000-8000-00000000e2b0',
    name: 'EZ-bar skull crusher',
    aliases: ['Lying triceps extension'],
    catalogueKey: 'ez-bar-skull-crusher',
    laterality: 'bilateral',
    defaultLoadConvention: 'total',
    compatibleEquipment: ['ez_bar'],
  },
];
export const idOf = (name: string): string => {
  const c = CANDIDATES.find((x) => x.name === name);
  if (!c) throw new Error(name);
  return c.exerciseId;
};
