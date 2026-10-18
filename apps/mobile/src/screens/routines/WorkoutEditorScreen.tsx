import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ActionSheetIOS, Alert, KeyboardAvoidingView, Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  addExercise,
  addSet,
  deleteSet,
  editorItemFor,
  editorLoadItem,
  setAddedWeight,
  slotLoadConvention,
  editorMainFlags,
  editorSetRows,
  editableEdit,
  editorSummaryLine,
  fixedLoadFrame,
  fixedLoadNote,
  fixedLoadSteps,
  formatDuration,
  isRefusedDistanceSlot,
  mergeRoutineEdits,
  moveExercise,
  removeExercise,
  replaceExercise,
  routineEditDirty,
  routineIssues,
  setMain,
  setRestBySetType,
  setSlotReps,
  setSlotTargetRpe,
  setWarmupCount,
  setWorkingSetCount,
  slotShapeOf,
  supersetWithNext,
  workingSetTotal,
  ungroup,
  updateSet,
  type RoutineConflict,
  type RoutineEdit,
} from '@fizz/domain';
import type { EquipmentInstance, LoadConvention, RoutineExercise, SetTemplate, SetType, WeightUnit } from '@fizz/schemas';

import { newUuid } from '../../device/runtime';
import { backFromEditor, popToFromEditor } from '../../navigation/actions';
import type { LibraryToastParam, RootStackParams } from '../../navigation/types';
import type { EditorExerciseInfo, RoutineEditorData } from '../../services/workout-services';
import { useDataChanged, useServices } from '../../shell/context';
import { useTheme } from '../../theme';
import { AppText, BottomCard, Chip, ChipRow, DangerTextButton, EffortSheet, Eyebrow, Icon, InfoLine, NumberAccessory, NumberStepper, PrimaryButton, Row, SetCountBar, SetShapeControl, ShapeRepsSheet, StatusLine, TextButton, TextField } from '../../ui';
import { conflictLines, conflictText, EDITOR_COPY, editorAddRow, editorPrimary, editorSlotIssue, exerciseMenu, LIBRARY_COPY_UI, LIBRARY_TOASTS, mainChipLabel, restChoices } from '../../workout/library-view';
import { handOffLibraryToast } from '../../workout/library-toast';
import { saveEditRequest, settleSaveEdit } from '../../workout/save-edit-handoff';
import { SET_BAR, SET_SHAPE_COPY, shapeEffortRow, shapeRepsText, slotRepsDraft, stepperLimits } from '../../workout/set-shape-view';

type Stale = { current: NonNullable<RoutineEditorData['routine']>; lines: string[]; changedAtUtc: string };

const SET_TYPES: { type: SetType; label: string }[] = [
  { type: 'warmup', label: 'Warm-up' },
  { type: 'working', label: 'Working' },
  { type: 'top', label: 'Top set' },
  { type: 'backoff', label: 'Back-off' },
  { type: 'drop', label: 'Drop' },
];

/**
 * The workout editor (routines.md §A2.3, WL8): name, exercises (add,
 * replace, remove, Move up / Move down), sets (type, Auto / Fixed load,
 * reps or work time, this set's rest), rest by set type, supersets, and
 * `Main`. Nothing is saved until `Save`, which writes one version (opId,
 * expectedVersion) with an Undo record; a newer version is never
 * overwritten (the conflict sheet). Edits are lost on a force-close, as
 * Cancel. Local only. Values are targets; a Fixed load above the rack is
 * saved with a warning and fitted at Start (rule 4).
 *
 * Each card leads with the one sets control (`SetShapeControl`, WL11):
 * `Sets [−] 3 [+]`, `Warm-ups`, `Reps`, `Target RPE`; the per-set rows sit
 * under `Each set`, open by default only when the slot has special sets.
 * The add sheet has the `Sets` bar (exercise-library §10.3).
 */
