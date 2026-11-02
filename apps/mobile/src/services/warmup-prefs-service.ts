import { cardioExerciseFor, deriveId, generalWarmupChangeLine, generalWarmupLine, mergeGeneralWarmups, warmupPrefsAfter, warmupPrefsOf, warmupPrefsRevert, type ResolvedWarmupPrefs } from '@fizz/domain';
import { GENERAL_WARMUP_DAYS, type CommandOf, type Exercise, type GeneralWarmupDays, type GeneralWarmupRule, type SessionCommand, type TrainingChange, type UpdateWarmupPrefsArgs, type WarmupPrefs, type ZonedTimestamp } from '@fizz/schemas';
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
  /**
   * (Ben, 2 Nov) A general warm-up's exercise saved as Ben's row when it is set (a catalogue entry, as `Add exercise`
   * does), so every Start finds it. Absent: not saved here (Start saves it then).
   */
  ensureExercise?: (exerciseId: string) => Promise<Exercise | null>;
  now: () => ZonedTimestamp;
}

export interface WarmupPrefsView {
  simpleLoads: boolean;
  /** The training profile version the switch writes on. */
  version: number;
  /** (Ben, 2 Nov) His general (cardio) warm-up rules; [] for none. */
  general: readonly GeneralWarmupRule[];
  /** (Ben, 2 Nov) Profile's line: `Leg days · Exercise bike 8 min · Other days · Rowing machine 4 min`, `Off`. */
  generalLine: string;
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
  /** (Ben, 2 Nov) Profile › Training's row and screen title for the general warm-up. */
  general: 'Cardio first',
  off: 'Off',
} as const;

