import {
  SessionAggregateSchema,
  SessionPlanDaySchema,
  type SessionAggregate,
  type SessionExercise,
  type SetAuditEntry,
  type SessionTimingAuditEntry,
  type WorkoutSet,
  type ZonedTimestamp,
} from '@fizz/schemas';
import {
  planDeleteWorkouts,
  planRestoreWorkouts,
  type DeletionError,
  type DeletionPlan,
  type FencedResult,
  type SaveResult,
  type SessionRef,
  type SessionRepository,
  type AlongsideRefusal,
  type StartAlongside,
  type WorkoutsRequest,
  type WriteFence,
} from '@fizz/domain';
import { saveRoutineTemplateIn } from './documents';
import { saveVariationIn } from './plan-days';
import type { Database } from './database';
import type { SqlExecutor, SqlRow, SqlValue } from './driver';
import { CorruptDataError, HistoryRewriteError } from './errors';
import { bool, checkRead, checkWrite, inHistorySql, insert, int, mismatch, parseJson, parseJsonOrNull, rowId, upsert } from './sql';
import { startWorkoutDraftIn } from './workout-drafts';

const T = 'sessions';

/** Child tables of a session, in the order they are read. */
export const SESSION_TABLES = [
  'sessions',
  'session_pauses',
  'session_exercises',
  'session_sets',
  'rest_timers',
  'work_intervals',
  'set_audit',
  'timing_audit',
  'processed_operations',
] as const;

/**
 * A finished workout as the rotation reads it. `planDay` (v3 §4.2): the plan
 * day it was started as, when it was; Up next credits (planId, dayIndex),
 * and the newest one names the day's last-used template (Q2) and variation.
 */
export interface FinishedRefRow {
  sessionId: string;
  routineId: string | null;
  startedAtUtc: string;
  tz: string;
  planDay?: { planId: string; dayIndex: number; splitDayId: string; templateRoutineId: string | null; mainLiftExerciseId: string | null; variationId: string | null };
}

// ---------------------------------------------------------------------------
// Encoding (aggregate → rows)

const zonedOrNull = (z: ZonedTimestamp | null): [SqlValue, SqlValue] => (z === null ? [null, null] : [z.utc, z.tz]);

function sessionRow(a: SessionAggregate): Record<string, SqlValue> {
  const s = a.session;
  const [endedUtc, endedTz] = zonedOrNull(s.endedAt);
  return {
    id: s.id,
    owner_id: s.ownerId,
    routine_id: s.routineId,
    routine_name: s.routineName,
    gym_id: s.gymId,
    start_operation_id: s.startOperationId,
    status: s.status,
    source: s.source,
    started_at_utc: s.startedAt.utc,
    started_at_tz: s.startedAt.tz,
    ended_at_utc: endedUtc,
    ended_at_tz: endedTz,
    version: s.version,
    revision: a.revision,
    active_set_id: s.activeSetId,
    equipment_snapshot: JSON.stringify(s.equipmentSnapshot),
    paused_at_utc: s.pause?.pausedAtUtc ?? null,
    last_activity_at_utc: s.lastActivityAtUtc,
    check_in: s.checkIn === null ? null : JSON.stringify(s.checkIn),
    check_in_id: s.checkIn?.kind === 'answered' ? s.checkIn.checkInId : null,
    import_job_id: s.importJobId ?? null,
    local_date: s.localDate ?? null,
    finish_by_utc: s.finishBy?.utc ?? null,
    finish_by_tz: s.finishBy?.tz ?? null,
    gym_changes: s.gymChanges === undefined ? null : JSON.stringify(s.gymChanges),
    today_edits: s.todayEdits === undefined ? null : JSON.stringify(s.todayEdits),
    coach_draft: s.coachDraft === undefined ? null : JSON.stringify(s.coachDraft),
    // Only when set: the column is new in schema 30, and a plan day is written once, at Start.
    ...(s.planDay === undefined ? {} : { plan_day: JSON.stringify(s.planDay) }),
    duration_confirmed_at_utc: s.durationConfirmedAt?.utc ?? null,
    duration_confirmed_at_tz: s.durationConfirmedAt?.tz ?? null,
    deleted_at_utc: s.deletion?.at.utc ?? null,
    deleted_at_tz: s.deletion?.at.tz ?? null,
    deleted_by_op_id: s.deletion?.opId ?? null,
    purge_after_utc: s.deletion?.purgeAfterUtc ?? null,
  };
}

function exerciseRow(e: SessionExercise, ordinal: number): Record<string, SqlValue> {
  return {
    id: e.id,
    session_id: e.sessionId,
    ordinal,
    exercise_id: e.exerciseId,
    exercise_name: e.exerciseName,
    // Schema 10: the measurement CHECK predates distance; a distance row is `reps` + `measures_distance`.
    // Schema 20: likewise a cardio row is `duration` + `measures_cardio`.
    measurement: e.measurement === 'distance' ? 'reps' : e.measurement === 'cardio' ? 'duration' : e.measurement,
    measures_distance: e.measurement === 'distance' ? 1 : null,
    measures_cardio: e.measurement === 'cardio' ? 1 : null,
    laterality: e.laterality,
    equipment_id: e.equipmentId,
    load_convention: e.loadConvention,
    unit: e.unit,
    sort_order: e.order,
    superset_group: e.supersetGroup,
    round_offset: e.roundOffset ?? null,
    transition_rest_s: e.transitionRestS,
    progression_rule_id: e.progressionRuleId,
    continues_from_id: e.continuesFromId ?? null,
    equipment_version: e.equipmentVersion ?? null,
    note: e.note ?? null,
    removed: e.removed === undefined ? null : JSON.stringify(e.removed),
    swapped_from: e.swappedFrom === undefined ? null : JSON.stringify(e.swappedFrom),
  };
}

function setRow(s: WorkoutSet, ordinal: number): Record<string, SqlValue> {
  const a = s.actual;
  const [completedUtc, completedTz] = zonedOrNull(s.completedAt);
  return {
    id: s.id,
    session_id: s.sessionId,
    session_exercise_id: s.sessionExerciseId,
    ordinal,
    set_index: s.index,
    set_type: s.setType,
    status: s.status,
    side: s.side,
    paired_with_set_id: s.pairedWithSetId,
    planned: JSON.stringify(s.planned),
    rest: JSON.stringify(s.rest),
    has_actual: int(a !== null),
    actual_load_value: a?.load?.value ?? null,
    actual_load_unit: a?.load?.unit ?? null,
    actual_load_convention: a?.load?.convention ?? null,
    actual_reps: a?.reps ?? null,
    actual_duration_s: a?.durationS ?? null,
    actual_distance_m: a?.distanceM ?? null,
    actual_rpe: a?.rpe ?? null,
    actual_rir: a?.rir ?? null,
    draft: s.draft === null ? null : JSON.stringify(s.draft),
    completed_at_utc: completedUtc,
    completed_at_tz: completedTz,
    completed_by_op_id: s.completedByOpId,
    undo_count: s.undoCount,
    flags: JSON.stringify(s.flags),
    // §2.13: NULL = the set counts (as for every set saved before schema 4).
    exclusions: s.exclusions && s.exclusions.length > 0 ? JSON.stringify(s.exclusions) : null,
    skipped_by: s.skippedBy ?? null,
    note: s.note ?? null,
    edited: int(s.edited),
    version: s.version,
  };
}

