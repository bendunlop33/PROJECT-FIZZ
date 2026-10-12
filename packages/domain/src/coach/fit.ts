import type { SessionAggregate, TodayFitArgs } from '@fizz/schemas';
import { TODAY_EDIT_LIMITS } from '@fizz/schemas';
import { formatDuration, loadText, NBSP, repRangeText } from '../display';
import type { FitTier } from '../session/fit-time';
import { deriveId } from '../stable';
import { targetRpeOf, targetRpeText } from './target-rpe';

/**
 * `validateTodayFit` (fit-to-time §5.2): the deterministic guardrail between
 * the coach's `fit_today` call and today's draft. Pure. The model can't
 * override any of it:
 * - shortening (the length is under the plan's estimate): no increase of any
 *   kind, no rest change, no main lift skipped or trimmed below 2 sets;
 * - lengthening: at most +2 working sets per exercise and 2 added exercises,
 *   each Ben's own, usable at this gym and not pain-flagged; about 8 hard
 *   sets per muscle group (playbook rule 1);
 * - always: Ben's edited slots and pain-held ones are left alone (FT5, rule
 *   9); loads, reps and rest never change in a fit (loads are fitted by the
 *   planner's `snapPlanToGym`; an added exercise's targets come from
 *   `addTargets`, never from the model); swaps come back as suggestions, never
 *   applied; minutes are recomputed by `estimateRemainingDuration`.
 * Every refusal has a reason code; the app words it.
 */

export type CoachFitEdit =
  | { kind: 'skip'; slotKey: string }
  | { kind: 'sets'; slotKey: string; workingSets: number }
  | { kind: 'add'; exerciseId: string };

export type FitRefusal =
  | 'shorten_no_increase'
  | 'rest_unchanged'
  | 'load_unchanged'
  | 'reps_unchanged'
  | 'main_kept'
  | 'ben_edited'
  | 'pain_hold'
  | 'slot_gone'
  | 'max_extra_sets'
  | 'max_added'
  | 'not_own'
  | 'not_here'
  | 'in_plan'
  | 'muscle_cap'
  | 'duplicate'
  | 'not_supported'
  | 'out_of_range'
  | 'no_change';

/** One slot of today's shown plan, as the validator needs it. */
export interface FitPlanSlot {
  slotKey: string;
  exerciseId: string;
  name: string;
  tier: FitTier;
  /** Working sets today (before the coach). */
  workingSets: number;
  /** Ben changed it today (added, sets, reps, load) or skipped it himself: left alone. */
  benEdited: boolean;
  /** A pain flag covers it: no increase. */
  held: boolean;
  /** Catalogue primary muscles (Coaching knowledge), for the per-session cap. */
  muscles: readonly string[];
}

export type AddCheck = { ok: true; name: string; muscles: readonly string[] } | { ok: false; why: 'not_own' | 'not_here' | 'pain_hold' | 'in_plan' };
export type SwapCheck = { ok: true; name: string } | { ok: false; why: 'not_here' | 'pain_hold' | 'in_plan' | 'not_own' };

export interface TodayFitInput {
  minutes: number;
  /** The plan's estimate without any fit (`estimateRemainingDuration`), unrounded seconds. */
  unfittedSeconds: number;
  slots: readonly FitPlanSlot[];
  args: TodayFitArgs;
  /** Whether Ben's exercise can be added here: his own, usable at this gym, not pain-flagged, not in today's plan. */
  canAdd: (exerciseId: string) => AddCheck;
  /** Whether a slot can be swapped to an exercise today (a suggestion only). */
  canSwap: (slotKey: string, exerciseId: string) => SwapCheck;
}

export interface FitSuggestion {
  slotKey: string;
  toExerciseId: string;
  fromName: string;
  toName: string;
}

export interface TodayFitValidation {
  shorten: boolean;
  accepted: CoachFitEdit[];
  suggestions: FitSuggestion[];
  rejected: { index: number; kind: TodayFitArgs['edits'][number]['kind']; slotKey: string | null; why: FitRefusal }[];
}

/** Most added exercises and extra sets per exercise when the coach fills a longer session (§5.2). */
export const FIT_LENGTHEN_LIMITS = { maxAdded: 2, maxExtraSets: 2, muscleCap: 8 } as const;

/**
 * Whether a fit to `minutes` shortens today's plan: the one comparison, on
 * unrounded seconds, that the validator, the sheet and the request's
 * `Fit`/`Fill` wording all use (review C S1).
 */
export function fitShortens(minutes: number, unfittedSeconds: number): boolean {
  return minutes * 60 < unfittedSeconds;
}

