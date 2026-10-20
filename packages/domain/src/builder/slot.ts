import { infoOrDefault } from './arrange';
import { BUILDER_SET_RULES, setRowsFor } from './set-rows';
import type { BuilderContext, BuilderSlot } from './types';

/** `makeSlot`: one exercise's slot with the default shape (§3.1.9) and its rows and loads. */
export function makeSlot(exerciseId: string, opts: { main: boolean; workingSets?: number }, ctx: BuilderContext): BuilderSlot {
  const info = infoOrDefault(ctx.info, exerciseId);
  const repRange = opts.main ? { ...BUILDER_SET_RULES.mainRange } : { ...BUILDER_SET_RULES.accessoryRange };
  const sets = opts.workingSets ?? (opts.main ? BUILDER_SET_RULES.mainSets : BUILDER_SET_RULES.accessorySets);
  const r = setRowsFor({ main: opts.main, role: info.role, barbell: info.barbell, workingSets: sets, repRange, load: ctx.loads(exerciseId) });
  return { key: ctx.newKey(exerciseId), exerciseId, main: opts.main, repRange, rows: r.rows, unit: r.unit, convention: r.convention, source: r.source, startLight: r.startLight, anchorE1rm: r.anchorE1rm };
}

