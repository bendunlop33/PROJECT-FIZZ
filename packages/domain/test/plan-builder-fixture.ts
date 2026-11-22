import type { PlanBuilderAnswers } from '@fizz/schemas';
import { pbDefaultAnswers, type PbHistory, type PbKitOf, type PlanKit } from '../src';

/** A gym like the prototype's: 2.5 kg plate steps on bars, 2 kg dumbbells to 50, 5 kg stacks, an assisted pull-up. */
export const NOW = Date.parse('2026-10-22T12:00:00Z');

const range = (from: number, to: number, step: number): number[] => {
  const out: number[] = [];
  for (let v = from; v <= to + 1e-9; v += step) out.push(Math.round(v * 1000) / 1000);
  return out;
};

export const BAR: PlanKit = { equipmentId: '00000000-0000-4000-8000-0000000000b1', kind: 'barbell', unit: 'kg', convention: 'total', loads: range(20, 300, 2.5), barMass: 20 };
export const DB: PlanKit = { equipmentId: '00000000-0000-4000-8000-0000000000b2', kind: 'dumbbells', unit: 'kg', convention: 'per_hand', loads: range(2, 50, 2), barMass: null };
export const STACK: PlanKit = { equipmentId: '00000000-0000-4000-8000-0000000000b3', kind: 'weight_stack', unit: 'kg', convention: 'stack', loads: range(5, 150, 2.5), barMass: null };
export const PLATE_MACHINE: PlanKit = { equipmentId: '00000000-0000-4000-8000-0000000000b4', kind: 'plate_loaded_machine', unit: 'kg', convention: 'total', loads: range(0, 400, 2.5), barMass: null };
export const ASSIST: PlanKit = { equipmentId: '00000000-0000-4000-8000-0000000000b5', kind: 'assisted_stack', unit: 'kg', convention: 'assistance', loads: range(5, 70, 5), barMass: null };

export function kitFor(key: string): PlanKit | 'bodyweight' | null {
  if (key.startsWith('bodyweight-')) return 'bodyweight';
  if (key === 'machine-assisted-pull-up') return ASSIST;
  if (key.startsWith('barbell-') || key.startsWith('ez-bar-') || key.startsWith('smith-')) return BAR;
  if (key.startsWith('dumbbell-')) return DB;
  if (key === 'machine-leg-press' || key === 'machine-hack-squat') return PLATE_MACHINE;
  if (key.startsWith('machine-') || key.startsWith('cable-')) return STACK;
  return null;
}
export const KIT_OF: PbKitOf = kitFor;

const h = (value: number, reps: number, at: string, sessions = 4, skips = 0): PbHistory => ({ last: { value, unit: 'kg', reps, atUtc: at }, sessions, skips });

/** The prototype's example history (HIST), keyed by catalogue key. */
export const HIST: Readonly<Record<string, PbHistory>> = {
  'barbell-bench-press': h(100, 6, '2026-10-12T10:00:00Z'),
  'barbell-bent-over-row': h(90, 12, '2026-10-18T10:00:00Z'),
  'barbell-back-squat': h(120, 5, '2026-08-03T10:00:00Z', 2),
  'barbell-romanian-deadlift': h(100, 8, '2026-10-10T10:00:00Z'),
  'barbell-overhead-press': h(55, 6, '2026-06-02T10:00:00Z', 2),
  'dumbbell-seated-shoulder-press': h(24, 8, '2026-10-15T10:00:00Z'),
  'machine-shoulder-press': h(50, 10, '2026-10-02T10:00:00Z'),
  'dumbbell-incline-bench-press': h(30, 10, '2026-10-14T10:00:00Z', 14),
  'cable-lat-pulldown': h(70, 10, '2026-10-16T10:00:00Z'),
  'machine-leg-press': h(200, 10, '2026-10-10T10:00:00Z'),
  'dumbbell-shrug': h(30, 15, '2026-09-30T10:00:00Z', 2, 3),
  'cable-fly': h(20, 12, '2026-10-14T10:00:00Z', 9),
  'dumbbell-lateral-raise': h(10, 15, '2026-10-15T10:00:00Z'),
  'cable-triceps-pushdown': h(35, 12, '2026-10-14T10:00:00Z'),
  'dumbbell-hammer-curl': h(16, 12, '2026-10-16T10:00:00Z'),
  'machine-lying-leg-curl': h(50, 12, '2026-10-10T10:00:00Z'),
  'machine-standing-calf-raise': h(80, 15, '2026-10-10T10:00:00Z'),
  'cable-face-pull': h(25, 15, '2026-10-16T10:00:00Z'),
  'barbell-curl': h(35, 10, '2026-10-16T10:00:00Z'),
  'cable-crunch': h(40, 15, '2026-10-14T10:00:00Z'),
};

export const HISTORY_OF = (key: string): PbHistory | null => HIST[key] ?? null;

export function answers(patch: Partial<PlanBuilderAnswers> = {}): PlanBuilderAnswers {
  return { ...pbDefaultAnswers({ sessions: 4, minutes: 60 }), ...patch };
}
