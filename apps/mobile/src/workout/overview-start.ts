import { asksReasons, DEFAULT_CHECK_IN_SETTINGS, type CheckInGate, type WorkoutOverview } from '@fizz/domain';
import type { CheckIn, CheckInScore, SessionCheckIn } from '@fizz/schemas';

import type { OverviewData, OverviewStartOf, OverviewTarget, WorkoutStartOutcome } from '../services/workout-services';
import { checkInForStart, OVERVIEW_COPY, startFailure } from './overview';
import { TODAY_EDITS_COPY } from './overview-edits';

/**
 * The Workout overview's writes, as plain async functions over the services
 * they call (workout-overview §2.2, §7; review B1, S2, S7). No React and no
 * navigation, so they run against real SQLite in tests; the screen only
 * holds the opIds, guards and what to show.
 */

/**
 * One write at a time (a ref on the screen, not state, so two taps in one
 * frame can't both pass): a call while another runs is dropped and returns
 * null. A double tap acts once.
 */
export function createGuard(): { run: <R>(fn: () => Promise<R>) => Promise<R | null>; running: () => boolean } {
  let inFlight = false;
  return {
    running: () => inFlight,
    async run<R>(fn: () => Promise<R>): Promise<R | null> {
      if (inFlight) return null;
      inFlight = true;
      try {
        return await fn();
      } finally {
        inFlight = false;
      }
    },
  };
}

/**
 * Whether two reads of the page show Ben the same thing: everything but the
 * key. A stale Start whose re-read is the same page starts silently (B1):
 * the key moved (a score saved just before Start, `Done` in What's up?) but
 * nothing he saw did, so `Targets updated` would be untrue.
 */
export function samePage(a: WorkoutOverview, b: WorkoutOverview): boolean {
  return JSON.stringify({ ...a, previewKey: '' }) === JSON.stringify({ ...b, previewKey: '' });
}

/**
 * The gym the overview plans at (Coach v3 review B2, Ben 18 Oct "in my hotel gym"): a gym Ben
 * picked on this page with the gym switcher; else, for a coach draft, the gym it was built at while
 * that gym is still saved (`draftGym`); else the gym in use. Start sends the page's gym, so the
 * workout runs and is filed there too.
 */
export async function overviewGymId(ports: { draftGym: (draftId: string) => Promise<string | null>; currentGym: () => Promise<string | null> }, target: OverviewTarget, picked: string | null): Promise<string | null> {
  if (picked !== null) return picked;
  if (target.kind === 'coach_draft') {
    const own = await ports.draftGym(target.draftId).catch(() => null);
    if (own !== null) return own;
  }
  return ports.currentGym().catch(() => null);
}

export type OverviewStartResult =
  | { kind: 'started'; outcome: Extract<WorkoutStartOutcome, { ok: true }> }
  /** Nothing was created; `page` is the re-read (null if it couldn't be read). The screen shows `Targets updated`. */
  | { kind: 'stale'; page: OverviewData | null }
  | { kind: 'active' }
  | { kind: 'failed' };

export interface OverviewStartPorts {
  start: (req: { startOf: OverviewStartOf; gymId: string | null; opId: string; checkIn: SessionCheckIn | null; expectedPreviewKey: string; draft: { id: string; expectedVersion: number } | null }) => Promise<WorkoutStartOutcome>;
  /** Re-read the page with the check-in Start sends (the tapped or reused one). */
  reload: () => Promise<OverviewData | null>;
}

/**
 * `Start workout` (§7): one opId across the first try, a silent retry and
 * any later tap (OV5). A stale key whose re-read shows the same page starts
 * at once with the fresh key and the same opId; a changed page creates
 * nothing and comes back for the toast and re-render (rule 5).
 */
