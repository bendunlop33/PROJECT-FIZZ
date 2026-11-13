import { ActionRecordSchema, type ActionDetail, type ActionRecord, type CoachTarget, type Load } from '@fizz/schemas';
import type { LedgerEntry, TurnLedger } from '../src/claims';

export const id = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
export const TZ = 'Europe/London';
export const T = '2026-10-10T17:21:00.000Z';

export const kg = (value: number, convention: Load['convention'] = 'total'): Load => ({ value, unit: 'kg', convention });
export const lb = (value: number, convention: Load['convention'] = 'total'): Load => ({ value, unit: 'lb', convention });
export const tgt = (load: Load | null, min: number | null, max = min): CoachTarget => ({
  load,
  reps: min === null || max === null ? null : { min, max },
});

let seq = 100;

export function record(detail: ActionDetail, over: Partial<ActionRecord> = {}): ActionRecord {
  seq += 1;
  return ActionRecordSchema.parse({
    actionId: id(seq),
    turnId: 'turn-1',
    opId: `turn-1:tool:${String(seq)}`,
    status: 'committed',
    author: 'coach',
    detail,
    failure: null,
    reason: 'Set 2 was RPE 10.',
    evidenceRefs: [],
    guardNotes: [],
    entityVersions: [],
    undoneBy: null,
    createdAt: { utc: T, tz: TZ },
    ...over,
  });
}

/** Bench sets 3–4: 100 kg × 6–8 → 95 kg × 8 (the contract's running example). */
export function benchAdjust(over: Partial<ActionRecord> = {}, after: CoachTarget = tgt(kg(95), 8)): ActionRecord {
  return record(
    {
      kind: 'adjust_pending_sets',
      sessionId: id(1),
      exercises: [
        {
          sessionExerciseId: id(10),
          exerciseName: 'Bench press',
          changes: [
            { setId: id(13), setNumber: 3, before: tgt(kg(100), 6, 8), after },
            { setId: id(14), setNumber: 4, before: tgt(kg(100), 6, 8), after },
          ],
        },
      ],
    },
    over,
  );
}

export function ledger(entries: (ActionRecord | [string, ActionRecord, LedgerEntry['origin']?])[], names: string[] = KNOWN_NAMES): TurnLedger {
  return {
    turnId: 'turn-1',
    knownExerciseNames: names,
    entries: entries.map((e, i) =>
      Array.isArray(e) ? { ref: e[0], record: e[1], origin: e[2] ?? 'this_turn' } : { ref: `a${String(i + 1)}`, record: e, origin: 'this_turn' },
    ),
  };
}

export const KNOWN_NAMES = ['Bench press', 'Incline DB press', 'Overhead press', 'Cable fly', 'Pec deck', 'Back squat', 'Romanian deadlift', 'Lateral raise', 'Face pull', 'Cable row'];
