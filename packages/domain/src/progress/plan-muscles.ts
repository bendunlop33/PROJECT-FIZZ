import type { MuscleGroup } from '@fizz/schemas';

import { addMuscleSets, directMuscleGroup, directRange, muscleSetCredits, muscleStatus, PLAN_MUSCLE_GROUPS, type MuscleCreditInfo, type MuscleRange, type MuscleSetTotals, type MuscleStatus, type VolumeGoal } from './muscle-sets';
import { oneDecimal } from './activity';
import { setsText } from './text';

/**
 * (Ben, 1 Nov; docs/design/plan-muscles.md) Library › Plan › Muscles: what the plan trains each week, per muscle
 * group, as **direct** working sets against the range that applies (`directRange`), with the week's done-so-far as a
 * marker. Pure: the service hands in each week's days as they will run (week edits, skips, deload set counts) and the
 * done totals (Progress's own count, `muscleFrequency`); this file only counts, compares and words.
 *
 * Flags come from the **typical week** only (the plan's days as their workouts run now, every day, no deload, no
 * skips): a deload, the lead-in or a week shortened by skips shows neutral bars and one short note.
 */

export interface PlanMuscleRow {
  /** The slot or template row (stable within the day). */
  key: string;
  exerciseId: string;
  /** Working sets (warm-ups never count). */
  sets: number;
  main: boolean;
  order: number;
  /** Its superset label (`A`), or null. */
  superset: string | null;
}

export interface PlanMuscleDay {
  dayIndex: number;
  name: string;
  /** The day's length (minutes) the plan was built for; null: not known. */
  minutes: number | null;
  rows: readonly PlanMuscleRow[];
  /** Skipped this week (`Skip this week`): counts nothing. */
  skipped?: boolean;
  /** Exercises Ben took out of this day himself: Rebalance never puts them back. */
  avoid?: readonly string[];
}

export interface PlanMuscleWeek {
  /** `1`…`N`, `lead`, `avg`. */
  key: string;
  /** The chip's text: `1`, `6 · Deload`, `Lead-in`, `Block avg`. */
  label: string;
  kind: 'week' | 'lead_in';
  deload: boolean;
  /** The block's week now. */
  current: boolean;
  days: readonly PlanMuscleDay[];
  /** Done so far that week (Progress's count, direct); null: a later week. */
  done: MuscleSetTotals | null;
}

export type InfoOf = (exerciseId: string) => MuscleCreditInfo | null;

/** Direct and assisted sets a week of the days not skipped. */
export function plannedMuscleSets(days: readonly PlanMuscleDay[], infoOf: InfoOf): MuscleSetTotals {
  const out: MuscleSetTotals = new Map();
  for (const d of days) {
    if (d.skipped === true) continue;
    for (const r of d.rows) addMuscleSets(out, infoOf(r.exerciseId), r.sets);
  }
  return out;
}

export interface MuscleGoalInput {
  goal: VolumeGoal | null;
  priorities: ReadonlySet<MuscleGroup>;
}

/** Each bar group's applicable range for these totals. */
export function rangesOf(totals: MuscleSetTotals, g: MuscleGoalInput): Map<MuscleGroup, MuscleRange | null> {
  return new Map(PLAN_MUSCLE_GROUPS.map((m) => [m, directRange(g.goal, { priority: g.priorities.has(m), assisted: totals.get(m)?.assisted ?? 0 })] as const));
}

export interface MuscleFlag {
  group: MuscleGroup;
  direct: number;
  assisted: number;
  range: MuscleRange;
  status: Exclude<MuscleStatus, 'in'>;
}

/** Groups outside their range in these totals, biggest gap first. */
export function muscleFlags(totals: MuscleSetTotals, g: MuscleGoalInput): MuscleFlag[] {
  const ranges = rangesOf(totals, g);
  const out: MuscleFlag[] = [];
  for (const m of PLAN_MUSCLE_GROUPS) {
    const r = ranges.get(m) ?? null;
    if (r === null) continue;
    const t = totals.get(m) ?? { direct: 0, assisted: 0 };
    const st = muscleStatus(t.direct, r);
    if (st !== 'in') out.push({ group: m, direct: t.direct, assisted: t.assisted, range: r, status: st });
  }
  const gap = (f: MuscleFlag) => (f.status === 'below' ? f.range.min - f.direct : f.direct - f.range.max);
  return out.sort((a, b) => gap(b) - gap(a) || PLAN_MUSCLE_GROUPS.indexOf(a.group) - PLAN_MUSCLE_GROUPS.indexOf(b.group));
}

