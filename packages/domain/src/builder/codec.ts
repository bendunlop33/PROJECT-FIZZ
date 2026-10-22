import { BUILD_LIMITS, slotRev, type CheckedOnRecord, type DraftLoad, type DraftPlan, type DraftSetTemplate, type DraftSlot, type DraftSlotBuilder } from '@fizz/schemas';
import { stableStringify } from '../stable';
import { PLANNED_HELD_LINE } from './from-planned';
import { restAfterRows, roundRestOf } from './rest';
import type { BuilderBlock, BuilderInfoLookup, BuilderSetRow, BuilderSlot, BuilderWorkout, RestLevel } from './types';
import { draftLoadSourceOf } from './types';

/**
 * Builder workout ↔ stored draft plan (workout-builder-v3 §4.4, §4.5). The
 * builder edits `BuilderWorkout`; a draft stores `DraftPlan` (what Start
 * plans from) plus each slot's `builder` state, so a force-close loses
 * nothing. Pure.
 *
 * Rest (§4.5): each set's rest runs after it. A solo slot's set templates
 * carry `restAfterRows`; in a superset only the round's last exercise rests
 * (`After each round`), the others carry none (no rest inside a round).
 *
 * (22 Oct) A timed or cardio set (a library workout's plank or ride) is stored as saved: no reps, its work time
 * and its distance; reading it back gives the row its time and distance again.
 */

const clampWorkS = (s: number): number => Math.min(BUILD_LIMITS.maxCardioS, Math.max(BUILD_LIMITS.minWorkS, Math.round(s)));

/** A row's reps, or its work time and distance (a timed or cardio set). */
function amountOf(row: BuilderSetRow): Pick<DraftSetTemplate, 'reps' | 'durationS' | 'distanceM'> {
  if (row.durationS === undefined && row.distanceM === undefined) return { reps: { min: row.reps, max: Math.max(row.reps, row.repsMax ?? row.reps) }, durationS: null };
  return { reps: null, durationS: row.durationS === undefined ? null : clampWorkS(row.durationS), ...(row.distanceM === undefined ? {} : { distanceM: row.distanceM }) };
}

export interface DraftCodecContext {
  info: BuilderInfoLookup;
  restPresetsS?: readonly number[];
  /** The catalogue key a slot's exercise came from (provenance); its ID when none. */
  catalogueIdOf: (exerciseId: string) => string;
  /** The item a slot's loads were worked out on; null = none. */
  checkedOnOf: (exerciseId: string) => CheckedOnRecord | null;
}

const LETTERS = 'ABCDEFGHIJ';

function draftLoadOf(slot: BuilderSlot, row: BuilderSetRow): DraftLoad {
  // (R3) A load the saved workout's planner made keeps its reasons (held on pain, capped or rounded here) until Ben types one.
  const why = row.typed === true || row.load === null ? undefined : slot.why;
  return {
    load: row.load === null ? null : { value: row.load, unit: slot.unit, convention: slot.convention },
    source: row.load === null ? 'none' : draftLoadSourceOf(slot.source, row.typed === true),
    basis: null,
    basisFromCoach: false,
    held: why?.includes(PLANNED_HELD_LINE) === true,
    notes: (why ?? []).slice(1).map((n) => n.slice(0, 200)),
    notUsed: null,
    ...(row.typed === true && row.roundedFrom !== undefined ? { requested: row.roundedFrom } : {}),
  };
}

