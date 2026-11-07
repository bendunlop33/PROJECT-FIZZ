import { sessionCheckInForSkip, type CheckInGate, type OverviewCoach, type OverviewRow, type WorkoutOverview } from '@fizz/domain';
import type { CheckIn, CheckInScore, NextSessionTargetRecord, SessionCheckIn } from '@fizz/schemas';

import type { NextTimeTap } from '../src/coach/next-time-view';
import type { OverviewData, OverviewStartOf, OverviewTarget, WorkoutStartOutcome } from '../src/services/workout-services';
import type { ScoreStep } from '../src/workout/check-in-score';
import type { RepsDraft } from '../src/workout/reps-draft';

/**
 * Test driver for the Workout overview's service layer (`services.overview`,
 * today's edits, the coach's next-target rows), kept in the app until its own
 * clean-up slice. The overview screen and its screen-side helpers were retired
 * (Ben, 22 Oct: every pre-start page is the builder's Your workout); these are
 * the helpers' last versions, so the service tests drive Start and the toasts
 * exactly as the screen did. Test code only: nothing in `src` imports it.
 */

export const editToast = {
  planChanged: (n: number) => `Plan changed · ${String(n)} ${n === 1 ? 'edit' : 'edits'} removed`,
} as const;

/** The inline check-in row (§3.9) as the page holds it: the score shown selected and the record behind it. */
export interface CheckInRowState {
  /** Null: no row (not due). */
  shown: boolean;
  selected: CheckInScore | null;
  record: CheckIn | null;
}

/** From the loaded page: the reused check-in pre-selected, or nothing selected; a score tapped on this page wins. */
export function checkInRow(gate: OverviewData['checkIn'], tapped: CheckIn | null): CheckInRowState {
  if (tapped !== null) return { shown: true, selected: tapped.score, record: tapped };
  if (gate.kind === 'reuse') return { shown: true, selected: gate.checkIn.score, record: gate.checkIn };
  if (gate.kind === 'ask') return { shown: true, selected: null, record: null };
  return { shown: false, selected: null, record: null };
}

/**
 * What Start sends as the check-in (§2.2): the score on the page (tapped or
 * reused) is linked; a due check-in left alone is `skipped`; a gate that
 * didn't ask records why.
 */
export function startCheckIn(gate: OverviewData['checkIn'], row: CheckInRowState, nowUtc: string): SessionCheckIn | null {
  if (row.record !== null) return { kind: 'answered', checkInId: row.record.id };
  if (gate.kind === 'skip') return sessionCheckInForSkip(gate.reason);
  return { kind: 'skipped', atUtc: nowUtc };
}

/**
 * The check-in Start sends, decided after any score write has landed
 * (§2.2; review r2 B1). `gateNow` is the check-in gate re-read at Start: a
 * check-in made in the `Check-in ›` sheet (AX sizes) is only on the page
 * after its reload, so a Start before that reload would send `skipped` and
 * plan without it. The gate finds it (unlinked, under 2 h) and it is linked.
 * - a score tapped on this page wins;
 * - else a reusable check-in now (the sheet's, or the one the page showed);
 * - else what the rendered page says. A reused check-in the page showed
 *   selected stands even if it aged past 2 h while the page was open (N1).
 * `gateNow` null: the re-read failed, so the rendered page decides.
 */
export function checkInForStart(p: { rendered: OverviewData['checkIn']; tapped: CheckIn | null; gateNow: CheckInGate | null; nowUtc: string }): SessionCheckIn | null {
  if (p.tapped !== null) return { kind: 'answered', checkInId: p.tapped.id };
  if (p.gateNow?.kind === 'reuse' && p.rendered.kind !== 'skip') return { kind: 'answered', checkInId: p.gateNow.checkInId };
  return startCheckIn(p.rendered, checkInRow(p.rendered, null), p.nowUtc);
}

export type StartFailure = { kind: 'stale' } | { kind: 'active' } | { kind: 'failed' };

