import { BUILDER_MAX_SUPERSET, BUILDER_SET_RULES, adviseBuilder, isTimedSlot, makeExtraSlot, bandInsertIndex, anchorE1rmOf, builderSupersetWithNext, builderUnlink, canPair, clampBuilderRest, clampMinutes, compareDifficulty, editSetRow, estimateBuilderMinutes, fitToMinutes, formulaApplies, infoOrDefault, loadDirection, makeSlot, removeSlot, restClockText, roundContextOf, roundDownHere, setWorkingCount, settleBackoffs, slotsOf, splitInvalidAutoPairs, warmupsFor, withBackoffBases, followTop, workingCount, workingRestS, type BuilderBlock, type BuilderContext, type BuilderGroupName, type BuilderSetRow, type BuilderSlot, type BuilderWorkout, rirOfRpe } from '@fizz/domain';
import { BUILD_LIMITS, type BuilderEditOp, type LoadConvention, type WeightUnit } from '@fizz/schemas';
import { topLoad, type BuilderLoadGuard } from './load-guard';

/**
 * Typed edits to today's workout from the coach (`propose_workout_edit`,
 * review suggestions, the pre-session offer; workout-builder-v3 §2.6, §5).
 * Pure. Code applies the ops to a COPY with the builder's own rules
 * (§3), checks every number (loads through the guard, limits clamped with a
 * note), and writes the before/after lines itself: the model's words never
 * become a line. Nothing here writes anything; Apply is the caller's.
 */

/** What the coach sees of today's workout, and what Apply is checked against (rule 5). */
export interface BuilderCoachSnapshot {
  /** The builder draft (`WorkoutDraft.id`) and its version when read. */
  draftId: string;
  draftVersion: number;
  /** `Chest`. */
  dayName: string;
  /** Set up's length (the target), not the estimate. */
  minutes: number;
  supersets: boolean;
  workout: BuilderWorkout;
  /** Each slot's revision (`DraftSlot.rev`; absent = 1). */
  revs: Readonly<Record<string, number>>;
  /** Set up's revision (bumped on every Set up change); absent: the length itself stands in (review N3). */
  setupRev?: number;
}

export interface BuilderCoachEnv {
  ctx: BuilderContext;
  /** An exercise Ben can do at today's gym (`doableHere`), for swap and add. */
  usable: (exerciseId: string) => boolean;
  /** An active pain flag covering the movement (`shoulder flagged 6 Oct`), else null (rule 9). */
  pain: (exerciseId: string) => string | null;
  loads: BuilderLoadGuard;
  /** Ben asked heavier in his own words: one more step allowed (BD16). */
  askedHeavier: boolean;
  /** The day's main group (fit ladder). */
  mainGroup: BuilderGroupName | null;
  /** Exercises a longer length may add, best first (gym-available, not pain-flagged). */
  addCandidates?: { arm: readonly string[]; mainGroup: readonly string[] };
}

/** A slot the proposal was made against, at its revision then (§4.4). `#minutes` stands for Set up's length. */
export interface SlotPrecondition {
  slotKey: string;
  rev: number;
}

export const MINUTES_KEY = '#minutes';

export interface EditOutcome {
  workout: BuilderWorkout;
  /** Set up's length after (the `minutes` op), else unchanged. */
  minutes: number;
  /** `about N min` after. */
  estimate: number;
  /** Code-made change lines (`Cable fly → Incline barbell press`, `Length 60 → 45 min`). */
  lines: string[];
  /** `⚠ Not recommended: <reason>` for each piece of advice the change adds (§3.8); Apply still works. */
  warnings: string[];
  /** Ops left out or clamped, in code's words (`Not changed: …`). */
  notes: string[];
  /** The slots (and length) the change touches, at their revision in the snapshot. */
  preconditions: SlotPrecondition[];
  /**
   * (Ben, 23 Oct) Near-duplicate pairs the change adds (`Dumbbell shrug` next to `Barbell shrug`), each as
   * `[in the workout, new]` names. Shown as a ⚠ warning on an edit Ben asked for; a review suggestion with one is left out.
   */
  nearDuplicates: [string, string][];
}

const EPS = 1e-6;
const fmt = (v: number): string => String(Math.round(v * 100) / 100);