function auditRow(e: SetAuditEntry, ordinal: number): Record<string, SqlValue> {
  return {
    session_id: e.sessionId,
    ordinal,
    id: e.id,
    set_id: e.setId,
    op_id: e.opId,
    kind: e.kind,
    at_utc: e.atUtc,
    before: e.before === null ? null : JSON.stringify(e.before),
    after: e.after === null ? null : JSON.stringify(e.after),
  };
}

function timingRow(e: SessionTimingAuditEntry, ordinal: number): Record<string, SqlValue> {
  const [beforeUtc, beforeTz] = zonedOrNull(e.before);
  return {
    session_id: e.sessionId,
    ordinal,
    id: e.id,
    op_id: e.opId,
    field: e.field,
    source: e.source,
    at_utc: e.atUtc,
    before_utc: beforeUtc,
    before_tz: beforeTz,
    after_utc: e.after.utc,
    after_tz: e.after.tz,
  };
}

// ---------------------------------------------------------------------------
// Decoding (rows → aggregate). Values are passed through as stored; the
// aggregate schema then rejects anything wrong. Nothing is coerced or defaulted.

const zoned = (utc: SqlValue | undefined, tz: SqlValue | undefined): unknown => (utc === null && tz === null ? null : { utc, tz });

/** `exclusions` is optional on a set: NULL (every set before schema 4) reads as absent, anything else is validated by the schema. */
const exclusionsOf = (value: unknown): { exclusions?: unknown } => (value === null ? {} : { exclusions: value });

/** Append-only children must have ordinals 0..n-1; a gap means a lost row. */
function assertContiguous(table: string, sessionId: string, rows: readonly SqlRow[]): void {
  rows.forEach((r, i) => {
    if (r.ordinal !== i) throw mismatch(table, sessionId, 'ordinal', `Expected ordinal ${i}, found ${String(r.ordinal)} (missing or extra row)`);
  });
}

