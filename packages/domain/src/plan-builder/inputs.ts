import type { EquipmentInstance, LoadConvention } from '@fizz/schemas';
import { getAchievableLoads, isBarLoaded, isPresenceOnly } from '../equipment';
import type { HistorySession } from '../progression';
import { toMs } from '../time';
import { PB_STALE_DAYS, type PbHistory } from './lifts';
import type { PlanKit } from './loads';

/**
 * Ben's records as the engine reads them. Pure: the app reads the gym's items and his history, these shape them.
 */

/** An exercise's item at the gym as a kit: its achievable loads (rule 4). Null for presence-only items or none. */
export function pbKitOfEquipment(eq: EquipmentInstance): PlanKit | null {
  if (isPresenceOnly(eq)) return null;
  const a = getAchievableLoads(eq);
  if (a.loads.length === 0) return null;
  return { equipmentId: eq.id, kind: eq.kind, unit: a.unit, convention: a.convention, loads: [...a.loads].sort((x, y) => x - y), barMass: isBarLoaded(eq) ? eq.barMass : null };
}

const DAY_MS = 86_400_000;

/**
 * An exercise's own record (§2 preference evidence, §1a lift checks): the newest session's heaviest countable working
 * set in `convention` (any convention when null), and its sessions, the ones older than 8 weeks counting half.
 * Imported history counts from day one. `skips`: none recorded yet (the app has no skip record), so 0.
 */
export function pbHistoryOf(sessions: readonly HistorySession[], convention: LoadConvention | null, nowMs: number): PbHistory | null {
  const own = sessions.filter((s) => s.copy !== true);
  if (own.length === 0) return null;
  let count = 0;
  for (const s of own) count += nowMs - toMs(s.performedAtUtc) > PB_STALE_DAYS * DAY_MS ? 0.5 : 1;
  const newestFirst = [...own].sort((a, b) => toMs(b.performedAtUtc) - toMs(a.performedAtUtc));
  let last: PbHistory['last'] = null;
  for (const s of newestFirst) {
    const sets = s.sets.filter((x) => x.setType !== 'warmup' && x.load !== null && x.reps !== null && x.reps > 0 && (x.exclusions ?? []).length === 0 && (convention === null || x.load.convention === convention));
    const best = [...sets].sort((a, b) => (b.load?.value ?? 0) - (a.load?.value ?? 0) || (b.reps ?? 0) - (a.reps ?? 0))[0];
    if (best?.load != null && best.reps !== null) {
      last = { value: best.load.value, unit: best.load.unit, reps: best.reps, atUtc: s.performedAtUtc };
      break;
    }
  }
  return { last, sessions: count, skips: 0 };
}
