import {
  anchorE1rmOf,
  BUILDER_SET_RULES,
  dayMonthText,
  formulaApplies,
  infoOrDefault,
  referenceE1rm,
  restClockText,
  slotsOf,
  workingCount,
  workingRestS,
  type BuilderContext,
  type BuilderSetRow,
  type BuilderSlot,
  type BuilderWorkout,
  type LoadReferences,
  type RefSession,
} from '@fizz/domain';
import type { LoadConvention, WeightUnit } from '@fizz/schemas';
import { exerciseNames, type ClaimExtra } from './claims';
import { builderLoadText, builderRepsText } from './edit-ops';
import { focusSets, ownFocusOf } from './focus';
import { topLoad } from './load-guard';

/**
 * Coach review's context, worked out by code (workout-builder-v3 §2.9; Ben, 23 Oct: "the coach should review the
 * sets and weights as well in context of the goals and history"). Pure.
 *
 * - `reviewEdits`: Ben's own edits, diffed against what was drafted (`WorkoutDraftVersion.drafted`): loads, reps,
 *   sets, RPE, rest, exercises removed, added or swapped, the length. What Time cut is told apart (`cause: 'time'`).
 * - `reviewLiftFacts`: per exercise, the facts the coach judges the numbers by: his recent sessions (deload weeks
 *   marked), his est. 1RM (always labelled an estimate, rule 6), the trend or a stall, today's load against his best
 *   recent load for the same reps (a percentage code worked out), a lift target, a pain flag (rule 9) and the
 *   muscle's working sets today.
 *
 * Every number in these lines is also handed to the claim check (`ClaimExtra`), so the coach may quote them and
 * nothing else.
 */

const EPS = 1e-6;
const LB_PER_KG = 2.20462;
const fmt = (v: number): string => String(Math.round(v * 100) / 100);
const round1 = (v: number): number => Math.round(v * 10) / 10;
const halfUp = (v: number): number => Math.round(v * 2) / 2;

export type ReviewEditKind = 'removed' | 'added' | 'swapped' | 'sets' | 'reps' | 'rpe' | 'load' | 'rest' | 'minutes';

export interface ReviewEdit {
  /** `e1`, `e2`: what the coach's comment names. */
  id: string;
  kind: ReviewEditKind;
  /** `ben`: his own edit; `time`: what Your workout's Time cut (his Time, code's cut). */
  cause: 'ben' | 'time';
  slotKey: string | null;
  exerciseId: string | null;
  /** The exercise it was drafted with (a swap's or removal's), else `exerciseId`. */
  fromExerciseId: string | null;
  before: number | null;
  after: number | null;
  /** Code's words: `Barbell bench press top 100 → 110 kg`, `Cable fly removed`, `Curls 3 → 6 sets`. */
  text: string;
}

export interface ReviewDrafted {
  workout: BuilderWorkout;
  minutes: number;
}

export interface ReviewEditsInput {
  /** What was drafted (null: not known, an older draft). */
  drafted: ReviewDrafted | null;
  workout: BuilderWorkout;
  minutes: number;
  ctx: Pick<BuilderContext, 'info' | 'restDefaultsS'>;
  /**
   * Your workout's Time (`BuilderSetup.timeFit`): the slots it left out and the working sets it took from each; above
   * the plan's length on Today's card, the slots it added and the working sets it added to each.
   */
  time?: { dropped: readonly string[]; cut: Readonly<Record<string, number>>; added?: readonly string[]; raised?: Readonly<Record<string, number>> } | null;
}

const working = (s: BuilderSlot): BuilderSetRow[] => s.rows.filter((r) => r.type !== 'warmup');
/** The set Ben reads a slot's reps and RPE from: the top set, else the first working set. */
const leadRow = (s: BuilderSlot): BuilderSetRow | undefined => s.rows.find((r) => r.type === 'top') ?? working(s).find((r) => r.type !== 'drop');
const hasTop = (s: BuilderSlot): boolean => s.rows.some((r) => r.type === 'top');

function loadChangeText(name: string, s: BuilderSlot, a: number, b: number): string {
  return `${name}${hasTop(s) ? ' top' : ''} ${s.convention === 'added' ? '+' : ''}${fmt(a)} → ${builderLoadText(b, s.unit, s.convention)}`;
}

