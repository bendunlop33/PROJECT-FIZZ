/**
 * View models for the builder's coach (workout-builder-v3 §2.0, §2.6, §2.9,
 * §6.1). Pure: the screens render these and never work out a number, a
 * line or a status themselves. Copy is minimal (CLAUDE.md, Ben 10 Oct):
 * values and actions; the one honest word when it matters (`Offline`,
 * `Coach not connected`, `Not reviewed`), explanations behind `Why?`.
 */

import { BUILDER_STATUS_WORD, type BuilderCoachReach, type BuilderProposal, type MixPick, type NudgeOffer, type ReviewNote } from '@fizz/coach';
import type { Memory } from '@fizz/schemas';

import { classifyPainMention } from '@fizz/domain';
import type { BuilderReviewResult, EditAsk, NudgeResult, SetupAsk } from './builder-coach-service';

// ---------------------------------------------------------------------------
// The ask bar (`✦ <label>` + mic), on Today, Set up, Your workout and the active workout

/** `active`: the workout in progress (workout-table-v3 §1.6): `✦` + mic in place of the old Chat; opens the workout's coach sheet. */
export type AskBarPage = 'today' | 'setup' | 'workout' | 'active';

/** On-device speech, as the mic shows it. `unavailable`: no on-device recogniser for Ben's language; `denied`: mic or speech permission refused. */
export type MicState = 'idle' | 'listening' | 'unavailable' | 'denied';

export interface AskBarView {
  /** `Ask the coach`, `Describe the workout`, `Ask the coach to change it`; Today's compact bar: `Coach`. */
  label: string;
  /** The one status word when the coach can't answer (`Offline`, `Coach not connected`); null when connected. */
  status: string | null;
  /** The shortest word for the active workout's `✦` (`Coach`, `Offline`, `No coach`; `Asking…` while asking). */
  short: string;
  /** Your workout's bar is disabled offline (every manual edit still works); Set up's still fills by code. */
  disabled: boolean;
  /**
   * Set up with no coach (offline or not connected, §2.6, §9 Q4): the bar is a field; typed or spoken words
   * go straight to code's Set up fill. No chat sheet, no chat bubble (review S9).
   */
  inline: boolean;
  accessibilityLabel: string;
  mic: { glyph: 'mic' | 'mic.fill' | '⊘'; accessibilityLabel: string; disabled: boolean; why: string | null; settingsLink: boolean };
}

const LABEL: Readonly<Record<AskBarPage, string>> = { today: 'Ask the coach', setup: 'Describe the workout', workout: 'Ask the coach to change it', active: 'Ask the coach' };
const SHORT: Readonly<Record<BuilderCoachReach, string>> = { ok: 'Coach', offline: 'Offline', not_connected: 'No coach' };

/** §2.6 table: what each bar shows per connection and mic state. */
/** The bar's word while the coach works on a request (copy for Ben; wiring S3). */
export const ASK_BAR_ASKING = 'Asking…';

