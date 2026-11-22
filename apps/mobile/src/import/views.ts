import {
  isPlatesAddedKind,
  EQUIPMENT_WORD,
  localDateOf,
  localHourUtcMs,
  toMs,
  fitNotesApp,
  FITNOTES_HEADERS,
  formatNumber,
  loadText,
  NBSP,
  variantHasComments,
  type FitNotesRow,
  type ImportAnalysis,
  type LoadContext,
  type MachineExercise,
  type MatchCandidate,
  type NameRow,
  type PerHandExercise,
  type PerHandQuestion,
  type RememberedTotal,
  type RowFate,
  type TotalExercise,
  type TotalQuestion,
} from '@fizz/domain';
import {
  BAR_WEIGHT_MAX,
  type CustomExerciseKind,
  type FitNotesVariant,
  type GroupTotalAnswer,
  type ImportBarKind,
  type ImportJob,
  type ImportRow,
  type ImportRowResult,
  type Load,
  type LoadConvention,
  type PerHandReading,
  type TotalAnswer,
  type WeightUnit,
} from '@fizz/schemas';

import { formatCount, plural } from '../format/numbers';
import { parseNumber } from '../ui/number-text';
import type { ImportBlock, ImportDraft, ImportedSetProvenance, OpenResult, PastImport } from './import-service';

/**
 * Display text for the FitNotes import screens (data-import-export §2.5,
 * §3.4, §5). Pure: screens render these and never compute import rules.
 * Every status has an icon and words (never colour alone). Imported names
 * and comments are shown as plain text (rule 8).
 */

export type Tone = 'done' | 'info' | 'warning';
export type IconName = 'checkmark.circle.fill' | 'exclamationmark.triangle' | 'info.circle' | 'questionmark.circle' | 'xmark.circle' | 'slash.circle';

export interface Line {
  icon: IconName;
  tone: Tone;
  text: string;
  detail?: string;
}

// ---------------------------------------------------------------------------
// Dates written as YYYY-MM-DD (FitNotes has no time and no zone; never shifted).

function utcNoon(date: string): number {
  return localHourUtcMs(date, 12, 'UTC');
}

function dateParts(date: string, locale: string | undefined, options: Intl.DateTimeFormatOptions): Record<string, string> {
  const out: Record<string, string> = {};
  for (const p of new Intl.DateTimeFormat(locale, { ...options, timeZone: 'UTC' }).formatToParts(utcNoon(date))) out[p.type] = p.value;
  return out;
}

