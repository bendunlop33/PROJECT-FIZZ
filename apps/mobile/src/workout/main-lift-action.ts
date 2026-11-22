import { MAIN_LIFT_COPY, mainLiftOffer, workoutMainLifts, type BuilderExerciseInfo } from '@fizz/domain';
import type { SessionAggregate, SessionCommand, ZonedTimestamp } from '@fizz/schemas';

/**
 * (Ben, 1 Nov) The live workout's `Make main lift` (the exercise menu's item after Swap): today first
 * (`set_main_lift`: the plan day's main lift and the workout's name; no set changes), with `Undo`; then the toast's
 * `Every week?` puts it on the plan day's template (`plans.mainLiftEveryWeek`), with its own `Undo`. Each write is
 * versioned with its own op ID (rule 5). Kept out of the screen so the menu edit there stays one item.
 */

/** Whether the menu shows `Make main lift` for the row: `mainLiftOffer` over the workout's main lifts and builder info. */
export function canMakeMain(data: { aggregate: SessionAggregate; mainExerciseIds?: ReadonlySet<string> | undefined; builderInfo?: Readonly<Record<string, BuilderExerciseInfo | null>> | undefined }, sessionExerciseId: string): boolean {
  const row = data.aggregate.exercises.find((e) => e.id === sessionExerciseId);
  const compound = row !== undefined && data.builderInfo?.[row.exerciseId]?.role === 'compound';
  return mainLiftOffer(data.aggregate, sessionExerciseId, workoutMainLifts(data.aggregate, data.mainExerciseIds ?? new Set()), compound).can;
}

export interface MainLiftToast {
  icon?: 'info.circle';
  text: string;
  action?: string;
  onAction?: () => void;
  secondary?: string;
  onSecondary?: () => void;
}

export interface MainLiftActionPorts {
  now: () => ZonedTimestamp;
  newId: () => string;
  dispatch: (command: SessionCommand) => Promise<{ ok: true } | { ok: false; error: { message: string } }>;
  undoOp: (req: { sessionId: string; targetOpId: string }) => Promise<{ ok: boolean; message?: string }>;
  everyWeek: (req: { routineId: string; exerciseId: string; opId: string }) => Promise<{ ok: true; actionId: string } | { ok: false; message: string }>;
  revert: (req: { actionId: string; opId: string }) => Promise<{ ok: boolean; message?: string }>;
  toast: (t: MainLiftToast | null) => void;
  /** A write landed: re-read the workout. */
  changed: () => void;
}

export async function makeMainLiftNow(p: MainLiftActionPorts, a: SessionAggregate, ex: { sessionExerciseId: string; exerciseId: string; exerciseName: string }): Promise<void> {
  const opId = p.newId();
  const r = await p.dispatch({ type: 'set_main_lift', at: p.now(), opId, sessionExerciseId: ex.sessionExerciseId, expectedVersion: a.session.version });
  if (!r.ok) {
    p.toast({ icon: 'info.circle', text: r.error.message });
    return;
  }
  const sessionId = a.session.id;
  const routineId = a.session.planDay?.templateRoutineId ?? null;
  p.toast({
    icon: 'info.circle',
    text: MAIN_LIFT_COPY.made(ex.exerciseName),
    action: MAIN_LIFT_COPY.undo,
    onAction: () => {
      p.toast(null);
      void p.undoOp({ sessionId, targetOpId: opId }).then((u) => {
        p.changed();
        if (!u.ok) p.toast({ icon: 'info.circle', text: u.message ?? MAIN_LIFT_COPY.changed });
      });
    },
    ...(routineId === null
      ? {}
      : {
          secondary: MAIN_LIFT_COPY.everyWeek,
          onSecondary: () => {
            p.toast(null);
            void everyWeek(p, routineId, ex);
          },
        }),
  });
}

async function everyWeek(p: MainLiftActionPorts, routineId: string, ex: { exerciseId: string; exerciseName: string }): Promise<void> {
  const w = await p.everyWeek({ routineId, exerciseId: ex.exerciseId, opId: p.newId() });
  if (!w.ok) {
    p.toast({ icon: 'info.circle', text: w.message });
    return;
  }
  p.changed();
  const actionId = w.actionId;
  p.toast({
    icon: 'info.circle',
    text: MAIN_LIFT_COPY.madeEveryWeek(ex.exerciseName),
    action: MAIN_LIFT_COPY.undo,
    onAction: () => {
      p.toast(null);
      void p.revert({ actionId, opId: p.newId() }).then((u) => {
        p.changed();
        if (!u.ok) p.toast({ icon: 'info.circle', text: u.message ?? MAIN_LIFT_COPY.changed });
      });
    },
  });
}
