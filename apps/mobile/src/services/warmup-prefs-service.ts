import { deriveId, warmupPrefsAfter, warmupPrefsOf, warmupPrefsRevert, type ResolvedWarmupPrefs } from '@fizz/domain';
import type { CommandOf, Exercise, SessionCommand, TrainingChange, UpdateWarmupPrefsArgs, WarmupPrefs, ZonedTimestamp } from '@fizz/schemas';
import type { PreparedWarmupPrefs } from '@fizz/coach';

import type { TrainingService } from './training-service';

/**
 * (Ben, 1 Nov) Warm-up preferences: Profile › Training › `Simple warm-up weights`, and the coach's
 * `update_warmup_prefs`. Your data, local only, no AI. One versioned training-profile change on the version the screen
 * showed (rule 5); the open workout's not-yet-done warm-ups are planned again under the new preferences (an
 * `adjust_pending_targets` under one action ID), so one Undo puts back both. Logged sets never change (rule 2).
 * Nothing is computed in a screen.
 */

export interface WarmupPrefsServiceDeps {
  training: Pick<TrainingService, 'snapshot' | 'change'>;
  /** The open workout's warm-ups planned again under `prefs` (`workout.warmupPrefsCommand`); null: none open or nothing changes. */
  replan: (prefs: ResolvedWarmupPrefs, op: { opId: string; actionId: string; at: ZonedTimestamp }) => Promise<{ sessionId: string; command: CommandOf<'adjust_pending_targets'> } | null>;
  dispatch: (sessionId: string, command: SessionCommand) => Promise<{ ok: boolean }>;
  /** Ben's exercises and the catalogue's, for the coach's names. */
  exercises: () => Promise<readonly Exercise[]>;
  now: () => ZonedTimestamp;
}

export interface WarmupPrefsView {
  simpleLoads: boolean;
  /** The training profile version the switch writes on. */
  version: number;
}

/** What Ben's switch changed, for its Undo. */
export interface WarmupPrefsUndo {
  before: WarmupPrefs | null;
  after: WarmupPrefs | null;
  actionId: string;
  sessionId: string | null;
  removedSetIds: string[];
}

export type WarmupPrefsWrite = { ok: true; view: WarmupPrefsView; undo: WarmupPrefsUndo; replanned: number } | { ok: false; reason: 'stale' | 'failed' };

export const WARMUP_PREFS_COPY = {
  simpleLoads: 'Simple warm-up weights',
} as const;

/** The coach's lines for a change: `Simple warm-up weights on`, `Face pull: no warm-ups`. */
function linesOf(change: Extract<TrainingChange, { kind: 'warmup_prefs' }>, names: ReadonlyMap<string, string>): string[] {
  const out: string[] = [];
  if (change.simpleLoads !== undefined) out.push(`${WARMUP_PREFS_COPY.simpleLoads} ${change.simpleLoads ? 'on' : 'off'}`);
  for (const [id, v] of Object.entries(change.perExercise ?? {})) {
    const name = names.get(id) ?? 'Exercise';
    out.push(`${name}: ${v === 'off' ? 'no warm-ups' : v === 'normal' ? 'warm-ups on' : 'usual warm-ups'}`);
  }
  return out;
}

