/**
 * The Summary's `Next time` with the coach (workout-summary §2 region 6,
 * D21, ADR 0020 C8). Pure. The built-in rule's rows (`buildWorkoutSummary`)
 * are the fallback; a coach row replaces its exercise's row while the
 * coach's target is in use. Small changes are already saved: the row shows
 * the target and its %, `Why?` (the coach's reason, checks and the built-in
 * rule's value) and `Undo`. Bigger changes are suggestions with `Apply`.
 * Every number comes from the saved row, never from the model's words.
 */

import { targetPhrase } from '@fizz/coach';
import { briefLine, EXERCISE_SHORT_FORMS, pctText, shortFormMeans, type NextTimeRow } from '@fizz/domain';
import type { CoachTarget, NextSessionTargetRecord } from '@fizz/schemas';

import type { CoachAvailability } from './coach-service';

export type NextTimeTap = 'undo' | 'use_coach' | 'apply' | 'not_now';

export interface NextTimeRowView {
  key: string;
  exerciseName: string;
  /** `Target 97.5 kg × 6–8` (+ ` · 4 sets`). */
  target: string;
  /** `−2.5%`, from the saved values. */
  pct: string | null;
  /** `Coach`, `Suggested`, `Rule` (D1). */
  tag: string;
  /** Behind `Why?`. */
  why: string[];
  actions: { label: string; tap: NextTimeTap }[];
  /** `Used` once a workout started from this one. */
  note: string | null;
  /** The saved row, for taps. Null on a built-in row. */
  row: NextSessionTargetRecord | null;
  /**
   * (Ben, 23 Oct) The built-in rule's own stall reset on this row, for its taps (`tapRuleReset`): the reset, the hold
   * and Ben's answer so far (null: none yet). Absent: no reset here.
   */
  reset?: { exerciseId: string; exerciseName: string; target: CoachTarget; hold: CoachTarget | null; row: NextSessionTargetRecord | null };
}

export interface NextTimeView {
  heading: string;
  /** `Coach reviewing…` while the summary turn runs; null otherwise. */
  status: string | null;
  rows: NextTimeRowView[];
  emptyText: string | null;
  /** `Undo all` when two or more coach targets are saved and none used: an Undo on each of those rows. */
  undoAll: { actionId: string; rows: NextSessionTargetRecord[] } | null;
}

function setsPart(sets: number | null): string {
  return sets === null ? '' : ` · ${String(sets)} sets`;
}

function coachRow(r: NextSessionTargetRecord, builtIn: NextTimeRow | undefined, stale: boolean): NextTimeRowView {
  const used = r.usedBySessionId !== null;
  const builtInLine = r.builtIn === null ? null : `Rule: ${targetPhrase(r.builtIn)}${setsPart(r.builtInSets)}`;
  const why = [...(r.reason === null ? [] : [`“${r.reason}”`]), ...r.guardNotes.map((n) => n.text), ...(builtInLine === null ? [] : [builtInLine])];
  const target = `Target ${targetPhrase(r.target)}${setsPart(r.sets)}`;
  const base = { key: r.id, exerciseName: r.exerciseName, pct: pctText(r.pctChange), row: r, note: used ? 'Used' : null };
  const ruleTarget = builtIn?.target ?? (r.builtIn === null ? 'Same targets' : `Target ${targetPhrase(r.builtIn)}`);
  // The workout's sets changed since the review (a correction): the next workout won't use it, so neither does this row.
  if (stale && !used) return { ...base, target: ruleTarget, pct: null, tag: 'Rule', why: [`Coach target: ${targetPhrase(r.target)}${setsPart(r.sets)}`, ...why.filter((w) => w !== builtInLine)], actions: [] };
  switch (r.status) {
    case 'saved':
    case 'applied':
      return { ...base, target, tag: 'Coach', why, actions: used ? [] : [{ label: 'Undo', tap: 'undo' }] };
    case 'undone':
      return {
        ...base,
        target: builtIn?.target ?? (r.builtIn === null ? 'Same targets' : `Target ${targetPhrase(r.builtIn)}`),
        pct: null,
        tag: 'Rule',
        why: [`Coach target: ${targetPhrase(r.target)}${setsPart(r.sets)}`, ...why.filter((w) => w !== builtInLine)],
        actions: used ? [] : [{ label: 'Use coach target', tap: 'use_coach' }],
      };
    case 'proposed':
      return { ...base, target, tag: 'Suggested', why, actions: used ? [] : [{ label: 'Not now', tap: 'not_now' }, { label: 'Apply', tap: 'apply' }] };
    case 'not_applied':
      return {
        ...base,
        target: builtIn?.target ?? (r.builtIn === null ? 'Same targets' : `Target ${targetPhrase(r.builtIn)}`),
        pct: null,
        tag: 'Rule',
        why: [`Suggested: ${targetPhrase(r.target)}${setsPart(r.sets)}`, ...why.filter((w) => w !== builtInLine)],
        actions: [],
      };
  }
}