/** Read and validate one session aggregate with an executor (inside an existing queue slot). */
export async function readAggregate(q: SqlExecutor, sessionId: string): Promise<SessionAggregate | null> {
  const s = await q.getFirst('SELECT * FROM sessions WHERE id = ?', [sessionId]);
  if (!s) return null;
  const id = rowId(s.id);
  const by = (table: string, order: string) => q.getAll(`SELECT * FROM ${table} WHERE session_id = ? ORDER BY ${order}`, [sessionId]);
  const pauses = await by('session_pauses', 'ordinal');
  const exercises = await by('session_exercises', 'ordinal, id');
  const sets = await by('session_sets', 'ordinal, id');
  const timer = await q.getFirst('SELECT * FROM rest_timers WHERE session_id = ?', [sessionId]);
  const work = await q.getFirst('SELECT * FROM work_intervals WHERE session_id = ?', [sessionId]);
  const audit = await by('set_audit', 'ordinal');
  const timing = await by('timing_audit', 'ordinal');
  const ops = await by('processed_operations', 'ordinal');
  assertContiguous('session_pauses', id, pauses);
  assertContiguous('set_audit', id, audit);
  assertContiguous('timing_audit', id, timing);
  assertContiguous('processed_operations', id, ops);

  const raw = {
    session: {
      id: s.id,
      ownerId: s.owner_id,
      routineId: s.routine_id,
      routineName: s.routine_name,
      gymId: s.gym_id,
      startOperationId: s.start_operation_id,
      status: s.status,
      source: s.source,
      // Absent rather than null (optional fields); a wrong type still fails validation.
      ...(s.import_job_id === null || s.import_job_id === undefined ? {} : { importJobId: s.import_job_id }),
      ...(s.local_date === null || s.local_date === undefined ? {} : { localDate: s.local_date }),
      ...(s.gym_changes === null || s.gym_changes === undefined ? {} : { gymChanges: parseJson(T, id, 'gym_changes', s.gym_changes) }),
      startedAt: { utc: s.started_at_utc, tz: s.started_at_tz },
      endedAt: zoned(s.ended_at_utc, s.ended_at_tz),
      version: s.version,
      activeSetId: s.active_set_id,
      equipmentSnapshot: parseJson(T, id, 'equipment_snapshot', s.equipment_snapshot ?? null),
      pause: s.paused_at_utc === null ? null : { pausedAtUtc: s.paused_at_utc },
      pauses: pauses.map((p) => ({ startUtc: p.start_utc, endUtc: p.end_utc })),
      lastActivityAtUtc: s.last_activity_at_utc,
      checkIn: parseJsonOrNull(T, id, 'check_in', s.check_in ?? null),
      ...(s.finish_by_utc === null || s.finish_by_utc === undefined ? {} : { finishBy: { utc: s.finish_by_utc, tz: s.finish_by_tz } }),
      ...(s.today_edits === null || s.today_edits === undefined ? {} : { todayEdits: parseJson(T, id, 'today_edits', s.today_edits) }),
      ...(s.coach_draft === null || s.coach_draft === undefined ? {} : { coachDraft: parseJson(T, id, 'coach_draft', s.coach_draft) }),
      ...(s.plan_day === null || s.plan_day === undefined ? {} : { planDay: parseJson(T, id, 'plan_day', s.plan_day) }),
      ...(s.duration_confirmed_at_utc === null || s.duration_confirmed_at_utc === undefined
        ? {}
        : { durationConfirmedAt: { utc: s.duration_confirmed_at_utc, tz: s.duration_confirmed_at_tz } }),
      ...(s.deleted_at_utc === null || s.deleted_at_utc === undefined
        ? {}
        : { deletion: { at: { utc: s.deleted_at_utc, tz: s.deleted_at_tz }, opId: s.deleted_by_op_id, purgeAfterUtc: s.purge_after_utc } }),
    },
    exercises: exercises.map((e) => ({
      id: e.id,
      sessionId: e.session_id,
      exerciseId: e.exercise_id,
      exerciseName: e.exercise_name,
      measurement: e.measures_distance === 1 ? 'distance' : e.measures_cardio === 1 ? 'cardio' : e.measurement,
      laterality: e.laterality,
      equipmentId: e.equipment_id,
      loadConvention: e.load_convention,
      unit: e.unit,
      order: e.sort_order,
      supersetGroup: e.superset_group,
      transitionRestS: e.transition_rest_s,
      progressionRuleId: e.progression_rule_id,
      // Absent rather than null (optional fields); a wrong type still fails validation.
      ...(e.continues_from_id === null || e.continues_from_id === undefined ? {} : { continuesFromId: e.continues_from_id }),
      ...(e.equipment_version === null || e.equipment_version === undefined ? {} : { equipmentVersion: e.equipment_version }),
      ...(e.round_offset === null || e.round_offset === undefined ? {} : { roundOffset: e.round_offset }),
      ...(e.note === null || e.note === undefined ? {} : { note: e.note }),
      ...(e.removed === null || e.removed === undefined ? {} : { removed: parseJson('session_exercises', rowId(e.id), 'removed', e.removed) }),
      ...(e.swapped_from === null || e.swapped_from === undefined ? {} : { swappedFrom: parseJson('session_exercises', rowId(e.id), 'swapped_from', e.swapped_from) }),
    })),
    sets: sets.map((x) => {
      const sid = rowId(x.id);
      return {
        id: x.id,
        sessionId: x.session_id,
        sessionExerciseId: x.session_exercise_id,
        index: x.set_index,
        setType: x.set_type,
        status: x.status,
        side: x.side,
        pairedWithSetId: x.paired_with_set_id,
        planned: parseJson('session_sets', sid, 'planned', x.planned ?? null),
        rest: parseJson('session_sets', sid, 'rest', x.rest ?? null),
        actual:
          x.has_actual === 1
            ? {
                load:
                  x.actual_load_value === null
                    ? null
                    : { value: x.actual_load_value, unit: x.actual_load_unit, convention: x.actual_load_convention },
                reps: x.actual_reps,
                durationS: x.actual_duration_s,
                rpe: x.actual_rpe,
                rir: x.actual_rir,
                ...(x.actual_distance_m === null || x.actual_distance_m === undefined ? {} : { distanceM: x.actual_distance_m }),
              }
            : x.has_actual === 0
              ? null
              : x.has_actual,
        draft: parseJsonOrNull('session_sets', sid, 'draft', x.draft ?? null),
        completedAt: zoned(x.completed_at_utc, x.completed_at_tz),
        completedByOpId: x.completed_by_op_id,
        undoCount: x.undo_count,
        flags: parseJson('session_sets', sid, 'flags', x.flags ?? null),
        ...exclusionsOf(parseJsonOrNull('session_sets', sid, 'exclusions', x.exclusions ?? null)),
        ...(x.skipped_by === null || x.skipped_by === undefined ? {} : { skippedBy: x.skipped_by }),
        ...(x.note === null || x.note === undefined ? {} : { note: x.note }),
        edited: bool(x.edited ?? null),
        version: x.version,
      };
    }),
    restTimer:
      timer === null
        ? null
        : {
            id: timer.id,
            sessionId: timer.session_id,
            setId: timer.set_id,
            kind: timer.kind,
            durationS: timer.duration_s,
            source: timer.source,
            startedAtUtc: timer.started_at_utc,
            deadlineUtc: timer.deadline_utc,
            status: timer.status,
            remainingMsAtPause: timer.remaining_ms_at_pause,
            endedAtUtc: timer.ended_at_utc,
            version: timer.version,
            ...(timer.resume_on_undo === null || timer.resume_on_undo === undefined
              ? {}
              : { resumeOnUndo: parseJson('rest_timers', id, 'resume_on_undo', timer.resume_on_undo) }),
            ...(timer.restored_finished === 1 ? { restoredFinished: true as const } : {}),
          },
    workInterval:
      work === null
        ? null
        : {
            setId: work.set_id,
            durationS: work.duration_s,
            startedAtUtc: work.started_at_utc,
            deadlineUtc: work.deadline_utc,
            status: work.status,
            remainingMsAtPause: work.remaining_ms_at_pause,
            pausedMs: work.paused_ms,
            endedAtUtc: work.ended_at_utc,
          },
    audit: audit.map((e) => ({
      id: e.id,
      sessionId: e.session_id,
      setId: e.set_id,
      opId: e.op_id,
      kind: e.kind,
      atUtc: e.at_utc,
      before: parseJsonOrNull('set_audit', rowId(e.id), 'before', e.before ?? null),
      after: parseJsonOrNull('set_audit', rowId(e.id), 'after', e.after ?? null),
    })),
    timingAudit: timing.map((e) => ({
      id: e.id,
      sessionId: e.session_id,
      opId: e.op_id,
      field: e.field,
      source: e.source,
      atUtc: e.at_utc,
      before: zoned(e.before_utc, e.before_tz),
      after: { utc: e.after_utc, tz: e.after_tz },
    })),
    processedOps: Object.fromEntries(
      ops.map((o) => {
        const createdIds = parseJsonOrNull('processed_operations', rowId(o.op_id), 'created_ids', o.created_ids ?? null);
        return [
          rowId(o.op_id),
          {
            opId: o.op_id,
            commandType: o.command_type,
            fingerprint: o.fingerprint,
            atUtc: o.at_utc,
            ...(createdIds === null ? {} : { createdIds }),
          },
        ];
      }),
    ),
    revision: s.revision,
  };
  const aggregate = checkRead(SessionAggregateSchema, raw, T, id);
  const linked = aggregate.session.checkIn?.kind === 'answered' ? aggregate.session.checkIn.checkInId : null;
  if ((s.check_in_id ?? null) !== linked) throw mismatch(T, id, 'check_in_id', `Column says ${String(s.check_in_id)}, check_in says ${String(linked)}`);
  if ((aggregate.session.status === 'deleted') !== (aggregate.session.deletion !== undefined)) throw mismatch(T, id, 'deleted_at_utc', 'A deleted workout must have its deletion record, and only a deleted one');
  assertReferences(aggregate);
  return aggregate;
}

/** References inside one aggregate must resolve; the schema can't see these. */
function assertReferences(a: SessionAggregate): void {
  const issues: { path: string; message: string }[] = [];
  const exerciseIds = new Set(a.exercises.map((e) => e.id));
  const setIds = new Set(a.sets.map((s) => s.id));
  a.exercises.forEach((e, i) => {
    if (e.continuesFromId !== undefined && !exerciseIds.has(e.continuesFromId)) issues.push({ path: `exercises.${i}.continuesFromId`, message: 'No such session exercise' });
  });
  a.sets.forEach((s, i) => {
    if (!exerciseIds.has(s.sessionExerciseId)) issues.push({ path: `sets.${i}.sessionExerciseId`, message: 'No such session exercise' });
    if (s.pairedWithSetId !== null && !setIds.has(s.pairedWithSetId)) issues.push({ path: `sets.${i}.pairedWithSetId`, message: 'No such set' });
  });
  if (a.session.activeSetId !== null && !setIds.has(a.session.activeSetId)) issues.push({ path: 'session.activeSetId', message: 'No such set' });
  if (a.restTimer && !setIds.has(a.restTimer.setId)) issues.push({ path: 'restTimer.setId', message: 'No such set' });
  if (a.workInterval && !setIds.has(a.workInterval.setId)) issues.push({ path: 'workInterval.setId', message: 'No such set' });
  if (issues.length > 0) throw new CorruptDataError(T, a.session.id, issues);
}

