import type { EquipmentKind, LoadConvention, PlanBuilderAnswers, PlanDraft, PlanWeeks, SetExclusion, SetType, Load, WeightUnit } from '@fizz/schemas';

import { addDays, localDateOf, localWeekBounds, weekdayIndexOfDate } from '../calendar';
import { formatNumber, localDateText } from '../display';
import { pbBlockWeekOf, type PbBlockWeek, type PbBlockWorkout, type PbFinishedRef } from '../plan-builder/block';
import { pbIsDeload } from '../plan-builder/weeks';
import { toMs } from '../time';
import { KG_PER_LB } from '../units';
import {
  BLOCK_LIFT_COPY,
  blockDeltaIsGain,
  blockDeltaText,
  blockLineText,
  blockLoadKind,
  bestSetText,
  bestSetWithUnit,
  countingSets,
  liftBlockProgress,
  weekBestSet,
  type BlockBestSet,
  type LiftBlockProgress,
  type LiftWeekInput,
  type LiftWeekState,
} from './block-lifts';

/**
 * (Ben, 31 Oct; docs/design/block-progress.md) Every training block, kept. Pure.
 *
 * Blocks are never stored: they are worked out from the stored plan documents (Your data). Each applied plan document
 * (applied, superseded or ended) belongs to one block: the block named by its `applied.block` (30 Oct: a re-apply that
 * continued the block), else a block that starts at its own Apply. That covers plans applied before blocks existed
 * (23 Oct and earlier): each is its own block. A block runs from its start to the next block's start, or to its last
 * document's End / supersede; the one with a plan in use is current. History before the first block is
 * `Earlier training`. The block's weeks are `pbBlockWeekOf`'s (the same as Today's header: weeks with a plan workout,
 * pauses skipped), worked out at the block's end; a lead-in (applied after its Monday) is week 0. Every finished
 * workout inside the block's weeks counts for its lifts: plan, off-plan and imported alike.
 */

export const BLOCKS_COPY = {
  thisBlock: 'This block',
  blocks: 'Blocks',
  blocksLink: 'Blocks',
  week: (w: number, n: number) => `Week ${String(w)} of ${String(n)}`,
  weekOnly: (w: number) => `Week ${String(w)}`,
  leadIn: 'Lead-in',
  done: 'Block done',
  now: 'Now',
  earlier: 'Earlier training',
  block: (n: number, goal: string) => `Block ${String(n)} · ${goal}`,
  sessions: (done: number, of: number | null) => (of === null ? `${String(done)} ${done === 1 ? 'session' : 'sessions'}` : `${String(done)} of ${String(of)} sessions`),
  counts: (up: number, stalled: number) => [`${String(up)} up`, ...(stalled > 0 ? [`${String(stalled)} stalled`] : [])].join(' · '),
  libraryLine: (up: number, stalled: number) => [...(up > 0 ? [`${String(up)} ${up === 1 ? 'lift' : 'lifts'} up`] : []), ...(stalled > 0 ? [`${String(stalled)} stalled`] : [])].join(' · '),
  legendUp: 'Up / held',
  legendStalled: 'Stalled',
  legendDeload: 'Deload',
  byBlock: (name: string) => `${name} by block`,
  compareHead: ['Block', 'Start', 'End', 'Change'] as const,
  tableHead: ['Week', 'Top set', 'Sets', 'Est. 1RM'] as const,
  running: (best: string, n: number) => `Top set ${best}, ${String(n)} weeks running.`,
  nextWeek: 'Next week',
  deload: 'Deload',
} as const;

const GOAL_WORD: Readonly<Record<PlanBuilderAnswers['focus'], string>> = { strength: 'Strength', muscle: 'Muscle', balanced: 'Balanced', fitness: 'Fitness' };

/** A stored plan document as the blocks read it. */
export type BlockPlanDoc = Pick<PlanDraft, 'id' | 'name' | 'status' | 'versions' | 'currentVersion' | 'applied' | 'pauses' | 'updatedAtUtc'> & Partial<Pick<PlanDraft, 'ended' | 'supersededBy'>>;

