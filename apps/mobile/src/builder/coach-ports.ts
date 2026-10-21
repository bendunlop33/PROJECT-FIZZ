import type { SetupFill } from '@fizz/coach';

import type { BuilderCoachSource, BuilderCoachWriter, SetupFrom } from '../coach/builder-coach-service';
import type { BuilderReviewSource } from '../coach/builder-review-provider';
import type { BuilderDayOption, BuilderService, SetupInput } from './builder-service';

/**
 * The builder coach's ports over the builder (workout-builder-v3 §2.6, §2.9,
 * §5): what the coach reads (`BuilderCoachSource`, `BuilderReviewSource`) and
 * the writes it asks for (`BuilderCoachWriter`), each through the builder's
 * own service so drafts keep `origin: 'builder'`, the codec and slot revisions.
 *
 * Set up's rows live on the page until `Next` (they aren't stored), so the
 * page registers itself here (`registerSetupPage`) and a checked fill is
 * applied to it at once with its Undo toast. From Today's bar the fill waits
 * here (`takePendingSetupFill`) and Set up opens with it, toast and Undo there
 * (§2.0.5 `opens the builder Set up filled`). Nothing here decides a rule.
 */

export interface SetupPageHandle {
  /** Set up's rows as they stand. */
  current: () => SetupInput | null;
  /** Apply a checked fill now, with `<toast> · Undo` (Undo puts `undo` back). */
  apply: (next: SetupInput, toast: string, undo: SetupInput) => void;
}

export interface PendingSetupFill {
  setup: SetupInput;
  toast: string;
  undo: SetupInput;
}

let page: SetupPageHandle | null = null;
let todayDayId: string | null = null;
let pending: PendingSetupFill | null = null;

/** Set up is open (and its rows are this handle's); the returned function unregisters it. */
export function registerSetupPage(h: SetupPageHandle): () => void {
  page = h;
  return () => {
    if (page === h) page = null;
  };
}

/** The day Today's card shows (Set up words asked from Today start from it). */
export function setTodaySetupDay(dayId: string | null): void {
  todayDayId = dayId;
}

/** A fill asked from Today, for Set up to open with (once). */
export function takePendingSetupFill(): PendingSetupFill | null {
  const p = pending;
  pending = null;
  return p;
}

export type BuilderCoachPortsBuilder = Pick<BuilderService, 'coachWorld' | 'reviewInputs' | 'coachSetupContext' | 'setupFromFill' | 'applyCoachWorkout' | 'coachApplied' | 'initialSetup'>;

export function createBuilderCoachPorts(builder: BuilderCoachPortsBuilder): { source: BuilderCoachSource; writer: BuilderCoachWriter; review: BuilderReviewSource } {
  // The Set up the last context was read from: a fill is applied to exactly that one.
  let asked: { from: SetupFrom; base: SetupInput; days: BuilderDayOption[] } | null = null;
  const done = new Set<string>();
  return {
    source: {
      world: (draftId) => builder.coachWorld(draftId),
      async setup(from) {
        const base = from === 'setup' ? (page?.current() ?? null) : await builder.initialSetup(todayDayId === null ? {} : { dayId: todayDayId }).catch(() => null);
        if (base === null) return null;
        const { ctx, days } = await builder.coachSetupContext(base);
        asked = { from, base, days };
        return ctx;
      },
    },
    writer: {
      applySetup(fill: SetupFill, opId: string, opts: { openBuilder: boolean }) {
        // A retry of the same ask: written once.
        if (done.has(opId)) return Promise.resolve({ ok: true });
        const a = asked;
        if (a === null) return Promise.resolve({ ok: false, reason: 'failed' });
        const next = builder.setupFromFill(fill.next, fill.changed, a.base, a.days);
        if (opts.openBuilder) {
          pending = { setup: next, toast: fill.toast, undo: a.base };
        } else {
          if (page === null) return Promise.resolve({ ok: false, reason: 'failed' });
          page.apply(next, fill.toast, a.base);
        }
        done.add(opId);
        return Promise.resolve({ ok: true });
      },
      applyWorkout: (req) => builder.applyCoachWorkout({ draftId: req.draftId, expectedVersion: req.expectedVersion, workout: req.workout, minutes: req.minutes, opId: req.opId, ...(req.nudge === true ? { nudge: true } : {}) }),
      applied: (opId) => builder.coachApplied(opId),
    },
    review: { inputs: (draftId) => builder.reviewInputs(draftId) },
  };
}
