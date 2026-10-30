/**
 * View models for the coach sheet (coach-sheet.md, ADR 0020 C6). Pure: the
 * screen renders these and calls the coach service; it never decides
 * wording or what a card says. Minimal copy (CLAUDE.md, 10 Oct): states are
 * one or two words, and any explanation sits behind `Why?`.
 *
 * Every change line is rendered from a saved `ActionRecord`
 * (`renderActionResult`), never from the model's words (PM decision 10 Oct).
 */

import { failureWhy, memoryTextKind, renderActionResult, type CoachTurnProgress, type ReplyItem } from '@fizz/coach';
import { customExerciseLine, isInHistory, progressPeriodPhrase, rangeText, toMs } from '@fizz/domain';
import type { ActionRecord, BenInput, CustomExerciseFields, CoachMessage, CoachTurn, CoachTurnError, CoachTurnFailure, GuardNote, ToolLogLine, WorkoutSession } from '@fizz/schemas';

import type { CoachAvailability, CoachEntry, GymProposalState, MemoryCardState, ProposalCardState, ThreadData } from './coach-service';
import type { WorkoutPresence } from '../services/history-services';
import type { RunningTurn } from './running-turns';

/**
 * Build 131 ("the keyboard gets stuck on GPT chat"): the conversation hides the keyboard when
 * Ben drags it down (`interactive`: the keyboard follows the finger, as in Messages) or taps
 * outside the field; buttons in it still work on the first tap (`handled`). The field is
 * multiline, so Return adds a line: the `Done` bar above the keyboard hides it.
 */
export const COACH_TRANSCRIPT_KEYBOARD = { keyboardDismissMode: 'interactive', keyboardShouldPersistTaps: 'handled' } as const;
export const COACH_DONE_ACCESSORY_ID = 'fizz-coach-done';

export type ViewIcon = 'checkmark.circle.fill' | 'arrow.uturn.backward' | 'minus.circle' | 'exclamationmark.triangle' | 'clock.badge.xmark' | 'xmark.octagon' | 'info.circle' | 'wifi.slash' | 'pause.circle' | 'ellipsis';

// ---------------------------------------------------------------------------
// Status (coach-sheet §3.1, minimal copy)

export type StatusAction = 'connect' | 'manage_usage' | 'sign_in' | 'choose_model';

export interface StatusView {
  /** One or two words; null when the coach is ready (no banner). */
  word: string | null;
  icon: ViewIcon;
  /** Behind `Why?`. */
  why: string | null;
  action: { label: string; action: StatusAction } | null;
  /** Send is possible (the field always keeps its text; CS4). */
  canSend: boolean;
  /** Field placeholder. */
  placeholder: string;
}


/** (Coach v3 review S7) Why live-workout turns can't run: his mid-workout model left his plan's list. */
export const MID_WORKOUT_MODEL_GONE = 'The mid-workout model you chose isn’t available any more.';
export function statusView(a: CoachAvailability, liveWorkout = false): StatusView {
  const ready = { icon: 'info.circle' as const, why: null, action: null, canSend: true, placeholder: 'Ask the coach…' };
  switch (a.status) {
    case 'ok':
      // Review S7: in a live workout the coach runs on his mid-workout model; once his plan stops listing it, he chooses again.
      if (liveWorkout && a.workoutModelGone === true) return { word: 'Choose model', icon: 'exclamationmark.triangle', why: MID_WORKOUT_MODEL_GONE, action: { label: 'Choose model', action: 'choose_model' }, canSend: false, placeholder: 'Choose a model' };
      return { ...ready, word: null };
    case 'offline':
      // Known only after a request failed for lack of network: Send stays on so Ben can try again himself; nothing sends later on its own.
      return { word: 'Offline', icon: 'wifi.slash', why: 'The coach needs the internet.', action: null, canSend: true, placeholder: 'Ask the coach…' };
    case 'not_connected':
      return { word: 'Not connected', icon: 'xmark.octagon', why: null, action: { label: 'Connect', action: 'connect' }, canSend: false, placeholder: 'Coach not connected' };
    case 'limit':
      return { word: 'Paused', icon: 'pause.circle', why: 'ChatGPT usage limit reached.', action: { label: 'Manage usage', action: 'manage_usage' }, canSend: false, placeholder: 'Coach paused' };
    case 'expired':
      return { word: 'Signed out', icon: 'exclamationmark.triangle', why: 'Sign in to ChatGPT again to use the coach.', action: { label: 'Sign in', action: 'sign_in' }, canSend: false, placeholder: 'Coach signed out' };
    case 'model_gone':
    case 'no_model':
      return { word: 'Choose model', icon: 'exclamationmark.triangle', why: a.status === 'model_gone' ? 'The model you chose isn’t available any more.' : 'Choose a model to use the coach.', action: { label: 'Choose model', action: 'choose_model' }, canSend: false, placeholder: 'Choose a model' };
    case 'not_eligible':
    case 'no_scope':
    case 'region':
      return { word: 'Unavailable', icon: 'xmark.octagon', why: 'This ChatGPT account can’t run the coach here.', action: { label: 'Connect', action: 'connect' }, canSend: false, placeholder: 'Coach unavailable' };
  }
}

/** The route line under the composer (OpenAI's Sign in with ChatGPT guidelines). */
export function routeLine(a: CoachAvailability): { text: string; link: { label: string; action: StatusAction } } {
  if (a.status === 'not_connected') return { text: 'Coach not connected', link: { label: 'Connect', action: 'connect' } };
  return { text: 'Using ChatGPT plan', link: { label: 'Manage usage', action: 'manage_usage' } };
}

// ---------------------------------------------------------------------------
// Starter chips (CS6): fixed by context, written by us, never by the model