/** How the page reacts to a Start that didn't create a session (§8). */
export function startFailure(code: string): StartFailure {
  if (code === 'stale_preview') return { kind: 'stale' };
  if (code === 'session_already_active') return { kind: 'active' };
  return { kind: 'failed' };
}

/**
 * The coach row's pill and the `Next time` tap it sends (§5): `Undo` on the
 * coach's target; after it, `Use coach target` (a small change) or `Apply`
 * (a bigger change, also one Ben applied and then undid; review merge S1).
 */
export function coachPill(coach: OverviewCoach): { label: 'Undo' | 'Use coach target' | 'Apply'; tap: NextTimeTap } {
  if (coach.state === 'coach') return { label: 'Undo', tap: 'undo' };
  return coach.putBack === 'apply' ? { label: 'Apply', tap: 'apply' } : { label: 'Use coach target', tap: 'use_coach' };
}

/**
 * The tap the Undo toast's own `Undo` sends: back to how the row was.
 * `status`: the row's status before the Undo (`applied` goes back through `apply`).
 */
export function coachTapOf(state: 'coach' | 'built_in', status: NextSessionTargetRecord['status']): NextTimeTap {
  if (state === 'coach') return 'undo';
  return status === 'applied' || status === 'proposed' ? 'apply' : 'use_coach';
}

/** The toast after Undo on a coach row (§5). */
export function coachUndoneText(exerciseName: string): string {
  return `${exerciseName} · coach target undone`;
}

export const OVERVIEW_COPY = {
  start: 'Start workout',
  close: 'Close',
  addGym: 'Add gym',
  noGym: 'No gym · typical equipment',
  stale: 'Targets updated',
  startFailed: 'Couldn’t start. Try again.',
  loadFailed: 'Couldn’t load this workout.',
  tryAgain: 'Try again',
  emptyWorkout: 'Empty workout',
  rename: 'Rename',
  delete: 'Delete',
  checkIn: 'Check-in',
  target: 'Target',
  superset: 'Superset',
  time: 'Time',
  doneBy: 'Done by',
  sets: 'Sets',
  stillHurts: 'Still hurts?',
  howTo: 'How to',
  why: 'Why?',
  editGym: 'Edit gym',
} as const;

/**
 * Screen-side rules for today's edits on the Workout overview
 * (overview-today-edits.md §2–§5). Pure, so they run on Linux. They decide
 * what the page shows and sends from what the domain already worked out
 * (`row.actions`, `row.edit`, the Swap sheet's rows); they never apply an
 * edit, rank a candidate or compute a target.
 */

export const TODAY_EDITS_COPY = {
  swapToday: 'Swap today',
  skipToday: 'Skip today',
  doFirst: 'Do first',
  undoSwap: 'Undo swap',
  swapAgain: 'Swap again',
  bringBack: 'Bring back',
  reorder: 'Reorder',
  resetEdits: 'Reset today’s edits',
  resetOrder: 'Reset order',
  done: 'Done',
  skippedSuffix: '· skipped',
  planned: 'planned',
  noHistory: 'No history',
  mayHurt: 'May hurt',
  close: 'Close',
  changeTitle: (routineName: string) => `Change ${routineName}`,
  changeLink: (routineName: string) => `Change ${routineName} too ›`,
  scope: (routineName: string) => `${routineName} from now on`,
  changed: 'Changed',
  notNow: 'Not now',
  apply: 'Apply',
  applied: (routineName: string) => `✓ Applied · ${routineName} from now on`,
  undo: 'Undo',
  wasSuggested: 'Was suggested:',
  dismiss: 'Dismiss',
  earlierCleared: 'Earlier edits cleared',
  /** A coach change Ben applied that the overview's checks refused at this gym (review S1). */
  coachRefused: 'Coach change didn’t fit here',
  coachLanded: 'Coach change applied',
  editFailed: 'Couldn’t save that edit.',
} as const;

type ToastPage = { cleared: boolean; removedEdits: number; draft: { id: string; version: number } | null; coachRefused?: number; coachLanded?: number };

