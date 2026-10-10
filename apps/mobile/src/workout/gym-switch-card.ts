import { isProposalStale, type ChangeLine, type GymSwitchProposal, type NoteLine } from '@fizz/domain';
import type { SessionAggregate } from '@fizz/schemas';

/**
 * The gym switch card's screen state (gym-switch.md §2.2–§3.3), kept out of
 * the component so it can be tested. Everything the card says comes from the
 * proposal (`buildGymSwitchProposal`, domain); this only decides which of its
 * parts show, which buttons the card has, and the toast wording.
 */

export type SwitchCardStatus = 'ready' | 'applying' | 'error';

/** The open card: the proposal, the opId `Switch` and `Try again` share (rule 5), and where it's at. */
export interface OpenSwitchCard {
  proposal: GymSwitchProposal;
  opId: string;
  status: SwitchCardStatus;
}

export type CardButton = 'switch' | 'review' | 'not_now' | 'dismiss' | 'check_again' | 'try_again';

export interface SwitchCardView {
  title: string;
  /** `Checks` · `Today only` (hidden when Out of date, as design-system §9.11's stale variant). */
  tags: string[] | null;
  /** `Out of date. Your workout changed since this was checked.` / `Couldn't switch gym. Nothing changed.` / `Switching…` */
  status: { tone: 'info' | 'warning'; text: string } | null;
  lead: NoteLine | null;
  notChanged: string[];
  /** `Was suggested:` before the lines on a stale card. */
  wasSuggested: boolean;
  lines: ChangeLine[];
  unchanged: string | null;
  summary: string | null;
  unchecked: NoteLine | null;
  /** Lines in `text.secondary` (stale). */
  muted: boolean;
  /** Left to right; the last one is the card's main action. */
  buttons: { id: CardButton; label: string; disabled?: boolean }[];
}

/** True when the card must not be applied any more (GS7): the sets it would change have changed. */
export function cardIsStale(card: OpenSwitchCard, aggregate: SessionAggregate): boolean {
  return isProposalStale(card.proposal, aggregate);
}

export function switchCardView(card: OpenSwitchCard, aggregate: SessionAggregate): SwitchCardView {
  const c = card.proposal.card;
  // While applying, the write itself changes the fingerprint; it isn't "out of date".
  const stale = card.status !== 'applying' && cardIsStale(card, aggregate);
  if (stale) {
    return {
      title: c.title,
      tags: null,
      status: { tone: 'info', text: 'Out of date. Your workout changed since this was checked.' },
      lead: null,
      notChanged: [],
      wasSuggested: c.lines.length > 0,
      // The suggested lines stay, muted (design-system §9.11's stale variant; review N1).
      lines: c.lines.slice(0, c.visibleLines),
      unchanged: null,
      summary: null,
      unchecked: null,
      muted: true,
      buttons: [
        { id: 'dismiss', label: 'Dismiss' },
        { id: 'check_again', label: 'Check again' },
      ],
    };
  }
  // With 5 or more lines `Switch` lives on the review sheet (§2.4); the card links to it instead.
  const cut = c.reviewLabel !== null;
  const action: SwitchCardView['buttons'][number] =
    card.status === 'error'
      ? { id: 'try_again', label: 'Try again' }
      : cut
        ? { id: 'review', label: c.reviewLabel ?? 'Review all changes' }
        : { id: 'switch', label: card.status === 'applying' ? 'Switching…' : c.action, disabled: card.status === 'applying' };
  return {
    title: c.title,
    tags: [c.author, c.scope],
    status: card.status === 'error' ? { tone: 'warning', text: 'Couldn’t switch gym. Nothing changed.' } : null,
    lead: c.lead,
    notChanged: c.notChanged,
    wasSuggested: false,
    lines: c.lines.slice(0, c.visibleLines),
    unchanged: c.unchanged,
    summary: c.summary,
    unchecked: c.unchecked,
    muted: false,
    buttons: [{ id: 'not_now', label: 'Not now', disabled: card.status === 'applying' }, action],
  };
}

