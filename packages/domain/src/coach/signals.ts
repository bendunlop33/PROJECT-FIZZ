import type { EquipmentInstance, PainFlag, SessionAggregate, StructuralSignalKind } from '@fizz/schemas';
import { toMs } from '../time';

/**
 * `getStructuralChangeSignals` (coach-adjustments CA9, ADR 0020 §3): the
 * deterministic gate for structural proposals. Without a request or a signal,
 * the coach never sees `propose_next_workout_change` (coach-contract CC10).
 *
 * v1 has no routines, goals or schedule, so "the routine" is the next workout
 * built from `source` (Start next session). `goal_changed` and
 * `schedule_changed` can't fire until those exist; nothing is invented.
 */

export interface StructuralSignal {
  kind: StructuralSignalKind;
  /** App text shown after `Because:`. */
  fact: string;
  atUtc: string;
  /** The record that raised it (request, flag or equipment ID). */
  ref: string;
}

export interface VarietyRequest {
  id: string;
  atUtc: string;
  /** Not yet answered by a structural proposal. */
  answered: boolean;
}

export interface StructuralSignalInput {
  /** The workout the next one would be built from. */
  source: SessionAggregate;
  painFlags: readonly PainFlag[];
  /** Ben's own requests for variety or new exercises (classified from his words, never from tool output). */
  varietyRequests: readonly VarietyRequest[];
  /** Equipment as it is now at the gym the next workout would use. */
  currentEquipment: readonly EquipmentInstance[];
  /** The gym the next workout would start at; null = unknown (no signal from it). */
  nextGymId: string | null;
  /** Instant to stamp gym and equipment signals with. */
  nowUtc: string;
}

export function getStructuralChangeSignals(input: StructuralSignalInput): StructuralSignal[] {
  const { source } = input;
  const signals: StructuralSignal[] = [];

  for (const r of input.varietyRequests) {
    if (!r.answered) signals.push({ kind: 'variety_request', fact: 'you asked for some variety.', atUtc: r.atUtc, ref: r.id });
  }

  const startedMs = toMs(source.session.startedAt.utc);
  const exerciseIds = new Set(source.exercises.map((e) => e.exerciseId));
  for (const f of input.painFlags) {
    if (f.status !== 'active' || !exerciseIds.has(f.exerciseId) || toMs(f.reportedAt.utc) < startedMs) continue;
    const what = f.area !== null && f.area !== 'other' ? `${f.area} pain` : 'pain';
    signals.push({ kind: 'pain_flag', fact: `you flagged ${what} on ${f.exerciseName}.`, atUtc: f.reportedAt.utc, ref: f.id });
  }

  if (input.nextGymId !== null && source.session.gymId !== null && input.nextGymId !== source.session.gymId) {
    signals.push({ kind: 'equipment_changed', fact: 'your next workout is at a different gym.', atUtc: input.nowUtc, ref: input.nextGymId });
  } else {
    const current = new Map(input.currentEquipment.map((e) => [e.id, e]));
    const seen = new Set<string>();
    for (const ex of source.exercises) {
      if (ex.equipmentId === null || seen.has(ex.equipmentId)) continue;
      seen.add(ex.equipmentId);
      const then = source.session.equipmentSnapshot.find((e) => e.id === ex.equipmentId);
      const now = current.get(ex.equipmentId);
      if (then === undefined) continue;
      if (now === undefined || now.availability === 'retired') {
        signals.push({ kind: 'equipment_changed', fact: `${then.name} is no longer in your gym.`, atUtc: input.nowUtc, ref: then.id });
      } else if (now.version !== then.version) {
        signals.push({ kind: 'equipment_changed', fact: `${now.name} was changed.`, atUtc: now.updatedAtUtc, ref: now.id });
      }
    }
  }
  return signals;
}
