import { BUILDER_GROUP_PARTS, BUILDER_GROUPS, builderGroupOfPart, builderGroupOfParts, type BuilderGroup, type BuilderSetup as StoredSetup, type SplitBodyPart } from '@fizz/schemas';
import { BUILDER_DAY_MIXES, type BuilderSetup, type GroupCount, type LegPart } from './build';
import type { SetupIdentity } from './merge';

/**
 * Set up's rows as stored (`BuilderSetupSchema`: body parts and counts) and
 * as the rules read them (`GroupCount`s), and each day's mix
 * (workout-builder-v3 §2.2, §3.7). Pure.
 */

/** Set up's `Custom` day ID. */
export const CUSTOM_DAY_ID = 'custom';

/** Preset days with a prototype mix (§3.7). */
const MIX_IDS: ReadonlySet<string> = new Set(Object.keys(BUILDER_DAY_MIXES));

/**
 * The day's mix: the prototype's for the preset days (`chest`, `pull`…);
 * any other split day by its parts in order: the first group 4, every other
 * 1, abs 1 when the day has Core. A custom day: the groups Ben chose, the
 * first 4 and the rest 1.
 */
export function mixForDay(dayId: string, parts: readonly SplitBodyPart[]): GroupCount[] {
  if (MIX_IDS.has(dayId)) return BUILDER_DAY_MIXES[dayId as keyof typeof BUILDER_DAY_MIXES].map((g) => ({ ...g }));
  const groups: BuilderGroup[] = [];
  for (const p of parts) {
    const g = builderGroupOfPart(p);
    if (!groups.includes(g)) groups.push(g);
  }
  const main = groups.filter((g) => g !== 'Abs');
  const out = main.map((g, i): GroupCount => ({ group: g, count: i === 0 ? (g === 'Legs' ? 5 : 4) : 1 }));
  if (groups.includes('Abs')) out.push({ group: 'Abs', count: 1 });
  return out;
}

/** The builder groups a day covers, in its parts' order. */
export function groupsOfParts(parts: readonly SplitBodyPart[]): BuilderGroup[] {
  const out: BuilderGroup[] = [];
  for (const p of parts) {
    const g = builderGroupOfPart(p);
    if (!out.includes(g)) out.push(g);
  }
  return out;
}

/** `Chest, triceps` under a split option (§2.2). */
export function partsLabel(parts: readonly SplitBodyPart[]): string {
  const words = groupsOfParts(parts).map((g) => g.toLowerCase());
  const text = words.join(', ');
  return text.length === 0 ? '' : `${text.charAt(0).toUpperCase()}${text.slice(1)}`;
}

const LEG_PART_OF: Readonly<Record<string, LegPart>> = { Quads: 'quads', Hamstrings: 'hamstrings_glutes', Glutes: 'hamstrings_glutes', Calves: 'calves' };

/** The parts a group row stores: the group's own parts, or a custom day's chosen leg parts. */
export function partsOfGroup(group: BuilderGroup, legParts?: readonly SplitBodyPart[]): SplitBodyPart[] {
  if (group === 'Legs' && legParts !== undefined && legParts.length > 0) return [...legParts];
  return [...BUILDER_GROUP_PARTS[group]];
}

/** Stored set-up → the rules' set-up and identity (§2.3 merge). Rows with no single group are skipped. */
export function ruleSetupOf(s: StoredSetup): BuilderSetup & SetupIdentity {
  const groups: GroupCount[] = [];
  let legParts: LegPart[] | undefined;
  for (const row of s.groups) {
    const g = builderGroupOfParts(row.parts);
    if (g === null || groups.some((x) => x.group === g)) continue;
    groups.push({ group: g, count: row.count });
    if (g === 'Legs' && row.parts.length < BUILDER_GROUP_PARTS.Legs.length) legParts = [...new Set(row.parts.map((p) => LEG_PART_OF[p]).filter((p): p is LegPart => p !== undefined))];
  }
  return {
    minutes: s.minutes,
    mainLiftExerciseId: s.mainLiftExerciseId,
    supersets: s.supersets,
    groups,
    ...(legParts === undefined ? {} : { legParts }),
    ...(s.accessories === undefined ? {} : { accessories: s.accessories }),
    dayId: s.dayId,
    variationId: s.variationId ?? null,
  };
}

/** Group counts in stored form, in display order. */
export function storedGroupsOf(groups: readonly GroupCount[], legParts?: readonly SplitBodyPart[]): StoredSetup['groups'] {
  return groups.filter((g) => g.count > 0).map((g) => ({ parts: partsOfGroup(g.group, legParts), count: Math.max(1, Math.min(4, Math.round(g.count))) }));
}

/** The groups `＋ Add muscle group` can still add (§2.2), in the builder's order. */
export function groupsToAdd(present: readonly BuilderGroup[]): BuilderGroup[] {
  return BUILDER_GROUPS.filter((g) => !present.includes(g));
}
