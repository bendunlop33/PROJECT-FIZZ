import type { FitView, OverviewRow, WorkoutOverview } from '@fizz/domain';

/**
 * Screen-side rules for fit to time on the Workout overview
 * (fit-to-time.md §3, §7). Pure, so they run on Linux. They decide what the
 * page shows and sends from what the domain worked out (`view.fit`,
 * `howLongSheet`, `row.edit`); they never trim, estimate or plan.
 */

export const FIT_COPY = {
  title: 'How long?',
  close: 'Close',
  clear: 'Clear fit',
  paceInfo: 'How this is worked out',
  yourPace: 'Your pace',
  undo: 'Undo',
  change: 'Change',
  why: 'Why? ›',
  showFit: 'Show the fit.',
  changeSpoken: 'Change how long',
  undoSpoken: (minutes: number) => `Undo the fit to ${String(minutes)} minutes`,
  fitted: 'fitted',
  toast: (minutes: number) => `Fitted to ${String(minutes)} min`,
  howLong: 'How long?',
  fitting: (minutes: number) => `Fitting to ${String(minutes)} min…`,
  cancel: 'Cancel',
  noAnswer: 'No answer from the coach',
  offline: 'Coach offline',
  couldntUse: 'Couldn’t use the coach’s version',
  planChanged: 'Plan changed',
  trimInstead: 'Trim instead',
  askAgain: 'Ask again',
  dismiss: 'Dismiss',
  todayOnly: 'Today only',
  apply: 'Apply',
  notNow: 'Not now',
  whyTitle: 'Why?',
  notUsed: 'Not used',
} as const;

/** The coach fit's own card while it works or after it didn't apply (§3.4, §6). Static: no animation. */
export type CoachFitCard =
  | { kind: 'pending'; minutes: number }
  | { kind: 'no_answer'; minutes: number }
  /** The coach couldn't be reached (not connected, or no network): `Coach offline` with its icon (FT-C9; review C S5). */
  | { kind: 'offline'; minutes: number }
  | { kind: 'rejected'; minutes: number; reasons: string[] }
  | { kind: 'plan_changed'; minutes: number };

/** The card's line and buttons (§6 states): `Trim instead` only where a trim to that length would cut something. */
export function coachFitCardView(card: CoachFitCard, trimWouldCut: boolean): { text: string; offline: boolean; actions: ('cancel' | 'trim' | 'why' | 'dismiss' | 'ask_again')[] } {
  switch (card.kind) {
    case 'pending':
      return { text: FIT_COPY.fitting(card.minutes), offline: false, actions: ['cancel'] };
    case 'no_answer':
      return { text: FIT_COPY.noAnswer, offline: false, actions: [...(trimWouldCut ? (['trim'] as const) : []), 'dismiss'] };
    case 'offline':
      return { text: FIT_COPY.offline, offline: true, actions: [...(trimWouldCut ? (['trim'] as const) : []), 'dismiss'] };
    case 'rejected':
      return { text: FIT_COPY.couldntUse, offline: false, actions: ['why', ...(trimWouldCut ? (['trim'] as const) : []), 'dismiss'] };
    case 'plan_changed':
      return { text: FIT_COPY.planChanged, offline: false, actions: ['ask_again', 'dismiss'] };
  }
}

/** What a coach fit's outcome leaves on the page (§6): its own card, or nothing (applied: the FitCard; cancelled: nothing). */
export function coachFitCardOf(outcome: { kind: 'applied' | 'rejected' | 'timeout' | 'plan_changed' | 'unavailable' | 'cancelled' | 'failed'; reasons?: string[] }, minutes: number): CoachFitCard | null {
  switch (outcome.kind) {
    case 'applied':
    case 'cancelled':
      return null;
    case 'rejected':
      return { kind: 'rejected', minutes, reasons: outcome.reasons ?? [] };
    case 'plan_changed':
      return { kind: 'plan_changed', minutes };
    case 'unavailable':
      return { kind: 'offline', minutes };
    case 'timeout':
    case 'failed':
      return { kind: 'no_answer', minutes };
  }
}

/** The TIME tile as a button (§3.1, design-system §9.65 addendum): `≈ 44 min ▾` over `TIME · FIT 45` (clock) or `TIME`. */
export function timeTile(view: Pick<WorkoutOverview, 'estimate' | 'fit'>, plainLabel: string): { label: string; clock: boolean; accessibilityLabel: string } | null {
  if (view.estimate === null) return null;
  const m = view.estimate.minutes;
  const about = `about ${String(m)} ${m === 1 ? 'minute' : 'minutes'}`;
  if (view.fit === null) return { label: plainLabel, clock: false, accessibilityLabel: `Time, ${about}. ${FIT_COPY.howLong}` };
  return { label: view.fit.tileLabel, clock: true, accessibilityLabel: `Time, ${about}, fitted to ${String(view.fit.minutes)}. ${FIT_COPY.howLong}` };
}

/** `5 exercises · fitted`, `5 exercises · 2 edited · fitted` (§3.3; the label style sets the caps). */
export function fitHeaderSuffix(view: Pick<WorkoutOverview, 'fit'>): string | null {
  return view.fit === null ? null : FIT_COPY.fitted;
}

/**
 * What `Bring back` sends on a row (§3.3, FT5): an Undo of the row's skip,
 * or, on a row the built-in fit skipped, Ben's own sets edit at the count it
 * had (the slot then leaves the fit).
 */
export function bringBackOf(row: Pick<OverviewRow, 'edit' | 'slotKey'>): { kind: 'undo'; editId: string } | { kind: 'keep'; slotKey: string; workingSets: number } | null {
  if (row.edit?.kind !== 'skipped') return null;
  if (row.edit.fitKeep !== undefined) return { kind: 'keep', slotKey: row.slotKey, workingSets: Math.max(1, row.edit.fitKeep) };
  return { kind: 'undo', editId: row.edit.editId };
}

/** The card collapses to one line after the first scroll down (§3.3), and opens again only on a tap. */
export function fitCardCollapsed(was: boolean, scrollY: number): boolean {
  return was || scrollY > 8;
}

/** The sheet's starting state each time it opens: `Change` keeps the live fit's length selected (§6 transitions). */
export function howLongOpen(fit: Pick<FitView, 'minutes'> | null): { chosen: number | null; other: boolean; info: boolean } {
  return { chosen: fit?.minutes ?? null, other: false, info: false };
}
