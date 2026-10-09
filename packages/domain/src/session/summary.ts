import type { CheckIn, EquipmentInstance, PainFlag, ProgressionRule, SessionAggregate, SessionExercise, WorkoutSet } from '@fizz/schemas';
import { painMentionedNotFlagged, reasonsText, scoreText } from '../checkin';
import type { RuleExerciseInfo } from '../default-rule';
import { nextTargetsFor, unspecifiedPain } from '../next-target';
import { formatMinutes, loadText, NBSP, repRangeText, valuesText } from '../display';
import { loadDirection } from '../equipment';
import type { HistorySession, NextTargets } from '../progression';
import { toIso, toMs } from '../time';
import { lastComparableSession } from './active-view';
import { getActiveDurationMs } from './view';
import { summariseVolume } from './volume';

/**
 * `buildWorkoutSummary` (workout-summary.md §6). Pure and local: facts,
 * one like-for-like comparison, exercise rows, the check-in as Ben gave it,
 * and `Next time` from `calculateNextTargets`, every row tagged with its
 * source. The check-in is never read by the rules (check 24).
 */

export type CoachStatus = 'not_connected';

/** Source tag on every `Next time` row (ADR 0006). No AI in this build. */
export const BUILT_IN_SOURCE_TAG: Record<CoachStatus, string> = {
  not_connected: 'Built-in rule (coach not connected)',
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
  startedAtUtc: string;
  endedAtUtc: string | null;
  tz: string;
  gymName: string | null;
  timingEdited: { start: boolean; end: boolean };
  facts: { activeMs: number; activeText: string; exercisesDone: number; exercisesTotal: number; workingSets: number; skippedSets: number; warmupSets: number };
  checkIn: { checkInId: string; scoreText: string; reasons: string | null; note: string | null; painNotFlagged: boolean } | null;
  comparison:
    | { kind: 'compared'; exerciseName: string; todayText: string; lastText: string; lastAtUtc: string; why: string }
    | { kind: 'first_time'; text: string }
    | { kind: 'not_comparable'; text: string }
    | null;
  exercises: { sessionExerciseId: string; name: string; setsText: string; results: string; skipped: number; sides: string | null }[];
  nextTime: { sourceTag: string; rows: NextTimeRow[]; emptyText: string | null } | null;
  /** No working sets: the comparison and next-time sections are hidden; Discard is offered. */
  empty: boolean;
  /** Bounds for `Edit times` (`update_session_timing`). */
  timingBounds: { startLatestUtc: string; endEarliestUtc: string; endLatestUtc: string };
  lastCompletedAtUtc: string | null;
}

const isWork = (s: WorkoutSet) => s.setType !== 'warmup';

