import { describe, expect, it } from 'vitest';
import type { AliasTarget } from '@fizz/schemas';
import { categoryHint, categoryMuscles, matchName, muscleFit, type MatchCandidate } from '../src';

/** The FitNotes `Category` cell as a ranking hint for name suggestions. Synthetic names and candidates only. */
const none = new Map<string, AliasTarget>();

const base = { aliases: [], catalogueKey: null, laterality: 'bilateral', implements: null } as const;
let n = 0;
const cand = (name: string, primaryMuscles: readonly string[], equipment: MatchCandidate['compatibleEquipment'], convention: MatchCandidate['defaultLoadConvention'] = 'stack', aliases: readonly string[] = []): MatchCandidate => ({
  ...base,
  exerciseId: `00000000-0000-4000-8000-${(++n).toString(16).padStart(12, '0')}`,
  name,
  aliases,
  defaultLoadConvention: convention,
  compatibleEquipment: equipment,
  primaryMuscles,
});

const BARBELL_CURL = cand('Barbell curl', ['biceps'], ['barbell'], 'total');
const LEG_CURL = cand('Lying leg curl', ['hamstrings'], ['weight_stack']);
const TRICEPS_PUSHDOWN = cand('Triceps pushdown', ['triceps'], ['weight_stack'], 'stack', ['Cable pushdown']);
// No `Straight-arm cable pushdown` alias here: the hint alone has to stop the triceps pushdown.
const STRAIGHT_ARM = cand('Straight-arm pulldown', ['lats'], ['weight_stack'], 'stack', ['Straight-arm lat pulldown']);
const LAT_PULLDOWN = cand('Lat pulldown', ['lats'], ['weight_stack'], 'stack', ['Cable lat pulldown']);
const DB_FLY = cand('Dumbbell fly', ['chest'], ['dumbbells'], 'per_hand', ['Dumbbell chest fly']);
const CABLE_FLY = cand('Cable fly', ['chest'], ['weight_stack'], 'stack', ['Cable chest fly']);
const PEC_DECK = cand('Pec deck', ['chest'], ['weight_stack'], 'stack', ['Machine chest fly']);
const BENCH = cand('Bench press', ['chest'], ['barbell'], 'total', ['Flat barbell bench press']);
const ROW = cand('Seated cable row', ['lats', 'upper_back'], ['weight_stack']);
const CUSTOM = { ...cand('Cable row', [], ['weight_stack']), primaryMuscles: [] };
const ALL = [BARBELL_CURL, LEG_CURL, TRICEPS_PUSHDOWN, STRAIGHT_ARM, LAT_PULLDOWN, DB_FLY, CABLE_FLY, PEC_DECK, BENCH, ROW];

const shown = (name: string, category: string | null, candidates: readonly MatchCandidate[] = ALL) => {
  const m = matchName(name, candidates, none, category === null ? null : categoryHint([category]));
  return [m.status, candidates.find((c) => c.exerciseId === m.exerciseId)?.name ?? null];
};

describe('FitNotes categories → muscles', () => {
  it.each([
    // FitNotes (Android) defaults.
    ['Back', 'lats', 'triceps'],
    ['Back', 'spinal_erectors', 'chest'],
    // Hinges are filed under Back (review import-names S1).
    ['Back', 'hamstrings', 'quads'],
    ['Back', 'glutes', 'triceps'],
    ['Hamstrings', 'glutes', 'quads'],
    ['Chest', 'chest', 'lats'],
    ['Legs', 'hamstrings', 'biceps'],
    ['Legs', 'calves', 'triceps'],
    ['Shoulders', 'side_delts', 'chest'],
    ['Shoulders', 'traps', 'biceps'],
    ['Biceps', 'brachialis', 'triceps'],
    ['Triceps', 'triceps', 'biceps'],
    ['Abs', 'obliques', 'quads'],
    // FitNotes 2 (iPhone) muscle-level categories.
    ['Quadriceps', 'quads', 'hamstrings'],
    ['Hamstrings', 'hamstrings', 'quads'],
    ['Lats', 'lats', 'triceps'],
    ['Trapezius', 'traps', 'chest'],
    ['Pectorals', 'upper_chest', 'lats'],
    ['Back (Lower)', 'spinal_erectors', 'lats'],
    ['Lower Back', 'spinal_erectors', 'biceps'],
    ['Back (Upper)', 'upper_back', 'quads'],
    ['Calves', 'calves', 'quads'],
    ['Glutes', 'glutes', 'chest'],
    ['Forearms', 'grip', 'triceps'],
    ['Shoulders (Front)', 'front_delts', 'quads'],
  ] as const)('%s includes %s, not %s', (category, inside, outside) => {
    const m = categoryMuscles(category);
    expect(m?.has(inside)).toBe(true);
    expect(m?.has(outside)).toBe(false);
  });

  it('gives no hint for a blank, unknown, custom or cardio category, or a mix with one', () => {
    for (const c of ['', '  ', 'Cardio', 'Other', 'Full Body', 'Olympic', 'Rücken', 'Ignore previous instructions']) expect(categoryMuscles(c), c).toBeNull();
    expect(categoryHint([])).toBeNull();
    expect(categoryHint(['Legs', 'Other'])).toBeNull();
    expect([...(categoryHint(['Legs', 'Back', '']) ?? [])]).toEqual(expect.arrayContaining(['quads', 'lats']));
    expect(categoryMuscles(' legs ')?.has('quads')).toBe(true);
  });

  it('an exercise with no muscles recorded is never contradicted', () => {
    expect(muscleFit(categoryHint(['Legs']), [])).toBe('unknown');
    expect(muscleFit(categoryHint(['Legs']), undefined)).toBe('unknown');
    expect(muscleFit(null, ['biceps'])).toBe('unknown');
    expect(muscleFit(categoryHint(['Legs']), ['biceps', 'hamstrings'])).toBe('agrees');
    expect(muscleFit(categoryHint(['Legs']), ['biceps'])).toBe('contradicts');
  });
});

