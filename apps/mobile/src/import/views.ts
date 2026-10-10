import {
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
  type RowFate,
  type TotalExercise,
  type TotalQuestion,
} from '@fizz/domain';
import {
  BAR_WEIGHT_MAX,
  type CustomExerciseKind,
  type FitNotesVariant,
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
  lead: 'Bring in your FitNotes history from a CSV export.',
  step1: 'In FitNotes, export a CSV and save it to Files.',
  step2: 'Choose it here. You’ll see what will be imported before anything is saved.',
  works: 'Works with FitNotes (Android) and FitNotes 2 (iPhone) CSV files.',
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
  return p.written >= p.total ? `${stoppedAt(p).slice(0, -1)}; Continue import finishes it.` : stoppedAt(p);
}

/**
 * `Start from a past workout` with imported workouts left out (review r2
 * B1): they can't be repeated while P-I3 is open, and the list says so
 * rather than looking empty.
 */
export function importedNotListedLine(n: number): string {
  return `${plural(n, 'workout', 'workouts')} imported from FitNotes ${n === 1 ? 'isn’t' : 'aren’t'} listed: imported workouts can’t be repeated yet. They’re in Data & backup, under Past imports.`;
}

/**
 * A workout's write didn't report success (§3.4; review r2 N4). Its
 * transaction may still have committed, so this never says it failed:
 * each workout saves whole or not at all, and `Try again` checks.
 */
