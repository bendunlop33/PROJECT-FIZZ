import { addDays, deriveId, isInHistory, planWorkoutMove, workoutFixApplyOpId, workoutWhenText, type WorkoutFixDetail } from '@fizz/domain';
import type { Store } from '@fizz/persistence';
import { undoCoachAction, type WorkoutFixPrepared } from '@fizz/coach';
import type { ActionRecord, Activity, ProposeWorkoutFixArgs, SessionAggregate, UserProfile, ZonedTimestamp } from '@fizz/schemas';

import type { HealthActivityDetail } from '../health/health-view';

/**
 * (Ben, 2 Nov) Fixing past workouts from the coach (`propose_workout_fix`): a date or times moved, a duplicate deleted,
 * a Health (Garmin, watch) workout paired or unpaired. Local only.
 *
 * - `prepare`: the coach's call checked against the data as it is, nothing written. A move is checked by the
 *   reducer's own time rules (`planWorkoutMove`); a delete only of a finished workout in history; a pairing only to a
 *   workout the Health workout's own sheet offers that day (`health.activity`: Pair or Same workout), an unpair only
 *   of one paired. A Health run is Ben's planned run when it's the only run that day (`activitiesWithHealth`); there
 *   is no by-hand run pairing, so that ask is answered honestly.
 * - `card`, `apply`, `undo`: Apply is one coach-store write (`workout_fix`): a `committed` record with `proposalId`
 *   and the change, through Summary's Edit times, History's delete and the day sheet's link changes, on the versions
 *   proposed (stale otherwise, rule 5). Its action and op IDs come from the proposal, so a double tap or a restart
 *   writes once. Undo is the coach store's undo of that record (Restore, the times before, Unpair / Pair back).
 * - Two app workouts are never merged: the store has no merge; the coach proposes deleting the duplicate.
 */

export interface WorkoutFixServiceDeps {
  store: () => Store;
  profile: () => Promise<UserProfile | null>;
  now: () => ZonedTimestamp;
  /** The Health workout's sheet: its pairing choices that day (the day sheet's own read). Null: none, or Health off. */
  healthActivity: (healthUuid: string) => Promise<HealthActivityDetail | null>;
}

export type WorkoutFixCardState = { kind: 'open' | 'applied' | 'undone' } | { kind: 'gone' };

export const WORKOUT_FIX_COPY = {
  apply: 'Apply',
  delete: 'Delete',
  skip: 'Skip',
  undo: 'Undo',
  applied: 'Applied',
  deleted: 'Deleted',
  undone: 'Undone',
  skipped: 'Skipped',
  cancel: 'Cancel',
  /** The delete confirm: `Delete Push A?` */
  confirmTitle: (title: string) => `Delete ${title}?`,
  stale: 'Out of date. Ask again.',
  failed: 'Couldn’t save. Try again.',
  notUndone: 'Not undone.',
} as const;

/** Ben's Apply's record ID for a proposal: one per proposal (rule 5). */
export const workoutFixAppliedId = (proposalId: string): string => deriveId(`workout-fix-apply:${proposalId}`);

const refuse = (line: string, title?: string): WorkoutFixPrepared => ({ kind: 'refused', line, ...(title === undefined ? {} : { title }) });

