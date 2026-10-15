import type { ExerciseSplit, ProgressGrouping, SetExclusion } from '@fizz/schemas';
import { daysBetween } from '../calendar';
import { normaliseExclusions } from '../exclusions';
import { muscleRegion } from '../session/first-run';
import { oneDecimal } from './activity';
import { MUSCLE_GROUPS, muscleGroupOf, type MuscleGroup } from './muscle-groups';
import type { ProgressExercise, ProgressSession, ProgressSet } from './projection';
import { inRange, type ProgressWindow } from './window';

/**
 * Muscle frequency over a Progress window (progress.md PG7, PG9, PG21, PG26,
 * PG27). Pure. Counts work done; it says nothing about recovery or fatigue.
 */

/** What Progress needs to know about an exercise (Coaching knowledge, or Ben's custom exercise). */
export interface MuscleInfo {
  name: string;
  movementPattern: string;
  primaryMuscles: readonly string[];
  secondaryMuscles?: readonly string[] | undefined;
  split?: ExerciseSplit | undefined;
}

export type HardSetKind = 'hard' | 'warmup' | 'easy';

/**
 * PG7: a completed, non-warm-up set is a hard set when it is rated RPE ≥ 6
 * (or RIR ≤ 4) or has no rating at all (every FitNotes set). Drop sets count
 * (PG9). Sets Ben marked (`Spotted`, `Pain`, …) still count here, because the
 * work was done (PG21). Callers pass completed sets only (the projection
 * holds nothing else).
 */
export function hardSetKind(set: Pick<ProgressSet, 'setType' | 'rpe' | 'rir'>): HardSetKind {
  if (set.setType === 'warmup') return 'warmup';
  if (set.rpe !== null) return set.rpe >= 6 ? 'hard' : 'easy';
  if (set.rir !== null) return set.rir <= 4 ? 'hard' : 'easy';
  return 'hard';
}

export function isHardSet(set: Pick<ProgressSet, 'setType' | 'rpe' | 'rir'>): boolean {
  return hardSetKind(set) === 'hard';
}

/** Body-part credit per set: 1 for a group among the primary muscles, ½ for one among the helpers; the higher one wins (PG26). */
export function muscleGroupCredits(info: Pick<MuscleInfo, 'primaryMuscles' | 'secondaryMuscles'>): Map<MuscleGroup, 1 | 0.5> {
  const out = new Map<MuscleGroup, 1 | 0.5>();
  for (const m of info.primaryMuscles) {
    const g = muscleGroupOf(m);
    if (g !== null) out.set(g, 1);
  }
  for (const m of info.secondaryMuscles ?? []) {
    const g = muscleGroupOf(m);
    if (g !== null && !out.has(g)) out.set(g, 0.5);
  }
  return out;
}

export const SPLIT_ORDER: readonly ExerciseSplit[] = ['push', 'pull', 'legs', 'core', 'other'];
export const SPLIT_LABEL: Readonly<Record<ExerciseSplit, string>> = { push: 'Push', pull: 'Pull', legs: 'Legs', core: 'Core', other: 'Other' };

/**
 * PG27: each exercise belongs to one of Push, Pull, Legs, Core, Other: the
 * catalogue's `split` if set, else its primary muscle, else its movement
 * pattern, else Other. Carries and conditioning whose muscles don't say go to
 * Other (not Core, as the pattern alone would suggest).
 */
export function exerciseSplit(info: MuscleInfo | undefined): ExerciseSplit {
  if (info === undefined) return 'other';
  if (info.split !== undefined) return info.split;
  const byMuscle = muscleRegion({ movementPattern: '', primaryMuscles: [...info.primaryMuscles] });
  if (byMuscle !== null) return byMuscle;
  if (info.movementPattern === 'carry' || info.movementPattern === 'conditioning') return 'other';
  return muscleRegion({ movementPattern: info.movementPattern, primaryMuscles: [] }) ?? 'other';
}

/** A unit of work: one set, or one left + right pair of a unilateral exercise. Hard wins over easy, easy over warm-up. */
function unitKind(sets: readonly ProgressSet[]): HardSetKind {
  const kinds = sets.map(hardSetKind);
  if (kinds.includes('hard')) return 'hard';
  if (kinds.includes('easy')) return 'easy';
  return 'warmup';
}