export function writeFailedLine(r: { written: number; date: string; message: string }, locale?: string): string {
  return `Workout ${formatCount(r.written + 1)} (${longDate(r.date, locale)}) may not have saved: ${r.message}. ${plural(r.written, 'workout is', 'workouts are')} in before it. Each workout saves whole or not at all; Try again checks and carries on.`;
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
      return { text: 'This looks like a FitNotes backup, not a CSV export. Export a CSV from FitNotes and choose that.', firstLine: null, sameFileJobId: null };
    case 'body_tracker':
      return { text: 'This looks like a FitNotes Body Tracker export. Choose the Workout Data export.', firstLine: r.firstLine, sameFileJobId: null };
    case 'unknown_header':
      return { text: 'GymSmarter doesn’t recognise this file’s columns yet. Nothing was guessed.', firstLine: r.firstLine, sameFileJobId: null };
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
        text: `You imported this file on ${shortDateOf(r.job.startedAt.utc, r.job.startedAt.tz, locale)} (${plural(r.job.counts.workouts, 'workout', 'workouts')}). Nothing new to import.`,
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

export function unitsLabel(units: { kg: number; lb: number }): string {
  if (units.kg > 0 && units.lb > 0) return 'weights in kg and lb (per set)';
  if (units.kg > 0) return 'weights in kg';
  if (units.lb > 0) return 'weights in lb';
  return 'no weights';
}

export type QuestionKey = { kind: 'names' } | { kind: 'per_hand' } | { kind: 'total' } | { kind: 'bodyweight'; key: string } | { kind: 'unit' };

export interface QuestionRow {
  key: QuestionKey;
  answered: boolean;
  line: Line;
}

export type SkipKey = 'cardio' | 'unsupported' | 'unreadable' | 'date_exists' | 'duplicate' | 'exercise';

export interface PreviewView {
  fileName: string;
  /** This file was imported before, but some of its dates aren't in the app now (review r3 S2). */
  notice: Line | null;
  detection: string;
  rowsLine: string;
  willImport: { line1: string; line2: string };
  questionsTitle: string;
  questions: QuestionRow[];
  skipped: { key: SkipKey; line: Line }[];
  kept: Line[];
  effortReview: string | null;
  datesRow: string | null;
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

const TOTAL_WORD: Record<TotalAnswer, string> = { total: 'total, including the bar', plates_only: 'plates only + bar' };

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
          : { key: { kind: 'per_hand' }, answered: true, line: { icon: 'checkmark.circle.fill', tone: 'done', text: `Dumbbells: ${perHandSummary(q)}` } },
    );
  }
  if (a.total) {
    const q = a.total;
    const warn = (text: string): QuestionRow => ({ key: { kind: 'total' }, answered: false, line: { icon: 'exclamationmark.triangle', tone: 'warning', text } });
    const missingBar = q.bars.find((b) => b.missing.length > 0);
    out.push(
      q.needsGroup
        ? warn('Barbell weights: total or plates only?')
        : q.needsOwn > 0
          ? warn(`${plural(q.needsOwn, 'barbell exercise', 'barbell exercises')}: total or plates only?`)
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
function perHandSummary(q: PerHandQuestion): string {
  const counts = (['each', 'both', 'one'] as const).map((r) => ({ r, n: q.exercises.filter((e) => e.reading === r).length })).filter((c) => c.n > 0);
  const only = counts.length === 1 ? counts[0] : undefined;
  if (only) return READING_WORD[only.r];
  return counts.map((c) => `${formatCount(c.n)} ${READING_WORD[c.r]}`).join(' · ');
}

/** `total, including the bar`, or by reading when they differ: `2 total, including the bar · 1 plates only + bar`. */
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
      line: info(`${plural(r.unreadable, 'row', 'rows')} can’t be read`, a.decimalCommaRows > 0 ? 'This file may use decimal commas (22,5). Nothing was guessed.' : undefined),
    });
  }
  if (d.answers.existingDates === 'skip' && a.appDates.count > 0) {
    skipped.push({ key: 'date_exists', line: info(`${plural(a.appDates.count, 'date already has', 'dates already have')} a GymSmarter workout`, `Newest: ${longDate(a.appDates.newest ?? '', locale)}`) });
  }
  for (const e of a.alreadyImported.imports) {
    skipped.push({ key: 'duplicate', line: info(`${plural(e.dates, 'workout', 'workouts')} came in with your import on ${shortDateOf(e.startedAtUtc, e.tz, locale)}. They’ll be skipped.`, 'GymSmarter’s version always wins, including sets you corrected since.') });
  }
  if (skippedExerciseSets(a) > 0) skipped.push({ key: 'exercise', line: info(`${plural(skippedExerciseSets(a), 'set', 'sets')} of exercises you chose to skip`) });

  const kept: Line[] = [];
  if (a.comments > 0) kept.push(info(`${plural(a.comments, 'comment', 'comments')}, kept with each set as written`));
  else if (!variantHasComments(d.variant)) kept.push(info('No comments in this file (FitNotes export without comments)'));
  kept.push(info('FitNotes files have no times. These workouts show the date only.'));
  if (a.machines.length > 0) {
    // Assistance reads the number the other way round (more is easier): name those exercises (review r5 S3), each with what it imports as (review r6 N2).
    const assisted = a.machines.filter((m) => m.convention === 'assistance').map(assistedText);
    kept.push(info('Machines: imported as stack readings, plates added or assistance, by exercise', assisted.length === 0 ? undefined : `Read as assistance (more weight is easier): ${assisted.join(', ')}`));
  }
  if (a.barless.length > 0) kept.push(info(`Kettlebell and other no-bar weights imported as written (${a.barless.map((b) => b.name).join(', ')})`));
  kept.push(info('Warm-ups aren’t marked in FitNotes files, so every set comes in as a working set.'));

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
          text: `You imported this file on ${shortDateOf(before.startedAt.utc, before.startedAt.tz, locale)}. Workouts from it that are still in GymSmarter are skipped; dates that aren’t in GymSmarter now are offered again, with your answers from then filled in.`,
        }
      : null,
    detection: `${appLabel(d.variant)} · ${unitsLabel(a.units)}`,
    rowsLine: `${plural(a.rowCount, 'row', 'rows')}${range}`,
    willImport: { line1: `${plural(a.counts.workouts, 'workout', 'workouts')} · ${plural(a.counts.sets, 'set', 'sets')}`, line2: plural(a.counts.exercises, 'exercise', 'exercises') },
    questionsTitle: open > 0 ? `Needs your answer (${formatCount(open)})` : 'Your answers',
    questions,
    skipped,
    kept,
    effortReview,
    datesRow,
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
export function originalText(variant: FitNotesVariant, cells: readonly string[]): string {
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
  }
  if (cell('Reps') !== '') parts.push(`${cell('Reps')} reps`);
  if (cell('Distance') !== '') parts.push(`${cell('Distance')} ${cell('Distance Unit')}`.trim());
  if (cell('Time') !== '') parts.push(cell('Time'));
  const comment = header.includes('Comment') ? cell('Comment') : header.includes('Notes') ? cell('Notes') : '';
  if (comment !== '') parts.push(`“${comment}”`);
  return parts.join(' · ');
}

/** Equipment hint so `added` reads `plates` for a plate-loaded exercise (display only). */
export function loadContextFor(c: Pick<MatchCandidate, 'compatibleEquipment'> | null): LoadContext {
  return c?.compatibleEquipment.includes('plate_loaded_machine') ? { kind: 'plate_loaded_machine' } : null;
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
};