export interface TrainingBlock {
  /** Stable: the block's first plan document. */
  key: string;
  /** 1 = the oldest. */
  n: number;
  /** Its plan documents, oldest Apply first. */
  planIds: string[];
  current: boolean;
  startedAtUtc: string;
  /** When it stopped (the next block's start, End, supersede); null while current. */
  endedAtUtc: string | null;
  /** `Muscle`, `Strength`; a coach plan's name. */
  goal: string;
  /** Builder plans: the plan's length and effort (deload weeks); null on a coach plan (no length). */
  answers: Pick<PlanBuilderAnswers, 'weeks' | 'effort' | 'sessions'> | null;
  /** The block's weeks, worked out at its end (or now). */
  week: PbBlockWeek;
  /** The lead-in's Monday (a block applied after its Monday); null: none. */
  leadInMonday: string | null;
  /** Plan workouts done in it (lead-in included). */
  sessionsDone: number;
  /** Each plan day's main lift, deduplicated, in day order (the newest document's). */
  mainLiftIds: string[];
}

const versionOf = (p: BlockPlanDoc) => p.versions.find((v) => v.n === p.currentVersion) ?? p.versions.find((v) => v.n === p.applied?.versionN);

/** Each plan day's main lift, deduplicated, in day order. */
export function planMainLiftIds(p: Pick<BlockPlanDoc, 'versions' | 'currentVersion' | 'applied'>): string[] {
  const v = p.versions.find((x) => x.n === p.currentVersion) ?? p.versions.find((x) => x.n === p.applied?.versionN);
  const out: string[] = [];
  for (const d of [...(v?.days ?? [])].sort((a, b) => a.index - b.index)) {
    const slots = [...d.plan.slots].sort((a, b) => a.order - b.order);
    const main = slots.find((s) => s.main);
    if (main !== undefined && !out.includes(main.exerciseId)) out.push(main.exerciseId);
  }
  return out;
}

/** A coach plan has no length: its weeks run on until it ends (a bound only; never shown). */
const OPEN_LENGTH = 520 as unknown as PlanWeeks;

/** The plan documents' blocks, oldest first. `refs` are Ben's finished workouts as the plan reads them (`linkRefs`). */
export function trainingBlocks(plans: readonly BlockPlanDoc[], refs: readonly PbFinishedRef[], nowMs: number, tz: string, mainLiftsNow: readonly string[] | null = null): TrainingBlock[] {
  const docs = plans.filter((p) => p.applied !== null).sort((a, b) => toMs(a.applied?.atUtc ?? '') - toMs(b.applied?.atUtc ?? ''));
  const groups = new Map<string, BlockPlanDoc[]>();
  const keyOf = new Map<string, string>();
  for (const d of docs) {
    const a = d.applied;
    if (a === null) continue;
    // A continuing Apply names the earlier documents of its block: it joins theirs.
    const earlier = (a.block?.plans ?? []).map((p) => keyOf.get(p.planId)).find((k) => k !== undefined);
    const key = earlier ?? d.id;
    keyOf.set(d.id, key);
    groups.set(key, [...(groups.get(key) ?? []), d]);
  }
  const ordered = [...groups.entries()].map(([key, members]) => ({ key, members, startUtc: members[0]?.applied?.block?.startedAtUtc ?? members[0]?.applied?.atUtc ?? '' })).sort((a, b) => toMs(a.startUtc) - toMs(b.startUtc));
  return ordered.map((g, i): TrainingBlock => {
    const latest = g.members[g.members.length - 1] as BlockPlanDoc;
    const current = g.members.some((m) => m.status === 'applied');
    const next = ordered[i + 1];
    const stop = (m: BlockPlanDoc) => m.ended?.atUtc ?? m.supersededBy?.atUtc ?? m.updatedAtUtc;
    const endedAtUtc = current ? null : (next?.members[0]?.applied?.atUtc ?? stop(latest));
    const endMs = endedAtUtc === null ? nowMs : Math.min(nowMs, toMs(endedAtUtc) - 1);
    const builder = versionOf(latest)?.builder?.answers ?? null;
    const answers = builder === null ? null : { weeks: builder.weeks, effort: builder.effort, sessions: builder.sessions };
    const startMs = toMs(g.startUtc);
    const planIds = new Set(g.members.map((m) => m.id));
    const made = new Map(g.members.flatMap((m) => (m.applied?.made ?? []).map((x) => [x.routineId, x.dayIndex] as const)));
    const workouts: PbBlockWorkout[] = refs.flatMap((r) => {
      const ms = toMs(r.startedAtUtc);
      if (ms < localWeekBounds(startMs, tz).startMs || ms > endMs) return [];
      if (r.planDay !== undefined && planIds.has(r.planDay.planId)) return [{ startedAtUtc: r.startedAtUtc, dayIndex: r.planDay.dayIndex }];
      const day = r.routineId === null ? undefined : made.get(r.routineId);
      const variants = (r.variantRoutineIds ?? []).flatMap((id) => {
        const x = made.get(id);
        return x === undefined ? [] : [x];
      });
      return day === undefined ? [] : [{ startedAtUtc: r.startedAtUtc, dayIndex: day, ...(variants.length > 1 ? { dayIndexes: variants } : {}) }];
    });
    const pauses = g.members.flatMap((m) => m.pauses ?? []);
    const week = pbBlockWeekOf({ answers: answers ?? { weeks: OPEN_LENGTH, effort: 'maintain' }, appliedAtUtc: g.startUtc, pauses, workouts, nowMs: endMs, tz });
    const applyMonday = localWeekBounds(startMs, tz).mondayLocalDate;
    const leadInMonday = localDateOf(startMs, tz) === applyMonday ? null : applyMonday;
    const goal = builder === null ? latest.name : GOAL_WORD[builder.focus];
    const mains = current && mainLiftsNow !== null && mainLiftsNow.length > 0 ? [...new Set(mainLiftsNow)] : planMainLiftIds(latest);
    const sessionsDone = workouts.filter((w) => toMs(w.startedAtUtc) >= startMs).length;
    return { key: g.key, n: i + 1, planIds: g.members.map((m) => m.id), current, startedAtUtc: g.startUtc, endedAtUtc, goal, answers, week, leadInMonday, sessionsDone, mainLiftIds: mains };
  });
}

