import type { CheckInGate, WorkoutOverview } from '@fizz/domain';
import type { CheckIn, CheckInScore, SessionCheckIn } from '@fizz/schemas';

import type { OverviewData, OverviewStartOf, WorkoutStartOutcome } from '../services/workout-services';
import { startFailure } from './overview';

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

export type OverviewStartResult =
  | { kind: 'started'; outcome: Extract<WorkoutStartOutcome, { ok: true }> }
  /** Nothing was created; `page` is the re-read (null if it couldn't be read). The screen shows `Targets updated`. */
  | { kind: 'stale'; page: OverviewData | null }
  | { kind: 'active' }
  | { kind: 'failed' };

export interface OverviewStartPorts {
  start: (req: { startOf: OverviewStartOf; gymId: string | null; opId: string; checkIn: SessionCheckIn | null; expectedPreviewKey: string }) => Promise<WorkoutStartOutcome>;
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
  const base = { startOf: req.page.startOf, gymId: req.page.view.gym?.id ?? null, opId: req.opId, checkIn: req.checkIn };
  let r = await ports.start({ ...base, expectedPreviewKey: req.page.view.previewKey });
  if (!r.ok && r.error.code === 'stale_preview') {
    const fresh = await ports.reload().catch(() => null);
    if (fresh === null || fresh.view.previewKey === req.page.view.previewKey || !samePage(req.page.view, fresh.view) || (fresh.view.gym?.id ?? null) !== base.gymId) return { kind: 'stale', page: fresh };
    r = await ports.start({ ...base, startOf: fresh.startOf, expectedPreviewKey: fresh.view.previewKey });
    if (!r.ok && r.error.code === 'stale_preview') return { kind: 'stale', page: await ports.reload().catch(() => null) };
  }
  if (r.ok) return { kind: 'started', outcome: r };
  const failure = startFailure(r.error.code);
  // A stale result here means the re-read was still the same page and failed again: say so rather than loop.
  return failure.kind === 'stale' ? { kind: 'stale', page: null } : failure;
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