/**
 * (Ben, 23 Oct; review v5offers SP2) A built-in rule row. A stall reset is an offer: `Reset to 90 kg × 6–8?` with
 * `Skip` / `Apply` (offered, or offered again after an Undo); once applied the row is the reset with `Undo`; skipped,
 * the hold with no buttons. A workout started from this one since: no buttons (`Used`).
 */
function ruleRow(b: NextTimeRow, sourceTag: string, answer: NextSessionTargetRecord | null): NextTimeRowView {
  const base: NextTimeRowView = { key: b.exerciseId, exerciseName: b.exerciseName, target: b.target, pct: null, tag: sourceTag, why: [briefLine(b.summary)], actions: [], note: null, row: null };
  const used = answer?.usedBySessionId != null;
  if (b.resetApplied === true && answer !== null && answer.status === 'applied') {
    return { ...base, note: used ? 'Used' : null, actions: used ? [] : [{ label: 'Undo', tap: 'undo' }], reset: { exerciseId: b.exerciseId, exerciseName: b.exerciseName, target: answer.target, hold: answer.builtIn, row: answer } };
  }
  const offer = b.resetOffer;
  if (offer === undefined) return base;
  const reset = { exerciseId: b.exerciseId, exerciseName: b.exerciseName, target: { load: offer.load, reps: offer.reps }, hold: { load: offer.hold.load, reps: offer.hold.reps }, row: answer };
  const open = !used && (answer === null || answer.status === 'proposed');
  return open ? { ...base, note: offer.text, actions: [{ label: 'Skip', tap: 'not_now' }, { label: 'Apply', tap: 'apply' }], reset } : { ...base, note: used ? 'Used' : null, reset };
}

export interface NextTimeInput {
  /** `Push A` or the workout's title. */
  title: string;
  /** `buildWorkoutSummary(…).nextTime`; null hides the section. */
  builtIn: { sourceTag: string; rows: NextTimeRow[]; emptyText: string | null } | null;
  coachRows: readonly NextSessionTargetRecord[];
  /** Rows whose workout changed since they were saved (`staleNextTargets`): shown as the built-in rule's. */
  stale?: ReadonlySet<string>;
  /** (Ben, 23 Oct) Ben's answers to the rule's own stall resets (`ruleResets`). */
  ruleRows?: readonly NextSessionTargetRecord[];
  availability: CoachAvailability;
  reviewing: boolean;
}