export function WorkoutEditorScreen() {
  const theme = useTheme();
  const services = useServices();
  const changed = useDataChanged();
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const { routineId, from, selectName, copyToast, draft, saveAs } = useRoute<RouteProp<RootStackParams, 'WorkoutEditor'>>().params;
  const [data, setData] = useState<RoutineEditorData | null | 'loading'>('loading');
  const [name, setName] = useState('');
  const [list, setList] = useState<RoutineExercise[]>([]);
  const [info, setInfo] = useState<Record<string, EditorExerciseInfo>>({});
  const [minutes, setMinutes] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stale, setStale] = useState<Stale | null>(null);
  const [picks, setPicks] = useState<Record<string, 'mine' | 'theirs'>>({});
  const [setSheet, setSetSheet] = useState<{ slotId: string; setIds: string[] } | null>(null);
  const [restSheet, setRestSheet] = useState<string | null>(null);
  const [adding, setAdding] = useState<{ mode: 'add' } | { mode: 'replace'; slotId: string } | null>(null);
  // `Each set ▸ / ▾` per slot while the editor is open; absent = the default (open with special sets).
  const [eachOpen, setEachOpen] = useState<Record<string, boolean>>({});
  const [shapeSheet, setShapeSheet] = useState<{ slotId: string; kind: 'reps' | 'effort' } | null>(null);
  const opId = useRef(newUuid());
  // The workout as opened (or as last merged on a conflict): what `dirty` and Keep both compare against.
  const base = useRef<RoutineEdit>({ name: '', exercises: [] });

  function load() {
    setData('loading');
    void services.yourData
      .currentGym()
      .catch(() => null)
      .then((gym) => services.routines.editor({ routineId, gymId: gym?.id ?? null }))
      .then((d) => {
        setData(d);
        if (d === null) return;
        const opened = { name: d.routine?.name ?? '', exercises: d.exercises };
        base.current = opened;
        setName(opened.name);
        setList(opened.exercises);
        setInfo(d.info);
        // `New workout` from Exercise detail (exercise-library §9.5): starts with that exercise and the sheet's shape.
        if (d.routine === null && draft !== undefined) {
          setName(draft.name);
          setList(draft.exercises);
          // The Save sheet's unsaved copy (WL-A18): unchanged, Cancel goes straight back to the sheet.
          if (saveAs !== undefined) base.current = { name: draft.name, exercises: draft.exercises };
          void services.routines
            .exerciseInfo(draft.exercises.map((e) => e.exerciseId))
            .then((more) => {
              setInfo((cur) => ({ ...cur, ...more }));
            })
            .catch(() => undefined);
        }
      })
      .catch(() => {
        setData(null);
      });
  }
  useEffect(load, [services, routineId]);
  // The Save sheet's `Edit ›`: whatever closes the editor without a Save (Cancel, Discard, swipe-down) shows the sheet again.
  useEffect(
    () => () => {
      if (saveAs !== undefined) settleSaveEdit(saveAs, { kind: 'cancelled' });
    },
    [saveAs],
  );

  // `≈ N min at Main gym` while editing (debounced; local).
  const gymId = data !== 'loading' && data !== null ? (data.gym?.id ?? null) : null;
  useEffect(() => {
    const t = setTimeout(() => {
      void services.routines
        .estimate({ exercises: list, gymId })
        .then(setMinutes)
        .catch(() => {
          setMinutes(null);
        });
    }, 400);
    return () => {
      clearTimeout(t);
    };
  }, [services, list, gymId]);

  const edit: RoutineEdit = useMemo(() => ({ name, exercises: list }), [name, list]);
  const isDistance = (exerciseId: string) => info[exerciseId]?.measurement === 'distance';
  // A distance slot already stored (saved before EL-B13) is kept; only new ones block Save (review library-browse r3 S1).
  const stored = data !== 'loading' && data !== null ? (data.routine?.exercises ?? []) : [];
  const issues = routineIssues(edit, isDistance, stored);
  const isNew = routineId === null;
  const dirty = routineEditDirty(base.current, edit);
  const primary = editorPrimary({ issues, dirty, isNew });
  const nameOf = (exerciseId: string) => info[exerciseId]?.name ?? 'Exercise';
  const isCompound = (exerciseId: string) => info[exerciseId]?.compound ?? false;

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
  const workoutName = editor.routine?.name ?? (name.trim() || 'this workout');

  function cancel() {
    if (!dirty) {
      navigation.dispatch(backFromEditor(from, copyToast));
      return;
    }
    Alert.alert(EDITOR_COPY.discardTitle, undefined, [
      { text: EDITOR_COPY.keepEditing, style: 'cancel' },
      {
        text: EDITOR_COPY.discard,
        style: 'destructive',
        onPress: () => {
          navigation.dispatch(backFromEditor(from, copyToast));
        },
      },
    ]);
  }

  function finish(toast: LibraryToastParam) {
    changed();
    if (from === 'ExerciseInfo') handOffLibraryToast(toast);
    navigation.dispatch(popToFromEditor(from, toast));
  }

  async function save(next: RoutineEdit = edit, expectedVersion: number | null = editor.routine?.version ?? null) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      if (isNew && saveAs !== undefined) {
        // `Save to Workouts` → `Edit ›` (§A2.5, WL-A18): the sheet's own save, with its opId and rotation choice; its host shows the toast.
        const req = saveEditRequest(saveAs);
        if (req === null) {
          setError(LIBRARY_COPY_UI.saveFailed);
          return;
        }
        const r = await services.routines.saveFrom({ from: req.from, name: next.name.trim(), addToRotation: req.addToRotation, opId: req.opId, edit: next });
        if (!r.ok) {
          setError(r.message);
          return;
        }
        changed();
        settleSaveEdit(saveAs, { kind: 'saved', routine: r.routine });
        navigation.goBack();
        return;
      }
      if (isNew) {
        const r = await services.routines.create({ edit: next, opId: opId.current });
        if (!r.ok) {
          setError(r.message);
          return;
        }
        finish({ key: opId.current, text: LIBRARY_TOASTS.saved(r.routine.name), undo: { kind: 'delete', routineId: r.routine.id, version: r.routine.version } });
        return;
      }
      if (expectedVersion === null) return;
      const r = await services.routines.update({ routineId, edit: next, expectedVersion, opId: opId.current });
      if (r.ok) {
        // A fresh copy's Undo still removes the copy (review S1); otherwise it puts the last version back.
        const undo = copyToast !== undefined ? { kind: 'delete' as const, routineId: r.routine.id, version: r.routine.version } : r.actionId === null ? null : { kind: 'revert' as const, actionId: r.actionId };
        finish({ key: opId.current, text: LIBRARY_TOASTS.saved(r.routine.name), undo });
        return;
      }
      if (r.reason === 'stale') {
        setPicks({});
        setStale({ current: r.current, lines: r.lines, changedAtUtc: r.changedAtUtc });
        return;
      }
      setError(r.message);
    } finally {
      setBusy(false);
    }
  }

  // Keep both (v0.1 §3.3): my edits on the newer version; a new opId, since it is a new save.
  // The newer version as the editor sees it (a pre-library workout's loads read as Auto), never raw (review S3).
  const merge = stale === null ? null : mergeRoutineEdits(base.current, edit, editableEdit(stale.current), picks);

  function keepBoth() {
    if (stale === null || merge === null) return;
    const current = stale.current;
    base.current = editableEdit(current);
    setName(merge.merged.name);
    setList([...merge.merged.exercises]);
    setStale(null);
    opId.current = newUuid();
    void save(merge.merged, current.version);
  }

  function discardMine() {
    setStale(null);
    opId.current = newUuid();
    load();
  }

  function exerciseActions(slot: RoutineExercise) {
    const options = [...exerciseMenu(list, slot.id), EDITOR_COPY.cancel];
    ActionSheetIOS.showActionSheetWithOptions({ title: nameOf(slot.exerciseId), options, cancelButtonIndex: options.length - 1, destructiveButtonIndex: options.indexOf(EDITOR_COPY.remove) }, (i) => {
      runExerciseAction(slot, options[i]);
    });
  }

  function runExerciseAction(slot: RoutineExercise, picked: string | undefined) {
    if (picked === EDITOR_COPY.replace) setAdding({ mode: 'replace', slotId: slot.id });
    if (picked === EDITOR_COPY.exerciseInfo) navigation.navigate('ExerciseInfo', { exerciseId: slot.exerciseId, name: nameOf(slot.exerciseId), readOnly: true });
    if (picked === EDITOR_COPY.supersetWithNext) setList((l) => supersetWithNext(l, slot.id) ?? l);
    if (picked === EDITOR_COPY.ungroup) setList((l) => ungroup(l, slot.id));
    if (picked === EDITOR_COPY.moveUp) setList((l) => moveExercise(l, slot.id, 'up'));
    if (picked === EDITOR_COPY.moveDown) setList((l) => moveExercise(l, slot.id, 'down'));
    if (picked === EDITOR_COPY.remove) setList((l) => removeExercise(l, slot.id));
  }

  function addMore(slot: RoutineExercise) {
    const options = [EDITOR_COPY.topSet, EDITOR_COPY.backoff, EDITOR_COPY.dropSet, EDITOR_COPY.cancel];
    const types: SetType[] = ['top', 'backoff', 'drop'];
    ActionSheetIOS.showActionSheetWithOptions({ options, cancelButtonIndex: 3 }, (i) => {
      const t = types[i];
      if (t !== undefined) setList((l) => addSet(l, slot.id, t, info[slot.exerciseId]?.measurement ?? 'reps', newUuid));
    });
  }

  const mains = editorMainFlags(list, isCompound);
  const sheetSlot = setSheet === null ? undefined : list.find((e) => e.id === setSheet.slotId);
  const restSlot = restSheet === null ? undefined : list.find((e) => e.id === restSheet);
  const shapeSlot = shapeSheet === null ? undefined : list.find((e) => e.id === shapeSheet.slotId);
  const shapeSlotView = shapeSlot === undefined ? null : slotShapeOf(shapeSlot);

  return (
    <KeyboardAvoidingView behavior="padding" style={{ flex: 1, backgroundColor: theme.colors['bg.canvas'] }}>
      <NumberAccessory />
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: theme.space['2'], paddingTop: theme.space['3'], minHeight: 52 }}>
        <TextButton label={EDITOR_COPY.cancel} tone="secondary" onPress={cancel} />
        <AppText variant="headline" accessibilityRole="header">
          {isNew ? EDITOR_COPY.newTitle : EDITOR_COPY.editTitle}
        </AppText>
        <View style={{ minWidth: 72 }} />
      </View>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingHorizontal: theme.components.screenMargin, paddingTop: theme.space['3'], paddingBottom: theme.space['8'], gap: theme.space['4'] }}>
        <View style={{ gap: theme.space['2'] }}>
          <AppText variant="label" color="text.secondary">
            {EDITOR_COPY.name}
          </AppText>
          <TextField accessibilityLabel={EDITOR_COPY.name} value={name} onChangeText={setName} autoFocus={isNew || selectName === true} selectTextOnFocus={selectName === true} returnKeyType="done" maxLength={160} />
          <AppText variant="callout" color="text.secondary" numeric>
            {editorSummaryLine(list.length, minutes, editor.gym?.name ?? null, workingSetTotal(list))}
          </AppText>
          {editor.inProgress ? <StatusLine icon="info.circle" tone="info" text={EDITOR_COPY.inProgress} /> : null}
        </View>

        <Eyebrow>{EDITOR_COPY.exercises}</Eyebrow>
        {list.map((slot, i) => {
          const x = info[slot.exerciseId];
          const rows = editorSetRows(slot, {
            exerciseName: nameOf(slot.exerciseId),
            convention: slotLoadConvention(slot, x?.defaultLoadConvention ?? 'total'),
            equipment: x && editor.gym ? editorItemFor(slot, x, editor.gym.equipment) : null,
            exerciseDefaultRestS: x?.defaultRestS ?? null,
            globalDefault: editor.globalDefault,
            perSide: x?.laterality === 'unilateral',
          });
          const main = mains[i] ?? false;
          const actions = exerciseMenu(list, slot.id);
          const shape = slotShapeOf(slot);
          const effort = shapeEffortRow(shape, editor.effortScale);
          const open = eachOpen[slot.id] ?? shape.hasSpecialSets;
          const slotIssue = editorSlotIssue(isRefusedDistanceSlot(slot, isDistance, stored));
          return (
            <View key={slot.id} style={{ backgroundColor: theme.colors['bg.surface'], borderRadius: theme.radius.md, paddingHorizontal: theme.space['4'], paddingVertical: theme.space['3'], gap: theme.space['2'], borderLeftWidth: slot.supersetGroup !== null ? 3 : 0, borderLeftColor: theme.colors['text.tertiary'] }}>
              {slot.supersetGroup !== null ? (
                <AppText variant="sectionLabel" color="text.tertiary">
                  {`Superset ${slot.supersetGroup}`}
                </AppText>
              ) : null}
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space['2'], minHeight: 44 }}>
                <AppText
                  variant="headline"
                  style={{ flex: 1 }}
                  accessibilityActions={actions.map((a) => ({ name: a, label: a }))}
                  onAccessibilityAction={(e) => {
                    runExerciseAction(slot, e.nativeEvent.actionName);
                  }}
                >
                  {`${String(i + 1)} ${nameOf(slot.exerciseId)}`}
                </AppText>
                {x?.defaultLoadConvention === 'bodyweight' ? (
                  <Chip
                    label={EDITOR_COPY.addWeight}
                    selected={slot.addedWeight === true}
                    onPress={() => {
                      setList((l) => setAddedWeight(l, slot.id, slot.addedWeight !== true));
                    }}
                  />
                ) : null}
                <Chip
                  label={EDITOR_COPY.main}
                  selected={main}
                  accessibilityLabel={mainChipLabel(main)}
                  onPress={() => {
                    setList((l) => setMain(l, slot.id, !main));
                  }}
                />
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`More, ${nameOf(slot.exerciseId)}`}
                  onPress={() => {
                    exerciseActions(slot);
                  }}
                  style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}
                >
                  <Icon name="ellipsis" />
                </Pressable>
              </View>
              {slotIssue !== null ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: theme.space['2'] }}>
                  <Icon name="exclamationmark.triangle" color="status.warning" size={14} />
                  <AppText variant="callout" color="status.warning" style={{ flex: 1 }}>
                    {slotIssue.text}
                  </AppText>
                  {slotIssue.actions.map((a) => (
                    <TextButton
                      key={a}
                      label={a}
                      onPress={() => {
                        runExerciseAction(slot, a);
                      }}
                    />
                  ))}
                </View>
              ) : null}
              <SetShapeControl
                workingSets={shape.workingSets}
                warmups={shape.warmups}
                setsLimits={stepperLimits(shape.workingSets, shape.setsDown, shape.setsUp)}
                warmupLimits={stepperLimits(shape.warmups, shape.warmupsDown, shape.warmupsUp)}
                onSets={(n) => {
                  setList((l) => setWorkingSetCount(l, slot.id, n, newUuid));
                }}
                onWarmups={(n) => {
                  setList((l) => setWarmupCount(l, slot.id, n, x?.measurement ?? 'reps', newUuid));
                }}
                reps={{ label: shape.reps === null && shape.durationS !== null ? SET_SHAPE_COPY.workTime : SET_SHAPE_COPY.reps, text: shapeRepsText(shape, x?.laterality === 'unilateral'), onPress: () => { setShapeSheet({ slotId: slot.id, kind: 'reps' }); } }}
                effort={effort === null ? null : { ...effort, onPress: () => { setShapeSheet({ slotId: slot.id, kind: 'effort' }); } }}
              />
              <Row
                title={EDITOR_COPY.restByType}
                onPress={() => {
                  setRestSheet(slot.id);
                }}
              />
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ expanded: open }}
                accessibilityLabel={`${SET_SHAPE_COPY.eachSet}, ${nameOf(slot.exerciseId)}`}
                onPress={() => {
                  setEachOpen((m) => ({ ...m, [slot.id]: !open }));
                }}
                style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', minHeight: 44, borderTopWidth: theme.dividerWidth, borderTopColor: theme.colors['border.divider'], opacity: pressed ? 0.7 : 1 })}
              >
                <AppText variant="body" style={{ flex: 1 }}>
                  {SET_SHAPE_COPY.eachSet}
                </AppText>
                <Icon name={open ? 'chevron.down' : 'chevron.right'} color="text.tertiary" size={14} />
              </Pressable>
              {open ? (
                <>
                  {rows.map((r) => (
                    <Pressable
                      key={r.setIds.join(',')}
                      accessibilityRole="button"
                      accessibilityLabel={r.accessibilityLabel}
                      onPress={() => {
                        setSetSheet({ slotId: slot.id, setIds: r.setIds });
                      }}
                      style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', minHeight: 44, gap: theme.space['2'], borderTopWidth: theme.dividerWidth, borderTopColor: theme.colors['border.divider'], opacity: pressed ? 0.7 : 1 })}
                    >
                      <View style={{ minWidth: 52, flexDirection: 'row', alignItems: 'center', gap: theme.space['1'] }}>
                        {r.badge !== null ? (
                          <View style={{ minWidth: 20, height: 20, borderRadius: 5, backgroundColor: theme.colors['bg.raised'], alignItems: 'center', justifyContent: 'center' }}>
                            <AppText variant="label" color="text.secondary">
                              {r.badge}
                            </AppText>
                          </View>
                        ) : null}
                        <AppText variant="callout" color="text.tertiary" numeric>
                          {r.numbers}
                        </AppText>
                      </View>
                      <AppText variant="callout" style={{ flex: 1 }}>
                        {r.typeWord}
                      </AppText>
                      <AppText variant="callout" numeric>
                        {r.target}
                      </AppText>
                      <AppText variant="callout" color="text.secondary" numeric>
                        {`${r.rest}${r.ownRest ? ' ●' : ''}`}
                      </AppText>
                    </Pressable>
                  ))}
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.space['2'], paddingTop: theme.space['1'] }}>
                    <Chip
                      label={EDITOR_COPY.addMore}
                      selected={false}
                      onPress={() => {
                        addMore(slot);
                      }}
                    />
                  </View>
                </>
              ) : null}
            </View>
          );
        })}
        <View style={{ alignSelf: 'flex-start' }}>
          <TextButton
            label={EDITOR_COPY.addExercise}
            icon="plus"
            onPress={() => {
              setAdding({ mode: 'add' });
            }}
          />
        </View>
      </ScrollView>
      <View style={{ paddingHorizontal: theme.components.screenMargin, paddingTop: theme.space['2'], paddingBottom: theme.space['3'] + insets.bottom, gap: theme.space['2'], backgroundColor: theme.colors['bg.canvas'] }}>
        {error ? <StatusLine icon="exclamationmark.triangle" tone="warning" text={error} /> : null}
        <PrimaryButton label={primary.label} disabled={primary.disabled} busy={busy} onPress={() => void save()} />
      </View>

      <SetSheet
        visible={setSheet !== null && sheetSlot !== undefined}
        slot={sheetSlot ?? null}
        setIds={setSheet?.setIds ?? []}
        info={sheetSlot ? info[sheetSlot.exerciseId] : undefined}
        editor={editor}
        onChange={(slotId, setIds, patch) => {
          setList((l) => setIds.reduce((acc, id) => updateSet(acc, slotId, id, patch), l));
        }}
        onDelete={(slotId, setId) => {
          const r = deleteSet(list, slotId, setId);
          if (r.kind === 'ok') {
            setList(r.list);
            setSetSheet((s) => (s === null ? null : { ...s, setIds: s.setIds.filter((x) => x !== setId) }));
            if ((setSheet?.setIds.length ?? 0) <= 1) setSetSheet(null);
            return;
          }
          const exercise = nameOf(list.find((e) => e.id === slotId)?.exerciseId ?? '');
          Alert.alert(EDITOR_COPY.removeExerciseTitle(exercise, workoutName), undefined, [
            { text: EDITOR_COPY.cancel, style: 'cancel' },
            {
              text: EDITOR_COPY.remove,
              style: 'destructive',
              onPress: () => {
                setSetSheet(null);
                setList((l) => removeExercise(l, slotId));
              },
            },
          ]);
        }}
        onClose={() => {
          setSetSheet(null);
        }}
      />
      <RestSheet
        visible={restSlot !== undefined}
        slot={restSlot ?? null}
        name={restSlot ? nameOf(restSlot.exerciseId) : ''}
        presets={editor.restPresets}
        onChange={(slotId, type, rest) => {
          setList((l) => setRestBySetType(l, slotId, type, rest));
        }}
        onClose={() => {
          setRestSheet(null);
        }}
      />
      <ShapeRepsSheet
        visible={shapeSheet?.kind === 'reps' && shapeSlot !== undefined}
        title={`${EDITOR_COPY.reps} · ${shapeSlot ? nameOf(shapeSlot.exerciseId) : ''}`}
        start={slotRepsDraft(shapeSlot?.setTemplates ?? [])}
        onDone={(v) => {
          const id = shapeSheet?.slotId;
          if (id !== undefined) setList((l) => setSlotReps(l, id, v));
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
          title={`${editor.effortScale === 'rpe' ? SET_SHAPE_COPY.targetRpe : SET_SHAPE_COPY.targetRir} · ${shapeSlot ? nameOf(shapeSlot.exerciseId) : ''}`}
          value={shapeSlotView === null ? null : editor.effortScale === 'rpe' ? shapeSlotView.targetRpe : shapeSlotView.targetRir}
          onPick={(v) => {
            const id = shapeSheet?.slotId;
            const scale = editor.effortScale;
            if (id !== undefined && scale !== null) setList((l) => setSlotTargetRpe(l, id, v, scale));
          }}
          onClose={() => {
            setShapeSheet(null);
          }}
        />
      ) : null}
      <AddExerciseSheet
        visible={adding !== null}
        title={adding?.mode === 'replace' ? EDITOR_COPY.replace : EDITOR_COPY.addExercise}
        withSets={adding?.mode === 'add'}
        onPick={(x, sets) => {
          setInfo((cur) => ({ ...cur, [x.id]: x }));
          const a = adding;
          setAdding(null);
          if (a === null) return;
          // The bar's count and the §10.1 defaults (the exercise's rule reps, no warm-ups, Auto loads).
          if (a.mode === 'add') setList((l) => addExercise(l, { id: x.id, measurement: x.measurement }, newUuid, { ...x.defaultShape, workingSets: sets }));
          else setList((l) => replaceExercise(l, a.slotId, { id: x.id, measurement: x.measurement }));
        }}
        onClose={() => {
          setAdding(null);
        }}
      />
      <BottomCard
        visible={stale !== null}
        onClose={() => {
          setStale(null);
        }}
      >
        {stale !== null && merge !== null ? (
          <ConflictBody stale={stale} conflicts={merge.conflicts} picks={picks} nameOf={nameOf} tz={services.now().tz} onPick={(k, v) => { setPicks((p) => ({ ...p, [k]: v })); }} onKeepBoth={keepBoth} onDiscard={discardMine} />
        ) : null}
      </BottomCard>
    </KeyboardAvoidingView>
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

