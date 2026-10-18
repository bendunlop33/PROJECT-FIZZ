import type { EquipmentInstance, Exercise, ExerciseEquipmentKind } from '@fizz/schemas';

import { distanceLoadText, formatDistance, formatDuration, loadText, NBSP } from './display';
import { activeFilterCount, MOVEMENT_FILTER_LABEL, muscleGroupsOf, searchExerciseRows, type ExerciseFilters, type ExerciseMatch, type MovementFilter, type SearchableEntry } from './exercise-search';
import { collectExerciseSeries, type ExerciseSeries } from './progress/exercise';
import { longDate, shortDate, type ExerciseDetailView } from './progress/exercise-view';
import type { ProgressExercise, ProgressSession, ProgressSet } from './progress/projection';

/**
 * Library › Exercises and Exercise detail (exercise-library §9). Pure view
 * models: the screens render these and compute nothing. Catalogue facts are
 * Coaching knowledge; `Last`, records, pain and `Used in` are Your data
 * (rule 10), kept in separate parts of each model. Values from history are
 * actuals; `Est. 1RM` is an estimate and says so (`≈`, rule 6).
 */

const TIMES = `${NBSP}×${NBSP}`;

/** Every equipment kind as one word (rows, detail header). */
export const EXERCISE_EQUIPMENT_WORD: Record<ExerciseEquipmentKind, string> = {
  barbell: 'Barbell',
  ez_bar: 'EZ bar',
  trap_bar: 'Trap bar',
  dumbbells: 'Dumbbells',
  weight_stack: 'Cable / stack',
  assisted_stack: 'Assisted',
  plate_loaded_machine: 'Plate-loaded',
  bodyweight_station: 'Bodyweight',
  kettlebell: 'Kettlebell',
  sled: 'Sled',
  erg: 'Erg',
  medicine_ball: 'Medicine ball',
  sandbag: 'Sandbag',
  band: 'Band',
};

type RowExercise = Pick<Exercise, 'id' | 'name' | 'movementPattern' | 'primaryMuscles' | 'compatibleEquipment' | 'defaultLoadConvention' | 'laterality' | 'measurement' | 'source'>;

/** The exercise's equipment in one word: its first kind, or `Bodyweight` when it needs none. */
export function equipmentWordOf(e: Pick<Exercise, 'compatibleEquipment' | 'defaultLoadConvention'>): string | null {
  const first = e.compatibleEquipment[0];
  if (e.defaultLoadConvention === 'bodyweight' && (first === undefined || first === 'bodyweight_station')) return 'Bodyweight';
  return first === undefined ? null : EXERCISE_EQUIPMENT_WORD[first];
}

// ---------------------------------------------------------------------------
// Last actual per exercise (row line 3)

export interface LastActual {
  /** `120 kg × 8`, `30 kg each × 9`, `Assist 20 kg × 8`, `BW × 12`, `0:45`, `20 m`. An actual. */
  text: string;
  /** Local date of the workout. */
  date: string;
  gymId: string | null;
  source: 'manual' | 'import';
}

/** One logged set in words, in its own unit and convention (never converted). */
export function actualSetText(s: Pick<ProgressSet, 'load' | 'reps' | 'durationS' | 'distanceM'>, row: Pick<ProgressExercise, 'convention' | 'measurement' | 'equipmentKind'>): string {
  const eq = row.equipmentKind === null ? null : { kind: row.equipmentKind };
  if (row.measurement === 'duration') {
    const time = formatDuration(s.durationS ?? 0);
    return s.load !== null && row.convention !== 'bodyweight' && s.load.value > 0 ? `${loadText(s.load, row.convention, eq)} · ${time}` : time;
  }
  if (row.measurement === 'distance') {
    const d = formatDistance(s.distanceM ?? 0);
    const l = distanceLoadText(s.load, row.convention, eq);
    return l === null ? d : `${l} · ${d}`;
  }
  return `${loadText(s.load, row.convention, eq)}${TIMES}${String(s.reps ?? 0)}`;
}

/** The set that stands for a workout: the heaviest working set (least assistance; most reps, longest hold, longest distance). */
function topSet(sets: readonly ProgressSet[], row: ProgressExercise): ProgressSet | null {
  const working = sets.filter((s) => s.setType !== 'warmup');
  const pool = working.length > 0 ? working : sets;
  let best: ProgressSet | null = null;
  const score = (s: ProgressSet): [number, number] => {
    if (row.measurement === 'duration') return [s.durationS ?? 0, 0];
    if (row.measurement === 'distance') return [s.distanceM ?? 0, s.load?.value ?? 0];
    const load = s.load?.value ?? 0;
    return [row.convention === 'assistance' ? -load : load, s.reps ?? 0];
  };
  for (const s of pool) {
    if (best === null) {
      best = s;
      continue;
    }
    const [a1, a2] = score(s);
    const [b1, b2] = score(best);
    if (a1 > b1 || (a1 === b1 && a2 > b2)) best = s;
  }
  return best;
}

