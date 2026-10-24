/**
 * Coach v3, slice 4 (ADR 0027; Ben 18 Oct: "allow numbers in replies but checked"). The coach may
 * use numbers in what it says, but each one must come from something it was given: YOUR DATA, a
 * tool result, a saved change's card or Ben's own words. A sentence with a number found in none of
 * them is dropped whole (never rewritten) and kept in `Why?` → `Not shown` (rule 6: nothing invented).
 *
 * - Facts are collected only from what code or Ben wrote: context blocks, Ben's messages and tool
 *   outputs. The model's own words (earlier replies, its tool arguments) never verify a number.
 * - Advice counts are allowed without a source when they read as advice, not as a record: reps,
 *   sets, RPE/RIR, rest and session minutes, percentages and small bare counts, within sensible
 *   bounds. A load (kg, lb), a date, an estimated 1RM, or any number in a sentence about the past
 *   ("last time", "your best") must be found.
 * - An estimated 1RM must be called an estimate ("est.", "≈", "about"), never a max he lifted.
 * - kg and lb are converted both ways (within 1%), so "about 220 lb" checks against 100 kg.
 *
 * Pure. Known limit: a number that happens to appear anywhere in the facts passes, whatever it
 * was about; the check stops invented numbers, not every misattributed one.
 */

export interface NumberFacts {
  /** Every number found, deduplicated. */
  values: ReadonlySet<number>;
  /** Calendar dates found (`MM-DD`), from ISO dates in the facts. */
  dates: ReadonlySet<string>;
  /** Sets found as load and reps together (`100|7`): `100 kg × 7` in text, or a load object followed by its reps in JSON. */
  pairs: ReadonlySet<string>;
}

export type NumericKind = 'load' | 'reps' | 'sets' | 'rpe' | 'percent' | 'minutes' | 'seconds' | 'date' | 'other';

export interface NumericClaim {
  value: number;
  kind: NumericKind;
  /** The text the number came from, for `Why?`. */
  raw: string;
  /** For a date: `MM-DD`. */
  date?: string;
}

export type SentenceVerdict = { ok: true } | { ok: false; numbers: string[]; detail: string };

/** `Why?` → `Not shown` for a sentence with a number the coach wasn't given. */
export const UNVERIFIED_NUMBER_DETAIL = 'A number in it wasn’t in your data, a tool result or your words.';
/** `Why?` → `Not shown` for an estimated 1RM stated as if lifted. */
export const UNLABELLED_ESTIMATE_DETAIL = 'An estimated 1RM must be called an estimate.';

const LB_PER_KG = 2.20462;
const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
const ISO_DATE = /\b(\d{4})-(\d{2})-(\d{2})(?:T[\d:.]+Z?)?\b/g;
const NUMBER = /(?<![\p{L}\p{N}.])(\d+(?:[.,]\d+)?)(?![\p{N}])/gu;
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const MONTH_WORD = String.raw`(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)`;
const DAY_MONTH = new RegExp(String.raw`\b(\d{1,2})(?:st|nd|rd|th)? ${MONTH_WORD}\b`, 'gi');
const MONTH_DAY = new RegExp(String.raw`\b${MONTH_WORD} (\d{1,2})(?:st|nd|rd|th)?\b`, 'gi');

function parseNumber(s: string): number {
  return Number(s.replace(',', '.'));
}

function monthNumber(word: string): number {
  return MONTHS.indexOf(word.slice(0, 3).toLowerCase()) + 1;
}

const pad = (n: number): string => String(n).padStart(2, '0');
const pairKey = (load: number, reps: number): string => `${String(load)}|${String(reps)}`;
/** `100 kg × 7`, `100×7`, `22.5 kg each for 8`. */
const PAIR_TEXT = /(\d+(?:[.,]\d+)?)\s?(?:kgs?|lbs?|kilos?|pounds?)?(?:\s?each)?\s?(?:×|x|for)\s?(\d+)(?!\d|\.\d|\s?(?:kgs?|lbs?|kilos?|pounds?|sets?|min))/gi;

/**
 * Keys whose values are plans, not logged results (review coach-v3 S1): a set's `target`, a draft's
 * slots and templates, the built-in rule's targets, an offer. Their numbers still count as values;
 * only a logged set can back "you did 105 × 8".
 */
const PLANNED_KEY = /^(?:target|targets|planned|builtInNext|next|nextTargets|proposed|offer|suggested|slots|setTemplates|templates|before|after|added|changes)$/i;

