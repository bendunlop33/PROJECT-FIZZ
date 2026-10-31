import type { BuilderExerciseInfo, BuilderInfoLookup } from './types';

/**
 * Near-duplicate exercises (Ben, 23 Oct: "shouldn't suggest two very similar exercises"; workout-builder-v3 §3.7).
 * Pure. Two exercises are near-duplicates when they are the same movement and train the same primary target, so they
 * differ only by implement or a minor variation: Barbell shrug / Dumbbell shrug, Barbell curl / Dumbbell curl,
 * Incline dumbbell press / Incline bench press, Barbell row / Seated cable row, Lat pulldown / Pull-up.
 *
 * Worked out from the catalogue's own data, not a hand list:
 * - same movement: the catalogue `family` (`shrug`, `curl`, `row`, `bench_press`), read through the small
 *   `SAME_MOVEMENT` table only where the catalogue splits one movement over two families; an exercise with no family
 *   (one of Ben's own) uses its name with the implement words taken out (`Dumbbell Shrugs` → `shrug`);
 * - same primary target: the same lead primary muscle (an `upper_chest` press leads with the upper chest), or the same
 *   set of primary muscles in another order (rows list `lats, upper_back` or `upper_back, lats`).
 *
 * So a hammer curl (brachialis first) is not a near-duplicate of a curl, a flat press not of an incline press, and a
 * shrug not of a row. The builder, Today, Mix it up, the plan builder and the coach never put two in one workout by
 * themselves; Ben can still add one himself (Swap / Add shows it, flagged, and advice notes it without blocking).
 */

/** What the rule reads of an exercise. */
export interface SimilarityFacts {
  name: string;
  /** Catalogue family; null or absent for one of Ben's own exercises without one. */
  family?: string | null | undefined;
  /** Primary muscles in catalogue order (lead first), catalogue words (`upper_chest`, `side_delts`). */
  primaryMuscles: readonly string[];
  mechanic?: 'compound' | 'isolation' | null | undefined;
}

/**
 * Families the catalogue keeps apart that are one movement with another implement (where its data can't tell): a
 * pulldown is the pull-up on a cable stack; a machine chest press is the bench press on a machine.
 */
export const SAME_MOVEMENT: Readonly<Record<string, string>> = {
  pulldown: 'pull_up',
  chest_press: 'bench_press',
};

/** Implement and minor-variation words a custom exercise's name loses before it is compared (`Dumbbell Shrugs`). */
const IMPLEMENT_WORDS: readonly string[] = [
  'plate loaded',
  'plate-loaded',
  'smith machine',
  'ez bar',
  'ez-bar',
  'trap bar',
  'trap-bar',
  'single arm',
  'single-arm',
  'one arm',
  'one-arm',
  'barbell',
  'dumbbells',
  'dumbbell',
  'kettlebell',
  'machine',
  'cable',
  'smith',
  'banded',
  'band',
  'bb',
  'db',
  'kb',
];

function nameStem(name: string): string | null {
  let s = ` ${name.toLowerCase().replace(/[()]/g, ' ')} `;
  for (const w of IMPLEMENT_WORDS) s = s.split(` ${w} `).join(' ');
  const words = s.trim().split(/\s+/).filter((w) => w.length > 0);
  const last = words[words.length - 1];
  if (last === undefined) return null;
  if (/sses$/.test(last)) words[words.length - 1] = last.slice(0, -2);
  else if (last.length > 3 && /[^s]s$/.test(last)) words[words.length - 1] = last.slice(0, -1);
  return words.join('_').replace(/-/g, '_');
}

/** The movement an exercise is (its family through `SAME_MOVEMENT`, else its name's stem); null when unknown. */
export function movementKeyOf(f: Pick<SimilarityFacts, 'name' | 'family'>): string | null {
  const fam = f.family ?? null;
  if (fam !== null && fam !== '') return SAME_MOVEMENT[fam] ?? fam;
  return nameStem(f.name);
}

const norm = (m: string): string => m.trim().toLowerCase().replace(/\s+/g, '_');

/** The muscle an exercise leads with: `upper_chest` for any press listing it, else its first primary. */
export function leadPrimaryOf(primaryMuscles: readonly string[]): string | null {
  const ms = primaryMuscles.map(norm);
  if (ms.includes('upper_chest')) return 'upper_chest';
  return ms[0] ?? null;
}

/** Same lead primary muscle, or the same primaries in another order. */
export function samePrimaryTarget(a: readonly string[], b: readonly string[]): boolean {
  const la = leadPrimaryOf(a);
  const lb = leadPrimaryOf(b);
  if (la === null || lb === null) return false;
  if (la === lb) return true;
  const sa = new Set(a.map(norm));
  const sb = new Set(b.map(norm));
  return sa.size === sb.size && [...sa].every((m) => sb.has(m));
}

/** `nearDuplicate`: same movement and same primary target (never an exercise with itself). */
export function nearDuplicate(a: SimilarityFacts, b: SimilarityFacts): boolean {
  const ka = movementKeyOf(a);
  const kb = movementKeyOf(b);
  if (ka === null || kb === null || ka !== kb) return false;
  return samePrimaryTarget(a.primaryMuscles, b.primaryMuscles);
}

