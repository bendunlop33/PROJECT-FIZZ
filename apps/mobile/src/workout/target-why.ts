import type { TargetExplanation, WhyRow } from '@fizz/domain';

/**
 * The `Why?` panel's open/close rules (active-workout.md §2.12 rule 5, AW1),
 * kept pure so they are tested rather than spread over effects. One panel at
 * most; it belongs to one set; it closes on `Hide`, on Log, when another set
 * becomes active, or when the keypad opens. Closing the keypad doesn't bring
 * it back. The text in it comes from `explainTarget` (domain) unchanged.
 */
export type WhyPanel =
  | null
  | { setId: string; status: 'loading' }
  | { setId: string; status: 'ready'; explanation: TargetExplanation }
  /** The local read failed; the panel says so instead of guessing. */
  | { setId: string; status: 'failed' };

export type WhyEvent =
  /** `Why?` / `Hide` on the target line of the active set. */
  | { kind: 'toggle'; setId: string }
  /** `explainTarget` answered (null: couldn't be read). */
  | { kind: 'loaded'; setId: string; explanation: TargetExplanation | null }
  | { kind: 'logged' }
  /** The focused (active or up-next) set, after any change. */
  | { kind: 'active_set'; setId: string | null }
  | { kind: 'keypad_opened' };

export function whyPanelReducer(state: WhyPanel, e: WhyEvent): WhyPanel {
  switch (e.kind) {
    case 'toggle':
      return state?.setId === e.setId ? null : { setId: e.setId, status: 'loading' };
    case 'loaded':
      // A late answer for a panel that was closed or moved on is dropped.
      if (state?.setId !== e.setId || state.status !== 'loading') return state;
      return e.explanation === null ? { setId: e.setId, status: 'failed' } : { setId: e.setId, status: 'ready', explanation: e.explanation };
    case 'logged':
    case 'keypad_opened':
      return null;
    case 'active_set':
      return state !== null && state.setId !== e.setId ? null : state;
  }
}

/** VoiceOver for the link (active-workout §5). */
export function whyLinkLabel(open: boolean): string {
  return open ? 'Hide explanation' : 'Why this number?';
}

export const WHY_FAILED_TEXT = 'Couldn’t load.';

/** One row read as a sentence: label, then its lines; middle dots read as pauses. */
export function whyRowAccessibilityLabel(row: WhyRow): string {
  const body = row.lines.map((l) => l.replaceAll(' · ', ', ').replaceAll(' ', ' ')).join('. ');
  const kind = row.kind === 'actual' ? ' (what you did)' : '';
  return `${row.label}${kind}: ${body}`;
}
