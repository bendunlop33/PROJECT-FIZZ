import type { AliasTarget, ExerciseEquipmentKind, ImplementCount, Laterality, LoadConvention } from '@fizz/schemas';
import { deriveId } from '../stable';

/**
 * Exercise name matching for imports (data-import-export §2.5 step 3a). Pure.
 *
 * - `matched`: the name equals (ignoring case and spacing) an exercise's name
 *   or one of its catalogue names, or a name Ben answered in an earlier import
 *   (a saved alias).
 * - `check`: a suggestion from the words of the name only. Ben confirms it.
 *   A suggestion never contradicts an equipment word in the name (`Flat
 *   Dumbbell Bench Press` is never the barbell bench press), and a tie is
 *   broken on equipment, never by alphabetical order: a tie equipment can't
 *   break gives no suggestion (review r4 S3).
 * - `no_match`: nothing suggested.
 * No score is shown or stored: the matcher has no calibrated confidence.
 * Names are data, never instructions (rule 8).
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
 * Equipment words in a name and the equipment kinds each allows (review r4
 * S3). `Machine` allows any machine; `Smith` and `Hammer Strength` are
 * plate-loaded or stack machines, never a free barbell.
 */
const EQUIPMENT_WORDS: readonly [RegExp, readonly ExerciseEquipmentKind[]][] = [
  [/ (dumbbells?|dbs?) /, ['dumbbells']],
  [/ (barbells?|bb) /, ['barbell']],
  [/ (ez ?bar|ez) /, ['ez_bar']],
  [/ (trap|hex) ?bar /, ['trap_bar']],
  [/ (kettlebells?|kbs?) /, ['kettlebell']],
  [/ (cables?|pulley) /, ['weight_stack']],
  [/ smith /, ['plate_loaded_machine', 'weight_stack']],
  [/ hammer strength /, ['plate_loaded_machine', 'weight_stack']],
  [/ machines? /, ['weight_stack', 'plate_loaded_machine', 'assisted_stack']],
  [/ (bands?|banded) /, ['band']],
];

/**
 * The equipment a name says it uses (`Flat Dumbbell Bench Press` →
 * dumbbells), or null when it names none. Several words allow any of their
 * kinds (`Smith Machine …`).
 */
export function equipmentInName(name: string): ReadonlySet<ExerciseEquipmentKind> | null {
  const text = plainText(name);
  const kinds = new Set<ExerciseEquipmentKind>();
  for (const [re, allowed] of EQUIPMENT_WORDS) if (re.test(text)) for (const k of allowed) kinds.add(k);
  return kinds.size === 0 ? null : kinds;
}

/** How a candidate's equipment compares with the name's: `agrees`, `contradicts`, or `unknown` (the name or the exercise names none). */
function equipmentFit(named: ReadonlySet<ExerciseEquipmentKind> | null, c: MatchCandidate): 'agrees' | 'contradicts' | 'unknown' {
  if (named === null || c.compatibleEquipment.length === 0) return 'unknown';
  return c.compatibleEquipment.some((k) => named.has(k)) ? 'agrees' : 'contradicts';
}

/**
 * The single exercise among tied candidates, preferring those whose
 * equipment agrees with the name's. Null when equipment can't break the tie:
 * the matcher can't tell them apart, so it suggests nothing rather than the
 * first by name (review r4 S3).
 */
function breakTie(tied: readonly MatchCandidate[], named: ReadonlySet<ExerciseEquipmentKind> | null): string | null {
  const ids = (list: readonly MatchCandidate[]) => [...new Set(list.map((c) => c.exerciseId))];
  if (ids(tied).length === 1) return tied[0]?.exerciseId ?? null;
  const agreeing = tied.filter((c) => equipmentFit(named, c) === 'agrees');
  const left = ids(agreeing);
  return left.length === 1 ? (left[0] ?? null) : null;
}

