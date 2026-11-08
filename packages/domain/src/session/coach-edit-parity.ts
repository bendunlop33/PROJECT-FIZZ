import { coachEditStepOpId, type ActionDetail, type CoachEditStep, type EditTodayOp, type SessionAggregate, type SessionExercise, type WorkoutSet, type ZonedTimestamp } from '@fizz/schemas';
import { reduceSession } from './reducer';

/**
 * (Ben, 8 Nov: "the coach can do in today's workout anything I can do by hand") The `edit_today` ops that mirror the
 * workout's own manual controls with no coaching judgement in them: take one set out, a set's type / rest / time or
 * distance, the sets' order, a note, `+ Weight`. Pure. Each becomes the workout's own command (its own guards apply:
 * pending sets only, rule 2), built against the workout as the edit's earlier steps leave it (so a set the edit adds or
 * changes is at the version it will have), and is undone with the edit (`revert_coach_edit`, one Undo).
 */

type Line = Extract<ActionDetail, { kind: 'edit_today' }>['lines'][number];

export const PARITY_OPS = ['remove_set', 'set_details', 'order_sets', 'note', 'load_mode'] as const satisfies readonly EditTodayOp['op'][];
export type ParityOp = Extract<EditTodayOp, { op: (typeof PARITY_OPS)[number] }>;

export function isParityOp(op: EditTodayOp): op is ParityOp {
  return (PARITY_OPS as readonly string[]).includes(op.op);
}

const liveRow = (s: SessionAggregate, id: string): SessionExercise | undefined => s.exercises.find((e) => e.id === id && e.removed === undefined);
const pendingOf = (s: SessionAggregate, rowId: string): WorkoutSet[] => s.sets.filter((x) => x.sessionExerciseId === rowId && x.status === 'pending').sort((a, b) => a.index - b.index);
const setNumber = (s: SessionAggregate, set: WorkoutSet): number =>
  s.sets
    .filter((x) => x.sessionExerciseId === set.sessionExerciseId && x.status !== 'deleted')
    .sort((a, b) => a.index - b.index)
    .findIndex((x) => x.id === set.id) + 1;
const clock = (sec: number): string => `${String(Math.floor(sec / 60))}:${String(sec % 60).padStart(2, '0')}`;
const TYPE_WORD: Readonly<Record<WorkoutSet['setType'], string>> = { warmup: 'warm-up', working: 'working', top: 'top set', backoff: 'back-off', drop: 'drop set' };

/** The workout as the edit's steps so far leave it (the edit isn't written yet; nothing here writes). */
export function afterSteps(s: SessionAggregate, steps: readonly CoachEditStep[], ids: { at: ZonedTimestamp; opId: string; baseVersion: number; actionId: string }): SessionAggregate {
  if (steps.length === 0) return s;
  const r = reduceSession(s, { type: 'coach_edit_today', at: ids.at, opId: ids.opId, expectedVersion: ids.baseVersion, actionId: ids.actionId, steps: [...steps] });
  return r.ok && r.duplicate !== true ? r.state : s;
}

/**
 * The parity ops' steps, numbered from `first`. `now`: the workout after the edit's other steps. A step that can't be
 * made is a note (`Not done: …`); the rest apply.
 */
