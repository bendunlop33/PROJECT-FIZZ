import {
  blockOf,
  blocksView,
  liftBlockDetailView,
  liftInBlock,
  liveRoutines,
  planBlockLine,
  planRoutines,
  thisBlockView,
  trainingBlocks,
  toMs,
  type BlockSession,
  type BlocksView,
  type CoachStatus,
  type LiftBlockDetailView,
  type ProgressSession,
  type ThisBlockView,
  type TrainingBlock,
  type WorkoutSummary,
} from '@fizz/domain';
import type { Store } from '@fizz/persistence';
import type { NextSessionTargetRecord, UserProfile, ZonedTimestamp } from '@fizz/schemas';

import type { CoachAvailability } from '../coach/coach-service';
import { nextTimeView, type NextTimeRowView, type NextTimeTap } from '../coach/next-time-view';
import { planRefs } from './plan-day-links';

/**
 * (Ben, 31 Oct; docs/design/block-progress.md) Progress › Lifts' `This block`, a lift's block detail, `Blocks` and
 * Library › Plan's `5 lifts up · 1 stalled` line. Local reads only (rule 1): the stored plan documents (blocks are
 * worked out from them, never stored: `trainingBlocks`), Ben's finished workouts as Progress projects them, and the
 * plan in use's main lifts. Every number is computed in `@fizz/domain`.
 *
 * The stalled lift's `Next week` card is the Summary's own next-time row for that lift on its newest workout in the
 * block (`nextTimeView`): the coach's small change or offer, else the built-in rule's stall reset (ADR 0006), already
 * snapped to the gym's kit (rule 4) and held on a pain flag (rule 9). Apply / Skip / Undo are the Summary's own writes
 * (`coach.tapRuleReset`, `coach.tapNextTarget`): versioned, one op ID per tap, offline. Nothing new decides a load.
 */

export interface BlockProgressDeps {
  store: () => Store;
  profile: () => Promise<UserProfile | null>;
  now: () => ZonedTimestamp;
  projected: () => Promise<{ sessions: readonly ProgressSession[]; nameOf: (exerciseId: string) => string | null } | null>;
  summary: (sessionId: string, coach: CoachStatus) => Promise<WorkoutSummary | null>;
  coach: {
    nextTargets: (sessionId: string) => Promise<NextSessionTargetRecord[]>;
    staleNextTargets: (sessionId: string) => Promise<Set<string>>;
    ruleResets: (sessionId: string) => Promise<NextSessionTargetRecord[]>;
    availability: () => Promise<CoachAvailability>;
    tapRuleReset: (sessionId: string, offer: NonNullable<NextTimeRowView['reset']>, tap: NextTimeTap) => Promise<{ status: 'written' | 'replayed' } | { status: 'not_possible'; reason: string }>;
    tapNextTarget: (row: NextSessionTargetRecord, tap: NextTimeTap, opId: string) => Promise<{ status: string; reason?: string }>;
  };
  nextTargetTapOpId: (row: NextSessionTargetRecord, tap: NextTimeTap) => string;
}

export interface BlockLiftDetail {
  view: LiftBlockDetailView;
  blockKey: string;
  /** `Next week` (a stalled lift): the next-time row of the lift's newest workout in the block; null: none to show. */
  next: { sessionId: string; row: NextTimeRowView; pain: boolean } | null;
}

export type BlockTapOutcome = { ok: true } | { ok: false; message: string };

export const BLOCK_SERVICE_COPY = {
  failed: 'Couldn’t save. Try again.',
  used: 'Already used.',
  changed: 'Changed since. Check it again.',
} as const;

/** Enough finished workouts to cover years of blocks (small rows, no decode). */
const REF_LIMIT = 4000;

function blockSessions(sessions: readonly ProgressSession[]): BlockSession[] {
  return sessions.map((s) => ({
    sessionId: s.sessionId,
    startedAtUtc: s.startedAtUtc,
    date: s.date,
    exercises: s.exercises.map((e) => ({ exerciseId: e.exerciseId, exerciseName: e.exerciseName, equipmentKind: e.equipmentKind, convention: e.convention, unit: e.unit, measurement: e.measurement, sets: e.sets })),
  }));
}