export interface ReviewSheetView {
  title: string;
  tags: string[] | null;
  /** The same Out of date / write error line as the card (§3.1); null when ready. */
  status: SwitchCardView['status'];
  notChanged: string[];
  wasSuggested: boolean;
  /** Every line (the sheet is where all of them are read). */
  lines: ChangeLine[];
  muted: boolean;
  unchanged: string | null;
  /** The text button, left: `Not now` (dismisses the card, as on the card) or `Dismiss` when stale. */
  secondary: { id: CardButton; label: string; disabled?: boolean };
  /** The sheet's PrimaryButton: `Switch`, `Switching…`, `Try again` or `Check again`. */
  primary: { id: CardButton; label: string; disabled?: boolean };
}

/**
 * The review sheet (§2.4) for 5 or more change lines, where `Switch` lives. It reads the
 * same state as the card (`switchCardView`), so Out of date and a write error show here
 * too and `Switch` never fails silently (review B3).
 */
export function reviewSheetView(card: OpenSwitchCard, aggregate: SessionAggregate): ReviewSheetView {
  const c = card.proposal.card;
  const v = switchCardView(card, aggregate);
  const stale = v.status !== null && v.buttons.some((b) => b.id === 'check_again');
  const primary: ReviewSheetView['primary'] = stale
    ? { id: 'check_again', label: 'Check again' }
    : card.status === 'error'
      ? { id: 'try_again', label: 'Try again' }
      : { id: 'switch', label: card.status === 'applying' ? 'Switching…' : c.action, disabled: card.status === 'applying' };
  const secondary: ReviewSheetView['secondary'] = stale ? { id: 'dismiss', label: 'Dismiss' } : { id: 'not_now', label: 'Not now', disabled: card.status === 'applying' };
  return {
    title: c.title,
    tags: v.tags,
    status: v.status,
    notChanged: stale ? [] : c.notChanged,
    wasSuggested: v.wasSuggested,
    lines: c.lines,
    muted: v.muted,
    unchanged: stale ? null : c.unchanged,
    secondary,
    primary,
  };
}

/** What a card button does to the review sheet: it closes unless the tap is `Switch`/`Try again` (which close it on success). */
export function sheetClosesOn(id: CardButton): boolean {
  return id !== 'switch' && id !== 'try_again' && id !== 'review';
}

/**
 * §4.2, review M2: while `Switch` is being written and the workout reloaded, Log ignores taps,
 * so a tap can't log the pre-switch target on a set that now belongs to the new gym.
 */
export function logBlockedBySwitch(card: OpenSwitchCard | null): boolean {
  return card?.status === 'applying';
}

/** §5 toasts after `Switch`. */
export function switchedToast(p: GymSwitchProposal): string {
  if (p.mode === 'equipment_update') return p.card.changesTargets ? `Using updated ${p.toGymName}. Remaining sets updated for today.` : `Using updated ${p.toGymName}. No targets changed.`;
  return p.card.changesTargets ? `Switched to ${p.toGymName}. Remaining sets updated for today.` : `Switched to ${p.toGymName}. No targets changed.`;
}

export function undoneToast(gymName: string): string {
  return `Back at ${gymName}. Remaining sets restored.`;
}

/**
 * Choosing a gym in the switcher (§4.1): the workout's own gym closes the
 * sheet and any open card (`dismiss`); another gym computes a new card,
 * replacing an open one.
 */
export function onGymChosen(currentGymId: string | null, chosenGymId: string): 'dismiss' | 'propose' {
  return chosenGymId === currentGymId ? 'dismiss' : 'propose';
}

/**
 * §4.2: when `Switch` changes the active set's Log label, Log ignores taps
 * for `timing.valueChangeGuard`, so a tap aimed at the old label can't log
 * the new one. Any other time Log responds at once.
 */
export function logGuardAfterSwitch(labelBefore: string, labelAfter: string): boolean {
  return labelBefore !== labelAfter;
}

/** The gym chip's VoiceOver label. */
export function gymChipLabel(gymName: string | null): string {
  return gymName === null ? 'Gym not set. Choose a gym for this workout.' : `Gym: ${gymName}. Change the gym for this workout.`;
}