/** `100 kg`, `30 kg each`, `25 kg assist`, `+10 kg`. */
export function builderLoadText(value: number, unit: WeightUnit, convention: LoadConvention): string {
  switch (convention) {
    case 'per_hand':
      return `${fmt(value)} ${unit} each`;
    case 'assistance':
      return `${fmt(value)} ${unit} assist`;
    case 'added':
      return `+${fmt(value)} ${unit}`;
    case 'total':
    case 'stack':
    case 'bodyweight':
      return `${fmt(value)} ${unit}`;
  }
}

/** The load part after an arrow: `100 → 102.5 kg`, `25 → 20 kg assist`. */
function loadChange(a: number, b: number, unit: WeightUnit, convention: LoadConvention): string {
  const after = builderLoadText(b, unit, convention);
  return `${convention === 'added' ? '+' : ''}${fmt(a)} → ${after}`;
}

const cloneW = (w: BuilderWorkout): BuilderWorkout => ({ restLevel: w.restLevel, blocks: w.blocks.map((b) => ({ ...b, slots: b.slots.map((s) => ({ ...s, rows: s.rows.map((r) => ({ ...r })) })) })) });
const findSlot = (w: BuilderWorkout, key: string): BuilderSlot | undefined => slotsOf(w.blocks).find((s) => s.key === key);
const blockIndexOf = (w: BuilderWorkout, key: string): number => w.blocks.findIndex((b) => b.slots.some((s) => s.key === key));
const replaceSlot = (w: BuilderWorkout, key: string, next: BuilderSlot): BuilderWorkout => ({ ...w, blocks: w.blocks.map((b) => ({ ...b, slots: b.slots.map((s) => (s.key === key ? next : s)) })) });
const working = (s: BuilderSlot): BuilderSetRow[] => s.rows.filter((r) => r.type !== 'warmup');

/** A set's reps as Ben reads them: `3–6` for a saved range, else `8`. */
export function builderRepsText(row: Pick<BuilderSetRow, 'reps' | 'repsMax'>): string {
  return row.repsMax !== undefined && row.repsMax > row.reps ? `${String(row.reps)}–${String(row.repsMax)}` : String(row.reps);
}

/**
 * The slot with a new working load: Top / working sets at it, warm-ups rebuilt, all rounded down here. Back-offs
 * (D4, HT8; review B1) keep the top they were worked out from (`withBackoffBases`): a lighter working load lowers them
 * by the same % from there. (Ben, 23 Oct, SP2) Ben asked for this top, so the back-offs follow it both ways
 * (`followTop`: §3.1 step 2 wins over HT8 here), inside the D4 band, snapped down and never above the top; a top Ben
 * types himself still never raises them. A drop follows a set that moved. Each row keeps its reps (a
 * saved `3–6` range included; final re-review F1); a typed kg gives way to the coach's load, and the saved workout's
 * reasons no longer explain it (S1). No formula (assisted, added weight): every working set at the load, as before.
 */
function withWorkingLoad(slot: BuilderSlot, value: number, ctx: BuilderContext): BuilderSlot {
  const input = ctx.loads(slot.exerciseId);
  const rc = roundContextOf(input);
  const info = infoOrDefault(ctx.info, slot.exerciseId);
  const first = working(slot)[0];
  const anchor = first !== undefined && formulaApplies(slot.convention) ? anchorE1rmOf({ value, reps: first.reps, rpe: first.rpe ?? BUILDER_SET_RULES.workRpe }) : null;
  const formula = formulaApplies(rc.convention);
  const down = (v: number | null): number | null => (v === null ? null : (roundDownHere(v, rc)?.value ?? null));
  const at = (r: BuilderSetRow, load: number | null): BuilderSetRow => {
    const row: BuilderSetRow = { ...r, load };
    delete row.typed;
    delete row.roundedFrom;
    return row;
  };
  const before: BuilderSlot = { ...slot, rows: working(slot) };
  const based = formula ? withBackoffBases(before, input) : before;
  const topWas = based.rows.find((r) => r.type === 'top')?.load ?? null;
  const work: BuilderSetRow[] = [];
  for (const r of based.rows) {
    const prev = work[work.length - 1];
    if (r.type === 'top' || r.type === 'working') work.push(at(r, value));
    else if (formula && r.type === 'backoff' && r.backoffFrom !== undefined && topWas !== null) {
      // (Ben, 23 Oct; SP2) Ben asked the coach for this top: the back-offs follow it, up or down, by the same % from
      // the top they were worked out from, inside the D4 band and never above the top, rounded down here. The basis
      // stays the one they were worked out from (marked `follow`), so raising, lowering or putting it back never compounds.
      const from = { load: r.backoffFrom.load, top: r.backoffFrom.top, follow: true as const };
      const followed = down(followTop(from.load, from.top, value, input.mainFocus));
      work.push({ ...at(r, followed ?? r.load), backoffFrom: from });
    } else if (formula) work.push(at(r, r.load));
    else if (r.type === 'backoff') work.push(at(r, down(value)));
    else work.push(at(r, prev?.load == null ? null : down(prev.load * BUILDER_SET_RULES.dropPct)));
  }
  const rows = formula ? settleBackoffs({ ...based, rows: work, anchorE1rm: anchor }, input, based).rows : work;
  // (WU1–WU12) The shared planner's warm-ups from the new working load (the save re-plans them for the slot's place).
  const firstWork = rows.find((r) => r.type === 'top') ?? rows[0];
  const warm = slot.ownWarmups === true ? slot.rows.filter((r) => r.type === 'warmup') : warmupsFor({ ...info, main: slot.main, load: input, ...(firstWork === undefined ? {} : { reps: firstWork.reps }) }, value);
  const out: BuilderSlot = { ...slot, rows: [...warm, ...rows], anchorE1rm: anchor, source: 'coach_target', startLight: null, touched: true };
  delete out.why;
  return out;
}