export function validateTodayFit(input: TodayFitInput): TodayFitValidation {
  const shorten = fitShortens(input.minutes, input.unfittedSeconds);
  const bySlot = new Map(input.slots.map((s) => [s.slotKey, s]));
  const accepted: CoachFitEdit[] = [];
  const suggestions: FitSuggestion[] = [];
  const rejected: TodayFitValidation['rejected'] = [];
  const touched = new Set<string>();
  const addedIds = new Set<string>();
  // Working sets per muscle group as the plan stands with the accepted edits (lengthening cap).
  const setsNow = new Map(input.slots.map((s) => [s.slotKey, s.workingSets]));
  const addedMuscles: { muscles: readonly string[]; sets: number }[] = [];
  const muscleLoad = (): Map<string, number> => {
    const out = new Map<string, number>();
    const add = (muscles: readonly string[], n: number) => {
      for (const m of muscles) out.set(m, (out.get(m) ?? 0) + n);
    };
    for (const s of input.slots) add(s.muscles, setsNow.get(s.slotKey) ?? 0);
    for (const a of addedMuscles) add(a.muscles, a.sets);
    return out;
  };
  const overCap = (muscles: readonly string[], extra: number): boolean => {
    const now = muscleLoad();
    return muscles.some((m) => (now.get(m) ?? 0) + extra > FIT_LENGTHEN_LIMITS.muscleCap);
  };

  /** One edit: accepted (null) or why not. */
  const check = (e: TodayFitArgs['edits'][number]): FitRefusal | null => {
    switch (e.kind) {
      case 'rest':
        return 'rest_unchanged';
      case 'load':
        return shorten ? 'shorten_no_increase' : 'load_unchanged';
      case 'reps':
        return shorten ? 'shorten_no_increase' : 'reps_unchanged';
      case 'superset':
        return 'not_supported';
      case 'add': {
        if (shorten) return 'shorten_no_increase';
        if (e.exerciseId === null) return 'out_of_range';
        if (addedIds.has(e.exerciseId)) return 'duplicate';
        if (addedIds.size >= FIT_LENGTHEN_LIMITS.maxAdded) return 'max_added';
        const ok = input.canAdd(e.exerciseId);
        if (!ok.ok) return ok.why;
        // An added exercise plans its own shape (`addTargets`): counted at 3 working sets for the cap.
        if (overCap(ok.muscles, 3)) return 'muscle_cap';
        addedIds.add(e.exerciseId);
        addedMuscles.push({ muscles: ok.muscles, sets: 3 });
        accepted.push({ kind: 'add', exerciseId: e.exerciseId });
        return null;
      }
      case 'swap': {
        const slot = e.slotKey === null ? undefined : bySlot.get(e.slotKey);
        if (slot === undefined || e.exerciseId === null) return 'slot_gone';
        if (slot.benEdited) return 'ben_edited';
        const ok = input.canSwap(slot.slotKey, e.exerciseId);
        if (!ok.ok) return ok.why;
        if (suggestions.some((x) => x.slotKey === slot.slotKey)) return 'duplicate';
        suggestions.push({ slotKey: slot.slotKey, toExerciseId: e.exerciseId, fromName: slot.name, toName: ok.name });
        return null;
      }
      case 'skip':
      case 'sets': {
        const slot = e.slotKey === null ? undefined : bySlot.get(e.slotKey);
        if (slot === undefined) return 'slot_gone';
        if (slot.benEdited) return 'ben_edited';
        if (touched.has(slot.slotKey)) return 'duplicate';
        if (e.kind === 'skip') {
          if (!shorten) return 'no_change';
          if (slot.tier === 'A') return 'main_kept';
          touched.add(slot.slotKey);
          setsNow.set(slot.slotKey, 0);
          accepted.push({ kind: 'skip', slotKey: slot.slotKey });
          return null;
        }
        const n = e.workingSets;
        if (n === null || !Number.isInteger(n) || n < TODAY_EDIT_LIMITS.minSets || n > TODAY_EDIT_LIMITS.maxSets) return 'out_of_range';
        if (n === slot.workingSets) return 'no_change';
        if (n > slot.workingSets) {
          if (shorten) return 'shorten_no_increase';
          if (slot.held) return 'pain_hold';
          if (n > slot.workingSets + FIT_LENGTHEN_LIMITS.maxExtraSets) return 'max_extra_sets';
          if (overCap(slot.muscles, n - slot.workingSets)) return 'muscle_cap';
        } else if (slot.tier === 'A' && n < Math.min(2, slot.workingSets)) {
          return 'main_kept';
        }
        touched.add(slot.slotKey);
        setsNow.set(slot.slotKey, n);
        accepted.push({ kind: 'sets', slotKey: slot.slotKey, workingSets: n });
        return null;
      }
    }
  };
  input.args.edits.forEach((e, index) => {
    const why = check(e);
    if (why !== null) rejected.push({ index, kind: e.kind, slotKey: e.slotKey, why });
  });
  return { shorten, accepted, suggestions, rejected };
}

/** The words for a refusal (`Why?` on the coach card, the request log). App text, short. */
export const FIT_REFUSAL_WORDS: Record<FitRefusal, string> = {
  shorten_no_increase: 'no increase when shortening',
  rest_unchanged: 'rest stays as planned',
  load_unchanged: 'loads stay as planned',
  reps_unchanged: 'reps stay as planned',
  main_kept: 'main lifts kept',
  ben_edited: 'your edit stays',
  pain_hold: 'pain flag',
  slot_gone: 'not in today’s plan',
  max_extra_sets: 'at most 2 more sets',
  max_added: 'at most 2 added',
  not_own: 'not one of yours',
  not_here: 'not at this gym',
  in_plan: 'already in the plan',
  muscle_cap: 'about 8 sets a muscle',
  duplicate: 'asked twice',
  not_supported: 'not in this build',
  out_of_range: 'out of range',
  no_change: 'no change',
};