export function createWorkoutFixService(deps: WorkoutFixServiceDeps) {
  const repos = () => deps.store().repos;

  async function owner(): Promise<UserProfile | null> {
    return deps.profile().catch(() => null);
  }

  /** A workout of Ben's in history (finished, not deleted), or null. */
  async function workout(p: UserProfile, id: string | null): Promise<SessionAggregate | null> {
    if (id === null) return null;
    const a = await repos()
      .sessions.get(id)
      .catch(() => null);
    return a === null || a.session.ownerId !== p.id || !isInHistory(a.session) ? null : a;
  }

  const titleOf = (a: SessionAggregate): string => (a.session.routineName ?? 'Workout').slice(0, 120);
  const setsOf = (a: SessionAggregate): number => a.sets.filter((s) => s.status === 'completed').length;

  async function prepare(p: UserProfile, args: ProposeWorkoutFixArgs): Promise<WorkoutFixPrepared> {
    const now = deps.now();
    switch (args.op) {
      case 'move': {
        const a = await workout(p, args.workoutId);
        if (a === null) return refuse('No workout with that ID; read get_recent_sessions with its date');
        if (args.date === null && args.start === null && args.end === null) return refuse('Say the new day or time', titleOf(a));
        const m = planWorkoutMove(a, { date: args.date, start: args.start, end: args.end }, now);
        if (!m.ok) return refuse(m.line, titleOf(a));
        return { kind: 'ok', detail: { kind: 'fix_workout', op: 'move', sessionId: a.session.id, sessionVersion: a.session.version, title: titleOf(a), before: m.before, after: m.after, move: { startedAt: m.startedAt, endedAt: m.endedAt } } };
      }
      case 'delete': {
        const a = await workout(p, args.workoutId);
        if (a === null) return refuse('No workout with that ID; read get_recent_sessions with its date');
        if (a.session.status !== 'finished') return refuse('Only a finished workout can be deleted', titleOf(a));
        const n = setsOf(a);
        return { kind: 'ok', detail: { kind: 'fix_workout', op: 'delete', sessionId: a.session.id, sessionVersion: a.session.version, title: titleOf(a), before: `${workoutWhenText(a.session)} · ${String(n)} ${n === 1 ? 'set' : 'sets'}`, after: 'Deleted' } };
      }
      case 'pair':
      case 'unpair': {
        if (args.healthId === null) return refuse('Which Health workout? Read get_recent_sessions with its date for its healthId');
        const uuid = args.healthId.trim().toLowerCase();
        const sheet = await deps.healthActivity(uuid).catch(() => null);
        if (sheet === null) return refuse('No Health workout with that ID, or Health reading is off');
        const h = sheet.activity.health;
        const hTitle = `${h?.sourceName ?? 'Health'} ${h?.label ?? 'workout'}`.slice(0, 120);
        if (args.op === 'unpair') {
          if (sheet.paired !== null) {
            return { kind: 'ok', detail: { kind: 'fix_workout', op: 'unpair', sessionId: sheet.paired.sessionId, sessionVersion: null, title: hTitle, before: `Paired with ${sheet.paired.title}`, after: 'Not paired', link: { mode: 'unlink', healthUuid: uuid, linkUuid: uuid, linkVersion: sheet.paired.linkVersion } } };
          }
          const twin = (await repos().health.links(p.id).catch(() => [])).find((l) => l.status === 'linked' && (l.also ?? []).includes(uuid));
          if (twin === undefined) return refuse('That Health workout isn’t paired', hTitle);
          const a = await workout(p, twin.sessionId);
          return { kind: 'ok', detail: { kind: 'fix_workout', op: 'unpair', sessionId: twin.sessionId, sessionVersion: null, title: hTitle, before: `Same workout as ${a === null ? 'Workout' : titleOf(a)}`, after: 'Not paired', link: { mode: 'not_same', healthUuid: uuid, linkUuid: twin.healthUuid, linkVersion: twin.version } } };
        }
        if (args.workoutId === null) return pairWithPlanned(p, sheet, uuid, hTitle);
        const a = await workout(p, args.workoutId);
        if (a === null) return refuse('No workout with that ID; read get_recent_sessions with its date', hTitle);
        if (sheet.paired?.sessionId === a.session.id) return refuse(`Already paired with ${titleOf(a)}`, hTitle);
        const pair = sheet.pair.find((x) => x.sessionId === a.session.id);
        if (pair !== undefined) {
          const current = (await repos().health.links(p.id).catch(() => [])).find((l) => l.healthUuid === uuid);
          return { kind: 'ok', detail: { kind: 'fix_workout', op: 'pair', sessionId: a.session.id, sessionVersion: null, title: hTitle, before: 'Not paired', after: `Paired with ${titleOf(a)}`, link: { mode: 'link', healthUuid: uuid, linkUuid: uuid, linkVersion: current?.version ?? null } } };
        }
        const same = sheet.same.find((x) => x.sessionId === a.session.id);
        if (same !== undefined) {
          return { kind: 'ok', detail: { kind: 'fix_workout', op: 'pair', sessionId: a.session.id, sessionVersion: null, title: hTitle, before: 'Not paired', after: `Same workout as ${titleOf(a)}`, link: { mode: 'same', healthUuid: uuid, linkUuid: same.linkUuid, linkVersion: same.linkVersion } } };
        }
        if (sheet.paired !== null) return refuse(`Paired with ${sheet.paired.title}; unpair it first`, hTitle);
        return refuse(`Not one of that day’s workouts it can pair with (same day, a strength workout)`, hTitle);
      }
    }
  }

  /**
   * "Pair my Garmin run with the planned run": a Health run already counts as Ben's planned run when it is the only one
   * of its kind that day (`activitiesWithHealth`). Nothing pairs a run by hand, so any other case is said honestly.
   */
  async function pairWithPlanned(p: UserProfile, sheet: HealthActivityDetail, uuid: string, hTitle: string): Promise<WorkoutFixPrepared> {
    const date = sheet.activity.fields.date;
    const shown: Activity[] = await repos()
      .activities.listBetween(p.id, date, addDays(date, 1))
      .catch(() => []);
    const ben = shown.find((a) => a.source !== 'health' && a.health?.uuid.toLowerCase() === uuid);
    if (ben !== undefined) return refuse(`Already counts as your ${ben.fields.kind} that day`, hTitle);
    return refuse(`A Health ${sheet.activity.fields.kind} counts as the planned one on its own only when it’s the only one that day; runs can’t be paired by hand yet`, hTitle);
  }

  async function proposal(proposalId: string): Promise<{ p: UserProfile; record: ActionRecord; d: WorkoutFixDetail } | null> {
    const p = await owner();
    const record = await repos()
      .coach.getAction(proposalId)
      .catch(() => null);
    if (p === null || record === null || record.detail.kind !== 'fix_workout' || record.status !== 'proposed') return null;
    return { p, record, d: record.detail };
  }

  return {
    /** The coach's `propose_workout_fix`: checked, nothing written. */
    async prepare(args: ProposeWorkoutFixArgs): Promise<WorkoutFixPrepared> {
      const p = await owner();
      if (p === null) return refuse('No profile');
      return prepare(p, args);
    },

    async card(proposalId: string): Promise<WorkoutFixCardState> {
      const x = await proposal(proposalId);
      if (x === null) return { kind: 'gone' };
      const applied = await repos()
        .coach.getAction(workoutFixAppliedId(proposalId))
        .catch(() => null);
      if (applied === null) return { kind: 'open' };
      return { kind: applied.undoneBy === null ? 'applied' : 'undone' };
    },

    /** Apply (Ben's tap): the fix on the versions proposed, with its record, or `Out of date` and nothing written. */
    async apply(proposalId: string): Promise<{ ok: true } | { ok: false; line: string }> {
      const x = await proposal(proposalId);
      if (x === null) return { ok: false, line: WORKOUT_FIX_COPY.stale };
      const record: ActionRecord = {
        actionId: workoutFixAppliedId(proposalId),
        turnId: null,
        opId: workoutFixApplyOpId(proposalId),
        status: 'committed',
        author: 'ben',
        detail: { ...x.d, proposalId },
        failure: null,
        reason: null,
        evidenceRefs: [],
        guardNotes: [],
        entityVersions: [],
        undoneBy: null,
        createdAt: deps.now(),
      };
      const r = await repos()
        .coach.commit(x.p.id, { kind: 'workout_fix', action: record })
        .catch(() => null);
      if (r === null) return { ok: false, line: WORKOUT_FIX_COPY.failed };
      return r.status === 'conflict' ? { ok: false, line: WORKOUT_FIX_COPY.stale } : { ok: true };
    },

    /** Undo of that Apply, only while nothing changed since. */
    async undo(proposalId: string, opId: string): Promise<boolean> {
      const x = await proposal(proposalId);
      if (x === null) return false;
      const r = await undoCoachAction(repos().coach, { ownerId: x.p.id, actionId: workoutFixAppliedId(proposalId), opId, now: deps.now() }).catch(() => null);
      return r !== null && (r.result.status === 'written' || r.result.status === 'replayed');
    },
  };
}

export type WorkoutFixService = ReturnType<typeof createWorkoutFixService>;
