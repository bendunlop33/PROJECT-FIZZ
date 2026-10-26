import { describe, expect, it } from 'vitest';

import type { Exercise } from '@fizz/schemas';

import { buildExercisePickerView, inPickerScope, notHereLine, pickerConfirm, PICKER_RECENT, suggestionKept, type PickerEntry, type PickerIndex } from '../src/index';
import { assisted, barbell, dumbbells, exercise, GYM, id } from './fixtures';

/**
 * (Ben, 25 Oct: "When I swap exercises I don't have the option to select from all exercises.") The Swap / Add
 * sheet's full list under the suggestions: every exercise (catalogue + Ben's own), by broad group like Library,
 * the Library search (aliases, typos), the gym's misses last and tagged, `＋ Add your own`, and the confirm a
 * flagged or not-here pick asks.
 */

const BENCH = exercise(1, 'Bench press', { movementPattern: 'horizontal_push', primaryMuscles: ['chest'], mechanic: 'compound' });
const FLY = exercise(2, 'Cable fly', { movementPattern: 'horizontal_push', primaryMuscles: ['chest'], compatibleEquipment: ['weight_stack'], defaultLoadConvention: 'stack' });
const DB_FLY = exercise(3, 'Dumbbell fly', { movementPattern: 'horizontal_push', primaryMuscles: ['chest'], compatibleEquipment: ['dumbbells'], defaultLoadConvention: 'per_hand' });
const RDL = exercise(4, 'Romanian deadlift', { movementPattern: 'hinge', primaryMuscles: ['hamstrings', 'glutes'] });
const SQUAT = exercise(5, 'Back squat', { movementPattern: 'squat', primaryMuscles: ['quads'] });
const CALF = exercise(6, 'Standing calf raise', { movementPattern: 'calves', primaryMuscles: ['calves'], compatibleEquipment: ['weight_stack'], defaultLoadConvention: 'stack' });
const CURL = exercise(7, 'Dumbbell curl', { movementPattern: 'arms', primaryMuscles: ['biceps'], compatibleEquipment: ['dumbbells'], defaultLoadConvention: 'per_hand' });
const PUSHDOWN = exercise(8, 'Triceps pushdown', { movementPattern: 'arms', primaryMuscles: ['triceps'], compatibleEquipment: ['weight_stack'], defaultLoadConvention: 'stack' });
const PULLUP = exercise(9, 'Assisted pull-up', { movementPattern: 'vertical_pull', primaryMuscles: ['lats'], compatibleEquipment: ['assisted_stack'], defaultLoadConvention: 'assistance' });
const ROWER = exercise(10, 'Rowing machine', { movementPattern: 'conditioning', primaryMuscles: [], compatibleEquipment: ['erg'], defaultLoadConvention: 'bodyweight', measurement: 'cardio' });
const RUN = exercise(11, 'Sled push', { movementPattern: 'conditioning', primaryMuscles: ['quads'], compatibleEquipment: ['sled'], measurement: 'distance' });
const PLANK = exercise(12, 'Plank', { movementPattern: 'core', primaryMuscles: ['abs'], compatibleEquipment: ['bodyweight_station'], defaultLoadConvention: 'bodyweight', measurement: 'duration' });
const MINE = exercise(13, 'Landmine press (mine)', { source: 'custom', ownerId: id(900), movementPattern: 'vertical_push', primaryMuscles: ['front_delts'] });

const ALIASES: Record<string, string[]> = { [RDL.id]: ['RDL'], [BENCH.id]: ['Flat bench'] };
/** Main Gym has a barbell, dumbbells and an assisted machine; no cable station. */
const EQUIPMENT = [barbell({ id: id(700), gymId: GYM }), dumbbells({ id: id(701), gymId: GYM }), assisted({ id: id(703), gymId: GYM })];
const notHere = new Set([FLY.id, CALF.id, PUSHDOWN.id]);

const entry = (e: Exercise, over: Partial<PickerEntry> = {}): PickerEntry => ({ exercise: e, aliases: ALIASES[e.id] ?? [], here: !notHere.has(e.id), painFlag: null, ...over });
const ALL = [BENCH, FLY, DB_FLY, RDL, SQUAT, CALF, CURL, PUSHDOWN, PULLUP, ROWER, PLANK, MINE];
const INDEX: PickerIndex = { entries: ALL.map((e) => entry(e)), gym: { name: 'Main Gym', equipment: EQUIPMENT } };