/**
 * `reviewEdits`: Ben's own edits, in workout order (the length first, removals last). Null when what was drafted
 * isn't known. A slot keeps its key through Ben's own swap, so a key holding another exercise is a swap.
 */
export function reviewEdits(input: ReviewEditsInput): ReviewEdit[] | null {
  const d = input.drafted;
  if (d === null) return null;
  const name = (id: string): string => infoOrDefault(input.ctx.info, id).name;
  const rest = (s: BuilderSlot, w: BuilderWorkout): number | null => workingRestS(s, input.ctx.info, w.restLevel, input.ctx.restDefaultsS);
  const dropped = new Set(input.time?.dropped ?? []);
  const cut = input.time?.cut ?? {};
  const timeAdded = new Set(input.time?.added ?? []);
  const raised = input.time?.raised ?? {};
  const was = new Map(slotsOf(d.workout.blocks).map((s) => [s.key, s]));
  const now = slotsOf(input.workout.blocks);
  const out: Omit<ReviewEdit, 'id'>[] = [];
  const edit = (e: Omit<ReviewEdit, 'id'>): void => {
    out.push(e);
  };

  if (d.minutes !== input.minutes) edit({ kind: 'minutes', cause: 'ben', slotKey: null, exerciseId: null, fromExerciseId: null, before: d.minutes, after: input.minutes, text: `Length ${String(d.minutes)} → ${String(input.minutes)} min` });

  for (const s of now) {
    const b = was.get(s.key);
    const n = name(s.exerciseId);
    if (b === undefined) {
      const byTime = timeAdded.has(s.key);
      edit({ kind: 'added', cause: byTime ? 'time' : 'ben', slotKey: s.key, exerciseId: s.exerciseId, fromExerciseId: null, before: null, after: workingCount(s), text: `${n} added (${String(workingCount(s))} sets)${byTime ? ' (Time)' : ''}` });
      continue;
    }
    if (b.exerciseId !== s.exerciseId) {
      edit({ kind: 'swapped', cause: 'ben', slotKey: s.key, exerciseId: s.exerciseId, fromExerciseId: b.exerciseId, before: null, after: null, text: `${name(b.exerciseId)} → ${n}` });
      continue;
    }
    // Sets: what Time took (or added) is put back first; the rest of the difference is his.
    const sa = workingCount(b);
    const sb = workingCount(s);
    const timeMoved = (raised[s.key] ?? 0) - (cut[s.key] ?? 0);
    const his = sb - timeMoved;
    if (his !== sa) edit({ kind: 'sets', cause: 'ben', slotKey: s.key, exerciseId: s.exerciseId, fromExerciseId: s.exerciseId, before: sa, after: his, text: `${n} ${String(sa)} → ${String(his)} sets` });
    if (timeMoved !== 0) edit({ kind: 'sets', cause: 'time', slotKey: s.key, exerciseId: s.exerciseId, fromExerciseId: s.exerciseId, before: his, after: sb, text: `${n} ${String(his)} → ${String(sb)} sets (Time)` });
    const ra = leadRow(b);
    const rb = leadRow(s);
    if (ra !== undefined && rb !== undefined) {
      const ta = builderRepsText(ra);
      const tb = builderRepsText(rb);
      if (ta !== tb && ra.durationS === undefined && rb.durationS === undefined) edit({ kind: 'reps', cause: 'ben', slotKey: s.key, exerciseId: s.exerciseId, fromExerciseId: s.exerciseId, before: ra.reps, after: rb.reps, text: `${n} ${ta} → ${tb} reps` });
      if (ra.rpe != null && rb.rpe != null && Math.abs(ra.rpe - rb.rpe) > EPS) edit({ kind: 'rpe', cause: 'ben', slotKey: s.key, exerciseId: s.exerciseId, fromExerciseId: s.exerciseId, before: ra.rpe, after: rb.rpe, text: `${n} RPE ${fmt(ra.rpe)} → ${fmt(rb.rpe)}` });
    }
    const la = topLoad(b);
    const lb = topLoad(s);
    if (la !== null && lb !== null && b.unit === s.unit && b.convention === s.convention && Math.abs(la - lb) > EPS) edit({ kind: 'load', cause: 'ben', slotKey: s.key, exerciseId: s.exerciseId, fromExerciseId: s.exerciseId, before: la, after: lb, text: loadChangeText(n, s, la, lb) });
    const xa = rest(b, d.workout);
    const xb = rest(s, input.workout);
    // A rest only Time's shorter-rests step moved is Time's, not his (`restLevel`); his own rest is `restS`.
    if (xa !== null && xb !== null && xa !== xb) {
      const own = s.restS !== undefined && stableRest(s) !== stableRest(b);
      edit({ kind: 'rest', cause: own ? 'ben' : 'time', slotKey: s.key, exerciseId: s.exerciseId, fromExerciseId: s.exerciseId, before: xa, after: xb, text: `${n} rest ${restClockText(xa)} → ${restClockText(xb)}${own ? '' : ' (Time)'}` });
    }
  }
  const nowKeys = new Set(now.map((s) => s.key));
  for (const b of slotsOf(d.workout.blocks)) {
    if (nowKeys.has(b.key)) continue;
    const byTime = dropped.has(b.key);
    edit({ kind: 'removed', cause: byTime ? 'time' : 'ben', slotKey: b.key, exerciseId: null, fromExerciseId: b.exerciseId, before: workingCount(b), after: null, text: `${name(b.exerciseId)} ${byTime ? 'left out (Time)' : 'removed'}` });
  }
  return out.map((e, i) => ({ ...e, id: `e${String(i + 1)}` }));
}

