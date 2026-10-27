import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AccessibilityInfo, ActionSheetIOS, Alert, Pressable, ScrollView, Switch, View } from 'react-native';
import type { ReactNode } from 'react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { dropRoutineSlot, fitNoteOf, formatDuration, gymLearnToast, type GymEdit, mergeRoutineEdits, routineEditDirty, routineIssues, slotShapeOf, type BuilderFitStep, type RoutineConflict, type RoutineEdit } from '@fizz/domain';
import type { BuilderGroup, Routine, RoutineExercise, SetType } from '@fizz/schemas';

import type { ExerciseChoices, TemplateFact } from '../../builder/builder-service';
import { editorDrafts } from '../../device/editor-drafts';
import { newUuid } from '../../device/runtime';
import { bundledHowToSources, howToRouteFor } from '../../guide/how-to';
import { backFromEditor, popToFromEditor } from '../../navigation/actions';
import type { RootStackParams } from '../../navigation/types';
import type { EditorExerciseInfo, RoutineEditorData } from '../../services/workout-services';
import { useDataChanged, useServices } from '../../shell/context';
import { useTheme } from '../../theme';
import { AppText, BottomCard, Chip, ChipRow, DangerTextButton, EffortSheet, PrimaryButton, ShapeRepsSheet, StatusLine, TextButton, TextField, Toast, ToastHost } from '../../ui';
import { ExercisePopup } from '../../ui/exercise-popup';
import { TimeDetailSheet, TimeNoteRow } from '../../ui/time-stepper';
import { EDITOR_DRAFT_COPY, editorDraftKey, editorDraftToOffer, type EditorDraft } from '../../workout/editor-draft';
import { SwapSheet } from '../../ui/swap-sheet';
import { useAddOwn } from '../../ui/use-add-own';
import { useExercisePicker, usePickerView } from '../../ui/use-exercise-picker';
import { Divider, Table, ValueRow } from '../../ui/table-parts';
import { conflictLines, conflictText, EDITOR_COPY, editorPrimary, restChoices } from '../../workout/library-view';
import { handOffLibraryToast } from '../../workout/library-toast';
import { settleSaveEdit } from '../../workout/save-edit-handoff';
import { slotRepsDraft, SET_SHAPE_COPY } from '../../workout/set-shape-view';
import {
  applyTemplateEdit,
  editableOf,
  editorTimeView,
  openTemplate,
  parseClock,
  parseMetres,
  parseRepRange,
  saveTemplate,
  templateKgStep,
  templatePopupView,
  templateTableView,
  templateTarget,
  TEMPLATE_COPY,
  type TemplateEditOp,
  type TemplateEditorCtx,
  type TemplateOptionsView,
} from '../../workout/template-editor';
import { WorkoutTable, type WorkoutRowAction } from './WorkoutTable';

type Stale = { current: Routine; lines: string[]; changedAtUtc: string };
type Swap = { slotId: string | null; choices: ExerciseChoices };

/**
 * The one workout editor (Ben, 23 Oct: "Why does the plan builder's workout builder look so different to the usual
 * workout builder?"): a saved workout, a plan day's template, `New workout`, `Duplicate`, and `Save to Workouts ›
 * Edit ›` / Exercise detail's `New workout`, on Your workout's page (workout-builder-v3 §2.3; routines.md §A2.3):
 * the name where the title is, `Time`, the same table and pop-up, swipe Delete / Swap, drag, `＋ Add exercise`.
 * Nothing is written until `Save` (one version, opId, expectedVersion; rule 5), then `Saved Push A · Undo` where it
 * was opened from; a newer version is never overwritten (the conflict sheet). A plan day's change is to its
 * template for the weeks ahead; workouts already done never change (rule 2). (Ben, 26 Oct) Unsaved edits are kept on
 * the phone as he makes them (`editor-draft.ts`): after a force-close, reopening asks `Resume edits` / `Discard`; the
 * Save is still the one versioned write against the version they started from. `Time ±` fits the sets and rests to
 * the length (the service's fitTemplate), as edits he saves or Undoes. Local only, offline (rule 1). Loads are `Auto` or Ben's Fixed ones, rounded to this gym (rule 4).
 */