/**
 * Sets of one exercise row in one workout, by kind. A unilateral exercise's
 * left and right sets count once. They are paired within a set type (left
 * warm-ups with right warm-ups, working with working, and so on): hard sides
 * pair with hard sides first, then the rest pair in logged order. Each pair is
 * classified once, hard if either side was hard. So:
 * - 3 left + 3 right = 3 sets;
 * - 3 left hard + 2 right hard + 1 right easy = 3 hard, not 3 hard + 1 easy (review S6);
 * - 1 left warm-up + 3 left + 3 right = 3 hard + 1 warm-up (review r2 S2);
 * - 1 left easy + 2 left hard + 2 right hard = 2 hard + 1 easy (review r2 S2).
 * `both` sets and any unpaired side set count 1 each.
 */
export function countRowSets(ex: Pick<ProgressExercise, 'laterality' | 'sets'>): { hard: number; warmup: number; easy: number; markedHard: number; markedKinds: SetExclusion[] } {
  const units: ProgressSet[][] = [];
  if (ex.laterality === 'bilateral') {
    for (const s of ex.sets) units.push([s]);
  } else {
    const ordered = [...ex.sets].sort((a, b) => a.index - b.index);
    for (const s of ordered) if (s.side === 'both' || s.side === null) units.push([s]);
    // Pair within a set type (review r2 S2): a lone left warm-up must not pair with the first right working set.
    const types = [...new Set(ordered.map((s) => s.setType))];
    for (const type of types) {
      const left = ordered.filter((s) => s.side === 'left' && s.setType === type);
      const right = ordered.filter((s) => s.side === 'right' && s.setType === type);
      // Hard sides pair with hard sides, then the rest pair in order, so the
      // count doesn't depend on where an easy side set was logged.
      const leftHard = left.filter(isHardSet);
      const rightHard = right.filter(isHardSet);
      const leftRest = left.filter((s) => !isHardSet(s));
      const rightRest = right.filter((s) => !isHardSet(s));
      const hardUnits = Math.max(leftHard.length, rightHard.length);
      for (let i = 0; i < hardUnits; i += 1) units.push([leftHard[i], rightHard[i]].filter((x): x is ProgressSet => x !== undefined));
      // A side short of hard sets has its other sets fill those hard pairs first (3 L hard + 2 R hard + 1 R easy = 3 hard).
      const restUnits = Math.max(left.length, right.length) - hardUnits;
      const leftSpare = leftRest.slice(hardUnits - leftHard.length);
      const rightSpare = rightRest.slice(hardUnits - rightHard.length);
      for (let i = 0; i < restUnits; i += 1) units.push([leftSpare[i], rightSpare[i]].filter((x): x is ProgressSet => x !== undefined));
    }
  }
  const out = { hard: 0, warmup: 0, easy: 0, markedHard: 0, markedKinds: [] as SetExclusion[] };
  const kinds = new Set<SetExclusion>();
  for (const unit of units) {
    const kind = unitKind(unit);
    out[kind] += 1;
    if (kind !== 'hard') continue;
    const marks = unit.filter((s) => hardSetKind(s) === 'hard').flatMap((s) => s.exclusions ?? []);
    if (marks.length === 0) continue;
    out.markedHard += 1;
    for (const m of marks) kinds.add(m);
  }
  out.markedKinds = normaliseExclusions([...kinds]);
  return out;
}

export interface FrequencyContributor {
  exerciseId: string;
  name: string;
  /** Hard sets of this exercise in the window. */
  sets: number;
  /** Body parts: 1 or ½ per set. Push/Pull/Legs: null (each set counts 1). */
  factor: 1 | 0.5 | null;
  /** `sets × factor`. */
  total: number;
}

export interface FrequencyRow {
  /** A `MuscleGroup` (`Chest`) or an `ExerciseSplit` (`push`). */
  key: string;
  label: string;
  /** Workouts in the window with at least 1 counted set for this group. */
  sessions: number;
  /** Sets in the window, in halves (`8.5`). */
  sets: number;
  /** Sets a week, one decimal; windows of 14 days or more only. */
  perWeek: number | null;
  /** The latest date this group got at least 1 counted set, up to the window's end; null = never. */
  lastTrained: string | null;
  /** Largest total first. */
  contributors: FrequencyContributor[];
  /**
   * D2 sub-rows (Ben, 13 Oct 2026), largest first, zeros left out. Body
   * parts: the muscles in the group (`Lats`, `Traps`), 1 or ½ per set as
   * the group. Push/Pull/Legs: the exercises (their sets add up to the row).
   */
  subRows: FrequencySubRow[];
}

