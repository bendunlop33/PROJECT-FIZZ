/**
 * View models for the builder's coach (workout-builder-v3 §2.0, §2.6, §2.9,
 * §6.1). Pure: the screens render these and never work out a number, a
 * line or a status themselves. Copy is minimal (CLAUDE.md, Ben 10 Oct):
 * values and actions; the one honest word when it matters (`Offline`,
 * `Coach not connected`, `Not reviewed`), explanations behind `Why?`.
 */

import { BUILDER_STATUS_WORD, type BuilderCoachReach, type BuilderProposal, type MixPick, type NudgeOffer, type ReviewNote } from '@fizz/coach';
import type { BuilderReviewResult, NudgeResult } from './builder-coach-service';

// ---------------------------------------------------------------------------
// The ask bar (`✦ <label>` + mic), on Today, Set up and Your workout

export type AskBarPage = 'today' | 'setup' | 'workout';

/** On-device speech, as the mic shows it. `unavailable`: no on-device recogniser for Ben's language; `denied`: mic or speech permission refused. */
export type MicState = 'idle' | 'listening' | 'unavailable' | 'denied';

export interface AskBarView {
  /** `Ask the coach`, `Describe the workout`, `Ask the coach to change it`; Today's compact bar: `Coach`. */
  label: string;
  /** The one status word when the coach can't answer (`Offline`, `Coach not connected`); null when connected. */
  status: string | null;
  /** Your workout's bar is disabled offline (every manual edit still works); Set up's still fills by code. */
  disabled: boolean;
  accessibilityLabel: string;
  mic: { glyph: 'mic' | 'mic.fill' | '⊘'; accessibilityLabel: string; disabled: boolean; why: string | null; settingsLink: boolean };
}

const LABEL: Readonly<Record<AskBarPage, string>> = { today: 'Ask the coach', setup: 'Describe the workout', workout: 'Ask the coach to change it' };

/** §2.6 table: what each bar shows per connection and mic state. */
export function askBarView(page: AskBarPage, reach: BuilderCoachReach, mic: MicState, opts: { compact?: boolean } = {}): AskBarView {
  const status = reach === 'ok' ? null : BUILDER_STATUS_WORD[reach];
  const disabled = page === 'workout' && reach !== 'ok';
  const label = page === 'today' && opts.compact === true ? 'Coach' : LABEL[page];
  return {
    label,
    status,
    disabled,
    accessibilityLabel: status === null ? LABEL[page] : `${LABEL[page]}, ${status}`,
    mic: {
      glyph: mic === 'listening' ? 'mic.fill' : mic === 'unavailable' || mic === 'denied' ? '⊘' : 'mic',
      accessibilityLabel: mic === 'listening' ? 'Stop listening' : mic === 'unavailable' ? 'Speak, needs on-device speech' : mic === 'denied' ? 'Speak, microphone not allowed' : 'Speak to the coach',
      disabled,
      why: mic === 'unavailable' ? 'Needs on-device speech' : mic === 'denied' ? 'Microphone or speech recognition is off for GymSmarter' : null,
      settingsLink: mic === 'denied',
    },
  };
}

// ---------------------------------------------------------------------------
// A proposal card (chat on Your workout, review suggestions, the Today offer)

export type ProposalState = 'open' | 'applied' | 'skipped' | 'out_of_date';

export interface ProposalCardView {
  lines: string[];
  /** `⚠ Not recommended: <reason>` (Apply still works). */
  warnings: string[];
  /** The coach's reason, after the number check; null when none passed. */
  reason: string | null;
  /** Code's notes on what was left out or clamped (`Why?`). */
  notes: string[];
  /** `about 52 min` after the change. */
  minutes: string;
  actions: { apply: string; skip: string } | null;
  /** `Applied · Undo`, `Skipped`, `Out of date. Ask again.` */
  state: string | null;
  undo: boolean;
}

export function proposalCardView(p: BuilderProposal, state: ProposalState, opts: { applyLabel?: string } = {}): ProposalCardView {
  return {
    lines: p.lines,
    warnings: p.warnings,
    reason: p.reason,
    notes: p.notes,
    minutes: `about ${String(p.estimate)} min`,
    actions: state === 'open' ? { apply: opts.applyLabel ?? 'Apply', skip: 'Skip' } : null,
    state: state === 'applied' ? 'Applied' : state === 'skipped' ? 'Skipped' : state === 'out_of_date' ? 'Out of date. Ask again.' : null,
    undo: state === 'applied',
  };
}

// ---------------------------------------------------------------------------
// Coach review sheet (§2.9) — the `BuilderReview` provider

export interface BuilderReviewView {
  /** `● Coach`, `Offline`, `Coach not connected`, `Not reviewed`. */
  header: string;
  verdict: string | null;
  /** `✓ Upper chest 6`, `· Abs`: icon plus text, never colour alone. */
  coverage: { text: string; trained: boolean; accessibilityLabel: string }[];
  variety: string;
  plan: { title: string; lines: { mark: '✓' | '!'; text: string; ok: boolean; accessibilityLabel: string }[]; addBack: { id: string; label: string; proposal: BuilderProposal }[]; updatePlanDay: boolean } | null;
  suggestions: { id: string; action: string; card: ProposalCardView; proposal: BuilderProposal }[];
  /** `For next Chest day`. */
  notesTitle: string;
  /** Ticked by default; saved on Done or swipe down. */
  notes: { id: string; text: string; ticked: boolean; note: ReviewNote }[];
  /** Hidden for a number not in the facts (`Why?` → `Not shown`). */
  notShown: string[];
}