/** Scores this close are a tie. */
const TIE = 1e-9;

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
  const byName = candidates.filter((c) => nameKey(c.name) === key);
  const byAlias = candidates.filter((c) => c.aliases.some((a) => nameKey(a) === key));
  const exact = [...new Set([...byName, ...byAlias].map((c) => c.exerciseId))];
  if (exact.length === 1) return { status: 'matched', exerciseId: exact[0] ?? null, via: 'name', skip: false };
  if (exact.length > 1) {
    // Two exercises share the name: an exercise's own name beats another's other name, then equipment decides. Ben confirms either way.
    const pick = breakTie(byName.length > 0 ? byName : byAlias, named);
    if (pick !== null) return { status: 'check', exerciseId: pick, via: 'name', skip: false };
  }

  const words = nameTokens(name);
  let best = 0;
  let tied: MatchCandidate[] = [];
  for (const c of candidates) {
    // Never suggest an exercise whose equipment contradicts a word in the name.
    if (equipmentFit(named, c) === 'contradicts') continue;
    const score = Math.max(...[c.name, ...c.aliases].map((n) => similarity(words, nameTokens(n))));
    if (score < SUGGEST_THRESHOLD || score < best - TIE) continue;
    if (score > best + TIE) {
      best = score;
      tied = [c];
    } else tied.push(c);
  }
  const pick = tied.length === 0 ? null : breakTie(tied, named);
  if (pick !== null) return { status: 'check', exerciseId: pick, via: 'words', skip: false };
  return { status: 'no_match', exerciseId: null, via: null, skip: false };
}

/**
 * Words in a name that say one implement (`One-Arm`, `Single`, `Concentration`,
 * `Goblet`) or two (`Two-Arm`, `Double`, `Alternating`). `Two-hand` says
 * neither: one dumbbell can be held in both hands (review r4 S1).
 */
const ONE_IMPLEMENT = / ((one|1|single) ?(arm|arms|armed|hand|hands|handed|leg|legged|side|sided)|single|unilateral|concentration|goblet|suitcase|sa) /;
const TWO_IMPLEMENT = / ((two|2) ?(arm|arms|armed|dumbbells?|dbs?|kettlebells?|kbs?)|double|dual|alternating|alternate|alt) /;

/** What a name says about the number of dumbbells or kettlebells: 1, 2, `unclear` (both kinds of word), or null (nothing). */
export function implementCue(name: string): ImplementCount | 'unclear' | null {
  const text = plainText(name);
  const one = ONE_IMPLEMENT.test(text);
  const two = TWO_IMPLEMENT.test(text);
  if (one && two) return 'unclear';
  return one ? 1 : two ? 2 : null;
}

/**
 * One dumbbell or two for a source name mapped to an exercise (review r4
 * S1). Null means not known, so the import asks with nothing selected.
 * - The catalogue doesn't record it: null.
 * - The name says one (`One-Arm …`, `Concentration`) or two: only when the
 *   catalogue agrees. A one-arm press mapped to the two-dumbbell standing
 *   press, by its words or by Ben, is never read by the pair's answer.
 * - The name says neither: two when the catalogue says two (the usual
 *   case, shown with its conversion before commit). One only when the name
 *   is the catalogue's own name for it, and that name doesn't owe its "one"
 *   to a word the source name lacks: `Dumbbell Pullover` is one dumbbell,
 *   but `Dumbbell Row` (also a name of the one-arm row) and `Dumbbell Squat`
 *   (suggested as the goblet squat) are asked.
 */
export function implementsFor(sourceName: string, c: MatchCandidate): ImplementCount | null {
  if (c.implements === null) return null;
  const cue = implementCue(sourceName);
  if (cue !== null) return cue === c.implements ? c.implements : null;
  if (c.implements === 2) return 2;
  const key = nameKey(sourceName);
  const exact = nameKey(c.name) === key || c.aliases.some((a) => nameKey(a) === key);
  return exact && implementCue(c.name) === null ? 1 : null;
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