/** `Wed 1 Oct 2026` */
export function longDate(date: string, locale?: string): string {
  const p = dateParts(date, locale, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
  return `${p.weekday ?? ''} ${p.day ?? ''} ${p.month ?? ''} ${p.year ?? ''}`.trim();
}

/** `2 Mar 2019` */
export function dayMonthYear(date: string, locale?: string): string {
  const p = dateParts(date, locale, { day: 'numeric', month: 'short', year: 'numeric' });
  return `${p.day ?? ''} ${p.month ?? ''} ${p.year ?? ''}`.trim();
}

/** `Thu 8 Oct` for an instant in its zone. */
export function shortDateOf(utc: string, tz: string, locale?: string): string {
  const out: Record<string, string> = {};
  for (const p of new Intl.DateTimeFormat(locale, { weekday: 'short', day: 'numeric', month: 'short', timeZone: tz }).formatToParts(toMs(utc))) out[p.type] = p.value;
  return `${out.weekday ?? ''} ${out.day ?? ''} ${out.month ?? ''}`.trim();
}

// ---------------------------------------------------------------------------
// Intro and file errors

export interface IntroView {
  blockLine: string | null;
  paused: { text: string; jobId: string; version: number } | null;
  primary: { label: 'Choose CSV file' | 'Continue import'; enabled: boolean };
}

export const INTRO_COPY = {
  line: 'Export a CSV from FitNotes to Files, then choose it.',
  /** Behind the line's `ⓘ`. */
  info: 'FitNotes or FitNotes 2',
} as const;

export function blockLine(b: ImportBlock, time: string): string {
  return `Finish or discard your workout first (${b.title}, started ${time}).`;
}

/** Where an unfinished import stopped, with no call to action. */
function stoppedAt(p: Pick<PastImport, 'written' | 'total'>): string {
  // Every workout is in but the last step didn't finish (closed or failed right at the end; review B1).
  if (p.written >= p.total) return `Import not finished. All ${plural(p.total, 'workout is', 'workouts are')} in your history.`;
  return `Import paused at ${formatCount(p.written)} of ${plural(p.total, 'workout', 'workouts')}. The ${formatCount(p.written)} ${p.written === 1 ? 'is' : 'are'} in your history.`;
}

export function pausedLine(p: Pick<PastImport, 'written' | 'total'>): string {
  return stoppedAt(p);
}

/**
 * A workout's write didn't report success (§3.4; review r2 N4). Its
 * transaction may still have committed, so this never says it failed:
 * each workout saves whole or not at all, and `Try again` checks.
 */
export function writeFailedLine(r: { written: number; date: string; message: string }, locale?: string): string {
  return `Workout ${formatCount(r.written + 1)} (${longDate(r.date, locale)}) may not have saved: ${r.message}. ${plural(r.written, 'workout is', 'workouts are')} in before it.`;
}

/**
 * A layout commit refused because the layout moved on (rule 5). A saved
 * layout that changed or was deleted means choosing the file again; a
 * layout changed on Check the layout since the preview goes back there,
 * with Ben's answers kept and nothing sent again (review r2 S3).
 */
export function layoutRefusedView(r: { reason: 'layout_changed' } | { reason: 'layout_session_changed'; layoutId: string }): { text: string; back: { label: string; layoutId: string } | null } {
  if (r.reason === 'layout_session_changed') return { text: 'The layout changed. Check it again.', back: { label: 'Check the layout', layoutId: r.layoutId } };
  return { text: 'The saved layout changed. Choose the file again.', back: null };
}

export function introView(input: { block: ImportBlock | null; blockTime: string; paused: PastImport | null }): IntroView {
  const paused = input.paused && input.paused.state === 'paused' ? { text: pausedLine(input.paused), jobId: input.paused.job.id, version: input.paused.job.version } : null;
  return {
    blockLine: input.block ? blockLine(input.block, input.blockTime) : null,
    paused,
    primary: { label: paused ? 'Continue import' : 'Choose CSV file', enabled: input.block === null },
  };
}

export type OpenErrorView = { text: string; firstLine: string | null; sameFileJobId: string | null };

/** Why a chosen file can't be previewed (§3.4). Null for a preview. */
export function openErrorView(r: OpenResult, locale?: string): OpenErrorView | null {
  switch (r.kind) {
    case 'preview':
      return null;
    case 'empty':
      return { text: 'This file is empty.', firstLine: null, sameFileJobId: null };
    case 'not_csv':
      return { text: 'This isn’t a CSV file.', firstLine: null, sameFileJobId: null };
    case 'fitnotes_backup':
      return { text: 'This is a FitNotes backup, not a CSV. In FitNotes, export a CSV and choose that.', firstLine: null, sameFileJobId: null };
    case 'body_tracker':
      return { text: 'This looks like a FitNotes Body Tracker export. Choose the Workout Data export.', firstLine: r.firstLine, sameFileJobId: null };
    case 'unknown_header':
      return { text: 'GymSmarter doesn’t recognise this file’s columns yet.', firstLine: r.firstLine, sameFileJobId: null };
    case 'same_file':
      // Its import isn't finished: say where it stopped and point to Continue once (review N1, r2 N1).
      if (r.state === 'paused') {
        return {
          text: `You started importing this file on ${shortDateOf(r.job.startedAt.utc, r.job.startedAt.tz, locale)}. ${stoppedAt({ written: r.written, total: r.job.counts.workouts })} Continue that import instead.`,
          firstLine: null,
          sameFileJobId: r.job.id,
        };
      }
      if (r.state === 'running') {
        return {
          text: `You started importing this file on ${shortDateOf(r.job.startedAt.utc, r.job.startedAt.tz, locale)}. It’s importing now: ${formatCount(r.written)} of ${plural(r.job.counts.workouts, 'workout', 'workouts')} in.`,
          firstLine: null,
          sameFileJobId: r.job.id,
        };
      }
      return {
        text: `You imported this file on ${shortDateOf(r.job.startedAt.utc, r.job.startedAt.tz, locale)} (${plural(r.job.counts.workouts, 'workout', 'workouts')}). Nothing new to import.${
          r.inRecentlyDeleted > 0 ? ` ${inRecentlyDeletedLine(r.inRecentlyDeleted)}` : ''
        }`,
        firstLine: null,
        sameFileJobId: r.job.id,
      };
    case 'no_profile':
      return { text: 'Finish setting up GymSmarter first.', firstLine: null, sameFileJobId: null };
  }
}

// ---------------------------------------------------------------------------
// Preview (§2.5 step 3)

export function appLabel(variant: FitNotesVariant): string {
  return fitNotesApp(variant) === 'fitnotes2' ? 'FitNotes 2 (iPhone) CSV' : 'FitNotes (Android) CSV';
}

/** An import's source tag (§9.2.10): `FitNotes …`, `Coach layout` or `Layout: <name>`. */
export function sourceLabel(job: Pick<ImportJob, 'variant' | 'layout'>): string {
  if (job.variant !== null) return appLabel(job.variant);
  return job.layout?.kind === 'saved' && job.layout.profileName !== null ? `Layout: ${job.layout.profileName}` : 'Coach layout';
}

export function unitsLabel(units: { kg: number; lb: number }): string {
  if (units.kg > 0 && units.lb > 0) return 'weights in kg and lb (per set)';
  if (units.kg > 0) return 'weights in kg';
  if (units.lb > 0) return 'weights in lb';
  return 'no weights';
}

export type QuestionKey = { kind: 'names' } | { kind: 'per_hand' } | { kind: 'total' } | { kind: 'bodyweight'; key: string } | { kind: 'unit' } | { kind: 'value_checks' };

export interface QuestionRow {
  key: QuestionKey;
  answered: boolean;
  line: Line;
}

export type SkipKey = 'cardio' | 'unsupported' | 'unreadable' | 'date_exists' | 'duplicate' | 'exercise' | 'not_a_set' | 'value_to_check';

export interface PreviewView {
  fileName: string;
  /** This file was imported before, but some of its dates aren't in the app now (review r3 S2). */
  notice: Line | null;
  detection: string;
  /** Layout imports (§9.2.6): the unit and where it came from (`kg · from the column name`). */
  unitLine: string | null;
  /** Layout imports (§9.2.6): `Save layout`, its name, and the `Why?` text. Null for FitNotes and saved layouts. */
  saveLayout: { on: boolean; name: string; why: string } | null;
  rowsLine: string;
  willImport: { line1: string; line2: string };
  questionsTitle: string;
  questions: QuestionRow[];
  skipped: { key: SkipKey; line: Line }[];
  kept: Line[];
  effortReview: string | null;
  datesRow: string | null;
  /** `3 are in Recently deleted.` → Recently deleted (DW26); null when none. */
  recentlyDeletedRow: string | null;
  gymRow: string;
  workoutsTitle: string;
  primary: { label: string; enabled: boolean };
}

/** How a dumbbell value is read, in the preview's answer line. */
const READING_WORD: Record<PerHandReading, string> = { each: 'each', both: 'both together', one: 'one dumbbell' };
const BODYWEIGHT_WORD = { added: 'weight added to bodyweight', assistance: 'assistance from a machine', split: 'negative = assistance, positive = added' } as const;
/** `Bar weight` / `EZ-bar weight` / `Trap-bar weight` (each bar has its own weight; review S1). */
export const BAR_WORD: Record<ImportBarKind, string> = { barbell: 'Bar', ez_bar: 'EZ-bar', trap_bar: 'Trap-bar' };
const BAR_NAME: Record<ImportBarKind, string> = { barbell: 'bar', ez_bar: 'EZ bar', trap_bar: 'trap bar' };
/** The bar choices on a plates-only row (PM decision after review r7). */
const BAR_LABEL: Record<ImportBarKind, string> = { barbell: 'Olympic bar', ez_bar: 'EZ bar', trap_bar: 'Trap bar' };
const BAR_KINDS: readonly ImportBarKind[] = ['barbell', 'ez_bar', 'trap_bar'];

const TOTAL_WORD: Record<TotalAnswer, string> = { total: 'total as written', plates_only: 'plates only + bar' };

export function questionRows(a: ImportAnalysis): QuestionRow[] {
  const out: QuestionRow[] = [];
  const open = a.names.filter((n) => n.needsAnswer && n.sets > 0).length;
  const answeredNames = a.names.filter((n) => n.answer !== null && n.sets > 0).length;
  if (open > 0) out.push({ key: { kind: 'names' }, answered: false, line: { icon: 'exclamationmark.triangle', tone: 'warning', text: `${plural(open, 'exercise name', 'exercise names')} to check` } });
  else if (answeredNames > 0) out.push({ key: { kind: 'names' }, answered: true, line: { icon: 'checkmark.circle.fill', tone: 'done', text: `Exercise names: ${formatCount(answeredNames)} checked` } });
  if (a.perHand) {
    const q = a.perHand;
    const warn = (text: string): QuestionRow => ({ key: { kind: 'per_hand' }, answered: false, line: { icon: 'exclamationmark.triangle', tone: 'warning', text } });
    out.push(
      q.needsGroup
        ? warn('Dumbbell weights: each or both?')
        : q.needsCount > 0
          ? warn(`${plural(q.needsCount, 'dumbbell exercise', 'dumbbell exercises')}: one dumbbell or two?`)
          : { key: { kind: 'per_hand' }, answered: true, line: { icon: 'checkmark.circle.fill', tone: 'done', text: `${perHandLabel(q)}: ${perHandSummary(q)}` } },
    );
  }
  if (a.total) {
    const q = a.total;
    const warn = (text: string): QuestionRow => ({ key: { kind: 'total' }, answered: false, line: { icon: 'exclamationmark.triangle', tone: 'warning', text } });
    const missingBar = q.bars.find((b) => b.missing.length > 0);
    out.push(
      q.needsGroup
        ? warn('Barbell weights: total as written, or plates only?')
        : q.needsBar > 0
          ? warn(`${plural(q.needsBar, 'plates-only exercise', 'plates-only exercises')}: which bar?`)
          : missingBar
            ? warn(`${BAR_WORD[missingBar.bar]} weight needed for “plates only”`)
            : { key: { kind: 'total' }, answered: true, line: { icon: 'checkmark.circle.fill', tone: 'done', text: `Barbell: ${totalSummary(q)}` } },
    );
  }
  for (const q of a.bodyweight) {
    out.push(
      q.answer === null
        ? { key: { kind: 'bodyweight', key: q.key }, answered: false, line: { icon: 'exclamationmark.triangle', tone: 'warning', text: `${q.name} weights: added or assist?` } }
        : {
            key: { kind: 'bodyweight', key: q.key },
            answered: true,
            line: { icon: 'checkmark.circle.fill', tone: 'done', text: `${q.name}: ${q.answer === 'added' && q.loadAs === 'stack' ? 'weight on the stack' : q.answer === 'added' && q.loadAs === 'added' ? 'plates added' : BODYWEIGHT_WORD[q.answer]}` },
          },
    );
  }
  if (a.valueChecks.length > 0) {
    const open = a.valueChecks.filter((v) => v.answer === null).length;
    out.push(
      open > 0
        ? { key: { kind: 'value_checks' }, answered: false, line: { icon: 'exclamationmark.triangle', tone: 'warning', text: `${plural(open, 'value', 'values')} to check` } }
        : { key: { kind: 'value_checks' }, answered: true, line: { icon: 'checkmark.circle.fill', tone: 'done', text: `Values to check: ${formatCount(a.valueChecks.length)} answered` } },
    );
  }
  if (a.unit) {
    out.push(
      a.unit.answer === null
        ? { key: { kind: 'unit' }, answered: false, line: { icon: 'exclamationmark.triangle', tone: 'warning', text: 'Weight unit: kg or lb?' } }
        : { key: { kind: 'unit' }, answered: true, line: { icon: 'checkmark.circle.fill', tone: 'done', text: `Weight unit: ${a.unit.answer}` } },
    );
  }
  return out;
}

/** `each`, or by reading when they differ: `2 both together · 1 one dumbbell` (review r3 S1). */
/** `Dumbbells`, `Kettlebells` (only kettlebell exercises), or both (review ben-kit S3). */
function perHandLabel(q: PerHandQuestion): string {
  const bells = q.exercises.filter((e) => e.implement === 'kettlebell').length;
  if (bells === 0) return 'Dumbbells';
  return bells === q.exercises.length ? 'Kettlebells' : 'Dumbbells and kettlebells';
}

/** `each`, `one dumbbell`, `one kettlebell`, or by reading when they differ. */
function perHandSummary(q: PerHandQuestion): string {
  const wordOf = (e: PerHandQuestion['exercises'][number]): string | null => (e.reading === null ? null : e.reading === 'one' ? `one ${e.implement}` : READING_WORD[e.reading]);
  const counts = new Map<string, number>();
  for (const e of q.exercises) {
    const w = wordOf(e);
    if (w !== null) counts.set(w, (counts.get(w) ?? 0) + 1);
  }
  const order = [READING_WORD.each, READING_WORD.both, 'one dumbbell', 'one kettlebell'];
  const rows = order.flatMap((w) => (counts.has(w) ? [{ w, n: counts.get(w) ?? 0 }] : []));
  const only = rows.length === 1 ? rows[0] : undefined;
  if (only) return only.w;
  return rows.map((c) => `${formatCount(c.n)} ${c.w}`).join(' · ');
}

/** `total as written`, or by reading when they differ: `2 total as written · 1 plates only + bar`. */
function totalSummary(q: TotalQuestion): string {
  const counts = (['total', 'plates_only'] as const).map((r) => ({ r, n: q.exercises.filter((e) => e.reading === r).length })).filter((c) => c.n > 0);
  const only = counts.length === 1 ? counts[0] : undefined;
  if (only) return TOTAL_WORD[only.r];
  return counts.map((c) => `${formatCount(c.n)} ${TOTAL_WORD[c.r]}`).join(' · ');
}

function skippedExerciseSets(a: ImportAnalysis): number {
  return a.counts.byResult.skipped_exercise;
}

/** `Assisted Dip (−30 kg → 30 kg assistance)`; `; positive values can’t be read` when its values are both negative and positive (review r6 S3, N2). */
export function assistedText(m: MachineExercise): string {
  const parts: string[] = [];
  if (m.sample) parts.push(`${signedWeightText(m.sample.value, m.sample.unit)} → ${weightText(m.sample.imported, m.sample.unit)} assistance`);
  if (m.mixed) parts.push('positive values can’t be read');
  return parts.length === 0 ? m.name : `${m.name} (${parts.join('; ')})`;
}

/** `3 are in Recently deleted.` (delete-workouts §6.2, §7, DW26). */
export function inRecentlyDeletedLine(n: number): string {
  return `${formatCount(n)} ${n === 1 ? 'is' : 'are'} in Recently deleted.`;
}

/** Where a layout import's unit came from (§9.5 `kg · from the column name` / `kg · your answer`). */
const UNIT_SOURCE_WORD = { header: 'from the column name', unit_column: 'from the unit column', answer: 'your answer' } as const;

export function previewView(d: ImportDraft, locale?: string): PreviewView {
  const a = d.analysis;
  const r = a.counts.byResult;
  const range = a.dateRange ? ` · ${dayMonthYear(a.dateRange.first, locale)} – ${dayMonthYear(a.dateRange.last, locale)}` : '';
  const questions = questionRows(a);
  const open = a.questionsOpen;

  const skipped: PreviewView['skipped'] = [];
  const info = (text: string, detail?: string): Line => ({ icon: 'info.circle', tone: 'info', text, ...(detail === undefined ? {} : { detail }) });
  if (r.skipped_cardio > 0) skipped.push({ key: 'cardio', line: info(`${plural(r.skipped_cardio, 'cardio row', 'cardio rows')} (not imported yet)`) });
  if (r.skipped_unsupported > 0) skipped.push({ key: 'unsupported', line: info(`${plural(r.skipped_unsupported, 'timed, distance or weight-only set', 'timed, distance or weight-only sets')} (not imported yet)`) });
  if (r.unreadable > 0) {
    skipped.push({
      key: 'unreadable',
      line: info(`${plural(r.unreadable, 'row', 'rows')} can’t be read`, a.decimalCommaRows > 0 ? 'This file may use decimal commas (22,5).' : undefined),
    });
  }
  if (d.answers.existingDates === 'skip' && a.appDates.count > 0) {
    skipped.push({ key: 'date_exists', line: info(`${plural(a.appDates.count, 'date already has', 'dates already have')} a GymSmarter workout`, `Newest: ${longDate(a.appDates.newest ?? '', locale)}`) });
  }
  for (const e of a.alreadyImported.imports) {
    skipped.push({ key: 'duplicate', line: info(`${plural(e.dates, 'workout', 'workouts')} came in with your import on ${shortDateOf(e.startedAtUtc, e.tz, locale)}. They’ll be skipped.`) });
  }
  if (skippedExerciseSets(a) > 0) skipped.push({ key: 'exercise', line: info(`${plural(skippedExerciseSets(a), 'set', 'sets')} of exercises you chose to skip`) });
  if (r.skipped_not_a_set > 0) {
    // FitNotes 2's `NotStarted` sets: planned, never done.
    skipped.push({ key: 'not_a_set', line: info(d.variant === 'D' ? `${plural(r.skipped_not_a_set, 'set', 'sets')} not done` : `${plural(r.skipped_not_a_set, 'row', 'rows')} not a set`) });
  }
  if (r.skipped_value_to_check > 0) skipped.push({ key: 'value_to_check', line: info(`${plural(r.skipped_value_to_check, 'set', 'sets')} skipped as values to check`) });

  const kept: Line[] = [];
  if (a.comments > 0) kept.push(info(`${plural(a.comments, 'comment', 'comments')}, kept with each set as written`));
  else if (d.variant !== null && !variantHasComments(d.variant)) kept.push(info('No comments in this file (FitNotes export without comments)'));
  // AI6: times with no zone are kept as written; a file with none is date only.
  // FitNotes 2's workout export says when each workout started and ended (UTC): real times and duration.
  kept.push(info(d.variant === 'D' ? 'Start and end times' : a.workouts.some((w) => w.startLocal !== undefined && w.startLocal !== null) ? 'Times as in the file (no time zone)' : 'Date only (no times)'));
  if (a.machines.length > 0) {
    // Assistance reads the number the other way round (more is easier): name those exercises (review r5 S3), each with what it imports as (review r6 N2).
    const assisted = a.machines.filter((m) => m.convention === 'assistance').map(assistedText);
    kept.push(info('Machines: by exercise', assisted.length === 0 ? undefined : `Read as assistance (more weight is easier): ${assisted.join(', ')}`));
  }
  if (a.barless.length > 0) kept.push(info(`Kettlebell and other no-bar weights imported as written (${a.barless.map((b) => b.name).join(', ')})`));
  if (d.variant !== null) kept.push(info(d.variant === 'D' ? 'Warm-ups as in the file' : 'All sets as working sets'));

  const effortReview =
    a.effort.candidates.length === 0
      ? null
      : a.effort.mode === 'notes_only'
        ? `${plural(a.effort.candidates.length, 'comment looks', 'comments look')} like effort ratings. Kept as notes only · Review`
        : `${plural(a.effort.candidates.filter((c) => c.checked).length, 'effort rating', 'effort ratings')} imported as RPE · Review`;

  const datesRow =
    a.appDates.count === 0 ? null : d.answers.existingDates === 'skip' ? 'Dates that already have a workout: skip them' : 'Dates that already have a workout: import as extra workouts';
  const gym = d.answers.gymId === null ? null : d.gyms.find((g) => g.id === d.answers.gymId);
  const primary =
    open > 0
      ? { label: `Answer ${plural(open, 'question', 'questions')} to import`, enabled: false }
      : a.ready
        ? { label: `Import ${plural(a.counts.workouts, 'workout', 'workouts')}`, enabled: true }
        : { label: 'Nothing to import', enabled: false };

  const before = d.importedBefore;
  return {
    fileName: d.fileName,
    notice: before
      ? {
          icon: 'info.circle',
          tone: 'info',
          text: `Imported before on ${shortDateOf(before.startedAt.utc, before.startedAt.tz, locale)} · new dates only`,
        }
      : null,
    detection: d.variant !== null ? `${appLabel(d.variant)} · ${a.unit?.kind === 'no_unit' && a.unit.answer === null ? 'weight unit not in the file' : unitsLabel(a.units)}` : d.layout?.kind === 'saved' ? `Layout: ${d.layout.profileName ?? ''} · offline` : 'Coach layout · checked by you',
    unitLine: d.layout === null || d.layout.unit === null ? null : `${d.layout.unit} · ${UNIT_SOURCE_WORD[d.layout.unitSource ?? 'answer']}`,
    saveLayout: d.layout?.save ? { on: d.layout.save.on, name: d.layout.save.name, why: 'Files with these columns import offline next time.' } : null,
    rowsLine: `${plural(a.rowCount, 'row', 'rows')}${range}`,
    willImport: { line1: `${plural(a.counts.workouts, 'workout', 'workouts')} · ${plural(a.counts.sets, 'set', 'sets')}`, line2: plural(a.counts.exercises, 'exercise', 'exercises') },
    questionsTitle: open > 0 ? `Needs your answer (${formatCount(open)})` : 'Your answers',
    questions,
    skipped,
    kept,
    effortReview,
    datesRow,
    recentlyDeletedRow: d.inRecentlyDeleted > 0 ? inRecentlyDeletedLine(d.inRecentlyDeleted) : null,
    gymRow: `Gym: ${gym ? `All at ${gym.name}` : 'Not recorded'}`,
    workoutsTitle: `Workouts (${formatCount(a.workouts.length)})`,
    primary,
  };
}

export const WORKOUT_PAGE = 50;

/** One page of the workouts list (§4.3: pages of 50). */
export function workoutRows(a: ImportAnalysis, page: number, locale?: string): { date: string; text: string }[] {
  return a.workouts.slice(page * WORKOUT_PAGE, (page + 1) * WORKOUT_PAGE).map((w) => ({
    date: w.date,
    text: `${longDate(w.date, locale)} · ${plural(w.exercises, 'exercise', 'exercises')} · ${plural(w.sets, 'set', 'sets')}`,
  }));
}

// ---------------------------------------------------------------------------
// Original row text and mapped set text (§2.5 step 3d, provenance copy)

/** `Flat Barbell Bench Press · 100 kgs · 8 reps · "@8 felt heavy"`: the row as written, minus date and category. */
export function originalText(variant: FitNotesVariant | null, cells: readonly string[]): string {
  // Any other app's row: its cells as written, in file order (§9.2.10).
  if (variant === null) return cells.map((c) => c.trim()).filter((c) => c !== '').join(' · ');
  const header = FITNOTES_HEADERS[variant];
  // Values don't line up with the columns: show them exactly as written instead of guessing which is which.
  if (cells.length !== header.length) return cells.join(',');
  const cell = (name: string) => (cells[header.indexOf(name)] ?? '').trim();
  const parts: string[] = [cell('Exercise') || '(no name)'];
  switch (variant) {
    case 'A1-kg':
    case 'A2-kg':
      if (cell('Weight (kgs)') !== '') parts.push(`${cell('Weight (kgs)')} kgs`);
      break;
    case 'A1-lb':
    case 'A2-lb':
      if (cell('Weight (lbs)') !== '') parts.push(`${cell('Weight (lbs)')} lbs`);
      break;
    case 'B1':
    case 'B2':
      if (cell('Weight') !== '') parts.push(`${cell('Weight')} ${cell('Weight Unit')}`.trim());
      break;
    case 'C':
      if (cell('Weight (kg)') !== '') parts.push(`${cell('Weight (kg)')} kg`);
      if (cell('Weight (lbs)') !== '') parts.push(`${cell('Weight (lbs)')} lbs`);
      break;
    case 'D':
      // No unit in the file: the number as written.
      if (cell('Weight') !== '') parts.push(cell('Weight'));
      break;
  }
  if (cell('Reps') !== '') parts.push(`${cell('Reps')} reps`);
  if (cell('Distance') !== '') parts.push(`${cell('Distance')} ${cell('Distance Unit')}`.trim());
  if (cell('Time') !== '') parts.push(cell('Time'));
  if (variant === 'D') {
    if (cell('IsWarmup') === 'true') parts.push('warm-up');
    if (cell('RPE') !== '') parts.push(`RPE ${cell('RPE')}`);
    if (cell('RIR') !== '') parts.push(`RIR ${cell('RIR')}`);
    if (cell('Status') !== '' && cell('Status') !== 'Done') parts.push(cell('Status'));
  }
  const comment = header.includes('Comment') ? cell('Comment') : header.includes('Notes') ? cell('Notes') : header.includes('Note') ? cell('Note') : '';
  if (comment !== '') parts.push(`“${comment}”`);
  return parts.join(' · ');
}

/** Equipment hint so `added` reads `plates` for a plate-loaded or Smith machine exercise (display only; review ben-kit B2). */
export function loadContextFor(c: Pick<MatchCandidate, 'compatibleEquipment'> | null): LoadContext {
  const kind = c?.compatibleEquipment.find(isPlatesAddedKind);
  return kind === undefined ? null : { kind };
}

export function mappedSetText(set: { load: Load | null; reps: number; convention: LoadConvention; rpe: number | null }, ctx: LoadContext = null): string {
  const rpe = set.rpe === null ? '' : ` · RPE${NBSP}${formatNumber(set.rpe)}`;
  return `${loadText(set.load, set.convention, ctx)}${NBSP}×${NBSP}${String(set.reps)}${rpe}`;
}

const SKIP_WORDS: Record<Exclude<ImportRowResult, 'imported'>, string> = {
  skipped_cardio: 'cardio isn’t imported yet',
  skipped_unsupported: 'not imported yet',
  skipped_duplicate: 'came in with an earlier import',
  skipped_date_exists: 'this date already has a workout',
  skipped_exercise: 'you chose Skip',
  unreadable: 'can’t be read',
  skipped_value_to_check: 'you chose Skip',
  skipped_not_a_set: 'not a set',
  not_read: 'not read',
};

/** One row of a preview workout (§2.5 step 3d) or a results list. */
export function previewRowLines(variant: FitNotesVariant | null, row: FitNotesRow, fate: RowFate, candidate: MatchCandidate | null): { title: string; detail: string } {
  const original = `${variant === null ? 'Row' : 'FitNotes row'} ${formatCount(row.row)}: ${originalText(variant, row.cells)}`;
  if (fate.result === 'imported') return { title: `${fate.set.exerciseName} · ${mappedSetText(fate.set, loadContextFor(candidate))}`, detail: original };
  if (fate.result === 'pending') return { title: `${row.exercise} · needs an answer`, detail: original };
  return { title: `${row.exercise} · ${fate.detail}`, detail: original };
}

/** `Row 1,204 · 2024-05-03 · Treadmill · 5 km · 25:00 — cardio isn’t imported yet` (§2.5 step 5). */
export function resultRowLine(variant: FitNotesVariant | null, r: ImportRow): string {
  const reason =
    r.result === 'imported'
      ? `imported${r.imported ? ` as ${r.imported.exerciseName} · ${mappedSetText(r.imported)}` : ''}${r.detail ? ` (${r.detail})` : ''}`
      : r.result === 'unreadable' || r.result === 'skipped_unsupported'
        ? (r.detail ?? SKIP_WORDS[r.result])
        : r.result === 'skipped_not_a_set' && variant === 'D'
          ? 'not done'
          : SKIP_WORDS[r.result];
  if (variant === null) return `Row ${formatCount(r.row)} · ${originalText(null, r.cells)} — ${reason}`;
  if (r.cells.length !== FITNOTES_HEADERS[variant].length) return `Row ${formatCount(r.row)} · ${originalText(variant, r.cells)} — ${reason}`;
  const date = r.localDate ?? (r.cells[0] ?? '').trim();
  return `Row ${formatCount(r.row)} · ${date === '' ? 'no date' : date} · ${originalText(variant, r.cells)} — ${reason}`;
}

// ---------------------------------------------------------------------------
// Names (§2.5 step 3a)

export interface NameRowView {
  key: string;
  title: string;
  sets: string;
  status: { icon: IconName; tone: Tone; word: 'Matched' | 'Check' | 'No match' | 'Skipped' | 'Chosen' | 'New'; text: string };
  actions: ('use' | 'choose' | 'new' | 'skip' | 'change')[];
  suggestionId: string | null;
}

const KIND_WORD: Record<CustomExerciseKind, string> = { ...EQUIPMENT_WORD };

export function nameRowView(n: NameRow, candidateName: (id: string) => string | null): NameRowView {
  const sets = plural(n.sets, 'set', 'sets');
  const base = { key: n.key, title: n.name, sets };
  if (n.answer) {
    switch (n.answer.kind) {
      case 'skip':
        return { ...base, status: { icon: 'slash.circle', tone: 'info', word: 'Skipped', text: 'Skipped' }, actions: ['change'], suggestionId: null };
      case 'new':
        return { ...base, status: { icon: 'checkmark.circle.fill', tone: 'done', word: 'New', text: `New exercise · ${KIND_WORD[n.answer.equipment]}` }, actions: ['change'], suggestionId: null };
      case 'exercise':
        return { ...base, status: { icon: 'checkmark.circle.fill', tone: 'done', word: 'Chosen', text: candidateName(n.answer.exerciseId) ?? 'Exercise missing' }, actions: ['change'], suggestionId: null };
    }
  }
  switch (n.match.status) {
    case 'matched':
      return n.match.skip
        ? { ...base, status: { icon: 'slash.circle', tone: 'info', word: 'Skipped', text: 'Skipped (your answer last time)' }, actions: ['change'], suggestionId: null }
        : {
            ...base,
            status: { icon: 'checkmark.circle.fill', tone: 'done', word: 'Matched', text: `${candidateName(n.match.exerciseId ?? '') ?? 'Exercise missing'}${n.match.via === 'alias' ? ' (your answer last time)' : ''}` },
            actions: ['change'],
            suggestionId: n.match.exerciseId,
          };
    case 'check':
      return { ...base, status: { icon: 'questionmark.circle', tone: 'warning', word: 'Check', text: candidateName(n.match.exerciseId ?? '') ?? '' }, actions: ['use', 'choose', 'new'], suggestionId: n.match.exerciseId };
    case 'no_match':
      // The FitNotes category, as written, helps Ben choose.
      return { ...base, status: { icon: 'xmark.circle', tone: 'info', word: 'No match', text: n.category === null ? 'No match' : `No match · ${clipCategory(n.category)}` }, actions: ['choose', 'new', 'skip'], suggestionId: null };
  }
}

/** A category cell is data of any length: one line, clipped (review import-names N3). */
function clipCategory(category: string): string {
  const one = category.replace(/\s+/g, ' ').trim();
  return one.length <= 24 ? one : `${one.slice(0, 23).trimEnd()}…`;
}

/** Names needing Ben first, then answered ones; plain name matches collapsed into one line. */
export function namesView(a: ImportAnalysis, candidateName: (id: string) => string | null): { rows: NameRowView[]; matchedCount: number; matched: NameRowView[] } {
  const live = a.names.filter((n) => n.sets > 0);
  const plainMatch = (n: NameRow) => n.answer === null && n.match.status === 'matched';
  return {
    rows: live.filter((n) => !plainMatch(n)).map((n) => nameRowView(n, candidateName)),
    matchedCount: live.filter(plainMatch).length,
    matched: live.filter(plainMatch).map((n) => nameRowView(n, candidateName)),
  };
}

// ---------------------------------------------------------------------------
// Convention questions (§2.5 step 3b)

export interface OptionView<A extends string> {
  value: A;
  label: string;
  detail: string;
  selected: boolean;
}

export interface PerHandChoice {
  /** Null: back to the default (the group answer, or one dumbbell when the catalogue says so). */
  value: PerHandReading | null;
  label: string;
  selected: boolean;
}

export interface PerHandRowView {
  key: string;
  /** The FitNotes name. */
  title: string;
  /** What its newest weight imports as: `60 kg → 30 kg each`, `30 kg → 30 kg (one dumbbell)` (review r3 S1). */
  conversion: string;
  /** `Your answer last time` while the choice is the one Ben gave for this name in an earlier import (review r4 S2). */
  remembered: string | null;
  choices: PerHandChoice[];
}

export interface PerHandView {
  title: string;
  lead: string | null;
  /** The group question, asked only for exercises done with two dumbbells; null when the file has none. */
  question: string | null;
  options: OptionView<'each' | 'both'>[];
  example: string | null;
  /** Exercises with no recorded dumbbell count: each needs its own answer, with none pre-selected (DX6). */
  ask: { title: string; lead: string; rows: PerHandRowView[] } | null;
  /** Every other exercise with what it will import as, and a way to change it. */
  rows: { title: string; note: string | null; rows: PerHandRowView[] } | null;
}

function weightText(value: number, unit: WeightUnit): string {
  return `${formatNumber(value)}${NBSP}${unit}`;
}

/** A weight as written, with a real minus sign when negative (`−30 kg`). */
function signedWeightText(value: number, unit: WeightUnit): string {
  return value < 0 ? `−${weightText(-value, unit)}` : weightText(value, unit);
}

/** `60 kg → 30 kg each`; `30 kg → 30 kg (one dumbbell)`; `24 kg → 24 kg (one kettlebell)`; `14 kg → not answered yet`. */
export function perHandConversion(e: Pick<PerHandExercise, 'reading' | 'sample'> & Partial<Pick<PerHandExercise, 'implement'>>): string {
  const s = e.sample;
  if (!s) return 'No weight to show';
  const from = weightText(s.value, s.unit);
  if (e.reading === null || s.imported === null) return `${from} → not answered yet`;
  return `${from} → ${weightText(s.imported, s.unit)}${e.reading === 'one' ? ` (one ${e.implement ?? 'dumbbell'})` : ' each'}`;
}

/** `One dumbbell`, or `One kettlebell` for a kettlebell exercise (review r5 N3). */
function oneLabel(e: Pick<PerHandExercise, 'implement'>): string {
  return e.implement === 'kettlebell' ? 'One kettlebell' : 'One dumbbell';
}

function perHandRow(e: PerHandExercise): PerHandRowView {
  const pick = (value: PerHandReading | null, label: string): PerHandChoice => ({ value, label, selected: e.override === value });
  const label: Record<PerHandReading, string> = { one: oneLabel(e), each: 'Each', both: 'Both together' };
  const choices =
    e.implements === 2
      ? [pick(null, 'Same'), pick('each', 'Each'), pick('both', 'Both together')]
      : e.implements === 1
        ? // One dumbbell: the only real choice is as written or halved (review r4 N4).
          [{ value: null, label: label.one, selected: e.override === null || e.override === 'one' }, pick('both', 'Both together')]
        : [pick('one', label.one), pick('each', 'Each'), pick('both', 'Both together')];
  // An answer these choices don't offer (remembered from an import that read the exercise differently) stays visible and selected.
  if (e.override !== null && !choices.some((c) => c.selected)) choices.push(pick(e.override, label[e.override]));
  const remembered = e.remembered !== null && e.override === e.remembered ? 'Your answer last time' : null;
  return { key: e.key, title: e.name, conversion: perHandConversion(e), remembered, choices };
}

/**
 * The dumbbell question (§2.5 step 3b; review r3 S1). Each / both is asked
 * for two-dumbbell exercises only; one-dumbbell exercises (a one-arm row, a
 * goblet squat) import as written; an exercise whose count isn't recorded is
 * asked on its own. Every exercise shows what it will import as before the
 * import, so a wrong reading is visible.
 */
export function perHandOptions(a: ImportAnalysis, locale?: string): PerHandView | null {
  const q = a.perHand;
  if (!q) return null;
  const ex = q.example;
  const v = ex ? formatNumber(ex.value) : '22.5';
  const unit = ex?.unit ?? 'kg';
  const unknown = q.exercises.filter((e) => e.implements === null);
  const known = q.exercises.filter((e) => e.implements !== null);
  // Imported as written: one-dumbbell exercises Ben hasn't said otherwise about.
  const asWritten = known.filter((e) => e.implements === 1 && e.reading === 'one');
  const ones = asWritten.length;
  const kinds = new Set(asWritten.map((e) => e.implement));
  const oneWord = kinds.size === 2 ? 'one dumbbell or kettlebell' : kinds.has('kettlebell') ? 'one kettlebell' : 'one dumbbell';
  // A lone two-dumbbell exercise is fully shown by the options above it.
  const lone = known.length === 1 && known[0]?.implements === 2 && known[0].override === null;
  return {
    title: 'Dumbbell weights',
    lead: null,
    question: q.pairs === 0 ? null : `For ${q.pairs === 1 ? 'this exercise' : `these ${String(q.pairs)} exercises`} with two dumbbells, “${v}” means:`,
    options:
      q.pairs === 0
        ? []
        : [
            { value: 'each', label: 'Each dumbbell', detail: `Imported as ${v}${NBSP}${unit} each`, selected: q.answer === 'each' },
            { value: 'both', label: 'Both dumbbells together', detail: `Imported as ${formatNumber((ex?.value ?? 22.5) / 2)}${NBSP}${unit} each`, selected: q.answer === 'both' },
          ],
    example: ex ? `Example from your file (${dayMonthYear(ex.date, locale)}): ${ex.name}  ${v}${NBSP}×${NBSP}${String(ex.reps)}` : null,
    ask:
      unknown.length === 0
        ? null
        : {
            title: 'One dumbbell or two?',
            lead: 'Choose for each',
            rows: unknown.map(perHandRow),
          },
    rows:
      known.length === 0 || lone
        ? null
        : {
            title: q.pairs > 0 ? 'Different for some?' : 'Each exercise',
            note: ones === 0 ? null : `${plural(ones, 'exercise uses', 'exercises use')} ${oneWord}, so ${ones === 1 ? 'its weight is' : 'their weights are'} imported as written.`,
            rows: known.map(perHandRow),
          },
  };
}

export interface BarWeightView {
  bar: ImportBarKind;
  unit: WeightUnit;
  /** Null: not entered yet (EZ and trap bars have no default). */
  value: number | null;
  label: string;
  /** Shown under an empty field that a plates-only answer needs. */
  missing: string | null;
}

export interface BarWeightEntry {
  /** Save this when editing ends: a weight above 0 that differs from the stored one. */
  save: number | null;
  /**
   * What the field shows once editing ends. Blank or unreadable text goes
   * back to the stored weight, so the field never hides the weight that is
   * still added to plates-only rows (review r2 S1).
   */
  endText: string;
  /** Under the field while it's edited (and under an empty field a plates-only answer needs). */
  warning: string | null;
}

/**
 * The bar weight field's rules (review r2 S1), so the screen only renders
 * them. A weight above the maximum (100 kg / 220 lb, a typo such as `200`)
 * is refused here in the app's words, never saved, and the field goes back
 * to the weight in use (review r3 N1). The weight in use is only ever added
 * to plates-only values (review r3 N2).
 */
export function barWeightEntry(text: string, field: Pick<BarWeightView, 'value' | 'unit' | 'missing'>): BarWeightEntry {
  const parsed = parseNumber(text);
  const max = BAR_WEIGHT_MAX[field.unit];
  if (parsed !== null && parsed > 0 && parsed <= max) return { save: parsed === field.value ? null : parsed, endText: text, warning: null };
  const ask = parsed !== null && parsed > max ? `Enter a bar weight up to ${formatNumber(max)}${NBSP}${field.unit}.` : 'Enter a bar weight above 0.';
  if (field.value !== null) {
    return { save: null, endText: String(field.value), warning: `${ask} Until you do, ${formatNumber(field.value)}${NBSP}${field.unit} is added to plates-only values.` };
  }
  return { save: null, endText: text, warning: text.trim() === '' ? field.missing : ask };
}

export interface TotalChoice {
  value: TotalAnswer;
  label: string;
  selected: boolean;
}

export interface TotalBarChoice {
  /** The answer to save: null goes back to the exercise's own bar. */
  value: ImportBarKind | null;
  label: string;
  selected: boolean;
}

export interface TotalRowView {
  key: string;
  /** The FitNotes name. */
  title: string;
  /** The bar "plates only" would add and where it comes from: `Bar: Olympic bar (from Bench Press)`, `Bar: EZ bar (your choice)`. */
  barLine: string;
  /** Olympic / EZ / trap bar, the one in use selected (it is the exercise's own unless Ben changed it). Empty until `Plates only` is selected (review r8 S2). */
  bars: TotalBarChoice[];
  /** What its newest weight imports as under "plates only": `If plates only: 60 kg → 80 kg total (plates + 20 kg bar)`. */
  conversion: string;
  /** What it imports as now: `Now: 60 kg → 60 kg total as written`, `Now: not answered yet`. */
  now: string;
  /** `Your answer last time` when the answer is the one remembered from an import still in effect, and exactly what it does now (review r8 B1, B2). */
  remembered: string | null;
  /**
   * Information only, when Ben's answer last time isn't filled in because
   * it wouldn't do the same now (another exercise, bar or bar weight):
   * `Last time: plates only + 15 kg Olympic bar. Not filled in: the bar or its weight is different now.` (review r8 B1, B2).
   */
  lastTime: string | null;
  /** Total as written / Plates only. Nothing pre-selected (DX6). */
  choices: TotalChoice[];
}

export interface TotalView {
  title: string;
  lead: string | null;
  /** The group question, for exercises with no answer of their own; null when there are none. */
  question: string | null;
  /** Only `Total as written`: no group answer adds a bar weight (PM decision after review r7). */
  options: OptionView<GroupTotalAnswer>[];
  example: string | null;
  barWeights: BarWeightView[];
  /** Every barbell exercise, to choose "plates only" for one at a time, each with its bar and conversion. */
  platesOnly: { title: string; lead: string; rows: TotalRowView[] };
}

/**
 * Under "plates only": `60 kg → 80 kg total (plates + 20 kg bar)`;
 * `30 kg → EZ-bar weight needed`; `100 kg → choose the bar`.
 */
export function platesOnlyConversion(e: Pick<TotalExercise, 'sample' | 'bar'>): string {
  const s = e.sample;
  if (!s) return 'No weight to show';
  const from = weightText(s.value, s.unit);
  if (e.bar === 'unknown') return `${from} → choose the bar`;
  if (s.barWeight === null || s.platesOnly === null) return `${from} → ${BAR_WORD[e.bar]} weight needed`;
  return `${from} → ${weightText(s.platesOnly, s.unit)} total (plates + ${weightText(s.barWeight, s.unit)} ${BAR_NAME[e.bar]})`;
}

/**
 * What one exercise imports as now: `100 kg → 100 kg total as written`;
 * `100 kg → 120 kg total (plates + 20 kg bar)`; `100 kg → not answered yet`.
 */
export function totalConversion(e: Pick<TotalExercise, 'reading' | 'sample' | 'bar'>): string {
  const s = e.sample;
  if (!s) return 'No weight to show';
  const from = weightText(s.value, s.unit);
  if (e.reading === null) return `${from} → not answered yet`;
  if (e.reading === 'total') return `${from} → ${from} total as written`;
  return platesOnlyConversion(e);
}

/** Ben's barbell answer last time, when it isn't filled in now (review r8 B1, B2). */
function lastTimeLine(r: RememberedTotal, e: Pick<TotalExercise, 'exerciseId'>): string {
  const weights = r.barWeight === undefined ? [] : (['kg', 'lb'] as const).flatMap((u) => (r.barWeight?.[u] === undefined ? [] : [weightText(r.barWeight[u], u)]));
  const answer =
    r.reading === 'total' ? 'total as written' : r.bar === undefined ? 'plates only' : `plates only + ${weights.length > 0 ? `${weights.join(' / ')} ` : ''}${BAR_LABEL[r.bar]}`;
  const why = r.exerciseId !== undefined && r.exerciseId !== e.exerciseId ? 'it was for another exercise' : r.exerciseId === undefined ? 'answer again to be sure' : 'the bar or its weight is different now';
  return `Last time: ${answer}. Not filled in: ${why}.`;
}

function totalRow(e: TotalExercise): TotalRowView {
  const pick = (value: TotalAnswer, label: string): TotalChoice => ({ value, label, selected: e.override === value });
  const barLine =
    e.bar === 'unknown'
      ? `Bar: not recorded for ${e.exerciseName}. Choose one for plates only.`
      : `Bar: ${BAR_LABEL[e.bar]} (${e.barChosen ? 'your choice' : `from ${e.exerciseName}`})`;
  // The bar only matters for plates only: it is chosen once that is selected (review r8 S2).
  const bars = e.override === 'plates_only' ? BAR_KINDS.map((b): TotalBarChoice => ({ value: b === e.exerciseBar ? null : b, label: BAR_LABEL[b], selected: e.bar === b })) : [];
  const r = e.remembered;
  const same = r !== null && e.rememberedFits && e.override === r.reading && (r.reading === 'total' || e.bar === r.bar);
  const remembered = same ? 'Your answer last time' : null;
  const lastTime = r !== null && !same && !e.rememberedFits ? lastTimeLine(r, e) : null;
  return {
    key: e.key,
    title: e.name,
    barLine,
    bars,
    conversion: `If plates only: ${platesOnlyConversion(e)}`,
    now: `Now: ${totalConversion(e)}`,
    remembered,
    lastTime,
    choices: [pick('total', 'Total as written'), pick('plates_only', 'Plates only')],
  };
}

/**
 * The barbell question (§2.5 step 3b; PM decision after review r7). The
 * group answer is only `Total as written`: nothing is added. "Plates only"
 * is chosen one exercise at a time, from a list that shows each exercise's
 * bar (the matched exercise's own, changeable) and what it imports as, with
 * nothing pre-selected. One bar weight per bar kind and unit (review S1):
 * the Olympic bar's is shown whenever an exercise uses it (20 kg / 45 lb,
 * editable); an EZ or trap bar's once a plates-only answer needs it, and it
 * starts empty.
 */
export function totalOptions(a: ImportAnalysis, locale?: string): TotalView | null {
  const q = a.total;
  if (!q) return null;
  const ex = q.example;
  const v = ex ? formatNumber(ex.value) : '100';
  const barWeights = q.bars
    .filter((b) => b.bar === 'barbell' || b.needed)
    .flatMap((b) =>
      b.units.map(
        (unit): BarWeightView => ({
          bar: b.bar,
          unit,
          value: b.weight[unit],
          label: `${BAR_WORD[b.bar]} weight (${unit}), added to “plates only” values`,
          missing: b.missing.includes(unit) ? `${BAR_WORD[b.bar]} weight needed (${unit})` : null,
        }),
      ),
    );
  const unit = ex?.unit ?? 'kg';
  return {
    title: 'Barbell weights',
    lead: null,
    question: q.grouped === 0 ? null : `For ${q.grouped === 1 ? 'this exercise' : `these ${String(q.grouped)} exercises`}, “${v}” means:`,
    options: q.grouped === 0 ? [] : [{ value: 'total', label: 'Total as written', detail: `Nothing added: imported as ${v}${NBSP}${unit}`, selected: q.answer === 'total' }],
    example: ex ? `Example from your file (${dayMonthYear(ex.date, locale)}): ${ex.name}  ${v}${NBSP}×${NBSP}${String(ex.reps)}` : null,
    barWeights,
    platesOnly: {
      title: 'Plates only (bar not counted)?',
      lead: 'Bar weight is added',
      rows: q.exercises.map(totalRow),
    },
  };
}

/**
 * A bodyweight exercise with weights (§2.5 step 3b). When its values are
 * both negative and positive, a third answer reads each by its sign, and
 * `Assistance` says it can't read the positive ones (review B3). No option
 * is pre-selected (DX6).
 */
export function bodyweightOptions(a: ImportAnalysis, key: string): { title: string; question: string; range: string; options: OptionView<'added' | 'assistance' | 'split'>[] } | null {
  const q = a.bodyweight.find((x) => x.key === key);
  if (!q) return null;
  const neg = q.min < 0 ? `, ${q.max <= 0 ? 'all' : 'some'} negative` : ', none negative';
  const options: OptionView<'added' | 'assistance' | 'split'>[] = [
    // A stack or plates-added exercise whose name says assisted: "added" is that load (review r6.1 S1).
    {
      value: 'added',
      label: q.loadAs === 'stack' ? 'Weight on the stack' : q.loadAs === 'added' ? 'Plates added' : 'Weight added to bodyweight',
      detail: q.min < 0 ? 'Negative values can’t be read this way' : q.loadAs === 'stack' ? 'Every value is the weight lifted on the stack' : 'Every value is weight added',
      selected: q.answer === 'added',
    },
    {
      value: 'assistance',
      label: 'Assistance from a machine',
      detail: q.mixed ? 'Negative values are read as assistance; positive values can’t be read this way' : q.min < 0 ? 'A negative value is read as that much assistance' : 'Each value is read as the assistance on the machine',
      selected: q.answer === 'assistance',
    },
  ];
  // Offered while the values span zero, and kept once chosen so the chosen answer is always visible (review r2 N5).
  // A positive value is stored as the exercise's own load: on the stack for a stack exercise (review r6.2 N1).
  const positive = q.loadAs === 'stack' ? 'on the stack' : 'added';
  const splitLabel = `Negative = assistance, positive = ${positive}`;
  if (q.mixed) {
    options.push({ value: 'split', label: splitLabel, detail: `${formatNumber(q.min)} is read as ${formatNumber(-q.min)} assistance; ${formatNumber(q.max)} as ${formatNumber(q.max)} ${positive}`, selected: q.answer === 'split' });
  } else if (q.answer === 'split') {
    options.push({ value: 'split', label: splitLabel, detail: 'Each value is read by its sign', selected: true });
  }
  return {
    title: `${q.name} weights`,
    question: `For ${q.name}, “${formatNumber(q.max !== 0 ? q.max : q.min)}” means:`,
    range: `Values in your file: ${formatNumber(q.min)} to ${formatNumber(q.max)}${neg}`,
    options,
  };
}

// ---------------------------------------------------------------------------
// Importing, results and past imports (§2.5 steps 4–5, §3.4)

export function progressView(written: number, total: number): { text: string; fraction: number } {
  return { text: `${formatCount(written)} of ${plural(total, 'workout', 'workouts')}`, fraction: total === 0 ? 1 : Math.min(1, written / total) };
}

export function stateLine(p: PastImport, locale?: string): Line {
  switch (p.state) {
    case 'finished':
      return {
        icon: 'checkmark.circle.fill',
        tone: 'done',
        // delete-workouts §5: `412 workouts · 3 deleted` while some are in Recently deleted.
        text: `Finished · ${plural(p.written, 'workout', 'workouts')}${p.deleted > 0 ? ` · ${formatCount(p.deleted)} deleted` : ''}`,
      };
    case 'running':
      return { icon: 'info.circle', tone: 'info', text: `Importing… ${progressView(p.written, p.total).text}` };
    case 'paused':
      return { icon: 'exclamationmark.triangle', tone: 'warning', text: pausedLine(p) };
    case 'undone':
      return {
        icon: 'slash.circle',
        tone: 'info',
        text: `Undone on ${p.job.revert ? shortDateOf(p.job.revert.at.utc, p.job.revert.at.tz, locale) : '—'} · ${plural(p.job.revert?.workouts ?? 0, 'workout', 'workouts')} hidden`,
      };
  }
}

export function pastImportRow(p: PastImport, locale?: string): { title: string; subtitle: string; line: Line } {
  return { title: p.job.fileName, subtitle: `Imported ${shortDateOf(p.job.startedAt.utc, p.job.startedAt.tz, locale)} · ${sourceLabel(p.job)}`, line: stateLine(p, locale) };
}

export interface ResultsView {
  banner: Line;
  headline: string;
  from: string;
  /** The workouts that came in, newest first (check 24: each opens its sets with their originals; review S2). */
  imported: { title: string; workouts: { date: string; text: string }[] } | null;
  skipped: { result: Exclude<ImportRowResult, 'imported'>; title: string; lines: string[] }[];
  canUndo: boolean;
  canContinue: boolean;
}

const SKIP_TITLE: Record<Exclude<ImportRowResult, 'imported'>, (n: number) => string> = {
  skipped_cardio: (n) => plural(n, 'cardio row', 'cardio rows'),
  skipped_unsupported: (n) => plural(n, 'timed, distance or weight-only set', 'timed, distance or weight-only sets'),
  unreadable: (n) => `${plural(n, 'row', 'rows')} couldn’t be read`,
  skipped_date_exists: (n) => `${plural(n, 'row', 'rows')} on dates already in GymSmarter`,
  skipped_duplicate: (n) => `${plural(n, 'row', 'rows')} from an earlier import`,
  skipped_exercise: (n) => `${plural(n, 'set', 'sets')} you chose to skip`,
  skipped_value_to_check: (n) => `${plural(n, 'set', 'sets')} skipped as values to check`,
  skipped_not_a_set: (n) => `${plural(n, 'row', 'rows')} not a set`,
  not_read: (n) => `${plural(n, 'line', 'lines')} not read`,
};

export function resultsView(p: PastImport & { rows: readonly ImportRow[] }, locale?: string): ResultsView {
  const sets = p.rows.filter((r) => r.result === 'imported').length;
  const order: Exclude<ImportRowResult, 'imported'>[] = [
    'skipped_cardio',
    'skipped_unsupported',
    'unreadable',
    'skipped_date_exists',
    'skipped_duplicate',
    'skipped_exercise',
    'skipped_value_to_check',
    'skipped_not_a_set',
    'not_read',
  ];
  const skipped = order.flatMap((result) => {
    const rows = p.rows.filter((r) => r.result === result);
    const title = result === 'skipped_not_a_set' && p.job.variant === 'D' ? plural(rows.length, 'set not done', 'sets not done') : SKIP_TITLE[result](rows.length);
    return rows.length === 0 ? [] : [{ result, title, lines: rows.map((r) => resultRowLine(p.job.variant, r)) }];
  });
  const banner: Line =
    p.state === 'finished'
      ? { icon: 'checkmark.circle.fill', tone: 'done', text: 'Import finished' }
      : stateLine(p, locale);
  const workouts = importedWorkouts(p.rows, locale);
  return {
    banner,
    headline: p.state === 'finished' ? `${plural(p.written, 'workout', 'workouts')} · ${plural(sets, 'set', 'sets')} added` : `${plural(p.written, 'workout', 'workouts')} of ${formatCount(p.total)} in`,
    from: `From ${p.job.fileName}`,
    imported: workouts.length === 0 || p.state === 'undone' ? null : { title: `Imported workouts (${formatCount(workouts.length)})`, workouts },
    skipped,
    canUndo: p.state !== 'undone' && p.state !== 'running',
    // Any unfinished import that isn't being written now, including one whose workouts are all in (review B1).
    canContinue: p.state === 'paused',
  };
}

export function undoAlert(p: PastImport): { title: string; message: string } {
  return {
    title: 'Undo this import?',
    message: `${plural(p.written, 'workout', 'workouts')} from ${p.job.fileName} will be hidden from history, Progress and targets. Your other workouts aren’t touched.${
      p.deleted > 0 ? `\nIncludes ${formatCount(p.deleted)} in Recently deleted.` : ''
    }`,
  };
}

export function undoneToast(workouts: number): string {
  return `${plural(workouts, 'workout', 'workouts')} hidden. You can import the file again.`;
}

/** History set detail (§5 Provenance). */
export function provenanceLines(p: ImportedSetProvenance, locale?: string): { source: string; original: string } {
  const date = longDate(localDateOf(toMs(p.importedAt.utc), p.importedAt.tz), locale);
  if (p.variant === null) {
    // Any other app (§9.2.10): the file and row, the cells as written, and the layout's tag; a start time as in the file.
    const time = p.row.startLocal ? ` · ${p.row.startLocal} (as in the file)` : '';
    return { source: `${p.fileName} · row ${formatCount(p.row.row)}${time}`, original: `Original: ${originalText(null, p.row.cells)}` };
  }
  return { source: `Imported from FitNotes on ${date} · row ${formatCount(p.row.row)}`, original: `Original: ${originalText(p.variant, p.row.cells)}` };
}

/** The dates an import's sets came in on, newest first: `Wed 1 Oct 2026 · 5 exercises · 18 sets` (review S2). */
export function importedWorkouts(rows: readonly ImportRow[], locale?: string): { date: string; text: string }[] {
  const perDate = new Map<string, { exercises: Set<string>; sets: number }>();
  for (const r of rows) {
    if (r.result !== 'imported' || r.localDate === null || r.imported === null) continue;
    const d = perDate.get(r.localDate) ?? { exercises: new Set<string>(), sets: 0 };
    d.exercises.add(r.imported.sessionExerciseId);
    d.sets += 1;
    perDate.set(r.localDate, d);
  }
  return [...perDate.entries()]
    .sort(([a], [b]) => (a < b ? 1 : a > b ? -1 : 0))
    .map(([date, d]) => ({ date, text: `${longDate(date, locale)} · ${plural(d.exercises.size, 'exercise', 'exercises')} · ${plural(d.sets, 'set', 'sets')}` }));
}

/**
 * One imported set with where it came from (check 24; review S2): the set as
 * it is in the app, then `Imported from FitNotes on … · row …` (the file is
 * named on the screen) and `Original: …` exactly as written.
 */
export function importedSetLines(job: ImportJob, row: ImportRow, locale?: string): { title: string; source: string; original: string } {
  const p = provenanceLines({ fileName: job.fileName, importedAt: job.startedAt, variant: job.variant, row, header: job.header, layout: job.layout ?? null }, locale);
  // The set as it came in, labelled so: a set corrected in the app since isn't shown here (review r2 N3).
  const set = row.imported;
  const title = set ? `${set.exerciseName} · imported as ${mappedSetText(set)}` : row.exerciseName;
  return { title, source: row.detail ? `${p.source} · ${row.detail}` : p.source, original: p.original };
}