// ---------------------------------------------------------------------------
// Writing

async function storedIds(tx: SqlExecutor, table: string, column: string, sessionId: string): Promise<SqlValue[]> {
  const rows = await tx.getAll(`SELECT ${column} AS v FROM ${table} WHERE session_id = ? ORDER BY ordinal`, [sessionId]);
  return rows.map((r) => r.v ?? null);
}

/** Every stored row of an append-only list must still be first, in the same order. */
async function appendOnly<T>(
  tx: SqlExecutor,
  sessionId: string,
  table: string,
  items: readonly T[],
  key: (item: T) => SqlValue,
  row: (item: T, ordinal: number) => Record<string, SqlValue>,
): Promise<void> {
  const stored = await storedIds(tx, table, 'id', sessionId);
  if (stored.length > items.length) throw new HistoryRewriteError(sessionId, `${table}: ${stored.length - items.length} stored entries are missing`);
  stored.forEach((id, i) => {
    const item = items[i];
    if (item === undefined || key(item) !== id) throw new HistoryRewriteError(sessionId, `${table}: entry ${i} was changed or reordered`);
  });
  for (let i = stored.length; i < items.length; i += 1) {
    const item = items[i];
    if (item !== undefined) await insert(tx, table, row(item, i));
  }
}

/** Upsert rows that may change but are never removed (exercises, sets). */
async function upsertChildren<T extends { id: string }>(
  tx: SqlExecutor,
  sessionId: string,
  table: string,
  items: readonly T[],
  rowOf: (item: T, ordinal: number) => Record<string, SqlValue>,
): Promise<void> {
  const stored = (await tx.getAll(`SELECT id FROM ${table} WHERE session_id = ?`, [sessionId])).map((r) => r.id);
  const incoming = new Set<SqlValue | undefined>(items.map((x) => x.id));
  for (const id of stored) {
    if (!incoming.has(id)) throw new HistoryRewriteError(sessionId, `${table}: row ${String(id)} would be removed`);
  }
  for (const [i, item] of items.entries()) {
    const r = await upsert(tx, table, ['id'], rowOf(item, i), `${table}.session_id = excluded.session_id`);
    if (r.changes !== 1) throw new HistoryRewriteError(sessionId, `${table}: row ${item.id} belongs to another session`);
  }
}

const FENCE_SQL: Record<WriteFence['rows'][number]['table'], string> = {
  routines: 'SELECT version AS v FROM routines WHERE id = ?',
  check_ins: 'SELECT version AS v FROM check_ins WHERE id = ?',
  profiles: 'SELECT version AS v FROM profiles WHERE id = ?',
  sessions: 'SELECT revision AS v FROM sessions WHERE id = ?',
  // Only an open draft can be consumed: a discarded, consumed or expired one reads as changed.
  pre_start_drafts: "SELECT version AS v FROM pre_start_drafts WHERE id = ? AND status = 'open'",
  // A coach draft (workout-builder §6.3): a new version, a discard or a start since the page loaded moves it.
  workout_drafts: "SELECT version AS v FROM workout_drafts WHERE id = ? AND status = 'open'",
};

/**
 * Whether every input a write was planned from is unchanged, read inside the
 * write's own transaction (workout-overview §7). The SQL is fixed above; the
 * caller supplies only IDs and versions.
 */
export async function fenceHolds(tx: SqlExecutor, fence: WriteFence): Promise<boolean> {
  for (const row of fence.rows) {
    const found = await tx.getFirst<{ v: number }>(FENCE_SQL[row.table], [row.id]);
    if ((found?.v ?? null) !== row.version) return false;
  }
  for (const set of fence.sets) {
    const rows =
      set.kind === 'gym_equipment'
        ? await tx.getAll<{ id: string; version: number }>('SELECT id, version FROM equipment WHERE gym_id = ?', [set.gymId])
        : set.kind === 'active_pain_flags'
          ? await tx.getAll<{ id: string; version: number }>("SELECT id, version FROM pain_flags WHERE owner_id = ? AND status = 'active'", [set.ownerId])
          : await tx.getAll<{ id: string; version: number }>('SELECT id, version FROM next_session_targets WHERE owner_id = ? AND source_session_id = ?', [set.ownerId, set.sourceSessionId]);
    if (rows.length !== set.members.length) return false;
    const want = new Map(set.members.map((m) => [m.id, m.version]));
    if (rows.some((r) => want.get(r.id) !== r.version)) return false;
  }
  return true;
}

/**
 * A new session closes the owner's open pre-start drafts in its own
 * transaction (ADR 0022 §3), so no start path can forget them: the draft it
 * was started from (`session.todayEdits.draftId`) becomes `consumed` with
 * the session's ID, and every other open draft becomes `discarded`. An
 * imported (finished) workout leaves them alone. False
 * (nothing written): the draft it names is no longer open, or its midnight
 * has passed by the session's start (TE5): the caller reports it stale.
 */
async function closeDraftsOnStart(tx: SqlExecutor, a: SessionAggregate): Promise<boolean> {
  // Only a workout being started closes drafts (an imported, finished workout doesn't).
  if (a.session.status !== 'active') return true;
  const owner = a.session.ownerId;
  const startedAt = a.session.startedAt.utc;
  const at = a.session.lastActivityAtUtc;
  // A coach draft it starts from becomes `started` with this session (workout-builder §6.3); one closed since: stale.
  const coach = a.session.coachDraft;
  if (coach !== undefined && !(await startWorkoutDraftIn(tx, coach.draftId, owner, a.session.id, startedAt)).ok) return false;
  const from = a.session.todayEdits?.draftId ?? null;
  if (from !== null) {
    const row = await tx.getFirst<{ status: string; owner_id: string; expires_at_utc: string; version: number }>('SELECT status, owner_id, expires_at_utc, version FROM pre_start_drafts WHERE id = ?', [from]);
    if (row?.status !== 'open' || row.owner_id !== owner || row.version !== a.session.todayEdits?.draftVersion || row.expires_at_utc <= startedAt) return false;
    await tx.run(
      `UPDATE pre_start_drafts SET status = 'consumed', version = version + 1, updated_at_utc = ?,
         data = json_set(data, '$.status', 'consumed', '$.sessionId', ?, '$.version', version + 1, '$.updatedAtUtc', ?, '$.updatedAt.utc', ?)
       WHERE id = ?`,
      [at, a.session.id, at, at, from],
    );
  }
  await tx.run(
    `UPDATE pre_start_drafts SET status = 'discarded', version = version + 1, updated_at_utc = ?,
       data = json_set(data, '$.status', 'discarded', '$.version', version + 1, '$.updatedAtUtc', ?, '$.updatedAt.utc', ?)
     WHERE owner_id = ? AND status = 'open'`,
    [at, at, at, owner],
  );
  return true;
}

