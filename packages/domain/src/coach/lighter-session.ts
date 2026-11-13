import type { AdjustPendingSetsArgs, EquipmentInstance, Load, PainFlag, PendingSetChange, SessionAggregate, WorkoutSet } from '@fizz/schemas';
import { formatNumber } from '../display';
import { compareDifficulty, loadDirection, roundToAvailableLoad, stepLoad } from '../equipment';
import { equipmentOfRow } from '../session/equipment-snapshot';
import { buildExecutionOrder } from '../session/order';
import { validateTodayAdjustment } from './adjust';
import type { SessionAdjustment } from './session-adjust';

/**
 * (Ben, 23 Oct) The built-in lighter session after a low check-in, for when
 * the coach can't answer (not connected, offline). Pure and deterministic: no
 * AI call, no network.
 *
 * It only ever offers. Nothing changes until Ben taps `Apply` (CLAUDE.md rule
 * 3); the change goes through the same `validateTodayAdjustment` guardrail
 * (intent `lighter_session`: no increases, rule 9 pain blocks, snapped and
 * capped loads) and the versioned, idempotent write as the coach's, with Undo.
 *
 * Today's pending working sets only (rule 2): warm-ups, logged, skipped and
 * deleted sets never change.
 * - One fewer working set per exercise, never below one: the last pending
 *   working set goes, if the exercise has at least two working sets.
 * - Loads about 10% lighter, snapped to a load the equipment can make (rule
 *   4): the achievable load nearest to 10% lighter that is actually lighter,
 *   never more than 20% lighter (otherwise the load stays). Assisted machines:
 *   one step more assistance. Bodyweight sets keep their load; reps stay.
 */
export const LIGHTER_SESSION_RULE = {
  /** The asked-for drop (%), snapped to the nearest achievable lighter load. */
  loadDropPct: 10,
  /** A snapped drop bigger than this keeps the load instead (%). */
  maxLoadDropPct: 20,
  /** Working sets removed per exercise (never below `minWorkingSets`). */
  fewerSets: 1,
  minWorkingSets: 1,
} as const;

export const LIGHTER_SESSION_RULE_NAME = 'Lighter session after a low check-in';

export interface LighterSessionInput {
  aggregate: SessionAggregate;
  painFlags: readonly PainFlag[];
  /** The check-in said `Pain` with no movement chosen (rule 9). */
  sessionPainUnspecified: boolean;
  gymName: string | null;
  /** The check-in as Ben gave it (`You said 2 of 5 · Tired`), from `checkInFact`. */
  fact: string;
}

/** What `Apply` writes: the same shape the built-in write takes for the rule's other changes. */
export type LighterSessionAdjustment = Pick<SessionAdjustment, 'args' | 'plan' | 'guardNotes' | 'touchedSetIds' | 'reason' | 'rule'> & {
  /** `2 fewer sets · Loads 9–11% lighter` (app text, shown on the offer). */
  change: string;
  removedSets: number;
  lighterSets: number;
};

const EPS = 1e-9;

function liveInOrder(state: SessionAggregate, sessionExerciseId: string): WorkoutSet[] {
  const order = buildExecutionOrder(state.exercises, state.sets);
  const pos = new Map(order.map((id, i) => [id, i]));
  return state.sets
    .filter((s) => s.sessionExerciseId === sessionExerciseId && s.status !== 'deleted')
    .sort((a, b) => (pos.get(a.id) ?? a.index + 1e6) - (pos.get(b.id) ?? b.index + 1e6));
}

/** The lighter load for one set, or null when it keeps its load (none lighter within reach, bodyweight, unknown equipment). */
export function lighterLoad(cur: Load, eq: EquipmentInstance): Load | null {
  if (cur.convention !== eq.loadConvention || cur.unit !== eq.unit) return null;
  const direction = loadDirection(eq.loadConvention);
  if (direction === 'assistance') {
    const step = stepLoad(cur.value, eq, 'increase');
    return step.ok && compareDifficulty(step.value, cur.value, direction) < 0 ? { value: step.value, unit: eq.unit, convention: eq.loadConvention } : null;
  }
  if (cur.value <= 0) return null;
  const asked: Load = { value: cur.value * (1 - LIGHTER_SESSION_RULE.loadDropPct / 100), unit: eq.unit, convention: eq.loadConvention };
  const lighter = (p: 'nearest' | 'easier'): Load | null => {
    const r = roundToAvailableLoad(asked, eq, p);
    return r.ok && compareDifficulty(r.load.value, cur.value, direction) < 0 ? r.load : null;
  };
  const got = lighter('nearest') ?? lighter('easier');
  if (got === null) return null;
  return (cur.value - got.value) / cur.value <= LIGHTER_SESSION_RULE.maxLoadDropPct / 100 + EPS ? got : null;
}

