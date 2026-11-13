import type { Load, SessionAggregate, SessionCommand, SetValues, ZonedTimestamp } from '@fizz/schemas';
import { buildSetEditView } from '../session/active-view';
import { buildExecutionOrder, nextPendingSet } from '../session/order';
import { reduceSession } from '../session/reducer';
import { deriveId } from '../stable';

/**
 * Logging or correcting a set from chat (backlog §4.3, coach-sheet §2.7, CS5;
 * Ben accepted 11 Oct). Pure: checks the coach's request against the workout
 * and Ben's own words, and builds the **same session command** the Log button
 * (`log_set`) or the correction sheet (`correct_set`) would send. Nothing here
 * writes; the store runs the command and the action record in one transaction.
 *
 * Decided conservatively (11 Oct, written into coach-sheet §2.7):
 * - Only in an active workout, at the version the coach read (rule 5).
 * - The load is in the exercise's own unit and convention; anything else is
 *   refused, never converted (kg/lb, per-dumbbell, stack, assisted).
 * - Every number saved must be one Ben said in this turn ("log 100 for 8"),
 *   so a misread or invented value can't be logged. "Same as last time"
 *   isn't enough: he says the numbers or uses the Log button.
 * - Log: only the set the Log button would log (review coach-tools S3): the
 *   next pending set of the exercise in focus, or of the one exercise Ben
 *   named ("log bench 100 for 8"). Pending warm-ups before it may be passed
 *   over, as Ben often skips them; any other set is refused (`say which set`).
 * - Correct: a logged set only, values only (load,
 *   reps, RPE). Marks (pain, spotted …), set types and deletes stay in the
 *   workout's own sheets. Logging starts rest as the Log button does; a
 *   correction never touches rest.
 */

export interface ChatSetValues {
  load: Load | null;
  reps: number | null;
  rpe: number | null;
}

export type ChatSetCheck =
  | {
      status: 'ok';
      command: Extract<SessionCommand, { type: 'log_set' | 'correct_set' }>;
      setNumber: number;
      exerciseName: string;
      before: ChatSetValues;
      after: ChatSetValues;
      /** The set's version once the command has run (Undo is guarded on it). */
      setVersionAfter: number;
    }
  | { status: 'stale' | 'rejected'; failure: string; setNumber: number | null; exerciseName: string | null };

const WORD_NUMBERS: Record<string, number> = {
  zero: 0,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
  eighteen: 18,
  nineteen: 19,
  twenty: 20,
  thirty: 30,
  forty: 40,
  fifty: 50,
  sixty: 60,
  seventy: 70,
  eighty: 80,
  ninety: 90,
  hundred: 100,
};

/** Every number in Ben's words: digits (`62.5`, `62,5`), number words up to twenty and tens, `a hundred`, `twenty five`, `hundred and ten`. */
export function numbersInWords(text: string): Set<number> {
  const out = new Set<number>();
  const t = text.toLowerCase();
  for (const m of t.matchAll(/\d+(?:[.,]\d+)?/g)) out.add(Number(m[0].replace(',', '.')));
  const words = t.split(/[^a-z]+/).filter((w) => w.length > 0);
  for (let i = 0; i < words.length; i += 1) {
    const w = words[i] ?? '';
    const n = WORD_NUMBERS[w];
    if (n === undefined) continue;
    out.add(n);
    const next = WORD_NUMBERS[words[i + 1] ?? ''];
    const afterAnd = words[i + 1] === 'and' ? WORD_NUMBERS[words[i + 2] ?? ''] : undefined;
    // "twenty five" → 25; "hundred and ten" / "a hundred ten" → 110.
    if (n >= 20 && n < 100 && n % 10 === 0 && next !== undefined && next < 10) out.add(n + next);
    if (n === 100 && next !== undefined && next < 100) out.add(100 + next);
    if (n === 100 && afterAnd !== undefined && afterAnd < 100) out.add(100 + afterAnd);
  }
  return out;
}

/**
 * Whether every value is a number Ben said. The number that names a set
 * ("set 2 was 95") isn't a value he said (review N2), so it can't become the
 * reps or the load.
 */
function said(benWords: string | null, values: readonly (number | null)[], rpe: number | null = null): boolean {
  if (benWords === null) return false;
  const withoutSetNumbers = benWords.replace(/\bsets?\s+(?:no\.?\s*|number\s+)?(?:\d+|[a-z]+)\b/gi, (m) => (numbersInWords(m).size > 0 ? ' ' : m));
  const nums = numbersInWords(withoutSetNumbers);
  // (Ben, 26 Oct: RIR replaces RPE in the UI) An effort is stored as RPE; Ben may have said it as RIR (10 − RPE).
  const effortSaid = rpe === null || nums.has(rpe) || nums.has(Math.round((10 - rpe) * 100) / 100);
  return effortSaid && values.every((v) => v === null || nums.has(v));
}

