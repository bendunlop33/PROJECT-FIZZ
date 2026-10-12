import {
  BUILD_LIMITS,
  COACH_DRAFT_DAYS,
  FIT_MINUTES,
  MAX_WORKOUT_DRAFT_OPS,
  MAX_WORKOUT_DRAFT_VERSIONS,
  type BuildCheck,
  type BuildFocus,
  type DraftPlan,
  type DraftSetTemplate,
  type DraftSlot,
  type Exercise,
  type PainFlag,
  type ProposeWorkoutArgs,
  type ProposedExercise,
  type RepRange,
  type Routine,
  type RoutineExercise,
  type SetTemplate,
  type TodayEdit,
  type WorkoutDraft,
  type WorkoutDraftVersion,
  type ZonedTimestamp,
} from '@fizz/schemas';
import { builtInRepRange, builtInTargetRpe, ruleCategory } from '../default-rule';
import { dayMonthText, EQUIPMENT_WORD, formatDuration, repRangeText } from '../display';
import { needsNoEquipment } from '../exercise-equipment';
import { PAIN_AREA_WORD, painFlagCovering } from '../pain-flags';
import type { HistorySession } from '../progression';
import { deriveId } from '../stable';
import { toIso, toMs } from '../time';
import { defaultMain, type RoutineStartInput } from './routines';
import { substituteTargets, type SubstituteContext } from './substitutes';
import type { SwapPlan } from './swap-plan';
import { liveEdits, planWithTodayEdits, type TodayEditsInput, type TodayPlanOutput } from './today-edits';
import { PACE_DEFAULT_CHANGEOVER_S, PACE_DEFAULT_SET_S } from './duration';

/**
 * Coach-built workouts (workout-builder.md v1.0). Pure.
 *
 * - `parseRequestedMinutes` / `parseRequestedFocus`: code reads the length
 *   and focus from Ben's words or chips; the model's reading is never used
 *   (BD11, WB2).
 * - `checkWorkoutProposal`: the model's `propose_workout` arguments checked
 *   against the selected gym, pain flags and the §8.3 limits (BD9). Never
 *   sets a load: loads come from history at planning time (BD6).
 * - `draftAsRoutine` / `planCoachDraft`: a draft version as a transient,
 *   routine-shaped plan through the **unchanged** planner
 *   (`planWithTodayEdits`), so the overview's dry run, Today's row and Start
 *   share one path (OV3).
 * - `diffDraftVersions`: the `DraftChangeCard` lines (BD16).
 * - The draft's lifecycle: versioned writes with op IDs (rule 5), 14 days
 *   (BD4), discard and restore, started, saved.
 *
 * Nothing here talks to a model or the network.
 */

const DAY_MS = 86_400_000;

// ---------------------------------------------------------------------------
// Request parsing (§8.2: deterministic, Ben's own words)

const WORD_NUMBERS: Readonly<Record<string, number>> = {
  fifteen: 15,
  twenty: 20,
  'twenty five': 25,
  'twenty-five': 25,
  thirty: 30,
  'thirty five': 35,
  'thirty-five': 35,
  forty: 40,
  'forty five': 45,
  'forty-five': 45,
  fifty: 50,
  sixty: 60,
  seventy: 70,
  'seventy five': 75,
  'seventy-five': 75,
  ninety: 90,
};

function clampMinutes(m: number): number | null {
  if (!Number.isFinite(m) || m <= 0) return null;
  const stepped = Math.round(m / FIT_MINUTES.step) * FIT_MINUTES.step;
  return Math.min(FIT_MINUTES.max, Math.max(FIT_MINUTES.min, stepped));
}

/** A time not meant as the workout's length: "rest 2 min", "rest less than 2 min", "between sets", "every 3 minutes". */
const NOT_LENGTH_BEFORE = /\b(?:rest|resting|rests|after|between|every|break|breaks)\s*(?:of |for |about |around |roughly |like |under |over |up to |(?:no )?(?:less|more|longer|shorter) than )?$/;
/**
 * Review r2 B1: "in N" is a start time only straight after a leave/train/start
 * verb ("I train in 2 hours", "leaving in 40 min", "be there in 30"). Any other
 * "in N" ("a workout I can do in 45 minutes", "fits in an hour", "in less than
 * 40 minutes") is the length. Review r3 S2: so is "gym in N" ("I'm at the gym
 * in 20", "I get to the gym in 40 minutes", ", gym in 40 min"), but not "a push
 * for this gym in 45 minutes".
 */
const START_TIME_BEFORE = /(?:(?:^|[,;.:!?]\s*|\band |\bthen )gym|\b(?:train|training|leave|leaving|start|starting|be there|get there|getting there|arrive|arriving|(?:go|going|head|heading)(?: out| off| over)?(?: to the gym)?|(?:i['’]m|im|i am|i['’]ll be|ill be|i will be|we['’]re|we['’]ll be|be|being) (?:at|in) the gym|(?:get|gets|getting|got) to the gym))\s+in\s*(?:about |around |roughly )?$/;
const NOT_LENGTH_AFTER = /^\s*(?:of )?(?:rest|resting|between|break|breaks|off|from now|later|ago|before|after|each|per)\b/;
/** A length that names the workout: "45 min push workout", "an hour session", "60 minutes long". */
const LENGTH_NAMES_WORKOUT = /^\s*(?:long\b|(?:[a-z]+[ -]){0,3}?(?:workout|work-out|session|routine|circuit)s?\b)/;

/**
 * The length Ben asked for, in minutes (stepped to 5, 15–180), or null when
 * his words name none. Only a number with a time word counts: "45-minute
 * push", "45 min", "an hour", "half an hour", "hour and a half", "1.5
 * hours". A number for a load, reps or distance ("bench at 200 kg", "3
 * sets", "400m") is never read as minutes (rule 8: the words are data).
 * Review S3: a time for rest or for when ("rest 2 min between sets", "I train
 * in 2 hours") isn't the length, but "in 45 minutes" after anything else is; a length next to workout, session or long
 * wins, else the longest one named.
 */