/**
 * Each exercise's latest workout's top set, anywhere (§9.3 line 3): an
 * actual, in that row's own unit and convention.
 */
export function lastActualByExercise(sessions: readonly ProgressSession[]): Map<string, LastActual> {
  const out = new Map<string, LastActual & { ms: number }>();
  for (const s of sessions) {
    for (const row of s.exercises) {
      if (row.sets.length === 0) continue;
      const cur = out.get(row.exerciseId);
      if (cur !== undefined && cur.ms > s.startedMs) continue;
      if (cur !== undefined && cur.ms === s.startedMs && cur.text !== '') continue;
      const top = topSet(row.sets, row);
      if (top === null) continue;
      out.set(row.exerciseId, { text: actualSetText(top, row), date: s.date, gymId: row.gymId ?? s.gymId, source: s.source, ms: s.startedMs });
    }
  }
  return new Map([...out].map(([k, v]) => [k, { text: v.text, date: v.date, gymId: v.gymId, source: v.source }]));
}

// ---------------------------------------------------------------------------
// Library › Exercises (§9.3)

export interface BrowseEntry extends SearchableEntry {
  exercise: RowExercise;
  /** A bundled animated guide exists (the decorative `▷` glyph). */
  hasGuide: boolean;
  /** An active pain flag covers this exercise (never similar ones, EL9). Local date it was flagged. */
  painFlag: { since: string; accessibilityLabel: string } | null;
}

export type BrowseTag = { kind: 'may_hurt'; text: 'May hurt'; accessibilityLabel: string } | { kind: 'custom'; text: 'Custom' } | { kind: 'not_at_gym'; text: string };

export interface BrowseRowView {
  exerciseId: string;
  name: string;
  hasGuide: boolean;
  /** `Matches "RDL" · Barbell · Hamstrings` (· `per side` / `Time` / `Distance`). */
  line2: string;
  /** `Last 120 kg × 8 · 3 Oct` (` at Hotel Gym`); null with no history (no noise in Browse). */
  line3: string | null;
  tags: BrowseTag[];
  accessibilityLabel: string;
}

export interface BrowseSectionView {
  key: 'recent' | 'all' | 'matches';
  /** `RECENT`, `ALL EXERCISES · 142`, `MATCHES`. */
  title: string;
  rows: BrowseRowView[];
}

export interface ExerciseBrowseView {
  sections: BrowseSectionView[];
  /** `12 more not at Main Gym.` (then `Show ›`); null when nothing is left out. */
  hiddenText: string | null;
  /** `No match for "landmine twst".` / `No exercises match.`; null when there are rows. */
  empty: string | null;
  /** `Clear filters` is offered (a filter is on). */
  canClear: boolean;
  /** The `At <gym>` chip: `At Main Gym`, or `Any gym` (disabled) with no gym selected. */
  gymChip: { label: string; enabled: boolean };
}

export interface BrowseInput {
  entries: readonly BrowseEntry[];
  query: string;
  filters: ExerciseFilters;
  /** The selected gym, or null (then `At …` reads `Any gym` and nothing is checked). */
  gym: { id: string; name: string; equipment: readonly Pick<EquipmentInstance, 'kind' | 'availability'>[] } | null;
  /** Recently done, newest first. */
  recentIds: readonly string[];
  last: ReadonlyMap<string, LastActual>;
  gymNames: Readonly<Record<string, string>>;
  today: string;
  recentLimit?: number;
}

function line2Of(e: RowExercise, match: ExerciseMatch | null): string {
  const parts: string[] = [];
  if (match?.matchedAlias != null) parts.push(`Matches “${match.matchedAlias}”`);
  const eq = equipmentWordOf(e);
  if (eq !== null) parts.push(eq);
  const muscle = muscleGroupsOf(e)[0];
  if (muscle !== undefined) parts.push(muscle);
  if (e.laterality === 'unilateral') parts.push('per side');
  if (e.measurement === 'duration') parts.push('Time');
  if (e.measurement === 'distance') parts.push('Distance');
  return parts.join(' · ');
}

