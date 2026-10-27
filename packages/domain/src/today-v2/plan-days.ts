import type { Routine, SplitDay } from '@fizz/schemas';
import { BUILDER_DAY_MIXES, type GroupCount } from '../builder/build';
import type { BuilderGroupName, BuilderInfoLookup } from '../builder/types';
import { planDayKeyOf, planDayOf, type PlanDayKeySplit } from '../session/coach-plan';
import type { FinishedRef } from '../session/routines';
import type { TodayDay, TodayTemplate } from './session';

/**
 * Today (v2)'s day control (§2.0.2 region 5): the applied plan's days in
 * plan order, each with its main-lift templates (§1.3, §4.2), and the Other
 * sessions under `⋯` (Full body, Upper, Push; Ben, 20 Oct). Pure.
 */

const cap = (s: string): string => (s.length === 0 ? s : `${s.charAt(0).toUpperCase()}${s.slice(1)}`);

/** The template's groups in workout order, the main lift's group first (§3.7: the first group keeps at least one). */
export function templateGroups(exerciseIds: readonly string[], mainLiftExerciseId: string | null, info: BuilderInfoLookup): GroupCount[] {
  const counts = new Map<BuilderGroupName, number>();
  const main = mainLiftExerciseId === null ? null : info(mainLiftExerciseId);
  if (main !== null) counts.set(main.group, 0);
  for (const id of exerciseIds) {
    const g = info(id)?.group;
    if (g === undefined) continue;
    counts.set(g, (counts.get(g) ?? 0) + 1);
  }
  if (main !== null && !exerciseIds.includes(main.exerciseId)) counts.set(main.group, (counts.get(main.group) ?? 0) + 1);
  return [...counts].filter(([, n]) => n > 0).map(([group, count]) => ({ group, count: Math.min(4, count) }));
}

const MIX_OF: Readonly<Record<string, keyof typeof BUILDER_DAY_MIXES>> = { chest: 'chest', back: 'back', pull: 'pull', legs: 'legs', shoulders: 'shoulders', push: 'push' };

export interface TodayPlanDaysInput {
  planId: string;
  /** `planRoutines(plan, live)`: every template, in day order. */
  templates: readonly Routine[];
  split: { days: readonly Pick<SplitDay, 'id' | 'name' | 'mainLiftExerciseId'>[] } | null;
  mainLifts?: PlanDayKeySplit['mainLifts'];
  info: BuilderInfoLookup;
  /** Ben's usual length (Profile), when the template has none. */
  defaultMinutes: number;
  /** (Ben, 27 Oct) The plan's own length for a template's day (the plan builder's session length); null: none. */
  planMinutesOf?: (r: Routine) => number | null;
}

/** The chip for a template: the part of its name after `·` (`Chest · bench` → `Bench`), else its main lift's name. */
export function templateLabel(r: Pick<Routine, 'name'>, mainName: string | null): string {
  const parts = r.name.split('·').map((p) => p.trim()).filter((p) => p !== '');
  if (parts.length > 1) return cap(parts.slice(1).join(' · '));
  return mainName ?? r.name;
}

/** `todayPlanDays`: one entry per plan day (planId, dayIndex), its templates in plan order. */
export function todayPlanDays(input: TodayPlanDaysInput): TodayDay[] {
  const days = new Map<string, { day: Omit<TodayDay, 'templates'>; templates: TodayTemplate[] }>();
  for (const r of input.templates) {
    // A plan day with no split day to derive (a day the plan named itself, e.g. `Upper` on a PPL split) is still a
    // plan day: its index names it, and `day-<n>` stands in for the split day (no variations hang off it).
    const ref = planDayOf(r);
    const key = planDayKeyOf(r, input.split, input.mainLifts) ?? (ref === null ? null : { ...ref, splitDayId: `day-${String(ref.dayIndex)}`, mainLiftExerciseId: r.exercises.find((e) => e.main === true)?.exerciseId ?? null });
    if (key === null || key.planId !== input.planId) continue;
    const dayKey = `plan:${key.planId}:${String(key.dayIndex)}`;
    const splitDay = input.split?.days.find((d) => d.id === key.splitDayId) ?? null;
    const exerciseIds = [...r.exercises].sort((a, b) => a.order - b.order).map((e) => e.exerciseId).filter((id) => input.info(id) !== null);
    const main = key.mainLiftExerciseId ?? r.exercises.find((e) => e.main === true)?.exerciseId ?? null;
    const mainLift = main !== null && input.info(main) !== null ? main : null;
    const groups = templateGroups(exerciseIds, mainLift, input.info);
    const mix = MIX_OF[key.splitDayId];
    const template: TodayTemplate = {
      routineId: r.id,
      version: r.version,
      label: templateLabel(r, mainLift === null ? null : (input.info(mainLift)?.name ?? null)),
      mainLiftExerciseId: mainLift,
      exerciseIds,
      minutes: r.planDay?.minutes ?? input.planMinutesOf?.(r) ?? input.defaultMinutes,
      absPlan: exerciseIds.some((id) => input.info(id)?.group === 'Core'),
      supersetsPlan: r.exercises.some((e) => e.supersetGroup !== null),
      groups: groups.length > 0 ? groups : mix !== undefined ? BUILDER_DAY_MIXES[mix].map((g) => ({ ...g })) : [],
      // (Ben, 27 Oct) The day as stored: Today drafts these (order, set counts, superset pairs) at the plan's controls.
      slots: [...r.exercises]
        .sort((a, b) => a.order - b.order)
        .filter((e) => input.info(e.exerciseId) !== null)
        .map((e) => ({ exerciseId: e.exerciseId, workingSets: Math.max(1, e.setTemplates.filter((x) => x.setType !== 'warmup').length), group: e.supersetGroup })),
    };
    const name = splitDay?.name ?? r.name.split('·')[0]?.trim() ?? r.name;
    const entry = days.get(dayKey) ?? { day: { key: dayKey, kind: 'plan' as const, name, planId: key.planId, dayIndex: key.dayIndex, splitDayId: key.splitDayId }, templates: [] as TodayTemplate[] };
    // One chip per main lift (the newest template of a main lift wins only if the first has none).
    if (!entry.templates.some((t) => t.mainLiftExerciseId === template.mainLiftExerciseId)) entry.templates.push(template);
    days.set(dayKey, entry);
  }
  return [...days.values()].map((d) => ({ ...d.day, templates: d.templates }));
}