/** Thrown inside a session create to roll back an alongside write that was refused. */
class AlongsideRefused extends Error {
  constructor(readonly reason: AlongsideRefusal) {
    super(`alongside write refused: ${reason}`);
  }
}

/** A Start's template or variation write (§4.6), checked against the rows as stored. Null = written. */
async function alongsideIn(tx: SqlExecutor, ownerId: string, a: StartAlongside): Promise<AlongsideRefusal | null> {
  if (a.template !== undefined) {
    if (a.template.next.ownerId !== ownerId) return 'template_changed';
    const r = await saveRoutineTemplateIn(tx, a.template.next, a.template.expectedVersion, { split: a.template.split, mainLifts: a.template.mainLifts });
    if (!r.ok) return 'template_changed';
  }
  if (a.variation !== undefined) {
    const r = await saveVariationIn(tx, ownerId, a.variation.next, a.variation.expectedVersion, a.opId);
    switch (r.status) {
      case 'written':
      case 'replayed':
        break;
      case 'limit':
        return 'variation_limit';
      case 'duplicate_label':
        return 'variation_label';
      case 'stale':
      case 'invalid':
        return 'variation_changed';
    }
  }
  return null;
}

/** Write a validated aggregate inside the caller's transaction (append-only checks included). */
export async function writeAggregate(tx: SqlExecutor, a: SessionAggregate): Promise<void> {
  const sid = a.session.id;
  const sessionUpdate = await upsert(
    tx,
    'sessions',
    ['id'],
    sessionRow(a),
    'sessions.owner_id = excluded.owner_id AND sessions.start_operation_id = excluded.start_operation_id',
  );
  if (sessionUpdate.changes !== 1) throw new HistoryRewriteError(sid, 'owner or start operation changed');

  // Exercises and sets are never removed (sets are tombstoned), only added or updated.
  await upsertChildren(tx, sid, 'session_exercises', a.exercises, exerciseRow);
  await upsertChildren(tx, sid, 'session_sets', a.sets, setRow);

  await tx.run('DELETE FROM rest_timers WHERE session_id = ?', [sid]);
  const t = a.restTimer;
  if (t) {
    await insert(tx, 'rest_timers', {
      session_id: sid,
      id: t.id,
      set_id: t.setId,
      kind: t.kind,
      duration_s: t.durationS,
      source: t.source,
      started_at_utc: t.startedAtUtc,
      deadline_utc: t.deadlineUtc,
      status: t.status,
      remaining_ms_at_pause: t.remainingMsAtPause,
      ended_at_utc: t.endedAtUtc,
      version: t.version,
      // Only when there is one (column from migration 31), as for other later columns.
      ...(t.resumeOnUndo === undefined ? {} : { resume_on_undo: JSON.stringify(t.resumeOnUndo) }),
      ...(t.restoredFinished === true ? { restored_finished: 1 } : {}),
    });
  }
  await tx.run('DELETE FROM work_intervals WHERE session_id = ?', [sid]);
  const w = a.workInterval;
  if (w) {
    await insert(tx, 'work_intervals', {
      session_id: sid,
      set_id: w.setId,
      duration_s: w.durationS,
      started_at_utc: w.startedAtUtc,
      deadline_utc: w.deadlineUtc,
      status: w.status,
      remaining_ms_at_pause: w.remainingMsAtPause,
      paused_ms: w.pausedMs,
      ended_at_utc: w.endedAtUtc,
    });
  }

  // Pauses have no ID: compare stored values with the same positions.
  const pauses = await tx.getAll('SELECT start_utc, end_utc FROM session_pauses WHERE session_id = ? ORDER BY ordinal', [sid]);
  if (pauses.length > a.session.pauses.length) throw new HistoryRewriteError(sid, 'session_pauses: stored pauses are missing');
  pauses.forEach((p, i) => {
    const next = a.session.pauses[i];
    if (next === undefined || next.startUtc !== p.start_utc || next.endUtc !== p.end_utc) throw new HistoryRewriteError(sid, `session_pauses: pause ${i} was changed`);
  });
  for (let i = pauses.length; i < a.session.pauses.length; i += 1) {
    const p = a.session.pauses[i];
    if (p) await insert(tx, 'session_pauses', { session_id: sid, ordinal: i, start_utc: p.startUtc, end_utc: p.endUtc });
  }

  await appendOnly(tx, sid, 'set_audit', a.audit, (e) => e.id, auditRow);
  await appendOnly(tx, sid, 'timing_audit', a.timingAudit, (e) => e.id, timingRow);

  // Processed operations: a record, so compare as a set; new ones are appended in key order.
  const storedOps = new Set(await storedIds(tx, 'processed_operations', 'op_id', sid));
  for (const opId of storedOps) {
    if (typeof opId !== 'string' || !(opId in a.processedOps)) throw new HistoryRewriteError(sid, `processed_operations: ${String(opId)} would be removed`);
  }
  let ordinal = storedOps.size;
  for (const op of Object.values(a.processedOps)) {
    if (storedOps.has(op.opId)) continue;
    await insert(tx, 'processed_operations', {
      session_id: sid,
      op_id: op.opId,
      ordinal: ordinal++,
      command_type: op.commandType,
      fingerprint: op.fingerprint,
      at_utc: op.atUtc,
      created_ids: op.createdIds === undefined ? null : JSON.stringify(op.createdIds),
    });
  }
}

export type DeletionOutcome = { ok: true; duplicate: boolean; refs: SessionRef[] } | { ok: false; error: DeletionError };
export type PurgeOutcome = { ok: true; duplicate: boolean; purged: string[] } | { ok: false; error: { code: 'stale'; sessionIds: string[] } };

/** Rows of a session outside its aggregate tables that the purge removes with it. */
const PURGED_CHILD_TABLES = ['set_audit', 'timing_audit', 'processed_operations', 'session_pauses', 'rest_timers', 'work_intervals', 'session_sets', 'session_exercises', 'import_rows', 'coach_offers'] as const;

/**
 * One workout's purge, inside the caller's transaction: the tombstone first
 * (the delete triggers allow a session's rows to go only once it exists),
 * then its rows, its linked check-in and its import rows. Pain flags,
 * memories, coach conversations and next-session targets stay (DW-D6).
 */
