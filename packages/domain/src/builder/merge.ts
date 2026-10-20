import { infoOrDefault, pairSlots, unpairAuto } from './arrange';
import type { BuilderPool, BuilderSetup, GroupCount } from './build';
import { fitToMinutes, removeSlot, type BuilderFitResult } from './fit';
import { makeSlot } from './slot';
import type { BuilderBlock, BuilderContext, BuilderGroupName, BuilderSlot, BuilderWorkout } from './types';

/**
 * Back to Set up (workout-builder-v3 §2.3, Ben "agreed" 20 Oct): Ben's edits
 * on Your workout are kept. Length, Supersets and group changes MERGE into
 * the edited workout; a change of Day, Main lift or Variation is a REBUILD
 * (the caller builds afresh and keeps both pages for `Rebuilt · Undo`).
 */

export interface SetupIdentity {
  dayId: string | null;
  mainLiftExerciseId: string | null;
  variationId: string | null;
}

export type MergeChange =
  | { kind: 'group_added'; group: BuilderGroupName; slotKey: string; exerciseId: string }
  | { kind: 'group_removed'; group: BuilderGroupName; slotKey: string; exerciseId: string }
  | { kind: 'group_short'; group: BuilderGroupName }
  | { kind: 'supersets'; on: boolean };

export type MergeResult =
  | { kind: 'rebuild'; reason: 'day' | 'main_lift' | 'variation' }
  | { kind: 'unchanged'; workout: BuilderWorkout }
  | { kind: 'merged'; workout: BuilderWorkout; changes: MergeChange[]; fit: BuilderFitResult | null };

const countOf = (groups: readonly GroupCount[], g: BuilderGroupName): number => groups.find((x) => x.group === g)?.count ?? 0;

/**
 * `mergeSetupChange`: from `prev` to `next` set-up over Ben's edited workout.
 * Group counts add or remove only that group's exercises (removing untouched
 * ones first, from the end); Supersets re-pairs only pairs the builder made;
 * a length change trims or adds sets (`fitToMinutes`, no new exercises).
 */
export function mergeSetupChange(
  prev: BuilderSetup & SetupIdentity,
  next: BuilderSetup & SetupIdentity,
  workout: BuilderWorkout,
  pool: BuilderPool,
  ctx: BuilderContext,
): MergeResult {
  if (prev.dayId !== next.dayId) return { kind: 'rebuild', reason: 'day' };
  if (prev.mainLiftExerciseId !== next.mainLiftExerciseId) return { kind: 'rebuild', reason: 'main_lift' };
  if (prev.variationId !== next.variationId) return { kind: 'rebuild', reason: 'variation' };

  const changes: MergeChange[] = [];
  let w: BuilderWorkout = { ...workout, blocks: workout.blocks.map((b) => ({ ...b, slots: [...b.slots] })) };
  const groupOf = (s: BuilderSlot) => infoOrDefault(ctx.info, s.exerciseId).group;
  const all = () => w.blocks.flatMap((b) => b.slots);

  const groups = new Set<BuilderGroupName>([...prev.groups.map((g) => g.group), ...next.groups.map((g) => g.group)]);
  for (const g of groups) {
    let diff = countOf(next.groups, g) - countOf(prev.groups, g);
    while (diff > 0) {
      const id = pool(g).find((x) => !all().some((s) => s.exerciseId === x) && ctx.info(x) !== null);
      if (id === undefined) {
        changes.push({ kind: 'group_short', group: g });
        break;
      }
      const slot = makeSlot(id, { main: false }, ctx);
      const block: BuilderBlock = { slots: [slot], auto: false };
      const absAt = w.blocks.findIndex((b) => b.slots.every((s) => groupOf(s) === 'Abs'));
      const blocks = [...w.blocks];
      if (absAt < 0 || g === 'Abs') blocks.push(block);
      else blocks.splice(absAt, 0, block);
      w = { ...w, blocks };
      changes.push({ kind: 'group_added', group: g, slotKey: slot.key, exerciseId: id });
      diff -= 1;
    }
    while (diff < 0) {
      const cand = [...all()].reverse().filter((s) => groupOf(s) === g && !s.main);
      const s = cand.find((x) => x.touched !== true) ?? cand[0];
      if (s === undefined) break;
      w = removeSlot(w, s.key);
      changes.push({ kind: 'group_removed', group: g, slotKey: s.key, exerciseId: s.exerciseId });
      diff += 1;
    }
  }

  if (prev.supersets && !next.supersets) {
    w = { ...w, blocks: unpairAuto(w.blocks) };
    changes.push({ kind: 'supersets', on: false });
  } else if (!prev.supersets && next.supersets) {
    w = { ...w, blocks: pairSlots(w.blocks, ctx.info) };
    changes.push({ kind: 'supersets', on: true });
  } else if (next.supersets && changes.some((c) => c.kind === 'group_added')) {
    w = { ...w, blocks: pairSlots(w.blocks, ctx.info) };
  }

  let fit: BuilderFitResult | null = null;
  if (prev.minutes !== next.minutes) {
    const main = all().find((s) => s.main);
    const mainGroup = main === undefined ? (next.groups[0]?.group ?? null) : groupOf(main);
    fit = fitToMinutes(w, ctx, { minutes: next.minutes, mainGroup, grow: next.minutes > prev.minutes, supersets: next.supersets, addCandidates: { arm: [], mainGroup: [] } });
    w = fit.workout;
  }
  if (changes.length === 0 && (fit === null || fit.steps.length === 0)) return { kind: 'unchanged', workout };
  return { kind: 'merged', workout: w, changes, fit };
}