/** The coach's lines for a change: `Simple warm-up weights on`, `Face pull: no warm-ups`, `Leg days: Exercise bike 8 min first`. */
function linesOf(change: Extract<TrainingChange, { kind: 'warmup_prefs' }>, names: ReadonlyMap<string, string>, before: WarmupPrefs | null): string[] {
  const out: string[] = [];
  if (change.simpleLoads !== undefined) out.push(`${WARMUP_PREFS_COPY.simpleLoads} ${change.simpleLoads ? 'on' : 'off'}`);
  for (const [id, v] of Object.entries(change.perExercise ?? {})) {
    const name = names.get(id) ?? 'Exercise';
    out.push(`${name}: ${v === 'off' ? 'no warm-ups' : v === 'normal' ? 'warm-ups on' : 'usual warm-ups'}`);
  }
  if (change.general !== undefined) {
    // (Ben, 2 Nov) Each kind of day whose rule changed, in order.
    const after = change.general ?? [];
    for (const days of ['all', 'legs', 'other'] as const) {
      const was = before?.general?.find((r) => r.days === days) ?? null;
      const now = after.find((r) => r.days === days) ?? null;
      if (JSON.stringify(was) === JSON.stringify(now)) continue;
      out.push(generalWarmupChangeLine(days, now, (id) => names.get(id) ?? 'Cardio'));
    }
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
    return { ok: true, view: await viewOf(r.profile), undo: { before, after, actionId, sessionId, removedSetIds }, replanned };
  }

  async function viewOf(profile: { version: number; warmups?: WarmupPrefs | undefined }): Promise<WarmupPrefsView> {
    const general = profile.warmups?.general ?? [];
    const all = general.length === 0 ? [] : await deps.exercises().catch(() => [] as readonly Exercise[]);
    const nameOf = (id: string) => all.find((e) => e.id === id)?.name ?? 'Cardio';
    return { simpleLoads: warmupPrefsOf(profile).simpleLoads, version: profile.version, general, generalLine: generalWarmupLine(general, nameOf) };
  }

  /** (Ben, 2 Nov) The cardio exercises a general warm-up can be (his and the catalogue's, not archived), by name. */
  async function cardioPool(): Promise<Exercise[]> {
    const all = await deps.exercises().catch(() => [] as readonly Exercise[]);
    return all.filter((e) => e.measurement === 'cardio' && e.archivedAtUtc === undefined).sort((a, b) => a.name.localeCompare(b.name));
  }

  return {
    async view(): Promise<WarmupPrefsView | null> {
      const snap = await deps.training.snapshot().catch(() => null);
      return snap === null ? null : viewOf(snap.profile);
    },

    /** (Ben, 2 Nov) Profile › Training › Cardio first: what each kind of day can have. */
    async cardioOptions(): Promise<{ id: string; name: string }[]> {
      return (await cardioPool()).map((e) => ({ id: e.id, name: e.name }));
    },

    /**
     * (Ben, 2 Nov) Ben's own general warm-up rules (Profile › Training › Cardio first), replacing the stored ones on the
     * version shown (null or []: none). Each exercise must be cardio; it is saved as his row first so Start finds it.
     */
    async setGeneral(rules: readonly GeneralWarmupRule[] | null, expectedVersion: number, opId: string): Promise<WarmupPrefsWrite> {
      const pool = await cardioPool();
      if ((rules ?? []).some((r) => !pool.some((e) => e.id === r.exerciseId))) return { ok: false, reason: 'failed' };
      for (const r of rules ?? []) await deps.ensureExercise?.(r.exerciseId).catch(() => null);
      return apply({ kind: 'warmup_prefs', general: rules === null || rules.length === 0 ? null : [...rules] }, expectedVersion, opId);
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
      return { ok: true, view: await viewOf(r.profile) };
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
      // (Ben, 2 Nov) General (cardio) warm-up rules: each kind of day's cardio exercise and minutes, merged into his.
      const before = snap.profile.warmups ?? null;
      let general: GeneralWarmupRule[] | null | undefined;
      if (args.general != null && args.general.length > 0) {
        const entries: { days: GeneralWarmupDays; exerciseId: string | null; minutes: number }[] = [];
        for (const g of args.general) {
          if (!GENERAL_WARMUP_DAYS.includes(g.days)) return { ok: false, line: 'Days must be legs, other or all.' };
          if (g.minutes <= 0) {
            entries.push({ days: g.days, exerciseId: null, minutes: 0 });
            continue;
          }
          const hit = cardioExerciseFor(g.exercise, all);
          if (hit === null) return { ok: false, line: `No cardio exercise called “${g.exercise.slice(0, 60)}”; use find_exercises for its catalogueId.` };
          names.set(hit.id, hit.name);
          entries.push({ days: g.days, exerciseId: hit.id, minutes: g.minutes });
        }
        const merged = mergeGeneralWarmups(before?.general, entries);
        general = merged.length === 0 ? null : merged;
        for (const r of merged) await deps.ensureExercise?.(r.exerciseId).catch(() => null);
        for (const r of before?.general ?? []) if (!names.has(r.exerciseId)) names.set(r.exerciseId, all.find((x) => x.id === r.exerciseId)?.name ?? 'Cardio');
      }
      const change: Extract<TrainingChange, { kind: 'warmup_prefs' }> = { kind: 'warmup_prefs', ...(args.simpleLoads === null ? {} : { simpleLoads: args.simpleLoads }), ...(Object.keys(perExercise).length === 0 ? {} : { perExercise }), ...(general === undefined ? {} : { general }) };
      if (change.simpleLoads === undefined && change.perExercise === undefined && change.general === undefined) return { ok: false, line: 'Nothing to change.' };
      const after = warmupPrefsAfter(before, change);
      const lines = linesOf(change, names, before).slice(0, 21);
      if (lines.length === 0) return { ok: false, line: 'No change: already set like that.' };
      const replan = await deps.replan(warmupPrefsOf({ warmups: after ?? undefined }), { opId: `${at.opId}:warmups`, actionId: at.actionId, at: { utc: at.nowUtc, tz: at.tz } }).catch(() => null);
      return {
        ok: true,
        prepared: {
          change,
          before,
          after,
          profileId: snap.profile.id,
          expectedVersion: snap.profile.version,
          lines,
          session: replan === null ? null : { sessionId: replan.sessionId, command: replan.command, changedSetIds: replan.command.changes.map((c) => c.setId), removedSetIds: [...replan.command.removeSetIds] },
        },
      };
    },
  };
}

export type WarmupPrefsService = ReturnType<typeof createWarmupPrefsService>;