function metaOf(slot: BuilderSlot, block: BuilderBlock, first: boolean): DraftSlotBuilder {
  return {
    repRange: { ...slot.repRange },
    unit: slot.unit,
    convention: slot.convention,
    source: slot.source,
    anchorE1rm: slot.anchorE1rm,
    startLight: slot.startLight,
    ...(slot.touched === true ? { touched: true as const } : {}),
    ...(slot.unlinked === true ? { unlinked: true as const } : {}),
    ...(slot.origin === undefined ? {} : { origin: slot.origin }),
    ...(first && block.auto && block.slots.length > 1 ? { autoPair: true as const } : {}),
    ...(first && block.roundRestS !== undefined && block.slots.length > 1 ? { roundRestS: block.roundRestS } : {}),
    ...(slot.restS !== undefined && Object.keys(slot.restS).length > 0 ? { restS: { ...slot.restS } } : {}),
    ...(slot.why !== undefined && slot.why.length > 0 ? { why: [...slot.why] } : {}),
  };
}

/** `toDraftPlan`: the workout as a draft plan (order, superset letters, set templates with loads and rests). */
export function toDraftPlan(w: BuilderWorkout, ctx: DraftCodecContext): DraftPlan {
  const slots: DraftSlot[] = [];
  let order = 0;
  let letter = 0;
  for (const block of w.blocks) {
    if (block.slots.length === 0) continue;
    const group = block.slots.length > 1 ? (LETTERS[letter] ?? `S${String(letter)}`) : null;
    if (group !== null) letter += 1;
    const round = roundRestOf(block, w.restLevel, ctx.restPresetsS);
    block.slots.forEach((slot, si) => {
      const solo = restAfterRows(slot, ctx.info, w.restLevel, ctx.restPresetsS);
      const last = si === block.slots.length - 1;
      const setTemplates: DraftSetTemplate[] = slot.rows.map((row, i) => {
        const beforeDrop = slot.rows[i + 1]?.type === 'drop' && row.type !== 'warmup';
        const restS = group === null || row.type === 'warmup' || beforeDrop ? (solo[i] ?? null) : last ? round : null;
        return {
          setType: row.type,
          ...amountOf(row),
          targetRpe: row.type === 'warmup' ? null : row.rpe,
          restS,
          load: draftLoadOf(slot, row),
        };
      });
      slots.push({
        slotKey: slot.key,
        exerciseId: slot.exerciseId,
        catalogueId: ctx.catalogueIdOf(slot.exerciseId),
        order,
        main: slot.main,
        supersetGroup: group,
        setTemplates,
        checkedOn: ctx.checkedOnOf(slot.exerciseId),
        ...(slot.historyVersion === undefined ? {} : { checkedHistoryVersion: slot.historyVersion }),
        builder: metaOf(slot, block, si === 0),
      });
      order += 1;
    });
  }
  return { slots };
}

const repRangeOf = (s: DraftSlot): { min: number; max: number } => {
  const work = s.setTemplates.filter((t) => t.setType !== 'warmup' && t.reps !== null);
  if (work.length === 0) return { min: 8, max: 12 };
  return { min: Math.min(...work.map((t) => t.reps?.min ?? 0)), max: Math.max(...work.map((t) => t.reps?.max ?? 0)) };
};

/**
 * Where a coach-built slot's load came from (a chat draft opened on Your workout, 22 Oct): the coach chose it
 * (`coach`, or `coach_est` labelled an estimate on the session) → `Coach target`; the plan's first week → `plan`;
 * none → `none`; else the built-in rule.
 */
function coachSlotSource(s: DraftSlot): BuilderSlot['source'] {
  const first = s.setTemplates.find((t) => t.setType !== 'warmup' && t.load?.load != null)?.load ?? s.setTemplates.find((t) => t.load?.load != null)?.load;
  if (first === undefined) return 'none';
  if (first.source === 'coach' || first.source === 'coach_est') return 'coach_target';
  if (first.source === 'plan') return 'plan';
  return 'rule';
}