export interface FrequencySubRow {
  key: string;
  label: string;
  /** Sets in the window, in halves. */
  sets: number;
  /** Workouts with at least 1 counted set for it (body parts); null for exercises. */
  sessions: number | null;
}

/** `upper_chest` → `Upper chest`. */
export function muscleLabel(muscle: string): string {
  const w = muscle.replace(/_/g, ' ');
  return `${w.charAt(0).toUpperCase()}${w.slice(1)}`;
}

/** Per-muscle credit for one exercise: 1 for a primary muscle, ½ for a helper; the higher wins. Muscles outside the vocabulary are left out. */
export function muscleCredits(info: Pick<MuscleInfo, 'primaryMuscles' | 'secondaryMuscles'>): Map<string, 1 | 0.5> {
  const out = new Map<string, 1 | 0.5>();
  for (const m of info.primaryMuscles) if (muscleGroupOf(m) !== null) out.set(m, 1);
  for (const m of info.secondaryMuscles ?? []) if (muscleGroupOf(m) !== null && !out.has(m)) out.set(m, 0.5);
  return out;
}

export interface MuscleFrequency {
  grouping: ProgressGrouping;
  /** Body parts: the 11 groups in fixed order, zeros included. PPL: Push, Pull, Legs, Core, then Other only when above 0. */
  rows: FrequencyRow[];
  notCounted: {
    warmups: number;
    /** Rated under RPE 6 (or more than 4 in reserve). */
    easy: number;
    /** Exercises with hard sets in the window but no muscles that map to a group; their sets count in no body-part row. */
    noMuscles: { exerciseId: string; name: string; sets: number }[];
  };
  /** Hard sets Ben marked (spotted, pain, …) that still count here (PG21). */
  markedCounted: number;
  /** The marks on those sets, in the canonical order (`spotted`, `pain`, …). */
  markedKinds: SetExclusion[];
  /** Every hard set in the window (PPL rows add up to this). */
  hardSets: number;
}

interface GroupTally {
  halves: number;
  sessions: number;
  lastTrained: string | null;
  contributors: Map<string, FrequencyContributor>;
  /** Body parts: per muscle, halves and sessions in the window. */
  muscles: Map<string, { halves: number; sessions: number }>;
}

/**
 * Muscle frequency for one grouping. `exercises` holds what is known about
 * each exercise by ID; an exercise not in it has no muscles (its sets still
 * count as sessions and, in Push/Pull/Legs, as Other).
 */
