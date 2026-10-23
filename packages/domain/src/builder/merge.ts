import { bandInsertIndex, infoOrDefault, pairSlots, unpairAuto } from './arrange';
import { ACCESSORY_STYLES, type AccessoryStyle, type BuilderPool, type BuilderSetup, type GroupCount } from './build';
import { fitToMinutes, removeSlot, type BuilderFitResult } from './fit';
import { setWorkingCount, workingCount } from './set-rows';
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
  | { kind: 'supersets'; on: boolean }
  /** (D3, Today's Accessories on Your workout) The day's main-group accessories set to a style. */
  | { kind: 'accessories'; style: AccessoryStyle };

export type MergeResult =
  | { kind: 'rebuild'; reason: 'day' | 'main_lift' | 'variation' }
  | { kind: 'unchanged'; workout: BuilderWorkout }
  | { kind: 'merged'; workout: BuilderWorkout; changes: MergeChange[]; fit: BuilderFitResult | null };

const countOf = (groups: readonly GroupCount[], g: BuilderGroupName): number => groups.find((x) => x.group === g)?.count ?? 0;

/**
 * `mergeSetupChange`: from `prev` to `next` set-up over Ben's edited workout.
 * Group counts add or remove only that group's exercises (removing untouched
 * ones first, from the end; a new one goes in its §3.4 band and is paired only with a single Ben
 * didn't unlink); Supersets re-pairs only pairs the builder made;
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

  const added = new Set<string>();
  // (D3) Today's Accessories style: the main group's accessories follow the style (its count is the style's, not a row).
  const mainSlot = all().find((s) => s.main);
  const styleGroup = next.accessories !== undefined && prev.accessories !== next.accessories ? (mainSlot === undefined ? (next.groups[0]?.group ?? null) : groupOf(mainSlot)) : null;
  if (styleGroup !== null && next.accessories !== undefined) {
    const r = applyAccessoryStyleTo(w, next.accessories, styleGroup, pool, ctx);
    w = r.workout;
    for (const k of r.added) added.add(k);
    changes.push({ kind: 'accessories', style: next.accessories });
  }
  const groups = new Set<BuilderGroupName>([...prev.groups.map((g) => g.group), ...next.groups.map((g) => g.group)]);
  for (const g of groups) {
    if (g === styleGroup) continue;
    let diff = countOf(next.groups, g) - countOf(prev.groups, g);
    while (diff > 0) {
      const id = pool(g).find((x) => !all().some((s) => s.exerciseId === x) && ctx.info(x) !== null);
      if (id === undefined) {
        changes.push({ kind: 'group_short', group: g });
        break;
      }
      const slot = makeSlot(id, { main: false }, ctx);
      const block: BuilderBlock = { slots: [slot], auto: false };
      // §3.4 bands, as filling time does: a compound before the isolations, abs last (review builder-order B1).
      const blocks = [...w.blocks];
      blocks.splice(bandInsertIndex(blocks, slot, ctx.info, [g]), 0, block);
      w = { ...w, blocks };
      added.add(slot.key);
      changes.push({ kind: 'group_added', group: g, slotKey: slot.key, exerciseId: id });
      diff -= 1;
    }
    while (diff < 0) {
      const cand = [...all()].reverse().filter((s) => groupOf(s) === g && !s.main);
      const s = cand.find((x) => x.touched !== true) ?? cand[0];
      if (s === undefined) break;
      const pair = w.blocks.find((b) => b.auto && b.slots.length === 2 && b.slots.some((x) => x.key === s.key));
      w = removeSlot(w, s.key);
      // Abs its partner leaves go back to the end (abs last, §3.4), free to pair again (review builder-order B1).
      const left = pair?.slots.find((x) => x.key !== s.key);
      if (left !== undefined && groupOf(left) === 'Abs') {
        w = { ...w, blocks: [...w.blocks.filter((b) => !b.slots.some((x) => x.key === left.key)), { slots: [left], auto: false }] };
        added.add(left.key);
      }
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
  } else if (next.supersets && added.size > 0) {
    // Only the new exercises get a partner; Ben's unlinked singles and pairs stay (review B3).
    w = { ...w, blocks: pairSlots(w.blocks, ctx.info, { only: added }) };
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

/**
 * (D3, Ben 22–23 Oct: Today's Accessories moved into Your workout) The main group's accessories as a style: Focused
 * 2 × 3 sets, Varied 3 × 2 at different angles (`ACCESSORY_STYLES`). Extra ones go from the end (one Ben didn't edit
 * first); a missing one is the pool's next not already in the workout (Varied: at an angle not yet used), in its §3.4
 * band. Accessories Ben edited (`touched`) keep their sets; the main lift and every other group are left as they are.
 */
export function applyAccessoryStyleTo(input: BuilderWorkout, style: AccessoryStyle, group: BuilderGroupName, pool: BuilderPool, ctx: BuilderContext): { workout: BuilderWorkout; added: string[] } {
  const { accessories, sets } = ACCESSORY_STYLES[style];
  const groupOf = (s: BuilderSlot) => infoOrDefault(ctx.info, s.exerciseId).group;
  let w: BuilderWorkout = input;
  const acc = () => w.blocks.flatMap((b) => b.slots).filter((s) => !s.main && groupOf(s) === group);
  while (acc().length > accessories) {
    const list = [...acc()].reverse();
    const s = list.find((x) => x.touched !== true) ?? list[0];
    if (s === undefined) break;
    w = removeSlot(w, s.key);
  }
  const added: string[] = [];
  const present = () => new Set(w.blocks.flatMap((b) => b.slots.map((s) => s.exerciseId)));
  while (acc().length < accessories) {
    const angles = new Set(w.blocks.flatMap((b) => b.slots).filter((s) => groupOf(s) === group).map((s) => infoOrDefault(ctx.info, s.exerciseId).angle));
    const candidates = pool(group).filter((id) => !present().has(id) && ctx.info(id) !== null);
    const id = (style === 'varied' ? candidates.find((c) => !angles.has(infoOrDefault(ctx.info, c).angle)) : undefined) ?? candidates[0];
    if (id === undefined) break;
    const slot = makeSlot(id, { main: false, workingSets: sets }, ctx);
    const blocks = [...w.blocks];
    blocks.splice(bandInsertIndex(blocks, slot, ctx.info, [group]), 0, { slots: [slot], auto: false });
    w = { ...w, blocks };
    added.push(slot.key);
  }
  const keep = new Set(added);
  w = { ...w, blocks: w.blocks.map((b) => ({ ...b, slots: b.slots.map((s) => (s.main || s.touched === true || keep.has(s.key) || groupOf(s) !== group || workingCount(s) === sets ? s : setWorkingCount(s, sets))) })) };
  return { workout: w, added };
}
