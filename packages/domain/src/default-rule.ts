import type { EquipmentKind, Exercise, ExerciseEquipmentKind, LoadConvention, ProgressionRule, WeightUnit } from '@fizz/schemas';
import { deriveId } from './stable';

/**
 * The built-in default progression rule by exercise category (ADR 0010
 * amendment 2, PROVISIONAL, Ben to confirm). Used for every exercise with no
 * rule of its own when the coach isn't connected (ADR 0006 fallback), and
 * always labelled as the built-in rule.
 *
 * - `main_barbell`: compound barbell strength lifts (squat, bench, deadlift,
 *   overhead press and row variants): double progression, 3–6 reps, progress
 *   only at RPE 8.5 or easier.
 * - `compound`: other compound lifts: 6–10 reps, RPE 9.
 * - `isolation`: isolation and accessory lifts: 8–12 reps, RPE 9.
 *
 * Loads always come from the equipment (rounded, never above its max), and
 * every rule reduces 10 % only after 2 missed sessions.
 */
export type RuleCategory = 'main_barbell' | 'compound' | 'isolation';

/** Families that are the main barbell strength lifts (catalogue vocabulary). */
const MAIN_FAMILIES = new Set(['squat', 'front_squat', 'bench_press', 'deadlift', 'overhead_press', 'row']);
/** Patterns of the main lifts, for exercises without a family. */
const MAIN_PATTERNS = new Set(['squat', 'horizontal_push', 'vertical_push', 'horizontal_pull']);
/** Single-joint patterns, for exercises without a `mechanic`. */
const ISOLATION_PATTERNS = new Set(['arms', 'calves', 'core', 'elbow_flexion', 'elbow_extension', 'shoulder_abduction', 'knee_extension', 'knee_flexion']);

export type RuleExerciseInfo = Pick<Exercise, 'movementPattern'> & Partial<Pick<Exercise, 'mechanic' | 'family' | 'compatibleEquipment'>>;

/**
 * Category for the default rule. `equipmentKind` is the kind of equipment
 * the exercise is done with in this session (null = none attached; then a
 * `total` load with a barbell-, trap-bar- or EZ-bar-compatible exercise
 * counts as a barbell).
 * Unknown exercises (no info) are treated as accessories: the widest range.
 */
export function ruleCategory(ex: RuleExerciseInfo | null, equipmentKind: EquipmentKind | ExerciseEquipmentKind | null, convention: LoadConvention): RuleCategory {
  if (ex === null) return 'isolation';
  const isolation = ex.mechanic === 'isolation' || (ex.mechanic === undefined && ISOLATION_PATTERNS.has(ex.movementPattern));
  if (isolation) return 'isolation';
  // A trap bar or EZ bar is plate-loaded like a barbell (only its bar weight differs), so a trap-bar deadlift is still a main lift.
  const isBar = (k: EquipmentKind | ExerciseEquipmentKind | null): boolean => k === 'barbell' || k === 'trap_bar' || k === 'ez_bar';
  const barbell = isBar(equipmentKind) || (equipmentKind === null && convention === 'total' && (ex.compatibleEquipment ?? []).some(isBar));
  if (barbell) {
    const main = ex.family !== undefined ? MAIN_FAMILIES.has(ex.family) : MAIN_PATTERNS.has(ex.movementPattern);
    if (main) return 'main_barbell';
  }
  return 'compound';
}

interface CategoryRule {
  min: number;
  max: number;
  rpe: number;
  cap: number;
  label: string;
}

const RULES: Record<RuleCategory, CategoryRule> = {
  main_barbell: { min: 3, max: 6, rpe: 8.5, cap: 8, label: 'a main barbell lift' },
  compound: { min: 6, max: 10, rpe: 9, cap: 12, label: 'a compound lift' },
  isolation: { min: 8, max: 12, rpe: 9, cap: 15, label: 'an accessory lift' },
};

/** The built-in rep range for a category (`3–6` for a main barbell lift). */
export function builtInRepRange(category: RuleCategory): { min: number; max: number } {
  return { min: RULES[category].min, max: RULES[category].max };
}

/** `Double progression, 3–6 reps up to RPE 8.5 (built-in default for a main barbell lift, provisional)` */
export function builtInRuleName(category: RuleCategory): string {
  const r = RULES[category];
  return `Double progression, ${String(r.min)}–${String(r.max)} reps up to RPE ${String(r.rpe)} (built-in default for ${r.label}, provisional)`;
}

export function builtInDefaultRule(ownerId: string, unit: WeightUnit, workingSets: number, category: RuleCategory): ProgressionRule {
  const r = RULES[category];
  return {
    id: deriveId(`builtin-rule:${category}:double-${String(r.min)}-${String(r.max)}:${unit}`),
    ownerId,
    version: 1,
    createdAtUtc: '2026-10-09T00:00:00.000Z',
    updatedAtUtc: '2026-10-09T00:00:00.000Z',
    name: builtInRuleName(category),
    method: 'double_progression',
    repRange: { min: r.min, max: r.max },
    workingSets: Math.min(10, Math.max(1, workingSets)),
    maxRpeToProgress: r.rpe,
    minRirToProgress: null,
    ceilingRepCap: r.cap,
    loadIncrement: unit === 'kg' ? { value: 2.5, unit: 'kg' } : { value: 5, unit: 'lb' },
    startingLoad: null,
    failuresBeforeReduce: 2,
    reducePercent: 10,
    maxLoadJump: null,
  };
}