export function EditWorkoutScreen() {
  const theme = useTheme();
  const services = useServices();
  const changed = useDataChanged();
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const params = useRoute<RouteProp<RootStackParams, 'WorkoutEditor'>>().params;
  const { routineId, from, selectName, copyToast, draft, saveAs } = params;
  const target = useMemo(() => templateTarget({ routineId, copyToast, saveAs }), [routineId, copyToast, saveAs]);
  const [data, setData] = useState<RoutineEditorData | null | 'loading'>('loading');
  const [name, setName] = useState('');
  const [list, setListState] = useState<RoutineExercise[]>([]);
  const listRef = useRef<RoutineExercise[]>([]);
  const setList = useCallback((l: RoutineExercise[]) => {
    listRef.current = l;
    setListState(l);
  }, []);
  const [info, setInfo] = useState<Record<string, EditorExerciseInfo>>({});
  const [facts, setFacts] = useState<Record<string, TemplateFact>>({});
  const [minutes, setMinutes] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stale, setStale] = useState<Stale | null>(null);
  const [picks, setPicks] = useState<Record<string, 'mine' | 'theirs'>>({});
  const [popup, setPopup] = useState<string | null>(null);
  const [swap, setSwap] = useState<Swap | null>(null);
  // (Ben, 25 Oct) Swap / Add's full list: every exercise at the editor's gym, read once per open; search and chips are pure over it.
  const picker = useExercisePicker();
  const pickerView = usePickerView(
    picker,
    list.map((e) => e.exerciseId),
    (swap?.choices.sections ?? []).flatMap((x) => x.items.map((i) => i.exerciseId)),
  );
  const openSwapRef = useRef<(slotId: string | null, opts?: { group?: BuilderGroup; fresh?: boolean; query?: string }) => void>(() => undefined);
  const addOwn = useAddOwn<string | null>((slotId, name) => {
    openSwapRef.current(slotId, { query: name });
  });
  const [shapeSheet, setShapeSheet] = useState<{ slotId: string; kind: 'reps' | 'effort' } | null>(null);
  const [dragging, setDragging] = useState(false);
  const [toast, setToast] = useState<{ text: string; before: RoutineExercise[] | null; length?: number | null; /** (Ben, 27 Oct) The gym learned a typed kg: Undo takes it back too. */ gymEdit?: GymEdit } | null>(null);
  const [screenReader, setScreenReader] = useState(false);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const opId = useRef(newUuid());
  // The workout as opened (or as last merged on a conflict): what `dirty` and Keep both compare against.
  const base = useRef<RoutineEdit>({ name: '', exercises: [] });
  // The version Save expects: the one opened, or the one resumed edits started from (rule 5).
  const expected = useRef<number | null>(null);
  // (Ben, 26 Oct) Unsaved edits kept on the phone; autosave waits until the resume question is answered.
  const draftKey = editorDraftKey(target);
  const [draftReady, setDraftReady] = useState(draftKey === null);
  // (Ben, 26 Oct) `Time ±`: the list before the first step (Undo), its estimate and length then, and what the fit changed.
  const [fit, setFit] = useState<{ before: RoutineExercise[]; fromMinutes: number | null; fromLength: number | null; steps: BuilderFitStep[] } | null>(null);
  // (Ben, 27 Oct) The length the workout is held to: the plan day's, then the one `Time ±` last fitted to. Ben's own
  // edits never cut to hold it; the number shown is always the live estimate (`editorTimeView`), past it in the warning tone.
  const [timeLength, setTimeLength] = useState<number | null>(null);
  const fitBusy = useRef(false);
  const [timeDetail, setTimeDetail] = useState(false);

  const load = useCallback(() => {
    setData('loading');
    void openTemplate(services, { routineId, draft, saveAs }).then((o) => {
      if (o === null) {
        setData(null);
        return;
      }
      base.current = o.base;
      expected.current = o.data.routine?.version ?? null;
      setName(o.name);
      setList(o.list);
      setInfo(o.info);
      setFacts(o.facts);
      setFit(null);
      setTimeLength(o.data.planMinutes ?? o.data.routine?.planDay?.minutes ?? null);
      setData(o.data);
      if (draftKey === null) return;
      // A kept draft from before a force-close: offered back once, never applied without Ben's answer.
      void editorDrafts()
        .get(draftKey)
        .catch(() => null)
        .then((kept) => {
          const offer = editorDraftToOffer(kept, { name: o.name, exercises: o.list });
          if (offer === null) {
            setDraftReady(true);
            return;
          }
          Alert.alert(EDITOR_DRAFT_COPY.title, undefined, [
            {
              text: EDITOR_DRAFT_COPY.discard,
              style: 'destructive',
              onPress: () => {
                void editorDrafts().remove(draftKey).catch(() => undefined);
                setDraftReady(true);
              },
            },
            {
              text: EDITOR_DRAFT_COPY.resume,
              onPress: () => {
                void resumeDraft(offer, o.data.gym?.id ?? null).finally(() => {
                  setDraftReady(true);
                });
              },
            },
          ]);
        });
    });
  }, [services, routineId, draft, saveAs, setList, draftKey]);
  useEffect(load, [load]);

  /** `Resume edits`: the kept edits on the page, against the version they started from, with their Save's op ID. */
  async function resumeDraft(kept: EditorDraft, atGym: string | null) {
    const ids = [...new Set(kept.edit.exercises.map((e) => e.exerciseId))];
    const more = await services.routines.exerciseInfo(ids).catch((): Record<string, EditorExerciseInfo> => ({}));
    const moreFacts = await services.builder.templateFacts({ gymId: atGym, exerciseIds: ids }).catch((): Record<string, TemplateFact> => ({}));
    setInfo((cur) => ({ ...more, ...cur }));
    setFacts((cur) => ({ ...moreFacts, ...cur }));
    base.current = { name: kept.base.name, exercises: kept.base.exercises };
    expected.current = kept.baseVersion;
    opId.current = kept.opId;
    setName(kept.edit.name);
    setList(kept.edit.exercises);
  }

  // Autosave (Ben, 26 Oct): the edits as they stand, 400 ms after the last change; none left once nothing differs.
  useEffect(() => {
    if (draftKey === null || !draftReady || data === 'loading' || data === null) return;
    const edits: RoutineEdit = { name, exercises: list };
    const t = setTimeout(() => {
      if (!routineEditDirty(base.current, edits)) {
        void editorDrafts().remove(draftKey).catch(() => undefined);
        return;
      }
      void editorDrafts()
        .put({ key: draftKey, savedAtUtc: services.now().utc, baseVersion: expected.current, base: { name: base.current.name, exercises: [...base.current.exercises] }, edit: { name, exercises: list }, opId: opId.current })
        .catch(() => undefined);
    }, 400);
    return () => {
      clearTimeout(t);
    };
  }, [draftKey, draftReady, data, name, list, services]);
  const forgetDraft = () => {
    if (draftKey !== null) void editorDrafts().remove(draftKey).catch(() => undefined);
  };
  // The Save sheet's `Edit ›`: whatever closes the editor without a Save (Cancel, Discard) shows the sheet again.
  useEffect(
    () => () => {
      if (saveAs !== undefined) settleSaveEdit(saveAs, { kind: 'cancelled' });
    },
    [saveAs],
  );
  useEffect(() => {
    void AccessibilityInfo.isScreenReaderEnabled().then(setScreenReader);
  }, []);

  // `about N min` while editing (debounced; local).
  const gymId = data !== 'loading' && data !== null ? (data.gym?.id ?? null) : null;
  // (Ben, 27 Oct) A plan day's template is timed as Today drafts the day (one number on the card, the plan and here).
  const editedRoutineId = data !== 'loading' && data !== null ? (data.routine?.id ?? null) : null;
  useEffect(() => {
    const t = setTimeout(() => {
      void services.routines
        .estimate({ exercises: list, gymId, routineId: editedRoutineId })
        .then(setMinutes)
        .catch(() => {
          setMinutes(null);
        });
    }, 400);
    return () => {
      clearTimeout(t);
    };
  }, [services, list, gymId, editedRoutineId]);

  const showToast = useCallback(
    (t: { text: string; before: RoutineExercise[] | null; length?: number | null; gymEdit?: GymEdit } | null) => {
      if (toastTimer.current !== null) clearTimeout(toastTimer.current);
      setToast(t);
      // With VoiceOver on, an Undo toast stays until dismissed (close button).
      if (t !== null && !screenReader)
        toastTimer.current = setTimeout(() => {
          setToast(null);
        }, theme.timing.undoToast);
    },
    [screenReader, theme.timing.undoToast],
  );

  if (data === 'loading') return <View style={{ flex: 1, backgroundColor: theme.colors['bg.canvas'] }} />;
  if (data === null) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.colors['bg.canvas'], padding: theme.components.screenMargin, paddingTop: insets.top + theme.space['6'], gap: theme.space['4'] }}>
        <StatusLine icon="exclamationmark.triangle" tone="warning" text="Couldn’t open that workout." action={<TextButton label="Try again" onPress={load} />} />
        <TextButton
          label={EDITOR_COPY.cancel}
          tone="secondary"
          onPress={() => {
            navigation.goBack();
          }}
        />
      </View>
    );
  }
  const editor = data;
  const ctx: TemplateEditorCtx = { info, facts, gym: editor.gym, unit: editor.unit, globalDefault: editor.globalDefault, effortScale: editor.effortScale, stored: editor.routine?.exercises ?? [] };
  const edit: RoutineEdit = { name, exercises: list };
  const issues = routineIssues(edit, (id) => info[id]?.measurement === 'distance', ctx.stored);
  const isNew = target.kind !== 'edit';
  const dirty = routineEditDirty(base.current, edit);
  const primary = editorPrimary({ issues, dirty, isNew });
  const table = templateTableView(list, ctx);
  const nameOfSlot = (slotId: string) => info[list.find((e) => e.id === slotId)?.exerciseId ?? '']?.name ?? 'Exercise';
  // (Ben, 27 Oct) The live estimate of the list on the page, and the steps from it.
  const time = editorTimeView({ estimate: minutes, length: timeLength, fitted: fit !== null });
  const shownMinutes = time?.minutes ?? null;
  const fitNote = fit === null ? { note: null, lines: [] as string[] } : fitNoteOf(fit.steps, (id) => info[id]?.name ?? 'Exercise', nameOfSlot);

  /** One edit on the page's list, on the list as it is now (quick taps add up). Returns the pop-up's line, if any. */
  function apply(op: TemplateEditOp): string | null {
    const before = listRef.current;
    const r = applyTemplateEdit(listRef.current, op, ctx, newUuid);
    setList(r.list);
    setFit(null);
    setError(null);
    if (op.kind !== 'delete_exercise' && op.kind !== 'swap') showToast(null);
    // (Ben, 27 Oct: "If I add it it should work") A kg typed off the gym's known kit is kept; the gym learns it.
    const learn = r.learn;
    if (learn !== undefined) {
      void services.gyms.learn(learn).then((g) => {
        if (!g.ok) return;
        showToast({ text: gymLearnToast(learn, editor.gym?.name ?? null), before, gymEdit: g.edit });
      });
    }
    return r.note;
  }

  function deleteExercise(slotId: string) {
    const before = listRef.current;
    const label = nameOfSlot(slotId);
    apply({ kind: 'delete_exercise', slotId });
    showToast({ text: TEMPLATE_COPY.deleted(label), before });
  }

  function cancel() {
    if (!dirty) {
      forgetDraft();
      navigation.dispatch(backFromEditor(from, copyToast));
      return;
    }
    Alert.alert(EDITOR_COPY.discardTitle, undefined, [
      { text: EDITOR_COPY.keepEditing, style: 'cancel' },
      {
        text: EDITOR_COPY.discard,
        style: 'destructive',
        onPress: () => {
          forgetDraft();
          navigation.dispatch(backFromEditor(from, copyToast));
        },
      },
    ]);
  }

  async function save(next: RoutineEdit = edit, expectedVersion: number | null = expected.current) {
    if (busy || (next === edit && primary.disabled)) return;
    setBusy(true);
    setError(null);
    try {
      const r = await saveTemplate(services.routines, { target, edit: next, expectedVersion, opId: opId.current });
      switch (r.kind) {
        case 'saved':
          forgetDraft();
          changed();
          if (from === 'ExerciseInfo' || from === 'PlanDay') handOffLibraryToast(r.toast);
          navigation.dispatch(popToFromEditor(from, r.toast));
          return;
        case 'saved_as':
          forgetDraft();
          changed();
          if (saveAs !== undefined) settleSaveEdit(saveAs, { kind: 'saved', routine: r.routine });
          navigation.goBack();
          return;
        case 'stale':
          setPicks({});
          setStale({ current: r.current, lines: r.lines, changedAtUtc: r.changedAtUtc });
          return;
        case 'failed':
          setError(r.message);
          return;
      }
    } finally {
      setBusy(false);
    }
  }

  // Keep both (v0.1 §3.3): my edits on the newer version; a new opId, since it is a new save.
  const merge = stale === null ? null : mergeRoutineEdits(base.current, edit, editableOf(stale.current), picks);
  function keepBoth() {
    if (stale === null || merge === null) return;
    const current = stale.current;
    base.current = editableOf(current);
    expected.current = current.version;
    setName(merge.merged.name);
    setList([...merge.merged.exercises]);
    setStale(null);
    opId.current = newUuid();
    void save(merge.merged, current.version);
  }
  function discardMine() {
    setStale(null);
    opId.current = newUuid();
    forgetDraft();
    load();
  }

  /**
   * (Ben, 26 Oct) `Time ±`: the next 5-minute step from the estimate (`editorTimeView`), the template's sets and rests
   * fitted to it from the list as it was before the first step (so steps don't add up), shown as page edits with the
   * note and `Undo`. Nothing is saved. (Ben, 27 Oct) The step becomes the length; the number shown is the new estimate.
   */
  async function stepTime(dir: -1 | 1) {
    const to = time === null ? null : dir < 0 ? time.less : time.more;
    if (to === null || fitBusy.current) return;
    fitBusy.current = true;
    try {
      const from = fit?.before ?? listRef.current;
      const r = await services.routines.fitTemplate({ exercises: from, gymId: editor.gym?.id ?? null, minutes: to, defaultRestS: editor.globalDefault.seconds, routineId: editor.routine?.id ?? null });
      if (r === null) {
        setError(TEMPLATE_COPY.fitNoChange);
        return;
      }
      setTimeLength(to);
      setMinutes(Math.max(1, Math.round(r.seconds / 60)));
      if (r.status === 'fits') {
        setList(from);
        setFit(null);
        showToast({ text: TEMPLATE_COPY.fitNoChange, before: null });
        return;
      }
      setList(r.exercises);
      setFit({ before: from, fromMinutes: fit?.fromMinutes ?? minutes, fromLength: fit === null ? timeLength : fit.fromLength, steps: r.steps });
      setError(null);
      if (r.status === 'over') showToast({ text: TEMPLATE_COPY.fitOver(Math.max(1, Math.round(r.seconds / 60))), before: from, length: fit === null ? timeLength : fit.fromLength });
    } finally {
      fitBusy.current = false;
    }
  }

  /**
   * Swap / Add (§2.5): this gym's suggestions for a group (the chip; none: the exercise's own), the same sheet as
   * Your workout's; on a fresh open the full list (Ben, 25 Oct: every exercise, search, `＋ Add your own`).
   */
  async function openSwap(slotId: string | null, opts: { group?: BuilderGroup; fresh?: boolean; query?: string } = {}) {
    const exerciseId = slotId === null ? null : (listRef.current.find((e) => e.id === slotId)?.exerciseId ?? null);
    const gymId = editor.gym?.id ?? null;
    if (opts.fresh !== false) picker.open(() => services.exercisePicker.forTemplate(gymId), opts.query ?? '');
    const group = opts.group;
    const choices = await services.builder
      .templateChoices({ gymId, inWorkout: listRef.current.map((e) => e.exerciseId), exerciseId, ...(group === undefined ? {} : { group }) })
      .catch((): ExerciseChoices => ({ group: group ?? 'Chest', groups: [], sections: [] }));
    setSwap({ slotId, choices });
  }
  openSwapRef.current = (slotId, opts) => void openSwap(slotId, opts);

  function closeSwap() {
    setSwap(null);
    picker.close();
  }

  async function pick(exerciseId: string) {
    const s = swap;
    if (s === null) return;
    closeSwap();
    const x = (await services.routines.exerciseInfo([exerciseId]).catch((): Record<string, EditorExerciseInfo> => ({})))[exerciseId];
    if (x === undefined) {
      setError('Couldn’t add that exercise. Try again.');
      return;
    }
    const more = await services.builder.templateFacts({ gymId: editor.gym?.id ?? null, exerciseIds: [exerciseId] }).catch((): Record<string, TemplateFact> => ({}));
    setInfo((cur) => ({ ...cur, [x.id]: x }));
    setFacts((cur) => ({ ...cur, ...more }));
    const ref = { id: x.id, measurement: x.measurement };
    // Apply against the info that includes the new exercise (its measurement and shape).
    const withX: TemplateEditorCtx = { ...ctx, info: { ...ctx.info, [x.id]: x }, facts: { ...ctx.facts, ...more } };
    setFit(null);
    if (s.slotId === null) {
      setList(applyTemplateEdit(listRef.current, { kind: 'add_exercise', exercise: ref, shape: x.defaultShape }, withX, newUuid).list);
      showToast(null);
    } else {
      const before = listRef.current;
      setList(applyTemplateEdit(listRef.current, { kind: 'swap', slotId: s.slotId, exercise: ref }, withX, newUuid).list);
      showToast({ text: TEMPLATE_COPY.swapped, before });
    }
  }

  const rowAction = (slotId: string, a: WorkoutRowAction) => {
    switch (a) {
      case 'delete':
        deleteExercise(slotId);
        break;
      case 'swap':
        void openSwap(slotId);
        break;
      case 'move_up':
        apply({ kind: 'move', slotId, dir: 'up' });
        break;
      case 'move_down':
        apply({ kind: 'move', slotId, dir: 'down' });
        break;
      case 'superset_next':
        apply({ kind: 'superset_next', slotId });
        break;
      case 'unlink':
        apply({ kind: 'unlink', slotId });
        break;
    }
  };

  /** A set's own actions behind its hold menu: rep range, time, distance, Auto load, rest after this set. */
  function rowExtra(slotId: string, setId: string, action: string) {
    const t = listRef.current.find((e) => e.id === slotId)?.setTemplates.find((x) => x.id === setId);
    if (t === undefined) return;
    switch (action) {
      case 'reps_range':
        Alert.prompt(TEMPLATE_COPY.repRange, undefined, (text) => {
          const r = parseRepRange(text);
          if (r !== null) apply({ kind: 'set_reps', slotId, setId, reps: r });
        }, 'plain-text', t.targetReps === null ? '' : `${String(t.targetReps.min)}-${String(t.targetReps.max)}`, 'numbers-and-punctuation');
        return;
      case 'time':
        Alert.prompt(TEMPLATE_COPY.workTime, undefined, (text) => {
          const s = parseClock(text);
          if (s !== null) apply({ kind: 'set_time', slotId, setId, seconds: s });
        }, 'plain-text', t.targetDurationS === null ? '' : formatDuration(t.targetDurationS), 'numbers-and-punctuation');
        return;
      case 'distance':
        Alert.prompt(`${TEMPLATE_COPY.distance} (m)`, undefined, (text) => {
          const d = parseMetres(text);
          if (d !== null) {
            const note = apply({ kind: 'set_distance', slotId, setId, metres: d.metres });
            if (note !== null) setError(note);
          }
        }, 'plain-text', t.targetDistanceM == null ? '' : String(t.targetDistanceM), 'number-pad');
        return;
      case 'auto_load':
        apply({ kind: 'auto_load', slotId, setId });
        return;
      case 'rest_after': {
        const choices = restChoices(editor.restPresets);
        const options = [TEMPLATE_COPY.useDefault, ...choices.map((c) => c.label), EDITOR_COPY.cancel];
        ActionSheetIOS.showActionSheetWithOptions({ title: TEMPLATE_COPY.restAfter, options, cancelButtonIndex: options.length - 1 }, (i) => {
          if (i === 0) apply({ kind: 'set_rest', slotId, setId, seconds: null });
          const c = choices[i - 1];
          if (i > 0 && c !== undefined) apply({ kind: 'set_rest', slotId, setId, seconds: c.seconds });
        });
        return;
      }
    }
  }

  const popupSlot = popup === null ? undefined : list.find((e) => e.id === popup);
  const view = popup === null ? null : templatePopupView(list, popup, ctx);
  const popupExercise = popupSlot === undefined ? null : { exerciseId: popupSlot.exerciseId, exerciseName: info[popupSlot.exerciseId]?.name ?? 'Exercise' };
  const howTo = popupExercise === null ? null : howToRouteFor(popupExercise, bundledHowToSources());
  const shapeSlot = shapeSheet === null ? undefined : list.find((e) => e.id === shapeSheet.slotId);
  const shapeView = shapeSlot === undefined ? null : slotShapeOf(shapeSlot);

  const toastNode =
    toast === null ? null : (
      <Toast
        icon="info.circle"
        text={toast.text}
        {...(toast.before !== null
          ? {
              action: TEMPLATE_COPY.undo,
              onAction: () => {
                const before = toast.before;
                const length = toast.length;
                const gymEdit = toast.gymEdit;
                showToast(null);
                if (gymEdit !== undefined) void services.gyms.undoEdit(gymEdit);
                if (before !== null) setList(before);
                if (length !== undefined) setTimeLength(length);
                setFit(null);
              },
            }
          : {})}
        onDismiss={() => {
          showToast(null);
        }}
        showClose={screenReader}
      />
    );

  return (
    <View style={{ flex: 1, paddingTop: insets.top, backgroundColor: theme.colors['bg.canvas'] }}>
      <View style={{ flex: 1 }}>
        <View style={{ paddingHorizontal: theme.components.screenMargin, gap: theme.space['2'] }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <TextButton label={EDITOR_COPY.cancel} tone="secondary" onPress={cancel} />
          </View>
          <TextField
            accessibilityLabel={TEMPLATE_COPY.name}
            placeholder={isNew ? TEMPLATE_COPY.newTitle : TEMPLATE_COPY.name}
            value={name}
            onChangeText={setName}
            autoFocus={(target.kind === 'new' && name.trim() === '') || selectName === true}
            selectTextOnFocus={selectName === true}
            returnKeyType="done"
            maxLength={160}
            style={{ fontSize: theme.type.title1.fontSize, fontWeight: '700', paddingHorizontal: theme.space['2'], backgroundColor: 'transparent' }}
          />
          {/* (Ben, 26 Oct) Your workout's Time control: the estimate, ± fits the sets and rests (as edits to save). */}
          {shownMinutes === null ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 44 }}>
              <AppText variant="callout" color="text.secondary" style={{ fontSize: 15 }}>
                {TEMPLATE_COPY.time}
              </AppText>
              <AppText variant="label" numeric>
                —
              </AppText>
            </View>
          ) : (
            <TimeNoteRow
              minutes={shownMinutes}
              over={time?.over ?? false}
              note={fitNote.note}
              noteLabel={fitNote.note === null ? null : `Time changes: ${fitNote.note}`}
              onStep={(d) => void stepTime(d)}
              onNote={() => {
                setTimeDetail(true);
              }}
            />
          )}
        </View>
        <ScrollView scrollEnabled={!dragging} keyboardShouldPersistTaps="handled" keyboardDismissMode="interactive" contentContainerStyle={{ paddingHorizontal: theme.components.screenMargin, paddingVertical: theme.space['3'], gap: theme.space['3'] }}>
          {editor.inProgress ? <StatusLine icon="info.circle" tone="info" text={EDITOR_COPY.inProgress} /> : null}
          <WorkoutTable
            rounds={table.rounds}
            topHeader={table.topHeader}
            canAdd={table.canAdd}
            dragging={dragging}
            onDragChange={setDragging}
            canDrop={(slotId, t) => dropRoutineSlot(listRef.current, slotId, t.key, t.edge) !== null}
            onDrop={(slotId, t) => {
              apply({ kind: 'drop', slotId, targetId: t.key, edge: t.edge });
            }}
            onRowPress={(r) => {
              setPopup(r.slotKey);
            }}
            onRowAction={(r, a) => {
              rowAction(r.slotKey, a);
            }}
            onAdd={() => void openSwap(null)}
          />
        </ScrollView>
        <ToastHost bottom={8}>{popup === null ? toastNode : null}</ToastHost>
      </View>
      <View style={{ paddingHorizontal: theme.components.screenMargin, paddingTop: theme.space['2'], paddingBottom: insets.bottom + theme.space['2'], gap: theme.space['2'], backgroundColor: theme.colors['bg.canvas'] }}>
        {error !== null ? <StatusLine icon="exclamationmark.triangle" tone="warning" text={error} /> : null}
        <PrimaryButton label={primary.label} disabled={primary.disabled} busy={busy} onPress={() => void save()} />
      </View>

      <ExercisePopup
        view={view}
        resetKey={popup}
        onEditCell={(row, field, value) => Promise.resolve(popup === null ? null : apply({ kind: 'cell', slotId: popup, setId: row.key, field, value }))}
        onType={(row, type: SetType) => Promise.resolve(popup === null ? null : apply({ kind: 'set_type', slotId: popup, setId: row.key, type }))}
        onDeleteRow={(row) => {
          if (popup !== null) apply({ kind: 'delete_set', slotId: popup, setId: row.key });
        }}
        onAddWarmup={() => Promise.resolve(popup === null ? null : apply({ kind: 'add_warmup', slotId: popup }))}
        onAddSet={() => {
          if (popup !== null) apply({ kind: 'add_set', slotId: popup });
        }}
        onRestStep={(x, d) => {
          if (popup !== null) apply({ kind: 'rest_step', slotId: popup, setType: x.kind as SetType, dir: d });
        }}
        onRestDefault={(x) => {
          if (popup !== null) apply({ kind: 'rest_default', slotId: popup, setType: x.kind as SetType });
        }}
        onMove={(dir) => {
          if (popup !== null) apply({ kind: 'move', slotId: popup, dir });
        }}
        onSupersetNext={() => {
          if (popup !== null) apply({ kind: 'superset_next', slotId: popup });
        }}
        onUnlink={() => {
          if (popup !== null) apply({ kind: 'unlink', slotId: popup });
        }}
        onSwap={() => {
          const k = popup;
          setPopup(null);
          if (k !== null) void openSwap(k);
        }}
        onDelete={() => {
          const k = popup;
          setPopup(null);
          if (k !== null) deleteExercise(k);
        }}
        onClose={() => {
          setPopup(null);
        }}
        // An `Auto` cell (nothing typed yet) steps from the last logged load (design pass 5.1).
        kgStep={(row, value, dir) => Promise.resolve(popup === null ? null : templateKgStep(listRef.current, popup, row.load === null && value === 0 ? null : value, dir, ctx))}
        onRowExtra={(row, action) => {
          if (popup !== null) rowExtra(popup, row.key, action);
        }}
        onHowTo={
          popupExercise === null
            ? undefined
            : () => {
                setPopup(null);
                // The exercise's guide, else its detail (the old editor's `Exercise info`).
                if (howTo !== null) navigation.navigate('HowTo', howTo);
                else navigation.navigate('ExerciseInfo', { exerciseId: popupExercise.exerciseId, name: popupExercise.exerciseName, readOnly: true });
              }
        }
        onHistory={
          popupSlot === undefined || facts[popupSlot.exerciseId]?.hasHistory !== true
            ? undefined
            : () => {
                setPopup(null);
                navigation.navigate('ExerciseProgress', { exerciseId: popupSlot.exerciseId, name: info[popupSlot.exerciseId]?.name ?? 'Exercise', ...(gymId === null ? {} : { gymId }) });
              }
        }
        options={
          view === null || popup === null ? null : (
            <TemplateOptions
              options={view.options}
              onMain={(on) => {
                apply({ kind: 'main', slotId: popup, on });
              }}
              onAddedWeight={(on) => {
                apply({ kind: 'added_weight', slotId: popup, on });
              }}
              onReps={() => {
                setShapeSheet({ slotId: popup, kind: 'reps' });
              }}
              onEffort={() => {
                setShapeSheet({ slotId: popup, kind: 'effort' });
              }}
            />
          )
        }
        toast={toastNode}
      />
      {/* (Ben, 26 Oct) What `Time ±` changed, with Undo back to the list before it. */}
      <TimeDetailSheet
        visible={timeDetail && fit !== null}
        minutes={shownMinutes ?? 0}
        lines={fitNote.lines}
        undoMinutes={fit?.fromMinutes ?? null}
        onUndo={() => {
          if (fit !== null) {
            setList(fit.before);
            setTimeLength(fit.fromLength);
          }
          setFit(null);
          setTimeDetail(false);
        }}
        onClose={() => {
          setTimeDetail(false);
        }}
      />
      <SwapSheet
        visible={swap !== null}
        title={swap?.slotId == null ? 'Add exercise' : `Swap ${nameOfSlot(swap.slotId)}`}
        sections={swap?.choices.sections ?? []}
        actionWord={swap?.slotId == null ? 'Add' : 'Swap'}
        onPick={(id) => void pick(id)}
        onClose={closeSwap}
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
            if (swap !== null) void openSwap(swap.slotId, g === null ? { fresh: false } : { group: g, fresh: false });
          },
          onAddOwn: (name) => {
            if (swap === null) return;
            addOwn.start(swap.slotId, name);
            closeSwap();
          },
        }}
      />
      <ShapeRepsSheet
        visible={shapeSheet?.kind === 'reps' && shapeSlot !== undefined}
        title={`${EDITOR_COPY.reps} · ${shapeSlot ? (info[shapeSlot.exerciseId]?.name ?? '') : ''}`}
        start={slotRepsDraft(shapeSlot?.setTemplates ?? [], shapeSlot !== undefined && info[shapeSlot.exerciseId]?.measurement === 'cardio')}
        onDone={(v) => {
          const id = shapeSheet?.slotId;
          if (id !== undefined) apply({ kind: 'slot_reps', slotId: id, value: v });
          setShapeSheet(null);
        }}
        onClose={() => {
          setShapeSheet(null);
        }}
      />
      {editor.effortScale !== null ? (
        <EffortSheet
          visible={shapeSheet?.kind === 'effort' && shapeSlot !== undefined}
          scale={editor.effortScale}
          title={`${editor.effortScale === 'rpe' ? SET_SHAPE_COPY.targetRpe : SET_SHAPE_COPY.targetRir} · ${shapeSlot ? (info[shapeSlot.exerciseId]?.name ?? '') : ''}`}
          value={shapeView === null ? null : editor.effortScale === 'rpe' ? shapeView.targetRpe : shapeView.targetRir}
          onPick={(v) => {
            const id = shapeSheet?.slotId;
            if (id !== undefined) apply({ kind: 'slot_effort', slotId: id, value: v });
          }}
          onClose={() => {
            setShapeSheet(null);
          }}
        />
      ) : null}
      <BottomCard
        visible={stale !== null}
        scroll={false}
        onClose={() => {
          setStale(null);
        }}
      >
        {stale !== null && merge !== null ? (
          <ConflictBody
            stale={stale}
            conflicts={merge.conflicts}
            picks={picks}
            nameOf={(id) => info[id]?.name ?? 'Exercise'}
            tz={services.now().tz}
            onPick={(k, v) => {
              setPicks((p) => ({ ...p, [k]: v }));
            }}
            onKeepBoth={keepBoth}
            onDiscard={discardMine}
          />
        ) : null}
      </BottomCard>
    </View>
  );
}