export function createWarmupPrefsService(deps: WarmupPrefsServiceDeps) {
  async function apply(change: Extract<TrainingChange, { kind: 'warmup_prefs' }>, expectedVersion: number, opId: string): Promise<WarmupPrefsWrite> {
    const snap = await deps.training.snapshot().catch(() => null);
    if (snap === null) return { ok: false, reason: 'failed' };
    if (snap.profile.version !== expectedVersion) return { ok: false, reason: 'stale' };
    const before = snap.profile.warmups ?? null;
    const after = warmupPrefsAfter(before, change);
    const r = await deps.training.change(change, expectedVersion, opId);
    if (!r.ok) return { ok: false, reason: r.reason === 'stale' ? 'stale' : 'failed' };
    const actionId = deriveId(`warmup-prefs:${opId}`);
    // The workout's own write after the profile's: a workout that moved on keeps its warm-ups (they follow on display).
    const replan = await deps.replan(warmupPrefsOf(r.profile), { opId: `${opId}:warmups`, actionId, at: deps.now() }).catch(() => null);
    let sessionId: string | null = null;
    let removedSetIds: string[] = [];
    let replanned = 0;
    if (replan !== null) {
      const d = await deps.dispatch(replan.sessionId, replan.command).catch(() => ({ ok: false }));
      if (d.ok) {
        sessionId = replan.sessionId;
        removedSetIds = [...replan.command.removeSetIds];
        replanned = replan.command.changes.length + replan.command.removeSetIds.length;
      }
    }
    return { ok: true, view: { simpleLoads: warmupPrefsOf(r.profile).simpleLoads, version: r.profile.version }, undo: { before, after, actionId, sessionId, removedSetIds }, replanned };
  }

  return {
    async view(): Promise<WarmupPrefsView | null> {
      const snap = await deps.training.snapshot().catch(() => null);
      return snap === null ? null : { simpleLoads: warmupPrefsOf(snap.profile).simpleLoads, version: snap.profile.version };
    },

    /** Ben's switch: `Simple warm-up weights` on or off, on the version shown. */
    setSimpleLoads(on: boolean, expectedVersion: number, opId: string): Promise<WarmupPrefsWrite> {
      return apply({ kind: 'warmup_prefs', simpleLoads: on }, expectedVersion, opId);
    },

    /** Undo of Ben's switch: the preferences back, and the warm-ups it planned again that are still pending. */
    async undo(u: WarmupPrefsUndo, opId: string): Promise<{ ok: boolean; view: WarmupPrefsView | null }> {
      const snap = await deps.training.snapshot().catch(() => null);
      if (snap === null) return { ok: false, view: null };
      const r = await deps.training.change(warmupPrefsRevert(u.before, u.after), snap.profile.version, opId);
      if (!r.ok) return { ok: false, view: null };
      if (u.sessionId !== null) {
        const at = deps.now();
        await deps.dispatch(u.sessionId, { type: 'revert_target_adjustment', at, opId: `${opId}:warmups`, actionId: u.actionId, removedSetIds: u.removedSetIds, addedSetIds: [] }).catch(() => null);
      }
      return { ok: true, view: { simpleLoads: warmupPrefsOf(r.profile).simpleLoads, version: r.profile.version } };
    },

    /** `update_warmup_prefs`'s checks (the coach): exercises by name or ID among his, the change, and today's re-plan. */
    async prepare(args: UpdateWarmupPrefsArgs, at: { actionId: string; opId: string; nowUtc: string; tz: string }): Promise<{ ok: true; prepared: PreparedWarmupPrefs } | { ok: false; line: string }> {
      const snap = await deps.training.snapshot().catch(() => null);
      if (snap === null) return { ok: false, line: 'Your training details couldn’t be read.' };
      const all = await deps.exercises().catch(() => [] as readonly Exercise[]);
      const perExercise: Record<string, 'off' | 'normal' | null> = {};
      const names = new Map<string, string>();
      for (const e of args.exercises) {
        const want = e.exercise.trim().toLowerCase();
        const hit = all.find((x) => x.id === e.exercise) ?? all.find((x) => x.archivedAtUtc === undefined && x.name.toLowerCase() === want) ?? all.find((x) => x.archivedAtUtc === undefined && x.name.toLowerCase().includes(want));
        if (hit === undefined) return { ok: false, line: `No exercise called “${e.exercise.slice(0, 60)}”.` };
        perExercise[hit.id] = e.warmups === 'default' ? null : e.warmups;
        names.set(hit.id, hit.name);
      }
      const change: Extract<TrainingChange, { kind: 'warmup_prefs' }> = { kind: 'warmup_prefs', ...(args.simpleLoads === null ? {} : { simpleLoads: args.simpleLoads }), ...(Object.keys(perExercise).length === 0 ? {} : { perExercise }) };
      if (change.simpleLoads === undefined && change.perExercise === undefined) return { ok: false, line: 'Nothing to change.' };
      const before = snap.profile.warmups ?? null;
      const after = warmupPrefsAfter(before, change);
      const replan = await deps.replan(warmupPrefsOf({ warmups: after ?? undefined }), { opId: `${at.opId}:warmups`, actionId: at.actionId, at: { utc: at.nowUtc, tz: at.tz } }).catch(() => null);
      return {
        ok: true,
        prepared: {
          change,
          before,
          after,
          profileId: snap.profile.id,
          expectedVersion: snap.profile.version,
          lines: linesOf(change, names),
          session: replan === null ? null : { sessionId: replan.sessionId, command: replan.command, changedSetIds: replan.command.changes.map((c) => c.setId), removedSetIds: [...replan.command.removeSetIds] },
        },
      };
    },
  };
}

export type WarmupPrefsService = ReturnType<typeof createWarmupPrefsService>;
