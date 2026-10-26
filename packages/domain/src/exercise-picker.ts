import { isBuilderStrength, type EquipmentInstance, type Exercise } from '@fizz/schemas';

import { builderInfoOf, builderExtraOf } from './builder/info';
import { BROWSE_PARTS, browseLine2Of, browsePlaceOf, EXERCISE_EQUIPMENT_WORD, type RowExercise } from './exercise-browse';
import { BROAD_MUSCLE_GROUPS, EQUIPMENT_FILTER_LABEL, EQUIPMENT_FILTERS, equipmentFiltersOf, NO_FILTERS, passesFilters, searchExerciseRows, withBroadGroup, type BroadMuscleGroup, type EquipmentFilter, type SearchableEntry } from './exercise-search';
import { missingStations, stationWords } from './stations';

/**
 * (Ben, 25 Oct: "When I swap exercises I don't have the option to select from all exercises.") The Swap / Add
 * sheet's full list (workout-builder-v3 §2.5, exercise-library §9.3): under the ranked suggestions, every
 * exercise in the catalogue plus Ben's own, by broad muscle group like Library › Exercises (D5), with the same
 * search (aliases, one typo per word). Exercises the gym can't do come last in their group, tagged
 * `Not at Main Gym`; picking one asks first, as Library's `Add anyway` does, and its loads are still worked out
 * on that gym's kit (rule 4). Pure: the sheet holds the index for as long as it is open and every keystroke or
 * chip is this function over it, with no read.
 */

/** Which exercises a host can take (the same checks its write makes, so a listed row is never refused for its kind). */
export type PickerScope =
  /**
   * Your workout (a builder draft): strength exercises with a builder group. `add` (Ben, 27 Oct: "when I searched
   * exercise bike it didn't come up"): cardio machines and timed exercises too, which Add puts in as a timed slot
   * (`applyBuilderEdit` takes them); Swap stays strength for strength.
   */
  | { kind: 'builder'; add?: boolean }
  /** The one workout editor: anything but distance (a saved workout has no distance target, EL-B13). */
  | { kind: 'template' }
  /** Swap mid-workout: the same measurement as the exercise being swapped (`buildSwapExerciseCommand`). */
  | { kind: 'session_swap'; measurement: Exercise['measurement'] }
  /** Add mid-workout: anything (Library's `Add to <workout>` takes every kind). */
  | { kind: 'session_add' };

type ScopeExercise = Pick<Exercise, 'id' | 'name' | 'primaryMuscles' | 'secondaryMuscles' | 'movementPattern' | 'measurement' | 'mechanic' | 'compatibleEquipment'> & Partial<Pick<Exercise, 'family' | 'catalogueKey' | 'defaultLoadConvention'>>;

export function inPickerScope(scope: PickerScope, e: ScopeExercise): boolean {
  switch (scope.kind) {
    case 'builder':
      return (isBuilderStrength(e) && builderInfoOf(e) !== null) || (scope.add === true && builderExtraOf(e) !== null);
    case 'template':
      return e.measurement !== 'distance';
    case 'session_swap':
      return e.measurement === scope.measurement;
    case 'session_add':
      return true;
  }
}

/** One exercise as the sheet can list it: the host's gym check and pain flag already worked out by the service. */
export interface PickerEntry extends SearchableEntry {
  exercise: RowExercise;
  /** The host's gym can do it (`doableHere`); true with no gym (nothing is checked). */
  here: boolean;
  /** An active pain flag covers it (rule 9): the confirm's line (`Shoulder pain flagged 6 Oct.`) and VoiceOver words. */
  painFlag: { line: string | null; accessibilityLabel: string } | null;
}

/** What one open of the sheet reads once (Your data and Coaching knowledge side by side; nothing is stored from it). */
export interface PickerIndex {
  entries: PickerEntry[];
  /** The host's gym (Your workout's, the editor's, the workout in progress's); null: no gym, nothing is tagged. */
  gym: { name: string; equipment: readonly Pick<EquipmentInstance, 'kind' | 'availability'>[] } | null;
  /**
   * (Ben, 26 Oct) Exercises Ben has done recently (finished workouts in the last `PICKER_RECENT.days` days),
   * newest first, at most `PICKER_RECENT.limit`: the sheet's `Recent` group. Absent or empty: no group.
   */
  recent?: readonly string[];
}

