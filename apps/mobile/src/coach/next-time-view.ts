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
import { briefLine, EXERCISE_SHORT_FORMS, fromToLine, pctText, shortFormMeans, type ChangeSide, type LineText, type NextTimeRow } from '@fizz/domain';
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
  actions: { label: string; tap: NextTimeTap; accessibilityLabel?: string }[];
  /** `Used` once a workout started from this one. */
  note: string | null;
  /**
   * (Ben, 30 Oct; redesign §E2) The one line beside the name: `100 → 102.5 kg`, `3×10 → 3×12`, `3 → 4 sets`;
   * `Same · 100×6–8 kg` when nothing moves. Spoken for VoiceOver (`100 to 102.5 kilograms`).
   */
  line: LineText;
  /** Behind `Why?`, in order: the source and % (`Coach · +2.5%`), a note that has buttons beside it, the reasons. */
  info: string[];
  /** A one-word state where buttons would be (`Used`, `Changed since`); null with buttons or nothing to say. */
  trailing: string | null;
  /** The saved row, for taps. Null on a built-in row. */
  row: NextSessionTargetRecord | null;
  /**
   * (Ben, 23 Oct) The built-in rule's own stall reset on this row, for its taps (`tapRuleReset`): the reset, the hold
   * and Ben's answer so far (null: none yet). Absent: no reset here.
   */
  reset?: {
    exerciseId: string;
    exerciseName: string;
    target: CoachTarget;
    hold: CoachTarget | null;
    row: NextSessionTargetRecord | null;
    /** (Review ben-8-decisions S1) Ben's Apply no longer fits the workout (a set corrected since): asked again. */
    again?: true;
  };
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

/** Copy for the one-line rows (minimal-copy: values and actions only). */
export const NEXT_LINE_COPY = {
  same: 'Same',
  why: 'Why?',
  /** (Ben, 30 Oct) `Use coach target` as a compact trailing action; VoiceOver keeps the full name. */
  redo: 'Redo',
  useCoach: 'Use coach target',
} as const;

function sameOr(l: { text: string; spoken: string; same: boolean }): LineText {
  return l.same ? { text: `${NEXT_LINE_COPY.same} · ${l.text}`, spoken: `${NEXT_LINE_COPY.same}, ${l.spoken}` } : { text: l.text, spoken: l.spoken };
}

/** The built-in rule's own line for a row: from → to, or its words when it has no load target (`No load target · 8–10 reps`). */
function ruleLine(b: NextTimeRow, to: ChangeSide | null = b.to): LineText {
  if (to === null) return { text: b.target, spoken: b.target };
  return sameOr(fromToLine(b.from, to));
}

/** A coach row's line: the basis today (`from`) to the coach's target, with its set count when it set one. */
function coachLine(target: CoachTarget, sets: number | null, from: ChangeSide | undefined): LineText {
  return sameOr(fromToLine(from ?? null, { target, sets: sets ?? from?.sets ?? null, ...(from?.plates === true ? { plates: true as const } : {}) }));
}

/** `info` and `trailing` from a row's tag, %, note and reasons. */
function infoOf(v: Omit<NextTimeRowView, 'info' | 'trailing'>): Pick<NextTimeRowView, 'info' | 'trailing'> {
  const head = v.pct === null ? v.tag : `${v.tag} · ${v.pct}`;
  const trailing = v.actions.length === 0 ? v.note : null;
  return { info: [head, ...(v.note !== null && trailing === null ? [v.note] : []), ...v.why], trailing };
}

function withInfo(v: Omit<NextTimeRowView, 'info' | 'trailing'>): NextTimeRowView {
  return { ...v, ...infoOf(v) };
}

function coachRow(r: NextSessionTargetRecord, builtIn: NextTimeRow | undefined, stale: boolean, from: ChangeSide | undefined): NextTimeRowView {
  return withInfo(coachRowBase(r, builtIn, stale, from));
}

function coachRowBase(r: NextSessionTargetRecord, builtIn: NextTimeRow | undefined, stale: boolean, from: ChangeSide | undefined): Omit<NextTimeRowView, 'info' | 'trailing'> {
  const used = r.usedBySessionId !== null;
  const builtInLine = r.builtIn === null ? null : `Rule: ${targetPhrase(r.builtIn)}${setsPart(r.builtInSets)}`;
  const why = [...(r.reason === null ? [] : [`“${r.reason}”`]), ...r.guardNotes.map((n) => n.text), ...(builtInLine === null ? [] : [builtInLine])];
  const target = `Target ${targetPhrase(r.target)}${setsPart(r.sets)}`;
  const base = { key: r.id, exerciseName: r.exerciseName, pct: pctText(r.pctChange), row: r, note: used ? 'Used' : null };
  const ruleTarget = builtIn?.target ?? (r.builtIn === null ? 'Same targets' : `Target ${targetPhrase(r.builtIn)}`);
  // The rule's line where the rule decides: its row's, else the rule's target the coach row carries, else no change.
  const ruleLineHere: LineText = builtIn !== undefined ? ruleLine(builtIn) : r.builtIn !== null ? coachLine(r.builtIn, r.builtInSets, from) : from !== undefined ? sameOr(fromToLine(from, from)) : { text: ruleTarget, spoken: ruleTarget };
  const coachLineHere = coachLine(r.target, r.sets, from);
  // The workout's sets changed since the review (a correction): the next workout won't use it, so neither does this row.
  if (stale && !used) return { ...base, target: ruleTarget, line: ruleLineHere, pct: null, tag: 'Rule', why: [`Coach target: ${targetPhrase(r.target)}${setsPart(r.sets)}`, ...why.filter((w) => w !== builtInLine)], actions: [] };
  switch (r.status) {
    case 'saved':
    case 'applied':
      return { ...base, target, line: coachLineHere, tag: 'Coach', why, actions: used ? [] : [{ label: 'Undo', tap: 'undo' }] };
    case 'undone':
      return {
        ...base,
        target: builtIn?.target ?? (r.builtIn === null ? 'Same targets' : `Target ${targetPhrase(r.builtIn)}`),
        line: ruleLineHere,
        pct: null,
        tag: 'Rule',
        why: [`Coach target: ${targetPhrase(r.target)}${setsPart(r.sets)}`, ...why.filter((w) => w !== builtInLine)],
        actions: used ? [] : [{ label: NEXT_LINE_COPY.redo, tap: 'use_coach', accessibilityLabel: NEXT_LINE_COPY.useCoach }],
      };
    case 'proposed':
      // (Ben, 23 Oct; D2) An offer reads `Skip` / `Apply` (was `Not now`).
      return { ...base, target, line: coachLineHere, tag: 'Suggested', why, actions: used ? [] : [{ label: 'Skip', tap: 'not_now' }, { label: 'Apply', tap: 'apply' }] };
    case 'not_applied':
      return {
        ...base,
        target: builtIn?.target ?? (r.builtIn === null ? 'Same targets' : `Target ${targetPhrase(r.builtIn)}`),
        line: ruleLineHere,
        pct: null,
        tag: 'Rule',
        why: [`Suggested: ${targetPhrase(r.target)}${setsPart(r.sets)}`, ...why.filter((w) => w !== builtInLine)],
        actions: [],
      };
  }
}

