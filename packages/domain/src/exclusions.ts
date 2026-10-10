import type { SetExclusion } from '@fizz/schemas';

/**
 * Sets that don't count (active-workout.md §2.13; competitor follow-up 9).
 * Ben marks a logged set `Spotted`, `Pain`, `Form broke` or `Other
 * equipment`. The set stays in the log and in volume (AW8), but it is left
 * out of records, estimated 1RM, progression, comparisons and coach offers.
 * Every one of those reads `isSetCountable`, so the rule lives in one place.
 *
 * Pure and deterministic. A flag is only ever set by Ben (AW5), is a
 * versioned, audited correction (AW6), and every sentence about it is built
 * here so the set card, Overview, the rest card, `Why?`, the summary and
 * Progress use the same words (rule 6: never hidden).
 */

/** What a set is being counted for. Only `volume` (working sets, volume, sets per muscle) still counts a flagged set. */
export type CountPurpose = 'record' | 'e1rm' | 'progression' | 'comparison' | 'trigger' | 'volume';

/** Canonical order: the chip order in the correction sheet. */
export const EXCLUSION_ORDER: readonly SetExclusion[] = ['spotted', 'pain', 'technique', 'other_equipment'];

/** Chip and tag words (`Tag`, no colour). */
export const EXCLUSION_LABEL: Readonly<Record<SetExclusion, string>> = {
  spotted: 'Spotted',
  pain: 'Pain',
  technique: 'Form broke',
  other_equipment: 'Other equipment',
};

/** The same words inside a sentence (`100 kg × 8 · spotted`). */
export const EXCLUSION_WORD: Readonly<Record<SetExclusion, string>> = {
  spotted: 'spotted',
  pain: 'pain',
  technique: 'form broke',
  other_equipment: 'other equipment',
};

export const EXCLUSION_HEADING = 'Leave out of records and progress';
export const EXCLUSION_NOTE = 'Still counts in your log and volume.';

/** Anything that may carry exclusions (a `WorkoutSet`, a `HistorySet`, a basis set). */
export interface MaybeExcluded {
  exclusions?: readonly SetExclusion[] | undefined;
}

/** Unique reasons in the canonical order. Unknown values are dropped. */
export function normaliseExclusions(xs: readonly SetExclusion[] | undefined): SetExclusion[] {
  if (!xs || xs.length === 0) return [];
  const wanted = new Set(xs);
  return EXCLUSION_ORDER.filter((x) => wanted.has(x));
}

export function isExcluded(set: MaybeExcluded): boolean {
  return (set.exclusions?.length ?? 0) > 0;
}

/**
 * `isSetCountable(set, purpose)` (active-workout §6): false for a flagged set
 * on every purpose except `volume` (AW8). A set with no flags always counts.
 */
export function isSetCountable(set: MaybeExcluded, purpose: CountPurpose): boolean {
  if (purpose === 'volume') return true;
  return !isExcluded(set);
}

/** `Spotted` / `Spotted, form broke` (the done-row `Tag`); null when the set counts. */
export function exclusionTag(xs: readonly SetExclusion[] | undefined): string | null {
  const n = normaliseExclusions(xs);
  if (n.length === 0) return null;
  const [first, ...rest] = n;
  return [EXCLUSION_LABEL[first as SetExclusion], ...rest.map((x) => EXCLUSION_WORD[x])].join(', ');
}

/** `spotted` / `spotted, form broke` (after a `·` in a line of results); null when the set counts. */
export function exclusionWords(xs: readonly SetExclusion[] | undefined): string | null {
  const n = normaliseExclusions(xs);
  return n.length === 0 ? null : n.map((x) => EXCLUSION_WORD[x]).join(', ');
}

/** Overview's second line under a flagged done row: `Spotted · not counted`. */
export function notCountedLine(xs: readonly SetExclusion[] | undefined): string | null {
  const tag = exclusionTag(xs);
  return tag === null ? null : `${tag} · not counted`;
}

/** Appended to the row's VoiceOver label: `Spotted: not counted for records or progress.` */
export function exclusionAccessibility(xs: readonly SetExclusion[] | undefined): string | null {
  const tag = exclusionTag(xs);
  return tag === null ? null : `${tag}: not counted for records or progress.`;
}

/** Appends ` · spotted` to a results line (`Last (1 Oct): 100 kg × 8 · spotted`, the just-saved line). */
export function withExclusionWords(text: string, xs: readonly SetExclusion[] | undefined): string {
  const words = exclusionWords(xs);
  return words === null ? text : `${text} · ${words}`;
}

export interface ExclusionChange {
  added: SetExclusion[];
  removed: SetExclusion[];
}

export function exclusionChange(before: readonly SetExclusion[] | undefined, after: readonly SetExclusion[] | undefined): ExclusionChange {
  const b = new Set(normaliseExclusions(before));
  const a = new Set(normaliseExclusions(after));
  return {
    added: EXCLUSION_ORDER.filter((x) => a.has(x) && !b.has(x)),
    removed: EXCLUSION_ORDER.filter((x) => b.has(x) && !a.has(x)),
  };
}

const wordList = (xs: readonly SetExclusion[]) => xs.map((x) => EXCLUSION_WORD[x]).join(', ');

/**
 * `Edit history` lines for an exclusion change (AW6): `Set 2 marked:
 * spotted`, `Set 2 unmarked: spotted`. Empty when nothing changed.
 */
export function exclusionAuditLines(setNumber: number, before: readonly SetExclusion[] | undefined, after: readonly SetExclusion[] | undefined): string[] {
  const { added, removed } = exclusionChange(before, after);
  const lines: string[] = [];
  if (added.length > 0) lines.push(`Set ${String(setNumber)} marked: ${wordList(added)}`);
  if (removed.length > 0) lines.push(`Set ${String(setNumber)} unmarked: ${wordList(removed)}`);
  return lines;
}

/**
 * The toast after saving an exclusion change (§2.13, §3): `Set 2: spotted ·
 * not counted for records` [Undo]; `Set 2 counts for records again` when
 * every reason was removed. Null when nothing changed.
 */
export function exclusionToast(setNumber: number, before: readonly SetExclusion[] | undefined, after: readonly SetExclusion[] | undefined): string | null {
  const { added, removed } = exclusionChange(before, after);
  if (added.length === 0 && removed.length === 0) return null;
  const now = normaliseExclusions(after);
  if (now.length === 0) return `Set ${String(setNumber)} counts for records again`;
  return `Set ${String(setNumber)}: ${wordList(now)} · not counted for records`;
}

/** Under the chips when `Pain` is selected (AW7). The screen draws the warning icon. */
export function exclusionPainLine(exerciseName: string): string {
  return `This also puts a pain flag on ${exerciseName}: no increases until you clear it.`;
}

/** The built-in rule's hold when every counted set of the latest session was left out: `No counted sets on 8 Oct (all left out); holding.` */
export function allLeftOutFact(day: string): string {
  return `No counted sets on ${day} (all left out); holding.`;
}

/** Summary `Compared with last time` when today's (or last time's) only top-set candidates were left out. */
export function notComparedText(xs: readonly SetExclusion[] | undefined): string {
  return `Not compared: the only top set was ${exclusionWords(xs) ?? 'left out'}.`;
}

/** `Why?` `Not used` line for a basis set Ben marked: `Set 3 on 1 Oct: spotted.` */
export function notUsedLine(setNumber: number, day: string, xs: readonly SetExclusion[] | undefined): string {
  return `Set ${String(setNumber)} on ${day}: ${exclusionWords(xs) ?? 'left out'}.`;
}