export function parseRequestedMinutes(text: string): number | null {
  const t = text.toLowerCase().replace(/[‐-―]/g, '-').replace(/\s+/g, ' ');
  const found: { minutes: number; start: number; end: number }[] = [];
  const take = (re: RegExp, minutes: (m: RegExpExecArray) => number): void => {
    for (const m of t.matchAll(new RegExp(re.source, 'g'))) {
      const start = m.index;
      const end = start + m[0].length;
      if (found.some((f) => start < f.end && end > f.start)) continue;
      found.push({ minutes: minutes(m), start, end });
    }
  };
  take(/\b(?:(?:an?|one) )?hour and a half\b|\bninety minutes?\b/, () => 90);
  take(/\bhalf (?:an )?hour\b/, () => 30);
  take(/\b(\d+(?:\.\d+)?) ?-? ?(?:hours?|hrs?|hr)\b/, (m) => Number(m[1]) * 60);
  take(/\b(?:an|one) hour\b/, () => 60);
  take(/\b(\d{1,3}) ?-? ?(?:minutes?|mins?|min)\b/, (m) => Number(m[1]));
  for (const [word, n] of Object.entries(WORD_NUMBERS).sort((a, b) => b[0].length - a[0].length)) {
    take(new RegExp(`\\b${word.replace(' ', '[ -]')} ?-? ?(?:minutes?|mins?|min)\\b`), () => n);
  }
  const lengths = found.filter((f) => {
    const before = t.slice(0, f.start);
    return !NOT_LENGTH_BEFORE.test(before) && !START_TIME_BEFORE.test(before) && !NOT_LENGTH_AFTER.test(t.slice(f.end));
  });
  if (lengths.length === 0) return null;
  const named = lengths.filter((f) => LENGTH_NAMES_WORKOUT.test(t.slice(f.end)));
  const pool = named.length > 0 ? named : lengths;
  return clampMinutes(Math.max(...pool.map((f) => f.minutes)));
}

/** The focus Ben asked for, or null (the coach picks). */
export function parseRequestedFocus(text: string): Exclude<BuildFocus, 'coach_picks'> | null {
  const t = text.toLowerCase();
  if (/\bfull[ -]?body\b|\bwhole[ -]body\b/.test(t)) return 'full_body';
  if (/\bupper(?:[ -]?body)?\b/.test(t)) return 'upper';
  if (/\blower(?:[ -]?body)?\b(?! (?:the|it|weight|load|reps?|sets?)\b)/.test(t) && !/\blower (?:it|the|my)\b/.test(t)) return 'lower';
  if (/\bpush(?:es)?\b(?! (?:me|harder|it)\b)/.test(t)) return 'push';
  if (/\bpull(?:s)?\b(?! (?:it|that)\b)/.test(t) && !/\bpull[ -]?ups?\b/.test(t)) return 'pull';
  if (/\blegs?\b(?: day| session| workout)?/.test(t) && !/\bleg (?:press|curl|extension|raise)s?\b/.test(t)) return 'legs';
  return null;
}

const FOCUS_WORD: Readonly<Record<BuildFocus, string | null>> = {
  coach_picks: null,
  push: 'push',
  pull: 'pull',
  legs: 'legs',
  upper: 'upper body',
  lower: 'lower body',
  full_body: 'full body',
};

const FOCUS_TITLE: Readonly<Record<BuildFocus, string>> = {
  coach_picks: 'Workout',
  push: 'Push',
  pull: 'Pull',
  legs: 'Legs',
  upper: 'Upper',
  lower: 'Lower',
  full_body: 'Full body',
};

/** Ben's message from the Build card's chips (§4.1, §7): `Build a 45 min push workout`, `Build a workout`. */
export function buildRequestText(req: { minutes: number | null; focus: BuildFocus }): string {
  const parts = [req.minutes === null ? null : `${String(req.minutes)} min`, FOCUS_WORD[req.focus]].filter((x): x is string => x !== null);
  return parts.length === 0 ? 'Build a workout' : `Build a ${parts.join(' ')} workout`;
}

/** The draft's name, made by code (BD2): `Push · 45 min`, `Workout · 45 min`. */
export function draftName(focus: BuildFocus, minutes: number): string {
  return `${FOCUS_TITLE[focus]} · ${String(minutes)} min`;
}

/** The pending card's title (§4.2): `Building Push · 45 min`. */
export function buildingTitle(focus: BuildFocus, minutes: number): string {
  return `Building ${draftName(focus, minutes)}`;
}

/** The length a build uses: Ben's words, else his session length (Goals & schedule, when set), else 60 (§8.2). */
export function resolveBuildMinutes(fromWords: number | null, sessionLength: number | null): number {
  return fromWords ?? clampMinutes(sessionLength ?? 60) ?? 60;
}

/**
 * The working-set budget the coach is asked to stay within for a length
 * (BD11): the length over one set at the default pace with its changeover
 * (`PACE_DEFAULT_SET_S` + `PACE_DEFAULT_CHANGEOVER_S`, ≈ 2:45 a set). The
 * fit trims what's over anyway; this only keeps the first answer close.
 */
export function buildSetBudget(minutes: number): number {
  return Math.max(4, Math.floor((minutes * 60) / (PACE_DEFAULT_SET_S + PACE_DEFAULT_CHANGEOVER_S)));
}

// ---------------------------------------------------------------------------
// Checks (`checkWorkoutProposal`, BD9 and §8.3)

export interface WorkoutProposalContext {
  /** Ben's exercise (else the catalogue's row) for a catalogue key, or null when it isn't one. */
  exerciseFor(catalogueId: string): Exercise | null;
  /** Usable at the selected gym today (an item for it here; not marked busy). */
  usable(exercise: Exercise): boolean;
  /** The top same-pattern substitute usable here and not pain-flagged (`rankSubstitutions[0]`), else null. */
  substituteFor(exercise: Exercise): Exercise | null;
  /** Active pain flags (rule 9): a flagged movement is left out, never substituted. */
  painFlags: readonly PainFlag[];
  nowMs: number;
  tz: string;
  /** Ben's rest presets in seconds (profile); empty: rest is only clamped. */
  restPresetsS: readonly number[];
  /** The built-in rule's rep range for the exercise's history with this many working sets (BD8), or null with no history. */
  ruleReps(exercise: Exercise, workingSets: number): RepRange | null;
  /** The previous version's plan (BD16): a slot for the same exercise keeps its key, so today's edits carry over. */
  previous: DraftPlan | null;
  /** A new slot's key (stable for the same operation). */
  newSlotKey(exerciseId: string, index: number): string;
}