const names = (v: ReturnType<typeof buildExercisePickerView>) => v.sections.map((s) => [s.title, s.parts.map((p) => [p.title, p.rows.map((r) => r.name)])]);

describe('the full list (no search)', () => {
  it('All: every exercise by broad group, Legs and Arms by part, minus the workout and the suggestions; the gym’s misses last in their part', () => {
    const v = buildExercisePickerView({ index: INDEX, query: '', group: null, exclude: [BENCH.id], suggested: [DB_FLY.id] });
    expect(v.showSuggestions).toBe(true);
    expect(names(v)).toEqual([
      ['CHEST', [[null, ['Cable fly']]]],
      ['BACK', [[null, ['Assisted pull-up']]]],
      ['SHOULDERS', [[null, ['Landmine press (mine)']]]],
      ['LEGS', [['Quads', ['Back squat']], ['Hamstrings', ['Romanian deadlift']], ['Calves', ['Standing calf raise']]]],
      ['ARMS', [['Biceps', ['Dumbbell curl']], ['Triceps', ['Triceps pushdown']]]],
      ['CORE', [[null, ['Plank']]]],
      ['OTHER', [[null, ['Rowing machine']]]],
    ]);
    const fly = v.sections[0]?.parts[0]?.rows[0];
    expect(fly).toMatchObject({ notHere: true, notHereLine: 'Main Gym has no cable station.' });
    expect(fly?.tags).toEqual([{ kind: 'not_here', text: 'Not at Main Gym' }]);
    expect(v.addOwn).toEqual({ label: '＋ Add your own', name: null });
    expect(v.empty).toBeNull();
  });

  it('a chip shows one group (no OTHER); here first, then not-here, A–Z within each', () => {
    const v = buildExercisePickerView({ index: INDEX, query: '', group: 'Chest', exclude: [], suggested: [] });
    expect(names(v)).toEqual([['CHEST', [[null, ['Bench press', 'Dumbbell fly', 'Cable fly']]]]]);
    expect(v.chips.filter((c) => c.selected).map((c) => c.label)).toEqual(['Chest']);
    expect(v.chips.map((c) => c.label)).toEqual(['All', 'Chest', 'Back', 'Shoulders', 'Legs', 'Arms', 'Core']);
  });

  it('a chip shows only its own group, each exercise where Library lists it (its first main muscle)', () => {
    const press = exercise(30, 'Close-grip push-up', { movementPattern: 'horizontal_push', primaryMuscles: ['chest', 'front_delts'], compatibleEquipment: ['bodyweight_station'], defaultLoadConvention: 'bodyweight' });
    const index: PickerIndex = { ...INDEX, entries: [...INDEX.entries, entry(press)] };
    const v = buildExercisePickerView({ index, query: '', group: 'Shoulders', exclude: [], suggested: [] });
    expect(names(v)).toEqual([['SHOULDERS', [[null, ['Landmine press (mine)']]]]]);
    // A search under the chip still finds what works the group.
    expect(names(buildExercisePickerView({ index, query: 'push', group: 'Shoulders', exclude: [], suggested: [] }))).toEqual([['MATCHES', [[null, ['Close-grip push-up']]]]]);
  });

  it('Ben’s own exercise is listed, tagged `Yours`; a pain-flagged one `May hurt` (never hidden, rule 9)', () => {
    const index: PickerIndex = { ...INDEX, entries: INDEX.entries.map((x) => (x.exercise.id === SQUAT.id ? { ...x, painFlag: { line: 'Knee pain flagged 6 Oct.', accessibilityLabel: 'May hurt: you flagged knee pain on it' } } : x)) };
    const v = buildExercisePickerView({ index, query: '', group: null, exclude: [], suggested: [] });
    const rows = v.sections.flatMap((s) => s.parts.flatMap((p) => p.rows));
    expect(rows.find((r) => r.exerciseId === MINE.id)?.tags).toEqual([{ kind: 'custom', text: 'Yours' }]);
    const squat = rows.find((r) => r.exerciseId === SQUAT.id);
    expect(squat).toMatchObject({ mayHurt: true, painLine: 'Knee pain flagged 6 Oct.' });
    expect(squat?.accessibilityLabel).toContain('you flagged knee pain');
  });

  it('with no gym nothing is tagged or moved', () => {
    const v = buildExercisePickerView({ index: { ...INDEX, gym: null }, query: '', group: 'Chest', exclude: [], suggested: [] });
    expect(names(v)).toEqual([['CHEST', [[null, ['Bench press', 'Cable fly', 'Dumbbell fly']]]]]);
    expect(v.sections.flatMap((s) => s.parts.flatMap((p) => p.rows)).every((r) => !r.notHere && r.tags.length === 0)).toBe(true);
  });
});

