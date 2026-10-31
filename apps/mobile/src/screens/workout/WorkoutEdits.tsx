import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ActionSheetIOS, Alert } from 'react-native';

import {
  addWarmupCommand,
  dropRoundCommand,
  jumpRoundCommand,
  moveSetCommand,
  stepRoundCommand,
  stepSetCommand,
  supersetNextCommand,
  supersetPartners,
  type BuilderAdvice,
  type CommandOutcome,
  type GymLearn,
  type HistoryGlanceView,
  type RoundJump,
  type SupersetPartner,
} from '@fizz/domain';
import type { BuilderGroup, SessionAggregate, SessionCommand, SetType } from '@fizz/schemas';

import { adviceToast } from '../../builder/builder-service';
import { newUuid } from '../../device/runtime';
import { haptic } from '../../device/haptics';
import type { ActiveWorkoutData } from '../../services/workout-services';
import type { AppServices } from '../../services/app-services';
import { HistoryGlance } from '../../progress/history-glance';
import { ExercisePopup } from '../../ui/exercise-popup';
import { holdMenu, POPUP_COPY, typeMenu, type PopupSetRow } from '../../ui/exercise-popup-model';
import { SwapSheet } from '../../ui/swap-sheet';
import { SWAP_SHEET_COPY, type ChoiceSection } from '../../ui/swap-sheet-model';
import { useAddOwn } from '../../ui/use-add-own';
import { useExercisePicker, usePickerView } from '../../ui/use-exercise-picker';
import { popupCellWrite, popupRestCommand, POPUP_REFUSAL, removePrompt, sessionPopupView } from '../../workout/exercise-popup';
import type { Round } from '../../workout/rounds';
import { UNDO_TOAST } from '../../workout/undo-op';

/**
 * Same editing as the builder, mid-workout (workout-table-v3 §7): the shared
 * exercise pop-up and Swap / Add sheet on today's session, the round page's
 * set and exercise actions (drag, VoiceOver, long-press menus), and the
 * builder's "not recommended because…" advice on Ben's own changes. Every
 * write is one of the workout's own commands with a fresh opId, versioned on
 * the state it was worked out from (rule 5), today only; a done set changes
 * only through a correction (rule 2). Writes run one at a time, each on the
 * state the one before left, so quick taps never go stale against each other.
 */

export interface EditToast {
  text: string;
  action?: string;
  onAction?: () => void;
  secondary?: string;
  onSecondary?: () => void;
}

export interface WorkoutEditsInput {
  services: AppServices;
  sessionId: string;
  /** The workout this render draws (the pop-up's values). */
  data: ActiveWorkoutData | null;
  /** The workout as the screen has it now (read when a write is worked out, after taps). */
  latest: () => ActiveWorkoutData | null;
  rounds: readonly Round[];
  /** A command through the screen (adopts the result, reloads on a refusal that needs it). */
  run: (command: SessionCommand) => Promise<CommandOutcome>;
  /** A service write's result: the screen adopts it. */
  adopt: (aggregate: SessionAggregate) => void;
  reload: () => Promise<unknown>;
  changed: () => void;
  showToast: (t: EditToast) => void;
  /** `<text> · Undo` (`undo_op` on `opId`). */
  undoToast: (text: string, opId: string) => void;
  /**
   * (Ben, 27 Oct) A load Ben typed off the gym's known kit: the gym learns it (versioned, op ID) and the toast
   * `Main Gym: 27.5 kg added · Undo` undoes the learn and then `undoOpIds` (newest first; his target goes back).
   */
  learnTyped: (learn: GymLearn, undoOpIds: readonly string[]) => void;
  refusalText: (code: string, message: string) => string;
  /** `＋ Set` (the screen's: after a gym switch it goes on today's item). */
  addSet: (sessionExerciseId: string) => void;
  /** Any open cell editor closes (and saves) first. */
  beforeEdit: () => void;
  /** (Ben, 31 Oct) The pop-up's `How to`: the guide for this exercise, or null when it has none. */
  howTo?: (sessionExerciseId: string) => (() => void) | null;
  /**
   * (Ben, 31 Oct) `Not at this gym ›` in the Swap sheet (it left the `⋯`): offered when `can` holds;
   * `mark` tells the gym (with its own Undo toast) and the sheet stays open to pick the swap.
   */
  notHere?: { can: (sessionExerciseId: string) => boolean; mark: (sessionExerciseId: string) => void };
  /** The screen's toast, shown in the pop-up's footer while it's open. */
  toast: ReactNode;
}

