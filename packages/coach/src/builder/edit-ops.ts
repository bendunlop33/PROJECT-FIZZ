import {
  BUILDER_MAX_SUPERSET,
  BUILDER_SET_RULES,
  adviseBuilder,
  anchorE1rmOf,
  builderSupersetWithNext,
  builderUnlink,
  canPair,
  clampMinutes,
  editSetRow,
  estimateBuilderMinutes,
  fitToMinutes,
  formulaApplies,
  infoOrDefault,
  loadForSet,
  makeSlot,
  removeSlot,
  roundContextOf,
  roundDownHere,
  setWorkingCount,
  slotsOf,
  warmupsFor,
  workingCount,
  type BuilderBlock,
  type BuilderContext,
  type BuilderGroupName,
  type BuilderSetRow,
  type BuilderSlot,
  type BuilderWorkout,
} from '@fizz/domain';
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
    default:
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

/** The slot with a new working load: Top / working sets at it, back-offs by the formula, warm-ups rebuilt, all rounded down here. */
function withWorkingLoad(slot: BuilderSlot, value: number, ctx: BuilderContext): BuilderSlot {
  const input = ctx.loads(slot.exerciseId);
  const rc = roundContextOf(input);
  const info = infoOrDefault(ctx.info, slot.exerciseId);
  const first = working(slot)[0];
  const anchor = first !== undefined && formulaApplies(slot.convention) ? anchorE1rmOf({ value, reps: first.reps, rpe: first.rpe ?? BUILDER_SET_RULES.workRpe }) : null;
  const down = (v: number | null): number | null => (v === null ? null : (roundDownHere(v, rc)?.value ?? null));
  const work: BuilderSetRow[] = [];
  for (const r of working(slot)) {
    const prev = work[work.length - 1];
    if (r.type === 'top' || r.type === 'working') work.push({ type: r.type, reps: r.reps, rpe: r.rpe, load: value });
    else if (r.type === 'backoff') work.push({ type: r.type, reps: r.reps, rpe: r.rpe, load: down(loadForSet(anchor, value, r.reps, r.rpe ?? BUILDER_SET_RULES.workRpe)) });
    else work.push({ type: r.type, reps: r.reps, rpe: r.rpe, load: prev?.load == null ? null : down(prev.load * BUILDER_SET_RULES.dropPct) });
  }
  const warm = warmupsFor({ main: slot.main, role: info.role, barbell: info.barbell, load: input }, value);
  return { ...slot, rows: [...warm, ...work], anchorE1rm: anchor, source: 'coach_target', startLight: null, touched: true };
}