export async function startFromOverview(ports: OverviewStartPorts, req: { page: OverviewData; opId: string; checkIn: SessionCheckIn | null }): Promise<OverviewStartResult> {
  const draftOf = (page: OverviewData) => (page.draft === null ? null : { id: page.draft.id, expectedVersion: page.draft.version });
  const base = { startOf: req.page.startOf, gymId: req.page.view.gym?.id ?? null, opId: req.opId, checkIn: req.checkIn };
  // Today's edits go with Start (ADR 0022): the draft the page showed, re-checked in the start's write.
  let r = await ports.start({ ...base, expectedPreviewKey: req.page.view.previewKey, draft: draftOf(req.page) });
  if (!r.ok && r.error.code === 'stale_preview') {
    // This read is the one that closes a draft past midnight (`cleared`): its page is the one returned, never a second read (review S2).
    const fresh = await ports.reload().catch(() => null);
    if (fresh === null || fresh.cleared || fresh.view.previewKey === req.page.view.previewKey || !samePage(req.page.view, fresh.view) || (fresh.view.gym?.id ?? null) !== base.gymId) return { kind: 'stale', page: fresh };
    r = await ports.start({ ...base, startOf: fresh.startOf, expectedPreviewKey: fresh.view.previewKey, draft: draftOf(fresh) });
    if (!r.ok && r.error.code === 'stale_preview') return { kind: 'stale', page: await ports.reload().catch(() => null) };
  }
  if (r.ok) return { kind: 'started', outcome: r };
  const failure = startFailure(r.error.code);
  // A stale result here means the re-read was still the same page and failed again: say so rather than loop.
  return failure.kind === 'stale' ? { kind: 'stale', page: null } : failure;
}

/**
 * The toast after a stale Start (§3, TE5): `Earlier edits cleared` when the
 * re-read closed the draft at midnight, else `Targets updated`.
 */
export function staleStartToast(page: Pick<OverviewData, 'cleared'> | null, copy: { stale: string; cleared: string } = { stale: OVERVIEW_COPY.stale, cleared: TODAY_EDITS_COPY.earlierCleared }): string {
  return page?.cleared === true ? copy.cleared : copy.stale;
}

/** How a score tap on the page ended, as Start sees it (review r2 S1): `reasons` opened What's up? over the page. */
export type ScoreStep = 'saved' | 'reasons' | 'not_saved';

/** What a finished score write means for Start: a saved score at or below the What's up? setting opens the reasons step. */
export function scoreStepOf(r: ScoreResult, score: CheckInScore): ScoreStep {
  if (r.kind !== 'saved') return 'not_saved';
  return asksReasons(score, DEFAULT_CHECK_IN_SETTINGS) ? 'reasons' : 'saved';
}

export type StartCheckInDecision =
  | { kind: 'send'; checkIn: SessionCheckIn | null }
  /** A score write still running at the tap opened What's up?: Start stops, so the reasons step (and any pain) comes first. */
  | { kind: 'reasons_open' };

export interface StartCheckInPorts {
  /** The check-in gate now (`services.checkIns.gate`). */
  gate: () => Promise<CheckInGate>;
  /** The score tapped on this page, read after the pending write has landed. */
  tapped: () => CheckIn | null;
}

/**
 * The check-in step of `Start workout` (§2.2; review r2 B1, S1, S4). `pending`
 * is the score write that was still running when Start was tapped (null if
 * none): Start waits for it, and stops if it opened What's up?. Then the gate
 * is re-read, so a check-in saved in the `Check-in ›` sheet is linked even
 * if the page hasn't reloaded yet; the preview key check then catches any row
 * it changes (a pain mention holds loads).
 */
export async function checkInAtStart(ports: StartCheckInPorts, req: { rendered: OverviewData['checkIn']; pending: Promise<ScoreStep | null> | null; nowUtc: () => string }): Promise<StartCheckInDecision> {
  if (req.pending !== null) {
    const step = await req.pending.catch(() => null);
    if (step === 'reasons') return { kind: 'reasons_open' };
  }
  const tapped = ports.tapped();
  const gateNow = tapped === null && req.rendered.kind !== 'skip' ? await ports.gate().catch(() => null) : null;
  return { kind: 'send', checkIn: checkInForStart({ rendered: req.rendered, tapped, gateNow, nowUtc: req.nowUtc() }) };
}