/** One row of a preview workout (§2.5 step 3d) or a results list. */
export function previewRowLines(variant: FitNotesVariant, row: FitNotesRow, fate: RowFate, candidate: MatchCandidate | null): { title: string; detail: string } {
  const original = `FitNotes row ${formatCount(row.row)}: ${originalText(variant, row.cells)}`;
  if (fate.result === 'imported') return { title: `${fate.set.exerciseName} · ${mappedSetText(fate.set, loadContextFor(candidate))}`, detail: original };
  if (fate.result === 'pending') return { title: `${row.exercise} · needs an answer`, detail: original };
  return { title: `${row.exercise} · ${fate.detail}`, detail: original };
}

/** `Row 1,204 · 2024-05-03 · Treadmill · 5 km · 25:00 — cardio isn’t imported yet` (§2.5 step 5). */
export function resultRowLine(variant: FitNotesVariant, r: ImportRow): string {
  const reason =
    r.result === 'imported'
      ? `imported${r.imported ? ` as ${r.imported.exerciseName} · ${mappedSetText(r.imported)}` : ''}${r.detail ? ` (${r.detail})` : ''}`
      : r.result === 'unreadable' || r.result === 'skipped_unsupported'
        ? (r.detail ?? SKIP_WORDS[r.result])
        : SKIP_WORDS[r.result];
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
      return { ...base, status: { icon: 'xmark.circle', tone: 'info', word: 'No match', text: 'No match' }, actions: ['choose', 'new', 'skip'], suggestionId: null };
  }
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
  lead: string;
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
    lead: 'FitNotes doesn’t record whether a dumbbell weight is one dumbbell or both together.',
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
            lead: `GymSmarter doesn’t know whether ${unknown.length === 1 ? 'this exercise uses' : 'these exercises use'} one dumbbell or two. Choose for each.`,
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
  /** Null: back to the group answer. */
  value: TotalAnswer | null;
  label: string;
  selected: boolean;
}

export interface TotalRowView {
  key: string;
  /** The FitNotes name. */
  title: string;
  /** What its newest weight imports as: `100 kg → 120 kg (plates + 20 kg bar)`, `100 kg → 100 kg total`. */
  conversion: string;
  choices: TotalChoice[];
}

export interface TotalView {
  title: string;
  lead: string;
  /** The group question, for exercises whose bar is known; null when there are none. */
  question: string | null;
  options: OptionView<TotalAnswer>[];
  example: string | null;
  barWeights: BarWeightView[];
  /** Exercises whose name doesn't establish the bar: each needs its own answer, with none pre-selected (PM decision, review r5). */
  ask: { title: string; lead: string; rows: TotalRowView[] } | null;
  /** Every other exercise with what it will import as, and a way to change it. */
  rows: { title: string; rows: TotalRowView[] } | null;
}

/**
 * `100 kg → 100 kg total`; `100 kg → 120 kg (plates + 20 kg bar)`;
 * `30 kg → EZ-bar weight needed`; `100 kg → not answered yet`.
 */
export function totalConversion(e: Pick<TotalExercise, 'reading' | 'sample' | 'bar'>): string {
  const s = e.sample;
  if (!s) return 'No weight to show';
  const from = weightText(s.value, s.unit);
  if (e.reading === null) return `${from} → not answered yet`;
  if (e.reading === 'total') return `${from} → ${from} total`;
  if (e.bar === 'unknown') return `${from} → can’t be read: which bar it uses isn’t recorded`;
  if (s.barWeight === null || s.imported === null) return `${from} → ${BAR_WORD[e.bar]} weight needed`;
  return `${from} → ${weightText(s.imported, s.unit)} (plates + ${weightText(s.barWeight, s.unit)} ${BAR_NAME[e.bar]})`;
}

function totalRow(e: TotalExercise): TotalRowView {
  const pick = (value: TotalAnswer | null, label: string): TotalChoice => ({ value, label, selected: e.override === value });
  const choices = e.known ? [pick(null, 'Same'), pick('total', 'Total'), pick('plates_only', 'Plates only')] : [pick('total', 'Total'), pick('plates_only', 'Plates only')];
  return { key: e.key, title: e.name, conversion: totalConversion(e), choices };
}

