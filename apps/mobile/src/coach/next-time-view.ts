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
import { pctText, type NextTimeRow } from '@fizz/domain';
import type { NextSessionTargetRecord } from '@fizz/schemas';

import type { CoachAvailability } from './coach-service';

export type NextTimeTap = 'undo' | 'use_coach' | 'apply' | 'not_now';

export interface NextTimeRowView {
  key: string;
  exerciseName: string;
  /** `Target 97.5 kg × 6–8` (+ ` · 4 sets`). */
  target: string;
  /** `−2.5%`, from the saved values. */
  pct: string | null;
  /** `Coach`, `Suggested`, `Built-in rule (…)`. */
  tag: string;
  /** Behind `Why?`. */
  why: string[];
  actions: { label: string; tap: NextTimeTap }[];
  /** `Used` once a workout started from this one. */
  note: string | null;
  /** The saved row, for taps. Null on a built-in row. */
  row: NextSessionTargetRecord | null;
}

export interface NextTimeView {
  heading: string;
  /** `Coach reviewing…` while the summary turn runs; null otherwise. */
  status: string | null;
  rows: NextTimeRowView[];
  emptyText: string | null;
  /** `Undo all` when two or more coach targets are saved and none used. */
  undoAll: { actionId: string } | null;
}

function setsPart(sets: number | null): string {
  return sets === null ? '' : ` · ${String(sets)} sets`;
}

function coachRow(r: NextSessionTargetRecord, builtIn: NextTimeRow | undefined): NextTimeRowView {
  const used = r.usedBySessionId !== null;
  const builtInLine = r.builtIn === null ? null : `Built-in rule would be ${targetPhrase(r.builtIn)}${setsPart(r.builtInSets)}`;
  const why = [...(r.reason === null ? [] : [`“${r.reason}”`]), ...r.guardNotes.map((n) => n.text), ...(builtInLine === null ? [] : [builtInLine])];
  const target = `Target ${targetPhrase(r.target)}${setsPart(r.sets)}`;
  const base = { key: r.id, exerciseName: r.exerciseName, pct: pctText(r.pctChange), row: r, note: used ? 'Used' : null };
  switch (r.status) {
    case 'saved':
    case 'applied':
      return { ...base, target, tag: 'Coach', why, actions: used ? [] : [{ label: 'Undo', tap: 'undo' }] };
    case 'undone':
      return {
        ...base,
        target: builtIn?.target ?? (r.builtIn === null ? 'Same targets' : `Target ${targetPhrase(r.builtIn)}`),
        pct: null,
        tag: 'Built-in rule',
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
        tag: 'Built-in rule',
        why: [`Suggested: ${targetPhrase(r.target)}${setsPart(r.sets)}`, ...why.filter((w) => w !== builtInLine)],
        actions: [],
      };
  }
}

export interface NextTimeInput {
  /** `Push A` or the workout's title. */
  title: string;
  /** `buildWorkoutSummary(…).nextTime`; null hides the section. */
  builtIn: { sourceTag: string; rows: NextTimeRow[]; emptyText: string | null } | null;
  coachRows: readonly NextSessionTargetRecord[];
  availability: CoachAvailability;
  reviewing: boolean;
}

export function nextTimeView(input: NextTimeInput): NextTimeView | null {
  if (input.builtIn === null) return null;
  const byExercise = new Map(input.coachRows.map((r) => [r.exerciseId, r]));
  const rows: NextTimeRowView[] = [];
  const seen = new Set<string>();
  for (const b of input.builtIn.rows) {
    const c = byExercise.get(b.exerciseId);
    seen.add(b.exerciseId);
    if (c !== undefined) rows.push(coachRow(c, b));
    else rows.push({ key: b.exerciseId, exerciseName: b.exerciseName, target: b.target, pct: null, tag: input.builtIn.sourceTag, why: [b.summary, ...b.facts], actions: [], note: null, row: null });
  }
  // Coach rows for exercises the built-in rule didn't list (it held them).
  for (const c of input.coachRows) if (!seen.has(c.exerciseId)) rows.push(coachRow(c, undefined));
  const live = input.coachRows.filter((r) => (r.status === 'saved' || r.status === 'applied') && r.usedBySessionId === null);
  const actionIds = [...new Set(live.map((r) => r.actionId))];
  const only = actionIds.length === 1 ? actionIds[0] : undefined;
  return {
    heading: `Next time · ${input.title}`,
    status: input.reviewing ? 'Coach reviewing…' : null,
    rows,
    emptyText: rows.length === 0 ? input.builtIn.emptyText : null,
    undoAll: live.length >= 2 && only !== undefined ? { actionId: only } : null,
  };
}

/** Words too common in exercise names to say which one a sentence is about. */
const GENERIC_NAME_WORDS = new Set(['press', 'raise', 'raises', 'curl', 'curls', 'extension', 'extensions', 'machine', 'cable', 'barbell', 'dumbbell', 'seated', 'standing', 'single', 'assisted', 'supported']);

function mentions(sentence: string, exerciseName: string): boolean {
  const said = ` ${sentence.toLowerCase().replace(/[^a-z0-9]+/g, ' ')} `;
  const name = exerciseName.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  if (said.includes(` ${name} `)) return true;
  return name.split(' ').some((w) => w.length >= 4 && !GENERIC_NAME_WORDS.has(w) && (said.includes(` ${w} `) || said.includes(` ${w}s `)));
}

/**
 * The Summary's coach note, sentence by sentence (review S5): a sentence
 * with a number about an exercise whose `Next time` isn't the coach's saved
 * target (no row, or undone, or only suggested) is dropped whole, so the
 * note never shows a number beside a row that says something else. Pure.
 */
export function summaryNoteSentences(sentences: readonly string[], exerciseNames: readonly string[], rows: readonly NextSessionTargetRecord[]): string[] {
  const live = new Set(rows.filter((r) => r.status === 'saved' || r.status === 'applied').map((r) => r.exerciseName.toLowerCase()));
  return sentences.filter((s) => {
    if (!/\d/.test(s)) return true;
    return exerciseNames.every((name) => !mentions(s, name) || live.has(name.toLowerCase()));
  });
}
