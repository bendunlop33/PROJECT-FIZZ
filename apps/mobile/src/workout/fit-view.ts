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
} as const;

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