async function purgeOne(tx: SqlExecutor, sessionId: string, opId: string, atUtc: string): Promise<void> {
  const s = await tx.getFirst<{ check_in_id: string | null }>("SELECT check_in_id FROM sessions WHERE id = ? AND status = 'deleted'", [sessionId]);
  if (!s) throw new Error(`Session ${sessionId} isn't deleted`);
  await tx.run(
    `INSERT INTO purged_sessions (session_id, owner_id, deleted_at_utc, purged_at_utc, purge_op_id, import_job_id, local_date)
     SELECT id, owner_id, deleted_at_utc, ?, ?, import_job_id, CASE WHEN import_job_id IS NULL THEN NULL ELSE local_date END FROM sessions WHERE id = ?`,
    [atUtc, opId, sessionId],
  );
  for (const table of PURGED_CHILD_TABLES) await tx.run(`DELETE FROM ${table} WHERE session_id = ?`, [sessionId]);
  await tx.run('DELETE FROM sessions WHERE id = ?', [sessionId]);
  if (s.check_in_id !== null) await tx.run('DELETE FROM check_ins WHERE id = ?', [s.check_in_id]);
}

export class SqliteSessions implements SessionRepository {
  constructor(private readonly db: Database) {}

  get(sessionId: string): Promise<SessionAggregate | null> {
    return this.db.read((q) => readAggregate(q, sessionId));
  }

  getActive(ownerId: string): Promise<SessionAggregate | null> {
    return this.db.read(async (q) => {
      const row = await q.getFirst<{ id: string }>("SELECT id FROM sessions WHERE owner_id = ? AND status = 'active'", [ownerId]);
      return row ? readAggregate(q, row.id) : null;
    });
  }

  findByStartOperation(ownerId: string, opId: string): Promise<SessionAggregate | null> {
    return this.db.read(async (q) => {
      const row = await q.getFirst<{ id: string }>('SELECT id FROM sessions WHERE owner_id = ? AND start_operation_id = ?', [ownerId, opId]);
      return row ? readAggregate(q, row.id) : null;
    });
  }

  save(aggregate: SessionAggregate, expectedRevision: number | null, fence?: WriteFence, alongside?: StartAlongside): Promise<SaveResult | FencedResult> {
    const write = this.db.write(async (tx): Promise<SaveResult | FencedResult> => {
      const valid = checkWrite(SessionAggregateSchema, aggregate, T, aggregate.session.id);
      if (fence && !(await fenceHolds(tx, fence))) return { ok: false, error: 'stale_inputs' };
      const current = await tx.getFirst<{ revision: number }>('SELECT revision FROM sessions WHERE id = ?', [valid.session.id]);
      const currentRevision = current?.revision ?? null;
      if (currentRevision !== expectedRevision) return { ok: false, error: 'conflict', currentVersion: currentRevision };
      if (expectedRevision === null && !(await closeDraftsOnStart(tx, valid))) return { ok: false, error: 'stale_inputs' };
      // (Builder v3 §4.6) The template or variation write and the session are one transaction under one
      // op ID: a refusal rolls back everything above too (the draft stays open).
      if (alongside !== undefined && expectedRevision === null) {
        const refused = await alongsideIn(tx, valid.session.ownerId, alongside);
        if (refused !== null) throw new AlongsideRefused(refused);
      }
      await writeAggregate(tx, valid);
      return { ok: true, version: valid.revision };
    });
    return write.catch((e: unknown) => {
      if (e instanceof AlongsideRefused) return { ok: false, error: 'stale_inputs', alongside: e.reason } as const;
      throw e;
    });
  }

  /** Finished sessions of `ownerId` that include `exerciseId`, oldest first. */
  listFinishedWithExercise(ownerId: string, exerciseId: string): Promise<SessionAggregate[]> {
    return this.db.read(async (q) => {
      const rows = await q.getAll<{ id: string }>(
        `SELECT DISTINCT s.id AS id, s.started_at_utc FROM sessions s JOIN session_exercises e ON e.session_id = s.id
         WHERE s.owner_id = ? AND ${inHistorySql('s')} AND e.exercise_id = ? ORDER BY s.started_at_utc, s.id`,
        [ownerId, exerciseId],
      );
      const out: SessionAggregate[] = [];
      for (const r of rows) {
        const agg = await readAggregate(q, r.id);
        if (agg) out.push(agg);
      }
      return out;
    });
  }

  /** Finished sessions of `ownerId` that started in [fromUtc, toUtc), oldest first (Today's week strip). */
  listFinishedBetween(ownerId: string, fromUtc: string, toUtc: string): Promise<SessionAggregate[]> {
    return this.db.read(async (q) => {
      const rows = await q.getAll<{ id: string }>(
        `SELECT id FROM sessions WHERE owner_id = ? AND ${inHistorySql()} AND started_at_utc >= ? AND started_at_utc < ?
         ORDER BY started_at_utc, id`,
        [ownerId, fromUtc, toUtc],
      );
      const out: SessionAggregate[] = [];
      for (const r of rows) {
        const agg = await readAggregate(q, r.id);
        if (agg) out.push(agg);
      }
      return out;
    });
  }

  /**
   * Like `listFinishedBetween`, but a session that fails to decode is skipped
   * and counted instead of failing the whole read (Today's week, review S1).
   */
  listFinishedBetweenReadable(ownerId: string, fromUtc: string, toUtc: string): Promise<{ sessions: SessionAggregate[]; unreadable: number }> {
    return this.db.read(async (q) => {
      const rows = await q.getAll<{ id: string }>(
        `SELECT id FROM sessions WHERE owner_id = ? AND ${inHistorySql()} AND started_at_utc >= ? AND started_at_utc < ?
         ORDER BY started_at_utc, id`,
        [ownerId, fromUtc, toUtc],
      );
      const sessions: SessionAggregate[] = [];
      let unreadable = 0;
      for (const r of rows) {
        try {
          const agg = await readAggregate(q, r.id);
          if (agg) sessions.push(agg);
        } catch (e) {
          if (!(e instanceof CorruptDataError)) throw e;
          unreadable += 1;
        }
      }
      return { sessions, unreadable };
    });
  }

  /** When the first finished session started (any source), or null: how far back the history goes (review N4). */
  earliestFinishedStartUtc(ownerId: string): Promise<string | null> {
    return this.db.read(async (q) => {
      const row = await q.getFirst<{ t: string | null }>(`SELECT min(started_at_utc) AS t FROM sessions WHERE owner_id = ? AND ${inHistorySql()}`, [ownerId]);
      return row?.t ?? null;
    });
  }

  /** The most recently started finished session, if any. */
  latestFinished(ownerId: string): Promise<SessionAggregate | null> {
    return this.db.read(async (q) => {
      const row = await q.getFirst<{ id: string }>(
        `SELECT id FROM sessions WHERE owner_id = ? AND ${inHistorySql()} ORDER BY started_at_utc DESC, id DESC LIMIT 1`,
        [ownerId],
      );
      return row ? readAggregate(q, row.id) : null;
    });
  }