/** Where a new single goes when no anchor is named: in its §3.4 band, after its own group (the builder's rule, `bandInsertIndex`; review builder-order S1). */
function endIndex(w: BuilderWorkout, exerciseId: string, ctx: BuilderContext): number {
  return bandInsertIndex(w.blocks, { exerciseId, main: false }, ctx.info, [infoOrDefault(ctx.info, exerciseId).group]);
}

interface Working {
  w: BuilderWorkout;
  minutes: number;
  notes: string[];
  structure: string[];
  /** Base slot key → the slot that replaced it (swap). */
  swapped: Map<string, string>;
  /** Base keys an op named (precondition even when unchanged: an anchor, a pair partner). */
  named: Set<string>;
  minutesTouched: boolean;
}

/** An exercise's name: its builder info's, else (a bike, a rower) its timed info's (Ben, 27 Oct). */
export function builderExerciseName(ctx: BuilderContext, id: string): string {
  return ctx.info(id)?.name ?? ctx.extra?.(id)?.name ?? infoOrDefault(ctx.info, id).name;
}

/** `8:00`, `0:45`, `1:05:00`: a timed slot's work time. */
export function workTimeText(s: number): string {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const ss = String(sec).padStart(2, '0');
  return h > 0 ? `${String(h)}:${String(m).padStart(2, '0')}:${ss}` : `${String(m)}:${ss}`;
}

/** A timed slot's sets as Ben reads them: `8:00`, `3 × 0:45`. Null: not a timed slot. */
export function timedSetsText(s: BuilderSlot): string | null {
  if (!isTimedSlot(s)) return null;
  const work = working(s);
  const t = work.find((r) => r.durationS !== undefined)?.durationS;
  if (t === undefined) return null;
  return work.length > 1 ? `${String(work.length)} × ${workTimeText(t)}` : workTimeText(t);
}

