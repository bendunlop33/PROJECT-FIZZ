import type { LoadConvention, NoteMatchAnswer, WeightUnit } from '@fizz/schemas';
import { KG_PER_LB } from '../units';
import { editDistance } from '../exercise-search';
import { nameKey, nameTokens } from './match';

/**
 * (Ben, 11 Nov) `Paste` in Log a past workout: a workout written in Apple Notes when the app wasn't to hand.
 * Pure and deterministic, so it works with no network and no coach (rule 1). The text is data, never
 * instructions (rule 8): nothing in it is run, only read as names and numbers.
 *
 * Ben's format (one exercise name, then its rows):
 * ```
 * Push - 10.11.26
 * Location: Main gym
 * Bench
 * 60x6x2          load x reps x sets (sets optional, default 1)
 * 16x6x1 each     `each` = per dumbbell
 * BWx6x2          `BW` = bodyweight
 * ```
 * Also read: `22.5 x 6`, `60kg x 6 x 2`, `3x10 @ 60`, `22,5x6`, lb, ticks and checkboxes (ignored), blank lines.
 * A title line may carry a name and a UK date (`10.11.26` = 10 Nov 2026). A line that starts like a set but
 * doesn't read is kept as `unread` (never guessed); the coach may propose its sets, Ben confirms.
 */

/** One readable row: `load x reps x sets`. `load` null with `bodyweight`. */
export interface NoteRow {
  text: string;
  load: number | null;
  bodyweight: boolean;
  unit: WeightUnit;
  reps: number;
  sets: number;
  perHand: boolean;
  /** Proposed by the coach for a line the app couldn't read (shown marked for Ben to check). */
  byCoach?: true;
}

export type PastedLine = { kind: 'row'; row: NoteRow } | { kind: 'unread'; text: string };

export type NoteSetType = 'warmup' | 'working';

/** One set as it will be logged. */
export interface NoteSet {
  load: number | null;
  bodyweight: boolean;
  unit: WeightUnit;
  reps: number;
  perHand: boolean;
  setType: NoteSetType;
  byCoach: boolean;
}

export interface NoteExercise {
  /** The name as written (`Bench`). */
  header: string;
  lines: PastedLine[];
}

export interface NoteWorkout {
  /** The title's words without the date (`Push`), or null. */
  title: string | null;
  /** `YYYY-MM-DD` from the title (or a date line before the first exercise), or null. */
  date: string | null;
  /** `Location: Main gym`. */
  location: string | null;
  /** In written order; an exercise name with no rows is kept (it has no sets) so the coach can see it as data. */
  exercises: NoteExercise[];
}

const TICK_CHARS = '✓✔☐☑✅❌✗☒□■●•◦▪';
const LEAD = new RegExp(`^(?:[-*+]\\s+)?(?:\\[[ xX✓✔]?\\]\\s*)?[${TICK_CHARS}\\s]*`);
const TRAIL = new RegExp(`[${TICK_CHARS}\\s]+$`);
const UNIT_WORD = '(?:kgs?|lbs?)';
const SUFFIX = `((?:\\s*(?:${UNIT_WORD}|each|ea|per\\s*hand|per\\s*side|/\\s*hand|ph))*)`;
const LOAD = '(bw|bodyweight|\\d+(?:\\.\\d+)?)';
const ROW_A = new RegExp(`^${LOAD}\\s*(${UNIT_WORD})?\\s*x\\s*(\\d+)\\s*(?:reps?)?(?:\\s*x\\s*(\\d+)\\s*(?:sets?)?)?${SUFFIX}$`);
const ROW_B = new RegExp(`^(\\d+)\\s*x\\s*(\\d+)\\s*@\\s*${LOAD}\\s*(${UNIT_WORD})?${SUFFIX}$`);
const DATE = /(\d{1,2})[./-](\d{1,2})[./-](\d{4}|\d{2})(?!\d)/;
const LOCATION = /^(?:location|gym|where)\s*[:=-]\s*(.+)$/i;

