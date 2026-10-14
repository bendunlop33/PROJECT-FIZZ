import type { Load, PlannedSet, TrainingGoal } from '@fizz/schemas';
import { formatNumber } from '../display';
import { loadDirection } from '../equipment';
import { fitKeepingTail } from './builder-loads';

/**
 * Why each exercise in a coach draft is what it is, in one short line
 * (Ben, 14 Oct: "it gave me 4 sets on 90kg for 6–8 with no reason why").
 * Pure. Data, not rule prose (minimal-copy convention), always built by
 * code (review r2 B1r): the real reference sets and the final load
 * (`last 3: 100×7 @8 → 102.5`, `last 100×7 @8 · capped → 107.5`, `held ·
 * last 100×7 @8 → 100`, `est. from incline 30×8 → 27.5 each`, `Rule · last
 * 85×8`), and why those sets and reps only when notable (`main lift ·
 * strength`). The coach's own words never appear here; they are a `Coach's
 * note` behind `Why?`.
 */

/** Longest line shown under an exercise; the load part keeps its final `→ N` (N1r), the rest is dropped. */
export const REASON_LINE_MAX = 64;

const GOAL_WORD: Readonly<Record<TrainingGoal, string>> = { strength: 'strength', muscle: 'muscle', both: 'strength + muscle' };

/** `85×8 @8`: the hardest working set of a stored basis (an actual result). */
function topText(sets: readonly { setType: string; values: { load: Load | null; reps: number | null; rpe: number | null } }[]): string | null {
  let top: { load: Load; reps: number; rpe: number | null } | null = null;
  for (const s of sets) {
    const l = s.values.load;
    const r = s.values.reps;
    if (s.setType === 'warmup' || l === null || r === null || l.convention === 'bodyweight') continue;
    const harder = top === null || (loadDirection(l.convention) === 'resistance' ? l.value > top.load.value : l.value < top.load.value) || (l.value === top.load.value && r > top.reps);
    if (harder) top = { load: l, reps: r, rpe: s.values.rpe };
  }
  if (top === null) return null;
  const v = top.load.convention === 'added' ? `+${formatNumber(top.load.value)}` : formatNumber(top.load.value);
  return `${v}×${String(top.reps)}${top.rpe === null ? '' : ` @${formatNumber(top.rpe)}`}`;
}

function cut(parts: readonly string[]): string {
  let out = '';
  for (const p of parts) {
    const next = out === '' ? p : `${out} · ${p}`;
    if (next.length > REASON_LINE_MAX && out !== '') break;
    out = next.length > REASON_LINE_MAX ? `${next.slice(0, REASON_LINE_MAX - 1)}…` : next;
  }
  return out;
}

export interface ReasonLineInput {
  /** The exercise's first working (or top) set as planned. */
  planned: PlannedSet | null;
  /** Measured in reps (a timed exercise has no load line). */
  reps: boolean;
  /** The draft's main lift (BD19, WL9). */
  main: boolean;
  /** Ben's goal (Training details), for the main lift's line; null when not set. */
  goal: TrainingGoal | null;
}

/**
 * The line under one exercise on the coach draft overview, or null when
 * there's nothing to say. Load part:
 * - a coach load: its basis (the coach's words when they passed
 *   `checkBasis`, else code's), `est.` first when it is an estimate,
 *   `held` first when pain holds it;
 * - the built-in rule: `Rule · last 85×8`;
 * - no load possible: `first time · start light`.
 * Shape part, only when notable: `main lift · strength`.
 */
export function draftReasonLine(input: ReasonLineInput): string | null {
  const parts: string[] = [];
  const p = input.planned;
  if (input.reps && p !== null) {
    const prov = p.provenance;
    if (p.source === 'coach' && prov?.coach?.scope === 'build') {
      // Code's line (first guard note), never `coach.reason` (the coach's note, `Why?` only).
      const basis = (prov.guardNotes[0] ?? '').trim();
      const load: string[] = [];
      if (prov.held === true) load.push('held');
      if (prov.estimate === true && !/^est\b/i.test(basis)) load.push('est.');
      if (basis !== '') load.push(basis);
      if (load.length > 0) parts.push(fitKeepingTail(load.join(' · '), REASON_LINE_MAX));
    } else if (p.source === 'built_in_rule') {
      const last = prov?.basis ? topText(prov.basis.sets) : null;
      parts.push(last === null ? 'Rule' : `Rule · last ${last}${prov?.basis?.imported === true ? ' (FitNotes)' : ''}`);
    } else if (p.load === null) {
      parts.push('first time · start light');
    }
  }
  if (input.main) parts.push(input.goal === null ? 'main lift' : `main lift · ${GOAL_WORD[input.goal]}`);
  return parts.length === 0 ? null : cut(parts);
}

