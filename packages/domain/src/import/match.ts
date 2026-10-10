import type { AliasTarget, ExerciseEquipmentKind, ImplementCount, ImportBarKind, Laterality, LoadConvention } from '@fizz/schemas';
import { deriveId } from '../stable';

/**
 * Exercise name matching for imports (data-import-export §2.5 step 3a). Pure.
 *
 * - `matched`: the name equals (ignoring case and spacing) an exercise's name
 *   or one of its catalogue names, or a name Ben answered in an earlier import
 *   still in effect (a saved alias; review r5 S2). Never the custom exercise
 *   an earlier import's `Add new` made from the name (`importMade`).
 * - `check`: a suggestion from the words of the name only. Ben confirms it.
 *   A suggestion never contradicts an equipment word in the name (`Flat
 *   Dumbbell Bench Press` is never the barbell bench press) or a one-arm /
 *   two-arm word (review r5 N1). Smith and assisted words work both ways
 *   (review r5 S3, r6 B2, B3): a Smith machine exercise only for a name that
 *   says Smith, and a name that says Smith only a Smith machine exercise,
 *   even when it also says Barbell; an assisted machine only for a name that
 *   says assisted, and a name that says assisted only an assisted or
 *   bodyweight exercise, even when it also says Machine.
 *   Words that only count arms are left out of the comparison; a tie goes to
 *   the exercise whose own name says the same count, then is broken on
 *   equipment, never by alphabetical order: a tie neither can break gives no
 *   suggestion (review r4 S3).
 * - `no_match`: nothing suggested.
 * No score is shown or stored: the matcher has no calibrated confidence.
 * Names are data, never instructions (rule 8).
 *
 * **A suggestion is about the exercise only (PM decision, review r5).**
 * Nothing that changes a stored value (one dumbbell or two, total or
 * plates only, load or assistance, the unit) is ever taken from a word
 * suggestion, even after `Use this`. Those come only from (a) the name being
 * one of the exercise's own names (`namesExercise`), (b) Ben's own answer,
 * or (c) a word in the FitNotes name (`implementCue`, `equipmentInName`).
 */

export type MatchStatus = 'matched' | 'check' | 'no_match';

/** An exercise an imported name can map to (the app's list plus the bundled catalogue). */
export interface MatchCandidate {
  exerciseId: string;
  name: string;
  /** Other names for the same exercise (catalogue `aliases`). */
  aliases: readonly string[];
  catalogueKey: string | null;
  laterality: Laterality;
  defaultLoadConvention: LoadConvention;
  compatibleEquipment: readonly ExerciseEquipmentKind[];
  /**
   * `per_hand` exercises: one dumbbell or two, from the catalogue entry
   * (`implements`). Null when it isn't recorded: a custom exercise, or one
   * commonly done either way (review r3 S1).
   */
  implements: ImplementCount | null;
  /**
   * A custom exercise an earlier import's `Add new` made from this very name
   * (`customExerciseIdFor`). Its name is that import's answer, not knowledge
   * of its own: it is reached through the remembered answer while that import
   * is in effect, or suggested, but never matched by its name, so an undone
   * import's answer can't come back as `Matched` (review r5 S2).
   */
  importMade?: boolean;
}

export interface NameMatch {
  status: MatchStatus;
  /** The exercise for `matched`, or the suggestion for `check`. */
  exerciseId: string | null;
  /** `alias`: from an earlier import's answer; `name`: equal to an exercise's name. */
  via: 'alias' | 'name' | 'words' | null;
  /** A saved alias that says to skip this name. */
  skip: boolean;
}

/**
 * Matching key for a source name: lower case, single spaces, trimmed, at
 * most 200 characters. A longer name keeps its first 163 characters plus a
 * hash of the whole name, so two long names that start alike never share a
 * key (review N7).
 */
export function nameKey(name: string): string {
  const key = name.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
  return key.length <= 200 ? key : `${key.slice(0, 163)}#${deriveId(key)}`;
}

const SYNONYMS: Readonly<Record<string, readonly string[]>> = {
  db: ['dumbbell'],
  dbs: ['dumbbell'],
  bb: ['barbell'],
  kb: ['kettlebell'],
  pulley: ['cable'],
  ohp: ['overhead', 'press'],
  rdl: ['romanian', 'deadlift'],
  sldl: ['stiff', 'leg', 'deadlift'],
  bw: ['bodyweight'],
};

