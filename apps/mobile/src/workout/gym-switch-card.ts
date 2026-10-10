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
      lines: c.lines.slice(0, 1),
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

/** The review sheet (§2.4): every line, with `Switch` as its primary. */
export function reviewSheetView(card: OpenSwitchCard): { title: string; tags: string[]; notChanged: string[]; lines: ChangeLine[]; unchanged: string | null; action: string } {
  const c = card.proposal.card;
  return { title: c.title, tags: [c.author, c.scope], notChanged: c.notChanged, lines: c.lines, unchanged: c.unchanged, action: card.status === 'applying' ? 'Switching…' : c.action };
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