export type StarterChip =
  | { label: string; input: BenInput }
  | { label: 'Pain'; input: null }
  /** workout-builder §3: opens the Build card in the thread; disabled with `Needs the coach` when the coach can't answer (§5.4). */
  | { label: 'Build a workout'; input: null; build: { enabled: boolean } };

/** What a live workout's chips are about (`workoutChatContext`): the current exercise, and whether the set just logged was off target. */
export interface WorkoutChipContext {
  exerciseName: string | null;
  offTarget: boolean;
}

/**
 * A live workout's chips (14 Oct): about the current exercise, and words the
 * coach's tools act on (so they work whichever tools the coach has today).
 * `Adjust the rest?` leads after a set that was off its target.
 */
function liveWorkoutChips(ctx: WorkoutChipContext | null, pain: StarterChip): StarterChip[] {
  const chip = (label: string, text = label): StarterChip => ({ label, input: { kind: 'words', text, spoken: false } });
  const name = ctx?.exerciseName ?? null;
  // Design pass 4.4 (20 Oct): short labels about the current exercise, the full words sent; Lighter and Heavier first.
  return [
    ...(ctx?.offTarget === true && name !== null ? [chip('Adjust the rest?', `Adjust the rest of my ${name} sets`)] : []),
    ...(name === null
      ? []
      : [chip('Lighter', `Lighter ${name}`), chip('Heavier', `Heavier ${name}`), chip('+ Set', `Add a set of ${name}`), chip('− Set', `Remove a set of ${name}`), chip('Swap', `Swap ${name}`)]),
    chip('Set weights from my history'),
    chip('Add an exercise'),
    chip('Short on time'),
    pain,
  ];
}

export function starterChips(entry: CoachEntry, a: CoachAvailability, workoutActive: boolean, workout: WorkoutChipContext | null = null): StarterChip[] {
  const pain: StarterChip = { label: 'Pain', input: null };
  const words = (text: string): StarterChip => ({ label: text, input: { kind: 'words', text, spoken: false } });
  // Pain is deterministic and works offline; the rest need the coach.
  const ready = a.status === 'ok' || a.status === 'offline';
  switch (entry.kind) {
    case 'workout':
      if (!workoutActive) return ready ? [words('How did that go?')] : [];
      return ready ? liveWorkoutChips(workout, pain) : [pain];
    case 'summary':
      return ready ? [words('What should I change next time?')] : [];
    case 'today':
      // The coach reads past workouts through `get_training_overview` (backlog §4.3). `Build a workout` (workout-builder §3) shows
      // disabled when the coach can't answer (§5.4); `Plan my week` isn't built.
      return [{ label: 'Build a workout', input: null, build: { enabled: a.status === 'ok' } }, ...(ready ? [words('How am I doing?')] : [])];
    case 'draft':
    case 'builder':
      // `Ask coach` on a coach draft (BD16), Your workout's bar (ADR 0039): Ben says what to change; no chips.
      return [];
    case 'progress':
    case 'progress_exercise':
      // Progress keeps no starter chip at the merge with coach tools (main's review S4 behaviour); whether it
      // offers `How am I doing?` now that the coach reads past workouts is Ben's call.
      return [];
  }
}

// ---------------------------------------------------------------------------
// The transcript's scroll (design pass 4.1)

/** Within this many points of the end counts as at the bottom. */
export const AT_BOTTOM_SLOP = 48;

/** The transcript is scrolled to (or near) its end. */
export function isAtBottom(e: { contentOffsetY: number; contentHeight: number; viewportHeight: number }): boolean {
  return e.contentOffsetY + e.viewportHeight >= e.contentHeight - AT_BOTTOM_SLOP;
}

/**
 * Whether a change of the transcript's size (or the keyboard resizing it) scrolls it to the end:
 * only when Ben is already there, or something new was added (a row, a live turn, a build). A `Why?`
 * opened on an older message never jumps the view. Never while the empty thread's starter chips show.
 */
export function stickToEnd(s: { atBottom: boolean; added: boolean; starters: boolean }): boolean {
  if (s.starters) return false;
  return s.atBottom || s.added;
}

/**
 * The coach's reply as shown (design pass nit): sentences joined by a space, except where the model
 * broke the line for a heading (`Next time:`) or a list item (`- Bench 100 kg`, `2. Row`), which keeps
 * its break. Text only; nothing is added. (A sentence split around an action token stays on the line.)
 */
export function replyText(sentences: readonly string[]): string {
  let out = '';
  for (const s of sentences) {
    if (out === '') out = s;
    else out += out.endsWith(':') || /^(?:[-•*–]\s|\d+[.)]\s)/.test(s) ? `\n${s}` : ` ${s}`;
  }
  return out;
}

/**
 * The rows that show their time (design pass nit): Ben's and the coach's messages, once per run of the
 * same minute (`18:02` isn't repeated on every message of one exchange). `clock` formats a row's time.
 */