function applyOne(st: Working, op: BuilderEditOp, env: BuilderCoachEnv, snapshot: BuilderCoachSnapshot): void {
  const { ctx } = env;
  const name = (id: string): string => builderExerciseName(ctx, id);
  const nameOf = (key: string): string => {
    const s = findSlot(st.w, key);
    return s === undefined ? key : name(s.exerciseId);
  };
  const mark = (key: string): void => {
    if (snapshot.revs[key] !== undefined || findSlot(snapshot.workout, key) !== undefined) st.named.add(key);
  };
  const inWorkout = (id: string): boolean => slotsOf(st.w.blocks).some((s) => s.exerciseId === id);
  // (Ben, 27 Oct) A cardio machine or timed exercise has no builder info but can be added (as a timed slot); it never
  // replaces a lift. Only an exercise code doesn't know at all is unknown; one it knows that this gym can't do isn't here.
  const newExerciseOk = (id: string, opts: { timedOk: boolean }): string | null => {
    const timed = ctx.extra?.(id) ?? null;
    if (ctx.info(id) === null && timed === null) return 'Not changed: unknown exercise';
    if (ctx.info(id) === null && !opts.timedOk) return `Not changed: ${name(id)} can’t replace a lift`;
    if (!env.usable(id)) return `Not changed: ${name(id)} isn't at this gym`;
    if (inWorkout(id)) return `Not changed: ${name(id)} is already in the workout`;
    const pain = env.pain(id);
    if (pain !== null) return `${name(id)} left out · ${pain}`;
    return null;
  };
  const slotFor = (key: string): BuilderSlot | null => {
    mark(key);
    const s = findSlot(st.w, key);
    if (s === undefined) {
      st.notes.push('Not changed: that exercise isn’t in the workout');
      return null;
    }
    return s;
  };

  switch (op.op) {
    case 'swap': {
      const s = slotFor(op.slotKey);
      if (s === null) return;
      if (s.main) {
        st.notes.push(`Not changed: the main lift changes on Set up`);
        return;
      }
      const why = newExerciseOk(op.toExerciseId, { timedOk: false });
      if (why !== null) {
        st.notes.push(why);
        return;
      }
      const fresh = makeSlot(op.toExerciseId, { main: false, workingSets: workingCount(s) }, ctx);
      const next: BuilderSlot = { ...setWorkingCount(fresh, workingCount(s)), touched: true, ...(s.restS === undefined ? {} : { restS: s.restS }) };
      st.w = replaceSlot(st.w, s.key, next);
      // A builder pair that now holds a heavy lift (or a shared muscle) splits, as Mix it up does (review builder-order S1).
      const pair = st.w.blocks.find((b) => b.slots.some((x) => x.key === next.key));
      const split = splitInvalidAutoPairs(st.w.blocks, ctx.info);
      const alone = split.find((b) => b.slots.some((x) => x.key === next.key))?.slots.length === 1;
      if (pair !== undefined && pair.slots.length > 1 && alone) st.structure.push(`Unlink ${pair.slots.map((x) => name(x.exerciseId)).join(' + ')}`);
      st.w = { ...st.w, blocks: split };
      const origin = [...st.swapped.entries()].find(([, v]) => v === s.key)?.[0] ?? s.key;
      st.swapped.set(origin, next.key);
      return;
    }
    case 'add': {
      const why = newExerciseOk(op.exerciseId, { timedOk: true });
      if (why !== null) {
        st.notes.push(why);
        return;
      }
      if (slotsOf(st.w.blocks).length >= BUILD_LIMITS.maxExercises) {
        st.notes.push(`Not changed: at most ${String(BUILD_LIMITS.maxExercises)} exercises`);
        return;
      }
      const timed = ctx.info(op.exerciseId) === null ? (ctx.extra?.(op.exerciseId) ?? null) : null;
      const asked = op.workingSets ?? (timed === null || timed.measurement === 'reps' ? BUILDER_SET_RULES.accessorySets : 1);
      const sets = Math.max(BUILD_LIMITS.minWorkingSets, Math.min(BUILD_LIMITS.maxWorkingSets, asked));
      if (sets !== asked) st.notes.push(`${name(op.exerciseId)}: ${String(sets)} sets (limit ${String(BUILD_LIMITS.minWorkingSets)}–${String(BUILD_LIMITS.maxWorkingSets)})`);
      let slot: BuilderSlot;
      if (timed !== null) {
        // (Ben, 27 Oct) A cardio machine or timed exercise: its work time (code's default when not asked), no reps or load.
        const askedS = op.workSeconds ?? null;
        slot = { ...makeExtraSlot(op.exerciseId, { workS: askedS, sets }, ctx), touched: true };
        const gotS = working(slot)[0]?.durationS ?? null;
        if (askedS !== null && gotS !== null && gotS !== askedS) st.notes.push(`${name(op.exerciseId)}: ${workTimeText(gotS)}`);
      } else slot = { ...setWorkingCount(makeSlot(op.exerciseId, { main: false, workingSets: sets }, ctx), sets), touched: true };
      // A timed slot with no place named goes last (a cool-down); `first` puts anything at the very start (a warm-up).
      let at = timed === null ? endIndex(st.w, op.exerciseId, ctx) : st.w.blocks.length;
      if (op.first === true) at = 0;
      else if (op.afterSlotKey !== null) {
        mark(op.afterSlotKey);
        const i = blockIndexOf(st.w, op.afterSlotKey);
        if (i >= 0) at = i + 1;
        else st.notes.push(`${name(op.exerciseId)}: added at the end`);
      }
      const blocks = [...st.w.blocks];
      blocks.splice(at, 0, { slots: [slot], auto: false });
      st.w = { ...st.w, blocks };
      return;
    }
    case 'remove': {
      const s = slotFor(op.slotKey);
      if (s === null) return;
      if (s.main) {
        st.notes.push('Not changed: the main lift stays');
        return;
      }
      st.w = removeSlot(st.w, s.key);
      return;
    }
    case 'sets': {
      const s = slotFor(op.slotKey);
      if (s === null) return;
      const n = Math.max(BUILD_LIMITS.minWorkingSets, Math.min(BUILD_LIMITS.maxWorkingSets, op.workingSets));
      if (n !== op.workingSets) st.notes.push(`${name(s.exerciseId)}: ${String(n)} sets (limit ${String(BUILD_LIMITS.minWorkingSets)}–${String(BUILD_LIMITS.maxWorkingSets)})`);
      // Rule 9: pain stops progression for that movement, volume included (review b3-coach S2).
      const pain = env.pain(s.exerciseId);
      if (pain !== null && n > workingCount(s)) {
        st.notes.push(`${name(s.exerciseId)}: Not more: ${pain}`);
        return;
      }
      st.w = replaceSlot(st.w, s.key, { ...setWorkingCount(s, n, ctx.loads(s.exerciseId)), touched: true });
      return;
    }
    case 'reps':
    case 'rpe': {
      const s = slotFor(op.slotKey);
      if (s === null) return;
      let value = op.op === 'reps' ? Math.round(op.reps) : Math.round(op.rpe * 2) / 2;
      const [lo, hi] = op.op === 'reps' ? [BUILD_LIMITS.minReps, BUILD_LIMITS.maxReps] : [BUILD_LIMITS.minRpe, BUILD_LIMITS.maxRpe];
      if (value < lo || value > hi) {
        value = Math.max(lo, Math.min(hi, value));
        // (Ben, 26 Oct) Shown as RIR: the limit reads from easiest to hardest.
        st.notes.push(`${name(s.exerciseId)}: ${op.op === 'reps' ? `${String(value)} reps (limit ${String(lo)}–${String(hi)})` : `RIR ${fmt(rirOfRpe(value))} (limit ${fmt(rirOfRpe(hi))}–${fmt(rirOfRpe(lo))})`}`);
      }
      // Rule 9: a pain-flagged movement is never made harder: no higher RPE target, no more reps (review S2).
      const pain = env.pain(s.exerciseId);
      if (pain !== null && op.op === 'rpe' && value > (working(s)[0]?.rpe ?? 0)) {
        st.notes.push(`${name(s.exerciseId)}: Not harder: ${pain}`);
        return;
      }
      if (pain !== null && op.op === 'reps' && value > (working(s)[0]?.reps ?? 0)) {
        st.notes.push(`${name(s.exerciseId)}: Not more: ${pain}`);
        return;
      }
      let next = s;
      const load = ctx.loads(s.exerciseId);
      for (let i = 0; i < next.rows.length; i += 1) {
        const r = next.rows[i];
        if (r === undefined || r.type === 'warmup' || r.type === 'drop') continue;
        const e = editSetRow(next, i, op.op === 'reps' ? { kind: 'reps', reps: value } : { kind: 'rpe', rpe: value }, load);
        if (e.ok) next = e.slot;
      }
      // The formula may move the load with the reps or RPE: a heavier one passes the same guard as a
      // coach load (ceilings, max, pain); refused, the slot keeps its load (review b3-coach S3).
      const was = topLoad(s);
      const moved = topLoad(next);
      if (was !== null && moved !== null && compareDifficulty(moved, was, loadDirection(s.convention)) > EPS) {
        // Checked at the new reps / RPE with the load as it was.
        const held = withWorkingLoad(next, was, ctx);
        const g = env.loads.check(held, moved, { askedHeavier: env.askedHeavier });
        if (!g.ok) {
          next = held;
          st.notes.push(`${name(s.exerciseId)}: stays ${builderLoadText(was, s.unit, s.convention)} · ${g.note}`);
        } else if (Math.abs(g.value - moved) > EPS) {
          next = withWorkingLoad(next, g.value, ctx);
          for (const n of g.notes) st.notes.push(`${name(s.exerciseId)}: ${n}`);
        }
      }
      st.w = replaceSlot(st.w, s.key, { ...next, touched: true });
      return;
    }
    case 'load': {
      const s = slotFor(op.slotKey);
      if (s === null) return;
      const now = topLoad(s);
      let requested: number | null = null;
      if (op.value !== null) {
        const unit = op.unit ?? s.unit;
        requested = unit === s.unit ? op.value : unit === 'kg' ? op.value * 2.20462 : op.value / 2.20462;
      } else if (op.direction !== null && now !== null) {
        requested = env.loads.step(s, now, op.direction, 1);
      }
      if (requested === null) {
        st.notes.push(`Not changed: ${name(s.exerciseId)} has no load to change`);
        return;
      }
      const g = env.loads.check(s, requested, { askedHeavier: env.askedHeavier, step: op.value === null });
      if (!g.ok) {
        st.notes.push(`${name(s.exerciseId)}: ${g.note}`);
        return;
      }
      if (now !== null && Math.abs(g.value - now) < EPS) {
        st.notes.push(`${name(s.exerciseId)}: stays ${builderLoadText(now, s.unit, s.convention)}${g.notes.length > 0 ? ` · ${g.notes.join(' · ')}` : ''}`);
        return;
      }
      for (const n of g.notes) st.notes.push(`${name(s.exerciseId)}: ${n}`);
      st.w = replaceSlot(st.w, s.key, withWorkingLoad(s, g.value, ctx));
      return;
    }
    case 'move': {
      const s = slotFor(op.slotKey);
      if (s === null) return;
      const from = blockIndexOf(st.w, s.key);
      const block = st.w.blocks[from];
      if (block === undefined) return;
      const rest = st.w.blocks.filter((_, i) => i !== from);
      let to = rest.length;
      if (op.beforeSlotKey !== null) {
        mark(op.beforeSlotKey);
        const i = rest.findIndex((b) => b.slots.some((x) => x.key === op.beforeSlotKey));
        if (i < 0) {
          st.notes.push('Not changed: that exercise isn’t in the workout');
          return;
        }
        to = i;
      }
      if (to === from) return;
      rest.splice(to, 0, block);
      st.w = { ...st.w, blocks: rest };
      st.structure.push(op.beforeSlotKey === null ? `Move ${nameOf(s.key)} to the end` : `Move ${nameOf(s.key)} before ${nameOf(op.beforeSlotKey)}`);
      return;
    }
    case 'superset': {
      const a = slotFor(op.slotKey);
      const b = slotFor(op.withSlotKey);
      if (a === null || b === null || a.key === b.key) return;
      const ai = blockIndexOf(st.w, a.key);
      const bi = blockIndexOf(st.w, b.key);
      if (ai === bi) return;
      const pair = canPair(a, b, ctx.info);
      if (pair.reason === 'main') {
        st.notes.push('Not changed: the main lift never joins a superset');
        return;
      }
      const ablock = st.w.blocks[ai];
      const bblock = st.w.blocks[bi];
      if (ablock === undefined || bblock === undefined) return;
      if (ablock.slots.length + bblock.slots.length > BUILDER_MAX_SUPERSET) {
        st.notes.push(`Not changed: a superset holds at most ${String(BUILDER_MAX_SUPERSET)}`);
        return;
      }
      // The second block moves next to the first, then the two join (Ben's own pair, not `auto`).
      const blocks: BuilderBlock[] = st.w.blocks.filter((_, i) => i !== bi);
      const at = blocks.indexOf(ablock);
      blocks.splice(at + 1, 0, bblock);
      const joined = builderSupersetWithNext(blocks, a.key);
      if (joined === null) {
        st.notes.push('Not changed: those two can’t be paired');
        return;
      }
      st.w = { ...st.w, blocks: joined };
      st.structure.push(`Superset ${name(a.exerciseId)} + ${name(b.exerciseId)}`);
      return;
    }
    case 'unlink': {
      const s = slotFor(op.slotKey);
      if (s === null) return;
      const block = st.w.blocks[blockIndexOf(st.w, s.key)];
      const split = builderUnlink(st.w.blocks, s.key);
      if (split === null || block === undefined) {
        st.notes.push(`Not changed: ${name(s.exerciseId)} isn’t in a superset`);
        return;
      }
      st.w = { ...st.w, blocks: split };
      st.structure.push(`Unlink ${block.slots.map((x) => name(x.exerciseId)).join(' + ')}`);
      return;
    }
    case 'rest': {
      const s = slotFor(op.slotKey);
      if (s === null) return;
      // (Ben, 23 Oct) Rest after each working set (top, back-offs, working sets), on the builder's 15 s steps and limits.
      const seconds = clampBuilderRest('working', op.seconds);
      if (Math.abs(seconds - op.seconds) >= 8) st.notes.push(`${name(s.exerciseId)}: rest ${restClockText(seconds)}`);
      st.w = replaceSlot(st.w, s.key, { ...s, restS: { ...s.restS, top: seconds, backoff: seconds, working: seconds }, touched: true });
      return;
    }
    case 'minutes': {
      const m = clampMinutes(op.minutes);
      if (m !== op.minutes) st.notes.push(`Length ${String(m)} min (limit ${String(BUILD_LIMITS.minMinutes)}–${String(BUILD_LIMITS.maxMinutes)})`);
      st.minutesTouched = true;
      if (m === st.minutes) return;
      const fit = fitToMinutes(st.w, ctx, { minutes: m, mainGroup: env.mainGroup, grow: m > st.minutes, supersets: snapshot.supersets, ...(env.addCandidates === undefined ? {} : { addCandidates: env.addCandidates }) });
      st.w = fit.workout;
      st.minutes = m;
      if (fit.status === 'over') st.notes.push(`⚠ Over ${String(m)} min`);
      return;
    }
  }
}