/**
 * The barbell question (§2.5 step 3b). One bar weight per bar kind and unit
 * (review S1): the Olympic bar's is always shown (20 kg / 45 lb, editable);
 * an EZ or trap bar's only once a plates-only answer needs it, and it starts
 * empty. The group answer reads exercises whose bar is known; any other is
 * asked on its own (PM decision, review r5). Every exercise shows what it
 * will import as before the import.
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
          missing: b.missing.includes(unit) ? `Enter your ${BAR_NAME[b.bar]}’s weight in ${unit}. Plates-only sets on it can’t be imported without it.` : null,
        }),
      ),
    );
  const unknown = q.exercises.filter((e) => !e.known);
  const known = q.exercises.filter((e) => e.known);
  // A lone exercise read by the group answer is fully shown by the options above it, which give its conversion (review r6 S2).
  const lone = known.length === 1 && known[0]?.override === null;
  const unit = ex?.unit ?? 'kg';
  const each = q.bars.length > 1 ? 'each bar’s own weight below is added' : null;
  const platesOnly =
    ex && ex.bar !== 'unknown' && ex.barWeight !== null && ex.platesOnly !== null
      ? `Imported as ${formatNumber(ex.platesOnly)}${NBSP}${unit} (${v} + ${weightText(ex.barWeight, unit)} ${BAR_NAME[ex.bar]})${each === null ? '' : `; ${each}`}`
      : each === null
        ? `The ${ex && ex.bar !== 'unknown' ? BAR_NAME[ex.bar] : 'bar'} weight below is added`
        : 'Each bar’s own weight below is added';
  return {
    title: 'Barbell weights',
    lead: 'FitNotes doesn’t record whether a barbell weight includes the bar.',
    question: q.grouped === 0 ? null : `For ${q.grouped === 1 ? 'this exercise' : `these ${String(q.grouped)} exercises`}, “${v}” means:`,
    options:
      q.grouped === 0
        ? []
        : [
            { value: 'total', label: 'Total, including the bar', detail: `Imported as ${v}${NBSP}${unit}`, selected: q.answer === 'total' },
            { value: 'plates_only', label: 'Plates only (bar not counted)', detail: platesOnly, selected: q.answer === 'plates_only' },
          ],
    example: ex ? `Example from your file (${dayMonthYear(ex.date, locale)}): ${ex.name}  ${v}${NBSP}×${NBSP}${String(ex.reps)}` : null,
    barWeights,
    ask:
      unknown.length === 0
        ? null
        : {
            title: 'Total or plates only?',
            // Matched by its words only: the bar isn't known, so the group answer never adds one (PM decision, review r5).
            lead: `${unknown.length === 1 ? 'This name doesn’t' : 'These names don’t'} name the bar${q.grouped > 0 ? `, so the answer above isn’t used for ${unknown.length === 1 ? 'it' : 'them'}` : ''}. Choose for each.`,
            rows: unknown.map(totalRow),
          },
    rows: known.length === 0 || lone ? null : { title: q.grouped > 0 ? 'Different for some?' : 'Each exercise', rows: known.map(totalRow) },
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
      return { icon: 'checkmark.circle.fill', tone: 'done', text: `Finished · ${plural(p.written, 'workout', 'workouts')}` };
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
  return { title: p.job.fileName, subtitle: `Imported ${shortDateOf(p.job.startedAt.utc, p.job.startedAt.tz, locale)} · ${appLabel(p.job.variant)}`, line: stateLine(p, locale) };
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
};

export function resultsView(p: PastImport & { rows: readonly ImportRow[] }, locale?: string): ResultsView {
  const sets = p.rows.filter((r) => r.result === 'imported').length;
  const order: Exclude<ImportRowResult, 'imported'>[] = ['skipped_cardio', 'skipped_unsupported', 'unreadable', 'skipped_date_exists', 'skipped_duplicate', 'skipped_exercise'];
  const skipped = order.flatMap((result) => {
    const rows = p.rows.filter((r) => r.result === result);
    return rows.length === 0 ? [] : [{ result, title: SKIP_TITLE[result](rows.length), lines: rows.map((r) => resultRowLine(p.job.variant, r)) }];
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
    message: `${plural(p.written, 'workout', 'workouts')} from ${p.job.fileName} will be hidden from history, Progress and targets. Your other workouts aren’t touched.`,
  };
}

export function undoneToast(workouts: number): string {
  return `${plural(workouts, 'workout', 'workouts')} hidden. You can import the file again.`;
}

/** History set detail (§5 Provenance). */
export function provenanceLines(p: ImportedSetProvenance, locale?: string): { source: string; original: string } {
  const date = longDate(localDateOf(toMs(p.importedAt.utc), p.importedAt.tz), locale);
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
  const p = provenanceLines({ fileName: job.fileName, importedAt: job.startedAt, variant: job.variant, row, header: job.header }, locale);
  // The set as it came in, labelled so: a set corrected in the app since isn't shown here (review r2 N3).
  const set = row.imported;
  const title = set ? `${set.exerciseName} · imported as ${mappedSetText(set)}` : row.exerciseName;
  return { title, source: row.detail ? `${p.source} · ${row.detail}` : p.source, original: p.original };
}