export const PLAN_MUSCLES_COPY = {
  title: 'Muscles',
  setsPerWeek: 'Sets per week',
  avg: 'Block avg',
  leadIn: 'Lead-in',
  deload: 'Deload',
  doneByWeek: 'Done by week',
  byDay: 'By day',
  rebalance: 'Rebalance',
  allInRange: 'all in range',
  low: 'low',
  high: 'high',
  skipped: (n: number) => `${String(n)} ${n === 1 ? 'day' : 'days'} skipped`,
  line: (text: string) => `Muscles · ${text}`,
  /** `Biceps 2/wk · below 4–8` */
  gap: (f: Pick<MuscleFlag, 'group' | 'direct' | 'range' | 'status'>) => `${f.group} ${setsText(f.direct)}/wk · ${f.status} ${String(f.range.min)}–${String(f.range.max)}`,
  /** The coach's own offer (rule 3: an offer, never applied): `Biceps only 2 sets a week · Rebalance?` */
  offer: (f: Pick<MuscleFlag, 'group' | 'direct' | 'status'>) => (f.status === 'below' ? `${f.group} only ${setsText(f.direct)} ${f.direct === 1 ? 'set' : 'sets'} a week · Rebalance?` : `${f.group} ${setsText(f.direct)} sets a week · Rebalance?`),
  assisted: (n: number) => `+${setsText(n)} assisted`,
} as const;

/** `Muscles · Biceps low`, `Muscles · Biceps, Calves low · Chest high`, `Muscles · all in range`; null with no goal. */
export function planMusclesLine(flags: readonly MuscleFlag[], goal: VolumeGoal | null): string | null {
  if (goal === null) return null;
  if (flags.length === 0) return PLAN_MUSCLES_COPY.line(PLAN_MUSCLES_COPY.allInRange);
  const low = PLAN_MUSCLE_GROUPS.filter((m) => flags.some((f) => f.group === m && f.status === 'below'));
  const high = PLAN_MUSCLE_GROUPS.filter((m) => flags.some((f) => f.group === m && f.status === 'above'));
  const parts = [low.length > 0 ? `${low.join(', ')} ${PLAN_MUSCLES_COPY.low}` : null, high.length > 0 ? `${high.join(', ')} ${PLAN_MUSCLES_COPY.high}` : null].filter((x): x is string => x !== null);
  return PLAN_MUSCLES_COPY.line(parts.join(' · '));
}

const WHY_RANGE: Readonly<Record<MuscleRange['why'], string>> = {
  goal: 'your goal',
  covered: 'other lifts cover some',
  priority: 'a priority',
};

/**
 * The Why? line for one group (Ben, 1 Nov): `Biceps 2 direct · +7 assisted from Barbell row, Lat pulldown · range
 * 4–8: other lifts cover some`. `assistedFrom`: the exercises giving it assisted sets, most first.
 */
export function muscleWhyText(group: MuscleGroup, t: { direct: number; assisted: number }, range: MuscleRange | null, assistedFrom: readonly string[]): string {
  const parts = [`${group} ${setsText(t.direct)} direct`];
  if (t.assisted > 0) parts.push(`${PLAN_MUSCLES_COPY.assisted(t.assisted)}${assistedFrom.length > 0 ? ` from ${assistedFrom.slice(0, 3).join(', ')}` : ''}`);
  if (range !== null) parts.push(`range ${String(range.min)}–${String(range.max)}: ${WHY_RANGE[range.why]}`);
  return parts.join(' · ');
}

/** The exercises giving `group` assisted sets in these days, most first (names via `nameOf`). */
export function assistedFrom(days: readonly PlanMuscleDay[], group: MuscleGroup, infoOf: InfoOf, nameOf: (id: string) => string): string[] {
  const by = new Map<string, number>();
  for (const d of days) {
    if (d.skipped === true) continue;
    for (const r of d.rows) {
      const c = muscleSetCredits(infoOf(r.exerciseId)).get(group);
      if (c !== undefined && c.assisted > 0) by.set(r.exerciseId, (by.get(r.exerciseId) ?? 0) + c.assisted * r.sets);
    }
  }
  return [...by.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => nameOf(id));
}

// ---------------------------------------------------------------------------
// The bar (shared with Progress › Muscles · sets)

/** One muscle bar as both screens draw it: the fill, the shaded range, the done marker, and its tone. */
export interface MuscleBarLook {
  /** The fill's share of the track (0…1). */
  fill: number;
  /** The shaded range's share (null: no range). */
  band: { from: number; to: number } | null;
  /** A thin marker (done so far), as a share; null: none. */
  marker: number | null;
  /** `in`: green; `out`: amber (below or above); `none`: neutral. */
  tone: 'in' | 'out' | 'none';
}