const JOIN: Readonly<Record<string, string>> = {
  'pull up': 'pullup',
  'chin up': 'chinup',
  'push up': 'pushup',
  'sit up': 'situp',
  'push down': 'pushdown',
  'pull down': 'pulldown',
  'skull crusher': 'skullcrusher',
  'ez bar': 'ezbar',
  'dead lift': 'deadlift',
  'step up': 'stepup',
};

const STOP = new Set(['the', 'a', 'an', 'with', 'and', 'on', 'of', 'to', 'w']);

function singular(t: string): string {
  if (t.length > 4 && t.endsWith('sses')) return t.slice(0, -2);
  if (t.length > 4 && t.endsWith('ies')) return `${t.slice(0, -3)}y`;
  if (t.length > 3 && t.endsWith('s') && !t.endsWith('ss')) return t.slice(0, -1);
  return t;
}

/** Normalised words of a name, with common gym abbreviations expanded. */
export function nameTokens(name: string): string[] {
  let text = ` ${name.normalize('NFKC').toLowerCase().replace(/[’']/g, '').replace(/[^a-z0-9]+/g, ' ')} `;
  for (const [pair, joined] of Object.entries(JOIN)) text = text.replaceAll(` ${pair} `, ` ${joined} `);
  const out: string[] = [];
  for (const raw of text.split(' ')) {
    if (raw === '' || STOP.has(raw)) continue;
    const expanded = SYNONYMS[raw] ?? [raw];
    for (const t of expanded) out.push(singular(t));
  }
  return [...new Set(out)];
}

