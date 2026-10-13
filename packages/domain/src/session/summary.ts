import type { CheckIn, EquipmentInstance, Load, PainFlag, ProgressionRule, SessionAggregate, SessionExercise, WorkoutSet } from '@fizz/schemas';
import { isSetCountable, notComparedText, withExclusionWords } from '../exclusions';
import { painMentionedNotFlagged, reasonsText, scoreText } from '../checkin';
import type { RuleExerciseInfo } from '../default-rule';
import { unspecifiedPain } from '../next-target';
import { formatMinutes, loadText, NBSP, repRangeText, valuesText } from '../display';
import { loadDirection } from '../equipment';
import type { HistorySession, NextTargets } from '../progression';
import { toIso, toMs } from '../time';
import { lastComparableSession } from './active-view';
import { summaryHighlight } from '../touches';
import { equipmentOfRow } from './equipment-snapshot';
import { gymRouteIds, nextTargetBlocks, nextTargetsForBlock, partRootOf } from './gym-switch';
import { sessionRecords } from './records';
import { dateOnlyOf, workoutDurationMs } from './view';
import { summariseVolume } from './volume';

/**
 * `buildWorkoutSummary` (workout-summary.md §6). Pure and local: facts,
 * one like-for-like comparison, exercise rows, the check-in as Ben gave it,
 * and `Next time` from `calculateNextTargets`, every row tagged with its
 * source. The check-in is never read by the rules (check 24).
 */

/**
 * What the coach could do for this summary (workout-summary §5 source tags).
 * - `not_connected`: no AI route.
 * - `unavailable`: a route exists but is paused (limit, signed out, no model)
 *   or offline.
 * - `connected`: the coach is connected, but this build has no summary turn
 *   yet (ADR 0020 C8), so the built-in rule still sets every target and the
 *   tag names it plainly.
 */
export type CoachStatus = 'not_connected' | 'unavailable' | 'connected';

/**
 * Source tag on every built-in `Next time` row (ADR 0006): one word, `Rule`
 * (minimal-copy D1). The coach's status is the `Coach note` line, not the
 * tag; `Why?` names the rule in full (`Set by: Built-in rule · …`).
 */
export const BUILT_IN_SOURCE_TAG: Record<CoachStatus, string> = {
  not_connected: 'Rule',
  unavailable: 'Rule',
  connected: 'Rule',
};

export interface SummaryInput {
  aggregate: SessionAggregate;
  nowMs: number;
  gymName: string | null;
  /** Finished-session history per exercise ID (this session included). */
  history: Readonly<Record<string, readonly HistorySession[]>>;
  /** Progression rules by ID (routine exercises that name one). */
  rules: Readonly<Record<string, ProgressionRule>>;
  painFlags: readonly PainFlag[];
  checkIn: CheckIn | null;
  coach: CoachStatus;
  /** Catalogue info by exercise ID, for the built-in rule's category (ADR 0010 amendment 2). Missing = accessory range. */
  exerciseInfo?: Readonly<Record<string, RuleExerciseInfo>>;
  /** Gym names by ID, to name the compared workout's own gym (review r2 B1). A gym missing here isn't named. */
  gymNames?: Readonly<Record<string, string>>;
}

export interface NextTimeRow {
  exerciseId: string;
  exerciseName: string;
  kind: 'change' | 'held' | 'no_load' | 'pain';
  /** `Target 32.5 kg each × 8–10` / `Same target: 100 kg × 6–8` / `No load target`. */
  target: string;
  /** The rule's own explanation (`calculateNextTargets`); never written by the UI. */
  summary: string;
  facts: string[];
  ruleName: string;
  decision: NextTargets['decision'];
}