const stableRest = (s: BuilderSlot): string => JSON.stringify(s.restS ?? {});

/** The edit lines as the coach is given them: `e1 · Bench top 100 → 110 kg (his edit)`. */
export function reviewEditLines(edits: readonly ReviewEdit[]): { editId: string; change: string; by: 'Ben' | 'Time' }[] {
  return edits.map((e) => ({ editId: e.id, change: e.text, by: e.cause === 'ben' ? 'Ben' : 'Time' }));
}

// ---------------------------------------------------------------------------
// Per-exercise facts

export interface ReviewLiftTarget {
  exerciseId: string;
  value: number;
  unit: WeightUnit;
  convention: LoadConvention | 'total' | 'per_hand' | 'stack' | 'added';
  reps: number;
  /** `1 Dec`, or null. */
  by: string | null;
}

export interface ReviewLiftFacts {
  slotKey: string;
  exerciseId: string;
  exercise: string;
  /** Code's lines (`Last sessions: 100 kg × 6 @ RPE 8 (13 Oct), …`, `110 kg is 9% above his best recent load for 6 reps`). */
  facts: string[];
  /** Every number above, for the claim check. */
  claims: ClaimExtra;
}

export interface ReviewLiftInput {
  workout: BuilderWorkout;
  ctx: Pick<BuilderContext, 'info' | 'restDefaultsS'>;
  /** Ben's comparable history for an exercise (`BuilderEnv.refsOf`); null: none read. */
  refs: (exerciseId: string) => LoadReferences | null;
  pain: (exerciseId: string) => string | null;
  targets: readonly ReviewLiftTarget[];
  /** Ben's edits (their before values join the claim facts), and what was drafted. */
  edits: readonly ReviewEdit[] | null;
  drafted: ReviewDrafted | null;
}

/** How many recent sessions are shown per exercise; how many the trend reads. */
export const REVIEW_HISTORY = { shown: 3, trend: 4, trendPct: 2 } as const;

const toUnit = (v: number, from: WeightUnit, to: WeightUnit): number => (from === to ? v : to === 'lb' ? v * LB_PER_KG : v / LB_PER_KG);

function setText(v: number, reps: number, rpe: number | null, unit: WeightUnit, convention: LoadConvention): string {
  return `${builderLoadText(round1(v), unit, convention)} × ${String(reps)}${rpe === null ? '' : ` @ RPE ${fmt(rpe)}`}`;
}

