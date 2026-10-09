import type { AliasTarget, AliasUse, ExerciseAlias, PerHandReading } from '@fizz/schemas';

/**
 * What Ben's earlier imports still say about a source name (review r5 S2).
 * Pure.
 *
 * An `ExerciseAlias` keeps one `use` per import that answered or used the
 * name: the exercise (or Skip) it was mapped to and, when that import asked,
 * Ben's dumbbell answer (`null`: he cleared it). Undo import teaches nothing
 * back: an undone import's uses are ignored, so the name and its dumbbell
 * answer fall back to the newest import still in effect, or are asked again
 * with nothing selected when there is none (DX6). Nothing is deleted.
 */

export interface RememberedAnswer {
  target: AliasTarget;
  /** Ben's dumbbell answer for the name, or null when none is in effect. */
  perHand: PerHandReading | null;
}

/** An alias's uses, oldest first. One stored before uses were kept counts as one use by the import that last wrote it. */
export function aliasUses(alias: Pick<ExerciseAlias, 'target' | 'perHand' | 'jobId' | 'uses'>): readonly AliasUse[] {
  if (alias.uses !== undefined) return alias.uses;
  return [{ jobId: alias.jobId, target: alias.target, ...(alias.perHand === undefined ? {} : { perHand: alias.perHand }) }];
}

/**
 * The answer in effect for one alias, ignoring the uses of `undone` imports:
 * the newest remaining use's exercise, and the dumbbell answer of the newest
 * remaining use that said anything about it. Null when every use is undone.
 */
export function rememberedAnswer(alias: Pick<ExerciseAlias, 'target' | 'perHand' | 'jobId' | 'uses'>, undone: ReadonlySet<string>): RememberedAnswer | null {
  const live = aliasUses(alias).filter((u) => !undone.has(u.jobId));
  const last = live.at(-1);
  if (!last) return null;
  const said = [...live].reverse().find((u) => u.perHand !== undefined);
  return { target: last.target, perHand: said?.perHand ?? null };
}

/** Every remembered name and dumbbell answer in effect, by name key (`ImportContext.aliases` / `perHandAnswers`). */
export function rememberedAnswers(
  aliases: readonly Pick<ExerciseAlias, 'nameKey' | 'target' | 'perHand' | 'jobId' | 'uses'>[],
  undone: ReadonlySet<string>,
): { aliases: Map<string, AliasTarget>; perHandAnswers: Map<string, PerHandReading> } {
  const targets = new Map<string, AliasTarget>();
  const perHandAnswers = new Map<string, PerHandReading>();
  for (const a of aliases) {
    const r = rememberedAnswer(a, undone);
    if (!r) continue;
    targets.set(a.nameKey, r.target);
    if (r.perHand !== null) perHandAnswers.set(a.nameKey, r.perHand);
  }
  return { aliases: targets, perHandAnswers };
}