export interface WorkoutSummary {
  sessionId: string;
  sessionVersion: number;
  title: string;
  /** The name as stored (null: none, the title is worked out); what a rename's Undo goes back to. */
  storedName: string | null;
  /** The routine this workout was started from, if any (`Save as routine` is hidden then; premium-feel §6.2). */
  routineId: string | null;
  /** `import`: a FitNotes workout; it can't be saved as a routine (its loads were never checked on equipment). */
  source: 'manual' | 'import';
  startedAtUtc: string;
  endedAtUtc: string | null;
  tz: string;
  /**
   * `YYYY-MM-DD` for a workout with no time of day (imported from FitNotes):
   * show this date only, with no time range, no active time and no `Edit
   * times` (rule 6; review B2). Null for a workout logged in the app.
   */
  dateOnly: string | null;
  gymName: string | null;
  timingEdited: { start: boolean; end: boolean };
  /** `activeMs`/`activeText` are null for a date-only workout (no times to measure). */
  facts: { activeMs: number | null; activeText: string | null; exercisesDone: number; exercisesTotal: number; workingSets: number; skippedSets: number; warmupSets: number };
  checkIn: { checkInId: string; scoreText: string; reasons: string | null; note: string | null; painNotFlagged: boolean } | null;
  comparison:
    | { kind: 'compared'; exerciseName: string; todayText: string; lastText: string; lastAtUtc: string; why: string }
    | { kind: 'first_time'; text: string }
    | { kind: 'not_comparable'; text: string }
    | null;
  exercises: { sessionExerciseId: string; exerciseId: string; name: string; setsText: string; results: string; skipped: number; sides: string | null }[];
  nextTime: { sourceTag: string; rows: NextTimeRow[]; emptyText: string | null } | null;
  /** No working sets: the comparison and next-time sections are hidden; Discard is offered. */
  empty: boolean;
  /** One like-for-like highlight (`Heaviest Bench press set on Olympic bar: 102.5 kg × 6`), or null. Never invented. */
  highlight: string | null;
  /** Heaviest-set lines (premium-feel §5.1), one per exercise at most; shown in the Comparison region. */
  records: string[];
  /** Bounds for `Edit times` (`update_session_timing`). */
  timingBounds: { startLatestUtc: string; endEarliestUtc: string; endLatestUtc: string };
  lastCompletedAtUtc: string | null;
}

const isWork = (s: WorkoutSet) => s.setType !== 'warmup';

function equipmentOf(state: SessionAggregate, ex: SessionExercise): EquipmentInstance | null {
  return equipmentOfRow(state.session.equipmentSnapshot, ex);
}

/** `Main Gym → Hotel · Lisbon` for a workout that switched gym (workout-summary revision 2026-10-09). */
function gymLine(state: SessionAggregate, input: Pick<SummaryInput, 'gymName' | 'gymNames'>): string | null {
  const ids = gymRouteIds(state.session);
  if (ids.length <= 1) return input.gymName;
  return ids.map((gymId) => input.gymNames?.[gymId] ?? (gymId === state.session.gymId ? input.gymName : null) ?? 'Gym').join(' → ');
}

/** The top set: heaviest (or least assisted), then most reps. */
function topOf<T extends { load: { value: number } | null; reps: number | null }>(sets: readonly T[], direction: 'resistance' | 'assistance'): T | null {
  let best: T | null = null;
  for (const s of sets) {
    if (best === null) {
      best = s;
      continue;
    }
    const a = s.load?.value ?? 0;
    const b = best.load?.value ?? 0;
    const harder = direction === 'resistance' ? a > b : a < b;
    if (harder || (a === b && (s.reps ?? 0) > (best.reps ?? 0))) best = s;
  }
  return best;
}

/**
 * Whether the rule's next target is the load today's plan started with (its
 * first working set, before any change made today). A hold after a miss on
 * lighter sets (the rule holds the easiest load used) isn't `Same target`.
 */