/**
 * Before → after for one per-set value (reps, RPE) when any set both sides have changed it, as the distinct values in
 * order (`3–6 → 3`, `5 / 8 → 5`). Drops are left out: no reps or RPE op touches them, and a set added or removed
 * is the sets line's. Compared as text, so a saved `3–6` made `3` is a change too (final re-review F2).
 */
function perSetChange(before: BuilderSlot, after: BuilderSlot, text: (r: BuilderSetRow) => string | null): [string, string] | null {
  const straight = (s: BuilderSlot): (string | null)[] => working(s).filter((r) => r.type !== 'drop').map(text);
  const a = straight(before);
  const b = straight(after);
  if (!a.some((v, i) => i < b.length && v !== b[i])) return null;
  const shown = (xs: (string | null)[]): string => [...new Set(xs.filter((x): x is string => x !== null))].join(' / ');
  const [x, y] = [shown(a), shown(b)];
  return x === '' || y === '' || x === y ? null : [x, y];
}

/** Lines for one surviving slot: sets, reps, RPE, load and rest, before → after. */
function slotLines(before: BuilderSlot, after: BuilderSlot, name: string, rest: (s: BuilderSlot) => number | null): string[] {
  const out: string[] = [];
  const a = workingCount(before);
  const b = workingCount(after);
  if (a !== b) out.push(`${name}: ${String(a)} → ${String(b)} sets`);
  const reps = perSetChange(before, after, builderRepsText);
  if (reps !== null) out.push(`${name}: ${reps[0]} → ${reps[1]} reps`);
  const rpe = perSetChange(before, after, (r) => (r.rpe == null ? null : fmt(rirOfRpe(r.rpe))));
  if (rpe !== null) out.push(`${name}: RIR ${rpe[0]} → ${rpe[1]}`);
  const la = topLoad(before);
  const lb = topLoad(after);
  if (la !== null && lb !== null && Math.abs(la - lb) > EPS) out.push(`${name}: ${loadChange(la, lb, after.unit, after.convention)}`);
  const ra = rest(before);
  const rb = rest(after);
  if (ra !== null && rb !== null && ra !== rb) out.push(`${name}: rest ${restClockText(ra)} → ${restClockText(rb)}`);
  return out;
}