/** `Last 120 kg × 8 · 3 Oct`, with ` at Hotel Gym` when it was done elsewhere; imported history reads the same (Ben, 18 Oct). */
export function lastLine(last: LastActual | undefined, gymId: string | null, gymNames: Readonly<Record<string, string>>, today: string): string | null {
  if (last === undefined) return null;
  const where = last.source === 'import' ? '' : last.gymId !== null && gymId !== null && last.gymId !== gymId && gymNames[last.gymId] !== undefined ? ` at ${gymNames[last.gymId] as string}` : '';
  return `Last ${last.text} · ${shortDate(last.date, today)}${where}`;
}

const spoken = (s: string): string => s.replaceAll(NBSP, ' ').replaceAll('×', 'times').replaceAll('“', '').replaceAll('”', '');

export function buildExerciseBrowseView(input: BrowseInput): ExerciseBrowseView {
  const gymEq = input.gym?.equipment ?? null;
  const filters = input.gym === null ? { ...input.filters, atGym: false } : input.filters;
  const { rows, hiddenByGymCount } = searchExerciseRows(input.entries, input.query, filters, gymEq);
  const gymId = input.gym?.id ?? null;
  const view = (r: (typeof rows)[number]): BrowseRowView => {
    const e = r.entry.exercise;
    const tags: BrowseTag[] = [];
    if (r.entry.painFlag !== null) tags.push({ kind: 'may_hurt', text: 'May hurt', accessibilityLabel: r.entry.painFlag.accessibilityLabel });
    if (e.source === 'custom') tags.push({ kind: 'custom', text: 'Custom' });
    // Availability tags only while `At <gym>` is on (§9.3); then nothing not-at-gym is listed anyway.
    const line2 = line2Of(e, r.match);
    const line3 = lastLine(input.last.get(e.id), gymId, input.gymNames, input.today);
    const a11y = [e.name, spoken(line2).toLowerCase(), line3 === null ? null : spoken(line3).toLowerCase(), r.entry.hasGuide ? 'has a guide' : null, ...tags.map((t) => (t.kind === 'may_hurt' ? t.accessibilityLabel : t.text))].filter((x): x is string => x !== null && x !== '');
    return { exerciseId: e.id, name: e.name, hasGuide: r.entry.hasGuide, line2, line3, tags, accessibilityLabel: a11y.join(', ') };
  };
  const sections: BrowseSectionView[] = [];
  const searching = input.query.trim() !== '';
  if (searching) {
    if (rows.length > 0) sections.push({ key: 'matches', title: 'MATCHES', rows: rows.map(view) });
  } else {
    const byId = new Map(rows.map((r) => [r.entry.exercise.id, r]));
    const recent = input.recentIds.flatMap((id) => {
      const r = byId.get(id);
      return r === undefined ? [] : [r];
    });
    const limited = recent.slice(0, input.recentLimit ?? 10);
    if (limited.length > 0) sections.push({ key: 'recent', title: 'RECENT', rows: limited.map(view) });
    if (rows.length > 0) sections.push({ key: 'all', title: `ALL EXERCISES · ${String(rows.length)}`, rows: rows.map(view) });
  }
  const gymName = input.gym?.name ?? null;
  return {
    sections,
    hiddenText: hiddenByGymCount > 0 && gymName !== null ? `${String(hiddenByGymCount)} more not at ${gymName}.` : null,
    empty: rows.length > 0 ? null : searching ? `No match for “${input.query.trim()}”.` : 'No exercises match.',
    canClear: activeFilterCount(filters) > 0,
    gymChip: gymName === null ? { label: 'Any gym', enabled: false } : { label: `At ${gymName}`, enabled: true },
  };
}

// ---------------------------------------------------------------------------
// Exercise detail (§9.4)

export interface ExerciseKnowledgeInput {
  /** A bundled guide to show as a still poster (EL12); null without one (or when it can't be read). */
  poster: { catalogueKey: string; draftLabel: string | null; accessibilityLabel: string } | null;
  /** `Feel it most:` / `Also works:` lines (guides v2), else empty. */
  legend: readonly { label: string; list: string }[];
  execution: readonly string[];
  avoid: readonly string[];
  /** The How to screen has something to show (`Full how-to ›`). */
  hasFullHowTo: boolean;
}