/**
 * Every toast a fresh page asks for, in the order they show (one after another,
 * so none is dropped; merge r3 S1): `Earlier edits cleared`, `Coach change didn’t fit here`,
 * `Coach change applied`, `Plan changed · N edits removed`. Keyed toasts show once per draft version.
 */
export function pageToasts(page: ToastPage, shown: ReadonlySet<string>): { key: string; text: string }[] {
  const out: { key: string; text: string }[] = [];
  if (page.cleared) out.push({ key: 'cleared', text: TODAY_EDITS_COPY.earlierCleared });
  if ((page.coachRefused ?? 0) > 0 && !shown.has('coach-refused')) out.push({ key: 'coach-refused', text: TODAY_EDITS_COPY.coachRefused });
  // A refused coach change that landed on this load (merge r2 S2): once per landing.
  if ((page.coachLanded ?? 0) > 0 && page.draft !== null) {
    const key = `coach-landed:${page.draft.id}:${String(page.draft.version)}`;
    if (!shown.has(key)) out.push({ key, text: TODAY_EDITS_COPY.coachLanded });
  }
  // Cleared edits leave nothing to report as removed.
  if (!page.cleared && page.removedEdits > 0 && page.draft !== null) {
    const key = `removed:${page.draft.id}:${String(page.draft.version)}`;
    if (!shown.has(key)) out.push({ key, text: editToast.planChanged(page.removedEdits) });
  }
  return out;
}

/** The first toast a fresh page asks for (see `pageToasts`). */
export function pageToast(page: ToastPage, shown: ReadonlySet<string>): { key: string; text: string } | null {
  return pageToasts(page, shown)[0] ?? null;
}

/** The sheet as it opens: the row's reps (or work time; time and distance for cardio) today. */
export function repsDraftOf(row: Pick<OverviewRow['editRow'], 'reps' | 'durationS' | 'timed'> & Partial<Pick<OverviewRow['editRow'], 'cardio' | 'distanceM'>>): RepsDraft {
  if (row.cardio === true) return { kind: 'cardio', seconds: row.durationS, distanceM: row.distanceM ?? null };
  if (row.timed || (row.reps === null && row.durationS !== null)) return { kind: 'time', seconds: row.durationS ?? 45 };
  const r = row.reps ?? { min: 8, max: 12 };
  return { kind: 'reps', exact: r.min === r.max, min: r.min, max: r.max };
}

export type RepsPayload = { kind: 'clear' } | { kind: 'reps'; reps: { min: number; max: number } | null; durationS: number | null; distanceM?: number | null };

/** `Done` (§11.4): one `reps` edit, or a clear when the sheet is back at the plan's own. A cardio edit always carries its distance (null: none). */
export function repsPayload(d: RepsDraft, planned: OverviewRow['editRow']['plannedReps']): RepsPayload {
  if (d.kind === 'cardio') return planned.reps === null && planned.durationS === d.seconds && (planned.distanceM ?? null) === d.distanceM ? { kind: 'clear' } : { kind: 'reps', reps: null, durationS: d.seconds, distanceM: d.distanceM };
  if (d.kind === 'time') return planned.reps === null && planned.durationS === d.seconds ? { kind: 'clear' } : { kind: 'reps', reps: null, durationS: d.seconds };
  const same = planned.reps !== null && planned.reps.min === d.min && planned.reps.max === d.max;
  return same ? { kind: 'clear' } : { kind: 'reps', reps: { min: d.min, max: d.max }, durationS: null };
}

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
      gate.kind === 'reuse' ? { kind: 'answered', checkInId: gate.checkInId } : sessionCheckInForSkip(gate.reason);
    const r = await ports.start({ gymId, opId, checkIn });
    if (r.ok) return { kind: 'started' };
    return r.error.code === 'session_already_active' ? { kind: 'active' } : { kind: 'failed' };
  } catch {
    return { kind: 'failed' };
  }
}