/** A load-and-reps object as logged: `{load:{value:N},reps:M}` or reps `{min:M,max:M}`. */
function loggedPairOf(o: Record<string, unknown>): [number, number] | null {
  const load = o.load;
  if (typeof load !== 'object' || load === null || typeof (load as { value?: unknown }).value !== 'number') return null;
  const value = (load as { value: number }).value;
  const reps = o.reps;
  if (typeof reps === 'number') return [value, reps];
  if (typeof reps === 'object' && reps !== null) {
    const r = reps as { min?: unknown; max?: unknown };
    if (typeof r.min === 'number' && r.min === r.max) return [value, r.min];
  }
  return null;
}

/** Logged sets in parsed JSON: load-and-reps objects and `100 kg × 7` strings, outside planned keys. */
function walkPairs(node: unknown, pairs: Set<string>): void {
  if (typeof node === 'string') {
    for (const m of node.matchAll(PAIR_TEXT)) pairs.add(pairKey(parseNumber(m[1] ?? ''), Number(m[2])));
    return;
  }
  if (Array.isArray(node)) {
    for (const x of node) walkPairs(x, pairs);
    return;
  }
  if (typeof node !== 'object' || node === null) return;
  const o = node as Record<string, unknown>;
  // A set carrying its own `target` (the built-in rule's view) is a plan, whatever else it has.
  if ('target' in o && !('actual' in o)) return;
  const pair = loggedPairOf(o);
  if (pair !== null) pairs.add(pairKey(pair[0], pair[1]));
  for (const [k, v] of Object.entries(o)) if (!PLANNED_KEY.test(k)) walkPairs(v, pairs);
}

/** The JSON a fact text carries (a tool output, or a context block after its first line), if any. */
function jsonOf(raw: string): unknown {
  const t = raw.trimStart();
  const at = t.startsWith('{') || t.startsWith('[') ? 0 : t.indexOf('\n') + 1;
  if (at < 0 || (t[at] !== '{' && t[at] !== '[')) return undefined;
  try {
    return JSON.parse(t.slice(at)) as unknown;
  } catch {
    return undefined;
  }
}

/**
 * A fact text. A plain string is Ben's or code's text whose `100 kg × 7` also counts as a set done
 * (his own words). `{ text, setsDone: false }`: its numbers count, but no set in it backs a claim
 * that a set was done (cards of changes, instructions: their pairs are targets or examples).
 */
export type FactText = string | { text: string; setsDone: boolean };

/**
 * Numbers and dates in code's and Ben's texts (context JSON, tool outputs, his messages). Sets done
 * (`pairs`) come only from logged results: JSON outside planned keys (review S1), and plain text
 * marked as able to state one.
 */
export function collectFacts(texts: readonly FactText[]): NumberFacts {
  const values = new Set<number>();
  const dates = new Set<string>();
  const pairs = new Set<string>();
  for (const item of texts) {
    const raw = typeof item === 'string' ? item : item.text;
    const json = jsonOf(raw);
    if (json !== undefined) walkPairs(json, pairs);
    else if (typeof item === 'string' || item.setsDone) for (const m of raw.matchAll(PAIR_TEXT)) pairs.add(pairKey(parseNumber(m[1] ?? ''), Number(m[2])));
    let t = raw.replace(UUID, ' ');
    t = t.replace(ISO_DATE, (_m, y: string, mo: string, d: string) => {
      dates.add(`${mo}-${d}`);
      values.add(Number(y));
      values.add(Number(mo));
      values.add(Number(d));
      return ' ';
    });
    for (const m of t.matchAll(DAY_MONTH)) dates.add(`${pad(monthNumber(m[2] ?? ''))}-${pad(Number(m[1]))}`);
    for (const m of t.matchAll(MONTH_DAY)) dates.add(`${pad(monthNumber(m[1] ?? ''))}-${pad(Number(m[2]))}`);
    for (const m of t.matchAll(NUMBER)) values.add(parseNumber(m[1] ?? ''));
  }
  return { values, dates, pairs };
}

/** Merge fact sets (the turn's input and, say, a draft's own numbers). */
export function mergeFacts(...all: readonly NumberFacts[]): NumberFacts {
  return { values: new Set(all.flatMap((f) => [...f.values])), dates: new Set(all.flatMap((f) => [...f.dates])), pairs: new Set(all.flatMap((f) => [...f.pairs])) };
}

const AFTER_UNIT: readonly [RegExp, NumericKind][] = [
  [/^\s?(?:kgs?|kilos?|kilograms?|lbs?|pounds?)\b/i, 'load'],
  [/^\s?(?:reps?|repetitions?)\b/i, 'reps'],
  [/^\s?(?:sets?|rounds?)\b/i, 'sets'],
  [/^\s?(?:%|percent|per cent)/i, 'percent'],
  [/^\s?(?:min|mins|minutes?)\b/i, 'minutes'],
  [/^\s?(?:s|sec|secs|seconds?)\b/i, 'seconds'],
];