  /**
   * IDs of finished sessions with at least one completed set, newest first
   * (Repeat candidates, review S1). Reads no aggregates, so one undecodable
   * record never stops the list; callers decode each ID and skip failures.
   * Imported (FitNotes) workouts are included (B7): Repeat fits their loads
   * to the gym's equipment like any other.
   */
  listRepeatableIds(ownerId: string, limit: number, offset = 0): Promise<string[]> {
    return this.db.read(async (q) =>
      (
        await q.getAll<{ id: string }>(
          `SELECT s.id AS id FROM sessions s
           WHERE s.owner_id = ? AND ${inHistorySql('s')}
             AND EXISTS (SELECT 1 FROM session_sets x WHERE x.session_id = s.id AND x.status = 'completed')
           ORDER BY s.started_at_utc DESC, s.id DESC LIMIT ? OFFSET ?`,
          [ownerId, limit, offset],
        )
      ).map((r) => r.id),
    );
  }

  /**
   * IDs of every workout in history, done in the app or imported (B7,
   * delete-workouts DW-Q3), with or without completed sets, newest first:
   * Past workouts' list, where test sessions (`Finish anyway` with nothing
   * logged) must be reachable to delete them (delete-workouts §2.3; review
   * r2 B1). Paged by `offset` (B2).
   */
  listPastWorkoutIds(ownerId: string, limit: number, offset = 0): Promise<string[]> {
    return this.db.read(async (q) =>
      (
        await q.getAll<{ id: string }>(
          `SELECT id FROM sessions WHERE owner_id = ? AND ${inHistorySql()}
           ORDER BY started_at_utc DESC, id DESC LIMIT ? OFFSET ?`,
          [ownerId, limit, offset],
        )
      ).map((r) => r.id),
    );
  }

  /**
   * The newest finished workouts done in the app with a completed set, as
   * small rows (no aggregate decode): what the rotation, the routine
   * list's `last done` and the pace estimate read (premium-feel §2.6).
   * Newest first. Imported workouts stay out by default: they come from no
   * routine and have no times. `includeImported`: the newest workout of any
   * source, for readers that want "the last workout Ben did" (the pain chips
   * from Today, Up next's longest gap; review import-progress S1, S2).
   */
  listFinishedRefs(ownerId: string, limit: number, opts: { includeImported?: boolean } = {}): Promise<FinishedRefRow[]> {
    const source = opts.includeImported === true ? '' : ` AND s.source = 'manual'`;
    return this.db.read(async (q) =>
      (
        await q.getAll<{ id: string; routine_id: string | null; started_at_utc: string; started_at_tz: string; plan_day: string | null }>(
          `SELECT s.id, s.routine_id, s.started_at_utc, s.started_at_tz, s.plan_day
           FROM sessions s
           WHERE s.owner_id = ? AND ${inHistorySql('s')}${source}
             AND EXISTS (SELECT 1 FROM session_sets x WHERE x.session_id = s.id AND x.status = 'completed')
           ORDER BY s.started_at_utc DESC, s.id DESC LIMIT ?`,
          [ownerId, limit],
        )
      ).map((r) => {
        const p = r.plan_day === null ? null : SessionPlanDaySchema.safeParse(JSON.parse(r.plan_day));
        return {
          sessionId: r.id,
          routineId: r.routine_id,
          startedAtUtc: r.started_at_utc,
          tz: r.started_at_tz,
          ...(p?.success === true
            ? { planDay: { planId: p.data.planId, dayIndex: p.data.dayIndex, splitDayId: p.data.splitDayId, templateRoutineId: p.data.templateRoutineId, mainLiftExerciseId: p.data.mainLiftExerciseId ?? null, variationId: p.data.variationId } }
            : {}),
        };
      }),
    );
  }

  /**
   * Finished workouts with a completed set, app-logged and imported, as
   * small rows (no aggregate decode): what the session picker groups into
   * session types (session-picker §3.1). `exerciseCount` counts distinct
   * exercises with a completed set, as the next-session plan copies them
   * (review r2 N3); `exerciseIds` are those exercises (an unnamed import's
   * type is named from them, F20). Newest first.
   */
  listSessionTypeRows(
    ownerId: string,
    limit: number,
  ): Promise<{ sessionId: string; routineId: string | null; routineName: string | null; imported: boolean; startedAtUtc: string; tz: string; exerciseCount: number; exerciseIds: string[] }[]> {
    return this.db.read(async (q) =>
      (
        await q.getAll<{ id: string; routine_id: string | null; routine_name: string | null; source: string; started_at_utc: string; started_at_tz: string; n: number; ids: string | null }>(
          `SELECT s.id, s.routine_id, s.routine_name, s.source, s.started_at_utc, s.started_at_tz,
                  (SELECT count(DISTINCT e.exercise_id) FROM session_exercises e WHERE e.session_id = s.id
                    AND EXISTS (SELECT 1 FROM session_sets y WHERE y.session_exercise_id = e.id AND y.status = 'completed')) AS n,
                  (SELECT group_concat(d.exercise_id, char(31)) FROM (SELECT DISTINCT e.exercise_id FROM session_exercises e WHERE e.session_id = s.id
                    AND EXISTS (SELECT 1 FROM session_sets y WHERE y.session_exercise_id = e.id AND y.status = 'completed')) d) AS ids
           FROM sessions s
           WHERE s.owner_id = ? AND ${inHistorySql('s')}
             AND EXISTS (SELECT 1 FROM session_sets x WHERE x.session_id = s.id AND x.status = 'completed')
           ORDER BY s.started_at_utc DESC, s.id DESC LIMIT ?`,
          [ownerId, limit],
        )
      ).map((r) => ({
        sessionId: r.id,
        routineId: r.routine_id,
        routineName: r.routine_name,
        imported: r.source === 'import',
        startedAtUtc: r.started_at_utc,
        tz: r.started_at_tz,
        exerciseCount: r.n,
        exerciseIds: r.ids === null || r.ids === '' ? [] : r.ids.split('\u001f'),
      })),
    );
  }

  /**
   * Every finished session in history (not deleted) of `ownerId` as `(id, revision)`, no decode
   * (Progress, progress.md §6): the service re-reads only sessions whose
   * revision changed since it last projected them.
   */
  listFinishedRevisions(ownerId: string): Promise<{ id: string; revision: number }[]> {
    return this.db.read((q) => q.getAll<{ id: string; revision: number }>(`SELECT id, revision FROM sessions WHERE owner_id = ? AND ${inHistorySql()} ORDER BY started_at_utc, id`, [ownerId]));
  }

  /**
   * `deleteWorkouts` (delete-workouts §8): one transaction, all-or-nothing
   * (DW-D1, DW7, DW8). Only `finished` workouts at the shown version.
   */
  deleteWorkouts(req: WorkoutsRequest): Promise<DeletionOutcome> {
    return this.applyPlan(req, planDeleteWorkouts);
  }