export function nextTimeView(input: NextTimeInput): NextTimeView | null {
  if (input.builtIn === null) return null;
  const byExercise = new Map(input.coachRows.map((r) => [r.exerciseId, r]));
  const stale = input.stale ?? new Set<string>();
  const rows: NextTimeRowView[] = [];
  const seen = new Set<string>();
  for (const b of input.builtIn.rows) {
    const c = byExercise.get(b.exerciseId);
    seen.add(b.exerciseId);
    if (c !== undefined) rows.push(coachRow(c, b, stale.has(c.id)));
    // One short line (Ben, 18 Oct): the rule's facts stay stored and in the coach's context, not on screen (review B3).
    else rows.push(ruleRow(b, input.builtIn.sourceTag, input.ruleRows?.find((r) => r.exerciseId === b.exerciseId) ?? null));
  }
  // Coach rows for exercises the built-in rule didn't list (it held them).
  for (const c of input.coachRows) if (!seen.has(c.exerciseId)) rows.push(coachRow(c, undefined, stale.has(c.id)));
  const live = input.coachRows.filter((r) => (r.status === 'saved' || r.status === 'applied') && r.usedBySessionId === null && !stale.has(r.id));
  const actionIds = [...new Set(live.map((r) => r.actionId))];
  const only = actionIds.length === 1 ? actionIds[0] : undefined;
  return {
    heading: `Next time · ${input.title}`,
    status: input.reviewing ? 'Coach reviewing…' : null,
    rows,
    emptyText: rows.length === 0 ? input.builtIn.emptyText : null,
    undoAll: live.length >= 2 && only !== undefined ? { actionId: only, rows: live } : null,
  };
}

/** Words too common in exercise names to say which one a sentence is about. */
const GENERIC_NAME_WORDS = new Set(['press', 'raise', 'raises', 'curl', 'curls', 'extension', 'extensions', 'machine', 'cable', 'barbell', 'dumbbell', 'seated', 'standing', 'single', 'assisted', 'supported']);

function mentions(sentence: string, exerciseName: string): boolean {
  const said = ` ${sentence.toLowerCase().replace(/[^a-z0-9]+/g, ' ')} `;
  const name = exerciseName.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  if (said.includes(` ${name} `)) return true;
  if ([...EXERCISE_SHORT_FORMS.keys()].some((short) => said.includes(` ${short} `) && shortFormMeans(short, name))) return true;
  return name.split(' ').some((w) => w.length >= 4 && !GENERIC_NAME_WORDS.has(w) && (said.includes(` ${w} `) || said.includes(` ${w}s `)));
}

/** Numbers in a sentence that could be a target (not `RPE 10`, `RIR 2`, `set 3`). */
function targetNumbers(sentence: string): number[] {
  const out: number[] = [];
  for (const m of sentence.toLowerCase().matchAll(/(\b[a-z#]+\s*)?(\d+(?:[.,]\d+)?)/g)) {
    if (/^(?:rpe|rir|set|#)$/.test((m[1] ?? '').trim())) continue;
    out.push(Number((m[2] ?? '').replace(',', '.')));
  }
  return out;
}

/** The numbers a saved row says: its load, reps, set count and % change. */
function rowNumbers(r: NextSessionTargetRecord): number[] {
  const pct = r.pctChange === null ? [] : [Math.abs(r.pctChange), Math.round(Math.abs(r.pctChange))];
  const reps = r.target.reps === null ? [] : [r.target.reps.min, r.target.reps.max];
  return [...(r.target.load === null ? [] : [r.target.load.value]), ...reps, ...(r.sets === null ? [] : [r.sets]), ...pct];
}

/**
 * The Summary's coach note, sentence by sentence (review S5, r2 N2): a
 * sentence with a number about an exercise whose `Next time` isn't the
 * coach's saved target (no row, or undone, or only suggested), or with a
 * number that row doesn't say, is dropped whole, so the note never shows a
 * number beside a row that says something else. Pure.
 */
export function summaryNoteSentences(sentences: readonly string[], exerciseNames: readonly string[], rows: readonly NextSessionTargetRecord[]): string[] {
  const live = new Map(rows.filter((r) => r.status === 'saved' || r.status === 'applied').map((r) => [r.exerciseName.toLowerCase(), r]));
  return sentences.filter((s) => {
    if (!/\d/.test(s)) return true;
    const named = exerciseNames.map((name) => name.toLowerCase()).filter((name) => mentions(s, name));
    if (named.length === 0) return true;
    const saved = named.map((name) => live.get(name));
    if (saved.some((r) => r === undefined)) return false;
    const said = new Set(saved.flatMap((r) => (r === undefined ? [] : rowNumbers(r))));
    return targetNumbers(s).every((n) => said.has(n));
  });
}