describe('search (the Library’s: aliases, one typo per word)', () => {
  it('finds a suggested exercise too, hides the suggestions; an alias hit names the alias', () => {
    const v = buildExercisePickerView({ index: INDEX, query: 'rdl', group: null, exclude: [], suggested: [RDL.id] });
    expect(v.showSuggestions).toBe(false);
    expect(names(v)).toEqual([['MATCHES', [[null, ['Romanian deadlift']]]]]);
    expect(v.sections[0]?.parts[0]?.rows[0]?.line).toContain('Matches “RDL”');
    expect(v.addOwn.name).toBe('rdl');
  });

  it('a typo still finds it; not-here matches come after the ones here', () => {
    expect(names(buildExercisePickerView({ index: INDEX, query: 'romanain', group: null, exclude: [], suggested: [] }))).toEqual([['MATCHES', [[null, ['Romanian deadlift']]]]]);
    expect(names(buildExercisePickerView({ index: INDEX, query: 'fly', group: null, exclude: [], suggested: [] }))).toEqual([['MATCHES', [[null, ['Dumbbell fly', 'Cable fly']]]]]);
  });

  it('within the chip, as in Library; never what is in the workout; no match says so', () => {
    expect(names(buildExercisePickerView({ index: INDEX, query: 'press', group: 'Shoulders', exclude: [], suggested: [] }))).toEqual([['MATCHES', [[null, ['Landmine press (mine)']]]]]);
    expect(buildExercisePickerView({ index: INDEX, query: 'bench', group: null, exclude: [BENCH.id], suggested: [] }).sections).toEqual([]);
    const none = buildExercisePickerView({ index: INDEX, query: 'landmine twst', group: null, exclude: [], suggested: [] });
    expect(none.empty).toBe('No match for “landmine twst”.');
    expect(none.addOwn).toEqual({ label: '＋ Add your own', name: 'landmine twst' });
  });
});

describe('scope: only what the host’s write takes', () => {
  it('Your workout: strength with a builder group; the editor: not distance; mid-workout swap: same measurement; add: anything', () => {
    expect(inPickerScope({ kind: 'builder' }, BENCH)).toBe(true);
    expect(inPickerScope({ kind: 'builder' }, ROWER)).toBe(false);
    expect(inPickerScope({ kind: 'builder' }, exercise(20, 'Mystery move', { primaryMuscles: [] }))).toBe(false);
    expect(inPickerScope({ kind: 'template' }, RUN)).toBe(false);
    expect(inPickerScope({ kind: 'template' }, ROWER)).toBe(true);
    expect(inPickerScope({ kind: 'session_swap', measurement: 'reps' }, PLANK)).toBe(false);
    expect(inPickerScope({ kind: 'session_swap', measurement: 'duration' }, PLANK)).toBe(true);
    expect(inPickerScope({ kind: 'session_add' }, RUN)).toBe(true);
  });
});

describe('the confirm before a pick (rules 4 and 9)', () => {
  it('not here: names what the gym lacks and asks; here and unflagged: straight through', () => {
    expect(pickerConfirm({ name: 'Cable fly', mayHurt: false, painLine: null, notHereLine: notHereLine('Main Gym', FLY, EQUIPMENT) }, 'Swap')).toEqual({ title: 'Main Gym has no cable station. Swap Cable fly anyway?', message: null, cancel: 'Choose another', confirm: 'Swap anyway' });
    expect(pickerConfirm({ name: 'Bench press', mayHurt: false, painLine: null, notHereLine: null }, 'Add')).toBeNull();
  });

  it('flagged and not here: one ask with both lines', () => {
    expect(pickerConfirm({ name: 'Cable fly', mayHurt: true, painLine: 'Shoulder pain flagged 6 Oct.', notHereLine: 'Main Gym has no cable station.' }, 'Add')).toEqual({
      title: 'Cable fly may hurt',
      message: 'Shoulder pain flagged 6 Oct.\nMain Gym has no cable station.',
      cancel: 'Choose another',
      confirm: 'Add anyway',
    });
  });
});