const same = (a: BuilderSlot, b: BuilderSlot): boolean => JSON.stringify(a) === JSON.stringify(b);

/**
 * `applyBuilderEdits`: the ops applied in order to a copy of the snapshot's
 * workout. An op code can't apply is left out with a note; the rest still
 * apply. The lines, warnings and preconditions are all code's.
 */
export function applyBuilderEdits(snapshot: BuilderCoachSnapshot, ops: readonly BuilderEditOp[], env: BuilderCoachEnv): EditOutcome {
  const base = snapshot.workout;
  const st: Working = { w: cloneW(base), minutes: snapshot.minutes, notes: [], structure: [], swapped: new Map(), named: new Set(), minutesTouched: false };
  for (const op of ops) applyOne(st, op, env, snapshot);

  const name = (id: string): string => builderExerciseName(env.ctx, id);
  const after = st.w;
  const beforeSlots = slotsOf(base.blocks);
  const afterSlots = slotsOf(after.blocks);
  const afterKeys = new Set(afterSlots.map((s) => s.key));
  const replacedBy = new Map([...st.swapped.entries()].filter(([from, to]) => from !== to && afterKeys.has(to)));
  const replacing = new Set(replacedBy.values());

  const lines: string[] = [];
  if (st.minutes !== snapshot.minutes) lines.push(`Length ${String(snapshot.minutes)} → ${String(st.minutes)} min`);
  const touched = new Set<string>();
  for (const s of beforeSlots) {
    const to = replacedBy.get(s.key);
    if (to !== undefined) {
      const n = findSlot(after, to);
      lines.push(`${name(s.exerciseId)} → ${n === undefined ? to : name(n.exerciseId)}`);
      touched.add(s.key);
      continue;
    }
    const now = findSlot(after, s.key);
    if (now === undefined) {
      lines.push(`Delete ${name(s.exerciseId)}`);
      touched.add(s.key);
      continue;
    }
    if (!same(s, now)) {
      touched.add(s.key);
      lines.push(...slotLines(s, now, name(s.exerciseId), (x) => workingRestS(x, env.ctx.info, x === s ? base.restLevel : after.restLevel, env.ctx.restDefaultsS)));
    }
  }
  // (Ben, 27 Oct) A timed add reads with its time (`Add Exercise bike · 8:00`), and one put at the start says so.
  for (const [i, s] of afterSlots.entries()) {
    if (beforeSlots.some((b) => b.key === s.key) || replacing.has(s.key)) continue;
    const time = timedSetsText(s);
    const first = i === 0 && beforeSlots.length > 0;
    lines.push(`Add ${name(s.exerciseId)}${time === null ? '' : ` · ${time}`}${first ? ' · first' : ''}`);
  }
  // Blocks that moved or paired change other slots' positions only; each named slot is a precondition anyway.
  lines.push(...st.structure);

  const adviceBefore = new Set(adviseBuilder(base.blocks, env.ctx.info).map((a) => a.key));
  const added = adviseBuilder(after.blocks, env.ctx.info).filter((a) => !adviceBefore.has(a.key));
  const warnings = added.map((a) => `⚠ Not recommended: ${a.reason}`);
  // (Ben, 23 Oct) A near-duplicate pair counts as new only when one of the two wasn't in the workout before.
  const hadIds = new Set(beforeSlots.map((s) => s.exerciseId));
  const nearDuplicates = added.flatMap((a): [string, string][] => {
    if (a.kind !== 'near_duplicate' || (hadIds.has(a.a.exerciseId) && hadIds.has(a.b.exerciseId))) return [];
    return [hadIds.has(a.a.exerciseId) ? [a.a.name, a.b.name] : [a.b.name, a.a.name]];
  });

  const preconditions: SlotPrecondition[] = [...new Set([...touched, ...st.named])].filter((k) => beforeSlots.some((s) => s.key === k)).map((slotKey) => ({ slotKey, rev: snapshot.revs[slotKey] ?? 1 }));
  if (st.minutesTouched) preconditions.push({ slotKey: MINUTES_KEY, rev: snapshot.setupRev ?? snapshot.minutes });

  return { workout: after, minutes: st.minutes, estimate: estimateBuilderMinutes(after, env.ctx), lines, warnings: [...new Set(warnings)], notes: st.notes, preconditions, nearDuplicates };
}

export type FreshCheck = { ok: true } | { ok: false; line: typeof OUT_OF_DATE_LINE };

/** §2.6 copy: what Apply shows when a slot it touches changed since (rule 5). */
export const OUT_OF_DATE_LINE = 'Out of date. Ask again.';

/** Whether every slot (and the length) a proposal touches is as it was when it was made. */
export function preconditionsHold(pre: readonly SlotPrecondition[], now: BuilderCoachSnapshot): FreshCheck {
  for (const p of pre) {
    if (p.slotKey === MINUTES_KEY) {
      if ((now.setupRev ?? now.minutes) !== p.rev) return { ok: false, line: OUT_OF_DATE_LINE };
      continue;
    }
    if (findSlot(now.workout, p.slotKey) === undefined || (now.revs[p.slotKey] ?? 1) !== p.rev) return { ok: false, line: OUT_OF_DATE_LINE };
  }
  return { ok: true };
}