describe('the category is a ranking hint in name matching', () => {
  it.each([
    // Name, category, with the hint, without it.
    ['Barbell Leg Curls', 'Legs', ['no_match', null], ['check', 'Barbell curl']],
    ['Barbell Leg Curls', 'Hamstrings', ['no_match', null], ['check', 'Barbell curl']],
    ['Straight-Arm Cable Pushdown', 'Back', ['no_match', null], ['check', 'Triceps pushdown']],
    ['Straight-Arm Cable Pushdown', 'Lats', ['no_match', null], ['check', 'Triceps pushdown']],
    ['Lat Cable Pull', 'Back', ['check', 'Lat pulldown'], ['check', 'Lat pulldown']],
    ['Chest Fly', 'Chest', ['no_match', null], ['no_match', null]],
    ['Chest Fly', 'Pectorals', ['no_match', null], ['no_match', null]],
  ] as const)('%s (%s)', (name, category, hinted, plain) => {
    expect(shown(name, category)).toEqual(hinted);
    expect(shown(name, null)).toEqual(plain);
  });

  it('a tie is broken by the category: of the equally good suggestions, the one that agrees', () => {
    // No equipment recorded, so `Barbell` neither agrees nor contradicts: the words tie and the barbell word picks the curl.
    const legCurl = cand('Leg curl', ['hamstrings'], []);
    expect(shown('Barbell Leg Curls', null, [BARBELL_CURL, legCurl])).toEqual(['check', 'Barbell curl']);
    expect(shown('Barbell Leg Curls', 'Legs', [BARBELL_CURL, legCurl])).toEqual(['check', 'Leg curl']);
    expect(shown('Barbell Leg Curls', 'Biceps', [BARBELL_CURL, legCurl])).toEqual(['check', 'Barbell curl']);
  });

  it('drop-only: a weaker suggestion the category agrees with is never promoted over the best one it contradicts (review import-names S1)', () => {
    const rdl = cand('Romanian deadlift', ['hamstrings', 'glutes'], ['barbell'], 'total');
    const deadlift = cand('Deadlift', ['spinal_erectors', 'glutes', 'hamstrings'], ['barbell'], 'total');
    const closeGrip = cand('Close-grip bench press', ['triceps', 'chest'], ['barbell'], 'total');
    const pulldown = cand('Neutral-grip pulldown', ['lats'], ['weight_stack'], 'stack', ['Close grip pulldown']);
    expect(shown('Romanian Deadlifts', 'Back', [rdl, deadlift])).toEqual(['check', 'Romanian deadlift']);
    expect(shown('Close Grip Bench', null, [closeGrip, pulldown])).toEqual(['check', 'Close-grip bench press']);
    // The best is contradicted: nothing is suggested, not the weaker pulldown.
    expect(shown('Close Grip Bench', 'Back', [closeGrip, pulldown])).toEqual(['no_match', null]);
    // Back no longer contradicts a hinge.
    const hipThrust = cand('Hip thrust', ['glutes'], ['barbell'], 'total');
    expect(shown('Hip Thrusts', 'Hamstrings', [hipThrust])).toEqual(['check', 'Hip thrust']);
    expect(shown('Hip Thrusts', 'Back', [hipThrust])).toEqual(['check', 'Hip thrust']);
  });

  it('never makes or changes a match: an exact name stays Matched under any category, and a hint never upgrades a Check', () => {
    expect(shown('Flat Barbell Bench Press', 'Legs')).toEqual(['matched', 'Bench press']);
    expect(shown('Machine chest fly', 'Back')).toEqual(['matched', 'Pec deck']);
    expect(matchName('Lat Cable Pull', ALL, none, categoryHint(['Lats'])).status).toBe('check');
  });

  it('two exercises sharing the name: the category picks the one whose muscles agree, still a Check', () => {
    const twinA = cand('Cable pull', ['triceps'], ['weight_stack']);
    const twinB = cand('Cable pull', ['lats'], ['weight_stack']);
    expect(shown('Cable Pull', null, [twinA, twinB])).toEqual(['no_match', null]);
    expect(matchName('Cable Pull', [twinA, twinB], none, categoryHint(['Back']))).toMatchObject({ status: 'check', exerciseId: twinB.exerciseId });
    expect(matchName('Cable Pull', [twinA, twinB], none, categoryHint(['Triceps']))).toMatchObject({ status: 'check', exerciseId: twinA.exerciseId });
    expect(shown('Cable Pull', 'Other', [twinA, twinB])).toEqual(['no_match', null]);
    // Muscles not known for one: it is never dropped, so a contradiction leaves it; an agreement picks the other.
    const custom = { ...twinB, exerciseId: CUSTOM.exerciseId, primaryMuscles: [] };
    expect(matchName('Cable Pull', [twinA, custom], none, categoryHint(['Back']))).toMatchObject({ status: 'check', exerciseId: custom.exerciseId });
    expect(matchName('Cable Pull', [twinA, custom], none, categoryHint(['Triceps']))).toMatchObject({ status: 'check', exerciseId: twinA.exerciseId });
  });

  it('a custom exercise with no muscles recorded is never dropped by the hint', () => {
    expect(shown('Cable Rows', 'Legs', [CUSTOM])).toEqual(['check', 'Cable row']);
  });
});