/** The set sheet (§A2.3, v0.1 §2.3 without % of top set, AMRAP and effort): type, Auto / Fixed, reps or work time, this set's rest. Changes apply to every set of the row. */
function SetSheet({
  visible,
  slot,
  setIds,
  info,
  editor,
  onChange,
  onDelete,
  onClose,
}: {
  visible: boolean;
  slot: RoutineExercise | null;
  setIds: string[];
  info: EditorExerciseInfo | undefined;
  editor: RoutineEditorData;
  onChange: (slotId: string, setIds: string[], patch: Partial<SetTemplate>) => void;
  onDelete: (slotId: string, setId: string) => void;
  onClose: () => void;
}) {
  const theme = useTheme();
  const t = slot?.setTemplates.find((x) => x.id === setIds[0]) ?? null;
  const index = slot && t ? slot.setTemplates.indexOf(t) + 1 : 0;
  const convention = slot ? slotLoadConvention(slot, info?.defaultLoadConvention ?? 'total') : (info?.defaultLoadConvention ?? 'total');
  const own: EquipmentInstance | null = slot && info && editor.gym ? editorItemFor(slot, info, editor.gym.equipment) : null;
  const item: EquipmentInstance | null = slot && info && editor.gym ? editorLoadItem(slot, info, editor.gym, editor.unit) : null;
  const weighted = convention === 'added' && info?.defaultLoadConvention === 'bodyweight';
  const frame = weighted ? { unit: editor.unit, convention } : fixedLoadFrame(item, editor.unit, convention);
  const bodyweight = convention === 'bodyweight';
  const timed = info?.measurement === 'duration';
  const set = (patch: Partial<SetTemplate>) => {
    if (slot) onChange(slot.id, setIds, patch);
  };
  const preset = t && slot ? (slot.restBySetType[t.setType]?.seconds ?? null) : null;
  return (
    <BottomCard visible={visible} onClose={onClose} closeLabel={EDITOR_COPY.done}>
      {slot && t ? (
        <ScrollView style={{ flexGrow: 0 }} keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: theme.space['4'] }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <AppText variant="title2" accessibilityRole="header" style={{ flex: 1 }} numeric>
              {`${setIds.length > 1 ? `Sets ${String(index)}–${String(index + setIds.length - 1)}` : `Set ${String(index)}`} · ${info?.name ?? 'Exercise'}`}
            </AppText>
            <TextButton label={EDITOR_COPY.done} onPress={onClose} />
          </View>
          <View style={{ gap: theme.space['2'] }}>
            <AppText variant="label" color="text.secondary">
              {EDITOR_COPY.type}
            </AppText>
            <ChipRow>
              {SET_TYPES.map((x) => (
                <Chip key={x.type} label={x.label} selected={t.setType === x.type} onPress={() => { set({ setType: x.type }); }} />
              ))}
            </ChipRow>
          </View>
          {!bodyweight ? (
            <View style={{ gap: theme.space['2'] }}>
              <AppText variant="label" color="text.secondary">
                {EDITOR_COPY.load}
              </AppText>
              <ChipRow>
                <Chip label={EDITOR_COPY.auto} selected={t.targetLoad === null} onPress={() => { set({ targetLoad: null }); }} />
                <Chip
                  label={EDITOR_COPY.fixed}
                  selected={t.targetLoad !== null}
                  onPress={() => {
                    if (t.targetLoad === null) {
                      const steps = fixedLoadSteps(null, frame, item, weighted ? own : item);
                      set({ targetLoad: { value: steps.up.enabled ? steps.up.value : 0, unit: frame.unit, convention: frame.convention } });
                    }
                  }}
                />
              </ChipRow>
              {t.targetLoad === null ? (
                <InfoLine text={EDITOR_COPY.auto} info={EDITOR_COPY.autoInfo} variant="callout" infoLabel="About Auto" />
              ) : (
                <FixedLoad
                  value={t.targetLoad.value}
                  frame={{ unit: t.targetLoad.unit, convention: t.targetLoad.convention }}
                  item={item}
                  display={weighted ? own : item}
                  onChange={(v) => {
                    set({ targetLoad: v === null ? null : { value: v, unit: t.targetLoad?.unit ?? frame.unit, convention: t.targetLoad?.convention ?? frame.convention } });
                  }}
                />
              )}
            </View>
          ) : null}
          {timed ? (
            <NumberStepper
              label={EDITOR_COPY.workTime}
              unit="s"
              value={t.targetDurationS}
              decimals={false}
              onSurface
              down={(t.targetDurationS ?? 0) > 5 ? { enabled: true, value: (t.targetDurationS ?? 0) - 5, label: `${String((t.targetDurationS ?? 0) - 5)} s` } : { enabled: false, reason: 'Min 5 s' }}
              up={{ enabled: true, value: (t.targetDurationS ?? 0) + 5, label: `${String((t.targetDurationS ?? 0) + 5)} s` }}
              onChange={(v) => {
                set({ targetDurationS: v === null ? null : Math.max(1, Math.round(v)) });
              }}
            />
          ) : (
            <Reps value={t.targetReps} onChange={(r) => { set({ targetReps: r }); }} />
          )}
          <View style={{ gap: theme.space['2'] }}>
            <AppText variant="label" color="text.secondary">
              {EDITOR_COPY.restAfter}
            </AppText>
            <ChipRow>
              <Chip label={preset === null ? EDITOR_COPY.useDefault : formatDuration(preset)} selected={t.restOverrideS === null} onPress={() => { set({ restOverrideS: null }); }} />
              <Chip
                label={t.restOverrideS === null ? EDITOR_COPY.thisSetOnly : `${EDITOR_COPY.thisSetOnly} · ${formatDuration(t.restOverrideS)}`}
                selected={t.restOverrideS !== null}
                onPress={() => {
                  const choices = restChoices(editor.restPresets);
                  const options = [...choices.map((c) => c.label), EDITOR_COPY.cancel];
                  ActionSheetIOS.showActionSheetWithOptions({ options, cancelButtonIndex: options.length - 1 }, (i) => {
                    const c = choices[i];
                    if (c !== undefined) set({ restOverrideS: c.seconds });
                  });
                }}
              />
            </ChipRow>
          </View>
          <DangerTextButton
            label={EDITOR_COPY.deleteSet}
            onPress={() => {
              const last = setIds[setIds.length - 1];
              if (last !== undefined) onDelete(slot.id, last);
            }}
          />
        </ScrollView>
      ) : null}
    </BottomCard>
  );
}

