import {
  SessionAggregateSchema,
  type SessionAggregate,
  type SessionExercise,
  type SetAuditEntry,
  type SessionTimingAuditEntry,
  type WorkoutSet,
  type ZonedTimestamp,
} from '@fizz/schemas';
import type { FencedResult, SaveResult, SessionRepository, WriteFence } from '@fizz/domain';
import type { Database } from './database';
import type { SqlExecutor, SqlRow, SqlValue } from './driver';
import { CorruptDataError, HistoryRewriteError } from './errors';
import { bool, checkRead, checkWrite, insert, int, mismatch, parseJson, parseJsonOrNull, rowId, upsert } from './sql';

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
  };
}

function exerciseRow(e: SessionExercise, ordinal: number): Record<string, SqlValue> {
  return {
    id: e.id,
    session_id: e.sessionId,
    ordinal,
    exercise_id: e.exerciseId,
    exercise_name: e.exerciseName,
    measurement: e.measurement,
    laterality: e.laterality,
    equipment_id: e.equipmentId,
    load_convention: e.loadConvention,
    unit: e.unit,
    sort_order: e.order,
    superset_group: e.supersetGroup,
    transition_rest_s: e.transitionRestS,
    progression_rule_id: e.progressionRuleId,
    continues_from_id: e.continuesFromId ?? null,
    equipment_version: e.equipmentVersion ?? null,
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
    },
    exercises: exercises.map((e) => ({
      id: e.id,
      sessionId: e.session_id,
      exerciseId: e.exercise_id,
      exerciseName: e.exercise_name,
      measurement: e.measurement,
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

  save(aggregate: SessionAggregate, expectedRevision: number | null, fence?: WriteFence): Promise<SaveResult | FencedResult> {
    return this.db.write(async (tx): Promise<SaveResult | FencedResult> => {
      const valid = checkWrite(SessionAggregateSchema, aggregate, T, aggregate.session.id);
      if (fence && !(await fenceHolds(tx, fence))) return { ok: false, error: 'stale_inputs' };
      const current = await tx.getFirst<{ revision: number }>('SELECT revision FROM sessions WHERE id = ?', [valid.session.id]);
      const currentRevision = current?.revision ?? null;
      if (currentRevision !== expectedRevision) return { ok: false, error: 'conflict', currentVersion: currentRevision };
      if (expectedRevision === null && !(await closeDraftsOnStart(tx, valid))) return { ok: false, error: 'stale_inputs' };
      await writeAggregate(tx, valid);
      return { ok: true, version: valid.revision };
    });
  }

  /** Finished sessions of `ownerId` that include `exerciseId`, oldest first. */
  listFinishedWithExercise(ownerId: string, exerciseId: string): Promise<SessionAggregate[]> {
    return this.db.read(async (q) => {
      const rows = await q.getAll<{ id: string }>(
        `SELECT DISTINCT s.id AS id, s.started_at_utc FROM sessions s JOIN session_exercises e ON e.session_id = s.id
         WHERE s.owner_id = ? AND s.status = 'finished' AND e.exercise_id = ? ORDER BY s.started_at_utc, s.id`,
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
        `SELECT id FROM sessions WHERE owner_id = ? AND status = 'finished' AND started_at_utc >= ? AND started_at_utc < ?
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
        `SELECT id FROM sessions WHERE owner_id = ? AND status = 'finished' AND started_at_utc >= ? AND started_at_utc < ?
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

  /** The most recently started finished session, if any. */
  latestFinished(ownerId: string): Promise<SessionAggregate | null> {
    return this.db.read(async (q) => {
      const row = await q.getFirst<{ id: string }>(
        "SELECT id FROM sessions WHERE owner_id = ? AND status = 'finished' ORDER BY started_at_utc DESC, id DESC LIMIT 1",
        [ownerId],
      );
      return row ? readAggregate(q, row.id) : null;
    });
  }

  /**
   * IDs of finished sessions with at least one completed set, newest first
   * (Repeat candidates, review S1). Reads no aggregates, so one undecodable
   * record never stops the list; callers decode each ID and skip failures.
   * Imported (FitNotes) workouts aren't repeatable while P-I3 is open: their
   * loads were never checked on any equipment (review r2 B1).
   */
  listRepeatableIds(ownerId: string, limit: number, offset = 0): Promise<string[]> {
    return this.db.read(async (q) =>
      (
        await q.getAll<{ id: string }>(
          `SELECT s.id AS id FROM sessions s
           WHERE s.owner_id = ? AND s.status = 'finished' AND s.source = 'manual'
             AND EXISTS (SELECT 1 FROM session_sets x WHERE x.session_id = s.id AND x.status = 'completed')
           ORDER BY s.started_at_utc DESC, s.id DESC LIMIT ? OFFSET ?`,
          [ownerId, limit, offset],
        )
      ).map((r) => r.id),
    );
  }

  /**
   * The newest finished workouts done in the app with a completed set, as
   * small rows (no aggregate decode): what the rotation and the routine
   * list's `last done` read (premium-feel §2.6). Newest first.
   */
  listFinishedRefs(ownerId: string, limit: number): Promise<{ sessionId: string; routineId: string | null; startedAtUtc: string; tz: string }[]> {
    return this.db.read(async (q) =>
      (
        await q.getAll<{ id: string; routine_id: string | null; started_at_utc: string; started_at_tz: string }>(
          `SELECT s.id, s.routine_id, s.started_at_utc, s.started_at_tz FROM sessions s
           WHERE s.owner_id = ? AND s.status = 'finished' AND s.source = 'manual'
             AND EXISTS (SELECT 1 FROM session_sets x WHERE x.session_id = s.id AND x.status = 'completed')
           ORDER BY s.started_at_utc DESC, s.id DESC LIMIT ?`,
          [ownerId, limit],
        )
      ).map((r) => ({ sessionId: r.id, routineId: r.routine_id, startedAtUtc: r.started_at_utc, tz: r.started_at_tz })),
    );
  }

  /** Finished imported workouts with a completed set: the ones `listRepeatableIds` leaves out (review r2 B1). */
  countImportedFinished(ownerId: string): Promise<number> {
    return this.db.read(async (q) => {
      const row = await q.getFirst<{ n: number }>(
        `SELECT count(*) AS n FROM sessions s
         WHERE s.owner_id = ? AND s.status = 'finished' AND s.source = 'import'
           AND EXISTS (SELECT 1 FROM session_sets x WHERE x.session_id = s.id AND x.status = 'completed')`,
        [ownerId],
      );
      return row?.n ?? 0;
    });
  }

  /** IDs of every stored session (for integrity checks). */
  listIds(): Promise<string[]> {
    return this.db.read(async (q) => (await q.getAll<{ id: string }>('SELECT id FROM sessions ORDER BY id')).map((r) => r.id));
  }
}