export interface HeadNoteInput {
  /** The split day built for (`Push`), null with `Coach picks` and no clear split. */
  split: string | null;
  /** The main lift's name, when the workout has one. */
  mainLift: string | null;
  minutes: number;
  /** The last workout of the same split day, in whole local days ago; null when none. */
  lastSameDaysAgo: number | null;
}

/**
 * The draft's one-line note at the top (Ben, 14 Oct): `Push · Bench press ·
 * 45 min · last Push 6 days ago`. Values only; the parts that aren't known
 * are left out.
 */
export function draftHeadNote(h: HeadNoteInput): string {
  const ago = h.lastSameDaysAgo === null || h.split === null ? null : h.lastSameDaysAgo <= 0 ? `last ${h.split} today` : h.lastSameDaysAgo === 1 ? `last ${h.split} yesterday` : `last ${h.split} ${String(h.lastSameDaysAgo)} days ago`;
  return [h.split, h.mainLift, `${String(h.minutes)} min`, ago].filter((x): x is string => x !== null && x !== '').join(' · ');
}

/** One `LOADS` entry of `Why this workout` (§4.5): the final target, its label, the basis quoted and code's notes. */
export interface LoadWhyEntry {
  name: string;
  target: string;
  label: 'est.' | 'Rule' | 'HELD' | null;
  /** The coach's note, quoted under `Coach's note` (data, not fact); null when none passed `checkBasis` or code changed the load. */
  quote: string | null;
  notes: string[];
  /** The coach's basis that wasn't used (failed `checkBasis`, or named another number than the final load): `NOT USED` (WB-L9). */
  notUsed: string | null;
}

/** What the draft stored for the exercise and what planning it today added (review S4). */
export interface LoadWhyExtra {
  /** Build-time check notes of the stored load. */
  storedNotes: readonly string[];
  /** The stored (or re-checked) coach basis that wasn't used. */
  notUsed: string | null;
  /** Plan-time notes (`recheckDraftSlot`'s fallback: `different equipment here · rule used`). */
  planNotes?: readonly string[];
}

/** The `LOADS` entries of `Why this workout` from the planned sets (code values; the coach's words only quoted). */
export function loadWhyEntry(name: string, target: string, planned: PlannedSet | null, extra: LoadWhyExtra): LoadWhyEntry {
  const prov = planned?.provenance;
  const notUsed = extra.notUsed === null || extra.notUsed.trim() === '' ? null : extra.notUsed;
  const merged = (base: readonly string[]): string[] => [...new Set([...base, ...(extra.planNotes ?? [])])];
  if (planned?.source === 'coach' && prov?.coach?.scope === 'build') {
    // B3: HELD only for a pain hold, from the check's own flag (never a note's first word).
    return { name, target, label: prov.held === true ? 'HELD' : prov.estimate === true ? 'est.' : null, quote: prov.coach.reason, notes: merged(prov.guardNotes), notUsed };
  }
  if (planned?.source === 'built_in_rule') return { name, target, label: 'Rule', quote: null, notes: merged(extra.storedNotes), notUsed };
  return { name, target, label: null, quote: null, notes: merged(extra.storedNotes), notUsed };
}

/**
 * The row panel's `LOAD` line (§4.4): `LOAD  102.5 kg`, `LOAD  12.5 kg ·
 * est.`, `LOAD  100 kg · Rule`, `LOAD  95 kg · HELD`, `LOAD  — · start
 * light`. `Why?` is the panel's own pill.
 */
export function loadPanelLine(e: Pick<LoadWhyEntry, 'target' | 'label'>): string {
  if (e.target === '—' || e.target.trim() === '') return 'LOAD  — · start light';
  return `LOAD  ${e.target}${e.label === null ? '' : ` · ${e.label}`}`;
}

/** Which history a draft's loads came from (`USED`, review S4): only what was actually read. */
export type HistoryUsed = 'logged' | 'fitnotes' | 'both' | null;

/** `Logged history`, `FitNotes history`, `Logged and FitNotes history`; null when no load came from history. */
export function historyUsedLine(h: HistoryUsed): string | null {
  return h === 'both' ? 'Logged and FitNotes history' : h === 'logged' ? 'Logged history' : h === 'fitnotes' ? 'FitNotes history' : null;
}

/** Combine per-exercise sources into one `HistoryUsed`. */
export function historyUsedOf(sources: readonly ('app' | 'fitnotes')[]): HistoryUsed {
  const app = sources.includes('app');
  const fit = sources.includes('fitnotes');
  return app && fit ? 'both' : app ? 'logged' : fit ? 'fitnotes' : null;
}