  /** `restoreWorkouts` (§8; the toast's Undo too): deleted, still restorable, at the shown version. */
  restoreWorkouts(req: WorkoutsRequest): Promise<DeletionOutcome> {
    return this.applyPlan(req, planRestoreWorkouts);
  }

  private applyPlan(req: WorkoutsRequest, planner: (found: ReadonlyMap<string, SessionAggregate | null>, req: WorkoutsRequest) => DeletionPlan): Promise<DeletionOutcome> {
    return this.db.write(async (tx): Promise<DeletionOutcome> => {
      const found = new Map<string, SessionAggregate | null>();
      for (const item of req.items) found.set(item.sessionId, await readAggregate(tx, item.sessionId));
      const plan = planner(found, req);
      if (!plan.ok) return plan;
      for (const w of plan.writes) {
        const valid = checkWrite(SessionAggregateSchema, w.aggregate, T, w.aggregate.session.id);
        const current = await tx.getFirst<{ revision: number }>('SELECT revision FROM sessions WHERE id = ?', [valid.session.id]);
        if (current?.revision !== w.expectedRevision) throw new HistoryRewriteError(valid.session.id, 'revision changed inside the transaction');
        await writeAggregate(tx, valid);
      }
      return { ok: true, duplicate: plan.duplicate, refs: plan.refs };
    });
  }

  /**
   * One import's workouts in history, oldest first (Select in an import's
   * workout list, delete-workouts §2.1, DW24). A row that can't be read is
   * skipped and counted.
   */
  listImportJobInHistory(ownerId: string, jobId: string): Promise<{ sessions: SessionAggregate[]; unreadable: number }> {
    return this.db.read(async (q) => {
      const rows = await q.getAll<{ id: string }>(
        `SELECT id FROM sessions WHERE owner_id = ? AND import_job_id = ? AND ${inHistorySql()} ORDER BY local_date, started_at_utc, id`,
        [ownerId, jobId],
      );
      const sessions: SessionAggregate[] = [];
      let unreadable = 0;
      for (const r of rows) {
        try {
          const agg = await readAggregate(q, r.id);
          if (agg) sessions.push(agg);
        } catch {
          unreadable += 1;
        }
      }
      return { sessions, unreadable };
    });
  }

  /**
   * Recently deleted (§2.5): deleted workouts still restorable at `nowUtc`,
   * newest deletion first. Past their 30 days they are never listed, whether
   * or not the purge has run (DW21).
   */
  listRecentlyDeleted(ownerId: string, nowUtc: string): Promise<{ sessions: SessionAggregate[]; unreadable: number }> {
    return this.db.read(async (q) => {
      const rows = await q.getAll<{ id: string }>(
        `SELECT id FROM sessions WHERE owner_id = ? AND status = 'deleted' AND purge_after_utc > ?
         ORDER BY deleted_at_utc DESC, id DESC`,
        [ownerId, nowUtc],
      );
      // One row that can't be read is skipped and counted; the rest stay restorable (review r2 S2).
      const sessions: SessionAggregate[] = [];
      let unreadable = 0;
      for (const r of rows) {
        try {
          const agg = await readAggregate(q, r.id);
          if (agg) sessions.push(agg);
        } catch {
          unreadable += 1;
        }
      }
      return { sessions, unreadable };
    });
  }

  /** How many workouts Recently deleted lists at `nowUtc` (Past workouts footer, Data & backup row). */
  countRecentlyDeleted(ownerId: string, nowUtc: string): Promise<number> {
    return this.db.read(async (q) => (await q.getFirst<{ n: number }>("SELECT count(*) AS n FROM sessions WHERE owner_id = ? AND status = 'deleted' AND purge_after_utc > ?", [ownerId, nowUtc]))?.n ?? 0);
  }

  /**
   * The purge (§6.4, ADR 0024). Removes every row of each workout and leaves
   * a tombstone (ID, owner, deleted-at, purged-at, import job; no training
   * values). By default the workouts past their 30 days; `sessionIds` for
   * `Delete now` (any deleted workout of the owner). One transaction: a
   * force-close leaves either all of it or none (DW22). Repeating an
   * operation ID returns what it purged and writes nothing.
   */
  purgeDeleted(req: { ownerId: string; opId: string; at: ZonedTimestamp; sessionIds?: readonly string[] }): Promise<PurgeOutcome> {
    return this.db.write(async (tx): Promise<PurgeOutcome> => {
      const done = await tx.getAll<{ session_id: string }>('SELECT session_id FROM purged_sessions WHERE owner_id = ? AND purge_op_id = ? ORDER BY session_id', [req.ownerId, req.opId]);
      let ids: string[];
      if (req.sessionIds === undefined) {
        ids = (
          await tx.getAll<{ id: string }>("SELECT id FROM sessions WHERE owner_id = ? AND status = 'deleted' AND purge_after_utc <= ? ORDER BY id", [req.ownerId, req.at.utc])
        ).map((r) => r.id);
        // The due purge under an op ID already used (a second launch the same day) still purges what has become due since (review N1).
        if (done.length > 0 && ids.length === 0) return { ok: true, duplicate: true, purged: done.map((r) => r.session_id) };
      } else if (done.length > 0) {
        return { ok: true, duplicate: true, purged: done.map((r) => r.session_id) };
      } else {
        ids = [...new Set(req.sessionIds)].sort();
        for (const id of ids) {
          const row = await tx.getFirst<{ status: string; owner_id: string }>('SELECT status, owner_id FROM sessions WHERE id = ?', [id]);
          if (row?.status !== 'deleted' || row.owner_id !== req.ownerId) return { ok: false, error: { code: 'stale', sessionIds: [id] } };
        }
      }
      for (const id of ids) await purgeOne(tx, id, req.opId, req.at.utc);
      return { ok: true, duplicate: false, purged: ids };
    });
  }

  /** Whether an import's workout on `localDate` was purged (its import rows went with it; review N4). */
  isPurgedImportDate(jobId: string, localDate: string): Promise<boolean> {
    return this.db.read(async (q) => (await q.getFirst('SELECT 1 AS x FROM purged_sessions WHERE import_job_id = ? AND local_date = ?', [jobId, localDate])) !== null);
  }

  /** Whether `sessionId` was purged (an old link opens `This workout was deleted.`, §3.2). */
  isPurged(sessionId: string): Promise<boolean> {
    return this.db.read(async (q) => (await q.getFirst('SELECT 1 AS x FROM purged_sessions WHERE session_id = ?', [sessionId])) !== null);
  }

  /** IDs of every stored session (for integrity checks). */
  listIds(): Promise<string[]> {
    return this.db.read(async (q) => (await q.getAll<{ id: string }>('SELECT id FROM sessions ORDER BY id')).map((r) => r.id));
  }
}
