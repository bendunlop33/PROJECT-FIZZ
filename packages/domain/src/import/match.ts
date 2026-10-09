import type { AliasTarget, ExerciseEquipmentKind, Laterality, LoadConvention } from '@fizz/schemas';

/**
 * Exercise name matching for imports (data-import-export §2.5 step 3a). Pure.
 *
 * - `matched`: the name equals (ignoring case and spacing) an exercise's name
 *   or one of its catalogue names, or a name Ben answered in an earlier import
 *   (a saved alias).
 * - `check`: a suggestion from the words of the name only. Ben confirms it.
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

/** Matching key for a source name: lower case, single spaces, trimmed, at most 200 characters. */
export function nameKey(name: string): string {
  return name.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim().slice(0, 200);
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

/**
 * Match one source name. `aliases` are Ben's saved answers by name key
 * (they win over everything); `candidates` must be in a stable order (ties
 * suggest the first).
 */
export function matchName(name: string, candidates: readonly MatchCandidate[], aliases: ReadonlyMap<string, AliasTarget>): NameMatch {
  const key = nameKey(name);
  const saved = aliases.get(key);
  if (saved?.kind === 'skip') return { status: 'matched', exerciseId: null, via: 'alias', skip: true };
  if (saved?.kind === 'exercise' && candidates.some((c) => c.exerciseId === saved.exerciseId)) {
    return { status: 'matched', exerciseId: saved.exerciseId, via: 'alias', skip: false };
  }
  const exact = candidates.filter((c) => nameKey(c.name) === key || c.aliases.some((a) => nameKey(a) === key));
  const distinct = [...new Set(exact.map((c) => c.exerciseId))];
  if (distinct.length === 1) return { status: 'matched', exerciseId: distinct[0] ?? null, via: 'name', skip: false };
  if (distinct.length > 1) return { status: 'check', exerciseId: distinct[0] ?? null, via: 'name', skip: false };

  const words = nameTokens(name);
  let best: { id: string; score: number } | null = null;
  for (const c of candidates) {
    const score = Math.max(...[c.name, ...c.aliases].map((n) => similarity(words, nameTokens(n))));
    if (score >= SUGGEST_THRESHOLD && (best === null || score > best.score)) best = { id: c.exerciseId, score };
  }
  if (best) return { status: 'check', exerciseId: best.id, via: 'words', skip: false };
  return { status: 'no_match', exerciseId: null, via: null, skip: false };
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