function sameAsPlanned(state: SessionAggregate, sessionExerciseId: string, t: NextTargets): boolean {
  const first = state.sets
    .filter((x) => x.sessionExerciseId === sessionExerciseId && x.setType !== 'warmup' && x.status !== 'deleted')
    .sort((a, b) => a.index - b.index)[0];
  const planned = first === undefined ? null : (first.planned.coach?.before ?? first.planned).load;
  const next = (t.sets.find((x) => x.setType === 'working' || x.setType === 'top') ?? t.sets[0])?.load ?? null;
  if (planned === null || next === null) return planned === next;
  return planned.unit === next.unit && planned.convention === next.convention && Math.abs(planned.value - next.value) < 1e-9;
}

function nextTargetText(t: NextTargets, ex: SessionExercise, eq: EquipmentInstance | null, held: boolean): string {
  const first = t.sets.find((s) => s.setType === 'working' || s.setType === 'top') ?? t.sets[0];
  if (!first) return 'No target';
  if (t.decision === 'no_feasible_load' || (first.load === null && ex.loadConvention !== 'bodyweight' && ex.loadConvention !== 'added')) {
    return `No load target · ${repRangeText(first.reps)}${NBSP}reps`;
  }
  const body = `${loadText(first.load, ex.loadConvention, eq)}${NBSP}×${NBSP}${repRangeText(first.reps)}`;
  return held ? `Same target: ${body}` : `Target ${body}`;
}

/**
 * Where the compared workout was, never assumed to be today's gym (review r2
 * B1): its own gym's name, `, gym not recorded`, or nothing when the name
 * isn't known.
 */
function comparedGymText(comparedGymId: string | null, todayGymId: string | null, input: Pick<SummaryInput, 'gymName' | 'gymNames'>): string {
  if (comparedGymId === null) return ', gym not recorded';
  const name = input.gymNames?.[comparedGymId] ?? (comparedGymId === todayGymId ? input.gymName : null);
  return name ? ` at ${name}` : '';
}

/** Whether the rule's result belongs under `Next time` (workout-summary §2): changed, held for a listed reason, no load, or pain. */
function listedKind(t: NextTargets): NextTimeRow['kind'] | null {
  switch (t.decision) {
    case 'increase_load':
    case 'increase_reps':
    case 'reduce_load':
    case 'ceiling_reached':
      return 'change';
    case 'no_feasible_load':
      return 'no_load';
    case 'halted_pain':
      return 'pain';
    case 'hold_after_miss':
      // A miss below the range is always listed (build 108 F5): the hold is the rule's answer to it, not "same targets".
      return 'held';
    case 'hold':
      // Held because the session was incomplete or one side lagged; other holds aren't listed.
      return t.explanation.facts.some((f) => f.endsWith('; holding.') || f.includes('only when both sides do')) ? 'held' : null;
    case 'insufficient_data':
    case 'unsupported':
      return null;
  }
}

