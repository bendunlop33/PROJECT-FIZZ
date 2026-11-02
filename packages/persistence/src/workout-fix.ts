import type { ActionRecord, HealthLink, SessionAggregate } from '@fizz/schemas';
import { changeLinkAlso, linkActivityHealth, linkHealthActivity, unlinkActivityHealth, moveCommand, planDeleteWorkouts, planRestoreWorkouts, reduceSession, timingUndoCommand, unlinkHealthActivity, type HealthLinkChange, type WorkoutFixDetail } from '@fizz/domain';

import type { SqlExecutor } from './driver';
import { ACTIVITY_SPEC, saveActivityChangeIn } from './activities';
import { decodeDocument } from './documents';
import { changeLinkIn } from './health';
import { readAggregate, writeAggregate } from './sessions';

/**
 * (Ben, 2 Nov) A past-workout fix applied (Ben's Apply on the coach's proposal) or undone, inside the coach store's
 * transaction with its record (rule 5). Each change is the existing write, unchanged:
 * - move: the workout's own `update_session_timing` with `shift` (Summary's Edit times), on the version proposed;
 *   Undo is `timingUndoCommand` (the times before), only while the workout is as the move left it;
 * - delete: History's delete plan (`planDeleteWorkouts`: a soft delete, in Recently deleted for 30 days); Undo is its
 *   Restore (`planRestoreWorkouts`) on the deleted version;
 * - pair / unpair: the day sheet's link changes (`linkHealthActivity`, `changeLinkAlso`, `unlinkHealthActivity`) through
 *   `changeLinkIn`, on the link version read; Undo is the opposite change on the version the apply left;
 * - (Ben, 2 Nov) a Health run linked to or unlinked from Ben's planned run (`runLink`): the day sheet's `Link` / `Unlink`
 *   on that activity (`linkActivityHealth`, `unlinkActivityHealth`), on its version as read; Undo the opposite.
 * Completed sets are never edited (rule 2): a move shifts their times with the workout, values untouched.
 */

export type WorkoutFixOutcome = 'ok' | 'stale';

const sessionVersionAfter = (d: WorkoutFixDetail): number => (d.sessionVersion ?? 0) + 1;
const linkVersionAfter = (d: WorkoutFixDetail): number => (d.link?.linkVersion ?? 0) + 1;

async function own(tx: SqlExecutor, ownerId: string, sessionId: string | null): Promise<SessionAggregate | null> {
  if (sessionId === null) return null;
  const a = await readAggregate(tx, sessionId);
  return a === null || a.session.ownerId !== ownerId ? null : a;
}

/** The planned run's `Link` / `Unlink` (`runLink`), or its Undo on the version the apply left. */
async function runLink(tx: SqlExecutor, ownerId: string, d: WorkoutFixDetail, opId: string, at: ActionRecord['createdAt'], undo: boolean): Promise<WorkoutFixOutcome> {
  const l = d.runLink;
  if (l === undefined) return 'stale';
  const row = await tx.getFirst('SELECT * FROM activities WHERE id = ?', [l.activityId]);
  const cur = row === null ? null : decodeDocument(ACTIVITY_SPEC, row);
  if (cur === null || cur.ownerId !== ownerId) return 'stale';
  const mode = undo ? (l.mode === 'link' ? 'unlink' : 'link') : l.mode;
  const input = { opId, at, expectedVersion: undo ? l.activityVersion + 1 : l.activityVersion, healthUuid: l.healthUuid };
  const r = await saveActivityChangeIn(tx, ownerId, mode === 'link' ? linkActivityHealth(cur, input) : unlinkActivityHealth(cur, input));
  return r.status === 'written' || r.status === 'replayed' ? 'ok' : 'stale';
}