/** (Ben, 26 Oct) The `Recent` group: workouts in the last 4 weeks, at most 8 exercises. */
export const PICKER_RECENT = { days: 28, limit: 8 } as const;

export type PickerTag = { kind: 'may_hurt'; text: 'May hurt' } | { kind: 'custom'; text: 'Yours' } | { kind: 'not_here'; text: string };

export interface PickerRowView {
  exerciseId: string;
  name: string;
  /** `Matches "RDL" · Barbell · Hamstrings` (the Library row's line). */
  line: string;
  tags: PickerTag[];
  mayHurt: boolean;
  painLine: string | null;
  /** The gym can't do it: shown dimmed and last; picking it asks first (`notHereLine`). */
  notHere: boolean;
  /** `Main Gym has no cable station.`; null when it is here. */
  notHereLine: string | null;
  accessibilityLabel: string;
}

export interface PickerPartView {
  /** `Quads`, `Triceps`; null: no sub-heading. */
  title: string | null;
  rows: PickerRowView[];
}

export interface PickerSectionView {
  key: 'matches' | 'other' | `group:${BroadMuscleGroup}`;
  /** `CHEST`, `LEGS`, `OTHER`, `MATCHES`. */
  title: string;
  parts: PickerPartView[];
}

export interface PickerView {
  searching: boolean;
  /** The ranked suggestions show above (not while searching). */
  showSuggestions: boolean;
  sections: PickerSectionView[];
  /** `No match for "landmine twst".`; null when there are rows (or nothing to say). */
  empty: string | null;
  /** `＋ Add your own` at the bottom; `name` pre-fills the form (the query, when searching). */
  addOwn: { label: string; name: string | null };
  /** The muscle chips: `All` + Chest, Back, Shoulders, Legs, Arms, Core; exactly one on. */
  chips: { label: string; group: BroadMuscleGroup | null; selected: boolean }[];
  /**
   * (Ben, 26 Oct) `Recent`: what he's done lately, newest first, above the suggestions (not while searching). The
   * chips filter it too; what's in the workout already is left out. It never reorders the suggestions.
   */
  recent: PickerRowView[];
  /**
   * (Ben, 26 Oct) The equipment chips beside the muscle chips (Library's kinds), only those with an exercise in
   * this sheet. At most one on; tapping it again turns it off. They combine with the muscle chip.
   */
  equipmentChips: { label: string; filter: EquipmentFilter; selected: boolean }[];
}

export interface PickerInput {
  index: PickerIndex;
  query: string;
  /** The chip that is on; null: `All`. */
  group: BroadMuscleGroup | null;
  /** In the workout already: never listed (the writes refuse them). */
  exclude: readonly string[];
  /** Shown above as suggestions: left out of the full list (but found by a search). */
  suggested: readonly string[];
  /** (Ben, 26 Oct) The equipment chip that is on; null or absent: none. */
  equipment?: EquipmentFilter | null;
}

export const PICKER_COPY = {
  all: 'All',
  search: 'Search exercises',
  addOwn: '＋ Add your own',
  matches: 'MATCHES',
  other: 'OTHER',
  recent: 'Recent',
  notAt: (gym: string) => `Not at ${gym}`,
  noMatch: (q: string) => `No match for “${q}”.`,
  cancel: 'Choose another',
  anyway: (actionWord: string) => `${actionWord} anyway`,
  notHereTitle: (line: string, actionWord: string, name: string) => `${line} ${actionWord} ${name} anyway?`,
} as const;

const KIND_NOUN: Partial<Record<Exercise['compatibleEquipment'][number], string>> = {
  barbell: 'barbell',
  dumbbells: 'dumbbells',
  weight_stack: 'cable station',
  assisted_stack: 'assisted machine',
  plate_loaded_machine: 'plate-loaded machine',
  bodyweight_station: 'bar or station',
  kettlebell: 'kettlebells',
  ez_bar: 'EZ bar',
  trap_bar: 'trap bar',
  smith_machine: 'Smith machine',
};

