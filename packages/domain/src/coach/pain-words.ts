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
 * - A body part Ben owns ("my shoulder", "my lower back", "rolled my
 *   ankle") with no effort word, no positive word and no other signal is
 *   `unclear`, so CM6 asks rather than assuming `none` (review r2 B3).
 *   Exercise names ("leg press", "back squat") aren't "my …", so they don't
 *   trigger it.
 * - "sharp" and "shooting" only count as pain next to a body part, so
 *   "feeling sharp today" stays `none`.
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
  // Review r2 B3: common injury talk that used to be `none`.
  'spasm', 'spasms', 'spasmed', 'spasming', 'swollen', 'swelling', 'swelled',
  'aggravate', 'aggravated', 'aggravating', 'rolled', 'impinge', 'impinged', 'impingement', 'impinging', 'tendinitis',
  'tendonitis', 'tendinopathy', 'bursitis', 'dislocate', 'dislocated', 'dislocation', 'subluxed', 'bruise', 'bruised',
  'bruising', 'cramp', 'cramped', 'cramping', 'buckled', 'wrenched', 'twisted', 'jammed',
];
/** Pain only with a body part in the same clause ("sharp pain in my knee", not "feeling sharp today"). */
const NEEDS_BODY = new Set(['sharp', 'shooting']);
/** Multi-word pain phrases, matched on the joined clause. */
const PAIN_PHRASES = [
  /\bpins and needles\b/,
  /\b(?:gave|gives|giving|give) out\b/,
  /\b(?:acting|playing) up\b/,
  /\bflared? up\b|\bflaring up\b|\bflares up\b/,
  /\bbother(?:s|ed|ing)? (?:my|me)\b/,
];
const BODY = [
  'shoulder', 'shoulders', 'elbow', 'elbows', 'wrist', 'wrists', 'hand', 'hands', 'finger', 'fingers', 'thumb', 'thumbs',
  'forearm', 'forearms', 'bicep', 'biceps', 'tricep', 'triceps', 'arm', 'arms', 'neck', 'back', 'spine', 'hip', 'hips',
  'groin', 'knee', 'knees', 'ankle', 'ankles', 'foot', 'feet', 'toe', 'toes', 'heel', 'heels', 'achilles', 'shin', 'shins',
  'calf', 'calves', 'hamstring', 'hamstrings', 'quad', 'quads', 'glute', 'glutes', 'chest', 'pec', 'pecs', 'rib', 'ribs',
  'trap', 'traps', 'lat', 'lats', 'si', 'joint', 'joints', 'tendon', 'tendons', 'rotator', 'cuff', 'leg', 'legs', 'head',
];
/** Words that may sit between "my" and the body part: "my left knee", "my lower back". */
const BODY_QUALIFIERS = new Set(['left', 'right', 'lower', 'upper', 'mid', 'middle', 'bad', 'dodgy', 'rotator', 'other', 'front', 'rear']);
/** "my back went", "my knee went on me". */
function bodyWent(ws: readonly string[]): number {
  for (const [i, w] of ws.entries()) {
    if (w === 'went' && i > 0 && BODY_SET.has(ws[i - 1] ?? '') && ws.slice(Math.max(0, i - 3), i - 1).includes('my')) return i;
  }
  return -1;
}
const POSITIVE = new Set(['good', 'great', 'fine', 'fresh', 'strong', 'solid', 'ok', 'okay', 'better', 'perfect', 'amazing', 'awesome', 'easy']);
const UNCLEAR = [
  'sore', 'soreness', 'tight', 'tightness', 'stiff', 'stiffness', 'achy', 'aching', 'ache', 'aches', 'niggle', 'niggly',
  'niggling', 'uncomfortable', 'discomfort', 'tender', 'clicking', 'clicky',
  // "flared" alone may be technique ("elbows flared"); "flared up" is a phrase below and is pain.
  'flare', 'flared', 'flaring', 'flares',
];
const EFFORT = ['burn', 'burns', 'burning', 'pump', 'pumped', 'grind', 'grindy', 'grinder', 'heavy', 'tired', 'tiring', 'hard', 'exhausted', 'fried', 'gassed', 'cooked'];

const PAIN_SET = new Set(PAIN);
const BODY_SET = new Set(BODY);
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
  if (ws[i] === 'killing' && ws[i + 1] === 'it') return true;
  // "foam rolled my quads" is recovery work, not an injury.
  return ws[i] === 'rolled' && ws[i - 1] === 'foam';
}

/** "my knee", "my left knee", "my lower back", "in my shoulder": a body part Ben owns, not an exercise name. */
function ownedBodyPart(ws: readonly string[]): boolean {
  for (const [i, w] of ws.entries()) {
    if (!BODY_SET.has(w)) continue;
    let j = i - 1;
    while (j >= 0 && BODY_QUALIFIERS.has(ws[j] ?? '')) j -= 1;
    if (ws[j] === 'my') return true;
  }
  return false;
}

function anyBodyPart(ws: readonly string[]): boolean {
  return ws.some((w) => BODY_SET.has(w));
}

export function classifyPainMention(text: string): PainMention {
  let pain = false;
  let unclear = false;
  let effort = false;
  for (const ws of clauses(text)) {
    let clauseSignal = false;
    const joined = ws.join(' ');
    for (const re of PAIN_PHRASES) {
      const m = re.exec(joined);
      if (m === null) continue;
      const before = joined.slice(0, m.index).split(' ').filter((w) => w.length > 0);
      const n = negationOf([...before, '\u0000'], before.length);
      clauseSignal = true;
      if (n === 'clear') pain = true;
      else if (n === 'doubt') unclear = true;
    }
    const went = bodyWent(ws);
    if (went >= 0) {
      clauseSignal = true;
      const n = negationOf(ws, went);
      if (n === 'clear') pain = true;
      else if (n === 'doubt') unclear = true;
    }
    for (const [i, w] of ws.entries()) {
      if (PAIN_SET.has(w)) {
        if (idiom(ws, i)) {
          clauseSignal = true;
          continue;
        }
        if (NEEDS_BODY.has(w) && !anyBodyPart(ws) && !ws.some((x) => x !== w && PAIN_SET.has(x) && !NEEDS_BODY.has(x))) continue;
        clauseSignal = true;
        const n = negationOf(ws, i);
        if (n === 'clear') pain = true;
        else if (n === 'doubt') unclear = true;
      } else if (UNCLEAR_SET.has(w)) {
        clauseSignal = true;
        if (negationOf(ws, i) !== 'negated') unclear = true;
      } else if (EFFORT_SET.has(w)) {
        clauseSignal = true;
        effort = true;
      } else if (POSITIVE.has(w)) {
        clauseSignal = true;
      }
    }
    // Review r2 B3: "my knee", "my lower back is weird" with nothing else said is a question, never `none`.
    if (!clauseSignal && ownedBodyPart(ws)) unclear = true;
  }
  if (pain) return 'pain';
  if (unclear) return 'unclear';
  if (effort) return 'effort';
  return 'none';
}