function pctRange(pcts: readonly number[]): string {
  const r = (n: number): string => formatNumber(Math.round(n));
  const lo = Math.min(...pcts);
  const hi = Math.max(...pcts);
  return Math.round(lo) === Math.round(hi) ? r(lo) : `${r(lo)}–${r(hi)}`;
}

/**
 * `evaluateLighterSession`: the change `Apply` would make on the workout as
 * it is now, or null when there is nothing to change (no pending working
 * set, or nothing that can get lighter or shorter).
 */
export function evaluateLighterSession(input: LighterSessionInput): LighterSessionAdjustment | null {
  const state = input.aggregate;
  if (state.session.status !== 'active') return null;
  const requests: AdjustPendingSetsArgs['exercises'] = [];
  for (const ex of state.exercises) {
    if (ex.removed !== undefined) continue;
    const working = liveInOrder(state, ex.id).filter((s) => s.setType !== 'warmup' && (s.status === 'pending' || s.status === 'completed'));
    const pending = working.filter((s) => s.status === 'pending');
    if (pending.length === 0) continue;
    const canRemove = Math.min(LIGHTER_SESSION_RULE.fewerSets, working.length - LIGHTER_SESSION_RULE.minWorkingSets, pending.length);
    const removeSetId = canRemove > 0 ? (pending[pending.length - 1]?.id ?? null) : null;
    const eq = equipmentOfRow(state.session.equipmentSnapshot, ex);
    const sets: PendingSetChange[] = [];
    for (const set of pending) {
      if (set.id === removeSetId) continue;
      const cur = set.planned.load;
      if (cur === null || eq === null || ex.loadConvention === 'bodyweight' || cur.convention === 'bodyweight' || ex.unit !== eq.unit) continue;
      const next = lighterLoad(cur, eq);
      if (next !== null) sets.push({ setId: set.id, target: { load: next, reps: set.planned.reps } });
    }
    if (sets.length === 0 && removeSetId === null) continue;
    requests.push({ sessionExerciseId: ex.id, sets, addSet: null, removeSetId });
  }
  if (requests.length === 0) return null;

  const summary = 'Lighter session: one fewer set per exercise, loads about 10% lighter.';
  const reason = `${input.fact}. ${summary}`.slice(0, 240);
  const args: AdjustPendingSetsArgs = { baseVersion: state.session.version, exercises: requests, reason };
  const checked = validateTodayAdjustment({
    aggregate: state,
    args,
    intent: 'lighter_session',
    opId: `built-in:lighter:${state.session.id}`,
    painFlags: input.painFlags,
    sessionPainUnspecified: input.sessionPainUnspecified,
    gymName: input.gymName,
    messagePain: null,
  });
  if (checked.status !== 'apply') return null;

  const removedSets = checked.exercises.filter((e) => e.removed !== null).length;
  const lowered = checked.exercises.flatMap((e) => e.changes).filter((c) => c.before !== null && c.after !== null && c.before.load !== null && c.after.load !== null);
  const pcts = lowered.flatMap((c) => {
    const from = c.before?.load;
    const to = c.after?.load;
    if (!from || !to || from.value === 0 || from.unit !== to.unit) return [];
    return [(Math.abs(from.value - to.value) / from.value) * 100];
  });
  if (removedSets === 0 && lowered.length === 0) return null;
  const parts: string[] = [];
  if (removedSets > 0) parts.push(`${String(removedSets)} fewer ${removedSets === 1 ? 'set' : 'sets'}`);
  if (pcts.length > 0) parts.push(`${parts.length === 0 ? 'Loads' : 'loads'} ${pctRange(pcts)}% lighter`);
  const change = parts.join(' · ');
  return {
    args,
    plan: checked.exercises,
    guardNotes: checked.guardNotes,
    touchedSetIds: checked.touchedSetIds,
    change,
    reason,
    removedSets,
    lighterSets: lowered.length,
    rule: { name: LIGHTER_SESSION_RULE_NAME, decision: lowered.length > 0 ? 'reduce_load' : 'hold', summary, facts: [input.fact] },
  };
}