// ---------------------------------------------------------------------------
// Today's shown plan, as the coach's fit sees it (fit-to-time §5.1, FT-C14)

/** One slot as sent to the coach (app text, Ben's units and conventions). */
export interface FitPlanItem {
  slotKey: string;
  exercise: string;
  role: 'main' | 'compound' | 'accessory';
  bensEdit: boolean;
  painFlag: boolean;
  supersetWith: string[];
  /** `3 × 6–8 @ 100 kg @ RPE 8 · 2 warm-ups` (the first working set's target RPE, `targetRpeOf`). */
  sets: string;
  restS: number | null;
  last: string | null;
}

export interface FitPlanInput {
  /** The plan without any fit (the planner's dry run), nothing done. */
  aggregate: SessionAggregate;
  slotOf: Readonly<Record<string, string>>;
  tiers: Readonly<Record<string, FitTier>>;
  /** Slots Ben edited or skipped himself today. */
  benEdited: ReadonlySet<string>;
  /** Slots Ben skipped today: not in the plan the coach sees. */
  skipped: ReadonlySet<string>;
  held: (exerciseId: string) => boolean;
  muscles: (exerciseId: string) => readonly string[];
  /** Last comparable session as done (`100 kg × 8, 8, 7 · 1 Oct`), or null. */
  lastOf: (sessionExerciseId: string) => string | null;
  /** The built-in target RPE per session exercise (`ruleTargetRpes`): the last fallback of each set's target RPE. */
  ruleTargetRpe?: Readonly<Record<string, number>>;
}

/** The plan items for the request and the slots for `validateTodayFit`, in today's order, one per slot. */
export function fitPlanOf(input: FitPlanInput): { items: FitPlanItem[]; slots: FitPlanSlot[] } {
  const ordered = [...input.aggregate.exercises].sort((a, b) => a.order - b.order);
  const items: FitPlanItem[] = [];
  const slots: FitPlanSlot[] = [];
  const seen = new Set<string>();
  for (const ex of ordered) {
    const slotKey = input.slotOf[ex.id] ?? ex.id;
    if (seen.has(slotKey) || input.skipped.has(slotKey)) continue;
    seen.add(slotKey);
    const own = input.aggregate.sets.filter((s) => s.sessionExerciseId === ex.id && s.pairedWithSetId === null && s.status === 'pending').sort((a, b) => a.index - b.index);
    const working = own.filter((s) => s.setType !== 'warmup');
    const warm = own.length - working.length;
    const first = working[0];
    const amount = first?.planned.reps ? repRangeText(first.planned.reps) : first?.planned.durationS ? formatDuration(first.planned.durationS) : '—';
    const load = first?.planned.load ? ` @ ${loadText(first.planned.load, ex.loadConvention)}` : '';
    // The target RPE goes with the plan (ADR 0006 amendment 3), so a fit keeps the effort the sets were planned at.
    const rpe = first === undefined ? null : targetRpeOf(first, input.ruleTargetRpe?.[ex.id] ?? null);
    const effort = rpe === null ? '' : ` ${targetRpeText(rpe.rpe)}`;
    const tier = input.tiers[slotKey] ?? 'C';
    const held = input.held(ex.exerciseId);
    items.push({
      slotKey,
      exercise: ex.exerciseName,
      role: tier === 'A' ? 'main' : tier === 'B' ? 'compound' : 'accessory',
      bensEdit: input.benEdited.has(slotKey),
      painFlag: held,
      supersetWith: ex.supersetGroup === null ? [] : ordered.filter((o) => o.id !== ex.id && o.supersetGroup === ex.supersetGroup).map((o) => o.exerciseName),
      sets: `${String(working.length)} × ${amount}${load}${effort}${warm > 0 ? ` · ${String(warm)} warm-up${warm === 1 ? '' : 's'}` : ''}`.replaceAll(NBSP, ' '),
      restS: first?.rest.seconds ?? null,
      last: input.lastOf(ex.id),
    });
    slots.push({ slotKey, exerciseId: ex.exerciseId, name: ex.exerciseName, tier, workingSets: working.length, benEdited: input.benEdited.has(slotKey), held, muscles: input.muscles(ex.exerciseId) });
  }
  return { items, slots };
}

/** `edits` of a validated fit as the draft takes them: an added exercise's row key from the write's opId (a retry is the same row). */
export function coachFitDraftEdits(accepted: readonly CoachFitEdit[], opId: string): ({ kind: 'skip'; slotKey: string } | { kind: 'sets'; slotKey: string; workingSets: number } | { kind: 'add'; slotKey: string; exerciseId: string })[] {
  return accepted.map((e) => (e.kind === 'add' ? { kind: 'add' as const, slotKey: deriveId(`coach-fit-add:${opId}:${e.exerciseId}`), exerciseId: e.exerciseId } : e));
}