export function createBlockProgressService(deps: BlockProgressDeps) {
  const repos = () => deps.store().repos;

  /** The plan in use's main lift per day (its templates', so a swapped main lift reads as it now is). */
  async function mainLiftsNow(ownerId: string): Promise<string[] | null> {
    const plan = await repos().planDrafts.applied(ownerId).catch(() => null);
    if (plan === null) return null;
    const days = planRoutines(plan, liveRoutines(await repos().routines.listByOwner(ownerId).catch(() => [])));
    return days.flatMap((r) => {
      const main = r.planDay?.mainLiftExerciseId ?? r.exercises.find((e) => e.main === true)?.exerciseId ?? null;
      return main === null ? [] : [main];
    });
  }

  async function read(): Promise<{ p: UserProfile; blocks: TrainingBlock[]; sessions: BlockSession[]; nameOf: (id: string) => string } | null> {
    const p = await deps.profile();
    if (p === null) return null;
    const nowMs = toMs(deps.now().utc);
    const [plans, applied, projected, mains] = await Promise.all([repos().planDrafts.listByOwner(p.id), repos().planDrafts.applied(p.id).catch(() => null), deps.projected(), mainLiftsNow(p.id)]);
    // Imported and past-logged workouts linked to the plan in use count for it (as Today's header reads them).
    const refs = await planRefs(deps.store(), { ownerId: p.id, plan: applied, nowMs }, REF_LIMIT).catch(() => []);
    const blocks = trainingBlocks(plans, refs, nowMs, p.timezone, mains);
    const names = projected?.nameOf ?? (() => null);
    return { p, blocks, sessions: blockSessions(projected?.sessions ?? []), nameOf: (id) => names(id) ?? '' };
  }

  return {
    /** A block's `This block` view (`key` null: the current block). Null: no such block (no plan applied yet). */
    async thisBlock(key: string | null = null): Promise<ThisBlockView | null> {
      const r = await read();
      if (r === null) return null;
      const b = blockOf(r.blocks, key);
      return b === null ? null : thisBlockView(b, r.sessions, r.nameOf, r.p.timezone);
    },

    /** Library › Plan's line under the week circles: `5 lifts up · 1 stalled`; null: nothing to say yet. */
    async planLine(): Promise<string | null> {
      const r = await read();
      if (r === null) return null;
      const b = blockOf(r.blocks, null);
      return b === null ? null : planBlockLine(thisBlockView(b, r.sessions, r.nameOf, r.p.timezone));
    },

    /** Every block kept, newest first, and one lift compared across them. Null: no profile. */
    async blocks(compareLift: string | null = null): Promise<BlocksView | null> {
      const r = await read();
      if (r === null) return null;
      return blocksView({ blocks: r.blocks, sessions: r.sessions, nameOf: r.nameOf, tz: r.p.timezone, compareLift });
    },

    /**
     * One lift's block detail; for a stalled lift in the current block, its `Next week` row. `coach`: the coach's
     * state from the AI connection (read by the caller, as on the Summary).
     */
    async liftDetail(key: string | null, exerciseId: string, coach: CoachStatus = 'not_connected'): Promise<BlockLiftDetail | null> {
      const r = await read();
      if (r === null) return null;
      const b = blockOf(r.blocks, key);
      if (b === null) return null;
      const view = liftBlockDetailView(liftInBlock(b, exerciseId, r.sessions, r.nameOf));
      const sessionId = view.latestSessionId;
      if (!view.stalled || !b.current || sessionId === null) return { view, blockKey: b.key, next: null };
      const next = await nextRow(r.p, sessionId, exerciseId, coach).catch(() => null);
      return { view, blockKey: b.key, next };
    },

    /** Apply / Skip / Undo on the `Next week` row: the Summary's own writes, against the row as read (rule 5). */
    async tapNext(sessionId: string, row: NextTimeRowView, tap: NextTimeTap): Promise<BlockTapOutcome> {
      if (!row.actions.some((a) => a.tap === tap)) return { ok: false, message: BLOCK_SERVICE_COPY.changed };
      const reset = row.reset;
      if (reset !== undefined) {
        const w = await deps.coach.tapRuleReset(sessionId, reset, tap).catch(() => null);
        if (w === null) return { ok: false, message: BLOCK_SERVICE_COPY.failed };
        return w.status === 'not_possible' ? { ok: false, message: w.reason === 'used' ? BLOCK_SERVICE_COPY.used : BLOCK_SERVICE_COPY.changed } : { ok: true };
      }
      if (row.row === null) return { ok: false, message: BLOCK_SERVICE_COPY.changed };
      const w = await deps.coach.tapNextTarget(row.row, tap, deps.nextTargetTapOpId(row.row, tap)).catch(() => null);
      if (w === null) return { ok: false, message: BLOCK_SERVICE_COPY.failed };
      return w.status === 'not_possible' ? { ok: false, message: w.reason === 'used' ? BLOCK_SERVICE_COPY.used : BLOCK_SERVICE_COPY.changed } : { ok: true };
    },
  };

  async function nextRow(p: UserProfile, sessionId: string, exerciseId: string, coach: CoachStatus): Promise<BlockLiftDetail['next']> {
    const summary = await deps.summary(sessionId, coach);
    if (summary === null) return null;
    const [coachRows, stale, ruleRows, availability, flags] = await Promise.all([
      deps.coach.nextTargets(sessionId).catch(() => []),
      deps.coach.staleNextTargets(sessionId).catch(() => new Set<string>()),
      deps.coach.ruleResets(sessionId).catch(() => []),
      deps.coach.availability(),
      repos().painFlags.listActive(p.id).catch(() => []),
    ]);
    const view = nextTimeView({ title: summary.title, builtIn: summary.nextTime, from: summary.nextFrom, coachRows, ruleRows, stale, availability, reviewing: false });
    const row = view?.rows.find((x) => x.row?.exerciseId === exerciseId || x.reset?.exerciseId === exerciseId || x.key === exerciseId) ?? null;
    if (row === null) return null;
    // (Rule 9) A pain flag on the lift: no fix is offered to apply.
    const pain = flags.some((f) => f.exerciseId === exerciseId);
    return { sessionId, row: pain ? { ...row, actions: row.actions.filter((a) => a.tap === 'undo') } : row, pain };
  }
}

export type BlockProgressService = ReturnType<typeof createBlockProgressService>;