function FixedLoad({ value, frame, item, display, onChange }: { value: number; frame: { unit: WeightUnit; convention: LoadConvention }; item: EquipmentInstance | null; display: EquipmentInstance | null; onChange: (v: number | null) => void }) {
  const steps = fixedLoadSteps(value, frame, item, display);
  const note = fixedLoadNote({ value, unit: frame.unit, convention: frame.convention }, item, display);
  const assist = frame.convention === 'assistance';
  const added = frame.convention === 'added' && display?.kind !== 'plate_loaded_machine';
  return (
    <View style={{ gap: 6 }}>
      <NumberStepper label={assist ? 'Assist' : added ? 'Added' : 'Load'} unit={`${frame.unit}${frame.convention === 'per_hand' ? ' each' : ''}`} value={value} decimals down={steps.down} up={steps.up} onChange={onChange} warning={note !== null} onSurface />
      {note !== null ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Icon name="exclamationmark.triangle" color="status.warning" size={14} />
          <AppText variant="callout" color="text.secondary" numeric style={{ flex: 1 }}>
            {note}
          </AppText>
        </View>
      ) : null}
    </View>
  );
}

function Reps({ value, onChange }: { value: SetTemplate['targetReps']; onChange: (r: SetTemplate['targetReps']) => void }) {
  const theme = useTheme();
  const r = value ?? { min: 8, max: 10 };
  const exact = r.min === r.max;
  const step = (v: number, min: number) => ({ down: v > min ? { enabled: true as const, value: v - 1, label: String(v - 1) } : { enabled: false as const, reason: `Min ${String(min)}` }, up: v < 100 ? { enabled: true as const, value: v + 1, label: String(v + 1) } : { enabled: false as const, reason: 'Max 100' } });
  const clamp = (v: number | null) => Math.max(1, Math.min(100, Math.round(v ?? 1)));
  return (
    <View style={{ gap: theme.space['2'] }}>
      <AppText variant="label" color="text.secondary">
        {EDITOR_COPY.reps}
      </AppText>
      <ChipRow>
        <Chip label={EDITOR_COPY.range} selected={!exact} onPress={() => { onChange({ min: r.min, max: Math.max(r.max, r.min + 2) }); }} />
        <Chip label={EDITOR_COPY.exact} selected={exact} onPress={() => { onChange({ min: r.min, max: r.min }); }} />
      </ChipRow>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.space['2'] }}>
        <NumberStepper label={exact ? 'Reps' : 'From'} unit={null} value={r.min} decimals={false} onSurface {...step(r.min, 1)} onChange={(v) => { const min = clamp(v); onChange({ min, max: exact ? min : r.max }); }} warning={r.min > r.max} />
        {!exact ? <NumberStepper label="To" unit={null} value={r.max} decimals={false} onSurface {...step(r.max, 1)} onChange={(v) => { onChange({ min: r.min, max: clamp(v) }); }} warning={r.min > r.max} /> : null}
      </View>
      {r.min > r.max ? (
        <AppText variant="callout" color="status.warning">
          Reps: the first number must be the smaller one.
        </AppText>
      ) : null}
    </View>
  );
}