type Sheet =
  | { mode: 'swap'; sessionExerciseId: string; name: string; sections: ChoiceSection[]; notHere?: boolean }
  | { mode: 'add'; sections: ChoiceSection[] }
  /** (Ben, 26 Oct; review 26 Oct #2) `Superset with…`: the exercises in the workout it can pair with first, then everything. */
  | { mode: 'superset'; sessionExerciseId: string; name: string; sections: ChoiceSection[]; partners: SupersetPartner[] };
/** Which row the sheet is for (kept across `＋ Add your own`). */
type SheetFor = { mode: 'swap'; sessionExerciseId: string } | { mode: 'add' } | { mode: 'superset'; sessionExerciseId: string };
const sheetFor = (s: Sheet): SheetFor => (s.mode === 'add' ? { mode: 'add' } : { mode: s.mode, sessionExerciseId: s.sessionExerciseId });

export function useWorkoutEdits(p: WorkoutEditsInput) {
  const [popupFor, setPopupFor] = useState<string | null>(null);
  const [sheet, setSheet] = useState<Sheet | null>(null);
  /** (Ben, 31 Oct) The swap sheet's `Not at this gym ›` was tapped since it opened: the row goes (its toast has Undo). */
  const [markedHere, setMarkedHere] = useState(false);
  const picker = useExercisePicker();
  // (Ben, 26 Oct) The pop-up's read-only History: read once when it opens on an exercise (stored history, local).
  const [glance, setGlance] = useState<{ for: string; view: HistoryGlanceView | null } | null>(null);
  useEffect(() => {
    if (popupFor === null) return;
    let live = true;
    void p.services.workout
      .exerciseGlance(p.sessionId, popupFor)
      .catch(() => null)
      .then((view) => {
        if (live) setGlance({ for: popupFor, view });
      });
    return () => {
      live = false;
    };
  }, [p.services, p.sessionId, popupFor]);
  const own = useRef<SessionAggregate | null>(null);
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const latest = useRef(p);
  latest.current = p;

  /** The newest state: the screen's, or a write's that the screen hasn't drawn yet. */
  const current = (): SessionAggregate | null => {
    const a = latest.current.latest()?.aggregate ?? null;
    const o = own.current;
    if (o !== null && a !== null && o.session.id === a.session.id && o.session.version > a.session.version) return o;
    return a;
  };

  function inTurn<T>(run: () => Promise<T>): Promise<T> {
    const out = queue.current.then(run, run);
    queue.current = out.catch(() => undefined);
    return out;
  }

  async function send(command: SessionCommand): Promise<CommandOutcome> {
    const r = await latest.current.run(command);
    if (r.ok) own.current = r.aggregate;
    return r;
  }

  const refused = (r: Extract<CommandOutcome, { ok: false }>): void => {
    latest.current.showToast({ text: latest.current.refusalText(r.error.code, r.error.message) });
  };

  /**
   * Ben's own change (§7): the builder's "not recommended because…" when it newly made something
   * the builder advises against, with Undo and `Why?`; else the plain `<text> · Undo`. Never blocks.
   */
  async function afterChange(before: SessionAggregate, after: SessionAggregate, text: string, opId: string): Promise<void> {
    const advice: BuilderAdvice | null = await latest.current.services.workoutEdit.advice(before, after).catch(() => null);
    if (advice === null) {
      latest.current.undoToast(text, opId);
      return;
    }
    const a = adviceToast(advice);
    const undo = () => {
      void latest.current.services.workout.undoOp({ sessionId: latest.current.sessionId, targetOpId: opId }).then((u) => {
        latest.current.changed();
        void latest.current.reload();
        if (u.ok) haptic('undo');
        else latest.current.showToast({ text: u.message });
      });
    };
    latest.current.showToast({ text: a.text, action: 'Undo', onAction: undo, secondary: 'Why?', onSecondary: () => { latest.current.showToast({ text: a.why, action: 'Undo', onAction: undo }); } });
  }

  /** One command worked out from the state now (null: nothing to send), then its toast. */
  function edit<C extends SessionCommand>(make: (a: SessionAggregate, opId: string) => C | null, toast: ((after: SessionAggregate, command: C) => string) | null, opts: { advise?: boolean } = {}): Promise<boolean> {
    return inTurn(async () => {
      latest.current.beforeEdit();
      const before = current();
      if (before === null) return false;
      const opId = newUuid();
      const command = make(before, opId);
      if (command === null) return false;
      const r = await send(command);
      if (!r.ok) {
        refused(r);
        return false;
      }
      haptic('step');
      if (toast !== null) {
        if (opts.advise === true) await afterChange(before, r.aggregate, toast(r.aggregate, command), opId);
        else latest.current.undoToast(toast(r.aggregate, command), opId);
      }
      return true;
    });
  }

  const at = () => latest.current.services.now();
  const nameOf = (a: SessionAggregate, sessionExerciseId: string): string => a.exercises.find((e) => e.id === sessionExerciseId)?.exerciseName ?? 'Exercise';
  const stepNameOf = (setId: string): string => latest.current.rounds.flatMap((r) => r.exercises.flatMap((e) => e.rows)).find((r) => r.setId === setId)?.stepName ?? 'Set';

  // ---- Exercises -----------------------------------------------------------

  const moveRound = (sessionExerciseId: string, dir: 'up' | 'down') =>
    edit(
      (a, opId) => {
        const m = stepRoundCommand(a, sessionExerciseId, dir, { opId, at: at() });
        return m.ok ? m.command : null;
      },
      (after) => `${nameOf(after, sessionExerciseId)} moved`,
      { advise: true },
    );

  const supersetNext = (sessionExerciseId: string) =>
    edit(
      (a, opId) => supersetNextCommand(a, sessionExerciseId, { opId, at: at() }),
      (after, c) => UNDO_TOAST.supersetted(nameOf(after, c.withSessionExerciseId), nameOf(after, c.sessionExerciseId)),
      { advise: true },
    );

  /**
   * (Ben, 31 Oct) `Do next` / `Move to end`: the round (a superset as one) straight after the current one, or
   * last; today's remaining rounds only (`jumpRoundCommand`), with Undo. Refused: nothing is sent.
   */
  const jumpRound = (sessionExerciseId: string, jump: RoundJump) =>
    edit(
      (a, opId) => {
        const m = jumpRoundCommand(a, sessionExerciseId, jump, { opId, at: at() });
        return m.ok ? m.command : null;
      },
      (after) => (jump === 'do_next' ? UNDO_TOAST.doNext(nameOf(after, sessionExerciseId)) : UNDO_TOAST.movedToEnd(nameOf(after, sessionExerciseId))),
      { advise: true },
    );

  /** `Unlink` (§7): mid-round the round finishes first (the partner stays current), the rest go one by one. */
  const unlink = (sessionExerciseId: string) => edit((a, opId) => ({ type: 'split_superset', at: at(), opId, expectedVersion: a.session.version, sessionExerciseId }), () => UNDO_TOAST.supersetRemoved);

  /** The Workout sheet's drag (§7): an edge moves a round not started; the middle pairs. */
  const dropRound = (fromRowId: string, targetRowId: string, edge: 'before' | 'after' | 'onto') =>
    edit(
      (a, opId) => dropRoundCommand(a, fromRowId, targetRowId, edge, { opId, at: at() }),
      (after, c) => (c.type === 'link_superset' ? UNDO_TOAST.supersetted(nameOf(after, c.withSessionExerciseId), nameOf(after, c.sessionExerciseId)) : `${nameOf(after, fromRowId)} moved`),
      { advise: true },
    );

  /** Exactly this command, then its toast (a refusal shows why; nothing is worked out again). */
  function sendAsIs(command: SessionCommand & { opId: string }, text: string): Promise<boolean> {
    return inTurn(async () => {
      latest.current.beforeEdit();
      const r = await send(command);
      if (!r.ok) {
        refused(r);
        void latest.current.reload();
        return false;
      }
      haptic('step');
      if (!r.duplicate) latest.current.undoToast(text, command.opId);
      return true;
    });
  }

  /**
   * `Remove` (§7): with logged sets Ben is asked first, and they stay in history; Undo either way.
   * The command is built when he taps Remove, and the confirmation sends exactly that one: if the
   * workout moved on while the dialog was open, it's refused as stale (rule 5, review B2/S3).
   */
  function remove(sessionExerciseId: string) {
    const a = current();
    if (a === null) return;
    const prompt = removePrompt(a, sessionExerciseId, { opId: newUuid(), at: at() });
    if (prompt === null) {
      latest.current.showToast({ text: 'Nothing left to remove' });
      return;
    }
    if (prompt.kind === 'now') {
      // Nothing to confirm: worked out in turn, on the state the writes before it left.
      void edit((now, opId) => {
        const p = removePrompt(now, sessionExerciseId, { opId, at: at() });
        return p?.kind === 'now' ? p.command : null;
      }, () => UNDO_TOAST.removed(prompt.name));
      return;
    }
    Alert.alert(prompt.title, prompt.message, [
      { text: POPUP_COPY.cancel, style: 'cancel' },
      { text: POPUP_COPY.remove, style: 'destructive', onPress: () => void sendAsIs(prompt.command, UNDO_TOAST.removed(prompt.name)) },
    ]);
  }

  // ---- Swap / Add (the builder's sheet) -------------------------------------

  /**
   * (Ben, 25 Oct) The suggestions for a group (the chip; none: the exercise's own), and on a fresh open the full
   * list (every exercise, read once; search and chips are pure over it). Today only, as before.
   */
  async function openSheet(to: SheetFor, opts: { group?: BuilderGroup; fresh: boolean; query?: string }) {
    const a = current();
    if (a === null) return;
    // Swap keeps the swapped exercise's kind; Add and `Superset with…` take anything.
    const sessionExerciseId = to.mode === 'swap' ? to.sessionExerciseId : null;
    if (opts.fresh) {
      picker.open(() => latest.current.services.exercisePicker.forSession(latest.current.sessionId, sessionExerciseId), opts.query ?? '');
      setMarkedHere(false);
    }
    const c = await latest.current.services.workoutEdit.choices(latest.current.sessionId, opts.group === undefined ? { sessionExerciseId } : { sessionExerciseId, group: opts.group }).catch(() => null);
    const sections = c?.sections ?? [];
    if (to.mode === 'swap') setSheet({ mode: 'swap', sessionExerciseId: to.sessionExerciseId, name: nameOf(a, to.sessionExerciseId), sections });
    else if (to.mode === 'superset') setSheet({ mode: 'superset', sessionExerciseId: to.sessionExerciseId, name: nameOf(a, to.sessionExerciseId), sections, partners: supersetPartners(current() ?? a, to.sessionExerciseId) });
    else setSheet({ mode: 'add', sections });
  }

  const openSwap = (sessionExerciseId: string) => openSheet({ mode: 'swap', sessionExerciseId }, { fresh: true });
  const openAdd = () => openSheet({ mode: 'add' }, { fresh: true });
  const openSupersetWith = (sessionExerciseId: string) => openSheet({ mode: 'superset', sessionExerciseId }, { fresh: true });

  /** `Superset with…` an exercise already in the workout: `link_superset` on the state now (rule 5), with Undo. */
  function linkPartner(s: Extract<Sheet, { mode: 'superset' }>, partner: SupersetPartner) {
    closeSheet();
    void inTurn(async () => {
      latest.current.beforeEdit();
      const before = current();
      if (before === null) return;
      const opId = newUuid();
      const r = await latest.current.services.workout.linkSuperset({ sessionId: latest.current.sessionId, sessionExerciseId: s.sessionExerciseId, withSessionExerciseId: partner.sessionExerciseId, expectedVersion: before.session.version, opId });
      if (!r.ok) {
        refused(r);
        void latest.current.reload();
        return;
      }
      own.current = r.aggregate;
      latest.current.adopt(r.aggregate);
      latest.current.changed();
      haptic('step');
      latest.current.undoToast(UNDO_TOAST.supersetted(s.name, partner.exerciseName), opId);
    });
  }
  const addOwn = useAddOwn<SheetFor>((to, name) => void openSheet(to, { fresh: true, query: name }));

  function closeSheet() {
    setSheet(null);
    picker.close();
  }

  function pick(exerciseId: string) {
    const s = sheet;
    if (s === null) return;
    closeSheet();
    void inTurn(async () => {
      latest.current.beforeEdit();
      const before = current();
      if (before === null) return;
      const opId = newUuid();
      const r =
        s.mode === 'swap'
          ? await latest.current.services.workoutEdit.swap(latest.current.sessionId, s.sessionExerciseId, exerciseId, opId)
          : await latest.current.services.workoutEdit.add(latest.current.sessionId, exerciseId, opId, s.mode === 'superset' ? { supersetWith: s.sessionExerciseId } : {});
      if (!r.ok) {
        refused(r);
        void latest.current.reload();
        return;
      }
      own.current = r.aggregate;
      latest.current.adopt(r.aggregate);
      latest.current.changed();
      haptic('step');
      const name = ('toName' in r && typeof r.toName === 'string' ? r.toName : undefined) ?? r.aggregate.exercises.find((e) => e.exerciseId === exerciseId && e.removed === undefined)?.exerciseName ?? 'Exercise';
      const text = s.mode === 'swap' ? UNDO_TOAST.swapped(s.name, name) : s.mode === 'superset' ? UNDO_TOAST.supersetted(s.name, name) : `${name} added`;
      await afterChange(before, r.aggregate, text, opId);
      // `Last` lines are per exercise: read the new row's history.
      void latest.current.reload();
    });
  }

  // ---- Sets ---------------------------------------------------------------

  /** A set row dragged to `to` among the sets not done yet (§7). */
  const dropSet = (setId: string, to: number) => edit((a, opId) => moveSetCommand(a, setId, to, { opId, at: at() }), () => `${stepNameOf(setId)} moved`);
  const stepSet = (setId: string, dir: 'up' | 'down') => edit((a, opId) => stepSetCommand(a, setId, dir, { opId, at: at() }), () => `${stepNameOf(setId)} moved`);

  /**
   * A set's type (§7): a logged one is a correction (its label and counting; the logged numbers
   * stay, rule 2), one not done yet changes its target type. Both with Undo.
   */
  function setType(setId: string, type: SetType): Promise<string | null> {
    return inTurn(async () => {
      latest.current.beforeEdit();
      const a = current();
      const set = a?.sets.find((s) => s.id === setId);
      if (a === null || set === undefined) return POPUP_REFUSAL.changed;
      const opId = newUuid();
      if (set.status === 'completed') {
        const r = await latest.current.services.workout.correctSet({ sessionId: latest.current.sessionId, setId, expectedSetVersion: set.version, patch: { setType: type }, opId });
        if (!r.ok) {
          void latest.current.reload();
          return r.message;
        }
        own.current = r.aggregate;
        latest.current.adopt(r.aggregate);
        latest.current.changed();
        if (!r.duplicate) latest.current.undoToast(UNDO_TOAST.correctedNamed(stepNameOf(setId)), opId);
        return null;
      }
      const r = await send({ type: 'edit_planned_set', at: at(), opId, setId, expectedSetVersion: set.version, patch: { setType: type } });
      if (!r.ok) return latest.current.refusalText(r.error.code, r.error.message);
      if (!r.duplicate) latest.current.undoToast(UNDO_TOAST.correctedNamed(stepNameOf(setId)), opId);
      return null;
    });
  }

  function pickType(setId: string) {
    const set = current()?.sets.find((s) => s.id === setId);
    if (set === undefined) return;
    const m = typeMenu(set.setType);
    ActionSheetIOS.showActionSheetWithOptions({ title: POPUP_COPY.type, options: m.options, cancelButtonIndex: m.cancelButtonIndex }, (i) => {
      const t = m.typeAt(i);
      if (t !== null) void setType(setId, t).then((note) => { if (note !== null) latest.current.showToast({ text: note }); });
    });
  }

  function deleteSet(setId: string) {
    const name = stepNameOf(setId);
    void edit((a, opId) => {
      const set = a.sets.find((s) => s.id === setId);
      return set === undefined ? null : { type: 'delete_set', at: at(), opId, setId, expectedSetVersion: set.version };
    }, () => UNDO_TOAST.deletedNamed(name));
  }

  /** A set row held without a drag (the fallback): its menu, as VoiceOver has it. */
  function setMenu(setId: string, extra: { label: string; run: () => void }[] = []) {
    const a = current();
    const set = a?.sets.find((s) => s.id === setId);
    if (a === null || set === undefined) return;
    const moves = stepSetCommand(a, setId, 'up', { opId: 'probe', at: at() }) !== null;
    const downs = stepSetCommand(a, setId, 'down', { opId: 'probe', at: at() }) !== null;
    const actions = [
      ...extra.map((x, i) => ({ name: `extra:${String(i)}`, label: x.label })),
      { name: 'type', label: POPUP_COPY.changeType },
      ...(moves ? [{ name: 'move_up', label: POPUP_COPY.moveUp }] : []),
      ...(downs ? [{ name: 'move_down', label: POPUP_COPY.moveDown }] : []),
      { name: 'delete_set', label: POPUP_COPY.deleteSet },
    ];
    const m = holdMenu(actions);
    ActionSheetIOS.showActionSheetWithOptions({ title: stepNameOf(setId), options: m.options, cancelButtonIndex: m.cancelButtonIndex, destructiveButtonIndex: m.destructiveButtonIndex }, (i) => {
      const name = m.actionAt(i);
      if (name === null) return;
      if (name.startsWith('extra:')) extra[Number(name.slice(6))]?.run();
      else if (name === 'type') pickType(setId);
      else if (name === 'move_up' || name === 'move_down') void stepSet(setId, name === 'move_up' ? 'up' : 'down');
      else deleteSet(setId);
    });
  }

  // ---- The pop-up -----------------------------------------------------------

  const data = p.data;
  // (Ben, 31 Oct) `How to` left the round page's `⋯`: the pop-up links the guide.
  const howTo = popupFor === null ? null : (p.howTo?.(popupFor) ?? null);
  const popupExercise = popupFor === null ? undefined : p.rounds.flatMap((r) => r.exercises).find((e) => e.sessionExerciseId === popupFor);
  const view =
    data === null || popupExercise === undefined
      ? null
      : sessionPopupView({ aggregate: data.aggregate, exercise: popupExercise, works: data.worksLines?.[popupExercise.exerciseId] ?? null, mayHurt: data.painFlagged.has(popupExercise.exerciseId), painFlagged: data.painFlagged });

  async function editCell(row: PopupSetRow, field: 'reps' | 'kg' | 'rpe', value: number): Promise<string | null> {
    return inTurn(async () => {
      latest.current.beforeEdit();
      const a = current();
      if (a === null) return POPUP_REFUSAL.changed;
      const w = popupCellWrite(a, row.key, field, value, latest.current.latest()?.bodyweightExercises, latest.current.latest()?.painFlagged);
      const opId = newUuid();
      switch (w.kind) {
        case 'refused':
          return w.text;
        case 'unchanged':
          return w.note;
        case 'correct': {
          const r = await latest.current.services.workout.correctSet({ sessionId: latest.current.sessionId, setId: w.setId, expectedSetVersion: w.expectedSetVersion, patch: w.patch, opId });
          if (!r.ok) {
            void latest.current.reload();
            return r.message;
          }
          own.current = r.aggregate;
          latest.current.adopt(r.aggregate);
          latest.current.changed();
          if (!r.duplicate) latest.current.undoToast(UNDO_TOAST.correctedNamed(row.spokenName), opId);
          return null;
        }
        case 'planned': {
          const r = await send({ type: 'edit_planned_set', at: at(), opId, setId: w.setId, expectedSetVersion: w.expectedSetVersion, patch: w.patch });
          if (!r.ok) return latest.current.refusalText(r.error.code, r.error.message);
          // (Ben, 27 Oct) Kept as typed; off the known kit the gym learns it (`Main Gym: 27.5 kg added · Undo`).
          if (!r.duplicate && w.learn != null) latest.current.learnTyped(w.learn, [opId]);
          // `Set 3 updated · Undo`, as the round page's own target edits (review S4).
          else if (!r.duplicate) latest.current.undoToast(UNDO_TOAST.correctedNamed(row.spokenName), opId);
          return w.note;
        }
        case 'add_weight': {
          // (Ben, 27 Oct) kg on a bodyweight exercise: `+ Weight` for today, then this target as typed; one Undo for both.
          const modeOp = newUuid();
          const m = await send({ type: 'set_load_mode', at: at(), opId: modeOp, expectedVersion: a.session.version, sessionExerciseId: w.sessionExerciseId, mode: 'added' });
          if (!m.ok) return latest.current.refusalText(m.error.code, m.error.message);
          const set = m.aggregate.sets.find((x) => x.id === w.setId);
          if (set === undefined) return POPUP_REFUSAL.changed;
          const r = await send({ type: 'edit_planned_set', at: at(), opId, setId: w.setId, expectedSetVersion: set.version, patch: { load: w.load, loadAsTyped: true } });
          if (!r.ok) return latest.current.refusalText(r.error.code, r.error.message);
          const undo = () => {
            void (async () => {
              for (const target of [opId, modeOp]) {
                const u = await latest.current.services.workout.undoOp({ sessionId: latest.current.sessionId, targetOpId: target });
                if (!u.ok) {
                  latest.current.showToast({ text: u.message });
                  break;
                }
              }
              latest.current.changed();
              void latest.current.reload();
              haptic('undo');
            })();
          };
          latest.current.showToast({ text: `${row.spokenName}: +${String(w.load.value)} ${w.load.unit}`, action: 'Undo', onAction: undo });
          return null;
        }
      }
    });
  }

  const liveIds = (current()?.exercises ?? []).filter((e) => e.removed === undefined).map((e) => e.exerciseId);
  const pickerView = usePickerView(picker, liveIds, (sheet?.sections ?? []).flatMap((x) => x.items.map((i) => i.exerciseId)));

  const node = (
    <>
      <ExercisePopup
        view={view}
        resetKey={popupFor}
        onEditCell={editCell}
        onType={(row, type) => setType(row.key, type)}
        onDeleteRow={(row) => {
          deleteSet(row.key);
        }}
        onMoveRow={(row, dir) => void stepSet(row.key, dir)}
        onAddWarmup={() =>
          inTurn(async () => {
            latest.current.beforeEdit();
            const a = current();
            if (a === null || popupFor === null) return POPUP_REFUSAL.changed;
            const opId = newUuid();
            const c = addWarmupCommand(a, popupFor, { opId, at: at(), newSetId: newUuid(), warmupRestS: p.latest()?.restDefaultsS?.warmup });
            if (!c.ok) return POPUP_REFUSAL[c.reason];
            const r = await send(c.command);
            if (!r.ok) return latest.current.refusalText(r.error.code, r.error.message);
            latest.current.undoToast(UNDO_TOAST.addedNamed('Warm-up'), opId);
            return null;
          })
        }
        onAddSet={() => {
          if (popupFor !== null) latest.current.addSet(popupFor);
        }}
        onRestStep={(rest, dir) => {
          const id = popupFor;
          if (id === null) return;
          // No toast per 15 s step (the stepper repeats while held, and its −/+ is its own reverse; the value
          // is on screen). Decision for review S4: `set_rest_after` has no `undo_op`; today only, never a done set.
          void edit((a, opId) => popupRestCommand(a, id, { kind: rest.kind, seconds: currentRest(a, id, rest.kind) ?? rest.seconds }, dir, { opId, at: at() }), null);
        }}
        onMove={(dir) => {
          if (popupFor !== null) void moveRound(popupFor, dir);
        }}
        onSupersetNext={() => {
          if (popupFor !== null) void supersetNext(popupFor);
        }}
        onUnlink={() => {
          if (popupFor !== null) void unlink(popupFor);
        }}
        onSwap={() => {
          const id = popupFor;
          setPopupFor(null);
          if (id !== null) void openSwap(id);
        }}
        onHowTo={howTo ?? undefined}
        onDelete={() => {
          const id = popupFor;
          setPopupFor(null);
          if (id !== null) remove(id);
        }}
        onClose={() => {
          setPopupFor(null);
        }}
        why={() => (popupFor === null ? Promise.resolve([]) : latest.current.services.workoutEdit.why(latest.current.sessionId, popupFor))}
        kgStep={async (row, value, dir) => {
          const a = current();
          const set = a?.sets.find((s) => s.id === row.key);
          const ex = set === undefined ? undefined : a?.exercises.find((e) => e.id === set.sessionExerciseId);
          if (ex === undefined) return null;
          const k = await latest.current.services.overview.loadKeypad({ equipmentId: ex.equipmentId, unit: ex.unit, convention: ex.loadConvention, value }).catch(() => null);
          const t = k === null ? null : dir === 1 ? k.up : k.down;
          return t !== null && t.enabled ? t.value : null;
        }}
        history={glance !== null && glance.for === popupFor ? <HistoryGlance view={glance.view} /> : null}
        toast={p.toast}
      />
      <SwapSheet
        visible={sheet !== null}
        title={sheet === null ? '' : sheet.mode === 'swap' ? `Swap ${sheet.name}` : sheet.mode === 'superset' ? `Superset with ${sheet.name}` : 'Add exercise'}
        sections={sheet?.sections ?? []}
        actionWord={sheet?.mode === 'swap' ? 'Swap' : 'Add'}
        partners={
          sheet?.mode === 'superset'
            ? {
                title: 'In this workout',
                rows: sheet.partners.map((x) => ({
                  key: x.sessionExerciseId,
                  name: x.exerciseName,
                  line: x.detail,
                  onPress: () => {
                    linkPartner(sheet, x);
                  },
                })),
              }
            : null
        }
        notHere={
          sheet?.mode === 'swap' && !markedHere && p.notHere?.can(sheet.sessionExerciseId) === true
            ? {
                label: SWAP_SHEET_COPY.notHere,
                onPress: () => {
                  setMarkedHere(true);
                  latest.current.notHere?.mark(sheet.sessionExerciseId);
                },
              }
            : null
        }
        toast={p.toast}
        onPick={pick}
        onClose={closeSheet}
        onDismissed={addOwn.onDismissed}
        picker={{
          view: pickerView,
          query: picker.query,
          onQuery: picker.setQuery,
          index: picker.index,
          equipment: picker.equipment,
          onEquipment: picker.setEquipment,
          onChip: (g) => {
            picker.setGroup(g);
            if (sheet !== null) void openSheet(sheetFor(sheet), g === null ? { fresh: false } : { group: g, fresh: false });
          },
          onAddOwn: (name) => {
            if (sheet === null) return;
            addOwn.start(sheetFor(sheet), name);
            closeSheet();
          },
        }}
      />
    </>
  );

  return {
    node,
    open: (sessionExerciseId: string) => {
      latest.current.beforeEdit();
      setPopupFor(sessionExerciseId);
    },
    openSwap: (sessionExerciseId: string) => void openSwap(sessionExerciseId),
    openAdd: () => void openAdd(),
    /** (Review 26 Oct #2) `Superset with…` on the shared sheet: partners first, then every exercise. */
    openSupersetWith: (sessionExerciseId: string) => void openSupersetWith(sessionExerciseId),
    moveRound: (sessionExerciseId: string, dir: 'up' | 'down') => void moveRound(sessionExerciseId, dir),
    jumpRound: (sessionExerciseId: string, jump: RoundJump) => void jumpRound(sessionExerciseId, jump),
    supersetNext: (sessionExerciseId: string) => void supersetNext(sessionExerciseId),
    unlink: (sessionExerciseId: string) => void unlink(sessionExerciseId),
    remove,
    dropRound: (from: string, target: string, edge: 'before' | 'after' | 'onto') => void dropRound(from, target, edge),
    dropSet: (setId: string, to: number) => void dropSet(setId, to),
    stepSet: (setId: string, dir: 'up' | 'down') => void stepSet(setId, dir),
    pickType,
    deleteSet,
    setMenu,
  };
}

/** The rest a pop-up row shows, read again from the state now (quick taps add up). */
function currentRest(a: SessionAggregate, sessionExerciseId: string, kind: string): number | null {
  if (kind === 'round') {
    const ex = a.exercises.find((e) => e.id === sessionExerciseId);
    const members = ex?.supersetGroup == null ? [] : a.exercises.filter((e) => e.supersetGroup === ex.supersetGroup && e.removed === undefined).sort((x, y) => x.order - y.order);
    const last = members.at(-1);
    return last === undefined ? null : (a.sets.filter((s) => s.sessionExerciseId === last.id && s.status === 'pending').sort((x, y) => x.index - y.index)[0]?.rest.seconds ?? null);
  }
  return a.sets.filter((s) => s.sessionExerciseId === sessionExerciseId && s.status === 'pending' && s.setType === kind).sort((x, y) => x.index - y.index)[0]?.rest.seconds ?? null;
}