// ---------------------------------------------------------------------------
// The block's weeks and each lift's sets in them

/** A finished workout as the blocks read it (a `ProgressSession`). */
export interface BlockSession {
  sessionId: string;
  startedAtUtc: string;
  /** Local date in Ben's zone. */
  date: string;
  exercises: readonly {
    exerciseId: string;
    exerciseName: string;
    equipmentKind: EquipmentKind | null;
    convention: LoadConvention;
    unit: WeightUnit;
    measurement?: string;
    sets: readonly { setType: SetType; load: Load | null; reps: number | null; exclusions?: readonly SetExclusion[] | undefined }[];
  }[];
}

/** One block week: its number (0 the lead-in), Monday, and whether it is a deload / reached. */
export interface BlockWeekSlot {
  week: number;
  monday: string | null;
  deload: boolean;
  reached: boolean;
}

/** The block's weeks to show: the lead-in (week 0) when there is one, then 1…N (a coach plan: the weeks so far). */
export function blockWeekSlots(b: Pick<TrainingBlock, 'week' | 'answers' | 'leadInMonday' | 'current'>): BlockWeekSlot[] {
  const of = b.answers?.weeks ?? Math.max(1, b.week.mondays.length);
  // Done: every week. In the lead-in: none yet. Current: up to this week. A past block that stopped early: its counted
  // weeks, and the week it stopped in when something was done that week.
  const counted = b.week.mondays.length - 1;
  const reachedWeeks = b.week.done ? of : b.week.leadIn !== undefined ? 0 : b.current ? b.week.week : counted + (hasDays(b.week, counted) ? 1 : 0);
  const out: BlockWeekSlot[] = [];
  if (b.leadInMonday !== null) out.push({ week: 0, monday: b.leadInMonday, deload: false, reached: true });
  for (let w = 1; w <= of; w += 1) out.push({ week: w, monday: b.week.mondays[w - 1] ?? null, deload: b.answers !== null && pbIsDeload(b.answers, w), reached: w <= reachedWeeks });
  return out;
}

const hasDays = (b: PbBlockWeek, i: number) => (b.daysDone[i]?.length ?? 0) > 0;

const plainSpaces = (t: string) => t.replaceAll('\u00a0', ' ');

const mondayOf = (date: string) => addDays(date, -weekdayIndexOfDate(date));