export function muscleBarLook(value: number, range: Pick<MuscleRange, 'min' | 'max'> | null, opts: { scaleMax: number; marker?: number | null; neutral?: boolean }): MuscleBarLook {
  const top = Math.max(1, opts.scaleMax);
  const share = (n: number) => Math.max(0, Math.min(1, n / top));
  const tone = opts.neutral === true || range === null ? 'none' : muscleStatus(value, range) === 'in' ? 'in' : 'out';
  return { fill: share(value), band: range === null ? null : { from: share(range.min), to: share(range.max) }, marker: opts.marker == null ? null : share(opts.marker), tone };
}

export interface PlanMuscleBar {
  group: MuscleGroup;
  label: string;
  direct: number;
  /** `12`, `3½`. */
  valueText: string;
  /** `+7 assisted`; null with none. */
  assistedText: string | null;
  range: MuscleRange | null;
  status: MuscleStatus | null;
  done: number | null;
  look: MuscleBarLook;
  why: string;
  words: string;
}

export interface PlanMuscleChip {
  group: MuscleGroup;
  sets: number;
  text: string;
}

export interface PlanMuscleDayView {
  dayIndex: number;
  name: string;
  skipped: boolean;
  chips: PlanMuscleChip[];
}

export interface PlanMuscleChipView {
  key: string;
  label: string;
  selected: boolean;
  current: boolean;
  accessibilityLabel: string;
}

export interface PlanMusclesView {
  chips: PlanMuscleChipView[];
  selected: string;
  bars: PlanMuscleBar[];
  /** `Deload`, `Lead-in`, `1 day skipped`; null on a typical week. */
  note: string | null;
  /** The typical week's groups out of range (Rebalance's input). */
  flags: MuscleFlag[];
  /** `Biceps 2/wk · below 4–8`, one per flag. */
  flagLines: string[];
  /** The selected week has a done-so-far (`Done by week ›` shows). */
  hasDone: boolean;
  byDay: PlanMuscleDayView[];
  /** No goal: no range and no flags (playbook "No goal set"). */
  noGoal: boolean;
}

export interface PlanMusclesInput extends MuscleGoalInput {
  weeks: readonly PlanMuscleWeek[];
  /** The plan's days as they run now (every day, no deload, no skips). */
  typical: readonly PlanMuscleDay[];
  /** The chip asked for; null: this week. */
  selected: string | null;
  infoOf: InfoOf;
  nameOf: (exerciseId: string) => string;
}

/** Each day's direct sets per group, most first (`Back 7`). */
export function dayChips(d: PlanMuscleDay, infoOf: InfoOf): PlanMuscleChip[] {
  const by = new Map<MuscleGroup, number>();
  for (const r of d.rows) {
    const g = directMuscleGroup(infoOf(r.exerciseId));
    if (g !== null && PLAN_MUSCLE_GROUPS.includes(g)) by.set(g, (by.get(g) ?? 0) + r.sets);
  }
  return [...by.entries()].sort((a, b) => b[1] - a[1] || PLAN_MUSCLE_GROUPS.indexOf(a[0]) - PLAN_MUSCLE_GROUPS.indexOf(b[0])).map(([group, sets]) => ({ group, sets, text: `${group} ${String(sets)}` }));
}

/** The block average: each group's mean over the block's weeks (lead-in left out), one decimal. */
export function blockAverage(weeks: readonly PlanMuscleWeek[], infoOf: InfoOf): MuscleSetTotals {
  const blockWeeks = weeks.filter((w) => w.kind === 'week');
  const out: MuscleSetTotals = new Map();
  if (blockWeeks.length === 0) return out;
  for (const w of blockWeeks) {
    for (const [g, t] of plannedMuscleSets(w.days, infoOf)) {
      const o = out.get(g) ?? { direct: 0, assisted: 0 };
      out.set(g, { direct: o.direct + t.direct, assisted: o.assisted + t.assisted });
    }
  }
  for (const [g, t] of out) out.set(g, { direct: oneDecimal(t.direct / blockWeeks.length), assisted: oneDecimal(t.assisted / blockWeeks.length) });
  return out;
}

const AVG_KEY = 'avg';

