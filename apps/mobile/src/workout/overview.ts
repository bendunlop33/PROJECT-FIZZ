import { toMs, type CheckInGate, type OverviewBasis, type OverviewRow } from '@fizz/domain';
import type { CheckIn, CheckInScore, NextSessionTargetRecord, SessionCheckIn } from '@fizz/schemas';

import type { NextTimeTap } from '../coach/next-time-view';

import type { OverviewData } from '../services/workout-services';

/**
 * Screen-side rules for the Workout overview (workout-overview.md). Pure, so
 * they run on Linux. Nothing here computes a target, marker or duration
 * (the domain does); these only decide what the screen shows and sends.
 */

/** One row panel open at a time (§3.8); a tap toggles it in place. A reload keeps it only if the row is still there. */
export type PanelAction = { kind: 'toggle'; rowId: string } | { kind: 'rows'; rowIds: readonly string[] } | { kind: 'close' };

export function panelReducer(open: string | null, action: PanelAction): string | null {
  switch (action.kind) {
    case 'toggle':
      return open === action.rowId ? null : action.rowId;
    case 'rows':
      return open !== null && action.rowIds.includes(open) ? open : null;
    case 'close':
      return null;
  }
}

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
  if (gate.kind === 'skip') return gate.reason === 'off' || gate.reason === 'not_a_check_in_day' ? { kind: 'not_asked', reason: gate.reason } : null;
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

/**
 * Where the pre-workout check-in sheet goes when Ben finishes it (§2.2).
 * Over the overview (or with no gym to start at) it never starts a workout:
 * `Done`, `Skip`, `Not now`, `Flag n movements`, `Train anyway` and a 4–5 at
 * the score all return to the page, whose Start links the check-in.
 * `Skip workout` is separate: it always closes to Today.
 */
export function checkInSheetEnd(p: { overview: boolean; gymId: string | null }): 'back_to_overview' | 'start_workout' {
  return p.overview || p.gymId === null ? 'back_to_overview' : 'start_workout';
}

/** VoiceOver for a tile: `1 of 5, rough` … `5 of 5, great`. */
export function tileLabel(n: CheckInScore): string {
  return `${String(n)} of 5${n === 1 ? ', rough' : n === 5 ? ', great' : ''}`;
}

/** The eyebrow (§3.2), before tracked caps: `After Pull A · Thu 8 Oct`. `day` formats a date (`Thu 8 Oct`). */
export function eyebrowText(basis: OverviewBasis, day: (ms: number, tz: string) => string): string {
  switch (basis.kind) {
    case 'after':
      return `After ${basis.routineName} · ${day(toMs(basis.at.utc), basis.at.tz)}`;
    case 'only':
      return 'Only routine';
    case 'rotation_start':
      return 'Start of your rotation';
    case 'last_done':
      return `Last done ${day(toMs(basis.at.utc), basis.at.tz)}`;
    case 'next_from':
      return `Next session · from ${day(toMs(basis.at.utc), basis.at.tz)}`;
    case 'new_routine':
      return 'New routine';
  }
}

/** How many rows' targets differ between two reads of the page (the gym toast: `Hotel gym · 2 targets changed`). */
export function targetsChanged(before: readonly OverviewRow[], after: readonly OverviewRow[]): number {
  const key = (r: OverviewRow) => `${r.load.value}|${r.load.unit ?? ''}|${r.detail}`;
  const was = new Map(before.map((r) => [r.exerciseId, key(r)]));
  return after.filter((r) => was.get(r.exerciseId) !== key(r)).length;
}

export function gymToastText(gymName: string, changed: number): string {
  return changed === 0 ? gymName : `${gymName} · ${String(changed)} ${changed === 1 ? 'target' : 'targets'} changed`;
}

/** At AX1 and above (RN font scale ≈ 1.6+): the strip and rows stack, the warm-up fragment drops, the tiles collapse (§8). */
export const AX_FONT_SCALE = 1.6;