/** The sessions inside a block (its window and its weeks), by block week. */
function sessionsByWeek(b: Pick<TrainingBlock, 'startedAtUtc' | 'endedAtUtc'>, slots: readonly BlockWeekSlot[], sessions: readonly BlockSession[]): Map<number, BlockSession[]> {
  const startMs = toMs(b.startedAtUtc);
  const endMs = b.endedAtUtc === null ? Number.POSITIVE_INFINITY : toMs(b.endedAtUtc);
  const weekOfMonday = new Map(slots.flatMap((s) => (s.monday === null || !s.reached ? [] : [[s.monday, s.week] as const])));
  const out = new Map<number, BlockSession[]>();
  for (const s of sessions) {
    const ms = toMs(s.startedAtUtc);
    const w = weekOfMonday.get(mondayOf(s.date));
    // Inside the block's own window only: a workout before its Apply is the block before's (never counted twice).
    if (w === undefined || ms < startMs || ms >= endMs) continue;
    out.set(w, [...(out.get(w) ?? []), s]);
  }
  return out;
}

export interface LiftInBlock {
  exerciseId: string;
  name: string;
  progress: LiftBlockProgress;
  /** Per week (same order as `progress.weeks`): the sessions of the lift, newest last. */
  sessionIds: string[][];
}

/** One lift's weeks in a block. */
export function liftInBlock(b: TrainingBlock, exerciseId: string, sessions: readonly BlockSession[], nameOf: (id: string) => string): LiftInBlock {
  const slots = blockWeekSlots(b);
  const byWeek = sessionsByWeek(b, slots, sessions);
  const rows = [...byWeek.values()].flat().flatMap((s) => s.exercises.filter((e) => e.exerciseId === exerciseId && (e.measurement === undefined || e.measurement === 'reps')));
  const conventions = rows.flatMap((e) => [e.convention, ...e.sets.flatMap((x) => (x.load === null ? [] : [x.load.convention]))]);
  const equipmentKind = rows.find((e) => e.equipmentKind !== null)?.equipmentKind ?? null;
  const unit = rows[rows.length - 1]?.unit ?? 'kg';
  const kind = blockLoadKind(conventions, equipmentKind);
  const logged = rows[rows.length - 1]?.exerciseName ?? '';
  const sessionIds: string[][] = [];
  const inputs: LiftWeekInput[] = slots.map((slot) => {
    const ss = (byWeek.get(slot.week) ?? []).filter((s) => s.exercises.some((e) => e.exerciseId === exerciseId));
    sessionIds.push(ss.map((s) => s.sessionId));
    const sets = ss.flatMap((s) => s.exercises.filter((e) => e.exerciseId === exerciseId).flatMap((e) => e.sets));
    return { week: slot.week, deload: slot.deload, reached: slot.reached, best: weekBestSet(sets, kind, equipmentKind, unit), sets: countingSets(sets, kind, equipmentKind).length };
  });
  return { exerciseId, name: nameOf(exerciseId) || logged, progress: liftBlockProgress(inputs), sessionIds };
}

// ---------------------------------------------------------------------------
// Views

export type BlockBarState = 'up' | 'stalled' | 'deload' | 'none';

export interface BlockWeekBar {
  week: number;
  state: BlockBarState;
  /** 0…1 within the lift; null: a flat grey or dashed bar. */
  level: number | null;
}

const BAR_OF: Readonly<Record<LiftWeekState, BlockBarState>> = { base: 'up', up: 'up', held: 'up', dip: 'up', stalled: 'stalled', deload: 'deload', none: 'none', todo: 'none', lead_in: 'none' };

export interface ThisBlockRow {
  exerciseId: string;
  name: string;
  /** `100×6 → 105×6 kg`; `100×6 kg` with one week; null: not trained in this block. */
  line: string | null;
  bars: BlockWeekBar[];
  /** `+5%`, `+5 kg`, `0%`; null with a stall (the pill) or nothing to compare. */
  delta: string | null;
  gain: boolean;
  stalled: boolean;
  accessibilityLabel: string;
}

export interface ThisBlockView {
  blockKey: string;
  current: boolean;
  title: string;
  /** `Week 3 of 6`, `Lead-in`, `Block done`; a past block: its dates. */
  meta: string;
  rows: ThisBlockRow[];
  legend: { up: string; stalled: string; deload: string };
  up: number;
  stalled: number;
}

/** `Week 3 of 6` · `Lead-in` · `Block done` (a coach plan: `Week 3`). */
export function blockWeekText(b: Pick<TrainingBlock, 'week' | 'answers'>): string {
  if (b.week.leadIn !== undefined) return BLOCKS_COPY.leadIn;
  if (b.answers === null) return BLOCKS_COPY.weekOnly(b.week.week);
  if (b.week.done) return BLOCKS_COPY.done;
  return BLOCKS_COPY.week(b.week.week, b.answers.weeks);
}