/** The numbers a sentence states, each with what it's about. Set labels ("set 2") and ordinals are not claims. */
export function numericClaims(sentence: string): NumericClaim[] {
  const out: NumericClaim[] = [];
  let t = sentence.replace(UUID, ' ');
  const blank = (m: string): string => ' '.repeat(m.length);
  // Dates first, so their day numbers aren't read again.
  t = t.replace(ISO_DATE, (m, _y: string, mo: string, d: string) => {
    out.push({ value: Number(d), kind: 'date', raw: m, date: `${mo}-${d}` });
    return blank(m);
  });
  t = t.replace(DAY_MONTH, (m, d: string, mo: string) => {
    out.push({ value: Number(d), kind: 'date', raw: m, date: `${pad(monthNumber(mo))}-${pad(Number(d))}` });
    return blank(m);
  });
  t = t.replace(MONTH_DAY, (m, mo: string, d: string) => {
    out.push({ value: Number(d), kind: 'date', raw: m, date: `${pad(monthNumber(mo))}-${pad(Number(d))}` });
    return blank(m);
  });
  // "1RM" and "e1RM" name a measure; their "1" is not a number.
  t = t.replace(/\b(?:e1 ?rm|1 ?rm)\b/gi, blank);
  // Labels and ordinals: "set 2", "sets 2 and 3", "set 2 of 4", "1st", "the last 2".
  t = t
    .replace(/\bsets? \d+(?:(?: ?(?:-|–|and|to|&|,) ?)\d+)*(?: of \d+)?\b/gi, blank)
    .replace(/\b\d+(?:st|nd|rd|th)\b/gi, blank)
    .replace(/\b(?:last|final|first|next|remaining|other) \d+\b(?! ?(?:kgs?|lbs?|kilos?|pounds?|%))/gi, blank)
    .replace(/\b\d{1,2}:\d{2}\b/g, (m) => {
      const [mm, ss] = m.split(':').map(Number);
      out.push({ value: (mm ?? 0) * 60 + (ss ?? 0), kind: 'seconds', raw: m });
      return blank(m);
    });
  for (const m of t.matchAll(NUMBER)) {
    const raw = m[1] ?? '';
    const at = m.index;
    const rest = t.slice(at + raw.length, at + raw.length + 24);
    // The bottom of a range takes the unit after its top ("12–15 kg").
    const after = rest.replace(/^\s?(?:–|-|to)\s?\d+(?:[.,]\d+)?/, '');
    const before = t.slice(Math.max(0, at - 8), at).toLowerCase();
    let kind: NumericKind = 'other';
    for (const [re, k] of AFTER_UNIT) {
      if (re.test(after)) {
        kind = k;
        break;
      }
    }
    const prev = out.at(-1);
    if (kind === 'other' && /(?:rpe|rir|@)\s?$/.test(before)) kind = 'rpe';
    else if (kind === 'other' && /(?:×|x)\s?$/.test(before)) kind = 'reps';
    // "3 × 8" is sets × reps; "100 × 8" is load × reps.
    else if (kind === 'other' && /^\s?(?:×|x)\s?\d/.test(rest)) kind = parseNumber(raw) <= 10 && Number.isInteger(parseNumber(raw)) ? 'sets' : 'load';
    // The top of a range ("8–10 reps", "10 to 12") is what its bottom is.
    else if (prev !== undefined && prev.kind !== 'date' && /\d\s?(?:–|-|to)\s?$/.test(before)) kind = prev.kind === 'other' ? kind : prev.kind;
    out.push({ value: parseNumber(raw), kind, raw });
  }
  return out;
}

