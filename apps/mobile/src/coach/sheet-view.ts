/**
 * View models for the coach sheet (coach-sheet.md, ADR 0020 C6). Pure: the
 * screen renders these and calls the coach service; it never decides
 * wording or what a card says. Minimal copy (CLAUDE.md, 10 Oct): states are
 * one or two words, and any explanation sits behind `Why?`.
 *
 * Every change line is rendered from a saved `ActionRecord`
 * (`renderActionResult`), never from the model's words (PM decision 10 Oct).
 */

import { memoryTextKind, renderActionResult, type CoachTurnProgress, type ReplyItem } from '@fizz/coach';
import { isInHistory, rangeText } from '@fizz/domain';
import type { ActionRecord, BenInput, CoachMessage, CoachTurn, CoachTurnError, GuardNote, ToolLogLine, WorkoutSession } from '@fizz/schemas';

import type { CoachAvailability, CoachEntry, MemoryCardState, ProposalCardState, ThreadData } from './coach-service';
import type { WorkoutPresence } from '../services/history-services';

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

export function statusView(a: CoachAvailability): StatusView {
  const ready = { icon: 'info.circle' as const, why: null, action: null, canSend: true, placeholder: 'Ask the coach…' };
  switch (a.status) {
    case 'ok':
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

export function starterChips(entry: CoachEntry, a: CoachAvailability, workoutActive: boolean): StarterChip[] {
  const pain: StarterChip = { label: 'Pain', input: null };
  const words = (text: string): StarterChip => ({ label: text, input: { kind: 'words', text, spoken: false } });
  // Pain is deterministic and works offline; the rest need the coach.
  const ready = a.status === 'ok' || a.status === 'offline';
  switch (entry.kind) {
    case 'workout':
      if (!workoutActive) return ready ? [words('How did that go?')] : [];
      return ready
        ? [{ label: 'Too hard', input: { kind: 'chip', chip: 'too_hard' } }, { label: 'Too easy', input: { kind: 'chip', chip: 'too_easy' } }, words('Short on time'), words('Machine busy'), pain]
        : [pain];
    case 'summary':
      return ready ? [words('What should I change next time?')] : [];
    case 'today':
      // The coach reads past workouts through `get_training_overview` (backlog §4.3). `Build a workout` (workout-builder §3) shows
      // disabled when the coach can't answer (§5.4); `Plan my week` isn't built.
      return [{ label: 'Build a workout', input: null, build: { enabled: a.status === 'ok' } }, ...(ready ? [words('How am I doing?')] : [])];
    case 'draft':
      // `Ask coach` on a coach draft (BD16): Ben says what to change; no chips.
      return [];
    case 'progress':
    case 'progress_exercise':
      // Progress keeps no starter chip at the merge with coach tools (main's review S4 behaviour); whether it
      // offers `How am I doing?` now that the coach reads past workouts is Ben's call.
      return [];
  }
}

// ---------------------------------------------------------------------------
// Cards (coach-sheet §2.6): status word and icon, never colour alone

export type CardStatusWord = 'Applied' | 'Added' | 'Saved' | 'Logged' | 'Undone' | 'Not applied' | 'Not saved' | 'Out of date' | 'Couldn’t apply' | 'Couldn’t apply here' | 'Suggested';

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

const UNDOABLE = new Set<ActionRecord['detail']['kind']>(['adjust_pending_sets', 'add_exercise_today', 'log_set', 'correct_set', 'set_next_session_targets', 'set_pain_flag', 'save_memory', 'forget_memory', 'add_playbook_candidate']);

function statusOf(r: ActionRecord): CardView['status'] {
  if (r.status === 'committed' && r.undoneBy !== null) return { word: 'Undone', icon: 'arrow.uturn.backward' };
  switch (r.status) {
    case 'committed':
      if (r.detail.kind === 'log_set') return { word: 'Logged', icon: 'checkmark.circle.fill' };
      if (r.detail.kind === 'add_exercise_today') return { word: 'Added', icon: 'checkmark.circle.fill' };
      return r.detail.kind === 'save_memory' || r.detail.kind === 'add_playbook_candidate' ? { word: 'Saved', icon: 'checkmark.circle.fill' } : { word: 'Applied', icon: 'checkmark.circle.fill' };
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
  /** `input`: what `Try again` sends, the turn's own (a summary review: `{ kind: 'summary' }`); null when unknown. */
  | { kind: 'outcome'; key: string; text: string; icon: ViewIcon; retry: boolean; input: BenInput | null };

const CHIP_TEXT: Record<Extract<BenInput, { kind: 'chip' }>['chip'], string> = { too_hard: 'Too hard', too_easy: 'Too easy', pain: 'Pain', lighter_session: 'Lighter session' };

export function benText(input: BenInput): string | null {
  switch (input.kind) {
    case 'words':
      return input.text;
    case 'chip':
      return CHIP_TEXT[input.chip];
    case 'accept_offer':
      return 'Adjust';
    case 'summary':
      return null;
  }
}

/** The line for a turn that didn't finish (coach-sheet §5, shortened). `retry`: offers Try again. */
export function outcomeFor(status: CoachTurn['status'], error: CoachTurnError | null, anyCard: boolean): { text: string; icon: ViewIcon; retry: boolean } | null {
  // The cards show anything applied; without one, say nothing changed (minimal copy, audit W2).
  const tail = anyCard ? '' : ' Nothing changed.';
  if (status === 'interrupted') return { text: `Interrupted.${tail}`, icon: 'info.circle', retry: true };
  if (status === 'cancelled') return { text: `Stopped.${tail}`, icon: 'info.circle', retry: false };
  if (status !== 'failed') return null;
  switch (error) {
    case 'timeout':
      return { text: `No answer in time.${tail}`, icon: 'clock.badge.xmark', retry: true };
    case 'network':
      return { text: `Offline.${tail}`, icon: 'wifi.slash', retry: true };
    case 'usage_limit':
      return { text: `Usage limit reached.${tail}`, icon: 'pause.circle', retry: false };
    case 'auth_expired':
      return { text: `Signed out.${tail}`, icon: 'exclamationmark.triangle', retry: false };
    case 'not_eligible':
      return { text: `Unavailable.${tail}`, icon: 'xmark.octagon', retry: false };
    case 'model_gone':
      return { text: `Model unavailable.${tail}`, icon: 'exclamationmark.triangle', retry: false };
    case 'too_many_steps':
    case 'no_reply':
    case 'unavailable':
    case 'cancelled':
    case null:
      return { text: `Couldn’t reach the coach.${tail}`, icon: 'exclamationmark.triangle', retry: true };
  }
}

function toolLines(log: readonly ToolLogLine[]): string[] {
  return log.filter((l) => l.outcome === 'read').map((l) => l.text);
}

/** Every row of a stored thread, oldest first. Cards come from the records, in commit order. */
export function threadRows(data: ThreadData): ThreadRow[] {
  const rows: ThreadRow[] = [];
  const byTurn = new Map<string, CoachMessage[]>();
  for (const m of data.messages) byTurn.set(m.turnId, [...(byTurn.get(m.turnId) ?? []), m]);
  for (const [turnId, msgs] of byTurn) {
    const turn = data.turns.get(turnId) ?? null;
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
      const special = state !== undefined ? proposalCardView(a, state) : memory !== undefined ? memoryCardView(a, memory) : null;
      rows.push({ kind: 'card', key: a.actionId, card: special ?? cardView(a) });
    }
    const coach = msgs.find((m) => m.body.role === 'coach');
    if (coach !== undefined && coach.body.role === 'coach') {
      const sentences = coach.body.items.flatMap((i) => (i.kind === 'sentence' ? [i.text] : []));
      if (sentences.length > 0) rows.push({ kind: 'coach', key: coach.id, sentences, atUtc: coach.createdAt.utc, tz: coach.createdAt.tz });
      if (coach.body.note !== null && turn?.status === 'completed') rows.push({ kind: 'note', key: `${coach.id}:note`, text: coach.body.note });
    }
    if (turn !== null) {
      const o = outcomeFor(turn.status, turn.error, actions.length > 0);
      const ben = msgs.find((m) => m.body.role === 'ben');
      const input = ben?.body.role === 'ben' ? ben.body.input : null;
      if (o !== null) rows.push({ kind: 'outcome', key: `${turnId}:outcome`, ...o, retry: o.retry && input !== null, input });
    }
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

/** Fold one progress event into the live turn. Only what the saved message will also hold. */
export function applyProgress(live: LiveTurn, p: CoachTurnProgress): LiveTurn {
  switch (p.kind) {
    case 'first_event':
      return { ...live, firstEvent: true };
    case 'tool':
      return p.line.outcome === 'read' ? { ...live, firstEvent: true, tools: [...live.tools, p.line.text] } : { ...live, firstEvent: true };
    case 'card':
      return { ...live, firstEvent: true, cards: [...live.cards, cardView(p.card.record)] };
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
      return entry.range ? `Sees: Progress · ${rangeText(entry.range, today ?? '')}` : `Sees: Progress · last ${String(entry.days)} days`;
    case 'progress_exercise':
      return `Sees: ${entry.exerciseName} · ${entry.seriesLabel}`;
    case 'summary':
      return `Sees: ${workoutTitle ?? 'this workout'}`;
    case 'workout':
      return `Sees: ${workoutTitle ?? 'Workout'}${active ? ' (live)' : ''}`;
    case 'draft':
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