describe('the full catalogue is reachable', () => {
  it('every entry in scope shows under All or a search finds it by name', () => {
    const v = buildExercisePickerView({ index: INDEX, query: '', group: null, exclude: [], suggested: [] });
    const listed = new Set(v.sections.flatMap((s) => s.parts.flatMap((p) => p.rows.map((r) => r.exerciseId))));
    expect(listed.size).toBe(ALL.length);
  });
});

describe('(Ben, 26 Oct) Recent and the equipment chips', () => {
  const withRecent: PickerIndex = { ...INDEX, recent: [CURL.id, BENCH.id, FLY.id, RDL.id] };
  const recentNames = (v: ReturnType<typeof buildExercisePickerView>) => v.recent.map((r) => r.name);

  it('Recent: newest first, nothing already in the workout, not while searching', () => {
    const v = buildExercisePickerView({ index: withRecent, query: '', group: null, exclude: [BENCH.id], suggested: [DB_FLY.id, CURL.id] });
    // A suggested one is still listed in Recent (a shortcut; the suggestions keep their own order).
    expect(recentNames(v)).toEqual(['Dumbbell curl', 'Cable fly', 'Romanian deadlift']);
    // The gym's miss keeps its tag there too.
    expect(v.recent.find((r) => r.name === 'Cable fly')?.notHere).toBe(true);
    expect(buildExercisePickerView({ index: withRecent, query: 'curl', group: null, exclude: [], suggested: [] }).recent).toEqual([]);
    expect(buildExercisePickerView({ index: INDEX, query: '', group: null, exclude: [], suggested: [] }).recent).toEqual([]);
  });

  it('Recent follows the chips and keeps at most 8', () => {
    expect(recentNames(buildExercisePickerView({ index: withRecent, query: '', group: 'Chest', exclude: [], suggested: [] }))).toEqual(['Bench press', 'Cable fly']);
    expect(recentNames(buildExercisePickerView({ index: withRecent, query: '', group: null, equipment: 'dumbbells', exclude: [], suggested: [] }))).toEqual(['Dumbbell curl']);
    const many: PickerIndex = { ...INDEX, recent: ALL.map((e) => e.id) };
    expect(buildExercisePickerView({ index: many, query: '', group: null, exclude: [], suggested: [] }).recent).toHaveLength(PICKER_RECENT.limit);
  });

  it('an equipment chip combines with the muscle chip; only kinds in this sheet are offered', () => {
    const v = buildExercisePickerView({ index: INDEX, query: '', group: 'Chest', equipment: 'dumbbells', exclude: [], suggested: [] });
    expect(v.sections.flatMap((s) => s.parts.flatMap((p) => p.rows.map((r) => r.name)))).toEqual(['Dumbbell fly']);
    expect(v.equipmentChips.find((c) => c.filter === 'dumbbells')?.selected).toBe(true);
    expect(v.equipmentChips.map((c) => c.label)).toEqual(['Barbell', 'Dumbbells', 'Cable / stack', 'Bodyweight', 'Assisted', 'Cardio']);
    // A search keeps the chip.
    const found = buildExercisePickerView({ index: INDEX, query: 'fly', group: null, equipment: 'cable_stack', exclude: [], suggested: [] });
    expect(found.sections.flatMap((s) => s.parts.flatMap((p) => p.rows.map((r) => r.name)))).toEqual(['Cable fly']);
  });

  it('the chip hides suggestions of another kind and never reorders them', () => {
    const ranked = [FLY.id, BENCH.id, DB_FLY.id];
    expect(ranked.filter((x) => suggestionKept(INDEX, x, 'dumbbells'))).toEqual([DB_FLY.id]);
    expect(ranked.filter((x) => suggestionKept(INDEX, x, null))).toEqual(ranked);
    expect(suggestionKept(INDEX, 'unknown', 'barbell')).toBe(true);
  });
});