/** `Rest by set type` (§2.3): one choice per set type used here; `Use default` clears it so resolution falls through. */
function RestSheet({ visible, slot, name, presets, onChange, onClose }: { visible: boolean; slot: RoutineExercise | null; name: string; presets: RoutineEditorData['restPresets']; onChange: (slotId: string, type: SetType, rest: { seconds: number; presetName?: string } | null) => void; onClose: () => void }) {
  const theme = useTheme();
  const used = slot === null ? [] : SET_TYPES.filter((x) => slot.setTemplates.some((t) => t.setType === x.type));
  return (
    <BottomCard visible={visible} onClose={onClose} closeLabel={EDITOR_COPY.done}>
      {slot ? (
        <View style={{ gap: theme.space['3'] }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <AppText variant="title2" accessibilityRole="header" style={{ flex: 1 }}>
              {`${EDITOR_COPY.restByType} · ${name}`}
            </AppText>
            <TextButton label={EDITOR_COPY.done} onPress={onClose} />
          </View>
          {used.map((x) => {
            const cur = slot.restBySetType[x.type] ?? null;
            return (
              <Row
                key={x.type}
                title={x.label}
                subtitle={cur === null ? EDITOR_COPY.useDefault : `${cur.presetName ? `${cur.presetName} ` : ''}${formatDuration(cur.seconds)}`}
                onPress={() => {
                  const choices = restChoices(presets);
                  const options = [EDITOR_COPY.useDefault, ...choices.map((c) => c.label), EDITOR_COPY.cancel];
                  ActionSheetIOS.showActionSheetWithOptions({ title: x.label, options, cancelButtonIndex: options.length - 1 }, (i) => {
                    if (i === 0) onChange(slot.id, x.type, null);
                    const c = choices[i - 1];
                    if (i > 0 && c !== undefined) {
                      const named = presets.find((p) => p.seconds === c.seconds && p.presetName !== undefined);
                      onChange(slot.id, x.type, named?.presetName !== undefined ? { seconds: c.seconds, presetName: named.presetName } : { seconds: c.seconds });
                    }
                  });
                }}
              />
            );
          })}
        </View>
      ) : null}
    </BottomCard>
  );
}

/**
 * `Add exercise` / `Replace`: Ben's exercises and the catalogue's, by name,
 * aliases and one typo (EL1). `Add` has the `Sets [−] 3 [+]` bar
 * (exercise-library §10.3), starting at 3 each time; `Replace` keeps the
 * slot's sets. A distance exercise shows disabled: a saved workout can't
 * hold distance yet (EL-B13).
 */
function AddExerciseSheet({ visible, title, withSets, onPick, onClose }: { visible: boolean; title: string; withSets: boolean; onPick: (x: EditorExerciseInfo, sets: number) => void; onClose: () => void }) {
  const services = useServices();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<EditorExerciseInfo[]>([]);
  const [sets, setSets] = useState<number>(SET_BAR.start);
  useEffect(() => {
    if (visible) setSets(SET_BAR.start);
  }, [visible]);
  useEffect(() => {
    if (!visible) return;
    let live = true;
    void services.routines
      .searchExercises(query)
      .then((r) => {
        if (live) setResults(r);
      })
      .catch(() => {
        if (live) setResults([]);
      });
    return () => {
      live = false;
    };
  }, [services, query, visible]);
  return (
    <BottomCard visible={visible} onClose={onClose} closeLabel={EDITOR_COPY.cancel}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <AppText variant="title2" accessibilityRole="header">
          {title}
        </AppText>
        <TextButton label={EDITOR_COPY.cancel} tone="secondary" onPress={onClose} />
      </View>
      <TextField accessibilityLabel={EDITOR_COPY.search} placeholder={EDITOR_COPY.search} value={query} onChangeText={setQuery} autoCorrect={false} returnKeyType="search" />
      <ScrollView style={{ flexGrow: 0, flexShrink: 1, maxHeight: 420 }} keyboardShouldPersistTaps="handled">
        {results.map((x) => {
          const row = editorAddRow(x);
          return (
            <Row
              key={x.id}
              title={x.name}
              subtitle={row.subtitle}
              disabled={row.disabled}
              onPress={() => {
                if (row.disabled) return;
                setQuery('');
                onPick(x, sets);
              }}
            />
          );
        })}
      </ScrollView>
      {withSets ? <SetCountBar value={sets} limits={SET_BAR.limits} onChange={setSets} /> : null}
    </BottomCard>
  );
}
