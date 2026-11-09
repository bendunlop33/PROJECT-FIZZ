import {
  applyPlanEdit,
  currentPlanVersion,
  deloadSetCount,
  directMuscleGroup,
  isArchivedExercise,
  liveRoutines,
  localWeekBounds,
  localDateOf,
  addDays,
  muscleFlags,
  muscleStatus,
  muscleVolumeLines,
  painFlagCovering,
  PLAN_MUSCLE_GROUPS,
  PLAN_MUSCLES_COPY,
  planDayOf,
  planMuscleKey,
  planMusclesLine,
  planMusclesView,
  planRoutines,
  plannedMuscleSets,
  pbAppliedBuilder,
  pbWeeksCoachLine,
  pbDayAsWorkout,
  pbDaysAtOf,
  pbVersionOf,
  pbIsDeload,
  pbNotPreferred,
  pbRebalanceWeekDays,
  pbSkipsOf,
  pbSlotSets,
  pbWeekDaysOf,
  pbWeekEditsOf,
  pbWeekVersionOf,
  priorityGroupsOf,
  rangesOf,
  rebalanceDayMinutes,
  rebalanceDaysWith,
  rebalanceOpText,
  rebalancePlan,
  toMs,
  undoPlanEdit,
  volumeGoalOfFocus,
  type MuscleGoalInput,
  type MuscleSetTotals,
  type MuscleStatus,
  type PbBlockWeek,
  type PlanMuscleDay,
  type PlanMuscleRow,
  type PlanMusclesView,
  type PlanMuscleWeek,
  type RebalanceOp,
  type VolumeGoal,
} from '@fizz/domain';
import type { Store } from '@fizz/persistence';
import type { ActionDetail, Exercise, MuscleGroup, PainFlag, PlanDayDraft, PlanDraft, PlanWeekExerciseEdit, Routine, UserProfile, ZonedTimestamp } from '@fizz/schemas';
import type { RebalancePrepared } from '@fizz/coach';

import { editBlockOf, readPlanBlock } from './plan-edit-read';
import { editOutcome, type PlanEditOutcome } from './plan-builder-service';

/**
 * (Ben, 1 Nov; docs/design/plan-muscles.md) Library › Plan › Muscles and its **Rebalance**. Local reads only (rule 1).
 * Every number is `@fizz/domain`'s: the plan's weeks as they will run (`pbWeekDaysOf` for weeks on another version,
 * the plan's workouts for the rest; deload set counts, this week's one-change edits and skips), the done-so-far from
 * Progress's own count, and the one Rebalance engine. Apply is the plan edit's own versioned, idempotent write
 * (`applyPlanEdit`, from this week on; done days never change, rule 2) and Undo its Undo (`undoPlanEdit`, rule 5).
 */

export interface PlanMusclesDeps {
  store: () => Store;
  profile: () => Promise<UserProfile | null>;
  now: () => ZonedTimestamp;
  catalogueExercises?: () => readonly Exercise[];
  /** A catalogue entry's substitutions (Coaching knowledge), best first: Rebalance's swap candidates. */
  catalogueSubstitutions?: (catalogueKey: string) => readonly (string | null)[];
  /** Whether the current gym can do it (no gym: yes). */
  usableHere: (exercise: Exercise) => Promise<boolean>;
  /** Done that week (local dates, inclusive), Progress's own count (`muscleFrequency`); null: can't be read. */
  doneBetween: (from: string, to: string) => Promise<MuscleSetTotals | null>;
}

export interface PlanMusclesData {
  planId: string;
  view: PlanMusclesView;
  /** The Monday of the week the done marker is for (`Done by week ›`); null: none. */
  doneWeekOf: string | null;
  /** Library › Plan's line (`Muscles · Biceps low`); null with no goal. */
  line: string | null;
  /** Rebalance can be applied (a builder plan whose block runs). */
  canRebalance: boolean;
}

export interface RebalanceLine {
  id: string;
  dayIndex: number;
  text: string;
  accepted: boolean;
}

export interface RebalanceBar {
  group: MuscleGroup;
  /** `Biceps 0 → 4 · 4–8` */
  text: string;
  before: number;
  after: number;
  range: { min: number; max: number } | null;
  statusAfter: MuscleStatus | null;
}

