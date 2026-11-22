import { asksReasons, DEFAULT_CHECK_IN_SETTINGS } from '@fizz/domain';
import type { CheckIn, CheckInScore } from '@fizz/schemas';

/**
 * The check-in score tapped before Start (check-in CI4), first made for the
 * Workout overview (retired 22 Oct) and used by Your workout's check-in
 * sheet: the score is saved at once (one opId, versioned), and a low score
 * opens What's up? before Start. Pure apart from the ports.
 */

/** How a score tap ended, as Start sees it (review r2 S1): `reasons` opened What's up? over the page. */
export type ScoreStep = 'saved' | 'reasons' | 'not_saved';

/** What a finished score write means for Start: a saved score at or below the What's up? setting opens the reasons step. */
export function scoreStepOf(r: ScoreResult, score: CheckInScore): ScoreStep {
  if (r.kind !== 'saved') return 'not_saved';
  return asksReasons(score, DEFAULT_CHECK_IN_SETTINGS) ? 'reasons' : 'saved';
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