/** Words that make a sentence about the past or a record: its numbers are facts, never advice. */
const RECORD_OR_PAST =
  /\b(?:last (?:time|week|month|session|workout)|yesterday|ago|you (?:did|hit|lifted|logged|managed|got|benched|squatted|pulled|pressed|ran|completed|averaged|have done|have logged|'ve done|'ve logged)|you've (?:done|logged|hit)|your (?:best|heaviest|record|top set|pr|pb)|best|heaviest|record|pr|pb|personal best|in total|so far|averag(?:e|ed|ing)|e1rm|1 ?rm|one[- ]rep max)\b/i;
const E1RM_WORDS = /\b(?:e1rm|1 ?rm|one[- ]rep max)\b/i;
const ESTIMATE_WORDS = /\b(?:est\.?|estimate[ds]?|estimated|approx(?:imately)?|about|around|roughly)\b|≈|~/i;

function inFacts(n: number, facts: NumberFacts): boolean {
  for (const f of facts.values) {
    if (Math.abs(f - n) < 0.011) return true;
    // kg ↔ lb, within 1% (a rounded conversion).
    if (f > 0 && (Math.abs(f * LB_PER_KG - n) <= f * LB_PER_KG * 0.01 || Math.abs(f / LB_PER_KG - n) <= (f / LB_PER_KG) * 0.01)) return true;
  }
  return false;
}

function pairInFacts(load: number, reps: number, facts: NumberFacts): boolean {
  for (const k of facts.pairs) {
    const [l, r] = k.split('|').map(Number);
    if (r === reps && l !== undefined && inFacts(load, { values: new Set([l]), dates: new Set(), pairs: new Set() })) return true;
  }
  return false;
}

function adviceAllowed(c: NumericClaim): boolean {
  switch (c.kind) {
    case 'reps':
      return c.value >= 0 && c.value <= 30;
    case 'sets':
      return c.value >= 0 && c.value <= 10;
    case 'rpe':
      return c.value >= 0 && c.value <= 10;
    case 'percent':
      return c.value >= 0 && c.value <= 100;
    case 'minutes':
      return c.value >= 0 && c.value <= 180;
    case 'seconds':
      return c.value >= 0 && c.value <= 600;
    case 'other':
      return Number.isInteger(c.value) && c.value <= 10;
    case 'load':
    case 'date':
      return false;
  }
}

/**
 * Whether every number in the sentence is backed. A sentence about the past or a record needs each
 * number in the facts; advice counts pass on their own; loads and dates always need a source.
 */
export function verifySentence(sentence: string, facts: NumberFacts): SentenceVerdict {
  const claims = numericClaims(sentence);
  if (claims.length === 0) return { ok: true };
  // Rule 6: an estimated 1RM is only ever stated as an estimate.
  if (E1RM_WORDS.test(sentence) && claims.some((c) => c.kind === 'load' || c.kind === 'other') && !ESTIMATE_WORDS.test(sentence)) {
    return { ok: false, numbers: claims.map((c) => c.raw), detail: UNLABELLED_ESTIMATE_DETAIL };
  }
  const record = RECORD_OR_PAST.test(sentence);
  // A set stated as done ("you hit 105 × 8") must be a set in the facts, load and reps together.
  if (record) {
    const unmatched = [...sentence.replace(UUID, ' ').matchAll(PAIR_TEXT)].filter((m) => !pairInFacts(parseNumber(m[1] ?? ''), Number(m[2]), facts));
    if (unmatched.length > 0) return { ok: false, numbers: unmatched.map((m) => m[0].trim()), detail: UNVERIFIED_NUMBER_DETAIL };
  }
  const bad = claims.filter((c) => {
    if (c.kind === 'date') return c.date === undefined || !facts.dates.has(c.date);
    if (inFacts(c.value, facts)) return false;
    return record || !adviceAllowed(c);
  });
  return bad.length === 0 ? { ok: true } : { ok: false, numbers: bad.map((c) => c.raw), detail: UNVERIFIED_NUMBER_DETAIL };
}

/** The sentence with its numbers (and their units) taken out, for the change-claim check. */
export function withoutNumbers(sentence: string): string {
  return sentence
    .replace(/\b(?:e1 ?rm|1 ?rm)\b/gi, 'max')
    .replace(/\d+(?:[.,]\d+)?(?:\s?(?:–|-|to)\s?\d+(?:[.,]\d+)?)?\s?(?:kgs?|lbs?|kilos?|kilograms?|pounds?|reps?|sets?|mins?|minutes?|%)?/gi, ' ')
    .replace(/[×@]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Words that make a statement about now or later: never a plain record, whatever its numbers. */
const NOW_OR_CHANGE = /\b(?:now|today|next|from here|going forward|from now|remaining|rest of|will|i'?ve|i have|we'?ve|we have|changed|updated|set (?:it |them )?to|lowered|raised|dropped|bumped|moved|swapped|added|removed)\b/i;

/**
 * (Coach v3) A statement of a record or past result whose numbers all check ("Your heaviest bench
 * is 102.5 kg × 6", "Last time you did 3 × 8 at 60 kg"). The claim backstop reads such sentences as
 * change claims ("is 102.5"); with every number found and no now-or-change words, it's a fact. Pure.
 */
export function verifiedRecordStatement(sentence: string, facts: NumberFacts): boolean {
  if (numericClaims(sentence).length === 0) return false;
  const t = sentence.replace(/[’]/g, "'");
  if (!RECORD_OR_PAST.test(t) || NOW_OR_CHANGE.test(t)) return false;
  return verifySentence(sentence, facts).ok;
}