/**
 * Q2: the template a plan day opens with — the one its newest workout used
 * (`planDay.templateRoutineId`, else its main lift, else the routine it was
 * started from); null when none of its workouts names one.
 */
export function lastUsedMainLift(day: Pick<TodayDay, 'planId' | 'dayIndex' | 'templates'>, newestFirst: readonly Pick<FinishedRef, 'routineId' | 'planDay'>[]): string | null {
  for (const f of newestFirst) {
    const byRoutine = day.templates.find((t) => t.routineId !== null && (t.routineId === f.routineId || t.routineId === f.planDay?.templateRoutineId));
    if (byRoutine !== undefined) return byRoutine.mainLiftExerciseId;
    if (f.planDay !== undefined && f.planDay.planId === day.planId && f.planDay.dayIndex === day.dayIndex) {
      const main = f.planDay.mainLiftExerciseId ?? null;
      if (day.templates.some((t) => t.mainLiftExerciseId === main)) return main;
      return null;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Other sessions (`⋯`)

export interface TodayOtherSession {
  id: 'full_body' | 'upper' | 'push';
  name: string;
  groups: readonly GroupCount[];
  /** The groups whose main lifts it offers, in chip order. */
  mainGroups: readonly BuilderGroupName[];
}

/**
 * [Ben, 20 Oct] Session types outside the split: not Pull or Lower (they
 * duplicate Back and Legs), not recent one-offs, not saved variations.
 * Mixes follow §3.7's style; Push is §3.7's own.
 */
export const TODAY_OTHER_SESSIONS: readonly TodayOtherSession[] = [
  { id: 'full_body', name: 'Full body', groups: [{ group: 'Legs', count: 1 }, { group: 'Back', count: 1 }, { group: 'Chest', count: 1 }, { group: 'Core', count: 1 }], mainGroups: ['Legs', 'Chest'] },
  { id: 'upper', name: 'Upper', groups: [{ group: 'Chest', count: 1 }, { group: 'Back', count: 1 }, { group: 'Shoulders', count: 1 }, { group: 'Arms', count: 1 }, { group: 'Core', count: 1 }], mainGroups: ['Chest', 'Back'] },
  { id: 'push', name: 'Push', groups: BUILDER_DAY_MIXES.push.map((g) => ({ ...g })), mainGroups: ['Chest', 'Shoulders'] },
];

/**
 * An Other session as a day: one template per main-lift option (the plan
 * days' main lifts in those groups, else the fallbacks given), the main
 * lift's group first in its mix. No plan template, so no plan length: Ben's
 * usual one; abs and supersets on as the mix has them.
 */
export function otherSessionDay(s: TodayOtherSession, mainOptions: readonly { id: string; label: string }[], info: BuilderInfoLookup, minutes: number): TodayDay {
  const mains = mainOptions.filter((o, i) => mainOptions.findIndex((x) => x.id === o.id) === i && info(o.id) !== null);
  const templates: TodayTemplate[] = (mains.length > 0 ? mains : [null]).map((o) => {
    const id = o?.id ?? null;
    const g = id === null ? null : (info(id)?.group ?? null);
    const groups = g === null ? s.groups.map((x) => ({ ...x })) : [...s.groups.filter((x) => x.group === g), ...s.groups.filter((x) => x.group !== g)].map((x) => ({ ...x }));
    if (g !== null && !groups.some((x) => x.group === g)) groups.unshift({ group: g, count: 1 });
    return {
      routineId: null,
      version: null,
      label: o?.label ?? s.name,
      mainLiftExerciseId: id,
      exerciseIds: [],
      minutes,
      absPlan: s.groups.some((x) => x.group === 'Core'),
      supersetsPlan: true,
      groups,
    };
  });
  return { key: `other:${s.id}`, kind: 'other', name: s.name, planId: null, dayIndex: null, splitDayId: s.id, templates };
}

/** The main lifts an Other session offers: the plan days' main lifts in its groups, in plan order, then the fallbacks. */
export function otherMainOptions(s: TodayOtherSession, planDays: readonly TodayDay[], info: BuilderInfoLookup, fallbacks: readonly { id: string; label: string }[]): { id: string; label: string }[] {
  const out: { id: string; label: string }[] = [];
  const taken = (id: string) => out.some((o) => o.id === id);
  for (const g of s.mainGroups) {
    const fromPlan = planDays.flatMap((d) => d.templates).find((t) => t.mainLiftExerciseId !== null && info(t.mainLiftExerciseId)?.group === g && !taken(t.mainLiftExerciseId));
    const fallback = fallbacks.find((f) => info(f.id)?.group === g && !taken(f.id));
    const pick = fromPlan?.mainLiftExerciseId != null ? { id: fromPlan.mainLiftExerciseId, label: fromPlan.label } : fallback;
    if (pick !== undefined) out.push(pick);
  }
  return out;
}