async function link(tx: SqlExecutor, ownerId: string, d: WorkoutFixDetail, opId: string, atUtc: string, undo: boolean): Promise<WorkoutFixOutcome> {
  const l = d.link;
  if (l === undefined || d.sessionId === null) return 'stale';
  const sessionId = d.sessionId;
  const expected = undo ? linkVersionAfter(d) : l.linkVersion;
  // Undo of a pair is an unpair (and back); of Same workout, taking it out of the link (and back).
  const mode = undo ? ({ link: 'unlink', unlink: 'link', same: 'not_same', not_same: 'same' } as const)[l.mode] : l.mode;
  const make = async (cur: HealthLink | null, elsewhere: (id: string) => Promise<boolean>): Promise<HealthLinkChange> => {
    if (undo && (cur === null || cur.sessionId !== sessionId)) return { kind: 'stale', current: cur };
    switch (mode) {
      case 'link':
        return linkHealthActivity(cur, { ownerId, healthUuid: l.healthUuid, sessionId, by: 'ben', opId, atUtc, expectedVersion: expected, sessionLinkedElsewhere: await elsewhere(sessionId) });
      case 'unlink':
        return cur === null || expected === null ? { kind: 'stale', current: cur } : unlinkHealthActivity(cur, { opId, atUtc, expectedVersion: expected });
      case 'same':
        return changeLinkAlso(cur, { add: [l.healthUuid], opId, atUtc, expectedVersion: expected });
      case 'not_same':
        return changeLinkAlso(cur, { remove: [l.healthUuid], opId, atUtc, expectedVersion: expected });
    }
  };
  const r = await changeLinkIn(tx, ownerId, l.linkUuid, make);
  return r.status === 'written' || r.status === 'replayed' ? 'ok' : 'stale';
}

/** Ben's Apply: the change `applied` describes (its `opId` is the write's), or `stale` and nothing written. */
export async function applyWorkoutFixIn(tx: SqlExecutor, ownerId: string, applied: ActionRecord): Promise<WorkoutFixOutcome> {
  const d = applied.detail;
  if (d.kind !== 'fix_workout') throw new TypeError('applyWorkoutFixIn takes a fix_workout record');
  const at = applied.createdAt;
  switch (d.op) {
    case 'move': {
      const a = await own(tx, ownerId, d.sessionId);
      if (a === null || d.move === undefined || d.sessionVersion === null || a.session.version !== d.sessionVersion) return 'stale';
      const r = reduceSession(a, moveCommand({ sessionVersion: d.sessionVersion, startedAt: d.move.startedAt, endedAt: d.move.endedAt }, applied.opId, at));
      if (!r.ok) return 'stale';
      if (r.state !== a) await writeAggregate(tx, r.state);
      return 'ok';
    }
    case 'delete': {
      const a = await own(tx, ownerId, d.sessionId);
      if (a === null || d.sessionVersion === null) return 'stale';
      const plan = planDeleteWorkouts(new Map([[a.session.id, a]]), { ownerId, items: [{ sessionId: a.session.id, expectedVersion: d.sessionVersion }], opId: applied.opId, at });
      if (!plan.ok) return 'stale';
      for (const w of plan.writes) await writeAggregate(tx, w.aggregate);
      return 'ok';
    }
    case 'pair':
    case 'unpair':
      if (d.runLink !== undefined) return runLink(tx, ownerId, d, applied.opId, at, false);
      return link(tx, ownerId, d, applied.opId, at.utc, false);
  }
}

/** Undo of an applied fix, only while what it changed is as it left it; else `changed_since` and nothing written. */
export async function revertWorkoutFixIn(tx: SqlExecutor, ownerId: string, target: ActionRecord, atUtc: string): Promise<'ok' | 'changed_since'> {
  const d = target.detail;
  if (d.kind !== 'fix_workout') throw new TypeError('revertWorkoutFixIn takes a fix_workout record');
  const opId = `undo:${target.actionId}`;
  const at = { utc: atUtc, tz: target.createdAt.tz };
  switch (d.op) {
    case 'move': {
      const a = await own(tx, ownerId, d.sessionId);
      if (a === null || a.session.version !== sessionVersionAfter(d)) return 'changed_since';
      const cmd = timingUndoCommand(a, target.opId, opId, at);
      if (cmd === null) return 'changed_since';
      const r = reduceSession(a, cmd);
      if (!r.ok) return 'changed_since';
      if (r.state !== a) await writeAggregate(tx, r.state);
      return 'ok';
    }
    case 'delete': {
      const a = await own(tx, ownerId, d.sessionId);
      if (a === null) return 'changed_since';
      const plan = planRestoreWorkouts(new Map([[a.session.id, a]]), { ownerId, items: [{ sessionId: a.session.id, expectedVersion: sessionVersionAfter(d) }], opId, at });
      if (!plan.ok) return 'changed_since';
      for (const w of plan.writes) await writeAggregate(tx, w.aggregate);
      return 'ok';
    }
    case 'pair':
    case 'unpair':
      if (d.runLink !== undefined) return (await runLink(tx, ownerId, d, opId, at, true)) === 'ok' ? 'ok' : 'changed_since';
      return (await link(tx, ownerId, d, opId, atUtc, true)) === 'ok' ? 'ok' : 'changed_since';
  }
}