/** Dice similarity of two token sets, with a floor when one name's letters sit inside the other's ("Skullcrusher"). */
function similarity(a: readonly string[], b: readonly string[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  const bs = new Set(b);
  const shared = a.filter((t) => bs.has(t)).length;
  const dice = (2 * shared) / (a.length + b.length);
  const ja = a.join('');
  const jb = b.join('');
  const contained = (ja.length >= 6 && jb.includes(ja)) || (jb.length >= 6 && ja.includes(jb));
  return contained ? Math.max(dice, 0.6) : dice;
}

/** A suggestion needs at least this much of the words in common. */
export const SUGGEST_THRESHOLD = 0.6;

/** Lower case, punctuation as spaces, single spaces, padded: `" one arm db row "`. */
function plainText(name: string): string {
  return ` ${name.normalize('NFKC').toLowerCase().replace(/[’']/g, '').replace(/[^a-z0-9]+/g, ' ').trim()} `;
}

/**
 * Words that only say how many arms or implements (`One-Arm`, `Single`,
 * `Two-Arm`, `Alternating`). They are left out of the word comparison, so a
 * one-arm word never outweighs the movement (`Dumbbell Bench Press (Single
 * Arm)` is a bench press, not the one-arm shoulder press; review r5 N1).
 * Words that also name the movement (`Concentration`, `Goblet`, `Single
 * Leg`) stay in.
 */
const COUNT_ONLY_WORDS: readonly RegExp[] = [
  / (?:one|1|single|two|2) ?(?:arm|arms|armed|hand|hands|handed)(?= )/g,
  / (?:two|2)(?= (?:dumbbells?|dbs?|kettlebells?|kbs?) )/g,
  / (?:single(?! ?leg)|double|dual|unilateral|alternating|alternate|alt|sa)(?= )/g,
];

/**
 * A name's words for comparison: without words that only count arms or
 * implements, and without `Smith (Machine)`: a Smith name is only ever
 * compared with Smith exercises (`equipmentFit`), so those words say nothing
 * about the movement (`Smith Machine Overhead Press` isn't the Smith machine
 * bench press; review r5 S3).
 */
function comparedTokens(name: string): string[] {
  let text = plainText(name).replaceAll(/ smith(?: machines?)?(?= )/g, '');
  for (const re of COUNT_ONLY_WORDS) text = text.replaceAll(re, '');
  return nameTokens(text);
}

/**
 * What a word in a name says about equipment. Exercise equipment kinds, plus
 * `smith`: a Smith machine is its own kind here (review r5 S3). Its bar runs
 * in a frame and takes plates, so it is neither a weight stack nor a free
 * barbell; only an exercise whose own name says Smith is one.
 */
export type NamedEquipment = ExerciseEquipmentKind | 'smith';

/**
 * Equipment words in a name and the kinds each allows (review r4 S3, r5 S3).
 * `Machine` allows a weight stack or a plate-loaded machine, never an
 * assisted one: only `assisted` / `assist` / `Gravitron` / `counterweight`
 * name an assisted machine, where more weight is easier. `Smith` (with or
 * without `Machine`) names only a Smith machine.
 */
const EQUIPMENT_WORDS: readonly [RegExp, readonly NamedEquipment[]][] = [
  [/ (dumbbells?|dbs?) /, ['dumbbells']],
  [/ (barbells?|bb|olympic) /, ['barbell']],
  [/ (ez ?bar(bells?)?|ez) /, ['ez_bar']],
  [/ (trap|hex) ?bar(bells?)? /, ['trap_bar']],
  [/ (kettlebells?|kbs?) /, ['kettlebell']],
  [/ (cables?|pulley) /, ['weight_stack']],
  [/ hammer strength /, ['plate_loaded_machine', 'weight_stack']],
  [/ machines? /, ['weight_stack', 'plate_loaded_machine']],
  [/ (assist|assisted|assistance|gravitron|counter ?weight|counter ?weighted) /, ['assisted_stack']],
  [/ (bands?|banded) /, ['band']],
];

const SMITH = / smith /;

/**
 * `EZ Barbell`, `Trap Barbell`, `Hex Barbell`: one word names the EZ or trap
 * bar, and its `barbell` is not the Olympic bar (review r7 B1). Read by the
 * EZ / trap patterns, then removed before the barbell pattern is tried.
 */
const SPECIALTY_BARBELL = / (ez|trap|hex) ?barbells? /g;

/**
 * The equipment a name says it uses (`Flat Dumbbell Bench Press` →
 * dumbbells), or null when it names none. Several words allow any of their
 * kinds (`Hammer Strength Machine …`). `Smith Machine …` is `smith` only:
 * its `Machine` doesn't make it a weight stack (review r5 S3).
 */
export function equipmentInName(name: string): ReadonlySet<NamedEquipment> | null {
  let text = plainText(name);
  const kinds = new Set<NamedEquipment>();
  if (SMITH.test(text)) {
    kinds.add('smith');
    text = text.replace(/ smith (machines? )?/g, ' ');
  }
  for (const [re, allowed] of EQUIPMENT_WORDS) {
    if (allowed.includes('barbell')) {
      if (re.test(text.replace(SPECIALTY_BARBELL, ' '))) for (const k of allowed) kinds.add(k);
    } else if (re.test(text)) for (const k of allowed) kinds.add(k);
  }
  return kinds.size === 0 ? null : kinds;
}

const IMPORT_BAR_KINDS: readonly ImportBarKind[] = ['barbell', 'ez_bar', 'trap_bar'];

/**
 * What a name's own words say about its bar (source (c)), the one rule both
 * `Choose…` / `Use this` (`barNamed`) and `Add new` → Barbell
 * (`newBarFromName`) read (review r7 B2):
 * - `none`: no bar word (`Log Press`, `Hex Deadlift`);
 * - a bar kind: the name says exactly that one bar and no other equipment;
 * - `unclear`: Smith, two bar kinds (`EZ Barbell … ` is one; `Olympic EZ Bar
 *   Curl`, `Barbell Hex Bar Deadlift` are two), or a bar alongside other
 *   equipment (`EZ Bar Cable Curl`). `bar` is the one bar kind it says, if any.
 */
export function barWordsIn(name: string): { kind: 'none' } | { kind: 'one'; bar: ImportBarKind } | { kind: 'unclear'; bar: ImportBarKind | null } {
  const named = equipmentInName(name);
  if (named === null) return { kind: 'none' };
  const bars = IMPORT_BAR_KINDS.filter((b) => named.has(b));
  const only = bars.length === 1 ? (bars[0] ?? null) : null;
  if (named.has('smith')) return { kind: 'unclear', bar: null };
  if (bars.length === 0) return { kind: 'none' };
  if (only === null) return { kind: 'unclear', bar: null };
  return named.size === 1 ? { kind: 'one', bar: only } : { kind: 'unclear', bar: only };
}

/**
 * What the matcher reads from a candidate's own names, worked out once per
 * candidate object (candidates are read-only), so a preview re-analysed
 * after every answer doesn't re-read every name (check 27).
 */
interface CandidateWords {
  /** `comparedTokens` of its name and each other name. */
  tokens: readonly string[][];
  /** `implementCue` of its name and each other name. */
  cues: readonly (ImplementCount | 'unclear' | null)[];
  /** Its name says Smith. */
  smith: boolean;
}

const WORDS = new WeakMap<MatchCandidate, CandidateWords>();

function wordsOf(c: MatchCandidate): CandidateWords {
  let w = WORDS.get(c);
  if (!w) {
    const names = [c.name, ...c.aliases];
    w = { tokens: names.map(comparedTokens), cues: names.map(implementCue), smith: SMITH.test(plainText(c.name)) };
    WORDS.set(c, w);
  }
  return w;
}

/** An exercise's equipment for matching: a Smith machine exercise (its name says Smith) is `smith` only. */
function candidateEquipment(c: MatchCandidate): readonly NamedEquipment[] {
  return wordsOf(c).smith ? ['smith'] : c.compatibleEquipment;
}

/** How a candidate's equipment compares with the name's: `agrees`, `contradicts`, or `unknown` (the name or the exercise names none). */
function equipmentFit(named: ReadonlySet<NamedEquipment> | null, c: MatchCandidate): 'agrees' | 'contradicts' | 'unknown' {
  const own = candidateEquipment(c);
  if (named === null || own.length === 0) return 'unknown';
  return own.some((k) => named.has(k)) ? 'agrees' : 'contradicts';
}

/** Whether an exercise's equipment contradicts an equipment word in a name (`Smith` vs a weight stack, `Dumbbell` vs a barbell). */
export function equipmentContradicts(name: string, c: MatchCandidate): boolean {
  return equipmentFit(equipmentInName(name), c) === 'contradicts';
}

/**
 * Words that count arms are left out of the comparison, so `Lat Pulldown`
 * and `Single-arm lat pulldown` compare alike. Of tied exercises, those whose
 * own name says the same count as the source name (one, two, or nothing)
 * go on: `Lat Pulldown (Pulley)` is the lat pulldown, `Single Arm Cable Row
 * (Pulley)` the single-arm cable row. When none does, all go on.
 */
function sameCount(tied: readonly MatchCandidate[], cue: ImplementCount | 'unclear' | null): readonly MatchCandidate[] {
  if (cue === 'unclear') return tied;
  const agreeing = tied.filter((c) => wordsOf(c).cues[0] === cue);
  return agreeing.length > 0 ? agreeing : tied;
}

/**
 * The single exercise among tied candidates, preferring those whose
 * equipment agrees with the name's. Null when equipment can't break the tie:
 * the matcher can't tell them apart, so it suggests nothing rather than the
 * first by name (review r4 S3).
 */
function breakTie(tied: readonly MatchCandidate[], named: ReadonlySet<NamedEquipment> | null): string | null {
  const ids = (list: readonly MatchCandidate[]) => [...new Set(list.map((c) => c.exerciseId))];
  if (ids(tied).length === 1) return tied[0]?.exerciseId ?? null;
  const agreeing = tied.filter((c) => equipmentFit(named, c) === 'agrees');
  const left = ids(agreeing);
  return left.length === 1 ? (left[0] ?? null) : null;
}

/** Scores this close are a tie. */
const TIE = 1e-9;

/**
 * Whether an exercise may stand for a name, given its Smith and assist
 * words (review r5 S3, r6 B2, B3). Both ways, because each decides a stored
 * value:
 * - a Smith machine exercise only for a name that says Smith, and a name
 *   that says Smith only a Smith machine exercise: `Smith Machine Barbell
 *   Squat` is never the free-barbell back squat, whose "plates only" would
 *   add the Olympic bar;
 * - an assisted machine only for a name that says assisted (80 kg on a
 *   stack is never 80 kg of help), and a name that says assisted only an
 *   assisted or bodyweight exercise (a bodyweight one asks how its values
 *   read): `Assisted Shoulder Press Machine` is never the stack shoulder
 *   press, whose values would be stored as a load.
 */
function kindFits(c: MatchCandidate, smith: boolean, assisted: boolean): boolean {
  if (wordsOf(c).smith !== smith) return false;
  if (c.defaultLoadConvention === 'assistance') return assisted;
  return !assisted || c.defaultLoadConvention === 'bodyweight';
}

/**
 * Whether the source name is one of the exercise's own names: its name or a
 * catalogue name for it, ignoring case and spacing (source (a) of the PM
 * decision). Not for an exercise an earlier import made from the name
 * (`importMade`): that name is the import's answer, which counts only while
 * the import is in effect, through the remembered answer (review r5 S2).
 */
export function namesExercise(sourceName: string, c: MatchCandidate): boolean {
  if (c.importMade === true) return false;
  const key = nameKey(sourceName);
  return nameKey(c.name) === key || c.aliases.some((a) => nameKey(a) === key);
}

/**
 * Match one source name. `aliases` are Ben's saved answers by name key
 * (they win over everything). A tie is never broken by candidate order.
 */
export function matchName(name: string, candidates: readonly MatchCandidate[], aliases: ReadonlyMap<string, AliasTarget>): NameMatch {
  const key = nameKey(name);
  const saved = aliases.get(key);
  if (saved?.kind === 'skip') return { status: 'matched', exerciseId: null, via: 'alias', skip: true };
  if (saved?.kind === 'exercise' && candidates.some((c) => c.exerciseId === saved.exerciseId)) {
    return { status: 'matched', exerciseId: saved.exerciseId, via: 'alias', skip: false };
  }
  const named = equipmentInName(name);
  const assisted = named?.has('assisted_stack') === true;
  const smith = named?.has('smith') === true;
  const own = candidates.filter((c) => c.importMade !== true);
  const byName = own.filter((c) => nameKey(c.name) === key);
  const byAlias = own.filter((c) => c.aliases.some((a) => nameKey(a) === key));
  const exact = [...new Set([...byName, ...byAlias].map((c) => c.exerciseId))];
  if (exact.length === 1) return { status: 'matched', exerciseId: exact[0] ?? null, via: 'name', skip: false };
  if (exact.length > 1) {
    // Two exercises share the name: an exercise's own name beats another's other name, then the Smith and assist words, then equipment. Ben confirms either way.
    const pick = breakTie((byName.length > 0 ? byName : byAlias).filter((c) => kindFits(c, smith, assisted)), named);
    if (pick !== null) return { status: 'check', exerciseId: pick, via: 'name', skip: false };
  }

  const words = comparedTokens(name);
  const cue = implementCue(name);
  let best = 0;
  let tied: MatchCandidate[] = [];
  for (const c of candidates) {
    // Never suggest an exercise whose equipment contradicts a word in the name.
    if (equipmentFit(named, c) === 'contradicts') continue;
    // Smith and assist words, both ways (review r5 S3, r6 B2, B3).
    if (!kindFits(c, smith, assisted)) continue;
    // Never one dumbbell for a name that says two, or two for one that says one (review r5 N1).
    if (countContradicts(cue, c)) continue;
    const score = Math.max(...wordsOf(c).tokens.map((t) => similarity(words, t)));
    if (score < SUGGEST_THRESHOLD || score < best - TIE) continue;
    if (score > best + TIE) {
      best = score;
      tied = [c];
    } else tied.push(c);
  }
  const pick = tied.length === 0 ? null : breakTie(sameCount(tied, cue), named);
  if (pick !== null) return { status: 'check', exerciseId: pick, via: 'words', skip: false };
  return { status: 'no_match', exerciseId: null, via: null, skip: false };
}

/**
 * Words in a name that say one implement (`One-Arm`, `Single`, `Concentration`,
 * `Goblet`) or two (`Two-Arm`, `Double`, `Alternating`). `Two-hand` says
 * neither: one dumbbell can be held in both hands (review r4 S1). Nor does
 * an alternate grip (`Alternate Grip Dumbbell Row`; review r6 N3).
 */
const ONE_IMPLEMENT = / ((one|1|single) ?(arm|arms|armed|hand|hands|handed|leg|legged|side|sided)|single|unilateral|concentration|goblet|suitcase|sa) /;
const TWO_IMPLEMENT = / ((two|2) ?(arm|arms|armed|dumbbells?|dbs?|kettlebells?|kbs?)|double|dual|alternating|alternate|alt) /;
const ALTERNATE_GRIP = / (?:alternating|alternate|alt) (?=grips? )/g;

/** What a name says about the number of dumbbells or kettlebells: 1, 2, `unclear` (both kinds of word), or null (nothing). */
export function implementCue(name: string): ImplementCount | 'unclear' | null {
  const text = plainText(name).replaceAll(ALTERNATE_GRIP, ' ');
  const one = ONE_IMPLEMENT.test(text);
  const two = TWO_IMPLEMENT.test(text);
  if (one && two) return 'unclear';
  return one ? 1 : two ? 2 : null;
}

/**
 * A name that says one (or two) and an exercise one of whose own names says
 * the other (`Two-Arm Dumbbell Row` and the one-arm row; `Double Kettlebell
 * Press` and the kettlebell press, also called `Single-arm kettlebell
 * press`): never suggested (review r5 N1). Words are compared with words:
 * a one-arm version of a two-dumbbell movement (`Dumbbell Bench Press
 * (Single Arm)`) can still be suggested as that movement; its count is
 * asked (`implementsFor`).
 */
function countContradicts(cue: ImplementCount | 'unclear' | null, c: MatchCandidate): boolean {
  if (cue !== 1 && cue !== 2) return false;
  return wordsOf(c).cues.some((own) => (own === 1 || own === 2) && own !== cue);
}

/**
 * One dumbbell or two for a source name mapped to an exercise (review r4
 * S1, r5 S1). Null means not known, so the import asks with nothing
 * selected. The count changes the stored value ("Both together" halves a
 * pair), so it is never taken from a word suggestion, however the name was
 * mapped (its words, `Use this`, `Choose…` or an earlier answer):
 * - The catalogue doesn't record it: null.
 * - The name says one (`One-Arm …`, `Concentration`) or two (`Alternating`):
 *   the catalogue's count when they agree (source (c)), else null.
 * - The name says neither: the catalogue's count, one or two, only when the
 *   name is one of the exercise's own names (source (a)) and that name
 *   doesn't owe its count to a word the source name lacks. `Dumbbell Curl`
 *   is a pair and `Dumbbell Pullover` one dumbbell; `Dumbbell Preacher Curl`
 *   suggested as the dumbbell curl, `Dumbbell Row` (a name of the one-arm
 *   row) and `Dumbbell Squat` (suggested as the goblet squat) are asked.
 */
export function implementsFor(sourceName: string, c: MatchCandidate): ImplementCount | null {
  if (c.implements === null) return null;
  const cue = implementCue(sourceName);
  if (cue !== null) return cue === c.implements ? c.implements : null;
  return namesExercise(sourceName, c) && wordsOf(c).cues[0] === null ? c.implements : null;
}

/**
 * Whether the bar a `total` exercise uses is known for this source name
 * (PM decision, review r5): the name is one of the exercise's own names
 * (source (a)), or names that bar (`Barbell`, `BB`, `Olympic`, `EZ-Bar`,
 * `Trap Bar`; source (c)), and only when it says exactly one bar kind and
 * no other equipment (`barWordsIn`, review r7 B2: `EZ Barbell Curl` chosen
 * as the barbell curl is asked). `newBarFromName` reads the same
 * `barWordsIn` for `Add new` → Barbell (review r6.2 B1). Otherwise "plates only" would add a bar the name never mentioned
 * (`Log Press` taken as the overhead press), so the barbell group answer
 * doesn't reach it and it is asked on its own. A name that says Smith names
 * a Smith machine's bar, whatever else it says: `Smith Machine Barbell
 * Squat` chosen as the back squat never gets the Olympic bar's weight from
 * the group answer (review r6 B2).
 */
export function barNamed(sourceName: string, c: MatchCandidate, bar: ImportBarKind): boolean {
  if (namesExercise(sourceName, c)) return true;
  const words = barWordsIn(sourceName);
  return words.kind === 'one' && words.bar === bar;
}

/** The name says Smith (a Smith machine, whose bar isn't the Olympic bar; review r6 B2). */
export function saysSmith(sourceName: string): boolean {
  return equipmentInName(sourceName)?.has('smith') === true;
}

/**
 * The exercise picker's search inside an import (`Choose…`): every word of
 * the query must start a word of the name or one of its other names.
 */
export function searchCandidates(candidates: readonly MatchCandidate[], query: string): MatchCandidate[] {
  const words = query.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w !== '');
  const sorted = [...candidates].sort((a, b) => a.name.localeCompare(b.name));
  if (words.length === 0) return sorted;
  return sorted.filter((c) =>
    [c.name, ...c.aliases].some((n) => {
      const nameWords = n.toLowerCase().split(/[^a-z0-9]+/);
      return words.every((w) => nameWords.some((x) => x.startsWith(w)));
    }),
  );
}