export function stampedKeys(rows: readonly ThreadRow[], clock: (atUtc: string, tz: string) => string): Set<string> {
  const out = new Set<string>();
  let last: string | null = null;
  for (const r of rows) {
    if (r.kind !== 'ben' && r.kind !== 'coach') continue;
    const t = clock(r.atUtc, r.tz);
    if (t !== last) out.add(r.key);
    last = t;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Cards (coach-sheet §2.6): status word and icon, never colour alone

export type CardStatusWord = 'Applied' | 'Added' | 'Saved' | 'Logged' | 'Undone' | 'Not applied' | 'Not saved' | 'Out of date' | 'Couldn’t apply' | 'Couldn’t apply here' | 'Suggested' | 'Deleted';

export interface CardView {
  actionId: string;
  status: { word: CardStatusWord; icon: ViewIcon };
  /** App text from the record. */
  text: string;
  /** VoiceOver prefix so app lines are never read as coach text. */
  accessibilityPrefix: string;
  canUndo: boolean;
  /** A structural proposal (ADR 0020 §3): before/after and its own buttons. */
  proposal?: ProposalView;
  /**
   * A memory suggestion that can still be saved (coach-memory §2.4): `Not now` · `Save`. When its words could
   * be a general rule (CM9 split): `Save as a memory about me` · `Add to playbook` instead of `Save`.
   */
  memoryChoice?: { memoryId: string; version: number; split: boolean };
  /** A committed coach draft (workout-builder §4.2): the sheet shows the draft card (and, for a new version, the version card) from it. */
  draft?: ActionRecord;
  /** (v2, BD17) The coach's clarifying question (§4.2): its tap answers, or the collapsed answer. */
  question?: QuestionCardView;
  /** (19 Oct) A committed coach plan: the sheet shows the plan card (every day, Apply or Undo) from it. */
  plan?: ActionRecord;
  /** (19 Oct) The coach's new exercise for Ben's list: `Edit` · `Add` while open (rule 3). */
  newExercise?: { actionId: string; fields: CustomExerciseFields; canAdd: boolean };
  /** (20 Oct, ADR 0029) The coach's gym suggestion: `Not now` · `Apply` while open; `Undo` of Ben's Apply after. */
  gymChange?: { proposalId: string; canApply: boolean; undoActionId: string | null };
  /** (Ben, 20 Oct) The coach's week proposal: before/after, `This week`, Apply or Undo (rule 3). */
  week?: ActionRecord;
  /** (Ben, 20 Oct) An activity the coach offered to log (he didn't ask): `Log`, then Undo. */
  activityOffer?: ActionRecord;
  /** ADR 0039: a change to Your workout before Start: its lines, Apply / Skip, then Undo (rule 3). */
  draftEdit?: ActionRecord;
  /** ADR 0039: today's Set up filled from Ben's words: `Open` (Undo is on Set up). */
  setupFill?: ActionRecord;
  /** (Ben, 30 Oct) One exercise swapped in every plan day: each day's change, Apply / Skip, Undo, `Today too`. */
  planSwap?: ActionRecord;
}

const GYM_STATUS: Record<GymProposalState['state'], CardView['status']> = {
  open: { word: 'Suggested', icon: 'minus.circle' },
  applied: { word: 'Applied', icon: 'checkmark.circle.fill' },
  not_applied: { word: 'Not applied', icon: 'minus.circle' },
  out_of_date: { word: 'Out of date', icon: 'clock.badge.xmark' },
};

/** (20 Oct, ADR 0029) The coach's gym suggestion card: the lines it would save; Apply saves exactly those (rule 3). */
export function gymProposalCardView(r: ActionRecord, s: GymProposalState): CardView | null {
  const d = r.detail;
  if (d.kind !== 'update_gym' || r.status !== 'proposed') return null;
  const undone = s.apply?.undoneBy != null;
  return {
    actionId: r.actionId,
    status: undone ? { word: 'Undone', icon: 'arrow.uturn.backward' } : GYM_STATUS[s.state],
    text: renderActionResult(r, 'sheet').text,
    accessibilityPrefix: 'Coach suggestion.',
    canUndo: false,
    gymChange: { proposalId: r.actionId, canApply: s.state === 'open', undoActionId: s.apply !== null && !undone ? s.apply.actionId : null },
  };
}

/**
 * (19 Oct) The coach's new-exercise card: `New exercise: Meadows row · Barbell · total load · Back,
 * Biceps · reps` with `Edit` · `Add` while open; `Added` once Ben added it.
 */
export function exerciseProposalCardView(r: ActionRecord, state: 'open' | 'added' | 'deleted'): CardView | null {
  const d = r.detail;
  if (d.kind !== 'propose_exercise' || r.status !== 'proposed') return null;
  const text = `New exercise: ${customExerciseLine(d.fields)}`;
  if (state === 'added') return { actionId: r.actionId, status: { word: 'Added', icon: 'checkmark.circle.fill' }, text, accessibilityPrefix: 'Your exercises.', canUndo: false };
  if (state === 'deleted') return { actionId: r.actionId, status: { word: 'Deleted', icon: 'minus.circle' }, text, accessibilityPrefix: 'Your exercises.', canUndo: false };
  return { actionId: r.actionId, status: { word: 'Suggested', icon: 'minus.circle' }, text, accessibilityPrefix: 'Coach suggestion, not added.', canUndo: false, newExercise: { actionId: r.actionId, fields: d.fields, canAdd: true } };
}

/**
 * The question card (workout-builder v2.1 §4.2): one checked question with
 * 2–4 tap answers and `Skip`; after Ben's reply it collapses to one line.
 * No question count. `not_answered`: a newer message came first, or 12 h
 * passed (`timing.buildQuestionTtl`).
 */
export interface QuestionCardView {
  actionId: string;
  topic: 'main_lift' | 'split' | 'equipment_today' | 'other';
  question: string;
  answers: { label: string; catalogueId: string | null }[];
  day: { id: string; name: string } | null;
  state: 'open' | 'answered' | 'skipped' | 'not_answered';
  /** Ben's reply (what he tapped or typed); null while open. */
  answer: string | null;
  /** `Main lift for legs? Squat ✓`, `… Skipped`, `Not answered`. */
  collapsed: string | null;
}

/** `timing.buildQuestionTtl` (§5.1): an unanswered question reads `Not answered` after 12 h. */
export const BUILD_QUESTION_TTL_MS = 12 * 3_600_000;

/** The question card from its record and Ben's next message in the thread (code only). */
export function questionCardView(r: ActionRecord, reply: string | null, ageMs: number): QuestionCardView | null {
  const d = r.detail;
  if (d.kind !== 'build_question') return null;
  const skipped = reply !== null && reply.trim().toLowerCase() === 'skip';
  const state: QuestionCardView['state'] = reply === null ? (ageMs >= BUILD_QUESTION_TTL_MS ? 'not_answered' : 'open') : skipped ? 'skipped' : 'answered';
  const collapsed = state === 'answered' ? `${d.question} ${reply ?? ''} ✓` : state === 'skipped' ? `${d.question} Skipped` : state === 'not_answered' ? 'Not answered' : null;
  return { actionId: r.actionId, topic: d.topic, question: d.question, answers: d.answers.map((a) => ({ ...a })), day: d.day, state, answer: reply, collapsed };
}

/**
 * A memory suggestion's card (coach-memory §2.4, CM1–CM3): `Save to memory?`
 * with the words, `Not now` · `Save` while it waits; `Saved` or `Not saved`
 * after (14 days without an answer also reads `Not saved`).
 */
export function memoryCardView(r: ActionRecord, s: MemoryCardState): CardView | null {
  if (r.detail.kind !== 'suggest_memory' || r.status !== 'proposed') return null;
  const words = `“${s.memory.text}”`;
  if (s.memory.status === 'active') return { actionId: r.actionId, status: { word: 'Saved', icon: 'checkmark.circle.fill' }, text: `Saved to memory: ${words}`, accessibilityPrefix: 'Memory.', canUndo: false };
  if (s.playbook === 'to_review' || s.playbook === 'approved') {
    return { actionId: r.actionId, status: { word: 'Saved', icon: 'checkmark.circle.fill' }, text: s.playbook === 'approved' ? `Playbook: ${words}` : `Playbook, to review: ${words}`, accessibilityPrefix: 'Playbook.', canUndo: false };
  }
  if (s.playbook === 'rejected') return { actionId: r.actionId, status: { word: 'Not saved', icon: 'minus.circle' }, text: `Rejected before. ${words}`, accessibilityPrefix: 'Playbook.', canUndo: false };
  if (s.memory.status === 'suggested' && s.canSave) {
    // CM9: words that could be a general rule offer both homes; Ben's choice wins.
    const split = memoryTextKind(s.memory.text) !== 'personal';
    return {
      actionId: r.actionId,
      status: { word: 'Suggested', icon: 'minus.circle' },
      text: split ? `Memory or playbook? ${words}` : `Save to memory? ${words}`,
      accessibilityPrefix: 'Coach suggestion, not saved.',
      canUndo: false,
      memoryChoice: { memoryId: s.memory.id, version: s.memory.version, split },
    };
  }
  return { actionId: r.actionId, status: { word: 'Not saved', icon: 'minus.circle' }, text: words, accessibilityPrefix: 'Coach suggestion, not saved.', canUndo: false };
}

/**
 * A structural proposal card (coach-sheet §2.6 `ChangeReviewCard`, ADR 0020
 * §3): one line per change, the plan before and after, `Not now` · `Apply`
 * while it is a live suggestion, `Undo` (of Ben's Apply) until the next
 * workout starts. App text only; the coach's reason is behind `Why?`.
 */
export interface ProposalView {
  proposalId: string;
  title: string;
  lines: string[];
  before: string;
  after: string;
  canApply: boolean;
  /** Ben's Apply record, when `Undo` is offered. */
  undoActionId: string | null;
}

const PROPOSAL_STATUS: Record<ProposalCardState['state'], CardView['status']> = {
  suggested: { word: 'Suggested', icon: 'minus.circle' },
  applied: { word: 'Applied', icon: 'checkmark.circle.fill' },
  used: { word: 'Applied', icon: 'checkmark.circle.fill' },
  not_here: { word: 'Couldn’t apply here', icon: 'exclamationmark.triangle' },
  undone: { word: 'Undone', icon: 'arrow.uturn.backward' },
  not_applied: { word: 'Not applied', icon: 'minus.circle' },
  out_of_date: { word: 'Out of date', icon: 'clock.badge.xmark' },
};

/** The card for a structural proposal in a given state; null when the record isn't one (or predates before/after). */
export function proposalCardView(r: ActionRecord, s: ProposalCardState): CardView | null {
  const d = r.detail;
  if (d.kind !== 'propose_next_workout_change' || r.status !== 'proposed' || d.before === undefined || d.after === undefined) return null;
  const lines = d.changes.map((c) => c.text);
  const live = (s.state === 'applied' || s.state === 'not_here') && s.apply !== null;
  return {
    actionId: r.actionId,
    status: PROPOSAL_STATUS[s.state],
    text: lines.join('\n'),
    accessibilityPrefix: 'Coach suggestion.',
    canUndo: false,
    proposal: {
      proposalId: r.actionId,
      title: `Next ${d.workoutLabel}`,
      lines,
      before: d.before.join(' · '),
      after: d.after.join(' · '),
      canApply: s.state === 'suggested',
      undoActionId: live ? (s.apply?.actionId ?? null) : null,
    },
  };
}

const UNDOABLE = new Set<ActionRecord['detail']['kind']>(['adjust_pending_sets', 'add_exercise_today', 'edit_today', 'rename_workout', 'log_set', 'correct_set', 'set_next_session_targets', 'set_pain_flag', 'save_memory', 'forget_memory', 'add_playbook_candidate', 'pause_plan', 'update_gym', 'set_lift_target', 'log_activity']);

function statusOf(r: ActionRecord): CardView['status'] {
  if (r.status === 'committed' && r.undoneBy !== null) return { word: 'Undone', icon: 'arrow.uturn.backward' };
  switch (r.status) {
    case 'committed':
      if (r.detail.kind === 'log_set') return { word: 'Logged', icon: 'checkmark.circle.fill' };
      if (r.detail.kind === 'add_exercise_today') return { word: 'Added', icon: 'checkmark.circle.fill' };
      if (r.detail.kind === 'edit_today' && r.detail.exercises.length === 0 && r.detail.lines.length > 0 && r.detail.lines.every((l) => l.change === 'add')) return { word: 'Added', icon: 'checkmark.circle.fill' };
      return r.detail.kind === 'save_memory' || r.detail.kind === 'add_playbook_candidate' || r.detail.kind === 'set_lift_target' ? { word: 'Saved', icon: 'checkmark.circle.fill' } : { word: 'Applied', icon: 'checkmark.circle.fill' };
    case 'proposed':
      return { word: 'Suggested', icon: 'minus.circle' };
    case 'stale':
      return { word: 'Out of date', icon: 'clock.badge.xmark' };
    case 'rejected':
    case 'failed':
      return { word: 'Couldn’t apply', icon: 'xmark.octagon' };
  }
}

export function cardView(r: ActionRecord): CardView {
  const rendered = renderActionResult(r, 'sheet');
  return {
    actionId: r.actionId,
    status: statusOf(r),
    text: rendered.text,
    accessibilityPrefix: rendered.accessibilityPrefix,
    canUndo: r.status === 'committed' && r.undoneBy === null && r.detail.kind !== 'undo' && UNDOABLE.has(r.detail.kind),
    ...(r.detail.kind === 'build_workout' && r.status === 'committed' ? { draft: r } : {}),
    ...(r.detail.kind === 'build_plan' && r.status === 'committed' ? { plan: r } : {}),
    ...(r.detail.kind === 'propose_week' && r.status === 'proposed' ? { week: r } : {}),
    ...(r.detail.kind === 'log_activity' && r.status === 'proposed' ? { activityOffer: r } : {}),
    ...(r.detail.kind === 'propose_workout_edit' && r.status === 'proposed' ? { draftEdit: r } : {}),
    ...(r.detail.kind === 'fill_setup' && r.status === 'committed' ? { setupFill: r } : {}),
    ...(r.detail.kind === 'propose_plan_swap' && r.status === 'proposed' ? { planSwap: r } : {}),
  };
}

// ---------------------------------------------------------------------------
// `Why?` (coach-sheet §4.6): the coach's reason in quotes; everything else from the record

export interface WhyView {
  heading: string;
  reason: string | null;
  checks: string[];
  notChanged: string[];
  /** Always present; says so when nothing was missing. */
  notKnown: string[];
}

const NOT_CHANGED_KINDS = new Set<GuardNote['kind']>(['completed_set_dropped', 'not_pending', 'unknown_target', 'structural_dropped', 'rpe_overridden']);

export function whyView(r: ActionRecord, notAvailable: readonly string[] = []): WhyView {
  const proposed = r.status === 'proposed';
  // The built-in rule's change (author `checks`, CA6 revised): its reason is app text, not the coach's words.
  const byRule = r.author === 'checks';
  return {
    heading: byRule ? 'Rule' : proposed ? 'Why the coach suggested this' : 'Why the coach changed this',
    reason: r.reason === null || r.reason.trim() === '' ? null : byRule ? r.reason : `“${r.reason}”`,
    checks: [
      ...r.guardNotes.filter((n) => !NOT_CHANGED_KINDS.has(n.kind)).map((n) => n.text),
      // W11: the card says `Playbook, to review`; how review works is here.
      ...(r.detail.kind === 'add_playbook_candidate' ? ['Not in use until you approve it.'] : []),
    ],
    notChanged: [...r.guardNotes.filter((n) => NOT_CHANGED_KINDS.has(n.kind)).map((n) => n.text), ...(r.failure === null ? [] : [r.failure.charAt(0).toUpperCase() + r.failure.slice(1) + '.'])],
    notKnown: notAvailable.length > 0 ? [...notAvailable] : ['Nothing missing for this question.'],
  };
}

// ---------------------------------------------------------------------------
// The thread (coach-sheet §2.5): Ben's messages, coach sentences, cards, outcome lines

export type ThreadRow =
  | { kind: 'ben'; key: string; text: string; spoken: boolean; atUtc: string; tz: string }
  | { kind: 'coach'; key: string; sentences: string[]; atUtc: string; tz: string }
  | { kind: 'tools'; key: string; lines: string[] }
  | { kind: 'card'; key: string; card: CardView }
  | { kind: 'note'; key: string; text: string }
  /** (14 Oct) The coach's offer on the thread's last message: `Adjust` sends Ben's acceptance (CA1). */
  | { kind: 'offer'; key: string; input: Extract<BenInput, { kind: 'accept_offer' }> }
  /** `input`: what `Try again` sends, the turn's own (a summary review: `{ kind: 'summary' }`); null when unknown. */
  | { kind: 'outcome'; key: string; text: string; icon: ViewIcon; retry: boolean; why: string | null; input: BenInput | null };

const CHIP_TEXT: Record<Extract<BenInput, { kind: 'chip' }>['chip'], string> = { too_hard: 'Too hard', too_easy: 'Too easy', pain: 'Pain', lighter_session: 'Lighter session' };

/** The offer row's button, and Ben's message once tapped: `Adjust` today's sets, `Apply` a lift target. */
export function offerLabel(offer: Extract<BenInput, { kind: 'accept_offer' }>['offer']): string {
  return offer === 'lift_target' ? 'Apply' : 'Adjust';
}

export function benText(input: BenInput): string | null {
  switch (input.kind) {
    case 'words':
      return input.text;
    case 'chip':
      return CHIP_TEXT[input.chip];
    case 'accept_offer':
      return offerLabel(input.offer);
    case 'summary':
      return null;
  }
}

/**
 * The line for a turn that didn't finish (coach-sheet §5, shortened). `retry`: offers Try again.
 * F12 (13 Oct): each cause has its own line; `why` (behind `Why?`) names the recorded reason,
 * which the turn already stores as its `error`. (21 Oct, Ben's Build B report) With the provider's own
 * reason recorded on the turn (`failure`), `Why?` shows that (`HTTP 400 · invalid_request_error · …`).
 */
export function outcomeFor(status: CoachTurn['status'], error: CoachTurnError | null, anyCard: boolean, opts: { workoutModelGone?: boolean; failure?: CoachTurnFailure | null } = {}): { text: string; icon: ViewIcon; retry: boolean; why: string | null } | null {
  // The cards show anything applied; without one, say nothing changed (minimal copy, audit W2).
  const tail = anyCard ? '' : ' Nothing changed.';
  const said = opts.failure === undefined || opts.failure === null ? null : failureWhy(opts.failure);
  const line = (text: string, icon: ViewIcon, retry: boolean, why: string | null = null) => ({ text: `${text}${tail}`, icon, retry, why: said ?? why });
  if (status === 'interrupted') return line('Interrupted.', 'info.circle', true);
  if (status === 'cancelled') return line('Stopped.', 'info.circle', false);
  if (status !== 'failed') return null;
  switch (error) {
    case 'timeout':
      return line('No answer in time.', 'clock.badge.xmark', true);
    case 'network':
      return line('Offline.', 'wifi.slash', true);
    case 'usage_limit':
      return line('Usage limit reached.', 'pause.circle', false);
    case 'auth_expired':
      return line('Signed out.', 'exclamationmark.triangle', false);
    case 'not_eligible':
      return line('Unavailable.', 'xmark.octagon', false);
    case 'model_gone':
      return opts.workoutModelGone === true ? { ...line('Mid-workout model unavailable.', 'exclamationmark.triangle', false), why: MID_WORKOUT_MODEL_GONE } : line('Model unavailable.', 'exclamationmark.triangle', false);
    case 'too_many_steps':
      return line('Coach got stuck.', 'exclamationmark.triangle', true, 'Too many steps without an answer (too_many_steps).');
    case 'no_reply':
      return line('No reply.', 'exclamationmark.triangle', true, 'The answer was empty or unreadable (no_reply).');
    case 'unavailable':
      return line('Coach unavailable.', 'xmark.octagon', true, 'The AI service didn’t answer (unavailable).');
    case 'request_error':
      return line('Coach error.', 'exclamationmark.triangle', true, 'The AI service rejected the request (request_error).');
    case 'cancelled':
      return line('Stopped.', 'info.circle', true, 'The request was cancelled (cancelled).');
    case null:
      return line('Couldn’t reach the coach.', 'exclamationmark.triangle', true, 'No reason was recorded.');
  }
}

function toolLines(log: readonly ToolLogLine[]): string[] {
  return log.filter((l) => l.outcome === 'read').map((l) => l.text);
}

/** Ben's first message after a turn (the answer to its question), as he wrote or tapped it. */
function nextBenText(messages: readonly CoachMessage[], turnId: string): string | null {
  const sorted = [...messages].sort((a, b) => a.ordinal - b.ordinal);
  const at = sorted.map((m) => m.turnId).lastIndexOf(turnId);
  const next = sorted.slice(at + 1).find((m) => m.body.role === 'ben');
  return next === undefined || next.body.role !== 'ben' ? null : benText(next.body.input);
}

/**
 * Every row of a stored thread, oldest first. Cards come from the records, in commit order.
 * (Ben, 28 Oct) `running`: whether a turn is running in this app run. A saved `running` turn that is shows as the
 * live turn instead (its rows are left out here); one that isn't was cut off (`Interrupted.`, Try again).
 */
export function threadRows(data: ThreadData & { nowUtc?: string; running?: (turnId: string) => boolean }): ThreadRow[] {
  const rows: ThreadRow[] = [];
  const byTurn = new Map<string, CoachMessage[]>();
  for (const m of data.messages) byTurn.set(m.turnId, [...(byTurn.get(m.turnId) ?? []), m]);
  for (const [turnId, msgs] of byTurn) {
    const stored = data.turns.get(turnId) ?? null;
    if (stored?.status === 'running' && data.running?.(turnId) === true) continue;
    const turn = stored?.status === 'running' && data.running !== undefined ? { ...stored, status: 'interrupted' as const } : stored;
    const actions = data.actionsByTurn.get(turnId) ?? [];
    for (const m of msgs) {
      if (m.body.role === 'ben') {
        const text = benText(m.body.input);
        if (text !== null) rows.push({ kind: 'ben', key: m.id, text, spoken: m.body.input.kind === 'words' && m.body.input.spoken, atUtc: m.createdAt.utc, tz: m.createdAt.tz });
      }
    }
    const tools = toolLines(turn?.toolLog ?? []);
    if (tools.length > 0) rows.push({ kind: 'tools', key: `${turnId}:tools`, lines: tools });
    for (const a of actions) {
      const state = data.proposals?.get(a.actionId);
      const memory = data.memories?.get(a.actionId);
      const added = data.exerciseProposals?.get(a.actionId);
      const gymState = data.gymProposals?.get(a.actionId);
      const special = state !== undefined ? proposalCardView(a, state) : memory !== undefined ? memoryCardView(a, memory) : added !== undefined ? exerciseProposalCardView(a, added) : gymState !== undefined ? gymProposalCardView(a, gymState) : null;
      const question = a.detail.kind === 'build_question' ? questionCardView(a, nextBenText(data.messages, turnId), data.nowUtc === undefined ? 0 : toMs(data.nowUtc) - toMs(a.createdAt.utc)) : null;
      rows.push({ kind: 'card', key: a.actionId, card: question !== null ? { ...cardView(a), question } : (special ?? cardView(a)) });
    }
    const coach = msgs.find((m) => m.body.role === 'coach');
    if (coach !== undefined && coach.body.role === 'coach') {
      const sentences = coach.body.items.flatMap((i) => (i.kind === 'sentence' ? [i.text] : []));
      if (sentences.length > 0) rows.push({ kind: 'coach', key: coach.id, sentences, atUtc: coach.createdAt.utc, tz: coach.createdAt.tz });
      if (coach.body.note !== null && turn?.status === 'completed') {
        // Review coach-fail S2: the forced change step failed and the held answer stood; the note gets the provider's reason behind Why?.
        const ben = msgs.find((m) => m.body.role === 'ben');
        const input = ben?.body.role === 'ben' ? ben.body.input : null;
        if (turn.failure !== undefined) rows.push({ kind: 'outcome', key: `${coach.id}:note`, text: coach.body.note, icon: 'info.circle', retry: input !== null, why: failureWhy(turn.failure), input });
        else rows.push({ kind: 'note', key: `${coach.id}:note`, text: coach.body.note });
      }
    }
    if (turn !== null) {
      const o = outcomeFor(turn.status, turn.error, actions.length > 0, { failure: turn.failure ?? null });
      const ben = msgs.find((m) => m.body.role === 'ben');
      const input = ben?.body.role === 'ben' ? ben.body.input : null;
      if (o !== null) rows.push({ kind: 'outcome', key: `${turnId}:outcome`, ...o, retry: o.retry && input !== null, input });
    }
  }
  // (14 Oct) Only the latest message's offer can be accepted: anything Ben sent after it answers it.
  const last = data.messages.at(-1);
  if (last !== undefined && last.body.role === 'coach' && last.body.offer !== null && data.turns.get(last.turnId)?.status === 'completed') {
    rows.push({ kind: 'offer', key: `${last.id}:offer`, input: { kind: 'accept_offer', offer: last.body.offer } });
  }
  return rows;
}

// ---------------------------------------------------------------------------
// A turn while it runs (coach-sheet §3: Thinking → Using tools → Streaming)

export interface LiveTurn {
  turnId: string;
  benText: string | null;
  startedAtMs: number;
  firstEvent: boolean;
  tools: string[];
  cards: CardView[];
  sentences: string[];
}

export function startLiveTurn(turnId: string, input: BenInput, nowMs: number): LiveTurn {
  return { turnId, benText: benText(input), startedAtMs: nowMs, firstEvent: false, tools: [], cards: [], sentences: [] };
}

/** (Ben, 28 Oct) A turn running in the service as the sheet shows it: what it has shown so far, however long the sheet was closed. */
export function liveTurnOf(turn: Pick<RunningTurn, 'turnId' | 'input' | 'startedAtMs' | 'progress'>): LiveTurn {
  return turn.progress.reduce(applyProgress, startLiveTurn(turn.turnId, turn.input, turn.startedAtMs));
}

/** Fold one progress event into the live turn. Only what the saved message will also hold. */
export function applyProgress(live: LiveTurn, p: CoachTurnProgress): LiveTurn {
  switch (p.kind) {
    case 'first_event':
      return { ...live, firstEvent: true };
    case 'tool':
      return p.line.outcome === 'read' ? { ...live, firstEvent: true, tools: [...live.tools, p.line.text] } : { ...live, firstEvent: true };
    case 'card': {
      const question = questionCardView(p.card.record, null, 0);
      return { ...live, firstEvent: true, cards: [...live.cards, question === null ? cardView(p.card.record) : { ...cardView(p.card.record), question }] };
    }
    case 'item':
      return p.item.kind === 'sentence' ? { ...live, firstEvent: true, sentences: [...live.sentences, p.item.text] } : live;
  }
}

/** `Coach · …` while thinking; an elapsed counter after 3 s (no animated dots, check 22). */
export function thinkingLabel(live: LiveTurn, nowMs: number): string | null {
  if (live.sentences.length > 0) return null;
  const s = Math.floor((nowMs - live.startedAtMs) / 1000);
  if (s < 3) return 'Coach · …';
  return `Coach · ${String(Math.floor(s / 60))}:${String(s % 60).padStart(2, '0')}`;
}

export type { ReplyItem };

// ---------------------------------------------------------------------------
// The sheet's context chip and workout bar (coach-sheet §2.1, §2.4)

/** Why a thread's workout isn't in the coach's context: deleted (or purged), or otherwise not in history or unreadable. */
export type WorkoutOutOfContext = 'deleted' | 'unavailable';

/**
 * A loaded thread workout out of the coach's context, as the chip says it (delete-workouts §5, DW16;
 * review r2 N3, r3 N5): deleted → `deleted`; discarded or reverted → `unavailable`; live or in history → none.
 */
export function loadedOutOfContext(session: Pick<WorkoutSession, 'status'>): WorkoutOutOfContext | null {
  if (session.status === 'active' || isInHistory(session)) return null;
  return session.status === 'deleted' ? 'deleted' : 'unavailable';
}

/** A thread workout that couldn't be loaded: purged → `deleted`; anything else (unreadable, missing) → `unavailable`. */
export function missingOutOfContext(presence: WorkoutPresence['kind']): WorkoutOutOfContext {
  return presence === 'gone' ? 'deleted' : 'unavailable';
}

/**
 * `Sees: Push A (live)`, `Sees: this workout`, `Sees: Today`; `Deleted
 * workout` once the thread's workout is deleted (delete-workouts §5, DW16),
 * `Workout unavailable` when the coach is given nothing of it (review r2 N3).
 * A custom Progress period names its year unless `today` shows it's this
 * year's (review ben-bugs B1); with no `today` the year is always named.
 */
export function seesLabel(entry: CoachEntry, workoutTitle: string | null, active: boolean, out: WorkoutOutOfContext | null = null, today: string | null = null): string {
  if (out !== null && entry.kind !== 'today') return out === 'deleted' ? 'Deleted workout' : 'Workout unavailable';
  switch (entry.kind) {
    case 'today':
      return 'Sees: Today';
    case 'progress':
      return entry.range ? `Sees: Progress · ${rangeText(entry.range, today ?? '')}` : `Sees: Progress · last ${progressPeriodPhrase(entry.period)}`;
    case 'progress_exercise':
      return `Sees: ${entry.exerciseName} · ${entry.seriesLabel}`;
    case 'summary':
      return `Sees: ${workoutTitle ?? 'this workout'}`;
    case 'workout':
      return `Sees: ${workoutTitle ?? 'Workout'}${active ? ' (live)' : ''}`;
    case 'draft':
    case 'builder':
      return `Sees: ${entry.name} (draft)`;
  }
}

/**
 * The workout bar (CS3): the rest left or `Ready`; tapping closes the sheet.
 * It never logs and has no Log label.
 */
export function workoutBarText(rest: { kind: 'running' | 'paused'; remainingMs: number } | { kind: 'ended' } | null, paused: boolean): string {
  if (paused) return 'Paused';
  if (rest !== null && rest.kind !== 'ended') {
    const s = Math.max(0, Math.ceil(rest.remainingMs / 1000));
    return `Rest ${String(Math.floor(s / 60))}:${String(s % 60).padStart(2, '0')}`;
  }
  return 'Ready';
}

/**
 * `Saved to Profile · Undo` on a question card (§6.2, WB-Q9; review S7),
 * read from the training profile itself so it survives closing and
 * reopening the sheet: the answer's save op (`<actionId>:main-lift`) is in
 * the profile's applied ops; Undo only while it is still the newest change
 * (the version the answer saved); `undone` once its undo op is applied.
 */
export type AnswerSaveState = { state: 'saved' | 'undone'; canUndo: boolean };

export function answerSaveOf(actionId: string, profile: { recentOps: readonly string[] } | null): AnswerSaveState | null {
  if (profile === null) return null;
  const save = `${actionId}:main-lift`;
  if (!profile.recentOps.includes(save)) return null;
  if (profile.recentOps.includes(`${actionId}:main-lift-undo`)) return { state: 'undone', canUndo: false };
  return { state: 'saved', canUndo: profile.recentOps.at(-1) === save };
}

/**
 * The transcript's follow state (design pass 4.1, review S2): whether Ben is
 * at the end, and how much content was shown. `thread` resets it, so another
 * (or a new) conversation always opens at its end, even after Ben scrolled up
 * in a longer one.
 */
export function transcriptFollow() {
  let atBottom = true;
  let shown = 0;
  let threadKey: string | null | undefined;
  return {
    /** The thread shown now; a different one starts over at the end. */
    thread: (key: string | null | undefined): void => {
      if (key === threadKey) return;
      threadKey = key;
      atBottom = true;
      shown = 0;
    },
    scrolled: (isBottom: boolean): void => {
      atBottom = isBottom;
    },
    /** Whether this layout or size change scrolls to the end. */
    follow: (count: number, starters: boolean): boolean => {
      const added = count > shown;
      shown = count;
      return stickToEnd({ atBottom, added, starters });
    },
  };
}

/** (21 Oct) Space kept above the newest turn when following it, so its first line never sits on the transcript's top edge. */
export const FOLLOW_TOP_GAP = 12;

/**
 * (21 Oct, Ben's Build B report: an outcome line and a change card cut off under `Ready · Back to workout ›`)
 * Where following new content scrolls to: the end, unless the newest turn (from Ben's message) is taller than the
 * view, say with the keyboard up; then its start, `FOLLOW_TOP_GAP` below the top edge, so its first lines (the
 * card, the outcome line) are in view rather than half under the top. `turnTop`: the newest turn's top in content
 * coordinates; null when unknown. Pure.
 */
export function followOffset(s: { contentHeight: number; viewportHeight: number; turnTop: number | null }): number {
  const end = Math.max(0, s.contentHeight - s.viewportHeight);
  if (s.turnTop === null) return end;
  return Math.min(end, Math.max(0, s.turnTop - FOLLOW_TOP_GAP));
}

/**
 * (Ben, 29 Oct: "The mic [on Today] listens but doesn't do anything") Words from Today's bar (the mic's, or typed):
 * the coach sheet opens with them sent as Ben's message at once, so the running turn shows straight away. No model
 * call runs before the sheet opens; a failure is the sheet's own line. `id`: a re-render or remount sends once.
 */
export interface SheetAsk {
  id: string;
  text: string;
  spoken: boolean;
}

export function todayAskParams(words: string, spoken: boolean, id: string): { entry: { kind: 'today' }; ask: SheetAsk } | null {
  const text = words.trim();
  return text === '' ? null : { entry: { kind: 'today' }, ask: { id, text, spoken } };
}

/** The message to send for `ask`, once per ID (`sent` remembers them while the app runs); null: none, or already sent. */
export function takeAsk(sent: Set<string>, ask: SheetAsk | undefined): Extract<BenInput, { kind: 'words' }> | null {
  if (ask === undefined || ask.text.trim() === '' || sent.has(ask.id)) return null;
  sent.add(ask.id);
  return { kind: 'words', text: ask.text.trim(), spoken: ask.spoken };
}

/** ADR 0039: the words on a Your workout change card. Minimal copy. */
/**
 * (Ben, 30 Oct) A plan swap's lines from its record: `Leg extension → Leg press`, then each day (`Legs B: − Leg
 * extension` where the day already has the exercise coming in). App text only.
 */
export function planSwapLines(r: ActionRecord): { head: string; days: string[] } | null {
  if (r.detail.kind !== 'propose_plan_swap') return null;
  const d = r.detail;
  return { head: `${d.removeName} → ${d.addName}`, days: d.days.map((x) => (x.edits.every((e) => e.kind === 'remove') ? `${x.routineName}: − ${d.removeName}` : x.routineName)) };
}

export const DRAFT_EDIT_COPY = { apply: 'Apply', skip: 'Skip', undo: 'Undo', applied: 'Applied', skipped: 'Skipped', undone: 'Undone', openSetup: 'Open Set up' } as const;