function rowOf(l: LiftInBlock): ThisBlockRow {
  const p = l.progress;
  const line = p.first === null || p.best === null ? null : p.delta === null && p.best === p.first ? bestSetWithUnit(p.first) : blockLineText(p.first, p.best);
  const stalled = p.status === 'stalled';
  const delta = stalled || p.delta === null ? null : blockDeltaText(p.delta);
  const bars = p.weeks.filter((w) => w.week > 0).map((w): BlockWeekBar => ({ week: w.week, state: BAR_OF[w.state], level: w.level }));
  const said = [l.name, ...(line === null ? [] : [line.replace('→', 'to')]), ...(stalled ? [BLOCK_LIFT_COPY.stalled] : delta === null ? [] : [delta])].join(', ');
  return { exerciseId: l.exerciseId, name: l.name, line, bars, delta, gain: p.delta !== null && blockDeltaIsGain(p.delta), stalled, accessibilityLabel: said };
}

/** Past blocks: `21 Sep – 1 Nov`; the current block: its planned end. */
export function blockDates(b: Pick<TrainingBlock, 'startedAtUtc' | 'endedAtUtc' | 'week' | 'answers' | 'leadInMonday'>, tz: string): string {
  const start = localDateOf(toMs(b.startedAtUtc), tz);
  const firstMonday = b.leadInMonday === null ? mondayOf(start) : addDays(b.leadInMonday, 7);
  let end: string;
  if (b.endedAtUtc === null) end = addDays(b.week.mondays[0] ?? firstMonday, 7 * (b.answers?.weeks ?? Math.max(1, b.week.mondays.length)) - 1);
  else {
    const stopped = localDateOf(toMs(b.endedAtUtc) - 1, tz);
    const last = b.week.mondays[b.week.mondays.length - 1];
    end = last === undefined ? stopped : [stopped, addDays(last, 6)].sort()[0] ?? stopped;
  }
  return plainSpaces(`${localDateText(start)} – ${localDateText(end)}`);
}

export function thisBlockView(b: TrainingBlock, sessions: readonly BlockSession[], nameOf: (id: string) => string, tz: string): ThisBlockView {
  const lifts = b.mainLiftIds.map((id) => liftInBlock(b, id, sessions, nameOf));
  const rows = lifts.map(rowOf);
  return {
    blockKey: b.key,
    current: b.current,
    title: b.current ? BLOCKS_COPY.thisBlock : BLOCKS_COPY.block(b.n, b.goal),
    meta: b.current ? blockWeekText(b) : blockDates(b, tz),
    rows,
    legend: { up: BLOCKS_COPY.legendUp, stalled: BLOCKS_COPY.legendStalled, deload: BLOCKS_COPY.legendDeload },
    up: lifts.filter((l) => l.progress.status === 'up').length,
    stalled: lifts.filter((l) => l.progress.status === 'stalled').length,
  };
}

/** Library › Plan's line under the week circles: `5 lifts up · 1 stalled`; null with nothing up or stalled yet. */
export function planBlockLine(v: Pick<ThisBlockView, 'up' | 'stalled'> | null): string | null {
  if (v === null || (v.up === 0 && v.stalled === 0)) return null;
  return BLOCKS_COPY.libraryLine(v.up, v.stalled);
}

// ---------------------------------------------------------------------------
// One lift's block detail

export interface LiftBlockDetailView {
  exerciseId: string;
  name: string;
  /** `Stalled 2 weeks`, `+5%`; null: nothing to say yet. */
  pill: { text: string; tone: 'stalled' | 'up' | 'neutral' } | null;
  /** `Top set 95×8 kg, 3 weeks running.`; `100×6 → 105×6 kg`; null: not trained. */
  line: string | null;
  /** One column per week reached (the lead-in and deload labelled). */
  chart: { label: string; value: number | null; valueText: string | null; state: BlockBarState; level: number | null }[];
  table: { week: string; topSet: string; sets: string; e1rm: string }[];
  stalled: boolean;
  /** The newest workout of the lift in the block (the `Next week` fix is that workout's next-time change). */
  latestSessionId: string | null;
}

const DASH = '—';