export const NEXT_TIME_COPY = {
  /** (Review ben-8-decisions S1) An applied reset the workout no longer fits. */
  changedSince: 'Changed since',
} as const;

/**
 * (Ben, 23 Oct; review v5offers SP2) A built-in rule row. A stall reset is an offer: `Reset to 90 kg × 6–8?` with
 * `Skip` / `Apply` (offered, or offered again after an Undo); once applied the row is the reset with `Undo`; skipped,
 * the hold with no buttons. A workout started from this one since: no buttons (`Used`).
 */
function ruleRow(b: NextTimeRow, sourceTag: string, answer: NextSessionTargetRecord | null): NextTimeRowView {
  return withInfo(ruleRowBase(b, sourceTag, answer));
}

function ruleRowBase(b: NextTimeRow, sourceTag: string, answer: NextSessionTargetRecord | null): Omit<NextTimeRowView, 'info' | 'trailing'> {
  const base: Omit<NextTimeRowView, 'info' | 'trailing'> = { key: b.exerciseId, exerciseName: b.exerciseName, target: b.target, line: ruleLine(b), pct: null, tag: sourceTag, why: [briefLine(b.summary)], actions: [], note: null, row: null };
  const used = answer?.usedBySessionId != null;
  if (b.resetApplied === true && answer !== null && answer.status === 'applied') {
    return { ...base, note: used ? 'Used' : null, actions: used ? [] : [{ label: 'Undo', tap: 'undo' }], reset: { exerciseId: b.exerciseId, exerciseName: b.exerciseName, target: answer.target, hold: answer.builtIn, row: answer } };
  }
  const offer = b.resetOffer;
  // (Review ben-8-decisions S1) His Apply no longer fits the workout as it is (a set corrected since): it isn't used,
  // and says so; while the rule still offers a reset, it asks again (a new answer at the row's version).
  const changedSince = answer !== null && answer.status === 'applied' && !used && b.resetApplied !== true;
  if (offer === undefined) return changedSince ? { ...base, note: NEXT_TIME_COPY.changedSince } : base;
  const reset = { exerciseId: b.exerciseId, exerciseName: b.exerciseName, target: { load: offer.load, reps: offer.reps }, hold: { load: offer.hold.load, reps: offer.hold.reps }, row: answer, ...(changedSince ? { again: true as const } : {}) };
  // (Ben, 30 Oct) An open offer's line is the reset itself (`100 → 90 kg`) with Skip / Apply beside it.
  const offerLine = b.to === null ? base.line : ruleLine(b, { ...b.to, target: { load: offer.load, reps: offer.reps } });
  if (changedSince) return { ...base, line: offerLine, note: `${NEXT_TIME_COPY.changedSince} · ${offer.text}`, actions: [{ label: 'Skip', tap: 'not_now' }, { label: 'Apply', tap: 'apply' }], reset };
  const open = !used && (answer === null || answer.status === 'proposed');
  return open ? { ...base, line: offerLine, note: offer.text, actions: [{ label: 'Skip', tap: 'not_now' }, { label: 'Apply', tap: 'apply' }], reset } : { ...base, note: used ? 'Used' : null, reset };
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
  /** (Ben, 30 Oct) `WorkoutSummary.nextFrom`: what each coach change is measured from, for its one line. */
  from?: Readonly<Record<string, ChangeSide>>;
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
    if (c !== undefined) rows.push(coachRow(c, b, stale.has(c.id), input.from?.[c.exerciseId]));
    // One short line (Ben, 18 Oct): the rule's facts stay stored and in the coach's context, not on screen (review B3).
    else rows.push(ruleRow(b, input.builtIn.sourceTag, input.ruleRows?.find((r) => r.exerciseId === b.exerciseId) ?? null));
  }
  // Coach rows for exercises the built-in rule didn't list (it held them).
  for (const c of input.coachRows) if (!seen.has(c.exerciseId)) rows.push(coachRow(c, undefined, stale.has(c.id), input.from?.[c.exerciseId]));
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