export function planMusclesView(input: PlanMusclesInput): PlanMusclesView {
  const current = input.weeks.find((w) => w.current) ?? input.weeks[0] ?? null;
  const keys = [...input.weeks.map((w) => w.key), ...(input.weeks.length > 1 ? [AVG_KEY] : [])];
  const selected = input.selected !== null && keys.includes(input.selected) ? input.selected : (current?.key ?? AVG_KEY);
  const week = input.weeks.find((w) => w.key === selected) ?? null;
  const days = week?.days ?? input.typical;
  const totals = selected === AVG_KEY ? blockAverage(input.weeks, input.infoOf) : week === null ? plannedMuscleSets(input.typical, input.infoOf) : plannedMuscleSets(days, input.infoOf);
  const skipped = week === null ? 0 : week.days.filter((d) => d.skipped === true).length;
  const note = week === null ? null : week.kind === 'lead_in' ? PLAN_MUSCLES_COPY.leadIn : week.deload ? PLAN_MUSCLES_COPY.deload : skipped > 0 ? PLAN_MUSCLES_COPY.skipped(skipped) : null;
  const neutral = note !== null;
  const ranges = rangesOf(totals, input);
  const done = week?.done ?? null;
  const scaleMax = Math.max(1, ...PLAN_MUSCLE_GROUPS.map((m) => Math.max(totals.get(m)?.direct ?? 0, ranges.get(m)?.max ?? 0, done?.get(m)?.direct ?? 0))) * 1.1;
  const bars = PLAN_MUSCLE_GROUPS.map((m): PlanMuscleBar => {
    const t = totals.get(m) ?? { direct: 0, assisted: 0 };
    const range = ranges.get(m) ?? null;
    const status = range === null || neutral ? null : muscleStatus(t.direct, range);
    const d = done === null ? null : (done.get(m)?.direct ?? 0);
    const valueText = Number.isInteger(t.direct * 2) ? setsText(t.direct) : t.direct.toFixed(1);
    const assistedText = t.assisted > 0 ? PLAN_MUSCLES_COPY.assisted(t.assisted) : null;
    const said = [`${m}, ${valueText} ${t.direct === 1 ? 'set' : 'sets'} a week`, assistedText, range === null ? null : `range ${String(range.min)} to ${String(range.max)}`, status === null ? null : status === 'in' ? 'in range' : status, d === null ? null : `${setsText(d)} done`].filter((x): x is string => x !== null);
    return {
      group: m,
      label: m,
      direct: t.direct,
      valueText,
      assistedText,
      range,
      status,
      done: d,
      look: muscleBarLook(t.direct, range, { scaleMax, marker: d, neutral }),
      why: muscleWhyText(m, t, range, assistedFrom(days, m, input.infoOf, input.nameOf)),
      words: said.join(', '),
    };
  });
  const flags = muscleFlags(plannedMuscleSets(input.typical, input.infoOf), input);
  const chipOf = (w: PlanMuscleWeek): PlanMuscleChipView => ({ key: w.key, label: w.label, selected: w.key === selected, current: w.current, accessibilityLabel: [w.kind === 'lead_in' ? 'Lead-in week' : `Week ${w.key}`, ...(w.deload ? ['deload'] : []), ...(w.current ? ['this week'] : [])].join(', ') });
  const chips = [...input.weeks.map(chipOf), ...(input.weeks.length > 1 ? [{ key: AVG_KEY, label: PLAN_MUSCLES_COPY.avg, selected: selected === AVG_KEY, current: false, accessibilityLabel: 'Block average' }] : [])];
  return {
    chips,
    selected,
    bars,
    note,
    flags,
    flagLines: flags.map((f) => PLAN_MUSCLES_COPY.gap(f)),
    hasDone: done !== null,
    byDay: days.map((d) => ({ dayIndex: d.dayIndex, name: d.name, skipped: d.skipped === true, chips: dayChips(d, input.infoOf) })),
    noGoal: input.goal === null,
  };
}

/**
 * The coach's compact view of the plan (YOUR DATA `plan.inUse.muscles`): the typical week's direct sets per group with
 * the assisted ones and the range, so "does my plan train enough biceps" is answered from code's numbers.
 * `Biceps 0 direct (+9 assisted) · range 4–8 · below`.
 */
export function muscleVolumeLines(typical: readonly PlanMuscleDay[], g: MuscleGoalInput, infoOf: InfoOf): string[] {
  const totals = plannedMuscleSets(typical, infoOf);
  const ranges = rangesOf(totals, g);
  return PLAN_MUSCLE_GROUPS.map((m) => {
    const t = totals.get(m) ?? { direct: 0, assisted: 0 };
    const r = ranges.get(m) ?? null;
    const st = r === null ? null : muscleStatus(t.direct, r);
    return [`${m} ${setsText(t.direct)} direct${t.assisted > 0 ? ` (+${setsText(t.assisted)} assisted)` : ''}`, r === null ? 'no goal range' : `range ${String(r.min)}–${String(r.max)}`, st === null ? null : st === 'in' ? 'in range' : st].filter((x): x is string => x !== null).join(' · ');
  });
}

/** A stable key for "the plan's typical week as it is now": the offer is raised once per key (Ben, 1 Nov). */
export function planMuscleKey(planId: string, typical: readonly PlanMuscleDay[]): string {
  const days = [...typical].sort((a, b) => a.dayIndex - b.dayIndex).map((d) => `${String(d.dayIndex)}:${[...d.rows].sort((a, b) => a.order - b.order).map((r) => `${r.exerciseId}x${String(r.sets)}`).join(',')}`);
  return `${planId}|${days.join('|')}`;
}