/** The rule's facts from the builder's info (its catalogue facts when it has them, else its name and muscles). */
export function similarityFactsOf(i: Pick<BuilderExerciseInfo, 'name' | 'muscles' | 'role' | 'warmup'>): SimilarityFacts {
  const w = i.warmup;
  const primary = w?.primaryMuscles !== undefined && w.primaryMuscles.length > 0 ? w.primaryMuscles : i.muscles.slice(0, 1);
  return { name: i.name, family: w?.family ?? null, primaryMuscles: primary.map(norm), mechanic: w?.mechanic ?? i.role };
}

/** Whether two builder exercises (by ID) are near-duplicates. Unknown exercises never are. */
export function nearDuplicateIds(a: string, b: string, info: BuilderInfoLookup): boolean {
  if (a === b) return false;
  const ia = info(a);
  const ib = info(b);
  return ia !== null && ib !== null && nearDuplicate(similarityFactsOf(ia), similarityFactsOf(ib));
}

/** A traps-led isolation (a shrug, a Y-raise): at most one per workout the builder makes (Ben, 23 Oct). */
export function trapsIsolation(f: SimilarityFacts): boolean {
  return f.mechanic === 'isolation' && leadPrimaryOf(f.primaryMuscles) === 'traps';
}

/** Why the builder won't pick `candidate` into a workout that has `present`: the exercise it clashes with. */
export type AutoPickClash = { kind: 'near_duplicate'; of: string } | { kind: 'traps_cap'; of: string };

/**
 * `autoPickClash`: the first exercise in `present` the candidate near-duplicates, or the traps isolation already in
 * when it is one too; null when it may go in. For what the builder, Today, Mix it up and the coach pick by themselves.
 */
export function autoPickClash(candidate: string, present: Iterable<string>, info: BuilderInfoLookup): AutoPickClash | null {
  const ci = info(candidate);
  if (ci === null) return null;
  const cf = similarityFactsOf(ci);
  const traps = trapsIsolation(cf);
  for (const id of present) {
    if (id === candidate) continue;
    const pi = info(id);
    if (pi === null) continue;
    const pf = similarityFactsOf(pi);
    if (nearDuplicate(cf, pf)) return { kind: 'near_duplicate', of: id };
    if (traps && trapsIsolation(pf)) return { kind: 'traps_cap', of: id };
  }
  return null;
}

/** Every near-duplicate pair in a list of exercise IDs, in order (`[earlier, later]`). */
export function nearDuplicatePairs(ids: readonly string[], info: BuilderInfoLookup): [string, string][] {
  const out: [string, string][] = [];
  for (let a = 0; a < ids.length; a += 1) {
    for (let b = a + 1; b < ids.length; b += 1) {
      const x = ids[a];
      const y = ids[b];
      if (x !== undefined && y !== undefined && nearDuplicateIds(x, y, info)) out.push([x, y]);
    }
  }
  return out;
}

/**
 * The sub-role an exercise fills in its group, for "an uncovered sub-role before a second exercise for a covered one"
 * (Ben, 23 Oct): its focus heading (`Lats`, `Mid-back`, `Rear delts`, `Upper chest`…), with traps-led work as its own
 * (`Traps`), so a shrug never stands in for a row.
 */
export function subRoleOf(i: Pick<BuilderExerciseInfo, 'name' | 'muscles' | 'role' | 'warmup' | 'angle'>): string {
  return leadPrimaryOf(similarityFactsOf(i).primaryMuscles) === 'traps' ? 'Traps' : i.angle;
}

/** One sub-role a group fills first; `compound`: a compound of it first (a pulldown or pull-up, not a straight-arm pulldown). */
export interface BuilderSubRole {
  role: string;
  compound: boolean;
  /**
   * (Ben, 24 Oct) A main sub-role: Time's fit keeps one exercise for it when it cuts (`fitToMinutes`), cutting other
   * exercises first, then this exercise's sets; past that it gives up the main sub-roles last first.
   */
  main: boolean;
}

/**
 * Sub-roles a group fills before anything else, in order (Ben, 23 Oct): a Back day gets a vertical pull (lats) and a
 * row, each a compound when there is one, then rear-delt work, before traps (shrugs) or anything else. Other groups fill their uncovered sub-roles
 * in the pool's order (a plan day's template leads it), so no fixed order overrides his own exercises.
 */
export const BUILDER_SUB_ROLES: Readonly<Partial<Record<BuilderExerciseInfo['group'], readonly BuilderSubRole[]>>> = {
  Back: [
    { role: 'Lats', compound: true, main: true },
    { role: 'Mid-back', compound: true, main: true },
    { role: 'Rear delts', compound: false, main: false },
  ],
};

/**
 * Swap / Add's order (Ben, 23 Oct: "show it, don't block"): candidates that near-duplicate an exercise in the workout
 * (`present`: the workout without the one being swapped) go last, each with the name of the one it is like
 * (`Like Barbell shrug`); the rest keep their order. Ben can still pick any of them.
 */
export function similarLast(ids: readonly string[], present: readonly string[], info: BuilderInfoLookup): { order: string[]; similarTo: Map<string, string> } {
  const similarTo = new Map<string, string>();
  for (const id of ids) {
    const twin = present.find((p) => nearDuplicateIds(id, p, info));
    if (twin !== undefined) similarTo.set(id, info(twin)?.name ?? twin);
  }
  return { order: [...ids.filter((id) => !similarTo.has(id)), ...ids.filter((id) => similarTo.has(id))], similarTo };
}