function slotOf(s: DraftSlot): BuilderSlot {
  const meta = s.builder;
  const firstLoad = s.setTemplates.find((t) => t.load?.load != null)?.load?.load ?? null;
  const rows: BuilderSetRow[] = s.setTemplates.map((t) => ({
    type: t.setType,
    reps: t.reps?.min ?? 1,
    ...(t.reps != null && t.reps.max > t.reps.min ? { repsMax: t.reps.max } : {}),
    // A timed or cardio set (no reps): its time and distance as saved (22 Oct); `reps` is only a placeholder then.
    ...(t.reps === null && t.durationS !== null ? { durationS: t.durationS } : {}),
    ...(t.reps === null && t.distanceM != null ? { distanceM: t.distanceM } : {}),
    load: t.load?.load?.value ?? null,
    rpe: t.setType === 'warmup' ? null : t.targetRpe,
    ...(t.load?.source === 'ben' ? { typed: true as const } : {}),
    ...(t.load?.source === 'ben' && t.load.requested !== undefined ? { roundedFrom: t.load.requested } : {}),
  }));
  const out: BuilderSlot = {
    key: s.slotKey,
    exerciseId: s.exerciseId,
    main: s.main,
    repRange: meta?.repRange ?? repRangeOf(s),
    rows,
    unit: meta?.unit ?? firstLoad?.unit ?? s.checkedOn?.unit ?? 'kg',
    convention: meta?.convention ?? firstLoad?.convention ?? s.checkedOn?.convention ?? 'total',
    source: meta?.source ?? coachSlotSource(s),
    startLight: meta?.startLight ?? null,
    anchorE1rm: meta?.anchorE1rm ?? null,
  };
  if (meta?.restS !== undefined) out.restS = { ...meta.restS };
  if (meta?.touched === true) out.touched = true;
  if (meta?.unlinked === true) out.unlinked = true;
  if (meta?.origin !== undefined) out.origin = meta.origin;
  if (meta?.why !== undefined && meta.why.length > 0) out.why = [...meta.why];
  if (s.checkedHistoryVersion != null) out.historyVersion = s.checkedHistoryVersion;
  return out;
}

/** `fromDraftPlan`: a stored plan back as the builder's workout (consecutive slots with one letter are one superset). */
export function fromDraftPlan(plan: DraftPlan, restLevel: RestLevel = 'normal'): BuilderWorkout {
  const sorted = [...plan.slots].sort((a, b) => a.order - b.order);
  const blocks: BuilderBlock[] = [];
  let prevGroup: string | null = null;
  for (const s of sorted) {
    const slot = slotOf(s);
    const last = blocks[blocks.length - 1];
    if (s.supersetGroup !== null && s.supersetGroup === prevGroup && last !== undefined) {
      last.slots.push(slot);
    } else {
      const block: BuilderBlock = { slots: [slot], auto: s.builder?.autoPair === true };
      if (s.builder?.roundRestS !== undefined) block.roundRestS = s.builder.roundRestS;
      blocks.push(block);
    }
    prevGroup = s.supersetGroup;
  }
  return { blocks: blocks.map((b) => (b.slots.length > 1 ? b : { slots: b.slots, auto: false })), restLevel };
}

/**
 * Per-slot revisions (§4.4): a slot whose stored form changed (or that is
 * new) gets `rev + 1` of the slot it replaces; unchanged ones keep theirs.
 * Proposals and review suggestions are refused only when a slot they name
 * moved. Order alone is not a slot change.
 */
export function withSlotRevs(prev: DraftPlan | null, next: DraftPlan): { plan: DraftPlan; changed: string[] } {
  const before = new Map((prev?.slots ?? []).map((s) => [s.slotKey, s]));
  const changed: string[] = [];
  const shape = (s: DraftSlot): string => stableStringify({ ...s, order: 0, rev: 0 });
  const slots = next.slots.map((s) => {
    const was = before.get(s.slotKey);
    if (was !== undefined && shape(was) === shape(s)) return { ...s, rev: slotRev(was) };
    changed.push(s.slotKey);
    return { ...s, rev: was === undefined ? 1 : slotRev(was) + 1 };
  });
  return { plan: { slots }, changed };
}
