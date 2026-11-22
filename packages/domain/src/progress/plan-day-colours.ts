/**
 * (Redesign v3 C3, Ben 27 Oct) One colour per plan day name, shared by Progress's calendar dots and (later) Today's
 * day strip pills, so `Push` is the same orange everywhere. Pure.
 *
 * - Known split names keep their own hue in any plan: Push orange, Pull blue, Legs violet; Upper, Lower and Full body
 *   their own set.
 * - Any other day name takes the next unused hue in plan order, so a plan's colours are stable while the plan is.
 * - Workouts that aren't a plan day are `neutral`; activities are a hollow ring (not a hue).
 *
 * Colour is never the only signal: every use carries the day name in a legend or label. The hexes were picked so each
 * named set (Push/Pull/Legs; Upper/Lower/Full body) and the first four fallback hues stay apart, neutral included,
 * under protanopia, deuteranopia and tritanopia (Machado 2009, full severity; CIEDE2000 ≥ 15, first four fallback ≥ 14),
 * with ≥ 3:1 contrast on the day tiles in both themes (`plan-day-colours.test.ts` checks it).
 */

export type PlanDayHue = 'orange' | 'blue' | 'violet' | 'crimson' | 'aqua' | 'amber';
export type PlanDayColour = PlanDayHue | 'neutral';

/** Fallback order for day names with no hue of their own; the first four are the best separated. */
export const PLAN_DAY_HUE_ORDER: readonly PlanDayHue[] = ['orange', 'blue', 'violet', 'crimson', 'aqua', 'amber'];

/** Split names with a fixed hue (lower case, trimmed). */
const NAMED: Readonly<Record<string, PlanDayHue>> = {
  push: 'orange',
  pull: 'blue',
  legs: 'violet',
  upper: 'aqua',
  lower: 'crimson',
  'full body': 'amber',
  full: 'amber',
};

/** Hexes per theme mode. `neutral` is a non-plan workout's dot (not the theme's grey, so it stays apart from every hue). */
export const PLAN_DAY_HEX: Readonly<Record<PlanDayColour, { dark: string; light: string }>> = {
  orange: { dark: '#F2A65A', light: '#C75A12' },
  blue: { dark: '#8FDAFF', light: '#1A85FF' },
  violet: { dark: '#D24DFF', light: '#6B2FA8' },
  crimson: { dark: '#E0336B', light: '#981B40' },
  aqua: { dark: '#3DFFCF', light: '#1B9878' },
  amber: { dark: '#E6AC00', light: '#98701B' },
  neutral: { dark: '#8593A3', light: '#5F6B7A' },
};

/** A day name as compared: trimmed, lower case, one space between words. */
export function planDayKey(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * The hue of each of a plan's day names (any order of days in the plan; a name used twice is one entry). Named splits
 * first take their own hue; the rest take the unused hues in plan order, then wrap.
 */
export function planDayHues(dayNames: readonly string[]): ReadonlyMap<string, PlanDayHue> {
  const out = new Map<string, PlanDayHue>();
  const used = new Set<PlanDayHue>();
  const keys = [...new Set(dayNames.map(planDayKey).filter((k) => k !== ''))];
  for (const k of keys) {
    const hue = NAMED[k];
    if (hue !== undefined) {
      out.set(k, hue);
      used.add(hue);
    }
  }
  let next = 0;
  for (const k of keys) {
    if (out.has(k)) continue;
    const free = PLAN_DAY_HUE_ORDER.find((h) => !used.has(h));
    const hue = free ?? PLAN_DAY_HUE_ORDER[next++ % PLAN_DAY_HUE_ORDER.length] ?? 'orange';
    out.set(k, hue);
    used.add(hue);
  }
  return out;
}

/**
 * The colour of one workout. `planDayName`: the plan day it was started as (null: not a plan workout → `neutral`).
 * `planDays`: the plan in use's day names, for a stable palette; a plan day from another plan takes its named hue, else
 * the hue its name would take after the current plan's days.
 */
export function planDayColour(planDayName: string | null, planDays: readonly string[]): PlanDayColour {
  if (planDayName === null || planDayKey(planDayName) === '') return 'neutral';
  const key = planDayKey(planDayName);
  return planDayHues([...planDays, planDayName]).get(key) ?? 'neutral';
}