/** What the gym lacks for it, in a few words: a missing bench or rack by name (ADR 0030), else its first kind. */
export function missingEquipmentNoun(e: Pick<Exercise, 'id' | 'compatibleEquipment'>, equipment: readonly Pick<EquipmentInstance, 'kind' | 'availability'>[]): string {
  const station = stationWords(missingStations(e.id, equipment));
  if (station !== null) return station;
  const kind = e.compatibleEquipment[0];
  return kind === undefined ? 'equipment' : (KIND_NOUN[kind] ?? EXERCISE_EQUIPMENT_WORD[kind].toLowerCase());
}

/** `Main Gym has no cable station.` */
export function notHereLine(gymName: string, e: Pick<Exercise, 'id' | 'compatibleEquipment'>, equipment: readonly Pick<EquipmentInstance, 'kind' | 'availability'>[]): string {
  return `${gymName} has no ${missingEquipmentNoun(e, equipment)}.`;
}

/** The Swap / Add sheet below the suggestions: chips, search results or every exercise by group, `＋ Add your own`. */
export function buildExercisePickerView(input: PickerInput): PickerView {
  const { index } = input;
  const searching = input.query.trim() !== '';
  const exclude = new Set(input.exclude);
  const suggested = new Set(input.suggested);
  const listed = index.entries.filter((x) => !exclude.has(x.exercise.id) && (searching || !suggested.has(x.exercise.id)));
  // No gym check here: every row is listed and the not-here ones are only moved last and tagged.
  const equipment = input.equipment ?? null;
  const filters = { ...withBroadGroup(NO_FILTERS, input.group), equipment: equipment === null ? [] : [equipment] };
  const { rows } = searchExerciseRows(listed, input.query, filters, null);
  const gymName = index.gym?.name ?? null;
  const view = (entry: PickerEntry, match: Parameters<typeof browseLine2Of>[1]): PickerRowView => {
    const e = entry.exercise;
    const notHere = gymName !== null && !entry.here;
    const tags: PickerTag[] = [];
    if (entry.painFlag !== null) tags.push({ kind: 'may_hurt', text: 'May hurt' });
    if (e.source === 'custom') tags.push({ kind: 'custom', text: 'Yours' });
    if (notHere) tags.push({ kind: 'not_here', text: PICKER_COPY.notAt(gymName) });
    const line = browseLine2Of(e, match);
    const a11y = [e.name, ...tags.map((t) => (t.kind === 'may_hurt' && entry.painFlag !== null ? entry.painFlag.accessibilityLabel : t.text)), line].filter((x) => x !== '');
    return {
      exerciseId: e.id,
      name: e.name,
      line,
      tags,
      mayHurt: entry.painFlag !== null,
      painLine: entry.painFlag?.line ?? null,
      notHere,
      notHereLine: notHere && index.gym !== null ? notHereLine(index.gym.name, e, index.gym.equipment) : null,
      accessibilityLabel: a11y.join(', '),
    };
  };
  // Here first, the gym's misses last; the order within each is kept (best match, else A–Z).
  const hereFirst = <T extends { entry: PickerEntry }>(list: readonly T[]): T[] => [...list.filter((r) => gymName === null || r.entry.here), ...list.filter((r) => gymName !== null && !r.entry.here)];
  const sections: PickerSectionView[] = [];
  if (searching) {
    if (rows.length > 0) sections.push({ key: 'matches', title: PICKER_COPY.matches, parts: [{ title: null, rows: hereFirst(rows).map((r) => view(r.entry, r.match)) }] });
  } else {
    const placed = rows.map((r) => ({ entry: r.entry, match: r.match, at: browsePlaceOf(r.entry.exercise) }));
    // Each exercise once, where Library lists it (its first main muscle); a chip shows only its own group's section.
    for (const g of input.group === null ? BROAD_MUSCLE_GROUPS : [input.group]) {
      const inGroup = placed.filter((x) => x.at?.group === g);
      if (inGroup.length === 0) continue;
      const partNames = BROWSE_PARTS[g];
      const parts =
        partNames === undefined
          ? [{ title: null, rows: hereFirst(inGroup).map((x) => view(x.entry, x.match)) }]
          : partNames.flatMap((title) => {
              const list = hereFirst(inGroup.filter((x) => x.at?.part === title)).map((x) => view(x.entry, x.match));
              return list.length === 0 ? [] : [{ title, rows: list }];
            });
      sections.push({ key: `group:${g}`, title: g.toUpperCase(), parts });
    }
    // Cardio, carries and conditioning (mid-workout Add) have no muscle group: `OTHER`, under `All` only.
    const other = placed.filter((x) => x.at === null);
    if (other.length > 0 && input.group === null) sections.push({ key: 'other', title: PICKER_COPY.other, parts: [{ title: null, rows: hereFirst(other).map((x) => view(x.entry, x.match)) }] });
  }
  const q = input.query.trim();
  // `Recent`: the index's order (newest first), the same chips, nothing already in the workout.
  const byId = new Map(index.entries.map((e) => [e.exercise.id, e]));
  const recent = searching
    ? []
    : (index.recent ?? []).flatMap((id) => {
        const entry = byId.get(id);
        return entry === undefined || exclude.has(id) || !passesFilters(entry.exercise, filters) ? [] : [view(entry, null)];
      })
        .slice(0, PICKER_RECENT.limit);
  const kinds = new Set(index.entries.flatMap((e) => equipmentFiltersOf(e.exercise)));
  return {
    searching,
    recent,
    equipmentChips: EQUIPMENT_FILTERS.filter((f) => kinds.has(f)).map((f) => ({ label: EQUIPMENT_FILTER_LABEL[f], filter: f, selected: equipment === f })),
    showSuggestions: !searching,
    sections,
    empty: searching && sections.length === 0 ? PICKER_COPY.noMatch(q) : null,
    addOwn: { label: PICKER_COPY.addOwn, name: searching ? q : null },
    chips: [{ label: PICKER_COPY.all, group: null, selected: input.group === null }, ...BROAD_MUSCLE_GROUPS.map((g) => ({ label: g, group: g, selected: input.group === g }))],
  };
}