export type ScoreResult =
  | { kind: 'saved'; checkIn: CheckIn }
  /** Changed elsewhere (a stale version): re-read rather than guess (rule 5). */
  | { kind: 'stale' }
  | { kind: 'failed'; message: string };

export interface ScorePorts {
  record: (req: { checkInId: string; opId: string; score: CheckInScore }) => Promise<{ ok: true; checkIn: CheckIn } | { ok: false; message: string }>;
  update: (checkInId: string, patch: { score: CheckInScore }, expectedVersion: number, opId: string) => Promise<{ ok: true; checkIn: CheckIn } | { ok: false; message: string; stale?: boolean }>;
  newOpId: () => string;
}

/**
 * A tile tapped on the page (CI4): saved at once. The first score creates
 * the page's check-in (its ID and opId, so a retry writes one); a different
 * score later updates it at its version. The screen disables the tiles
 * while this runs (S7), so taps never race on one opId.
 */
export async function saveScore(ports: ScorePorts, req: { current: CheckIn | null; score: CheckInScore; checkInId: string; opId: string }): Promise<ScoreResult> {
  try {
    if (req.current === null) {
      const r = await ports.record({ checkInId: req.checkInId, opId: req.opId, score: req.score });
      return r.ok ? { kind: 'saved', checkIn: r.checkIn } : { kind: 'failed', message: r.message };
    }
    if (req.current.score === req.score) return { kind: 'saved', checkIn: req.current };
    const r = await ports.update(req.current.id, { score: req.score }, req.current.version, ports.newOpId());
    if (r.ok) return { kind: 'saved', checkIn: r.checkIn };
    return r.stale === true ? { kind: 'stale' } : { kind: 'failed', message: r.message };
  } catch (e) {
    return { kind: 'failed', message: e instanceof Error ? e.message : String(e) };
  }
}

export type EmptyStartResult = { kind: 'started' } | { kind: 'ask'; gymId: string } | { kind: 'active' } | { kind: 'failed' };

export interface EmptyStartPorts {
  /** The selected gym, or the typical gym saved now (no gym yet). Null: couldn't. */
  ensureGym: () => Promise<string | null>;
  gate: () => Promise<CheckInGate>;
  start: (req: { gymId: string; opId: string; checkIn: SessionCheckIn | null }) => Promise<WorkoutStartOutcome>;
}

/**
 * `Empty workout` from the overview's menu or its load-failed state (S2):
 * one opId per page, so a double tap or a retry starts one workout. A due
 * check-in opens the check-in sheet (which starts it); a reused one is linked.
 */
export async function startEmptyFromOverview(ports: EmptyStartPorts, opId: string): Promise<EmptyStartResult> {
  try {
    const gymId = await ports.ensureGym();
    if (gymId === null) return { kind: 'failed' };
    const gate = await ports.gate();
    if (gate.kind === 'ask') return { kind: 'ask', gymId };
    const checkIn: SessionCheckIn | null =
      gate.kind === 'reuse' ? { kind: 'answered', checkInId: gate.checkInId } : gate.reason === 'off' || gate.reason === 'not_a_check_in_day' ? { kind: 'not_asked', reason: gate.reason } : null;
    const r = await ports.start({ gymId, opId, checkIn });
    if (r.ok) return { kind: 'started' };
    return r.error.code === 'session_already_active' ? { kind: 'active' } : { kind: 'failed' };
  } catch {
    return { kind: 'failed' };
  }
}

/**
 * The gym toast's `Undo` (OV12; review merge N3): selects the previous gym
 * again. Returns the message to show when that fails (the gym is gone, or
 * the write failed), null when it worked.
 */
export async function undoGymSwitch(select: (gymId: string) => Promise<{ ok: true } | { ok: false; message: string }>, previousGymId: string): Promise<string | null> {
  const r = await select(previousGymId).catch(() => null);
  if (r === null) return 'Couldn’t switch back.';
  return r.ok ? null : r.message;
}