export function overviewLayout(fontScale: number): { stacked: boolean } {
  return { stacked: fontScale >= AX_FONT_SCALE };
}

/** Where a stat value was seen wrapping in its column (onTextLayout): the window width and font scale then. */
export interface StripWrap {
  width: number;
  fontScale: number;
}

/**
 * Whether the stat strip stacks (§8, OV14; review r2 S2): at AX sizes, or
 * once a value (`≈ 19:05`) was measured wrapping in its column at this
 * width and text size, which can happen from xLarge up. Sticky for that
 * width and scale, so the strip doesn't flip back when the stacked values
 * (full width, one line) report no wrap.
 */
export function statStripStacked(p: { ax: boolean; width: number; fontScale: number; wrappedAt: StripWrap | null }): boolean {
  if (p.ax) return true;
  return p.wrappedAt !== null && p.wrappedAt.width === p.width && p.wrappedAt.fontScale === p.fontScale;
}

/** The inline tiles (§3.9): five 50 pt tiles with 6 pt gaps. Fixed size (their digit is capped at ×1.4). */
export const CHECK_IN_TILES_WIDTH = 5 * 50 + 4 * 6;
/** The gap between the `CHECK-IN` label and the tiles when they share a line. */
export const CHECK_IN_LABEL_GAP = 12;

/**
 * How the inline check-in row fits (§3.9, OV14; review B2), from measured
 * widths (onLayout), not the font scale alone:
 * - `inline`: label and tiles on one line;
 * - `over`: the label above the tiles (a narrow phone, or xLarge–xxxLarge text);
 * - `collapsed`: `Check-in ›` opening the sheet at the score (AX sizes, or no room for the tiles).
 * `labelWidth` null: not measured yet, so the label is estimated from the font scale.
 */
export function checkInRowLayout(p: { available: number; labelWidth: number | null; fontScale: number }): 'inline' | 'over' | 'collapsed' {
  if (p.fontScale >= AX_FONT_SCALE || p.available < CHECK_IN_TILES_WIDTH) return 'collapsed';
  const label = p.labelWidth ?? 64 * p.fontScale;
  return label + CHECK_IN_LABEL_GAP + CHECK_IN_TILES_WIDTH <= p.available ? 'inline' : 'over';
}

/** The row's detail line at a size: the warm-up fragment drops first when stacked. */
export function rowDetail(row: Pick<OverviewRow, 'detail' | 'warmups'>, stacked: boolean): string {
  if (!stacked || row.warmups === null) return row.detail;
  return row.detail.replace(` · ${row.warmups}`, '');
}

export type StartFailure = { kind: 'stale' } | { kind: 'active' } | { kind: 'failed' };

/** How the page reacts to a Start that didn't create a session (§8). */
export function startFailure(code: string): StartFailure {
  if (code === 'stale_preview') return { kind: 'stale' };
  if (code === 'session_already_active') return { kind: 'active' };
  return { kind: 'failed' };
}

/**
 * The `Next time` tap a coach row sends (§5): Undo on the coach's target;
 * after it, the tap that puts it back (`Use coach target`, or `Apply` for a
 * bigger change Ben had applied). `status`: the row's status before the Undo.
 */
export function coachTapOf(state: 'coach' | 'built_in', status: NextSessionTargetRecord['status']): NextTimeTap {
  if (state === 'coach') return 'undo';
  return status === 'applied' || status === 'proposed' ? 'apply' : 'use_coach';
}

/** The toast after Undo on a coach row (§5). */
export function coachUndoneText(exerciseName: string): string {
  return `${exerciseName} · coach target undone`;
}

/** A refused or failed coach-row tap (the Summary's words). */
export function coachTapFailedText(reason: 'failed' | 'missing' | 'changed_since' | 'used'): string {
  if (reason === 'failed') return 'Couldn’t save.';
  return reason === 'used' ? 'Already used.' : 'Changed since. Check it again.';
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
  otherRoutine: 'Other routine',
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