export type WorkoutProposalCheck =
  | { status: 'ok' | 'partial'; plan: DraftPlan; checks: BuildCheck[] }
  | { status: 'unusable'; plan: null; checks: BuildCheck[] };

const L = BUILD_LIMITS;

/** `landmine-twist` → `Landmine twist`: a key the app doesn't know, shown as words (it's data). */
function keyWords(key: string): string {
  const words = key.replace(/[^a-z0-9-]/gi, '').split('-').filter((w) => w.length > 0).join(' ').slice(0, 60);
  return words.length === 0 ? 'Exercise' : words.charAt(0).toUpperCase() + words.slice(1);
}

function clampInt(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(v)));
}

/** RPE in half steps inside 5–10. */
function clampRpe(v: number): number {
  return Math.min(L.maxRpe, Math.max(L.minRpe, Math.round(v * 2) / 2));
}

/** The built-in rule's target RPE for an exercise (BD7's fallback). */
export function ruleRpeFor(exercise: Exercise): number {
  return builtInTargetRpe(ruleCategory(exercise, null, exercise.defaultLoadConvention));
}

function ruleRangeFor(exercise: Exercise): RepRange {
  return builtInRepRange(ruleCategory(exercise, null, exercise.defaultLoadConvention));
}

/** The nearest preset; a tie goes to the shorter one. */
function nearestPreset(seconds: number, presets: readonly number[]): number {
  let best = seconds;
  let gap = Infinity;
  for (const p of [...presets].sort((a, b) => a - b)) {
    const d = Math.abs(p - seconds);
    if (d < gap) {
      gap = d;
      best = p;
    }
  }
  return best;
}

function equipmentWordOf(exercise: Exercise): string {
  const kind = exercise.compatibleEquipment[0];
  if (kind === undefined) return 'equipment';
  if (kind === 'bodyweight_station') return `${exercise.name.toLowerCase()} station`;
  const word = kind in EQUIPMENT_WORD ? EQUIPMENT_WORD[kind as keyof typeof EQUIPMENT_WORD] : kind.replaceAll('_', ' ');
  return word.toLowerCase();
}

interface Pending {
  exercise: Exercise;
  catalogueId: string;
  slot: Omit<DraftSlot, 'order' | 'main' | 'supersetGroup' | 'slotKey'>;
  superset: 'A' | 'B' | 'C' | null;
}

/**
 * `checkWorkoutProposal(args, ctx)` (§8.2, BD9). In order, per exercise:
 * unknown → left out; a duplicate → left out; pain-flagged → left out,
 * never substituted (rule 9); not usable here → the top same-pattern
 * substitute, else left out (rule 4); then sets, reps or work time, RPE
 * and rest clamped to §8.3 with a check line each; a missing RPE is the
 * rule's (BD7). Supersets with fewer than 2 or more than 4 members, or not
 * in a row, are ungrouped. Every line is app text. `unusable`: nothing left.
 */
export function checkWorkoutProposal(args: ProposeWorkoutArgs, ctx: WorkoutProposalContext): WorkoutProposalCheck {
  const checks: BuildCheck[] = [];
  const pending: Pending[] = [];
  const add = (c: Omit<BuildCheck, 'text'> & { text: string }): void => {
    checks.push({ ...c, text: c.text.slice(0, 200) });
  };
  for (const p of args.exercises.slice(0, L.maxExercises)) {
    let exercise = ctx.exerciseFor(p.catalogueId);
    if (exercise === null) {
      add({ kind: 'unknown', catalogueId: p.catalogueId, exerciseId: null, text: `${keyWords(p.catalogueId)} left out · not in your exercises`, leftOut: true });
      continue;
    }
    if (exercise.measurement !== 'reps' && exercise.measurement !== 'duration') {
      add({ kind: 'shape', catalogueId: p.catalogueId, exerciseId: exercise.id, text: `${exercise.name} left out · distance isn't planned here`, leftOut: true });
      continue;
    }
    const flag = painFlagCovering(ctx.painFlags, exercise.id, ctx.nowMs, ctx.tz)?.flag ?? null;
    if (flag !== null) {
      const area = flag.area === null ? null : PAIN_AREA_WORD[flag.area];
      add({ kind: 'pain', catalogueId: p.catalogueId, exerciseId: exercise.id, text: `${exercise.name} left out · ${area === null ? '' : `${area} `}flagged ${dayMonthText(flag.reportedAt.utc, flag.reportedAt.tz)}`, leftOut: true });
      continue;
    }
    if (!ctx.usable(exercise)) {
      const sub = ctx.substituteFor(exercise);
      const subFlagged = sub !== null && painFlagCovering(ctx.painFlags, sub.id, ctx.nowMs, ctx.tz) !== null;
      if (sub === null || subFlagged || !ctx.usable(sub) || pending.some((x) => x.exercise.id === sub.id)) {
        add({ kind: 'not_here_left_out', catalogueId: p.catalogueId, exerciseId: exercise.id, text: `${exercise.name} left out · nothing similar here`, leftOut: true });
        continue;
      }
      add({ kind: 'not_here_swapped', catalogueId: p.catalogueId, exerciseId: sub.id, text: `${exercise.name} swapped for ${sub.name} · no ${needsNoEquipment(exercise) ? 'space' : equipmentWordOf(exercise)} here`, leftOut: false });
      exercise = sub;
    }
    const ex = exercise;
    if (pending.some((x) => x.exercise.id === ex.id)) {
      add({ kind: 'duplicate', catalogueId: p.catalogueId, exerciseId: ex.id, text: `${ex.name} left out · listed twice`, leftOut: true });
      continue;
    }
    pending.push({ exercise: ex, catalogueId: ex.catalogueKey ?? p.catalogueId, slot: shapeOf(p, ex, ctx, add), superset: p.superset });
  }
  if (pending.length === 0) return { status: 'unusable', plan: null, checks };

  // Supersets (BD9): adjacent members sharing a letter, 2–4 of them; anything else is ungrouped.
  const groups = new Map<string, number[]>();
  pending.forEach((x, i) => {
    if (x.superset !== null) groups.set(x.superset, [...(groups.get(x.superset) ?? []), i]);
  });
  const keep = new Set<string>();
  for (const [letter, at] of groups) {
    const inRow = at.every((v, k) => k === 0 || v === (at[k - 1] ?? -2) + 1);
    if (inRow && at.length >= L.minSuperset && at.length <= L.maxSuperset) keep.add(letter);
    else add({ kind: 'ungrouped', catalogueId: null, exerciseId: null, text: `Superset ungrouped · needs ${String(L.minSuperset)}–${String(L.maxSuperset)} exercises in a row`, leftOut: false });
  }
  const used = new Set<string>();
  const main = defaultMain(
    pending.map((x) => ({ exerciseId: x.exercise.id })),
    (id) => pending.find((x) => x.exercise.id === id)?.exercise.mechanic === 'compound',
  );
  const slots: DraftSlot[] = pending.map((x, i) => {
    const prior = ctx.previous?.slots.find((s) => s.exerciseId === x.exercise.id && !used.has(s.slotKey)) ?? null;
    const slotKey = prior?.slotKey ?? ctx.newSlotKey(x.exercise.id, i);
    used.add(slotKey);
    return { slotKey, exerciseId: x.exercise.id, catalogueId: x.catalogueId, order: i, main: main[i] ?? false, supersetGroup: x.superset !== null && keep.has(x.superset) ? x.superset : null, setTemplates: x.slot.setTemplates };
  });
  const leftOut = checks.some((c) => c.leftOut);
  return { status: leftOut ? 'partial' : 'ok', plan: { slots }, checks };
}