export function askBarView(page: AskBarPage, reach: BuilderCoachReach, mic: MicState, opts: { compact?: boolean; /** A request is with the coach: one at a time (wiring S3). */ asking?: boolean } = {}): AskBarView {
  const asking = opts.asking === true;
  const status = asking ? ASK_BAR_ASKING : reach === 'ok' ? null : BUILDER_STATUS_WORD[reach];
  const disabled = asking || (page === 'workout' && reach !== 'ok');
  const label = page === 'today' && opts.compact === true ? 'Coach' : LABEL[page];
  return {
    label,
    status,
    short: asking ? ASK_BAR_ASKING : SHORT[reach],
    disabled,
    inline: page === 'setup' && reach !== 'ok',
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
  plan: { title: string; lines: { mark: '✓' | '!'; text: string; ok: boolean; accessibilityLabel: string }[]; addBack: { id: string; label: string; proposal: BuilderProposal }[] } | null;
  suggestions: { id: string; action: string; card: ProposalCardView; proposal: BuilderProposal }[];
  /** `For next Chest day`. */
  notesTitle: string;
  /** Ticked by default; saved on Done or swipe down. Empty when they can't be saved (never a ticked note that won't be kept, B4). */
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
          },
    suggestions: (r.coach?.suggestions ?? []).map((s) => ({ id: s.id, action: s.action, card: proposalCardView(s.proposal, states.get(s.id) ?? 'open', { applyLabel: s.action }), proposal: s.proposal })),
    notesTitle: `For next ${dayName} day`,
    notes: r.notesSaveable ? (r.coach?.notes ?? []).map((n) => ({ id: n.id, text: n.text, ticked: true, note: n })) : [],
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

/**
 * What Today's `Why?` gets from the coach (the Today stream owns the copy: `todayWhy` in
 * `packages/domain/src/today-v2/view.ts` takes `coachReason` and `review`). `review`:
 * - `reviewed`: the coach looked (a line, an applied or skipped offer, or its own silence); no
 *   `Not reviewed` line. Today's `TodayReviewStatus` needs this value at the merge.
 * - `not_reviewed`: connected, but no clear signal so the coach wasn't asked (§6.1; SP1 asks Ben
 *   whether this shows `Not reviewed` or nothing), or the call failed.
 * - `offline` / `not_connected`: `Not reviewed · Offline` / `· Coach not connected` (rule 1, B5).
 * - `pending`: still on its way.
 */
export type TodayCoachReview = 'reviewed' | 'not_reviewed' | 'offline' | 'not_connected' | 'pending';

export function todayCoachWhy(r: NudgeResult | null): { coachReason: string | null; review: TodayCoachReview } {
  if (r === null) return { coachReason: null, review: 'pending' };
  switch (r.kind) {
    case 'silent':
      return { coachReason: null, review: r.by === 'coach' ? 'reviewed' : 'not_reviewed' };
    case 'line':
      return { coachReason: r.line, review: 'reviewed' };
    case 'settled':
      return { coachReason: r.line, review: 'reviewed' };
    case 'not_reviewed':
      return { coachReason: null, review: r.status === 'failed' ? 'not_reviewed' : r.status };
  }
}

/** `↻ Mix it up`: the coach's one-line reason for Today's `todayMixLine(…, coachReason)`; null = code's pick, not reviewed. */
export function mixCoachReason(pick: MixPick | null): string | null {
  return pick?.by === 'coach' ? pick.reason : null;
}

/** `notApplied`: the write failed (not out of date). */
export const EDIT_ASK_COPY = { noAnswer: 'No answer. Try again.', notApplied: 'Not applied' } as const;

/** What Your workout does with a reply to its bar (§2.6). */
export type EditAskView =
  /** The proposal sheet: before/after lines, `Apply` / `Skip` (rule 3: nothing changes until Apply). */
  | { kind: 'proposal'; proposal: BuilderProposal }
  /** The coach's own words (checked), or code's note on what it couldn't do: in the sheet with no actions, never a timed toast (rule 1; wiring S3). */
  | { kind: 'reply'; text: string }
  /** The call didn't answer (`No answer. Try again.`). */
  | { kind: 'toast'; text: string }
  /** Offline or not connected: the bar shows the word and is disabled; manual edits all still work. */
  | { kind: 'reach'; reach: Exclude<BuilderCoachReach, 'ok'> }
  /** The draft is gone (started or deleted): the page reloads. */
  | { kind: 'gone' }
  | { kind: 'none' };

export function editAskView(r: EditAsk): EditAskView {
  switch (r.kind) {
    case 'proposal':
      return { kind: 'proposal', proposal: r.proposal };
    case 'reply': {
      const text = r.text ?? r.notes[0] ?? null;
      return text === null || text.trim() === '' ? { kind: 'none' } : { kind: 'reply', text };
    }
    case 'unavailable':
      return r.status === 'offline' || r.status === 'not_connected' ? { kind: 'reach', reach: r.status } : { kind: 'toast', text: EDIT_ASK_COPY.noAnswer };
    case 'gone':
      return { kind: 'gone' };
  }
}

// ---------------------------------------------------------------------------
// Today's bar (§2.0.5): where the words go

/** Where words from Today's bar go: Set up (opened filled), or the coach sheet with the words in its field. */
export type TodayAskRoute = { kind: 'setup' } | { kind: 'coach'; draft: string };

/**
 * Before the Set up parser (rule 9, wiring B2): a pain or unclear body mention goes to the coach
 * with the words, which owns pain flags and stops progression for that movement. Words like "knee
 * is sore, legs feel wrecked" never open a Legs workout. A body part named as a session ("legs,
 * 45 min") and plain effort ("tired, short one") still go to Set up. Null: ask Set up.
 */
export function todayAskFirst(words: string): TodayAskRoute | null {
  const m = classifyPainMention(words, { bareBodyPart: false });
  return m === 'pain' || m === 'unclear' ? { kind: 'coach', draft: words } : null;
}

/** After `askSetup`: only a fill opens Set up. A reply, `Not understood` or a failure opens the coach with the words, never a toast (rule 1). */
export function todayAskRoute(words: string, r: SetupAsk): TodayAskRoute {
  return r.kind === 'filled' ? { kind: 'setup' } : { kind: 'coach', draft: words };
}

/** A coach reply with nothing to apply, shown in the proposal sheet (no lines, no actions). */
export function replyCardView(text: string): ProposalCardView {
  return { lines: [], warnings: [], reason: text, notes: [], minutes: '', actions: null, state: null, undo: false };
}

/** The offer's lines for an Apply on Today (proposal state from the card). */
export function offerCardView(offer: NudgeOffer, state: ProposalState): ProposalCardView {
  return proposalCardView(offer.proposal, state);
}

// ---------------------------------------------------------------------------
// Day notes (`From last review`, §2.9): which show, and which go to the coach

/**
 * The day notes for a plan day (split day + main lift) on a local date: shown as `From last review`
 * with ✕, and sent to the coach as `BuilderCoachExtras.dayNotes`. Only the LATEST review's notes
 * (review S5, SP4): a newer Done replaces the older notes rather than piling up beside them. One Ben
 * hid today (✕, `hiddenOn`) is neither shown nor sent that day (and never brings an older one back).
 */
export function dayNotesFor(memories: readonly Memory[], splitDayId: string, mainLiftExerciseId: string | null, localDate: string): { memoryId: string; version: number; text: string }[] {
  const mine = memories
    .filter((m) => m.status === 'active' && m.dayNote !== undefined && m.dayNote.splitDayId === splitDayId && m.dayNote.mainLiftExerciseId === mainLiftExerciseId)
    .sort((a, b) => (a.createdAtUtc < b.createdAtUtc ? -1 : a.createdAtUtc > b.createdAtUtc ? 1 : 0));
  const latest = mine[mine.length - 1];
  if (latest === undefined) return [];
  // One review's notes: the same review ID, or (none recorded) the same save.
  const sameReview = (m: Memory): boolean => (latest.dayNote?.reviewId != null ? m.dayNote?.reviewId === latest.dayNote.reviewId : m.dayNote?.reviewId == null && m.createdAtUtc === latest.createdAtUtc);
  return mine.filter((m) => sameReview(m) && !(m.dayNote?.hiddenOn.includes(localDate) ?? false)).map((m) => ({ memoryId: m.id, version: m.version, text: m.text }));
}