export interface RebalanceCardData {
  planId: string;
  planVersion: number;
  lines: RebalanceLine[];
  bars: RebalanceBar[];
  /** Days whose length changes: `Pull A 46 → 50 min · 60`. */
  minutes: { dayIndex: number; name: string; before: number; after: number; cap: number | null; text: string; over: boolean }[];
  /** One or two lines behind Why?. */
  why: string[];
  /** Every flagged group is in range after it (with the lines accepted). */
  resolved: boolean;
  /** The accepted lines fit every day's time and there is one at least. */
  canApply: boolean;
  /** No change can be made (nothing fits, or nothing is out of range). */
  empty: boolean;
}

/** (Ben, 2 Nov) The coach's Rebalance card: where it stands (from the plan's own op IDs, so it survives a restart). */
export type RebalanceCoachState = { kind: 'open'; card: RebalanceCardData } | { kind: 'applied' | 'undone' | 'stale' | 'gone' };

type RebalanceDetail = Extract<ActionDetail, { kind: 'propose_rebalance' }>;
/** The plan edit's op IDs for a coach Rebalance card: a double tap or a restart writes once (rule 5). */
export const rebalanceApplyOpId = (actionId: string): string => `rebalance-coach:${actionId}`;
export const rebalanceUndoOpId = (actionId: string): string => `rebalance-coach-undo:${actionId}`;

export const PLAN_MUSCLES_SERVICE_COPY = {
  allInRange: 'Every muscle group is in range: nothing to rebalance.',
  noRoom: 'Nothing fits within the days’ time.',
  noPlan: 'No plan in use.',
  notBuilder: 'Rebalance works on plans from the plan builder.',
  stale: 'Out of date. Check it again.',
  failed: 'Couldn’t save. Try again.',
  nothing: 'Nothing to change.',
} as const;

function routineRows(r: Routine): PlanMuscleRow[] {
  return [...r.exercises]
    .sort((a, b) => a.order - b.order)
    .map((e) => ({ key: e.id, exerciseId: e.exerciseId, sets: e.setTemplates.filter((t) => t.setType !== 'warmup').length, main: e.main === true, order: e.order, superset: e.supersetGroup }));
}

function slotRows(d: PlanDayDraft): PlanMuscleRow[] {
  return [...d.plan.slots].sort((a, b) => a.order - b.order).map((s) => ({ key: s.slotKey, exerciseId: s.exerciseId, sets: pbSlotSets(s), main: s.main, order: s.order, superset: s.supersetGroup }));
}

/** A deload week's working sets (the builder's `pbAtWeek`): one fewer, never below 2 (main lifts: one back-off fewer). */
function deloadRows(rows: readonly PlanMuscleRow[]): PlanMuscleRow[] {
  return rows.map((r) => ({ ...r, sets: r.main ? 1 + Math.max(Math.min(1, r.sets - 1), r.sets - 2) : deloadSetCount(r.sets) }));
}

/** This week's one-change edits (`This week only`) on a day's rows: swaps, removes, adds. */
function withEdits(rows: readonly PlanMuscleRow[], edits: readonly PlanWeekExerciseEdit[]): PlanMuscleRow[] {
  let out = [...rows];
  for (const e of edits) {
    const hit = (r: PlanMuscleRow) => r.key === e.rowId || (e.fromExerciseId !== null && r.exerciseId === e.fromExerciseId);
    if (e.kind === 'remove') out = out.filter((r) => !hit(r));
    else if (e.kind === 'swap' && e.toExerciseId !== null) {
      const to = e.toExerciseId;
      out = out.map((r) => (hit(r) ? { ...r, exerciseId: to } : r));
    } else if (e.kind === 'add' && e.toExerciseId !== null) out.push({ key: e.rowId, exerciseId: e.toExerciseId, sets: e.sets ?? 3, main: false, order: Math.max(-1, ...out.map((r) => r.order)) + 1, superset: null });
  }
  return out;
}