/** One exercise's sets, clamped to §8.3, each change with its check line. */
function shapeOf(p: ProposedExercise, ex: Exercise, ctx: WorkoutProposalContext, add: (c: BuildCheck) => void): Pick<DraftSlot, 'exerciseId' | 'catalogueId' | 'setTemplates'> {
  const note = (kind: BuildCheck['kind'], text: string): void => {
    add({ kind, catalogueId: p.catalogueId, exerciseId: ex.id, text, leftOut: false });
  };
  const working = clampInt(p.workingSets, L.minWorkingSets, L.maxWorkingSets);
  if (working !== p.workingSets) note('clamped', `${ex.name} · sets ${String(p.workingSets)} → ${String(working)} (${working === L.maxWorkingSets ? 'most' : 'fewest'} allowed)`);
  const warmups = clampInt(p.warmups ?? 0, 0, L.maxWarmups);
  if (p.warmups !== null && warmups !== p.warmups) note('clamped', `${ex.name} · warm-ups ${String(p.warmups)} → ${String(warmups)} (most allowed)`);

  // Reps or work time, as the exercise is measured.
  const timed = ex.measurement === 'duration';
  let reps: RepRange | null = null;
  let durationS: number | null = null;
  if (timed) {
    const asked = p.workSeconds;
    durationS = clampInt(asked ?? 45, L.minWorkS, L.maxWorkS);
    if (asked === null) note('shape', `${ex.name} · work time missing · ${formatDuration(durationS)} used`);
    else if (durationS !== asked) note('clamped', `${ex.name} · work ${formatDuration(asked)} → ${formatDuration(durationS)}`);
  } else if (p.reps === null) {
    reps = ruleRangeFor(ex);
    note('shape', `${ex.name} · reps missing · ${repRangeText(reps)} used`);
  } else {
    const lo = Math.min(p.reps.min, p.reps.max);
    const hi = Math.max(p.reps.min, p.reps.max);
    reps = { min: clampInt(lo, L.minReps, L.maxReps), max: clampInt(hi, L.minReps, L.maxReps) };
    if (reps.min !== p.reps.min || reps.max !== p.reps.max) note('clamped', `${ex.name} · reps ${repRangeText(p.reps)} → ${repRangeText(reps)}`);
  }

  // Target RPE on every working set (BD7): the coach's, else the rule's.
  const ruleRpe = ruleRpeFor(ex);
  let rpe: number;
  if (p.targetRpe === null) {
    rpe = ruleRpe;
    note('rpe_missing', `${ex.name} · RPE missing · ${String(rpe)} used`);
  } else {
    rpe = clampRpe(p.targetRpe);
    if (rpe !== p.targetRpe) note('clamped', `${ex.name} · RPE ${String(p.targetRpe)} → ${String(rpe)}`);
  }

  // Rest: Ben's nearest preset, then clamped to the draft's limits.
  // Review r2 S1: snap first so an out-of-range preset (6:00) can't drag 5:00 down to 1:30.
  let restS: number | null = null;
  if (p.restSeconds !== null) {
    const snapped = ctx.restPresetsS.length > 0 ? nearestPreset(p.restSeconds, ctx.restPresetsS) : p.restSeconds;
    restS = clampInt(snapped, L.minRestS, L.maxRestS);
    if (restS !== p.restSeconds) note('rest_snapped', `Rest ${formatDuration(p.restSeconds)} → ${formatDuration(restS)}${ctx.restPresetsS.includes(restS) ? ' (your presets)' : ''}`);
  }

  // BD8: reps differ from what the history plans; the load isn't re-scaled.
  if (reps !== null) {
    const rule = ctx.ruleReps(ex, working);
    if (rule !== null && (rule.min !== reps.min || rule.max !== reps.max)) note('reps_changed', `${ex.name} · reps changed from last time · load not adjusted`);
  }

  const templates: DraftSetTemplate[] = [];
  for (let i = 0; i < warmups; i += 1) templates.push({ setType: 'warmup', reps: timed ? null : { min: 5, max: 5 }, durationS: timed ? (durationS ?? 45) : null, targetRpe: null, restS });
  if (p.topSet !== null && timed) note('shape', `${ex.name} · top set left out (timed)`);
  if (p.topSet !== null && !timed) {
    const lo = Math.min(p.topSet.reps.min, p.topSet.reps.max);
    const hi = Math.max(p.topSet.reps.min, p.topSet.reps.max);
    const topReps = { min: clampInt(lo, L.minReps, L.maxReps), max: clampInt(hi, L.minReps, L.maxReps) };
    // Review S9: every clamp has its line (WB13), and the top set counts against the set limit.
    if (topReps.min !== p.topSet.reps.min || topReps.max !== p.topSet.reps.max) note('clamped', `${ex.name} · top set reps ${repRangeText(p.topSet.reps)} → ${repRangeText(topReps)}`);
    const topRpe = p.topSet.targetRpe === null ? rpe : clampRpe(p.topSet.targetRpe);
    if (p.topSet.targetRpe !== null && topRpe !== p.topSet.targetRpe) note('clamped', `${ex.name} · top set RPE ${String(p.topSet.targetRpe)} → ${String(topRpe)}`);
    const backoffs = Math.min(working, L.maxWorkingSets - 1);
    if (backoffs !== working) note('clamped', `${ex.name} · sets ${String(working + 1)} → ${String(backoffs + 1)} with the top set (most allowed)`);
    templates.push({ setType: 'top', reps: topReps, durationS: null, targetRpe: topRpe, restS });
    for (let i = 0; i < backoffs; i += 1) templates.push({ setType: 'backoff', reps, durationS: null, targetRpe: rpe, restS });
  } else {
    for (let i = 0; i < working; i += 1) templates.push({ setType: 'working', reps, durationS, targetRpe: rpe, restS });
  }
  return { exerciseId: ex.id, catalogueId: ex.catalogueKey ?? p.catalogueId, setTemplates: templates };
}