export function buildWorkoutSummary(input: SummaryInput): WorkoutSummary {
  const { aggregate: state, nowMs } = input;
  const s = state.session;
  const liveSets = state.sets.filter((x) => x.status !== 'deleted');
  const exercises = [...state.exercises].sort((a, b) => a.order - b.order);
  const volume = new Map(summariseVolume(state).map((v) => [v.sessionExerciseId, v]));

  const completed = liveSets.filter((x) => x.status === 'completed' && x.actual !== null);
  const warmupSets = completed.filter((x) => x.setType === 'warmup').length;
  const workingSets = [...volume.values()].reduce((n, v) => n + v.sets, 0);
  const skippedSets = liveSets.filter((x) => x.status === 'skipped' && isWork(x)).length;
  const exercisesWithSets = exercises.filter((e) => liveSets.some((x) => x.sessionExerciseId === e.id));
  // Parts of one exercise at two gyms count once.
  const roots = (list: readonly SessionExercise[]) => new Set(list.map((e) => partRootOf(state.exercises, e.id))).size;
  const exercisesDone = roots(exercisesWithSets.filter((e) => completed.some((x) => x.sessionExerciseId === e.id)));
  const activeMs = workoutDurationMs(state, nowMs);

  // An exercise done at two gyms is one row; each part's results name its gym (gym-switch GS6).
  const multiGym = gymRouteIds(s).length > 1;
  const blocks = new Map<string, SessionExercise[]>();
  for (const ex of exercisesWithSets) {
    const root = partRootOf(state.exercises, ex.id);
    blocks.set(root, [...(blocks.get(root) ?? []), ex]);
  }
  const exerciseRows = [...blocks.values()].map((parts) => {
    const first = parts[0] as SessionExercise;
    const partResults: string[] = [];
    // The units and conventions logged across the parts. When they differ (a kg→lb or
    // plates→stack switch), each part says its own, never the first part's (review B2).
    const blockDone = liveSets.filter((x) => parts.some((p) => p.id === x.sessionExerciseId) && x.status === 'completed' && x.actual !== null && isWork(x));
    const keys = new Set(blockDone.map((x) => loadKey(x.actual?.load ?? null)).filter((k): k is string => k !== null));
    const mixed = keys.size > 1;
    let n = 0;
    let skipped = 0;
    for (const ex of parts) {
      const eq = equipmentOf(state, ex);
      const own = liveSets.filter((x) => x.sessionExerciseId === ex.id).sort((a, b) => a.index - b.index);
      const done = own.filter((x) => x.status === 'completed' && x.actual !== null && isWork(x));
      n += volume.get(ex.id)?.sets ?? done.length;
      skipped += own.filter((x) => x.status === 'skipped').length;
      const partKeys = new Set(done.map((x) => loadKey(x.actual?.load ?? null)).filter((k): k is string => k !== null));
      const partLoad = done.find((x) => x.actual?.load && loadKey(x.actual.load) !== null)?.actual?.load ?? null;
      const partSuffix = mixed && partKeys.size === 1 && partLoad ? compactUnitWords(partLoad) : null;
      // Mixed, and this part's unit can't be said once: each set says its own load in full.
      const compact = !mixed || partSuffix !== null || partKeys.size === 0;
      const body = done
        // §2.13: a flagged set is listed with its words (`100 × 8 · spotted`); it still counts in sets and volume (AW8).
        .map((x) => (x.actual ? withExclusionWords(`${x.side === 'left' ? 'L ' : x.side === 'right' ? 'R ' : ''}${valuesText(x.actual, { convention: ex.loadConvention, measurement: ex.measurement, equipment: eq, compact })}`, x.exclusions) : ''))
        .join(' · ');
      const text = body === '' || partSuffix === null ? body : `${body}${NBSP}${partSuffix}`;
      if (text === '') continue;
      const gymId = eq?.gymId ?? null;
      const gym = multiGym && gymId !== null ? (input.gymNames?.[gymId] ?? (gymId === s.gymId ? input.gymName : null)) : null;
      partResults.push(gym ? `${text} (${gym})` : text);
    }
    const v = parts.length === 1 ? volume.get(first.id) : undefined;
    // One unit for the whole row: the one logged (else the row's); none when the parts differ.
    const shared = mixed ? null : (blockDone.find((x) => x.actual?.load && loadKey(x.actual.load) !== null)?.actual?.load ?? null);
    const unit = shared?.unit ?? first.unit;
    const convention = shared?.convention ?? first.loadConvention;
    const unitNote = mixed
      ? first.laterality === 'unilateral' ? ' (per side)' : ''
      : convention === 'per_hand' ? ` (${unit} each)` : convention === 'stack' ? ` (${unit} stack)` : first.laterality === 'unilateral' ? ' (per side)' : '';
    return {
      sessionExerciseId: first.id,
      exerciseId: first.exerciseId,
      name: first.exerciseName,
      setsText: `${String(n)} ${n === 1 ? 'set' : 'sets'}${unitNote}`,
      results: partResults.join(' · '),
      skipped,
      sides: v?.bySide && (v.bySide.left.reps !== v.bySide.right.reps) ? `L ${String(v.bySide.left.reps)} reps · R ${String(v.bySide.right.reps)} reps` : null,
    };
  });

  // An imported (FitNotes) workout is a history record: no comparison, highlight or `Next time`
  // of its own (a `Next time` read from it would talk about an old FitNotes date). A workout
  // logged in the app does compare with FitNotes history, labelled (B7).
  const imported = s.source === 'import';

  // Comparison: the first exercise in order with working sets today and comparable history.
  let comparison: WorkoutSummary['comparison'] = null;
  for (const ex of imported ? [] : exercises) {
    const todaySets = completed.filter((x) => x.sessionExerciseId === ex.id && isWork(x));
    if (todaySets.length === 0) continue;
    const eq = equipmentOf(state, ex);
    const others = (input.history[ex.exerciseId] ?? []).filter((h) => h.sessionId !== s.id && toMs(h.performedAtUtc) < toMs(s.startedAt.utc));
    const prev = lastComparableSession(others, ex);
    const direction = loadDirection(ex.loadConvention);
    // §2.13: compare the best set Ben didn't leave out, on both sides.
    const today = topOf(todaySets.filter((x) => isSetCountable(x, 'comparison')).map((x) => x.actual).filter((a): a is NonNullable<typeof a> => a !== null), direction);
    if (prev && today === null) {
      const top = topOf(todaySets.map((x) => ({ load: x.actual?.load ?? null, reps: x.actual?.reps ?? null, exclusions: x.exclusions })), direction);
      // Like the other not-compared cases: a later exercise that does compare still wins.
      comparison ??= { kind: 'not_comparable', text: notComparedText(top?.exclusions) };
      continue;
    }
    if (prev && today) {
      const countedPrev = prev.sets.filter((c) => isSetCountable(c, 'comparison'));
      if (countedPrev.length === 0) {
        const top = topOf(prev.sets.map((c) => ({ ...c.values, exclusions: c.exclusions })), direction);
        comparison ??= { kind: 'not_comparable', text: notComparedText(top?.exclusions) };
        continue;
      }
      const last = topOf(countedPrev.map((c) => c.values), direction);
      if (last) {
        comparison = {
          kind: 'compared',
          exerciseName: ex.exerciseName,
          todayText: valuesText(today, { convention: ex.loadConvention, measurement: ex.measurement, equipment: eq }),
          lastText: valuesText(last, { convention: ex.loadConvention, measurement: ex.measurement, equipment: eq }),
          lastAtUtc: prev.performedAtUtc,
          why: prev.imported ? 'FitNotes, working sets' : `Same ${eq ? eq.name : 'set-up'}${comparedGymText(prev.gymId, s.gymId, input)}, working sets`,
        };
        break;
      }
    }
    if (comparison === null) {
      comparison = others.length > 0 ? { kind: 'not_comparable', text: 'Not compared · different equipment' } : { kind: 'first_time', text: 'First time' };
    }
  }

  // Next time: the built-in rule (no coach in this build). One row per exercise block:
  // an exercise split across gyms is read from one deciding part, with the block's
  // set count, the same as Start next session (`nextTargetsForBlock`; review r2 B1).
  const rows: NextTimeRow[] = [];
  for (const block of imported ? [] : nextTargetBlocks(state)) {
    if (block.prescribedSets === 0) continue;
    const ex = block.decider;
    const eq = block.equipment;
    const gymId = eq?.gymId ?? null;
    const { result, rule } = nextTargetsForBlock(
      block,
      {
        ownerId: s.ownerId,
        sessionId: s.id,
        count: 'prescribed',
        exercise: input.exerciseInfo?.[ex.exerciseId] ?? null,
        rule: (block.root.progressionRuleId !== null ? input.rules[block.root.progressionRuleId] : undefined) ?? null,
        history: input.history[ex.exerciseId] ?? [],
        painFlags: input.painFlags,
        sessionPain: unspecifiedPain(input.checkIn),
      },
      gymId === null ? null : (input.gymNames?.[gymId] ?? (gymId === s.gymId ? input.gymName : null)),
    );
    const kind = listedKind(result);
    if (kind === null) continue;
    rows.push({
      exerciseId: ex.exerciseId,
      exerciseName: block.root.exerciseName,
      kind,
      target: nextTargetText(result, ex, eq, kind !== 'change' && (result.decision !== 'hold_after_miss' || sameAsPlanned(state, ex.id, result))),
      summary: result.explanation.summary,
      facts: result.explanation.facts,
      ruleName: rule.name,
      decision: result.decision,
    });
  }

  const ci = input.checkIn && input.checkIn.deletedAtUtc === undefined ? input.checkIn : null;
  const lastDone = completed.map((x) => x.completedAt?.utc ?? '').filter((u) => u !== '').sort().at(-1) ?? null;
  const firstDone = completed.map((x) => x.completedAt?.utc ?? '').filter((u) => u !== '').sort()[0] ?? null;
  const nowIso = toIso(nowMs);

  return {
    sessionId: s.id,
    sessionVersion: s.version,
    title: s.routineName ?? 'Workout',
    storedName: s.routineName,
    routineId: s.routineId,
    source: s.source,
    startedAtUtc: s.startedAt.utc,
    endedAtUtc: s.endedAt?.utc ?? null,
    tz: s.startedAt.tz,
    dateOnly: dateOnlyOf(s),
    gymName: gymLine(state, input),
    timingEdited: {
      start: state.timingAudit.some((e) => e.field === 'startedAt'),
      end: state.timingAudit.some((e) => e.field === 'endedAt'),
    },
    facts: { activeMs, activeText: activeMs === null ? null : formatMinutes(activeMs), exercisesDone, exercisesTotal: roots(exercisesWithSets), workingSets, skippedSets, warmupSets },
    checkIn: ci
      ? {
          checkInId: ci.id,
          scoreText: scoreText(ci.score),
          reasons: ci.reasons.length === 0 ? null : reasonsText(ci.reasons),
          note: ci.note ?? null,
          painNotFlagged: painMentionedNotFlagged(ci),
        }
      : null,
    comparison: workingSets === 0 ? null : comparison,
    exercises: exerciseRows,
    nextTime:
      workingSets === 0 || imported
        ? null
        : { sourceTag: BUILT_IN_SOURCE_TAG[input.coach], rows, emptyText: rows.length === 0 ? 'Same targets next time' : null },
    empty: workingSets === 0,
    highlight: workingSets === 0 || imported ? null : summaryHighlight(state, input.history),
    records: workingSets === 0 || imported ? [] : sessionRecords({ aggregate: state, gymName: input.gymName, ...(input.gymNames ? { gymNames: input.gymNames } : {}), history: input.history }),
    timingBounds: {
      startLatestUtc: firstDone ?? (s.endedAt?.utc ?? nowIso),
      endEarliestUtc: lastDone ?? s.startedAt.utc,
      endLatestUtc: nowIso,
    },
    lastCompletedAtUtc: lastDone,
  };
}

/** `kg|per_hand`; null for no load or bodyweight (nothing to label). */
function loadKey(load: Load | null): string | null {
  if (load === null || load.convention === 'bodyweight') return null;
  return `${load.unit}|${load.convention}`;
}

/** What follows a part's compact results when parts differ: `kg each`, `lb stack`, `kg`; null = say each load in full. */
function compactUnitWords(load: Load): string | null {
  switch (load.convention) {
    case 'total':
      return load.unit;
    case 'per_hand':
      return `${load.unit}${NBSP}each`;
    case 'stack':
      return `${load.unit}${NBSP}stack`;
    case 'added':
    case 'assistance':
    case 'bodyweight':
      return null;
  }
}
