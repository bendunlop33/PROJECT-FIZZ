import {
  pbBlockOfPlan,
  pbDayAsWorkout,
  pbBlockViews,
  pbKitOfEquipment,
  pbVersionOf,
  pbWeekdaysOf,
  pbWeekDaysOf,
  pbWeekVersionOf,
  type PbBlockView,
  type PbBlockWeek,
  type PbEditBlock,
  type PlanKit,
} from '@fizz/domain';
import type { Store } from '@fizz/persistence';
import type { DraftSlot, EquipmentInstance, LoadConvention, PlanBuilderAnswers, PlanDayDraft, PlanDraft, RoutineExercise, WeightUnit } from '@fizz/schemas';

/**
 * (Ben, 26 Oct: Edit plan on a running plan) Reads shared by Library › Your plan and the plan builder's edit: the
 * block week now (derived from the plan's Apply, pauses and Ben's plan workouts; never stored), each slot's item
 * wherever Ben set it up, and every week's view from a week map (the plan's, or an edit's preview). Local reads only.
 */

/** The applied builder plan's block now; null on a coach plan. */
export async function readPlanBlock(store: Store, ownerId: string, plan: PlanDraft, nowMs: number, tz: string): Promise<PbBlockWeek | null> {
  const refs = await store.repos.sessions.listFinishedRefs(ownerId, 400, { includeImported: true }).catch(() => []);
  return pbBlockOfPlan(plan, refs, nowMs, tz);
}

/** Where an edit stands: the week now and the plan days done in it; null once the block is done (Start next block). */
export function editBlockOf(b: PbBlockWeek | null): PbEditBlock | null {
  if (b === null || b.done) return null;
  return { week: b.week, doneThisWeek: b.daysDone[b.week - 1] ?? [] };
}

/** Each slot's item (by its checked equipment ID) at any of Ben's gyms, as achievable loads; null: gone or bodyweight. */
export async function slotKits(store: Store, ownerId: string): Promise<(slot: DraftSlot) => PlanKit | null> {
  const items = new Map<string, EquipmentInstance>();
  for (const g of await store.repos.gyms.listByOwner(ownerId).catch(() => [])) for (const e of await store.repos.equipment.listByGym(g.id).catch(() => [] as EquipmentInstance[])) items.set(e.id, e);
  const kits = new Map<string, PlanKit | null>();
  return (slot) => {
    const id = slot.checkedOn?.equipmentId ?? null;
    if (id === null) return null;
    if (!kits.has(id)) {
      const eq = items.get(id);
      kits.set(id, eq === undefined ? null : pbKitOfEquipment(eq));
    }
    return kits.get(id) ?? null;
  };
}

export interface WeekViewsInput {
  plan: PlanDraft;
  answers: PlanBuilderAnswers;
  block: PbBlockWeek;
  /** Each week's days (1…`answers.weeks`); absent: the plan's own week map. */
  weekDays?: readonly (readonly PlanDayDraft[])[];
  kitOf: (slot: DraftSlot) => PlanKit | null;
  nameOf: (exerciseId: string) => string;
  /** An edit's new accessory slots' week-1 reps (the rebuild's). */
  startReps?: Readonly<Record<string, number>>;
  /**
   * (Ben, 27 Oct) Weeks not done yet show each day as its workout will run it (`pbDayAsWorkout`): the plan day's
   * workout (template) and the version day it was last made to match. A day done this week shows as planned. Absent:
   * the stored versions only (an edit's preview).
   */
  asWorkout?: | {
    fromWeek: number;
    doneThisWeek: readonly number[];
    dayOf: (dayIndex: number) => { template: readonly RoutineExercise[]; base: PlanDayDraft | null } | null;
    unitOf: (exerciseId: string) => { unit: WeightUnit; convention: LoadConvention } | null;
  } | undefined;
}

/** Every week's view: its days (planned targets that week), weekdays on Set days plans (a `Move day` this week). */
export function weekViews(input: WeekViewsInput): PbBlockView[] {
  const { plan, answers } = input;
  const startRepsOf = (w: number) => pbVersionOf(plan, pbWeekVersionOf(plan, Math.min(w, plan.weekVersions?.length ?? w)))?.builder?.startReps;
  // A kept slot keeps its plan's start (the plan's versions win); only a new slot takes the rebuild's.
  const merged: Record<string, number> = { ...(input.startReps ?? {}) };
  for (const v of plan.versions) Object.assign(merged, v.builder?.startReps ?? {});
  const aw = input.asWorkout;
  const daysOf = (w: number): PlanDayDraft[] => {
    const days = [...(input.weekDays?.[w - 1] ?? pbWeekDaysOf(plan, w))];
    if (aw === undefined || w < aw.fromWeek) return days;
    return days.map((d) => {
      if (w === aw.fromWeek && aw.doneThisWeek.includes(d.index)) return d;
      const t = aw.dayOf(d.index);
      return t === null ? d : pbDayAsWorkout(d, t.template, t.base, aw.unitOf);
    });
  };
  const first = daysOf(1);
  return pbBlockViews({
    version: { days: first },
    builder: { answers, startReps: merged },
    block: { ...input.block, of: answers.weeks },
    kitOf: input.kitOf,
    nameOf: input.nameOf,
    weekOf: (w) => ({ days: daysOf(w), startReps: { ...merged, ...(startRepsOf(w) ?? {}) } }),
    weekdaysOf: (w, idx) => pbWeekdaysOf(answers, plan.moves, w, idx),
  });
}