const REVIEW_HEADER: Readonly<Record<BuilderReviewResult['status'], string>> = { reviewed: BUILDER_STATUS_WORD.ok, offline: BUILDER_STATUS_WORD.offline, not_connected: BUILDER_STATUS_WORD.not_connected, failed: 'Not reviewed' };

export function builderReviewView(r: BuilderReviewResult, dayName: string, states: ReadonlyMap<string, ProposalState> = new Map()): BuilderReviewView {
  const f = r.facts;
  return {
    header: REVIEW_HEADER[r.status],
    verdict: r.coach?.verdict ?? null,
    coverage: f.coverage.map((c) => ({ text: c.sets > 0 ? `✓ ${c.focus} ${String(c.sets)}` : `· ${c.focus}`, trained: c.sets > 0, accessibilityLabel: c.sets > 0 ? `${c.focus}, ${String(c.sets)} sets` : `${c.focus}, not trained` })),
    variety: f.variety,
    plan:
      f.plan === null
        ? null
        : {
            title: f.plan.title,
            lines: f.plan.lines.map((l) => ({ mark: l.ok ? '✓' : '!', text: l.text, ok: l.ok, accessibilityLabel: `${l.ok ? 'As planned' : 'Differs'}: ${l.text}` })),
            addBack: r.addBack.filter((a) => (states.get(a.id) ?? 'open') === 'open').map((a) => ({ id: a.id, label: `Add back ${a.name}`, proposal: a.proposal })),
            updatePlanDay: f.plan.differs,
          },
    suggestions: (r.coach?.suggestions ?? []).map((s) => ({ id: s.id, action: s.action, card: proposalCardView(s.proposal, states.get(s.id) ?? 'open', { applyLabel: s.action }), proposal: s.proposal })),
    notesTitle: `For next ${dayName} day`,
    notes: (r.coach?.notes ?? []).map((n) => ({ id: n.id, text: n.text, ticked: true, note: n })),
    notShown: r.coach?.hidden ?? [],
  };
}

// ---------------------------------------------------------------------------
// Today: the pre-session nudge and the `Why?` coach line

export interface NudgeCardView {
  /** `✦ <line>` on the session card. */
  line: string;
  /** The offer's before/after lines and its Apply (rule 3: an offer, applied only on tap). */
  offer: { lines: string[]; proposal: BuilderProposal } | null;
}

/** The nudge on the card: nothing unless the coach spoke (silent and not reviewed show nothing there). */
export function nudgeCardView(r: NudgeResult): NudgeCardView | null {
  if (r.kind !== 'line') return null;
  return { line: `✦ ${r.line}`, offer: r.offer === null ? null : { lines: r.offer.proposal.lines, proposal: r.offer.proposal } };
}

export type CoachReviewStatus = 'reviewed' | 'offline' | 'not_connected' | 'pending' | 'failed';

/** The nudge's status for the card's `Why?` (`reviewStatus`, §2.0.7). */
export function nudgeReviewStatus(r: NudgeResult | null): CoachReviewStatus {
  if (r === null) return 'pending';
  switch (r.kind) {
    case 'silent':
    case 'line':
      return 'reviewed';
    case 'not_reviewed':
      return r.status;
  }
}

/**
 * The coach's line in `Why?` (§2.0.2): its reason when it changed or offered something, or the
 * honest `Not reviewed · Offline` / `Not reviewed · Coach not connected` (rule 1). Null: nothing to add
 * (reviewed with nothing to say, or the review is still on its way).
 */
export function coachWhyLine(input: { status: CoachReviewStatus; nudge: NudgeResult | null; mix: { from: string; to: string; pick: MixPick } | null }): string | null {
  const lines: string[] = [];
  if (input.nudge?.kind === 'line') lines.push(`Coach: ${input.nudge.line}`);
  if (input.mix !== null) lines.push(input.mix.pick.by === 'coach' && input.mix.pick.reason !== null ? `${input.mix.from} → ${input.mix.to}: ${input.mix.pick.reason}` : `${input.mix.from} → ${input.mix.to}: Not reviewed`);
  if (input.status === 'offline') lines.push('Not reviewed · Offline');
  else if (input.status === 'not_connected') lines.push('Not reviewed · Coach not connected');
  else if (input.status === 'failed') lines.push('Not reviewed');
  return lines.length === 0 ? null : lines.join('\n');
}

/** `↻ Mix it up` row after a pick: `Cable fly → Cable crossover · today only`, the reason (or `Not reviewed`), `Another (1/3)`. */
export function mixRowView(input: { from: string; to: string; pick: MixPick; index: number }): { line: string; reason: string; another: string | null; accessibilityLabel: string } {
  const reason = input.pick.by === 'coach' && input.pick.reason !== null ? input.pick.reason : 'Not reviewed';
  const of = input.pick.order.length;
  return {
    line: `${input.from} → ${input.to} · today only`,
    reason,
    another: of > 1 ? `Another (${String(input.index)}/${String(of)})` : null,
    accessibilityLabel: `${input.from} swapped for ${input.to}, today only. ${reason}`,
  };
}

/** The offer's lines for an Apply on Today (proposal state from the card). */
export function offerCardView(offer: NudgeOffer, state: ProposalState): ProposalCardView {
  return proposalCardView(offer.proposal, state);
}
