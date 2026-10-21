import { coachEditStepOpId, type FitTodayStep, type FitTodayToTimeCommand, type SessionAggregate, type SessionExercise, type WorkoutSet, type ZonedTimestamp } from '@fizz/schemas';
import { estimateBuilderSeconds } from '../builder/estimate';
import { fitToMinutes, type BuilderFitStatus } from '../builder/fit';
import { restAfterRows, roundRestOf } from '../builder/rest';
import type { BuilderBlock, BuilderContext, BuilderGroupName, BuilderInfoLookup, BuilderSetRow, BuilderSlot, BuilderWorkout, RestLevel } from '../builder/types';

/**
 * The workout's `+N min` offer (workout-table-v3 §5; Ben, 20 Oct): the
 * builder's fit ladder (`fitToMinutes`: shorter rests → RPE 9 → fewer sets →
 * drop an exercise, never the main lift) over the sets not done yet, as one
 * offer. Pure: the screen shows `lines`, and only Ben's Apply sends
 * `fitTodayCommand` (rule 3: never applied unasked). Done sets are never in
 * it (rule 2); it only shortens rests, raises no load and adds nothing.
 *
 * Minutes are the builder's estimate of the sets left (§3.6 formula), not
 * the pace-based Time left: `savedMinutes` is what the fit takes off that.
 */

export interface TimeFitInput {
  aggregate: SessionAggregate;
  /** How far over the plan the workout runs (the header's `+N min`). */
  overByMinutes: number;
  info: BuilderInfoLookup;
  /** Pain-flagged movements (exercise IDs): never trimmed, pushed or dropped (rule 9). */
  painFlagged?: ReadonlySet<string>;
  /** Ben's rest presets (seconds), as the builder's. */
  restPresetsS?: readonly number[];
}

export type TimeFitLine =
  | { kind: 'rest'; sets: number }
  | { kind: 'effort'; sessionExerciseId: string; name: string }
  | { kind: 'sets'; sessionExerciseId: string; name: string; from: number; to: number }
  | { kind: 'drop'; sessionExerciseId: string; name: string };

export interface TimeFitOffer {
  /** `fitted`: the sets left fit the time; `over`: the most the ladder can take off; `none`: nothing to change. */
  status: BuilderFitStatus | 'none';
  beforeMinutes: number;
  afterMinutes: number;
  savedMinutes: number;
  /** The length the sets left were fitted to. */
  targetMinutes: number;
  lines: TimeFitLine[];
  /** The workout's own commands, without `opId` and `at` (`fitTodayCommand` adds them). */
  steps: FitStepDraft[];
  /** The workout's version the offer was made on (rule 5). */
  expectedVersion: number;
}

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
export type FitStepDraft = DistributiveOmit<FitTodayStep, 'opId' | 'at'>;

type FitRow = BuilderSetRow & { setId: string };

const effRpe = (s: WorkoutSet): number | null => s.planned.rpeOverride ?? s.planned.rpe;

const liveOrdered = (a: SessionAggregate): SessionExercise[] => a.exercises.filter((e) => e.removed === undefined).sort((x, y) => x.order - y.order);

const pendingOf = (a: SessionAggregate, exId: string): WorkoutSet[] =>
  a.sets.filter((s) => s.sessionExerciseId === exId && s.status === 'pending').sort((x, y) => x.index - y.index);

/** The main lift: the plan day's (provenance), else one with a Top set, else the first compound in order. */
function mainIds(a: SessionAggregate, live: readonly SessionExercise[], info: BuilderInfoLookup): Set<string> {
  const planned = a.session.planDay?.mainLiftExerciseId ?? null;
  if (planned !== null) {
    const hit = live.filter((e) => e.exerciseId === planned);
    if (hit.length > 0) return new Set(hit.map((e) => e.id));
  }
  const top = live.filter((e) => a.sets.some((s) => s.sessionExerciseId === e.id && s.status !== 'deleted' && s.setType === 'top'));
  if (top.length > 0) return new Set(top.map((e) => e.id));
  const first = live.find((e) => info(e.exerciseId)?.role === 'compound');
  return new Set(first === undefined ? [] : [first.id]);
}

function slotOf(a: SessionAggregate, ex: SessionExercise, main: boolean, touched: boolean): BuilderSlot | null {
  const pending = pendingOf(a, ex.id);
  if (pending.length === 0) return null;
  const rows: FitRow[] = pending.map((s) => ({
    setId: s.id,
    type: s.setType,
    reps: s.planned.reps?.max ?? s.planned.reps?.min ?? 0,
    load: s.planned.load?.value ?? null,
    rpe: s.setType === 'warmup' ? null : effRpe(s),
  }));
  const reps = pending.find((s) => s.planned.reps !== null)?.planned.reps ?? { min: 8, max: 12 };
  return {
    key: ex.id,
    exerciseId: ex.exerciseId,
    main,
    repRange: { min: reps.min, max: reps.max },
    rows,
    unit: ex.unit,
    convention: ex.loadConvention,
    source: 'plan',
    startLight: null,
    anchorE1rm: null,
    ...(touched ? { touched: true as const } : {}),
  };
}