export function parityOpSteps(now: SessionAggregate, ops: readonly ParityOp[], ids: { at: ZonedTimestamp; opId: string; first: number }): { steps: CoachEditStep[]; lines: Line[]; notes: string[]; names: string[] } {
  const steps: CoachEditStep[] = [];
  const lines: Line[] = [];
  const notes: string[] = [];
  const names: string[] = [];
  const nextOpId = (): string => coachEditStepOpId(ids.opId, ids.first + steps.length);
  const unknownRow = 'the coach named an exercise that isn’t in this workout';
  const used = new Set<string>();
  for (const op of ops) {
    if (op.op === 'remove_set') {
      const set = now.sets.find((x) => x.id === op.setId);
      const row = set === undefined ? undefined : liveRow(now, set.sessionExerciseId);
      if (set === undefined || row === undefined) {
        notes.push('the coach named a set that isn’t in this workout');
        continue;
      }
      if (set.status !== 'pending') {
        notes.push(`${row.exerciseName} set ${String(setNumber(now, set))} is ${set.status === 'completed' ? 'done' : 'not pending'}`);
        continue;
      }
      if (used.has(set.id)) continue;
      used.add(set.id);
      steps.push({ type: 'delete_set', at: ids.at, opId: nextOpId(), setId: set.id, expectedSetVersion: set.version });
      lines.push({ change: 'remove', text: `${row.exerciseName}: set ${String(setNumber(now, set))} removed`.slice(0, 200) });
      names.push(row.exerciseName);
      continue;
    }
    const row = liveRow(now, op.sessionExerciseId);
    if (row === undefined) {
      notes.push(unknownRow);
      continue;
    }
    switch (op.op) {
      case 'set_details': {
        const pending = pendingOf(now, row.id);
        const targets = op.setId === null ? pending : pending.filter((x) => x.id === op.setId);
        if (targets.length === 0) {
          notes.push(op.setId === null ? `${row.exerciseName} has no set left to change` : `that ${row.exerciseName} set isn’t pending`);
          break;
        }
        if (op.setType !== null && op.setId === null) {
          notes.push(`a set type is for one set of ${row.exerciseName}`);
        }
        const timed = row.measurement === 'duration' || row.measurement === 'cardio';
        if (op.workSeconds !== null && !timed) notes.push(`${row.exerciseName} isn’t timed`);
        if (op.distanceMetres !== null && row.measurement !== 'cardio' && row.measurement !== 'distance') notes.push(`${row.exerciseName} has no distance`);
        const parts: string[] = [];
        let any = false;
        for (const set of targets) {
          if (used.has(set.id)) continue;
          const patch: Extract<CoachEditStep, { type: 'edit_planned_set' }>['patch'] = {
            ...(op.setType !== null && op.setId !== null && op.setType !== set.setType ? { setType: op.setType } : {}),
            ...(op.restSeconds !== null && op.restSeconds !== set.rest.seconds ? { restS: op.restSeconds } : {}),
            ...(op.workSeconds !== null && timed && op.workSeconds !== set.planned.durationS ? { durationS: op.workSeconds } : {}),
            ...(op.distanceMetres !== null && (row.measurement === 'cardio' || row.measurement === 'distance') && op.distanceMetres !== (set.planned.distanceM ?? null) ? { distanceM: op.distanceMetres } : {}),
          };
          if (Object.keys(patch).length === 0) continue;
          used.add(set.id);
          any = true;
          steps.push({ type: 'edit_planned_set', at: ids.at, opId: nextOpId(), setId: set.id, expectedSetVersion: set.version, patch });
        }
        if (!any) {
          notes.push(`${row.exerciseName} is already that`);
          break;
        }
        const one = op.setId === null ? undefined : targets[0];
        const which = one === undefined ? '' : ` set ${String(setNumber(now, one))}`;
        if (op.setType !== null && op.setId !== null) parts.push(TYPE_WORD[op.setType]);
        if (op.restSeconds !== null) parts.push(`rest ${clock(op.restSeconds)}`);
        if (op.workSeconds !== null && timed) parts.push(clock(op.workSeconds));
        if (op.distanceMetres !== null && (row.measurement === 'cardio' || row.measurement === 'distance')) parts.push(`${String(Math.round(op.distanceMetres))} m`);
        lines.push({ change: 'edit', text: `${row.exerciseName}${which}: ${parts.join(' · ')}`.slice(0, 200) });
        names.push(row.exerciseName);
        break;
      }
      case 'order_sets': {
        const own = now.sets.filter((x) => x.sessionExerciseId === row.id && x.status !== 'deleted');
        const movable = own.filter((x) => x.status === 'pending' && x.pairedWithSetId === null && !own.some((c) => c.pairedWithSetId === x.id)).sort((a, b) => a.index - b.index);
        const wanted = new Set(op.setIds);
        if (wanted.size !== op.setIds.length || wanted.size !== movable.length || movable.some((x) => !wanted.has(x.id))) {
          notes.push(`list every set of ${row.exerciseName} not done yet to reorder them`);
          break;
        }
        if (movable.every((x, i) => op.setIds[i] === x.id)) {
          notes.push(`${row.exerciseName}’s sets are already in that order`);
          break;
        }
        steps.push({ type: 'reorder_sets', at: ids.at, opId: nextOpId(), sessionExerciseId: row.id, setIds: [...op.setIds], expectedVersion: now.session.version });
        lines.push({ change: 'reorder', text: `${row.exerciseName}: sets reordered`.slice(0, 200) });
        names.push(row.exerciseName);
        break;
      }
      case 'note': {
        const note = op.note === null || op.note.trim() === '' ? null : op.note.trim();
        const set = op.setId === null ? null : now.sets.find((x) => x.id === op.setId && x.sessionExerciseId === row.id && x.status !== 'deleted');
        if (op.setId !== null && (set === null || set === undefined)) {
          notes.push('the coach named a set that isn’t in this exercise');
          break;
        }
        const before = set === null || set === undefined ? (row.note ?? null) : (set.note ?? null);
        if (before === note) {
          notes.push(`${row.exerciseName}’s note is already that`);
          break;
        }
        steps.push({ type: 'set_note', at: ids.at, opId: nextOpId(), target: set === null || set === undefined ? { kind: 'exercise', sessionExerciseId: row.id } : { kind: 'set', setId: set.id }, note, noteBefore: before, expectedVersion: now.session.version });
        lines.push({ change: 'edit', text: `${row.exerciseName}${set === null || set === undefined ? '' : ` set ${String(setNumber(now, set))}`}: ${note === null ? 'note cleared' : `note “${note.length > 60 ? `${note.slice(0, 57)}…` : note}”`}`.slice(0, 200) });
        names.push(row.exerciseName);
        break;
      }
      case 'load_mode': {
        if (row.loadConvention !== 'bodyweight' && row.loadConvention !== 'added') {
          notes.push(`${row.exerciseName} isn’t a bodyweight exercise`);
          break;
        }
        if (row.loadConvention === op.mode) {
          notes.push(`${row.exerciseName} is already ${op.mode === 'added' ? 'with added weight' : 'bodyweight'}`);
          break;
        }
        steps.push({ type: 'set_load_mode', at: ids.at, opId: nextOpId(), sessionExerciseId: row.id, mode: op.mode, expectedVersion: now.session.version });
        lines.push({ change: 'edit', text: `${row.exerciseName}: ${op.mode === 'added' ? '+ weight' : 'bodyweight'}`.slice(0, 200) });
        names.push(row.exerciseName);
        break;
      }
    }
  }
  return { steps, lines, notes, names };
}
