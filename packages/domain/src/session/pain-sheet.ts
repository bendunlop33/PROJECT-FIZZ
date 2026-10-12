import type { EquipmentInstance, LoadConvention, Measurement, PainFlag, WeightUnit } from '@fizz/schemas';
import { dayMonthText } from '../display';
import {
  isPainCheckDue,
  PAIN_NO_INCREASES,
  PAIN_PROFESSIONAL_TEXT,
  painClearConfirm,
  painFlagHeading,
  painFlagSinceText,
} from '../pain-flags';
import type { HistorySession } from '../progression';
import { toMs } from '../time';
import { historySetsText, lastComparableHistory, painReference } from './target-why';

/**
 * The pain flag sheet (active-workout.md §2.14.4), opened from the set card's
 * `PainFlagNote`, `Why?`'s `Check due ›`, Today's check row and Profile's
 * Pain flags list. A pure read: it states the flag, asks `Still hurts?` only
 * when the check is due, and shows the last comparable workout before the
 * flag and the latest since, both as actual results. The one before is the
 * reference Ben's history keeps (§2.14.3): it never sets a target, and
 * clearing the flag resets nothing.
 */

export interface PainFlagSheetView {
  flagId: string;
  flagVersion: number;
  exerciseId: string;
  exerciseName: string;
  active: boolean;
  /** `Overhead press · shoulder`. */
  heading: string;
  /** `Since 6 Oct (16 days) · you, in a check-in`. */
  since: string;
  /** `No increases in load, reps or sets.`, or `Cleared 14 Oct.` once cleared elsewhere. */
  effect: string;
  /** `Still hurts?` is asked only when due. */
  checkDue: boolean;
  /** `Before the flag`: `2 Oct · 55 kg × 6, 6, 6` (actual; reference only). */
  before: string | null;
  /** `Since the flag`: `13 Oct · 50 kg × 8, 8, 8` (actual). */
  sinceFlag: string | null;
  professional: string;
  clearConfirm: ReturnType<typeof painClearConfirm>;
}

/** What makes two workouts comparable: same equipment, unit and load convention (`lastComparableSession`). */
export interface PainSheetAnchor {
  equipmentId: string | null;
  unit: WeightUnit;
  loadConvention: LoadConvention;
  /** For `stack`, `plates` and the like; null prints plain loads. */
  equipment: EquipmentInstance | null;
}

export interface PainFlagSheetInput {
  flag: PainFlag;
  /** This exercise's finished history (without a workout in progress). */
  history: readonly HistorySession[];
  nowMs: number;
  tz: string;
  exercise: { measurement: Measurement; defaultLoadConvention: LoadConvention };
  /**
   * The workout's exercise when opened from a set card, so `Before` and
   * `Since` match the equipment being used. Without one (Today, Profile),
   * the most recent workout of the exercise sets it.
   */
  anchor?: PainSheetAnchor | null;
}

/** The latest workout of the exercise (FitNotes too, B7) decides comparability when no workout is open. */
function anchorFromHistory(history: readonly HistorySession[], fallback: LoadConvention): Omit<PainSheetAnchor, 'equipment'> | null {
  const latest = [...history]
    .filter((h) => h.sets.some((s) => s.setType !== 'warmup'))
    .sort((a, b) => toMs(b.performedAtUtc) - toMs(a.performedAtUtc))[0];
  if (!latest) return null;
  const loaded = latest.sets.find((s) => s.setType !== 'warmup' && s.load !== null && s.load.convention !== 'bodyweight')?.load ?? null;
  return { equipmentId: latest.equipmentId, unit: loaded?.unit ?? 'kg', loadConvention: loaded?.convention ?? fallback };
}

export function buildPainFlagSheet(input: PainFlagSheetInput): PainFlagSheetView {
  const { flag, history, nowMs, tz } = input;
  const active = flag.status === 'active';
  const anchor = input.anchor ?? null;
  const basis = anchor ?? anchorFromHistory(history, input.exercise.defaultLoadConvention);
  const equipment = anchor?.equipment ?? null;
  const ex = { measurement: input.exercise.measurement, loadConvention: basis?.loadConvention ?? input.exercise.defaultLoadConvention };
  const line = (h: HistorySession) => `${dayMonthText(h.performedAtUtc, h.tz ?? tz)} · ${historySetsText(h, ex, equipment)}`;

  // A retracted flag (Undo right after setting it) never had a reference period (review B2).
  const before = basis === null || flag.status === 'retracted' ? null : painReference(history, flag, basis);
  const flaggedAt = toMs(flag.reportedAt.utc);
  const since = basis === null || flag.status === 'retracted' ? null : lastComparableHistory(history.filter((h) => toMs(h.performedAtUtc) >= flaggedAt), basis);

  return {
    flagId: flag.id,
    flagVersion: flag.version,
    exerciseId: flag.exerciseId,
    exerciseName: flag.exerciseName,
    active,
    heading: painFlagHeading(flag),
    since: painFlagSinceText(flag, nowMs, tz),
    effect: active ? PAIN_NO_INCREASES : flag.status === 'retracted' ? 'Undone.' : flag.clearedAtUtc === null ? 'Cleared.' : `Cleared ${dayMonthText(flag.clearedAtUtc, tz)}.`,
    checkDue: isPainCheckDue(flag, nowMs, tz),
    before: before === null ? null : line(before),
    sinceFlag: since === null ? null : line(since),
    professional: PAIN_PROFESSIONAL_TEXT,
    clearConfirm: painClearConfirm(flag),
  };
}