/** The sets left as the builder's workout: one slot per exercise with a pending set, supersets as one block. */
function remainingWorkout(input: TimeFitInput): { w: BuilderWorkout; mainGroup: BuilderGroupName | null } {
  const a = input.aggregate;
  const live = liveOrdered(a);
  const mains = mainIds(a, live, input.info);
  const blocks: BuilderBlock[] = [];
  let lastGroup: string | null = null;
  let mainGroup: BuilderGroupName | null = null;
  for (const ex of live) {
    const pending = pendingOf(a, ex.id);
    // Ben's own edits, pain-flagged movements and anything not counted in reps are left as they are.
    const touched = ex.measurement !== 'reps' || (input.painFlagged?.has(ex.exerciseId) ?? false) || pending.some((s) => s.planned.edit !== undefined);
    const main = mains.has(ex.id);
    if (main && mainGroup === null) mainGroup = input.info(ex.exerciseId)?.group ?? null;
    const slot = slotOf(a, ex, main, touched);
    if (slot === null) continue;
    const last = blocks[blocks.length - 1];
    if (ex.supersetGroup !== null && ex.supersetGroup === lastGroup && last !== undefined) last.slots.push(slot);
    else blocks.push({ slots: [slot], auto: false });
    lastGroup = ex.supersetGroup;
  }
  return { w: { blocks, restLevel: 'normal' }, mainGroup };
}

const rowsOf = (s: BuilderSlot): FitRow[] => s.rows as FitRow[];
const isWork = (r: BuilderSetRow): boolean => r.type !== 'warmup';

/**
 * The pending sets that stay, each with its row after the fit. The fit
 * never touches warm-ups; fewer sets come off the end, last non-top first
 * (`setWorkingCount`), and a set given back (a drop freed time) is a copy
 * at the end, so what stays lines up with the rows after by position.
 */
function aligned(orig: BuilderSlot, after: BuilderSlot): { kept: { setId: string; row: BuilderSetRow; next: BuilderSetRow | undefined }[]; gone: string[] } {
  const rows = [...rowsOf(orig)];
  let extra = rows.filter(isWork).length - after.rows.filter(isWork).length;
  const gone: string[] = [];
  while (extra > 0) {
    const work = rows.filter(isWork);
    const cut = [...work].reverse().find((r) => r.type !== 'top') ?? work[work.length - 1];
    if (cut === undefined) break;
    rows.splice(rows.indexOf(cut), 1);
    gone.push(cut.setId);
    extra -= 1;
  }
  const kept = rows.flatMap((r, i) => {
    const row = after.rows[i];
    return row === undefined ? [] : [{ setId: r.setId, row, next: after.rows[i + 1] }];
  });
  return { kept, gone };
}

/** Rests a level shortens: set ID → seconds, only where it is shorter than now. Warm-ups and the rest before a drop never change. */
function restCuts(a: SessionAggregate, orig: BuilderWorkout, w: BuilderWorkout, info: BuilderInfoLookup, presets?: readonly number[]): Map<string, number> {
  const out = new Map<string, number>();
  const byId = new Map(a.sets.map((s) => [s.id, s]));
  const origSlots = new Map(orig.blocks.flatMap((b) => b.slots.map((x) => [x.key, x] as const)));
  for (const b of w.blocks) {
    const round = b.slots.length > 1 ? roundRestOf(b, w.restLevel, presets) : null;
    for (const slot of b.slots) {
      const o = origSlots.get(slot.key);
      if (o === undefined) continue;
      const targets = restAfterRows(slot, info, w.restLevel, presets);
      aligned(o, slot).kept.forEach((k, i) => {
        const set = byId.get(k.setId);
        if (set === undefined || k.row.type === 'warmup' || k.next?.type === 'drop') return;
        const target = round ?? targets[i];
        if (target === undefined || set.rest.seconds <= 0 || target >= set.rest.seconds) return;
        out.set(k.setId, target);
      });
    }
  }
  return out;
}

const rank = (l: RestLevel): number => (l === 'normal' ? 0 : l === 'shorter' ? 1 : 2);