/** `reviewLiftFacts`: per exercise in the workout, the facts its numbers are judged by. */
export function reviewLiftFacts(input: ReviewLiftInput): ReviewLiftFacts[] {
  const slots = slotsOf(input.workout.blocks);
  const focus = focusSets(slots, input.ctx);
  const draftedSlots = new Map(input.drafted === null ? [] : slotsOf(input.drafted.workout.blocks).map((s) => [s.key, s]));
  const out: ReviewLiftFacts[] = [];
  for (const s of slots) {
    const info = infoOrDefault(input.ctx.info, s.exerciseId);
    const name = info.name;
    const unit = s.unit;
    const conv = s.convention;
    const lines: string[] = [];
    const c = { loads: [] as { value: number; unit: WeightUnit }[], estimates: [] as { value: number; unit: WeightUnit }[], reps: [] as number[], rpe: [] as number[], sets: [] as number[], percents: [] as number[], rests: [] as number[] };
    const load = (v: number) => c.loads.push({ value: round1(v), unit });
    const est = (v: number) => c.estimates.push({ value: v, unit });

    const refs = input.refs(s.exerciseId);
    const sameKind = refs !== null && refs.convention === conv;
    const conv1 = (v: number): number => (refs === null ? v : toUnit(v, refs.unit, unit));
    const sessions: RefSession[] = sameKind ? refs.all : [];
    const lead = leadRow(s);
    const top = topLoad(s);
    const formula = formulaApplies(conv);

    // Recent sessions, newest first, deload weeks marked (PM, 23 Oct: they aren't normal history).
    const shown = sessions.slice(0, REVIEW_HISTORY.shown);
    if (shown.length > 0) {
      const parts = shown.map((x) => {
        const t = x.top;
        load(conv1(t.value));
        c.reps.push(t.reps);
        if (t.rpe !== null) c.rpe.push(t.rpe);
        for (const y of x.sets) {
          load(conv1(y.value));
          c.reps.push(y.reps);
        }
        return `${setText(conv1(t.value), t.reps, t.rpe, unit, conv)} (${dayMonthText(x.performedAtUtc, x.tz).replace(/\u00a0/g, ' ')}${x.deload === true ? ', deload week' : ''})`;
      });
      lines.push(`Last sessions, top set: ${parts.join(', ')}`);
    } else lines.push('No history for this exercise');

    const normal = sessions.filter((x) => x.deload !== true);
    if (sessions[0]?.deload === true) lines.push('His last session of it was a deload week');

    // Est. 1RM (always an estimate, rule 6) and its trend over normal weeks.
    const e1 = formula && sameKind && refs.own?.e1rm != null ? halfUp(conv1(refs.own.e1rm)) : null;
    if (e1 !== null) {
      est(e1);
      lines.push(`Est. 1RM ${builderLoadText(e1, unit, conv)} (estimate)`);
    }
    if (formula) {
      const series = normal
        .slice(0, REVIEW_HISTORY.trend)
        .map((x) => referenceE1rm(x.sets))
        .filter((v): v is number => v !== null)
        .map((v) => halfUp(conv1(v)));
      if (series.length >= 3) {
        for (const v of series) est(v);
        const newest = series[0] ?? 0;
        const oldest = series[series.length - 1] ?? 0;
        const pct = oldest > 0 ? Math.round(((newest - oldest) / oldest) * 100) : 0;
        const stalled = newest <= Math.max(...series.slice(1, 3)) + EPS;
        lines.push(`Est. 1RM by session, newest first: ${series.map(fmt).join(', ')} ${unit} (estimate)`);
        lines.push(stalled ? 'No new best in his last 3 normal sessions (stalled)' : pct >= REVIEW_HISTORY.trendPct ? 'Trend: up' : pct <= -REVIEW_HISTORY.trendPct ? 'Trend: down' : 'Trend: flat');
      }
    }

    // Today's load against his best recent load for the same reps (or more), normal weeks only.
    if (top !== null && lead !== undefined && lead.durationS === undefined) {
      load(top);
      const reps = lead.reps;
      const candidates = normal.slice(0, 5).flatMap((x) => x.sets.filter((y) => y.reps >= reps).map((y) => conv1(y.value)));
      const harder = (a: number, b: number) => (conv === 'assistance' ? a < b : a > b);
      const best = candidates.reduce<number | null>((m, v) => (m === null || harder(v, m) ? v : m), null);
      const today = builderLoadText(top, unit, conv);
      if (best !== null && best > 0) {
        const b = round1(best);
        load(b);
        c.reps.push(reps);
        const pct = Math.round((Math.abs(top - b) / b) * 100);
        lines.push(`Best recent load for ${String(reps)} reps: ${builderLoadText(b, unit, conv)}`);
        if (pct >= 1) {
          c.percents.push(pct);
          const up = top > b;
          lines.push(`${today} today is ${String(pct)}% ${up ? 'above' : 'below'} his best recent load for ${String(reps)} reps${conv === 'assistance' ? (up ? ' (more assistance: easier)' : ' (less assistance: harder)') : ''}`);
        } else lines.push(`${today} today matches his best recent load for ${String(reps)} reps`);
      } else if (e1 !== null && formula) {
        const implied = anchorE1rmOf({ value: top, reps, rpe: lead.rpe ?? BUILDER_SET_RULES.workRpe });
        if (implied !== null) {
          const i = halfUp(implied);
          est(i);
          const pct = Math.round((Math.abs(i - e1) / e1) * 100);
          lines.push(`${today} × ${String(reps)} @ RPE ${fmt(lead.rpe ?? BUILDER_SET_RULES.workRpe)} implies est. 1RM ${builderLoadText(i, unit, conv)} (estimate)${pct >= 1 ? `, ${String(pct)}% ${i > e1 ? 'above' : 'below'} his` : ', the same as his'}`);
          if (pct >= 1) c.percents.push(pct);
        }
      }
    }

    // Lift target (Your data, only while lift targets are on).
    const target = input.targets.find((t) => t.exerciseId === s.exerciseId);
    if (target !== undefined) {
      const v = round1(toUnit(target.value, target.unit, unit));
      load(v);
      c.reps.push(target.reps);
      lines.push(`Lift target ${builderLoadText(v, unit, conv)} × ${String(target.reps)}${target.by === null ? '' : ` by ${target.by}`}`);
    }

    // Pain (rule 9): never heavier or harder.
    const pain = input.pain(s.exerciseId);
    if (pain !== null) lines.push(`Pain flag: ${pain}. Never heavier or harder.`);

    // The muscle's working sets today (its own focus, full; others half).
    const own = ownFocusOf(info);
    const n = workingCount(s);
    c.sets.push(n);
    if (own !== null) lines.push(`${String(n)} working sets of ${name} today; ${own} ${String(focus.get(own) ?? n)} working sets in all today`);

    // Today's own reps, RPE and rest, and what was drafted (his edits' before values).
    for (const r of working(s)) {
      c.reps.push(r.reps);
      if (r.repsMax !== undefined) c.reps.push(r.repsMax);
      if (r.rpe != null) c.rpe.push(r.rpe);
      if (r.load != null) load(r.load);
    }
    const restNow = workingRestS(s, input.ctx.info, input.workout.restLevel, input.ctx.restDefaultsS);
    if (restNow !== null) c.rests.push(restNow);
    const d = draftedSlots.get(s.key);
    if (d !== undefined && input.drafted !== null) {
      c.sets.push(workingCount(d));
      for (const r of working(d)) {
        c.reps.push(r.reps);
        if (r.rpe != null) c.rpe.push(r.rpe);
        if (r.load != null && d.unit === unit) load(r.load);
      }
      const restWas = workingRestS(d, input.ctx.info, input.drafted.workout.restLevel, input.ctx.restDefaultsS);
      if (restWas !== null) c.rests.push(restWas);
    }
    for (const e of input.edits ?? []) {
      if (e.slotKey !== s.key) continue;
      for (const v of [e.before, e.after]) {
        if (v === null) continue;
        if (e.kind === 'sets') c.sets.push(v);
        else if (e.kind === 'reps') c.reps.push(v);
        else if (e.kind === 'rpe') c.rpe.push(v);
        else if (e.kind === 'load') load(v);
        else if (e.kind === 'rest') c.rests.push(v);
      }
    }

    out.push({ slotKey: s.key, exerciseId: s.exerciseId, exercise: name, facts: lines, claims: { names: exerciseNames(name), ...c } });
  }
  return out;
}

/** Claim facts for exercises Ben took out or swapped away (`Cable fly removed`, 3 sets drafted). */
export function removedClaimExtras(edits: readonly ReviewEdit[] | null, drafted: ReviewDrafted | null, ctx: Pick<BuilderContext, 'info'>): ClaimExtra[] {
  if (edits === null || drafted === null) return [];
  const was = new Map(slotsOf(drafted.workout.blocks).map((s) => [s.key, s]));
  return edits.flatMap((e) => {
    if ((e.kind !== 'removed' && e.kind !== 'swapped') || e.fromExerciseId === null || e.slotKey === null) return [];
    const s = was.get(e.slotKey);
    if (s === undefined) return [];
    return [{ names: exerciseNames(infoOrDefault(ctx.info, e.fromExerciseId).name), sets: [workingCount(s)], reps: working(s).map((r) => r.reps), ...(topLoad(s) === null ? {} : { loads: [{ value: topLoad(s) ?? 0, unit: s.unit }] }) }];
  });
}