/**
 * Picking a row that needs a word first (rule 9, rule 4): `May hurt` (`Overhead press may hurt` · `Shoulder pain
 * flagged 6 Oct.`), not at this gym (`Main Gym has no cable station. Swap Cable fly anyway?`), or both in one ask.
 * `Choose another` keeps the sheet open and changes nothing. Null: the pick goes straight through.
 */
export function pickerConfirm(
  row: Pick<PickerRowView, 'name' | 'mayHurt' | 'painLine' | 'notHereLine'>,
  actionWord: string,
): { title: string; message: string | null; cancel: string; confirm: string } | null {
  if (!row.mayHurt && row.notHereLine === null) return null;
  const confirm = PICKER_COPY.anyway(actionWord);
  if (!row.mayHurt && row.notHereLine !== null) return { title: PICKER_COPY.notHereTitle(row.notHereLine, actionWord, row.name), message: null, cancel: PICKER_COPY.cancel, confirm };
  const message = [row.painLine, row.notHereLine].filter((x): x is string => x !== null && x !== '').join('\n');
  return { title: `${row.name} may hurt`, message: message === '' ? null : message, cancel: PICKER_COPY.cancel, confirm };
}

/**
 * (Ben, 26 Oct) An equipment chip on the ranked suggestions: those of another kind are hidden, the rest keep their
 * order (the ranking is never changed). An exercise the index doesn't know is kept (nothing to judge it by).
 */
export function suggestionKept(index: PickerIndex | null, exerciseId: string, equipment: EquipmentFilter | null): boolean {
  if (equipment === null || index === null) return true;
  const entry = index.entries.find((e) => e.exercise.id === exerciseId);
  return entry === undefined || equipmentFiltersOf(entry.exercise).includes(equipment);
}