/** The draft's exercises left out by a check (`⚠ 1 left out`). */
export function leftOutCount(checks: readonly BuildCheck[]): number {
  return checks.filter((c) => c.leftOut).length;
}

// ---------------------------------------------------------------------------
// The draft as a plan (`draftAsRoutine`, `planCoachDraft`; BD2, BD6, BD11)

/** The current version (the draft is invalid without one). */
export function currentDraftVersion(draft: Pick<WorkoutDraft, 'versions' | 'currentVersion'>): WorkoutDraftVersion {
  const v = draft.versions.find((x) => x.n === draft.currentVersion);
  if (v === undefined) throw new Error('The draft has no current version');
  return v;
}

/** A slot's working-set count (top and back-offs count; warm-ups don't). */
export function draftWorkingSets(slot: Pick<DraftSlot, 'setTemplates'>): number {
  return slot.setTemplates.filter((t) => t.setType !== 'warmup').length;
}

function templateOf(slotKey: string, i: number, t: DraftSetTemplate): SetTemplate {
  return {
    id: deriveId(`coach-draft-set:${slotKey}:${String(i)}`),
    setType: t.setType,
    targetLoad: null,
    targetReps: t.reps,
    targetDurationS: t.durationS,
    targetRpe: t.targetRpe,
    targetRir: null,
    restOverrideS: t.restS,
  };
}

/** The routine ID a draft is planned under (never stored as a routine; the session gets none). */
export function coachDraftRoutineId(draftId: string): string {
  return deriveId(`coach-draft-routine:${draftId}`);
}

/**
 * `draftAsRoutine` (§8.2): a version as a transient `Routine` (`source:
 * 'coach'`, every load `Auto`) for the unchanged planner. Never stored.
 * Slot keys are the `RoutineExercise.id`s, so today's edits point at them.
 */
export function draftAsRoutine(draft: Pick<WorkoutDraft, 'id' | 'ownerId' | 'name' | 'createdAt' | 'updatedAtUtc' | 'version'>, version: WorkoutDraftVersion): Routine {
  const exercises: RoutineExercise[] = [...version.plan.slots]
    .sort((a, b) => a.order - b.order)
    .map((s, i) => ({
      id: s.slotKey,
      exerciseId: s.exerciseId,
      equipmentId: null,
      order: i,
      supersetGroup: s.supersetGroup,
      setTemplates: s.setTemplates.map((t, k) => templateOf(s.slotKey, k, t)),
      restBySetType: {},
      transitionRestS: null,
      progressionRuleId: null,
      main: s.main,
      structureChangedAtUtc: version.createdAt.utc,
    }));
  return {
    id: coachDraftRoutineId(draft.id),
    ownerId: draft.ownerId,
    version: draft.version,
    createdAtUtc: draft.createdAt.utc,
    updatedAtUtc: draft.updatedAtUtc,
    name: draft.name,
    exercises,
    createdFromSessionId: null,
    source: 'coach',
    inRotation: false,
  };
}

/** The synthetic fit edit a draft's `fitMinutes` acts as (BD11), when today has no fit edit of its own. */
export function draftFitEdit(draftId: string, version: WorkoutDraftVersion): TodayEdit {
  return {
    editId: deriveId(`coach-draft-fit:${draftId}:${String(version.n)}`),
    opId: `coach-draft-fit:${draftId}:${String(version.n)}`,
    atUtc: version.createdAt.utc,
    replacesEditId: null,
    removed: null,
    kind: 'fit',
    minutes: version.fitMinutes,
  };
}

/** Today's edits with the draft's own fit added unless a fit edit (Ben's, or his `Clear fit`) is live. */
export function withDraftFit(edits: readonly TodayEdit[], draftId: string, version: WorkoutDraftVersion): TodayEdit[] {
  return liveEdits(edits).some((e) => e.kind === 'fit') ? [...edits] : [...edits, draftFitEdit(draftId, version)];
}

export interface CoachDraftPlanInput {
  draft: WorkoutDraft;
  /** The start input without the routine and targets (owner, gym, exercises, items, time, IDs). */
  start: Omit<RoutineStartInput, 'routine' | 'targets'>;
  /** Each draft exercise's history (Ben's finished workouts). */
  histories: ReadonlyMap<string, readonly HistorySession[]>;
  /** `substituteTargets`' context at the selected gym (pain flags, check-in pain, items). */
  substitute: SubstituteContext;
  /** Today's edits on the draft (pre-start draft, ADR 0022). */
  today: TodayEditsInput;
}

export type CoachDraftPlan = Extract<TodayPlanOutput, { kind: 'routine' }> & { routine: Routine; version: WorkoutDraftVersion; targets: Map<string, SwapPlan> };

/**
 * `planCoachDraft` (§8.2): the one path for the overview's dry run, Today's
 * row and Start. Each slot's targets are `substituteTargets` on the
 * exercise's **own** comparable history with the slot's working-set count
 * (BD6: the same path as a swap or an add); no history → no load (B6). The
 * draft's reps, sets and RPE stay (WL7: the slot's structure wins); loads
 * are fitted by `snapPlanToGym` inside the planner. Then today's edits,
 * then the fit from `fitMinutes` unless a fit edit overrides it.
 */
