/**
 * `classifyPainMention` (coach-memory CM6): deterministic word lists, so the
 * pain flag works offline and the coach's `set_pain_flag` gate can't be
 * talked into firing by tool output or imported notes. Pure.
 *
 * - `pain`: "hurts", "pain", "tweaked", "sharp", "pinch" … set a flag.
 * - `unclear`: "sore", "tight", "stiff", "achy" are asked about, never assumed.
 * - `effort`: "burn", "pump", "grind", "heavy", "tired" never flag.
 * - Negated pain ("no pain", "doesn't hurt") is not pain.
 */
export type PainMention = 'pain' | 'effort' | 'unclear' | 'none';

const PAIN = [
  'pain', 'painful', 'hurt', 'hurts', 'hurting', 'hurted', 'tweak', 'tweaked', 'tweaky', 'sharp',
  'pinch', 'pinching', 'pinches', 'pinchy', 'twinge', 'twinged', 'injured', 'injury', 'strained', 'tweaking',
];
const UNCLEAR = ['sore', 'soreness', 'tight', 'tightness', 'stiff', 'stiffness', 'achy', 'aching', 'ache', 'aches', 'niggle', 'niggly', 'niggling'];
const EFFORT = ['burn', 'burns', 'burning', 'pump', 'pumped', 'grind', 'grindy', 'grinder', 'heavy', 'tired', 'tiring', 'hard', 'exhausted', 'fried', 'gassed', 'cooked'];

const PAIN_SET = new Set(PAIN);
const UNCLEAR_SET = new Set(UNCLEAR);
const EFFORT_SET = new Set(EFFORT);
/** A negator within this many words before a pain word cancels it ("no real pain", "doesn't hurt"). */
const NEGATION_WINDOW = 3;
const NEGATORS = new Set(['no', 'not', 'never', 'without', "doesn't", 'doesnt', "didn't", 'didnt', "isn't", 'isnt', "wasn't", 'wasnt', "don't", 'dont', 'nothing', 'zero']);

function words(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .split(/[^a-z']+/)
    .filter((w) => w.length > 0);
}

function negated(ws: readonly string[], i: number): boolean {
  for (let j = Math.max(0, i - NEGATION_WINDOW); j < i; j += 1) {
    const w = ws[j];
    if (w !== undefined && NEGATORS.has(w)) return true;
  }
  return false;
}

export function classifyPainMention(text: string): PainMention {
  const ws = words(text);
  let pain = false;
  let unclear = false;
  let effort = false;
  for (const [i, w] of ws.entries()) {
    if (PAIN_SET.has(w) && !negated(ws, i)) pain = true;
    else if (UNCLEAR_SET.has(w) && !negated(ws, i)) unclear = true;
    else if (EFFORT_SET.has(w)) effort = true;
  }
  if (pain) return 'pain';
  if (unclear) return 'unclear';
  if (effort) return 'effort';
  return 'none';
}