export function timeFitOffer(input: TimeFitInput): TimeFitOffer {
  const a = input.aggregate;
  const { w: built, mainGroup } = remainingWorkout(input);
  const ctx: BuilderContext = {
    info: input.info,
    ...(input.restPresetsS === undefined ? {} : { restPresetsS: input.restPresetsS }),
    // Shrinking never adds an exercise, so these are never asked for.
    loads: () => ({ unit: 'kg', convention: 'total', equipment: null, coachTarget: null, planFirstLoad: null, ruleTarget: null, e1rm: null, startLightCeiling: null, painCap: null }),
    newKey: (id) => `fit:${id}`,
  };
  // Rests already at a level count as that level, so the ladder's first step changes something.
  let start: RestLevel = 'normal';
  for (const l of ['shorter', 'shortest'] as const) if (restCuts(a, built, { ...built, restLevel: l }, input.info, input.restPresetsS).size === 0) start = l;
  const w: BuilderWorkout = { ...built, restLevel: start };
  const beforeS = estimateBuilderSeconds(w, ctx);
  const targetMinutes = Math.max(1, Math.floor((beforeS - Math.max(0, input.overByMinutes) * 60) / 60));
  const base = { beforeMinutes: Math.round(beforeS / 60), targetMinutes, expectedVersion: a.session.version };
  const none: TimeFitOffer = { ...base, status: 'none', afterMinutes: base.beforeMinutes, savedMinutes: 0, lines: [], steps: [] };
  if (w.blocks.length === 0 || input.overByMinutes <= 0) return none;

  const fit = fitToMinutes(w, ctx, { minutes: targetMinutes, mainGroup, grow: false, supersets: false, floorMinutes: 1 });
  if (fit.status === 'fits') return none;

  const names = new Map(a.exercises.map((e) => [e.id, e.exerciseName]));
  const byId = new Map(a.sets.map((s) => [s.id, s]));
  const kept = new Map(fit.workout.blocks.flatMap((b) => b.slots.map((s) => [s.key, s] as const)));
  const lines: TimeFitLine[] = [];
  const steps: FitStepDraft[] = [];

  // (a) rests
  const rests = rank(fit.workout.restLevel) > rank(start) ? restCuts(a, w, fit.workout, input.info, input.restPresetsS) : new Map<string, number>();
  if (rests.size > 0) lines.push({ kind: 'rest', sets: rests.size });

  // (b) effort, (c) fewer sets, (d) drops: per exercise, in order.
  const rpes = new Map<string, number>();
  const gone: FitStepDraft[] = [];
  const later: TimeFitLine[] = [];
  for (const b of w.blocks) {
    for (const slot of b.slots) {
      const after = kept.get(slot.key);
      const name = names.get(slot.key) ?? '';
      if (after === undefined) {
        gone.push({ type: 'skip_exercise', sessionExerciseId: slot.key });
        later.push({ kind: 'drop', sessionExerciseId: slot.key, name });
        continue;
      }
      const al = aligned(slot, after);
      let pushedHere = false;
      for (const k of al.kept) {
        const set = byId.get(k.setId);
        if (set === undefined || k.row.rpe === null || k.row.type === 'warmup' || k.row.rpe === effRpe(set)) continue;
        rpes.set(k.setId, k.row.rpe);
        pushedHere = true;
      }
      if (pushedHere && al.gone.length === 0) lines.push({ kind: 'effort', sessionExerciseId: slot.key, name });
      if (al.gone.length === 0) continue;
      for (const id of al.gone) {
        const set = byId.get(id);
        if (set !== undefined) gone.push({ type: 'delete_set', setId: set.id, expectedSetVersion: set.version });
      }
      const done = a.sets.filter((x) => x.sessionExerciseId === slot.key && x.status === 'completed' && x.setType !== 'warmup').length;
      later.push({ kind: 'sets', sessionExerciseId: slot.key, name, from: done + slot.rows.filter(isWork).length, to: done + after.rows.filter(isWork).length });
    }
  }
  lines.push(...later);
  for (const b of w.blocks) {
    for (const slot of b.slots) {
      for (const r of rowsOf(slot)) {
        const set = byId.get(r.setId);
        const restS = rests.get(r.setId);
        const targetRpe = rpes.get(r.setId);
        if (set === undefined || (restS === undefined && targetRpe === undefined)) continue;
        steps.push({ type: 'edit_planned_set', setId: set.id, expectedSetVersion: set.version, patch: { ...(restS === undefined ? {} : { restS }), ...(targetRpe === undefined ? {} : { targetRpe }) } });
      }
    }
  }
  steps.push(...gone);
  if (steps.length === 0) return none;
  const afterMinutes = Math.round(estimateBuilderSeconds(fit.workout, ctx) / 60);
  return { ...base, status: fit.status, afterMinutes, savedMinutes: Math.max(0, base.beforeMinutes - afterMinutes), lines, steps };
}

/** Ben's Apply: the offer as one `fit_today_to_time`, each step with its own opId (`coachEditStepOpId`). */
export function fitTodayCommand(offer: TimeFitOffer, p: { opId: string; at: ZonedTimestamp }): FitTodayToTimeCommand | null {
  if (offer.steps.length === 0) return null;
  const steps = offer.steps.map((s, i): FitTodayStep => ({ ...s, opId: coachEditStepOpId(p.opId, i), at: p.at }) as FitTodayStep);
  return { type: 'fit_today_to_time', at: p.at, opId: p.opId, expectedVersion: offer.expectedVersion, minutes: Math.max(1, Math.min(600, offer.targetMinutes)), steps };
}

/** One line of the offer, as shown (`Shorter rests`, `Lateral raise · 3 → 2 sets`, `Cable fly · skip`, `Face pull · last set @ 9`). */
export function timeFitLineText(l: TimeFitLine): string {
  switch (l.kind) {
    case 'rest':
      return 'Shorter rests';
    case 'effort':
      return `${l.name} · last set @ 9`;
    case 'sets':
      return `${l.name} · ${String(l.from)} → ${String(l.to)} sets`;
    case 'drop':
      return `${l.name} · skip`;
  }
}