/** Where a new single goes when no anchor is named: at the end, before a trailing abs block (unless it is abs). */
function endIndex(w: BuilderWorkout, exerciseId: string, ctx: BuilderContext): number {
  if (infoOrDefault(ctx.info, exerciseId).group === 'Abs') return w.blocks.length;
  let at = w.blocks.length;
  while (at > 0 && (w.blocks[at - 1]?.slots.every((s) => infoOrDefault(ctx.info, s.exerciseId).group === 'Abs') ?? false)) at -= 1;
  return at;
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

function applyOne(st: Working, op: BuilderEditOp, env: BuilderCoachEnv, snapshot: BuilderCoachSnapshot): void {
  const { ctx } = env;
  const name = (id: string): string => infoOrDefault(ctx.info, id).name;
  const nameOf = (key: string): string => {
    const s = findSlot(st.w, key);
    return s === undefined ? key : name(s.exerciseId);
  };
  const mark = (key: string): void => {
    if (snapshot.revs[key] !== undefined || findSlot(snapshot.workout, key) !== undefined) st.named.add(key);
  };
  const inWorkout = (id: string): boolean => slotsOf(st.w.blocks).some((s) => s.exerciseId === id);
  const newExerciseOk = (id: string): string | null => {
    if (ctx.info(id) === null || !env.usable(id)) return `Not changed: ${ctx.info(id)?.name ?? 'that exercise'} isn't at this gym`;
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
      const why = newExerciseOk(op.toExerciseId);
      if (why !== null) {
        st.notes.push(why);
        return;
      }
      const fresh = makeSlot(op.toExerciseId, { main: false, workingSets: workingCount(s) }, ctx);
      const next: BuilderSlot = { ...setWorkingCount(fresh, workingCount(s)), touched: true, ...(s.restS === undefined ? {} : { restS: s.restS }) };
      st.w = replaceSlot(st.w, s.key, next);
      const origin = [...st.swapped.entries()].find(([, v]) => v === s.key)?.[0] ?? s.key;
      st.swapped.set(origin, next.key);
      return;
    }
    case 'add': {
      const why = newExerciseOk(op.exerciseId);
      if (why !== null) {
        st.notes.push(why);
        return;
      }
      if (slotsOf(st.w.blocks).length >= BUILD_LIMITS.maxExercises) {
        st.notes.push(`Not changed: at most ${String(BUILD_LIMITS.maxExercises)} exercises`);
        return;
      }
      const asked = op.workingSets ?? BUILDER_SET_RULES.accessorySets;
      const sets = Math.max(BUILD_LIMITS.minWorkingSets, Math.min(BUILD_LIMITS.maxWorkingSets, asked));
      if (sets !== asked) st.notes.push(`${name(op.exerciseId)}: ${String(sets)} sets (limit ${String(BUILD_LIMITS.minWorkingSets)}–${String(BUILD_LIMITS.maxWorkingSets)})`);
      const slot: BuilderSlot = { ...setWorkingCount(makeSlot(op.exerciseId, { main: false, workingSets: sets }, ctx), sets), touched: true };
      let at = endIndex(st.w, op.exerciseId, ctx);
      if (op.afterSlotKey !== null) {
        mark(op.afterSlotKey);
        const i = blockIndexOf(st.w, op.afterSlotKey);
        if (i >= 0) at = i + 1;
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
      st.w = replaceSlot(st.w, s.key, { ...setWorkingCount(s, n), touched: true });
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
        st.notes.push(`${name(s.exerciseId)}: ${op.op === 'reps' ? `${String(value)} reps` : `RPE ${String(value)}`} (limit ${String(lo)}–${String(hi)})`);
      }
      // Rule 9: a pain-flagged movement is never made harder (a higher RPE target is refused).
      const pain = env.pain(s.exerciseId);
      if (op.op === 'rpe' && pain !== null && value > (working(s)[0]?.rpe ?? 0)) {
        st.notes.push(`${name(s.exerciseId)}: Not harder: ${pain}`);
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
      const g = env.loads.check(s, requested, { askedHeavier: env.askedHeavier });
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

/** Lines for one surviving slot: sets, reps, RPE and load, before → after. */
function slotLines(before: BuilderSlot, after: BuilderSlot, name: string): string[] {
  const out: string[] = [];
  const a = workingCount(before);
  const b = workingCount(after);
  if (a !== b) out.push(`${name}: ${String(a)} → ${String(b)} sets`);
  const ra = working(before)[0]?.reps;
  const rb = working(after)[0]?.reps;
  if (ra !== undefined && rb !== undefined && ra !== rb) out.push(`${name}: ${String(ra)} → ${String(rb)} reps`);
  const pa = working(before)[0]?.rpe;
  const pb = working(after)[0]?.rpe;
  if (pa != null && pb != null && pa !== pb) out.push(`${name}: RPE ${fmt(pa)} → ${fmt(pb)}`);
  const la = topLoad(before);
  const lb = topLoad(after);
  if (la !== null && lb !== null && Math.abs(la - lb) > EPS) out.push(`${name}: ${loadChange(la, lb, after.unit, after.convention)}`);
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

  const name = (id: string): string => infoOrDefault(env.ctx.info, id).name;
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
      lines.push(...slotLines(s, now, name(s.exerciseId)));
    }
  }
  for (const s of afterSlots) if (!beforeSlots.some((b) => b.key === s.key) && !replacing.has(s.key)) lines.push(`Add ${name(s.exerciseId)}`);
  // Blocks that moved or paired change other slots' positions only; each named slot is a precondition anyway.
  lines.push(...st.structure);

  const adviceBefore = new Set(adviseBuilder(base.blocks, env.ctx.info).map((a) => a.key));
  const warnings = adviseBuilder(after.blocks, env.ctx.info)
    .filter((a) => !adviceBefore.has(a.key))
    .map((a) => `⚠ Not recommended: ${a.reason}`);

  const preconditions: SlotPrecondition[] = [...new Set([...touched, ...st.named])].filter((k) => beforeSlots.some((s) => s.key === k)).map((slotKey) => ({ slotKey, rev: snapshot.revs[slotKey] ?? 1 }));
  if (st.minutesTouched) preconditions.push({ slotKey: MINUTES_KEY, rev: snapshot.minutes });

  return { workout: after, minutes: st.minutes, estimate: estimateBuilderMinutes(after, env.ctx), lines, warnings: [...new Set(warnings)], notes: st.notes, preconditions };
}

export type FreshCheck = { ok: true } | { ok: false; line: typeof OUT_OF_DATE_LINE };

/** §2.6 copy: what Apply shows when a slot it touches changed since (rule 5). */
export const OUT_OF_DATE_LINE = 'Out of date. Ask again.';

/** Whether every slot (and the length) a proposal touches is as it was when it was made. */
export function preconditionsHold(pre: readonly SlotPrecondition[], now: BuilderCoachSnapshot): FreshCheck {
  for (const p of pre) {
    if (p.slotKey === MINUTES_KEY) {
      if (now.minutes !== p.rev) return { ok: false, line: OUT_OF_DATE_LINE };
      continue;
    }
    if (findSlot(now.workout, p.slotKey) === undefined || (now.revs[p.slotKey] ?? 1) !== p.rev) return { ok: false, line: OUT_OF_DATE_LINE };
  }
  return { ok: true };
}
