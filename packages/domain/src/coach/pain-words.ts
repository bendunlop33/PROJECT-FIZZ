/**
 * `classifyPainMention` (coach-memory CM6): deterministic word lists, so the
 * pain flag works offline and the coach's `set_pain_flag` gate can't be
 * talked into firing by tool output or imported notes. Pure.
 *
 * - `pain`: "hurts", "pain", "tweaked", "pulled", "sprained", "popped",
 *   "killing me", "numb" … allow a flag.
 * - `unclear`: "sore", "tight", "stiff", "achy", "uncomfortable", and pain
 *   words with a negator a few words back in the same clause ("I don't think
 *   it hurts") are asked about, never assumed.
 * - `effort`: "burn", "pump", "grind", "heavy", "tired" never flag.
 * - Only a negator directly before the pain word cancels it ("no pain",
 *   "doesn't hurt", "no real pain"). "without" and "never" don't: "I can't
 *   press without pain" and "never had pain like this" are pain (rule 9).
 *
 * A false `pain` only lets the coach consider a flag; a missed one lets
 * progression continue on a movement that hurts. When in doubt the answer
 * leans to `pain` or `unclear`, never `none`.
 */
export type PainMention = 'pain' | 'effort' | 'unclear' | 'none';

const PAIN = [
  'pain', 'pains', 'painful', 'hurt', 'hurts', 'hurting', 'hurted', 'tweak', 'tweaked', 'tweaky', 'tweaking', 'sharp',
  'pinch', 'pinching', 'pinches', 'pinchy', 'twinge', 'twinged', 'injured', 'injury', 'injure', 'strain', 'strains',
  'strained', 'straining', 'pulled', 'sprain', 'sprains', 'sprained', 'pop', 'popped', 'popping', 'killing', 'torn', 'tore',
  'numb', 'numbness', 'tingling', 'tingly', 'throbbing', 'throbs', 'stabbing', 'shooting', 'agony', 'ouch', 'jarred',
];
const UNCLEAR = [
  'sore', 'soreness', 'tight', 'tightness', 'stiff', 'stiffness', 'achy', 'aching', 'ache', 'aches', 'niggle', 'niggly',
  'niggling', 'uncomfortable', 'discomfort', 'tender', 'clicking', 'clicky',
];
const EFFORT = ['burn', 'burns', 'burning', 'pump', 'pumped', 'grind', 'grindy', 'grinder', 'heavy', 'tired', 'tiring', 'hard', 'exhausted', 'fried', 'gassed', 'cooked'];

const PAIN_SET = new Set(PAIN);
const UNCLEAR_SET = new Set(UNCLEAR);
const EFFORT_SET = new Set(EFFORT);
const NEGATORS = new Set(['no', 'not', "doesn't", 'doesnt', "didn't", 'didnt', "isn't", 'isnt', "wasn't", 'wasnt', "don't", 'dont', 'nothing', 'zero']);
/** Words that may sit between a negator and the pain word without breaking it: "no real pain", "doesn't really hurt". */
const NEGATION_FILLERS = new Set(['real', 'really', 'any', 'actual', 'much']);
/** A negator this far back in the same clause makes it a question, not a no ("I don't think it hurts"). */
const DOUBT_WINDOW = 4;
/** "It didn't hurt until set 3": the negation is about before, the pain is now. */
const NEGATION_BREAKERS = new Set(['until', 'till', 'except', 'unless', 'before']);

function clauses(text: string): string[][] {
  return text
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .split(/[,.;:!?\n]+|\s+(?:but|though|although|however)\s+/)
    .map((c) => c.split(/[^a-z']+/).filter((w) => w.length > 0))
    .filter((c) => c.length > 0);
}

type Negation = 'negated' | 'doubt' | 'clear';

function negationOf(ws: readonly string[], i: number): Negation {
  if (NEGATION_BREAKERS.has(ws[i + 1] ?? '')) return 'clear';
  let j = i - 1;
  while (j >= 0 && NEGATION_FILLERS.has(ws[j] ?? '')) j -= 1;
  if (j >= 0 && NEGATORS.has(ws[j] ?? '')) return 'negated';
  for (let k = Math.max(0, i - DOUBT_WINDOW); k < i; k += 1) {
    if (NEGATORS.has(ws[k] ?? '')) return 'doubt';
  }
  return 'clear';
}

/** "You're killing it" is praise, not pain. */
function idiom(ws: readonly string[], i: number): boolean {
  return ws[i] === 'killing' && ws[i + 1] === 'it';
}

export function classifyPainMention(text: string): PainMention {
  let pain = false;
  let unclear = false;
  let effort = false;
  for (const ws of clauses(text)) {
    for (const [i, w] of ws.entries()) {
      if (PAIN_SET.has(w)) {
        if (idiom(ws, i)) continue;
        const n = negationOf(ws, i);
        if (n === 'clear') pain = true;
        else if (n === 'doubt') unclear = true;
      } else if (UNCLEAR_SET.has(w)) {
        if (negationOf(ws, i) !== 'negated') unclear = true;
      } else if (EFFORT_SET.has(w)) {
        effort = true;
      }
    }
  }
  if (pain) return 'pain';
  if (unclear) return 'unclear';
  if (effort) return 'effort';
  return 'none';
}
