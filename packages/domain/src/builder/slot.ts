import { infoOrDefault } from './arrange';
import { slotLoadOf, slotRepRange } from './reps';
import { BUILDER_SET_RULES, setRowsFor } from './set-rows';
import type { BuilderContext, BuilderSlot } from './types';

/** `makeSlot`: one exercise's slot with the default shape (§3.1.9), reps from history (`slotRepRange`), and its rows and loads. */
export function makeSlot(exerciseId: string, opts: { main: boolean; workingSets?: number }, ctx: BuilderContext): BuilderSlot {
  const info = infoOrDefault(ctx.info, exerciseId);
  const sets = opts.workingSets ?? (opts.main ? BUILDER_SET_RULES.mainSets : BUILDER_SET_RULES.accessorySets);
  const load = slotLoadOf(ctx.loads(exerciseId), opts.main);
  // Reps from history (21 Oct): a slot's reps follow Ben's last session of this exercise through the built-in rule.
  const repRange = slotRepRange(opts.main, load);
  const r = setRowsFor({ main: opts.main, role: info.role, barbell: info.barbell, workingSets: sets, repRange, load, group: info.group, ...(info.warmup === undefined ? {} : { facts: info.warmup }) });
  const hv = load.historyVersion ?? null;
  return { key: ctx.newKey(exerciseId), exerciseId, main: opts.main, repRange, rows: r.rows, unit: r.unit, convention: r.convention, source: r.source, startLight: r.startLight, anchorE1rm: r.anchorE1rm, ...(hv === null ? {} : { historyVersion: hv }) };
}