/** A line without ticks, checkboxes and bullets; `×` as `x`; decimal commas as points. */
export function cleanNoteLine(raw: string): string {
  return raw
    .normalize('NFKC')
    .replace(LEAD, '')
    .replace(TRAIL, '')
    .replace(/[×✕]/g, 'x')
    .replace(/(\d),(\d)/g, '$1.$2')
    .replace(/\s+/g, ' ')
    .trim();
}

/** `10.11.26` → `2026-11-10` (UK day.month.year); null when it isn't a real date. */
export function noteDate(text: string): string | null {
  const m = DATE.exec(text);
  if (m === null) return null;
  const d = Number(m[1]);
  const mo = Number(m[2]);
  const y = (m[3] ?? '').length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
  const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][mo - 1];
  if (days === undefined || d < 1 || d > days) return null;
  return `${String(y)}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function suffixInfo(suffix: string, unit: string | undefined, defaultUnit: WeightUnit): { unit: WeightUnit; perHand: boolean } {
  const s = `${unit ?? ''} ${suffix}`.toLowerCase();
  const u: WeightUnit = /lb/.test(s) ? 'lb' : /kg/.test(s) ? 'kg' : defaultUnit;
  return { unit: u, perHand: /each|\bea\b|per\s*hand|per\s*side|\/\s*hand|\bph\b/.test(s) };
}

function loadOf(word: string): { load: number | null; bodyweight: boolean } {
  return word === 'bw' || word === 'bodyweight' ? { load: null, bodyweight: true } : { load: Number(word), bodyweight: false };
}

function rowOk(r: NoteRow): boolean {
  return r.reps >= 1 && r.reps <= 100 && r.sets >= 1 && r.sets <= 20 && (r.load === null || (r.load >= 0 && r.load <= 1000));
}

/** One set row (`60x6x2`, `16x6x1 each`, `BWx6x2`, `60kg x 6 x 2`, `3x10 @ 60`), or null. */
export function readNoteRow(line: string, defaultUnit: WeightUnit): NoteRow | null {
  const text = cleanNoteLine(line);
  const low = text.toLowerCase();
  const b = ROW_B.exec(low);
  if (b !== null) {
    const info = suffixInfo(b[5] ?? '', b[4], defaultUnit);
    const row: NoteRow = { text, ...loadOf(b[3] ?? ''), unit: info.unit, reps: Number(b[2]), sets: Number(b[1]), perHand: info.perHand };
    return rowOk(row) ? row : null;
  }
  const a = ROW_A.exec(low);
  if (a === null) return null;
  const info = suffixInfo(a[5] ?? '', a[2], defaultUnit);
  const row: NoteRow = { text, ...loadOf(a[1] ?? ''), unit: info.unit, reps: Number(a[3]), sets: a[4] === undefined ? 1 : Number(a[4]), perHand: info.perHand };
  return rowOk(row) ? row : null;
}

/** Starts like a set (a number or BW): never an exercise name. */
function looksLikeSet(text: string): boolean {
  return /^(?:\d|bw\b|bw\s*x|bodyweight\s*x)/i.test(text);
}

/** The title's words: the line without its date and separators. */
function titleWords(text: string): string | null {
  const t = text
    .replace(DATE, ' ')
    .replace(/[-–—·,|:]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return t === '' ? null : t.slice(0, 120);
}

/**
 * Read a pasted note. Null when it has no set at all (`Couldn’t read that`; nothing is created).
 * `defaultUnit`: Ben's preferred unit, for rows that don't say kg or lb.
 */
export function parseNoteWorkout(text: string, defaultUnit: WeightUnit): NoteWorkout | null {
  const lines = text
    .slice(0, 20_000)
    .split(/\r?\n/)
    .map(cleanNoteLine)
    .filter((l) => l !== '')
    .slice(0, 400);
  let title: string | null = null;
  let date: string | null = null;
  let location: string | null = null;
  const exercises: NoteExercise[] = [];
  let current: NoteExercise | null = null;
  for (const [i, line] of lines.entries()) {
    const loc = LOCATION.exec(line);
    if (loc !== null) {
      location = (loc[1] ?? '').trim().slice(0, 120) || null;
      continue;
    }
    const row = readNoteRow(line, defaultUnit);
    if (row !== null) {
      if (current === null) {
        current = { header: '', lines: [] };
        exercises.push(current);
      }
      current.lines.push({ kind: 'row', row });
      continue;
    }
    if (looksLikeSet(line)) {
      if (exercises.length === 0 && date === null && noteDate(line) !== null) {
        date = noteDate(line);
        continue;
      }
      if (current === null) {
        current = { header: '', lines: [] };
        exercises.push(current);
      }
      current.lines.push({ kind: 'unread', text: line.slice(0, 200) });
      continue;
    }
    // A name line. Before the first exercise, a line with a date (or one followed by another name line) is the title.
    if (exercises.length === 0 && title === null && date === null) {
      const d = noteDate(line);
      const next = lines[i + 1];
      const nextIsName = next !== undefined && readNoteRow(next, defaultUnit) === null && !looksLikeSet(next);
      if (d !== null || (i === 0 && nextIsName)) {
        date = d;
        title = titleWords(line);
        continue;
      }
    }
    current = { header: line.replace(/:$/, '').trim().slice(0, 120), lines: [] };
    exercises.push(current);
  }
  if (!exercises.some((e) => e.lines.some((l) => l.kind === 'row'))) return null;
  return { title, date, location, exercises };
}

function kgOf(load: number, unit: WeightUnit): number {
  return unit === 'kg' ? load : load * KG_PER_LB;
}

/** Below this share of the top load, a set before the first top set is a warm-up. */
export const NOTE_WARMUP_SHARE = 0.85;

/**
 * Every set, rows expanded, with warm-ups marked: before the first set at the exercise's top load, a lighter set is
 * a warm-up when it is under 85 % of the top, or when it has no more reps than that first top set (a ramp: bench
 * 60x6x2, 80x4 before 110x5; shoulder press 22.5x6, 27.5x4 before 32x8). After the first top set, every set is
 * working (back-offs). Bodyweight sets and exercises at one load are all working. Ben can change any type.
 */
export function noteSetsOf(ex: Pick<NoteExercise, 'lines'>): NoteSet[] {
  const flat: NoteSet[] = [];
  for (const l of ex.lines) {
    if (l.kind !== 'row') continue;
    for (let k = 0; k < l.row.sets; k += 1) flat.push({ load: l.row.load, bodyweight: l.row.bodyweight, unit: l.row.unit, reps: l.row.reps, perHand: l.row.perHand, setType: 'working', byCoach: l.row.byCoach === true });
  }
  const loaded = flat.map((s) => (s.load === null ? null : kgOf(s.load, s.unit)));
  const top = Math.max(0, ...loaded.map((x) => x ?? 0));
  if (top <= 0) return flat;
  const firstTop = loaded.findIndex((x) => x !== null && x >= top - 1e-9);
  const topReps = flat[firstTop]?.reps ?? 0;
  return flat.map((s, i) => {
    const kg = loaded[i];
    if (i >= firstTop || kg === null || kg === undefined || kg >= top - 1e-9) return s;
    return kg < NOTE_WARMUP_SHARE * top || s.reps <= topReps ? { ...s, setType: 'warmup' } : s;
  });
}

/** The heaviest load written for an exercise, in kg (null: none, e.g. bodyweight only). */
export function noteTopKg(ex: Pick<NoteExercise, 'lines'>): number | null {
  let top: number | null = null;
  for (const l of ex.lines) if (l.kind === 'row' && l.row.load !== null) top = Math.max(top ?? 0, kgOf(l.row.load, l.row.unit));
  return top;
}

/** Whether the rows say per dumbbell (`each`) or bodyweight. */
export function noteHints(ex: Pick<NoteExercise, 'lines'>): { perHand: boolean; bodyweight: boolean } {
  const rows = ex.lines.flatMap((l) => (l.kind === 'row' ? [l.row] : []));
  return { perHand: rows.some((r) => r.perHand), bodyweight: rows.length > 0 && rows.every((r) => r.bodyweight) };
}

// ---------------------------------------------------------------------------------------------------------------
// Matching names to exercises

/** An exercise a note name can be: catalogue or Ben's own, with what his history says about it. */
export interface NoteCandidate {
  exerciseId: string;
  name: string;
  aliases: readonly string[];
  convention: LoadConvention;
  /** Finished workouts with this exercise (Ben's history). */
  sessions: number;
  /** His heaviest recent set on it, in kg; null: none. */
  lastTopKg: number | null;
}

export interface NoteMatch {
  exerciseId: string | null;
  /** `sure`: the name is an exercise's own name, or the only fit, or his history decided. Otherwise a suggestion for Ben to check. */
  sure: boolean;
}

const EQUIPMENT_WORDS = new Set(['dumbbell', 'barbell', 'cable', 'machine', 'bodyweight', 'kettlebell', 'ezbar', 'smith', 'band', 'plate', 'seated', 'standing', 'flat']);
const MUSCLE_WORDS = new Set(['chest', 'tricep', 'bicep', 'shoulder', 'lat', 'quad', 'hamstring', 'glute', 'calf', 'delt', 'trap', 'ab', 'back', 'leg', 'pec']);

/** A note name's words: the import's words, `flye` = `fly`, and gym talk for `tricep raises` (an overhead extension). */
export function noteTokens(name: string): string[] {
  const t = nameTokens(name).map((w) => (w === 'flye' ? 'fly' : w === 'calve' ? 'calf' : w));
  if (t.includes('tricep') && t.includes('raise')) return [...new Set(t.flatMap((w) => (w === 'raise' ? ['overhead', 'extension'] : [w])))];
  return [...new Set(t)];
}

function weight(w: string): number {
  return EQUIPMENT_WORDS.has(w) ? 0.5 : MUSCLE_WORDS.has(w) ? 1.5 : 1;
}

function hasWord(words: readonly string[], w: string): boolean {
  return words.some((x) => x === w || (w.length >= 5 && x.length >= 5 && editDistance(x, w) <= 1));
}

interface Scored {
  c: NoteCandidate;
  coverage: number;
  extras: number;
  primary: boolean;
}

function scoreOf(q: readonly string[], c: NoteCandidate): Scored | null {
  const total = q.reduce((s, w) => s + weight(w), 0);
  if (total === 0) return null;
  let best: Scored | null = null;
  for (const [i, n] of [c.name, ...c.aliases].entries()) {
    const t = noteTokens(n);
    const hit = q.filter((w) => hasWord(t, w));
    if (!hit.some((w) => !EQUIPMENT_WORDS.has(w))) continue;
    const coverage = hit.reduce((s, w) => s + weight(w), 0) / total;
    if (coverage < 0.5) continue;
    const s: Scored = { c, coverage, extras: Math.max(0, t.length - hit.length), primary: i === 0 };
    if (best === null || s.coverage > best.coverage + 1e-9 || (Math.abs(s.coverage - best.coverage) < 1e-9 && (s.extras < best.extras || (s.extras === best.extras && s.primary && !best.primary)))) best = s;
  }
  return best;
}

function conventionFit(c: NoteCandidate, hints: { perHand: boolean; bodyweight: boolean }): number {
  if (hints.bodyweight) return c.convention === 'bodyweight' || c.convention === 'added' ? 2 : c.convention === 'assistance' ? 1 : 0;
  if (hints.perHand) return c.convention === 'per_hand' ? 2 : 0;
  return c.convention === 'bodyweight' ? 0 : 1;
}

function closeness(c: NoteCandidate, topKg: number | null): number {
  if (topKg === null || topKg <= 0 || c.lastTopKg === null || c.lastTopKg <= 0) return Number.POSITIVE_INFINITY;
  return Math.abs(Math.log(topKg / c.lastTopKg));
}

/** The order candidates are preferred in (most preferred first). */
function compare(a: Scored, b: Scored, hints: { perHand: boolean; bodyweight: boolean }, topKg: number | null): number {
  if (Math.abs(a.coverage - b.coverage) > 1e-9) return b.coverage - a.coverage;
  const fa = conventionFit(a.c, hints);
  const fb = conventionFit(b.c, hints);
  // A clear unit word (`each`, `BW`) beats history.
  if ((hints.perHand || hints.bodyweight) && fa !== fb) return fb - fa;
  const ha = a.c.sessions > 0 ? 1 : 0;
  const hb = b.c.sessions > 0 ? 1 : 0;
  if (ha !== hb) return hb - ha;
  if (ha === 1) {
    const ca = closeness(a.c, topKg);
    const cb = closeness(b.c, topKg);
    if (Number.isFinite(ca) && Number.isFinite(cb) && Math.abs(ca - cb) > 0.15) return ca - cb;
  }
  if (fa !== fb) return fb - fa;
  if (a.c.sessions !== b.c.sessions) return b.c.sessions - a.c.sessions;
  if (a.extras !== b.extras) return a.extras - b.extras;
  if (a.primary !== b.primary) return a.primary ? -1 : 1;
  if (a.c.name.length !== b.c.name.length) return a.c.name.length - b.c.name.length;
  return a.c.name.localeCompare(b.c.name);
}

/** Candidates that fit a note name, most preferred first. */
export function rankNoteCandidates(ex: NoteExercise, candidates: readonly NoteCandidate[]): NoteCandidate[] {
  const q = noteTokens(ex.header);
  if (q.length === 0) return [];
  const hints = noteHints(ex);
  const top = noteTopKg(ex);
  const key = nameKey(ex.header);
  const scored = candidates.map((c) => scoreOf(q, c)).filter((s): s is Scored => s !== null);
  // The name exactly (an exercise's own name or one of its names, ignoring case and plurals) comes first.
  const exact = (s: Scored) => s.coverage > 1 - 1e-9 && s.extras === 0;
  const ownName = (s: Scored) => nameKey(s.c.name) === key || s.c.aliases.some((a) => nameKey(a) === key);
  return scored
    .sort((a, b) => {
      const xa = ownName(a) ? 2 : exact(a) ? 1 : 0;
      const xb = ownName(b) ? 2 : exact(b) ? 1 : 0;
      return xa !== xb ? xb - xa : compare(a, b, hints, top);
    })
    .map((s) => s.c);
}

/**
 * The exercise a note name most likely is: his history's exercise first ("Shoulder press" → the shoulder press he
 * does), `each` → a dumbbell exercise, `BW` → a bodyweight one. Unknown names match nothing (Ben picks in review).
 */
export function matchNoteExercise(ex: NoteExercise, candidates: readonly NoteCandidate[]): NoteMatch {
  const q = noteTokens(ex.header);
  const ranked = rankNoteCandidates(ex, candidates);
  const best = ranked[0];
  if (best === undefined) return { exerciseId: null, sure: false };
  const s = scoreOf(q, best);
  const second = ranked[1];
  const s2 = second === undefined ? null : scoreOf(q, second);
  const key = nameKey(ex.header);
  const named = nameKey(best.name) === key || best.aliases.some((a) => nameKey(a) === key);
  const sure = named || (s !== null && s.coverage > 1 - 1e-9 && (s.extras === 0 || best.sessions > 0 || s2 === null || s2.coverage < 1 - 1e-9));
  return { exerciseId: best.exerciseId, sure };
}

/** The gym a `Location:` names (same name ignoring case and spacing, else the only one containing it). */
export function noteGym<G extends { id: string; name: string }>(location: string | null, gyms: readonly G[]): G | null {
  if (location === null) return null;
  const key = nameKey(location);
  const same = gyms.filter((g) => nameKey(g.name) === key);
  if (same.length === 1) return same[0] ?? null;
  const near = gyms.filter((g) => nameKey(g.name).includes(key) || key.includes(nameKey(g.name)));
  return near.length === 1 ? (near[0] ?? null) : null;
}

/** `2×60×6, 80×4, 2×110×5 each`: a row list as Ben wrote it, for review. */
export function noteRowsText(ex: Pick<NoteExercise, 'lines'>): string {
  return ex.lines
    .map((l) => {
      if (l.kind === 'unread') return `${l.text}?`;
      const r = l.row;
      const load = r.bodyweight ? 'BW' : String(r.load);
      return `${r.sets > 1 ? `${String(r.sets)}×` : ''}${load}×${String(r.reps)}${r.unit === 'lb' ? ' lb' : ''}${r.perHand ? ' each' : ''}`;
    })
    .join(', ');
}

// ---------------------------------------------------------------------------------------------------------------
// The coach's optional answer (Ben, 11 Nov: "use AI to match exercises")

/** What one exercise looks like after the coach's answer was checked. */
export interface NoteCoachResult {
  /** The exercise the coach named, when it is on the list sent and different from code's; null: keep code's. */
  exerciseId: string | null;
  /** `own:<name>`: the coach thinks it's an exercise Ben would add himself (offered as `Add your own` with the name). */
  ownName: string | null;
  /** The lines it read that code couldn't (each becomes rows, marked `byCoach`). */
  lines: PastedLine[];
}

/**
 * Check the coach's answer against what was sent (rule 8, rule 5):
 * - a mapping counts only for a name sent, with an ID from that name's list (or `own:<name>`), and not `low`;
 * - a proposed set counts only for an unread line sent under that name (a line code read itself is never replaced,
 *   so a load code read can't change), within range;
 * - anything else is dropped. Nothing here writes.
 */
export function checkNoteCoachAnswer(workout: NoteWorkout, offered: ReadonlyMap<number, readonly string[]>, answer: NoteMatchAnswer): NoteCoachResult[] {
  return workout.exercises.map((ex, i) => {
    const ids = new Set(offered.get(i) ?? []);
    const mapping = answer.mappings.find((m) => m.name === ex.header && ex.header !== '');
    let exerciseId: string | null = null;
    let ownName: string | null = null;
    if (mapping !== undefined && mapping.confidence !== 'low' && mapping.exercise !== null) {
      if (mapping.exercise.startsWith('own:')) {
        const n = mapping.exercise.slice(4).trim();
        ownName = n === '' ? null : n.slice(0, 120);
      } else if (ids.has(mapping.exercise)) exerciseId = mapping.exercise;
    }
    const unread = new Set(ex.lines.flatMap((l) => (l.kind === 'unread' ? [l.text] : [])));
    const lines: PastedLine[] = ex.lines.map((l) => {
      if (l.kind === 'row' || !unread.has(l.text)) return l;
      const rows = answer.sets.filter((s) => s.name === ex.header && s.line === l.text);
      if (rows.length !== 1) return l;
      const s = rows[0];
      if (s === undefined || (s.bodyweight ? s.load !== null : s.load === null)) return l;
      const row: NoteRow = { text: l.text, load: s.load, bodyweight: s.bodyweight, unit: s.unit, reps: s.reps, sets: s.sets, perHand: s.perHand, byCoach: true };
      return rowOk(row) ? { kind: 'row', row } : l;
    });
    return { exerciseId, ownName, lines };
  });
}