export function planCoachDraft(input: CoachDraftPlanInput): CoachDraftPlan {
  const version = currentDraftVersion(input.draft);
  const routine = draftAsRoutine(input.draft, version);
  const targets = new Map<string, SwapPlan>();
  const entries = new Map<string, NonNullable<SwapPlan['plan']>>();
  for (const s of version.plan.slots) {
    const exercise = input.start.exercises.get(s.exerciseId);
    if (exercise === undefined) continue;
    const slot = { workingSets: draftWorkingSets(s), templates: s.setTemplates.map((t) => ({ setType: t.setType, reps: t.reps, durationS: t.durationS })) };
    const plan = substituteTargets(slot, exercise, input.histories.get(exercise.id) ?? [], input.substitute);
    targets.set(s.exerciseId, plan);
    if (plan.plan !== null && plan.plan.length > 0) entries.set(s.exerciseId, plan.plan);
  }
  // The history's item is the slot's pin, so the shared fit maps the same kind (GS3), as for a swap.
  const pinned: Routine = {
    ...routine,
    exercises: routine.exercises.map((rex) => {
      const pin = targets.get(rex.exerciseId)?.pin ?? null;
      return pin === null ? rex : { ...rex, equipmentId: pin.id };
    }),
  };
  const known = new Map(input.start.knownEquipment);
  for (const t of targets.values()) if (t.pin !== null && !known.has(t.pin.id)) known.set(t.pin.id, t.pin);
  const edits = withDraftFit(input.today.edits, input.draft.id, version);
  const out = planWithTodayEdits({ kind: 'routine', input: { ...input.start, knownEquipment: known, routine: pinned, targets: entries } }, { ...input.today, edits });
  // A coach draft isn't a routine: the session names the draft, never a routine (rotation untouched, §6.3).
  const aggregate = {
    ...out.aggregate,
    session: { ...out.aggregate.session, routineId: null, routineName: input.draft.name, coachDraft: { draftId: input.draft.id, version: version.n, name: input.draft.name } },
  };
  return { ...out, aggregate, routine: pinned, version, targets };
}

// ---------------------------------------------------------------------------
// Versions (`diffDraftVersions`, BD16)

export interface DraftDiff {
  added: DraftSlot[];
  removed: DraftSlot[];
  changed: { slotKey: string; exerciseId: string; fields: ('sets' | 'reps' | 'rpe' | 'rest' | 'warmups' | 'superset')[]; setsFrom: number; setsTo: number }[];
  reordered: boolean;
}

function workingReps(s: DraftSlot): RepRange | null {
  return s.setTemplates.find((t) => t.setType !== 'warmup' && t.setType !== 'top')?.reps ?? null;
}

function workingRpe(s: DraftSlot): number | null {
  return s.setTemplates.find((t) => t.setType !== 'warmup' && t.setType !== 'top')?.targetRpe ?? null;
}

/** `diffDraftVersions(a, b)` (§8.2): what b added, removed and changed against a, by exercise. */
export function diffDraftVersions(a: DraftPlan, b: DraftPlan): DraftDiff {
  const inA = new Map(a.slots.map((s) => [s.exerciseId, s]));
  const inB = new Map(b.slots.map((s) => [s.exerciseId, s]));
  const added = b.slots.filter((s) => !inA.has(s.exerciseId));
  const removed = a.slots.filter((s) => !inB.has(s.exerciseId));
  const changed: DraftDiff['changed'] = [];
  for (const s of b.slots) {
    const was = inA.get(s.exerciseId);
    if (was === undefined) continue;
    const fields: DraftDiff['changed'][number]['fields'] = [];
    const setsFrom = draftWorkingSets(was);
    const setsTo = draftWorkingSets(s);
    if (setsFrom !== setsTo) fields.push('sets');
    const ra = workingReps(was);
    const rb = workingReps(s);
    if ((ra === null) !== (rb === null) || (ra !== null && rb !== null && (ra.min !== rb.min || ra.max !== rb.max))) fields.push('reps');
    if (workingRpe(was) !== workingRpe(s)) fields.push('rpe');
    if (was.setTemplates.filter((t) => t.setType === 'warmup').length !== s.setTemplates.filter((t) => t.setType === 'warmup').length) fields.push('warmups');
    if ((was.setTemplates[0]?.restS ?? null) !== (s.setTemplates[0]?.restS ?? null)) fields.push('rest');
    if ((was.supersetGroup === null) !== (s.supersetGroup === null)) fields.push('superset');
    if (fields.length > 0) changed.push({ slotKey: s.slotKey, exerciseId: s.exerciseId, fields, setsFrom, setsTo });
  }
  const commonA = a.slots.filter((s) => inB.has(s.exerciseId)).map((s) => s.exerciseId);
  const commonB = b.slots.filter((s) => inA.has(s.exerciseId)).map((s) => s.exerciseId);
  return { added, removed, changed, reordered: commonA.some((id, i) => commonB[i] !== id) };
}

/** A slot's scheme as the card says it: `4 × 8–10`, `3 × 0:45`. */
export function draftSchemeText(s: DraftSlot): string {
  const n = draftWorkingSets(s);
  const t = s.setTemplates.find((x) => x.setType !== 'warmup');
  const what = t === undefined ? '' : t.reps !== null ? repRangeText(t.reps) : formatDuration(t.durationS ?? 0);
  return `${String(n)} × ${what}`;
}

/** The `DraftChangeCard` lines (§5.3): `− Barbell bench press`, `+ DB bench press · 4 × 8–10`, `✎ Incline DB press · 3 → 2 sets`. */
export function draftDiffLines(diff: DraftDiff, nameOf: (exerciseId: string) => string): { change: 'add' | 'remove' | 'edit' | 'reorder'; text: string }[] {
  const out: { change: 'add' | 'remove' | 'edit' | 'reorder'; text: string }[] = [];
  for (const s of diff.removed) out.push({ change: 'remove', text: `− ${nameOf(s.exerciseId)}` });
  for (const s of diff.added) out.push({ change: 'add', text: `+ ${nameOf(s.exerciseId)} · ${draftSchemeText(s)}` });
  for (const c of diff.changed) {
    const what = c.fields.includes('sets') ? `${String(c.setsFrom)} → ${String(c.setsTo)} sets` : c.fields.map((f) => (f === 'rpe' ? 'RPE' : f === 'warmups' ? 'warm-ups' : f)).join(', ');
    out.push({ change: 'edit', text: `✎ ${nameOf(c.exerciseId)} · ${what}` });
  }
  if (diff.reordered && diff.added.length === 0 && diff.removed.length === 0) out.push({ change: 'reorder', text: '✎ Order changed' });
  return out;
}