export function liftBlockDetailView(l: LiftInBlock): LiftBlockDetailView {
  const p = l.progress;
  const stalled = p.status === 'stalled';
  const pill = stalled ? { text: BLOCK_LIFT_COPY.stalledWeeks(p.noGainRun), tone: 'stalled' as const } : p.delta === null ? null : { text: blockDeltaText(p.delta), tone: blockDeltaIsGain(p.delta) ? ('up' as const) : ('neutral' as const) };
  const line = p.best === null || p.first === null ? null : stalled ? BLOCKS_COPY.running(bestSetWithUnit(p.best), p.noGainRun + 1) : p.delta === null ? bestSetWithUnit(p.first) : blockLineText(p.first, p.best);
  const label = (w: { week: number; deload: boolean }) => (w.week === 0 ? BLOCKS_COPY.leadIn : w.deload ? BLOCKS_COPY.deload : `W${String(w.week)}`);
  const shown = p.weeks.filter((w) => w.reached);
  const chart = shown.map((w) => ({ label: label(w), value: w.best?.value ?? null, valueText: w.best === null ? null : bestSetText(w.best), state: w.week === 0 ? ('none' as const) : BAR_OF[w.state], level: w.level }));
  const table = shown.map((w) => ({
    week: w.week === 0 ? BLOCKS_COPY.leadIn : w.deload ? `${String(w.week)} · ${BLOCKS_COPY.deload}` : String(w.week),
    topSet: w.best === null ? DASH : bestSetWithUnit(w.best),
    sets: w.best === null ? DASH : String(w.sets),
    e1rm: w.best?.e1rm == null ? DASH : `${formatNumber(Math.round(w.best.e1rm))} ${BLOCK_LIFT_COPY.est}`,
  }));
  const latestSessionId = [...l.sessionIds].reverse().find((ids) => ids.length > 0)?.at(-1) ?? null;
  return { exerciseId: l.exerciseId, name: l.name, pill, line, chart, table, stalled, latestSessionId };
}

// ---------------------------------------------------------------------------
// Every block

export interface BlocksListRow {
  key: string;
  /** `Block 3 · Muscle`; `Earlier training`. */
  title: string;
  /** `2 Nov – 13 Dec · week 3 of 6`; `21 Sep – 1 Nov · 32 of 36 sessions`. */
  sub: string;
  /** `5 up · 1 stalled · Bench press +7.5 kg`; null: nothing to count. */
  facts: string | null;
  current: boolean;
  /** `Now` on the current block. */
  tag: string | null;
  /** Past blocks and the current one open their This block view; Earlier training doesn't. */
  opens: boolean;
}

export interface BlockCompareRow {
  block: string;
  start: string;
  end: string;
  change: string;
}

export interface BlocksView {
  rows: BlocksListRow[];
  /** The lifts to compare (every block's main lifts, the current block's first). */
  lifts: { exerciseId: string; name: string; selected: boolean }[];
  compare: { title: string; rows: BlockCompareRow[]; byEstimate: boolean } | null;
}

/** The biggest load gain of a block's lifts: `Bench press +7.5 kg` (`ea` per hand); null: none. */
function biggestGain(lifts: readonly LiftInBlock[]): string | null {
  let best: { name: string; kg: number; text: string } | null = null;
  for (const l of lifts) {
    const a = l.progress.first;
    const b = l.progress.best;
    if (a === null || b === null || a.kind !== b.kind || a.kind === 'assisted') continue;
    const d = (b.unit === 'kg' ? b.value : b.value * KG_PER_LB) - (a.unit === 'kg' ? a.value : a.value * KG_PER_LB);
    if (d <= 0) continue;
    const shown = Math.round((b.unit === a.unit ? b.value - a.value : d / (b.unit === 'kg' ? 1 : KG_PER_LB)) * 10) / 10;
    const text = `${l.name} +${formatNumber(shown)} ${b.unit}${b.convention === 'per_hand' ? ` ${BLOCK_LIFT_COPY.ea}` : ''}`;
    if (best === null || d > best.kg) best = { name: l.name, kg: d, text };
  }
  return best?.text ?? null;
}

export interface BlocksInput {
  blocks: readonly TrainingBlock[];
  sessions: readonly BlockSession[];
  nameOf: (id: string) => string;
  tz: string;
  /** The lift to compare; null: the current (else newest) block's first main lift. */
  compareLift: string | null;
}