const norm = (t: string): string => ` ${t.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()} `;

/** The one exercise of the workout Ben named (the longest name wins: `incline bench press` over `bench press`); null for none or several. */
function namedExercise(agg: SessionAggregate, benWords: string | null): string | null {
  if (benWords === null) return null;
  const words = norm(benWords);
  const named = agg.exercises.filter((e) => words.includes(norm(e.exerciseName)));
  const longest = named.filter((e) => !named.some((o) => o !== e && norm(o.exerciseName).length > norm(e.exerciseName).length && norm(o.exerciseName).includes(norm(e.exerciseName))));
  const ids = new Set(longest.map((e) => e.exerciseId));
  return ids.size === 1 ? ([...ids][0] ?? null) : null;
}

/**
 * The sets a chat log may land on (S3): for the exercise in focus and the one
 * Ben named, the next pending set, plus the first pending non-warm-up set when
 * only warm-ups are pending before it.
 */
export function chatLoggableSetIds(agg: SessionAggregate, benWords: string | null): Set<string> {
  const order = buildExecutionOrder(agg.exercises, agg.sets);
  const byId = new Map(agg.sets.map((x) => [x.id, x]));
  const pending = order.map((id) => byId.get(id)).filter((x): x is NonNullable<typeof x> => x !== undefined && x.status === 'pending');
  const active = agg.session.activeSetId;
  const focusId = active !== null && pending.some((x) => x.id === active) ? active : nextPendingSet(null, agg.exercises, agg.sets);
  const exerciseIdOf = (sessionExerciseId: string) => agg.exercises.find((e) => e.id === sessionExerciseId)?.exerciseId ?? null;
  const focusEx = focusId === null ? null : (exerciseIdOf(byId.get(focusId)?.sessionExerciseId ?? '') ?? null);
  const exercises = new Set([focusEx, namedExercise(agg, benWords)].filter((x): x is string => x !== null));
  const out = new Set<string>();
  if (focusId !== null) out.add(focusId);
  for (const exerciseId of exercises) {
    const own = pending.filter((x) => exerciseIdOf(x.sessionExerciseId) === exerciseId);
    const first = own[0];
    if (first === undefined) continue;
    out.add(first.id);
    const firstWorking = own.find((x) => x.setType !== 'warmup');
    if (firstWorking !== undefined) out.add(firstWorking.id);
  }
  return out;
}

function valuesOf(v: SetValues | null): ChatSetValues {
  return { load: v?.load ?? null, reps: v?.reps ?? null, rpe: v?.rpe ?? null };
}

const sameLoad = (a: Load | null, b: Load | null): boolean => (a === null || b === null ? a === b : a.value === b.value && a.unit === b.unit && a.convention === b.convention);

export interface ChatSetInput {
  aggregate: SessionAggregate | null;
  baseVersion: number;
  setId: string;
  load: Load | null;
  reps: number | null;
  rpe: number | null;
  /** Ben's own words in this turn; null for a chip (never enough to log). */
  benWords: string | null;
  opId: string;
  at: ZonedTimestamp;
}

function context(input: ChatSetInput) {
  const agg = input.aggregate;
  const set = agg?.sets.find((s) => s.id === input.setId && s.status !== 'deleted') ?? null;
  const ex = set === null ? null : (agg?.exercises.find((e) => e.id === set.sessionExerciseId) ?? null);
  const setNumber = agg !== null && set !== null ? (buildSetEditView(agg, set.id, null)?.setNumber ?? set.index + 1) : null;
  return { agg, set, ex, setNumber };
}

function unitFailure(load: Load | null, ex: { unit: string; loadConvention: string; exerciseName: string }): string | null {
  if (load === null) return null;
  if (load.unit !== ex.unit) return `${ex.exerciseName} is logged in ${ex.unit}`;
  if (load.convention !== ex.loadConvention) return `${ex.exerciseName} is logged as ${ex.loadConvention.replace('_', ' ')}`;
  return null;
}