// ---------------------------------------------------------------------------
// Lifecycle (BD4, BD12, BD16; rule 5)

/** Created + 14 days (BD4). */
export function coachDraftExpiry(createdUtc: string): string {
  return toIso(toMs(createdUtc) + COACH_DRAFT_DAYS * DAY_MS);
}

/** Open and not past its 14 days. */
export function coachDraftIsOpen(d: Pick<WorkoutDraft, 'status' | 'expiresAtUtc'>, nowUtc: string): boolean {
  return d.status === 'open' && toMs(nowUtc) < toMs(d.expiresAtUtc);
}

/**
 * Listed under `FROM COACH` (§4.4): open, not expired, not started. Review S6: a saved draft stays
 * listed until it is started, while the never-done `Auto` rule (§11 item 1, WB16) is unapproved.
 */
export function coachDraftListed(d: Pick<WorkoutDraft, 'status' | 'expiresAtUtc'>, nowUtc: string): boolean {
  return coachDraftIsOpen(d, nowUtc);
}

export type DraftLifeChange =
  | { kind: 'write'; next: WorkoutDraft; expectedVersion: number | null }
  /** The same operation again: nothing more is written (rule 5). */
  | { kind: 'duplicate'; current: WorkoutDraft }
  /** The caller saw an older draft: nothing is written. */
  | { kind: 'stale'; current: WorkoutDraft }
  /** Started, discarded or expired: nothing is written. */
  | { kind: 'closed'; current: WorkoutDraft }
  | { kind: 'invalid'; reason: string };

function remember(opIds: readonly string[], opId: string): string[] {
  return [...opIds, opId].slice(-MAX_WORKOUT_DRAFT_OPS);
}

function bump(d: WorkoutDraft, opId: string, atUtc: string, patch: Partial<WorkoutDraft>): WorkoutDraft {
  return { ...d, ...patch, opIds: remember(d.opIds, opId), version: d.version + 1, updatedAtUtc: atUtc };
}

function guard(current: WorkoutDraft, expectedVersion: number, opId: string, nowUtc: string, needOpen = true): DraftLifeChange | null {
  if (current.opIds.includes(opId)) return { kind: 'duplicate', current };
  if (current.version !== expectedVersion) return { kind: 'stale', current };
  if (needOpen && !coachDraftIsOpen(current, nowUtc)) return { kind: 'closed', current };
  return null;
}

/** A new draft from its first checked version. */
export function newWorkoutDraft(input: { id: string; ownerId: string; version: WorkoutDraftVersion; opId: string; at: ZonedTimestamp }): WorkoutDraft {
  const v = { ...input.version, n: 1, parentN: null, status: 'current' as const };
  return {
    id: input.id,
    ownerId: input.ownerId,
    status: 'open',
    name: draftName(v.request.focus, v.fitMinutes),
    currentVersion: 1,
    versions: [v],
    sessionId: null,
    startedAtUtc: null,
    routineId: null,
    discardedAtUtc: null,
    opIds: [input.opId],
    createdAt: input.at,
    tz: input.at.tz,
    expiresAtUtc: coachDraftExpiry(input.at.utc),
    version: 1,
    updatedAtUtc: input.at.utc,
  };
}

/** A new version (BD16): current again at once, the previous one kept as `replaced`; Undo goes back. */
export function addDraftVersion(current: WorkoutDraft, input: { version: WorkoutDraftVersion; expectedVersion: number; opId: string; at: ZonedTimestamp }): DraftLifeChange {
  const g = guard(current, input.expectedVersion, input.opId, input.at.utc);
  if (g !== null) return g;
  const n = Math.max(...current.versions.map((v) => v.n)) + 1;
  const v: WorkoutDraftVersion = { ...input.version, n, parentN: current.currentVersion, status: 'current' };
  const versions = [...current.versions.map((x) => (x.status === 'current' ? { ...x, status: 'replaced' as const } : x)), v].slice(-MAX_WORKOUT_DRAFT_VERSIONS);
  if (!versions.some((x) => x.n === n)) return { kind: 'invalid', reason: 'too many versions' };
  return { kind: 'write', next: bump(current, input.opId, input.at.utc, { versions, currentVersion: n, name: draftName(v.request.focus, v.fitMinutes) }), expectedVersion: current.version };
}

/** `Undo` on a `DraftChangeCard` (§5.3): the version it replaced is current again; the newer one stays as `replaced`. */
export function undoDraftVersion(current: WorkoutDraft, input: { versionN: number; expectedVersion: number; opId: string; at: ZonedTimestamp }): DraftLifeChange {
  const g = guard(current, input.expectedVersion, input.opId, input.at.utc);
  if (g !== null) return g;
  const v = current.versions.find((x) => x.n === input.versionN);
  if (v === undefined || v.status !== 'current' || v.parentN === null) return { kind: 'stale', current };
  const parent = current.versions.find((x) => x.n === v.parentN);
  if (parent === undefined) return { kind: 'invalid', reason: 'the earlier version is gone' };
  const versions = current.versions.map((x) => (x.n === v.n ? { ...x, status: 'replaced' as const } : x.n === parent.n ? { ...x, status: 'current' as const } : x));
  return { kind: 'write', next: bump(current, input.opId, input.at.utc, { versions, currentVersion: parent.n, name: draftName(parent.request.focus, parent.fitMinutes) }), expectedVersion: current.version };
}

/** `Discard draft` (§6.2): at once, toast Undo restores it. */
export function discardWorkoutDraft(current: WorkoutDraft, input: { expectedVersion: number; opId: string; at: ZonedTimestamp }): DraftLifeChange {
  const g = guard(current, input.expectedVersion, input.opId, input.at.utc);
  if (g !== null) return g;
  return { kind: 'write', next: bump(current, input.opId, input.at.utc, { status: 'discarded', discardedAtUtc: input.at.utc }), expectedVersion: current.version };
}