export function blocksView(input: BlocksInput): BlocksView {
  const { blocks, sessions, nameOf, tz } = input;
  const rows: BlocksListRow[] = [];
  const lifts = new Map<string, LiftInBlock[]>();
  for (const b of [...blocks].reverse()) {
    const ls = b.mainLiftIds.map((id) => liftInBlock(b, id, sessions, nameOf));
    lifts.set(b.key, ls);
    const up = ls.filter((l) => l.progress.status === 'up').length;
    const stalled = ls.filter((l) => l.progress.status === 'stalled').length;
    const gain = biggestGain(ls);
    const planned = b.answers === null ? null : b.answers.sessions * b.answers.weeks;
    const sub = [blockDates(b, tz), b.current ? blockWeekText(b).toLowerCase() : BLOCKS_COPY.sessions(b.sessionsDone, planned)].join(' · ');
    const facts = b.current ? null : up + stalled === 0 && gain === null ? null : [...(up + stalled > 0 ? [BLOCKS_COPY.counts(up, stalled)] : []), ...(gain === null ? [] : [gain])].join(' · ');
    rows.push({ key: b.key, title: BLOCKS_COPY.block(b.n, b.goal), sub, facts, current: b.current, tag: b.current ? BLOCKS_COPY.now : null, opens: true });
  }
  const first = blocks[0];
  const earliest = [...sessions].sort((a, c) => (a.date < c.date ? -1 : 1));
  const before = first === undefined ? earliest : earliest.filter((s) => toMs(s.startedAtUtc) < toMs(first.startedAtUtc));
  if (before.length > 0) {
    const from = before[0]?.date ?? '';
    const to = before[before.length - 1]?.date ?? '';
    rows.push({ key: 'earlier', title: BLOCKS_COPY.earlier, sub: [plainSpaces(`${localDateText(from)} – ${localDateText(to)}`), BLOCKS_COPY.sessions(before.length, null)].join(' · '), facts: null, current: false, tag: null, opens: false });
  }
  const ids: string[] = [];
  const lead = blocks.find((b) => b.current) ?? blocks[blocks.length - 1];
  for (const id of lead?.mainLiftIds ?? []) if (!ids.includes(id)) ids.push(id);
  for (const b of [...blocks].reverse()) for (const id of b.mainLiftIds) if (!ids.includes(id)) ids.push(id);
  const chosen = input.compareLift !== null && ids.includes(input.compareLift) ? input.compareLift : (ids[0] ?? null);
  const liftList = ids.map((id) => ({ exerciseId: id, name: nameOf(id), selected: id === chosen }));
  return { rows, lifts: liftList, compare: chosen === null ? null : compareLift(blocks, chosen, sessions, nameOf) };
}

/**
 * One lift across blocks: Block · Start · End · Change. Blocks with different rep ranges (their week-1 best sets'
 * reps differ) compare Est. 1RM, labelled `est.` (rule 6); else the best sets themselves.
 */
export function compareLift(blocks: readonly TrainingBlock[], exerciseId: string, sessions: readonly BlockSession[], nameOf: (id: string) => string): { title: string; rows: BlockCompareRow[]; byEstimate: boolean } {
  const per = blocks.map((b) => ({ b, l: liftInBlock(b, exerciseId, sessions, nameOf) })).filter((x) => x.l.progress.first !== null && x.l.progress.best !== null);
  const reps = new Set(per.map((x) => x.l.progress.first?.reps));
  const loaded = per.every((x) => x.l.progress.first?.kind === 'load' && x.l.progress.first.e1rm !== null && x.l.progress.best?.e1rm != null);
  const byEstimate = reps.size > 1 && loaded;
  const est = (s: BlockBestSet) => `${formatNumber(Math.round(s.e1rm ?? 0))} ${BLOCK_LIFT_COPY.est}`;
  const rows = per.map(({ b, l }): BlockCompareRow => {
    const a = l.progress.first as BlockBestSet;
    const z = l.progress.best as BlockBestSet;
    return { block: `${String(b.n)} · ${b.goal}`, start: byEstimate ? est(a) : bestSetWithUnit(a), end: byEstimate ? est(z) : bestSetWithUnit(z), change: l.progress.delta === null ? DASH : blockDeltaText(l.progress.delta) };
  });
  return { title: BLOCKS_COPY.byBlock(nameOf(exerciseId)), rows, byEstimate };
}

/** The block for a key; null: the current one (else the newest). */
export function blockOf(blocks: readonly TrainingBlock[], key: string | null): TrainingBlock | null {
  if (key !== null) return blocks.find((b) => b.key === key) ?? null;
  return blocks.find((b) => b.current) ?? null;
}