/**
 * The pop-up's options on a saved workout (the old editor's card, moved here; Ben, 23 Oct): `Main`, `Add weight` on a
 * bodyweight exercise, the exercise's `Reps` (a range for every working set) and `Target RPE`.
 */
function TemplateOptions({ options, onMain, onAddedWeight, onReps, onEffort }: { options: TemplateOptionsView; onMain: (on: boolean) => void; onAddedWeight: (on: boolean) => void; onReps: () => void; onEffort: () => void }) {
  const rows: ReactNode[] = [
    <SwitchRow key="main" label={TEMPLATE_COPY.main} value={options.main} onChange={() => { onMain(!options.main); }} />,
    ...(options.addedWeight === null ? [] : [<SwitchRow key="added" label={TEMPLATE_COPY.addWeight} value={options.addedWeight} onChange={() => { onAddedWeight(options.addedWeight !== true); }} />]),
    <ValueRow key="reps" label={options.reps.label} value={options.reps.text} onPress={onReps} />,
    ...(options.effort === null ? [] : [<ValueRow key="effort" label={options.effort.label} value={options.effort.text} onPress={onEffort} />]),
  ];
  return (
    <Table>
      {rows.map((r, i) => (
        <View key={i}>
          {i > 0 ? <Divider /> : null}
          {r}
        </View>
      ))}
    </Table>
  );
}