export function createPlanMusclesService(deps: PlanMusclesDeps) {
  const repos = () => deps.store().repos;

  async function pool(p: UserProfile): Promise<{ all: Exercise[]; mine: Set<string>; of: (idOrKey: string) => Exercise | null }> {
    const byId = new Map<string, Exercise>();
    const mine = new Set<string>();
    for (const e of await repos().exercises.list().catch(() => [] as Exercise[])) {
      if (e.ownerId !== null && e.ownerId !== p.id) continue;
      byId.set(e.id, e);
      mine.add(e.id);
    }
    for (const e of deps.catalogueExercises?.() ?? []) if (!byId.has(e.id)) byId.set(e.id, e);
    const byKey = new Map<string, Exercise>();
    for (const e of byId.values()) if (e.catalogueKey != null && !byKey.has(e.catalogueKey)) byKey.set(e.catalogueKey, e);
    return { all: [...byId.values()], mine, of: (x) => byId.get(x) ?? byKey.get(x) ?? null };
  }

  interface Read {
    p: UserProfile;
    plan: PlanDraft;
    typical: PlanMuscleDay[];
    weeks: PlanMuscleWeek[];
    goal: MuscleGoalInput;
    of: (id: string) => Exercise | null;
    all: Exercise[];
    mine: Set<string>;
    block: PbBlockWeek | null;
    doneWeekOf: string | null;
  }

  async function read(): Promise<Read | null> {
    const p = await deps.profile().catch(() => null);
    if (p === null) return null;
    const plan = await repos().planDrafts.applied(p.id).catch(() => null);
    if (plan === null || plan.applied === null) return null;
    const routines = planRoutines(plan, liveRoutines(await repos().routines.listByOwner(p.id).catch(() => [] as Routine[])));
    if (routines.length === 0) return null;
    const { all, mine, of } = await pool(p);
    const version = currentPlanVersion(plan);
    const madeDay = new Map(plan.applied.made.map((m) => [m.routineId, m.dayIndex] as const));
    const seen = new Set<number>();
    const typical: PlanMuscleDay[] = [];
    routines.forEach((r, i) => {
      const dayIndex = madeDay.get(r.id) ?? planDayOf(r)?.dayIndex ?? i;
      if (seen.has(dayIndex)) return;
      seen.add(dayIndex);
      const vd = version.days.find((d) => d.index === dayIndex);
      const rows = routineRows(r);
      // The plan's own exercises for the day that Ben took out of its workout: never put back.
      const atN = pbDaysAtOf(plan).get(dayIndex) ?? null;
      const base = atN === null ? vd : pbVersionOf(plan, atN)?.days.find((d) => d.index === dayIndex);
      const avoid = (base?.plan.slots ?? []).map((x) => x.exerciseId).filter((id) => !rows.some((x) => x.exerciseId === id));
      typical.push({ dayIndex, name: vd?.name ?? r.name, minutes: vd?.minutes ?? null, rows, ...(avoid.length > 0 ? { avoid } : {}) });
    });
    typical.sort((a, b) => a.dayIndex - b.dayIndex);
    const nowMs = toMs(deps.now().utc);
    const monday = localWeekBounds(nowMs, p.timezone).mondayLocalDate;
    const done = async (m: string) => deps.doneBetween(m, addDays(m, 6)).catch(() => null);
    const training = await repos().trainingProfiles.get(p.id).catch(() => null);
    const b = pbAppliedBuilder(plan);
    const answers = b?.builder.answers ?? null;
    const goalWord: VolumeGoal | null = training?.goal ?? (answers === null ? null : volumeGoalOfFocus(answers.focus));
    const goal: MuscleGoalInput = { goal: goalWord, priorities: priorityGroupsOf(answers?.priorities ?? []) };
    const block = b === null ? null : await readPlanBlock(deps.store(), p.id, plan, nowMs, p.timezone).catch(() => null);
    const weekOf = (w: number, rows: (d: PlanMuscleDay) => readonly PlanMuscleRow[]): PlanMuscleDay[] => {
      const skips = pbSkipsOf(plan, w);
      return typical.map((d) => ({ ...d, rows: withEdits(rows(d), pbWeekEditsOf(plan, w, d.dayIndex)), ...(skips.has(d.dayIndex) ? { skipped: true } : {}) }));
    };
    const weeks: PlanMuscleWeek[] = [];
    let doneWeekOf: string | null = null;
    if (answers !== null && block !== null) {
      const n = answers.weeks;
      const leadIn = block.leadIn !== undefined;
      if (leadIn) {
        weeks.push({ key: 'lead', label: PLAN_MUSCLES_COPY.leadIn, kind: 'lead_in', deload: false, current: true, days: weekOf(0, (d) => d.rows), done: await done(monday) });
        doneWeekOf = monday;
      }
      const nowVersion = pbWeekVersionOf(plan, Math.min(block.week, n));
      for (let w = 1; w <= n; w += 1) {
        const dl = pbIsDeload(answers, w);
        const current = !leadIn && !block.done && w === block.week;
        const past = block.done || w < block.week;
        const own = pbWeekDaysOf(plan, w);
        // Weeks on the version in use now run the plan's workouts; another version's weeks (a future change, a done week) its own days.
        const useOwn = past || pbWeekVersionOf(plan, w) !== nowVersion;
        const rowsOf = (d: PlanMuscleDay) => {
          const base = useOwn ? slotRows(own.find((x) => x.index === d.dayIndex) ?? ({ plan: { slots: [] } } as unknown as PlanDayDraft)) : d.rows;
          return dl ? deloadRows(base) : base;
        };
        const days = weekOf(w, rowsOf).filter((d) => !useOwn || own.some((x) => x.index === d.dayIndex));
        const m = current ? monday : past ? (block.mondays[w - 1] ?? null) : null;
        if (current) doneWeekOf = monday;
        weeks.push({ key: String(w), label: dl ? `${String(w)} · ${PLAN_MUSCLES_COPY.deload}` : String(w), kind: 'week', deload: dl, current, days, done: m === null ? null : await done(m) });
      }
    } else {
      weeks.push({ key: '1', label: 'This week', kind: 'week', deload: false, current: true, days: typical, done: await done(monday) });
      doneWeekOf = monday;
    }
    return { p, plan, typical, weeks, goal, of, all, mine, block, doneWeekOf };
  }

  async function ports(r: Read) {
    const answers = pbAppliedBuilder(r.plan)?.builder.answers ?? null;
    const notPreferred = new Set<string>();
    for (const key of answers === null ? [] : pbNotPreferred(answers)) {
      const e = r.of(key);
      if (e !== null) notPreferred.add(e.id);
    }
    const flags = await repos().painFlags.listActive(r.p.id).catch(() => [] as PainFlag[]);
    const usable = new Map<string, boolean>();
    const allowed = async (e: Exercise | null): Promise<boolean> => {
      if (e === null || isArchivedExercise(e) || e.measurement === 'cardio') return false;
      if (notPreferred.has(e.id) || painFlagCovering(flags, e.id) !== null) return false;
      if (!usable.has(e.id)) usable.set(e.id, await deps.usableHere(e).catch(() => false));
      return usable.get(e.id) === true;
    };
    const flagged = muscleFlags(plannedMuscleSets(r.typical, r.of), r.goal).map((f) => f.group);
    const isolations = new Map<MuscleGroup, string[]>();
    for (const g of flagged) {
      // His own exercises first, isolation work first, then the catalogue's order.
      const cands = r.all.filter((e) => directMuscleGroup(e) === g).sort((a, b) => Number(r.mine.has(b.id)) - Number(r.mine.has(a.id)) || Number(b.mechanic === 'isolation') - Number(a.mechanic === 'isolation'));
      const ok: string[] = [];
      for (const e of cands) if (await allowed(e)) ok.push(e.id);
      isolations.set(g, ok);
    }
    const alternatives = new Map<string, string[]>();
    for (const d of r.typical) {
      for (const row of d.rows) {
        if (row.main || alternatives.has(row.exerciseId)) continue;
        const key = r.of(row.exerciseId)?.catalogueKey ?? null;
        const ids: string[] = [];
        for (const k of key === null ? [] : (deps.catalogueSubstitutions?.(key) ?? [])) {
          if (k === null) continue;
          const e = r.of(k);
          if (e !== null && (await allowed(e))) ids.push(e.id);
        }
        alternatives.set(row.exerciseId, ids);
      }
    }
    return { infoOf: r.of, isolationsFor: (g: MuscleGroup) => isolations.get(g) ?? [], alternativesOf: (id: string) => alternatives.get(id) ?? [] };
  }

  async function plan(r: Read) {
    return rebalancePlan({ ...r.goal, days: r.typical, ports: await ports(r) });
  }

  const nameOf = (r: Read) => (id: string) => r.of(id)?.name ?? 'Exercise';

  function card(r: Read, ops: readonly RebalanceOp[], rejected: ReadonlySet<string>): RebalanceCardData {
    const accepted = ops.filter((o) => !rejected.has(o.id));
    const after = rebalanceDaysWith(r.typical, accepted);
    const tBefore = plannedMuscleSets(r.typical, r.of);
    const tAfter = plannedMuscleSets(after, r.of);
    const rb = rangesOf(tBefore, r.goal);
    const ra = rangesOf(tAfter, r.goal);
    const dayName = (i: number) => r.typical.find((d) => d.dayIndex === i)?.name ?? `Day ${String(i + 1)}`;
    const rowName = (i: number, key: string | null) => {
      if (key === null) return null;
      const row = r.typical.find((d) => d.dayIndex === i)?.rows.find((x) => x.key === key);
      return row === undefined ? null : nameOf(r)(row.exerciseId);
    };
    const lines = ops.map((o) => ({ id: o.id, dayIndex: o.dayIndex, text: rebalanceOpText(o, dayName(o.dayIndex), nameOf(r), o.kind === 'add' ? rowName(o.dayIndex, o.supersetWith) : null), accepted: !rejected.has(o.id) }));
    const bars: RebalanceBar[] = PLAN_MUSCLE_GROUPS.flatMap((g) => {
      const before = tBefore.get(g)?.direct ?? 0;
      const aft = tAfter.get(g)?.direct ?? 0;
      const rangeB = rb.get(g) ?? null;
      const range = ra.get(g) ?? null;
      const was = rangeB === null ? null : muscleStatus(before, rangeB);
      if (before === aft && was === 'in' && (range === null || muscleStatus(aft, range) === 'in')) return [];
      return [{ group: g, before, after: aft, range: range === null ? null : { min: range.min, max: range.max }, statusAfter: range === null ? null : muscleStatus(aft, range), text: `${g} ${String(before)} → ${String(aft)}${range === null ? '' : ` · ${String(range.min)}–${String(range.max)}`}` }];
    });
    const minutes = r.typical.flatMap((d) => {
      const a = after.find((x) => x.dayIndex === d.dayIndex) ?? d;
      const before = Math.round(rebalanceDayMinutes(d));
      const aft = Math.round(rebalanceDayMinutes(a));
      const exact = rebalanceDayMinutes(a);
      const over = d.minutes !== null && exact > d.minutes && exact > rebalanceDayMinutes(d);
      if (JSON.stringify(a.rows) === JSON.stringify(d.rows)) return [];
      return [{ dayIndex: d.dayIndex, name: d.name, before, after: aft, cap: d.minutes, over, text: `${d.name} ${String(before)} → ${String(aft)} min${d.minutes === null ? '' : ` · ${String(d.minutes)}`}` }];
    });
    const flagsAfter = muscleFlags(tAfter, r.goal);
    const why: string[] = [];
    const low = muscleFlags(tBefore, r.goal);
    if (low.length > 0) why.push(low.map((f) => PLAN_MUSCLES_COPY.gap(f)).join(' · '));
    why.push(ops.some((o) => o.kind === 'add' && o.supersetWith !== null) ? 'Supersets keep each day within its time; new work goes after the main lifts.' : 'Each day stays within its time; new work goes after the main lifts.');
    return {
      planId: r.plan.id,
      planVersion: r.plan.version,
      lines,
      bars,
      minutes,
      why: why.slice(0, 2),
      resolved: flagsAfter.length === 0,
      canApply: accepted.length > 0 && !minutes.some((m) => m.over) && pbAppliedBuilder(r.plan) !== null && editBlockOf(r.block) !== null,
      empty: ops.length === 0,
    };
  }

  const api = {
    /** Plan › Muscles for the chip asked for (null: this week). Null: no plan in use. */
    async muscles(selected: string | null = null): Promise<PlanMusclesData | null> {
      const r = await read();
      if (r === null) return null;
      const view = planMusclesView({ weeks: r.weeks, typical: r.typical, selected, ...r.goal, infoOf: r.of, nameOf: nameOf(r) });
      const sel = r.weeks.find((w) => w.key === view.selected);
      const doneWeekOf = sel === undefined || sel.done === null ? null : sel.current ? r.doneWeekOf : (r.block?.mondays[Number(sel.key) - 1] ?? null);
      return { planId: r.plan.id, view, doneWeekOf, line: planMusclesLine(view.flags, r.goal.goal), canRebalance: pbAppliedBuilder(r.plan) !== null && editBlockOf(r.block) !== null };
    },

    /** Library › Plan's line: `Muscles · Biceps low`, `Muscles · all in range`; null with no plan or no goal. */
    async line(): Promise<string | null> {
      const r = await read();
      if (r === null) return null;
      return planMusclesLine(muscleFlags(plannedMuscleSets(r.typical, r.of), r.goal), r.goal.goal);
    },

    /** The coach's compact summary (YOUR DATA): the typical week's direct (assisted) sets per group against its range. */
    async coachLines(): Promise<string[] | null> {
      const r = await read();
      if (r === null) return null;
      return muscleVolumeLines(r.typical, r.goal, r.of);
    },

    /**
     * (Ben, 2 Nov) The coach's line for the plan's weeks (YOUR DATA `plan.inUse.weeks`): the block week, its deloads,
     * the lighter weeks Ben asked for and any deload LW1 dropped, so it can say why. Null: no builder plan in use.
     */
    async coachWeeks(): Promise<string | null> {
      const r = await read();
      const answers = r === null ? null : (pbAppliedBuilder(r.plan)?.builder.answers ?? null);
      if (r === null || answers === null) return null;
      return pbWeeksCoachLine(answers, r.block === null ? null : { week: r.block.week, done: r.block.done, leadIn: r.block.leadIn !== undefined });
    },

    /** The typical week's flags and the key the coach's offer is raised once for (Ben, 1 Nov). Null: no plan in use. */
    async gaps(): Promise<{ key: string; lines: string[]; offer: string | null } | null> {
      const r = await read();
      if (r === null) return null;
      const flags = muscleFlags(plannedMuscleSets(r.typical, r.of), r.goal);
      const first = flags[0];
      return { key: planMuscleKey(r.plan.id, r.typical), lines: flags.map((f) => PLAN_MUSCLES_COPY.gap(f)), offer: first === undefined ? null : PLAN_MUSCLES_COPY.offer(first) };
    },

    /**
     * (Ben, 1 Nov) The coach's own offer, raised **once** per plan state (rule 3: unprompted means an offer, never a
     * change): after Apply (`apply`) or in the weekly review (`review`, that week). Whichever surface raises it first
     * keeps it; the other shows nothing for the same plan state, and after Skip nothing shows until the plan changes.
     * Null: nothing out of range, already raised elsewhere, skipped, or it can't be recorded (then it isn't raised).
     */
    async offer(req: { surface: 'apply' | 'review'; weekMonday: string | null; opId: string }): Promise<{ key: string; text: string } | null> {
      const r = await read();
      if (r === null) return null;
      const flags = muscleFlags(plannedMuscleSets(r.typical, r.of), r.goal);
      const first = flags[0];
      if (first === undefined) return null;
      const key = planMuscleKey(r.plan.id, r.typical);
      const text = PLAN_MUSCLES_COPY.offer(first);
      const t = await repos().trainingProfiles.get(r.p.id).catch(() => undefined);
      if (t === undefined) return null;
      const o = t?.muscleOffer;
      if (o !== undefined && o.key === key) {
        return o.status === 'raised' && o.by === req.surface && (req.surface === 'apply' || o.weekMonday === req.weekMonday) ? { key, text } : null;
      }
      const at = deps.now();
      const w = await repos()
        .trainingProfiles.change(r.p.id, { kind: 'muscle_offer', key, by: req.surface, weekMonday: req.weekMonday, status: 'raised' }, { opId: req.opId, expectedVersion: t?.version ?? 1, atUtc: at.utc, nowYear: Number(at.utc.slice(0, 4)), today: localDateOf(toMs(at.utc), r.p.timezone) })
        .catch(() => null);
      return w !== null && (w.status === 'written' || w.status === 'replayed') ? { key, text } : null;
    },

    /** `Skip` on the offer: not raised again until the plan changes (its key). */
    async skipOffer(req: { key: string; opId: string }): Promise<boolean> {
      const p = await deps.profile().catch(() => null);
      if (p === null) return false;
      const t = await repos().trainingProfiles.get(p.id).catch(() => null);
      if (t === null || t.muscleOffer?.key !== req.key) return false;
      const at = deps.now();
      const w = await repos()
        .trainingProfiles.change(p.id, { kind: 'muscle_offer', key: req.key, by: t.muscleOffer.by, weekMonday: t.muscleOffer.weekMonday, status: 'skipped' }, { opId: req.opId, expectedVersion: t.version, atUtc: at.utc, nowYear: Number(at.utc.slice(0, 4)), today: localDateOf(toMs(at.utc), p.timezone) })
        .catch(() => null);
      return w !== null && (w.status === 'written' || w.status === 'replayed');
    },

    /** The Rebalance card for the plan in use, with these lines skipped. Null: no plan in use. */
    async rebalance(rejected: ReadonlySet<string> = new Set()): Promise<RebalanceCardData | null> {
      const r = await read();
      if (r === null) return null;
      const res = await plan(r);
      return card(r, res.ops, rejected);
    },

    /**
     * Apply (Ben's tap): the accepted lines from this week on, as one plan edit (op ID; refused when the plan moved
     * since the card was read, rule 5). The engine runs again on the stored plan, so what is written is what was shown.
     */
    async apply(req: { planId: string; expectedVersion: number; rejected: readonly string[]; opId: string }): Promise<PlanEditOutcome> {
      const r = await read();
      if (r === null || r.plan.id !== req.planId) return { ok: false, reason: 'missing', message: PLAN_MUSCLES_SERVICE_COPY.noPlan };
      if (r.plan.opIds.includes(req.opId)) return { ok: true, planId: r.plan.id, version: r.plan.version };
      if (r.plan.version !== req.expectedVersion) return { ok: false, reason: 'stale', message: PLAN_MUSCLES_SERVICE_COPY.stale };
      const b = pbAppliedBuilder(r.plan);
      const eb = editBlockOf(r.block);
      if (b === null || eb === null) return { ok: false, reason: 'missing', message: PLAN_MUSCLES_SERVICE_COPY.notBuilder };
      const res = await plan(r);
      const rejected = new Set(req.rejected);
      const ops = res.ops.filter((o) => !rejected.has(o.id));
      if (ops.length === 0) return { ok: false, reason: 'nothing', message: PLAN_MUSCLES_SERVICE_COPY.nothing };
      if (!card(r, res.ops, rejected).canApply) return { ok: false, reason: 'stale', message: PLAN_MUSCLES_SERVICE_COPY.stale };
      const keyOf = (dayIndex: number, key: string | null) => (key === null ? null : (r.typical.find((d) => d.dayIndex === dayIndex)?.rows.find((x) => x.key === key)?.exerciseId ?? null));
      const ctx = {
        planId: r.plan.id,
        slotOf: (id: string) => {
          const e = r.of(id);
          return e === null ? null : { catalogueId: (e.catalogueKey ?? e.id).slice(0, 80), reps: { min: 8, max: 12 } };
        },
        mateOf: (o: Extract<RebalanceOp, { kind: 'add' }>) => keyOf(o.dayIndex, o.supersetWith),
      };
      // Each day as its workout runs it now (Ben's own template edits kept), on the version in use now.
      const routines = planRoutines(r.plan, liveRoutines(await repos().routines.listByOwner(r.p.id).catch(() => [] as Routine[])));
      const daysAt = pbDaysAtOf(r.plan);
      const nowN = pbWeekVersionOf(r.plan, eb.week);
      const asWorkout = (w: number, d: PlanDayDraft): PlanDayDraft => {
        if (pbWeekVersionOf(r.plan, w) !== nowN) return d;
        const made = r.plan.applied?.made.find((m) => m.dayIndex === d.index)?.routineId;
        const t = routines.find((x) => x.id === made) ?? routines.find((x) => planDayOf(x)?.dayIndex === d.index);
        if (t === undefined) return d;
        const n = daysAt.get(d.index) ?? null;
        const base = n === null ? null : (pbVersionOf(r.plan, n)?.days.find((x) => x.index === d.index) ?? null);
        return pbDayAsWorkout(d, t.exercises, base, (id) => {
          const e = r.of(id);
          return e === null ? null : { unit: r.p.preferredUnit, convention: e.defaultLoadConvention };
        });
      };
      const at = deps.now();
      const written = await repos()
        .planDrafts.edit(r.p.id, r.plan.id, (current, routines) => {
          const weekDays = pbRebalanceWeekDays(current, b.builder.answers.weeks, eb, ops, { ...ctx, asWorkout });
          const v = currentPlanVersion(current);
          return applyPlanEdit(current, { expectedVersion: req.expectedVersion, opId: req.opId, at, answers: b.builder.answers, gymId: v.request.gymId, equipmentVersion: v.equipmentVersion, weekDays, startReps: {}, block: eb, routines });
        })
        .catch(() => null);
      return editOutcome(written);
    },

    /**
     * (Ben, 2 Nov) The coach's `propose_rebalance`: this screen's card for the plan in use, the same engine and the same
     * lines (`rebalance()`), as the record keeps it. Refused with one line when there's nothing to propose.
     */
    async coachProposal(): Promise<RebalancePrepared> {
      const r = await read();
      if (r === null) return { kind: 'refused', line: PLAN_MUSCLES_SERVICE_COPY.noPlan };
      if (pbAppliedBuilder(r.plan) === null || editBlockOf(r.block) === null) return { kind: 'refused', line: PLAN_MUSCLES_SERVICE_COPY.notBuilder };
      const res = await plan(r);
      const c = card(r, res.ops, new Set());
      if (c.empty) return { kind: 'refused', line: res.flagsBefore.length === 0 ? PLAN_MUSCLES_SERVICE_COPY.allInRange : PLAN_MUSCLES_SERVICE_COPY.noRoom };
      return {
        kind: 'ok',
        detail: {
          kind: 'propose_rebalance',
          planId: c.planId,
          planVersion: c.planVersion,
          lines: c.lines.slice(0, 40).map((l) => ({ id: l.id.slice(0, 40), dayIndex: l.dayIndex, text: l.text.slice(0, 200) })),
          bars: c.bars.slice(0, 20).map((b) => ({ group: b.group, text: b.text.slice(0, 120), inRange: b.statusAfter === 'in' })),
          minutes: c.minutes.slice(0, 14).map((m) => ({ dayIndex: m.dayIndex, text: m.text.slice(0, 120), over: m.over })),
          why: c.why.slice(0, 2).map((w) => w.slice(0, 400)),
          resolved: c.resolved,
        },
      };
    },

    /** The coach card's state: open (with the live card for these skipped lines), applied, undone, or out of date. */
    async coachCard(d: RebalanceDetail, actionId: string, rejected: ReadonlySet<string> = new Set()): Promise<RebalanceCoachState> {
      const p = await deps.profile().catch(() => null);
      const doc = p === null ? null : await repos().planDrafts.get(d.planId).catch(() => null);
      if (doc === null || doc.ownerId !== p?.id) return { kind: 'gone' };
      if (doc.opIds.includes(rebalanceUndoOpId(actionId))) return { kind: 'undone' };
      if (doc.opIds.includes(rebalanceApplyOpId(actionId))) return { kind: 'applied' };
      if (doc.status !== 'applied' || doc.version !== d.planVersion) return { kind: 'stale' };
      const r = await read();
      if (r === null || r.plan.id !== d.planId) return { kind: 'stale' };
      const res = await plan(r);
      return { kind: 'open', card: card(r, res.ops, rejected) };
    },

    /** Apply on the coach's card: the screen's Apply on the version the coach read (stale: refused, rule 5). */
    applyCoach(d: RebalanceDetail, actionId: string, rejected: readonly string[]): Promise<PlanEditOutcome> {
      return api.apply({ planId: d.planId, expectedVersion: d.planVersion, rejected, opId: rebalanceApplyOpId(actionId) });
    },

    /** Undo on the coach's card: only while that Apply is the plan's last edit (the screen's Undo). */
    async undoCoach(d: RebalanceDetail, actionId: string): Promise<PlanEditOutcome> {
      const p = await deps.profile().catch(() => null);
      const doc = p === null ? null : await repos().planDrafts.get(d.planId).catch(() => null);
      if (doc === null || doc.lastEdit?.opId !== rebalanceApplyOpId(actionId)) return { ok: false, reason: 'stale', message: PLAN_MUSCLES_SERVICE_COPY.stale };
      return api.undo({ planId: d.planId, expectedVersion: doc.version, opId: rebalanceUndoOpId(actionId) });
    },

    /** Undo of that Apply: the plan and its workouts exactly as before, only from the version it left (rule 5). */
    async undo(req: { planId: string; expectedVersion: number; opId: string }): Promise<PlanEditOutcome> {
      const p = await deps.profile().catch(() => null);
      if (p === null) return { ok: false, reason: 'missing', message: PLAN_MUSCLES_SERVICE_COPY.noPlan };
      const at = deps.now();
      const r = await repos()
        .planDrafts.edit(p.id, req.planId, (current, routines) => undoPlanEdit(current, { expectedVersion: req.expectedVersion, opId: req.opId, at, routines }))
        .catch(() => null);
      return editOutcome(r);
    },
  };
  return api;
}

export type PlanMusclesService = ReturnType<typeof createPlanMusclesService>;