export interface ExerciseInfoInput {
  exercise: RowExercise & Partial<Pick<Exercise, 'catalogueKey'>>;
  aliases: readonly string[];
  knowledge: ExerciseKnowledgeInput;
  /** Finished workouts (Progress's projection); only this exercise's rows are read. */
  sessions: readonly ProgressSession[];
  /** Progress's own detail for the default series (the same numbers Progress shows, EL-B7); null with no history. */
  progress: Pick<ExerciseDetailView, 'seriesId' | 'seriesLabel' | 'stats'> | null;
  painFlag: { flagId: string; since: string } | null;
  usedIn: readonly { routineId: string; name: string }[];
  /** The selected gym's name (`Alternatives at Main Gym`); null with none. */
  gymName: string | null;
  today: string;
}

export interface ExerciseInfoView {
  exerciseId: string;
  title: string;
  /** `Hinge · Barbell`. */
  subtitle: string;
  /** `Also called RDL, Barbell RDL` or null. */
  aliasesLine: string | null;
  tags: { kind: 'custom'; text: 'Custom' }[];
  knowledge: {
    poster: ExerciseKnowledgeInput['poster'];
    /** `Feel it most: Hamstrings · Glutes` lines, else one `Muscles: …` line from the exercise, else none. */
    muscles: { label: string; list: string }[];
    cues: string[];
    avoid: string[];
    hasFullHowTo: boolean;
    alternativesLabel: string;
  };
  yours: {
    pain: { flagId: string; text: string } | null;
    /** Null with no history: the section shows `No history yet.` */
    history: {
      seriesId: string;
      caption: string;
      rows: { label: string; value: string; estimate: boolean }[];
      /** `14 workouts since 2 Jul`. */
      workouts: string;
    } | null;
    empty: string | null;
    usedIn: { routineId: string; name: string }[];
  };
}

const STAT_LABEL: Record<string, string> = {
  'EST. 1RM': 'Est. 1RM',
  'BEST SET': 'Best set',
  'LEAST ASSIST': 'Least assist',
  'MOST REPS': 'Most reps',
  'LONGEST HOLD': 'Longest hold',
  'BEST DISTANCE': 'Best distance',
  'TOTAL DISTANCE': 'Total distance',
};

function movementWord(pattern: string): string | null {
  return (MOVEMENT_FILTER_LABEL as Record<string, string | undefined>)[pattern as MovementFilter] ?? null;
}

function seriesOf(sessions: readonly ProgressSession[], exerciseId: string, seriesId: string): ExerciseSeries | null {
  const mine = sessions.filter((s) => s.exercises.some((e) => e.exerciseId === exerciseId));
  return collectExerciseSeries(mine, exerciseId).find((s) => s.id === seriesId) ?? null;
}

export function buildExerciseInfoView(input: ExerciseInfoInput): ExerciseInfoView {
  const e = input.exercise;
  const subtitle = [movementWord(e.movementPattern), equipmentWordOf(e)].filter((x): x is string => x !== null).join(' · ');
  const legend = input.knowledge.legend.filter((l) => l.list.trim() !== '').map((l) => ({ label: l.label, list: l.list }));
  const groups = muscleGroupsOf(e);
  const muscles = legend.length > 0 ? legend : groups.length > 0 ? [{ label: 'Muscles:', list: groups.join(' · ') }] : [];

  let history: ExerciseInfoView['yours']['history'] = null;
  if (input.progress !== null) {
    const series = seriesOf(input.sessions, e.id, input.progress.seriesId);
    const rows: { label: string; value: string; estimate: boolean }[] = [];
    const latest = series?.sessions[series.sessions.length - 1];
    const latestRow = latest?.rows[0];
    if (latest !== undefined && latestRow !== undefined) {
      const top = topSet(latest.sets, latestRow);
      if (top !== null) rows.push({ label: 'Last', value: `${actualSetText(top, latestRow)} · ${shortDate(latest.date, input.today)}`, estimate: false });
    }
    for (const s of input.progress.stats) {
      const label = STAT_LABEL[s.label];
      if (label === undefined || s.value === '—') continue;
      rows.push({ label, value: s.value, estimate: s.label === 'EST. 1RM' });
    }
    const first = series?.sessions[0];
    const n = series?.sessions.length ?? 0;
    history = {
      seriesId: input.progress.seriesId,
      caption: input.progress.seriesLabel,
      rows,
      workouts: first === undefined ? '' : `${String(n)} ${n === 1 ? 'workout' : 'workouts'} since ${shortDate(first.date, input.today)}`,
    };
  }

  return {
    exerciseId: e.id,
    title: e.name,
    subtitle,
    aliasesLine: input.aliases.length > 0 ? `Also called ${input.aliases.join(', ')}` : null,
    tags: e.source === 'custom' ? [{ kind: 'custom', text: 'Custom' }] : [],
    knowledge: {
      poster: input.knowledge.poster,
      muscles,
      cues: input.knowledge.execution.slice(0, 3),
      avoid: input.knowledge.avoid.slice(0, 3),
      hasFullHowTo: input.knowledge.hasFullHowTo,
      alternativesLabel: input.gymName === null ? 'Alternatives' : `Alternatives at ${input.gymName}`,
    },
    yours: {
      pain: input.painFlag === null ? null : { flagId: input.painFlag.flagId, text: `May hurt · flagged ${shortDate(input.painFlag.since, input.today)}` },
      history,
      empty: history === null ? 'No history yet.' : null,
      usedIn: [...input.usedIn],
    },
  };
}