function equipmentOf(state: SessionAggregate, ex: SessionExercise): EquipmentInstance | null {
  return ex.equipmentId === null ? null : (state.session.equipmentSnapshot.find((e) => e.id === ex.equipmentId) ?? null);
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

function nextTargetText(t: NextTargets, ex: SessionExercise, eq: EquipmentInstance | null, held: boolean): string {
  const first = t.sets.find((s) => s.setType === 'working' || s.setType === 'top') ?? t.sets[0];
  if (!first) return 'No target';
  if (t.decision === 'no_feasible_load' || (first.load === null && ex.loadConvention !== 'bodyweight' && ex.loadConvention !== 'added')) {
    return `No load target · ${repRangeText(first.reps)}${NBSP}reps`;
  }
  const body = `${loadText(first.load, ex.loadConvention, eq)}${NBSP}×${NBSP}${repRangeText(first.reps)}`;
  return held ? `Same target: ${body}` : `Target ${body}`;
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
    case 'hold':
    case 'hold_after_miss':
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
  const exercisesDone = exercisesWithSets.filter((e) => completed.some((x) => x.sessionExerciseId === e.id)).length;
  const activeMs = getActiveDurationMs(state, nowMs);

  const exerciseRows = exercisesWithSets.map((ex) => {
    const eq = equipmentOf(state, ex);
    const own = liveSets.filter((x) => x.sessionExerciseId === ex.id).sort((a, b) => a.index - b.index);
    const done = own.filter((x) => x.status === 'completed' && x.actual !== null && isWork(x));
    const v = volume.get(ex.id);
    const unitNote = ex.loadConvention === 'per_hand' ? ` (${ex.unit} each)` : ex.loadConvention === 'stack' ? ` (${ex.unit} stack)` : ex.laterality === 'unilateral' ? ' (per side)' : '';
    const n = v?.sets ?? done.length;
    return {
      sessionExerciseId: ex.id,
      name: ex.exerciseName,
      setsText: `${String(n)} ${n === 1 ? 'set' : 'sets'}${unitNote}`,
      results: done
        .map((x) => (x.actual ? `${x.side === 'left' ? 'L ' : x.side === 'right' ? 'R ' : ''}${valuesText(x.actual, { convention: ex.loadConvention, measurement: ex.measurement, equipment: eq, compact: true })}` : ''))
        .join(' · '),
      skipped: own.filter((x) => x.status === 'skipped').length,
      sides: v?.bySide && (v.bySide.left.reps !== v.bySide.right.reps) ? `L ${String(v.bySide.left.reps)} reps · R ${String(v.bySide.right.reps)} reps` : null,
    };
  });

  // Comparison: the first exercise in order with working sets today and comparable history.
  let comparison: WorkoutSummary['comparison'] = null;
  for (const ex of exercises) {
    const todaySets = completed.filter((x) => x.sessionExerciseId === ex.id && isWork(x));
    if (todaySets.length === 0) continue;
    const eq = equipmentOf(state, ex);
    const others = (input.history[ex.exerciseId] ?? []).filter((h) => h.sessionId !== s.id && toMs(h.performedAtUtc) < toMs(s.startedAt.utc));
    const prev = lastComparableSession(others, ex);
    const direction = loadDirection(ex.loadConvention);
    const today = topOf(todaySets.map((x) => x.actual).filter((a): a is NonNullable<typeof a> => a !== null), direction);
    if (prev && today) {
      const last = topOf(prev.sets.map((c) => c.values), direction);
      if (last) {
        comparison = {
          kind: 'compared',
          exerciseName: ex.exerciseName,
          todayText: valuesText(today, { convention: ex.loadConvention, measurement: ex.measurement, equipment: eq }),
          lastText: valuesText(last, { convention: ex.loadConvention, measurement: ex.measurement, equipment: eq }),
          lastAtUtc: prev.performedAtUtc,
          why: `Same ${eq ? eq.name : 'set-up'}${input.gymName ? ` at ${input.gymName}` : ''}, working sets`,
        };
        break;
      }
    }
    if (comparison === null) {
      comparison =
        others.length > 0
          ? { kind: 'not_comparable', text: `Last ${ex.exerciseName} was with different equipment or units. Not compared.` }
          : { kind: 'first_time', text: `First time logging ${ex.exerciseName}${eq ? ` with ${eq.name}` : ''}${input.gymName ? ` at ${input.gymName}` : ''}. Nothing to compare yet.` };
    }
  }

  // Next time: the built-in rule (no coach in this build).
  const rows: NextTimeRow[] = [];
  for (const ex of exercises) {
    const own = liveSets.filter((x) => x.sessionExerciseId === ex.id && x.setType === 'working');
    if (own.length === 0 || !completed.some((x) => x.sessionExerciseId === ex.id)) continue;
    const eq = equipmentOf(state, ex);
    const { result, rule } = nextTargetsFor({
      ownerId: s.ownerId,
      exerciseId: ex.exerciseId,
      exerciseName: ex.exerciseName,
      measurement: ex.measurement,
      unit: ex.unit,
      convention: ex.loadConvention,
      equipment: eq,
      exercise: input.exerciseInfo?.[ex.exerciseId] ?? null,
      rule: (ex.progressionRuleId !== null ? input.rules[ex.progressionRuleId] : undefined) ?? null,
      workingSets: own.length,
      history: input.history[ex.exerciseId] ?? [],
      painFlags: input.painFlags,
      sessionPain: unspecifiedPain(input.checkIn),
    });
    const kind = listedKind(result);
    if (kind === null) continue;
    rows.push({
      exerciseId: ex.exerciseId,
      exerciseName: ex.exerciseName,
      kind,
      target: nextTargetText(result, ex, eq, kind !== 'change'),
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
    startedAtUtc: s.startedAt.utc,
    endedAtUtc: s.endedAt?.utc ?? null,
    tz: s.startedAt.tz,
    gymName: input.gymName,
    timingEdited: {
      start: state.timingAudit.some((e) => e.field === 'startedAt'),
      end: state.timingAudit.some((e) => e.field === 'endedAt'),
    },
    facts: { activeMs, activeText: formatMinutes(activeMs), exercisesDone, exercisesTotal: exercisesWithSets.length, workingSets, skippedSets, warmupSets },
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
      workingSets === 0
        ? null
        : { sourceTag: BUILT_IN_SOURCE_TAG[input.coach], rows, emptyText: rows.length === 0 ? 'No target changes. Same targets next time.' : null },
    empty: workingSets === 0,
    timingBounds: {
      startLatestUtc: firstDone ?? (s.endedAt?.utc ?? nowIso),
      endEarliestUtc: lastDone ?? s.startedAt.utc,
      endLatestUtc: nowIso,
    },
    lastCompletedAtUtc: lastDone,
  };
}