/** The discard's Undo: open again if its 14 days haven't passed. */
export function restoreWorkoutDraft(current: WorkoutDraft, input: { expectedVersion: number; opId: string; at: ZonedTimestamp }): DraftLifeChange {
  const g = guard(current, input.expectedVersion, input.opId, input.at.utc, false);
  if (g !== null) return g;
  if (current.status !== 'discarded' || toMs(input.at.utc) >= toMs(current.expiresAtUtc)) return { kind: 'closed', current };
  return { kind: 'write', next: bump(current, input.opId, input.at.utc, { status: 'open', discardedAtUtc: null }), expectedVersion: current.version };
}

/**
 * `Save to Workouts` (BD12): the draft names the workout it was saved as (still open: Ben may start it). `routineId` null: the save's Undo.
 * Review S8: a link needs the draft open, and (with `versionN`) still on the version the workout was saved from.
 */
export function linkDraftRoutine(current: WorkoutDraft, input: { routineId: string | null; opId: string; at: ZonedTimestamp; versionN?: number }): DraftLifeChange {
  if (current.opIds.includes(input.opId)) return { kind: 'duplicate', current };
  if (current.routineId === input.routineId) return { kind: 'duplicate', current };
  if (input.routineId !== null && !coachDraftIsOpen(current, input.at.utc)) return { kind: 'closed', current };
  if (input.versionN !== undefined && current.currentVersion !== input.versionN) return { kind: 'stale', current };
  return { kind: 'write', next: bump(current, input.opId, input.at.utc, { routineId: input.routineId }), expectedVersion: current.version };
}

/**
 * Review r3 S1: the live workout the draft's current version was saved as, or
 * null. A workout saved from an earlier version (Ben revised the draft after
 * Save) doesn't count: `Save to Workouts` shows again and a new save moves the
 * link (ADR 0025). `routine` is the linked workout, null when it's gone or deleted.
 */
export function draftSavedRoutineId(draft: WorkoutDraft, routine: { id: string; createdFromDraft?: { draftId: string; version: number } | undefined } | null): string | null {
  if (draft.routineId === null || routine === null || routine.id !== draft.routineId) return null;
  const from = routine.createdFromDraft;
  return from !== undefined && from.draftId === draft.id && from.version === draft.currentVersion ? routine.id : null;
}

/** The 14-day expiry (BD4): open (or discarded) drafts past `expiresAtUtc` become `expired`. */
export function expireWorkoutDraft(current: WorkoutDraft, nowUtc: string): WorkoutDraft | null {
  if ((current.status !== 'open' && current.status !== 'discarded') || toMs(nowUtc) < toMs(current.expiresAtUtc)) return null;
  return { ...current, status: 'expired', version: current.version + 1, updatedAtUtc: nowUtc };
}

// ---------------------------------------------------------------------------
// The draft card (§4.2): every value from the saved draft

export type DraftCardState =
  | { kind: 'open' }
  | { kind: 'after_workout' }
  | { kind: 'started'; atUtc: string; tz: string }
  | { kind: 'saved'; routineId: string; routineName: string }
  | { kind: 'deleted' }
  | { kind: 'replaced'; byN: number };

/** Which end state a draft card shows for one of its versions (§4.2, §5.2). */
export function draftCardState(input: { draft: WorkoutDraft | null; versionN: number; nowUtc: string; workoutActive: boolean; savedName: string | null }): DraftCardState {
  const d = input.draft;
  if (d === null || d.status === 'discarded' || d.status === 'expired' || (d.status === 'open' && !coachDraftIsOpen(d, input.nowUtc))) return { kind: 'deleted' };
  if (d.status === 'started') return { kind: 'started', atUtc: d.startedAtUtc ?? d.updatedAtUtc, tz: d.tz };
  if (d.currentVersion !== input.versionN) return { kind: 'replaced', byN: d.currentVersion };
  if (d.routineId !== null && input.savedName !== null) return { kind: 'saved', routineId: d.routineId, routineName: input.savedName };
  if (input.workoutActive) return { kind: 'after_workout' };
  return { kind: 'open' };
}

/** The card's end-state text (§7), or null while `Open ›` shows. */
export function draftCardEndText(state: DraftCardState, clock: (utc: string, tz: string) => string): string | null {
  switch (state.kind) {
    case 'open':
      return null;
    case 'after_workout':
      return 'After this workout';
    case 'started':
      return `Started ${clock(state.atUtc, state.tz)}`;
    case 'saved':
      return `Saved · ${state.routineName} ›`;
    case 'deleted':
      return 'Draft deleted';
    case 'replaced':
      return `Replaced by v${String(state.byN)}`;
  }
}

/** The fixed reply to "start it" / "save it" (BD15): nothing starts or saves from chat. */
export const START_BY_TAP_LINE = "Tap Start workout when you're ready.";

/**
 * "Start it", "save it", "start the workout", "save it to my workouts" (BD15): answered with the
 * fixed line, never a tool. Review S4: only explicit start or save words. "keep it", "add it" and
 * "save that" are ordinary replies (a memory, a revision) and go to the coach; "add" or "save
 * that/this" count only with "to my workouts".
 */
export function asksToStartOrSave(text: string): boolean {
  const t = text.toLowerCase().replace(/[’]/g, "'").replace(/[.!?]+$/g, '').trim();
  const lead = '^(?:(?:ok|okay|great|cool|perfect|nice|yes|yep|sure|right)[,!.]? )*(?:(?:please|can you|could you|will you|go ahead and|just) )*';
  const tail = '(?: (?:now|for me|please))*$';
  const library = ' (?:to|in|into) (?:my )?(?:workouts|library|routines)';
  const start = new RegExp(`${lead}(?:start|begin|kick off|launch)(?: it| that| this| the (?:workout|draft|session)| my (?:workout|draft|session))?${tail}`);
  const save = new RegExp(`${lead}save(?: it| the (?:workout|draft|session)| my (?:workout|draft|session))(?:${library})?${tail}`);
  const toLibrary = new RegExp(`${lead}(?:save|store|add)(?: it| that| this| the (?:workout|draft|session))${library}${tail}`);
  return start.test(t) || save.test(t) || toLibrary.test(t);
}