/** VoiceOver for the pain line: the flag's date in words. */
export function painLineWords(since: string, today: string): string {
  return `May hurt, flagged ${longDate(since, today)}. Opens the flag.`;
}

// ---------------------------------------------------------------------------
// Add to a workout (§9.5)

export interface AddDestination {
  kind: 'session' | 'routine' | 'new';
  /** Session or routine ID; null for `New workout`. */
  id: string | null;
  label: string;
  /** `In progress · applies next time`; null otherwise. */
  detail: string | null;
  /** `Already in it`: shown disabled. */
  disabled: boolean;
  disabledText: string | null;
  /** The version the write must expect (rule 5). */
  version: number | null;
  /** The primary's label when this row is chosen: `Add to Pull B`. */
  primary: string;
}

export interface AddDestinationsInput {
  exerciseId: string;
  /** The unfinished workout, if any. */
  session: { id: string; name: string; version: number; exerciseIds: readonly string[]; routineId: string | null } | null;
  /** Live saved workouts. `rotationIndex`: place in the rotation (null = not in it). `lastDoneMs`: null = never. */
  routines: readonly { id: string; name: string; version: number; exerciseIds: readonly string[]; rotationIndex: number | null; lastDoneMs: number | null }[];
  /**
   * The exercise's measurement. A distance exercise can go into the workout
   * in progress (distance sets log), but a saved workout's set template has
   * no distance target, so saved and new workouts are shown disabled
   * (review library-browse S1; routines.md: distance is never saved as reps).
   */
  measurement?: 'reps' | 'duration' | 'distance';
}

/** Why a saved or new workout can't take a distance exercise (§9.6). */
export const NO_DISTANCE_IN_WORKOUTS = 'Can’t save distance yet';

export interface AddDestinations {
  now: AddDestination | null;
  workouts: AddDestination[];
  newWorkout: AddDestination;
}

/** The Add sheet's rows (§9.5): the workout in progress, then saved workouts (rotation first, then most recently done, then A–Z), then `New workout`. */
export function buildAddDestinations(input: AddDestinationsInput): AddDestinations {
  const s = input.session;
  const now: AddDestination | null =
    s === null
      ? null
      : {
          kind: 'session',
          id: s.id,
          label: `${s.name} · in progress`,
          detail: null,
          disabled: s.exerciseIds.includes(input.exerciseId),
          disabledText: s.exerciseIds.includes(input.exerciseId) ? 'Already in it' : null,
          version: s.version,
          primary: `Add to ${s.name}`,
        };
  const ordered = [...input.routines].sort((a, b) => {
    if (a.rotationIndex !== null && b.rotationIndex !== null) return a.rotationIndex - b.rotationIndex;
    if (a.rotationIndex !== null) return -1;
    if (b.rotationIndex !== null) return 1;
    return (b.lastDoneMs ?? -1) - (a.lastDoneMs ?? -1) || a.name.localeCompare(b.name);
  });
  const distance = input.measurement === 'distance';
  const workouts = ordered.map((r): AddDestination => {
    const already = r.exerciseIds.includes(input.exerciseId);
    return {
      kind: 'routine',
      id: r.id,
      label: r.name,
      detail: s !== null && s.routineId === r.id ? 'In progress · applies next time' : null,
      disabled: already || distance,
      disabledText: already ? 'Already in it' : distance ? NO_DISTANCE_IN_WORKOUTS : null,
      version: r.version,
      primary: `Add to ${r.name}`,
    };
  });
  return {
    now,
    workouts,
    newWorkout: { kind: 'new', id: null, label: 'New workout', detail: null, disabled: distance, disabledText: distance ? NO_DISTANCE_IN_WORKOUTS : null, version: null, primary: 'Add to new workout' },
  };
}