/** A 54 pt row that is one switch for VoiceOver (the Switch inside only shows it; review S9 on Today's rows). */
function SwitchRow({ label, value, onChange }: { label: string; value: boolean; onChange: () => void }) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityLabel={label}
      accessibilityState={{ checked: value }}
      onPress={onChange}
      style={({ pressed }) => ({ minHeight: 54, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: theme.space['4'], opacity: pressed ? 0.7 : 1 })}
    >
      <AppText variant="body">{label}</AppText>
      <View pointerEvents="none" accessible={false} importantForAccessibility="no-hide-descendants">
        <Switch value={value} accessible={false} />
      </View>
    </Pressable>
  );
}

/** The save conflict (v0.1 §3.3, WL-A6): what changed, a pick for anything both changed, `Keep both` / `Discard my edits`. */
function ConflictBody({
  stale,
  conflicts,
  picks,
  nameOf,
  tz,
  onPick,
  onKeepBoth,
  onDiscard,
}: {
  stale: Stale;
  conflicts: RoutineConflict[];
  picks: Record<string, 'mine' | 'theirs'>;
  nameOf: (id: string) => string;
  tz: string;
  onPick: (key: string, v: 'mine' | 'theirs') => void;
  onKeepBoth: () => void;
  onDiscard: () => void;
}) {
  const theme = useTheme();
  return (
    <ScrollView style={{ flexGrow: 0 }} contentContainerStyle={{ gap: theme.space['3'] }}>
      <AppText variant="title2" accessibilityRole="header">
        {EDITOR_COPY.conflictTitle(stale.current.name)}
      </AppText>
      {conflictLines({ lines: stale.lines, changedAtUtc: stale.changedAtUtc, tz }).map((l) => (
        <AppText key={l} variant="callout" color="text.secondary" numeric>
          {l}
        </AppText>
      ))}
      {conflicts.map((c) => {
        const key = c.kind === 'name' ? 'name' : c.slotId;
        const t = conflictText(c, nameOf);
        const pick = picks[key] ?? 'theirs';
        return (
          <View key={key} style={{ gap: theme.space['2'] }}>
            <AppText variant="headline">{t.title}</AppText>
            <ChipRow>
              <Chip label={`${EDITOR_COPY.mine}: ${t.mine}`} selected={pick === 'mine'} onPress={() => { onPick(key, 'mine'); }} />
              <Chip label={`${EDITOR_COPY.theirs}: ${t.theirs}`} selected={pick === 'theirs'} onPress={() => { onPick(key, 'theirs'); }} />
            </ChipRow>
          </View>
        );
      })}
      <PrimaryButton label={EDITOR_COPY.keepBoth} onPress={onKeepBoth} />
      <DangerTextButton label={EDITOR_COPY.discardMine} onPress={onDiscard} />
    </ScrollView>
  );
}