export function muscleFrequency(
  sessions: readonly ProgressSession[],
  exercises: ReadonlyMap<string, MuscleInfo>,
  window: ProgressWindow,
  grouping: ProgressGrouping,
): MuscleFrequency {
  const keys: readonly string[] = grouping === 'body_part' ? MUSCLE_GROUPS : SPLIT_ORDER;
  const tallies = new Map<string, GroupTally>(keys.map((k) => [k, { halves: 0, sessions: 0, lastTrained: null, contributors: new Map(), muscles: new Map() }]));
  let warmups = 0;
  let easy = 0;
  let markedCounted = 0;
  const markedKinds = new Set<SetExclusion>();
  let hardSets = 0;
  const noMuscles = new Map<string, { exerciseId: string; name: string; sets: number }>();
  const creditsCache = new Map<string, Map<string, 1 | 0.5>>();
  const creditsOf = (exerciseId: string): Map<string, 1 | 0.5> => {
    let c = creditsCache.get(exerciseId);
    if (c === undefined) {
      const info = exercises.get(exerciseId);
      c = grouping === 'body_part' ? (info ? muscleGroupCredits(info) : new Map()) : new Map([[exerciseSplit(info), 1 as const]]);
      creditsCache.set(exerciseId, c);
    }
    return c;
  };
  const muscleCache = new Map<string, Map<string, 1 | 0.5>>();
  const musclesOf = (exerciseId: string): Map<string, 1 | 0.5> => {
    let c = muscleCache.get(exerciseId);
    if (c === undefined) {
      const info = exercises.get(exerciseId);
      c = grouping === 'body_part' && info ? muscleCredits(info) : new Map();
      muscleCache.set(exerciseId, c);
    }
    return c;
  };

  for (const s of sessions) {
    if (s.date > window.to) continue;
    const inWindow = inRange(s.date, window);
    const halvesToday = new Map<string, number>();
    const muscleHalvesToday = new Map<string, number>();
    for (const ex of s.exercises) {
      const n = countRowSets(ex);
      const credits = creditsOf(ex.exerciseId);
      if (inWindow) {
        warmups += n.warmup;
        easy += n.easy;
        markedCounted += n.markedHard;
        for (const k of n.markedKinds) markedKinds.add(k);
        hardSets += n.hard;
        if (n.hard > 0 && credits.size === 0) {
          const name = exercises.get(ex.exerciseId)?.name ?? ex.exerciseName;
          const row = noMuscles.get(ex.exerciseId) ?? { exerciseId: ex.exerciseId, name, sets: 0 };
          row.sets += n.hard;
          noMuscles.set(ex.exerciseId, row);
        }
      }
      if (n.hard === 0) continue;
      for (const [key, credit] of credits) {
        halvesToday.set(key, (halvesToday.get(key) ?? 0) + n.hard * credit * 2);
        if (!inWindow) continue;
        const t = tallies.get(key);
        if (t === undefined) continue;
        const c = t.contributors.get(ex.exerciseId) ?? {
          exerciseId: ex.exerciseId,
          name: exercises.get(ex.exerciseId)?.name ?? ex.exerciseName,
          sets: 0,
          factor: grouping === 'body_part' ? credit : null,
          total: 0,
        };
        c.sets += n.hard;
        c.total = c.sets * credit;
        t.contributors.set(ex.exerciseId, c);
      }
      if (inWindow) for (const [muscle, credit] of musclesOf(ex.exerciseId)) muscleHalvesToday.set(muscle, (muscleHalvesToday.get(muscle) ?? 0) + n.hard * credit * 2);
    }
    for (const [muscle, halves] of muscleHalvesToday) {
      const group = muscleGroupOf(muscle);
      const t = group === null ? undefined : tallies.get(group);
      if (t === undefined) continue;
      const m = t.muscles.get(muscle) ?? { halves: 0, sessions: 0 };
      m.halves += halves;
      if (halves >= 2) m.sessions += 1;
      t.muscles.set(muscle, m);
    }
    for (const [key, halves] of halvesToday) {
      const t = tallies.get(key);
      if (t === undefined) continue;
      if (inWindow) t.halves += halves;
      // A session counts for a group with at least 1 counted set that day (PG26), so sets ≥ sessions always.
      if (halves >= 2) {
        if (inWindow) t.sessions += 1;
        if (t.lastTrained === null || s.date > t.lastTrained) t.lastTrained = s.date;
      }
    }
  }

  const weeks = (daysBetween(window.from, window.to) + 1) / 7;
  const rows: FrequencyRow[] = keys.map((key) => {
    const t = tallies.get(key) ?? { halves: 0, sessions: 0, lastTrained: null, contributors: new Map<string, FrequencyContributor>(), muscles: new Map<string, { halves: number; sessions: number }>() };
    const sets = t.halves / 2;
    const contributors = [...t.contributors.values()].sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
    const subRows: FrequencySubRow[] =
      grouping === 'body_part'
        ? [...t.muscles.entries()]
            .filter(([, m]) => m.halves > 0)
            .map(([muscle, m]) => ({ key: muscle, label: muscleLabel(muscle), sets: m.halves / 2, sessions: m.sessions }))
            .sort((a, b) => b.sets - a.sets || a.label.localeCompare(b.label))
        : contributors.filter((c) => c.total > 0).map((c) => ({ key: c.exerciseId, label: c.name, sets: c.total, sessions: null }));
    return {
      key,
      label: grouping === 'body_part' ? key : SPLIT_LABEL[key as ExerciseSplit],
      sessions: t.sessions,
      sets,
      perWeek: window.days >= 14 ? oneDecimal(sets / weeks) : null,
      lastTrained: t.lastTrained,
      contributors,
      subRows,
    };
  });
  return {
    grouping,
    rows: grouping === 'ppl' ? rows.filter((r) => r.key !== 'other' || r.sets > 0 || r.sessions > 0) : rows,
    notCounted: { warmups, easy, noMuscles: [...noMuscles.values()].sort((a, b) => b.sets - a.sets || a.name.localeCompare(b.name)) },
    markedCounted,
    markedKinds: normaliseExclusions([...markedKinds]),
    hardSets,
  };
}