/** `log_set` from chat: the Log button's command, checked first so a refusal says why. */
export function checkChatLog(input: ChatSetInput): ChatSetCheck {
  const { agg, set, ex, setNumber } = context(input);
  const fail = (status: 'stale' | 'rejected', failure: string): ChatSetCheck => ({ status, failure, setNumber, exerciseName: ex?.exerciseName ?? null });
  if (agg === null || agg.session.status !== 'active') return fail('stale', 'there is no active workout');
  if (agg.session.version !== input.baseVersion) return fail('stale', 'your workout moved on');
  if (set === null || ex === null) return fail('rejected', 'that set isn’t in this workout');
  if (set.status !== 'pending') return fail('rejected', `set ${String(setNumber)} is already logged`);
  if (!chatLoggableSetIds(agg, input.benWords).has(set.id)) return fail('rejected', 'say which set');
  if (ex.measurement !== 'reps') return fail('rejected', `${ex.exerciseName} is timed: log it in the workout`);
  const unit = unitFailure(input.load, ex);
  if (unit !== null) return fail('rejected', unit);
  if (input.reps === null) return fail('rejected', 'no reps given');
  if (!said(input.benWords, [input.load?.value ?? null, input.reps], input.rpe)) return fail('rejected', 'say the weight and reps to log');
  const values: SetValues = { load: input.load, reps: input.reps, durationS: null, rpe: input.rpe, rir: null };
  const command: Extract<SessionCommand, { type: 'log_set' }> = { type: 'log_set', at: input.at, opId: input.opId, setId: set.id, values, restTimerId: deriveId(`chat-rest:${input.opId}`) };
  const dry = reduceSession(agg, command);
  if (!dry.ok) return fail('rejected', dry.error.message.replace(/\.$/, '').toLowerCase());
  const setVersionAfter = dry.state.sets.find((x) => x.id === set.id)?.version ?? set.version + 1;
  return { status: 'ok', command, setNumber: setNumber ?? set.index + 1, exerciseName: ex.exerciseName, before: valuesOf(null), after: valuesOf(values), setVersionAfter };
}

/** `correct_set` from chat: the correction sheet's command (values only), never a mark or a delete. */
export function checkChatCorrection(input: ChatSetInput): ChatSetCheck {
  const { agg, set, ex, setNumber } = context(input);
  const fail = (status: 'stale' | 'rejected', failure: string): ChatSetCheck => ({ status, failure, setNumber, exerciseName: ex?.exerciseName ?? null });
  if (agg === null || agg.session.status !== 'active') return fail('stale', 'there is no active workout');
  if (agg.session.version !== input.baseVersion) return fail('stale', 'your workout moved on');
  if (set === null || ex === null) return fail('rejected', 'that set isn’t in this workout');
  if (set.status !== 'completed') return fail('rejected', `set ${String(setNumber)} isn’t logged yet`);
  const unit = unitFailure(input.load, ex);
  if (unit !== null) return fail('rejected', unit);
  const before = valuesOf(set.actual);
  const patch: Partial<SetValues> = {};
  if (input.load !== null && !sameLoad(input.load, before.load)) patch.load = input.load;
  if (input.reps !== null && input.reps !== before.reps) patch.reps = input.reps;
  if (input.rpe !== null && input.rpe !== before.rpe) patch.rpe = input.rpe;
  if (Object.keys(patch).length === 0) return fail('rejected', `set ${String(setNumber)} already has those values`);
  if (!said(input.benWords, [patch.load?.value ?? null, patch.reps ?? null], patch.rpe ?? null)) return fail('rejected', 'say the corrected numbers');
  const command: Extract<SessionCommand, { type: 'correct_set' }> = { type: 'correct_set', at: input.at, opId: input.opId, setId: set.id, expectedSetVersion: set.version, patch };
  const dry = reduceSession(agg, command);
  if (!dry.ok) return fail('rejected', dry.error.message.replace(/\.$/, '').toLowerCase());
  const setVersionAfter = dry.state.sets.find((x) => x.id === set.id)?.version ?? set.version + 1;
  return { status: 'ok', command, setNumber: setNumber ?? set.index + 1, exerciseName: ex.exerciseName, before, after: { load: patch.load ?? before.load, reps: patch.reps ?? before.reps, rpe: patch.rpe ?? before.rpe }, setVersionAfter };
}

/**
 * Undo of a chat log: the workout's own `undo_log` (the toast's guards: the
 * set's version and "still the latest commit"). Undo of a chat correction:
 * one more `correct_set` back to the values before, guarded on the version
 * the correction left. Null when the record can't be undone.
 */
export function chatSetUndoCommand(
  detail: { kind: 'log_set'; setId: string; setVersionAfter: number | null } | { kind: 'correct_set'; setId: string; setVersionAfter: number | null; before: ChatSetValues; after: ChatSetValues },
  input: { opId: string; at: ZonedTimestamp },
): Extract<SessionCommand, { type: 'undo_log' | 'correct_set' }> | null {
  if (detail.setVersionAfter === null) return null;
  if (detail.kind === 'log_set') return { type: 'undo_log', at: input.at, opId: input.opId, setId: detail.setId, expectedSetVersion: detail.setVersionAfter };
  const patch: Partial<SetValues> = {};
  if (!sameLoad(detail.before.load, detail.after.load)) patch.load = detail.before.load;
  if (detail.before.reps !== detail.after.reps) patch.reps = detail.before.reps;
  if (detail.before.rpe !== detail.after.rpe) patch.rpe = detail.before.rpe;
  return { type: 'correct_set', at: input.at, opId: input.opId, setId: detail.setId, expectedSetVersion: detail.setVersionAfter, patch };
}
