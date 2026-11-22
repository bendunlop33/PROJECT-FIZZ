import { coachEditStepOpId, type SessionAggregate } from '@fizz/schemas';

/** (Ben, 26 Oct; log-past-workout Q-PL2) The past log's one-tap button. */
export const TICK_ALL_LABEL = 'Tick all as planned';

/** The toast after `Tick all as planned`: `8 sets ticked`; counts the sets that write ticked and that are still done. */
export function tickAllDoneText(after: Pick<SessionAggregate, 'sets'>, opId: string): string {
  const ids = new Set<string>();
  for (let i = 0; i < after.sets.length; i += 1) ids.add(coachEditStepOpId(opId, i));
  const n = after.sets.filter((s) => s.status === 'completed' && s.completedByOpId !== null && ids.has(s.completedByOpId)).length;
  return `${String(n)} ${n === 1 ? 'set' : 'sets'} ticked`;
}
