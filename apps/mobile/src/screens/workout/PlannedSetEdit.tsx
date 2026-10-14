import { useNavigation } from '@react-navigation/native';
import { useState } from 'react';
import { ScrollView, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { toggleRepRange, type PlannedSetEdits } from '@fizz/domain';

import { newUuid } from '../../device/runtime';
import { returnToWorkout } from '../../navigation/actions';
import type { ActiveWorkoutData } from '../../services/workout-services';
import { useDataChanged, useServices } from '../../shell/context';
import { useTheme } from '../../theme';
import { AppText, Chip, ChipRow, DangerTextButton, NumberAccessory, NumberStepper, PrimaryButton, SecondaryButton, StatusLine, StepperTileRow, TextButton, TextField } from '../../ui';
import { targetRpeChips } from '../../workout/exercise-menu';
import { NOTE_MAX, noteChanged, noteValue } from '../../workout/notes';
import { committedLoad, loadNeedsFit, plannedEditSave } from '../../workout/set-edit';
import { stepperRowTiles } from '../../workout/tile-fit';
import { correctionToastText, UNDO_TOAST } from '../../workout/undo-op';

/**
 * Edit set for a set not done yet (14 Oct, Ben: "I should be able to edit
 * anything on the sets"): its target (load through achievable loads only; a
 * typed load is fitted to the equipment), reps exact or a range, set type,
 * target RPE, rest after it and a note. `Save changes` is one versioned
 * `edit_planned_set` with `Set 3 updated` [Undo]. `Do next` makes it the set
 * Log logs; `Insert set after` and `Delete set` apply at once with Undo.
 * Every value comes from `buildPlannedSetEditView`; nothing is computed here.
 */
export function PlannedSetEdit({ data, setId, error, onRefused }: { data: ActiveWorkoutData; setId: string; error: string | null; onRefused: (message: string) => void }) {
  const theme = useTheme();
  const services = useServices();
  const changed = useDataChanged();
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const { width: windowWidth } = useWindowDimensions();
  const [edits, setEdits] = useState<PlannedSetEdits>({});
  /** The load as typed (fitted to the equipment for the view and the save); undefined = untouched. */
  const [typedLoad, setTypedLoad] = useState<number | null | undefined>(undefined);
  const [noteText, setNoteText] = useState<string | null>(null);
  const [saveOp] = useState(newUuid);
  const [noteOp] = useState(newUuid);
  const [insertOp] = useState(newUuid);
  const [deleteOp] = useState(newUuid);
  const aggregate = data.aggregate;
  const snapped = typedLoad === undefined ? undefined : services.workout.snapPlannedLoad(data, setId, typedLoad);
  const view = services.workout.plannedEditView(data, setId, { ...edits, ...(snapped !== undefined ? { load: snapped } : {}) });
  const set = aggregate.sets.find((s) => s.id === setId);
  if (!view || !set) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.colors['bg.surface'], padding: theme.space['4'] }}>
        <TextButton label="Close" onPress={() => { navigation.goBack(); }} />
      </View>
    );
  }
  const storedNote = set.note ?? null;
  const noteEdited = noteText !== null && noteChanged(storedNote, noteText);
  const sessionId = aggregate.session.id;

  async function save() {
    if (!view) return;
    // S1: a typed load the equipment can't make turns into the one it can first; the next Save saves what's shown.
    if (loadNeedsFit(typedLoad, snapped)) {
      setTypedLoad(committedLoad(typedLoad, snapped));
      return;
    }
    const r = await plannedEditSave({
      patch: view.patch,
      note: noteEdited ? noteValue(noteText) : undefined,
      sessionVersion: aggregate.session.version,
      edit: (patch) => services.workout.editPlannedSet({ sessionId, setId, expectedSetVersion: view.setVersion, patch, opId: saveOp }),
      setNote: (note, expectedVersion) => services.workout.setNote({ sessionId, target: { kind: 'set', setId }, note, expectedVersion, opId: noteOp }),
    });
    if (r.kind === 'refused') {
      setEdits({});
      setTypedLoad(undefined);
      onRefused(r.message);
      return;
    }
    changed();
    if (r.kind === 'edited') {
      navigation.dispatch(returnToWorkout({ toast: { kind: 'undo_op', text: correctionToastText(UNDO_TOAST.corrected(view.setNumber), r.noteFailed), targetOpId: saveOp } }));
      return;
    }
    navigation.goBack();
  }

  async function doNext() {
    const r = await services.workout.dispatch(sessionId, { type: 'set_active_set', at: services.now(), opId: newUuid(), setId, expectedVersion: aggregate.session.version });
    if (!r.ok) {
      onRefused(r.error.code === 'stale_version' ? 'The workout changed. Try again.' : r.error.message);
      return;
    }
    changed();
    navigation.goBack();
  }

  async function insertAfter() {
    const r = await services.workout.addSet({ sessionId, sessionExerciseId: set?.sessionExerciseId ?? '', opId: insertOp, newSetId: newUuid(), afterSetId: setId });
    if (!r.ok) {
      onRefused(r.error.code === 'stale_version' || r.error.code === 'write_conflict' ? 'The workout changed. Try again.' : r.error.message);
      return;
    }
    changed();
    navigation.dispatch(returnToWorkout({ toast: { kind: 'undo_op', text: UNDO_TOAST.added((view?.setNumber ?? 0) + 1), targetOpId: insertOp } }));
  }

  async function remove() {
    if (!view) return;
    // No confirm (copy D4): the workout screen offers Undo.
    const r = await services.workout.dispatch(sessionId, { type: 'delete_set', at: services.now(), opId: deleteOp, setId, expectedSetVersion: view.setVersion });
    if (!r.ok) {
      onRefused(r.error.message);
      return;
    }
    changed();
    navigation.dispatch(returnToWorkout({ toast: { kind: 'undo_op', text: UNDO_TOAST.deleted(view.setNumber), targetOpId: deleteOp } }));
  }

  const reps = view.reps;
  const loadValue = typedLoad === undefined ? (view.loadField?.value ?? null) : typedLoad;
  const offEquipment = typedLoad !== undefined && typedLoad !== null && snapped !== typedLoad;

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors['bg.surface'] }}>
      <NumberAccessory />
      <ScrollView contentContainerStyle={{ padding: theme.space['4'], gap: theme.space['4'], paddingBottom: theme.space['8'] + insets.bottom }} keyboardShouldPersistTaps="handled">
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <AppText variant="title2" accessibilityRole="header" style={{ flex: 1 }}>{`Edit set ${String(view.setNumber)} · ${view.exerciseName}`}</AppText>
          <TextButton label="Cancel" tone="secondary" icon="xmark" onPress={() => { navigation.goBack(); }} />
        </View>
        <StepperTileRow
          tiles={stepperRowTiles({
            loadFlex: 1,
            load: view.loadField ? { ...view.loadField, value: loadValue, unit: view.loadField.unitText } : null,
            time: view.duration,
            distance: view.distance,
            reps: reps ? reps.min : null,
          })}
          estimate={windowWidth - 2 * theme.space['4']}
        >
          {({ numeralSize, compact, flexOf }) => (
            <>
              {view.loadField ? (
                <NumberStepper
                  onSurface
                  flex={flexOf(1)}
                  numeralSize={numeralSize}
                  compact={compact}
                  label={view.loadField.label}
                  unit={view.loadField.unitText}
                  value={loadValue}
                  decimals
                  down={view.loadField.down}
                  up={view.loadField.up}
                  warning={offEquipment}
                  hint={view.loadField.assisted ? 'More assistance is easier' : null}
                  onChange={(v) => {
                    setTypedLoad(v);
                  }}
                  onBlur={() => {
                    setTypedLoad(committedLoad(typedLoad, snapped));
                  }}
                />
              ) : null}
              {view.duration ? (
                <NumberStepper onSurface flex={flexOf(1)} numeralSize={numeralSize} compact={compact} label="Time" unit="s" value={view.duration.value} decimals={false} down={view.duration.down} up={view.duration.up} onChange={(v) => { setEdits({ ...edits, durationS: v === null ? null : Math.max(0, Math.round(v)) }); }} />
              ) : null}
              {view.distance ? (
                <NumberStepper onSurface flex={flexOf(1)} numeralSize={numeralSize} compact={compact} label="Distance" unit="m" value={view.distance.value} decimals down={view.distance.down} up={view.distance.up} onChange={(v) => { setEdits({ ...edits, distanceM: v === null ? null : Math.max(0, v) }); }} />
              ) : null}
              {reps ? (
                <NumberStepper
                  onSurface
                  flex={flexOf(1)}
                  numeralSize={numeralSize}
                  compact={compact}
                  label={reps.range ? 'Reps from' : 'Reps'}
                  unit={null}
                  value={reps.min.value}
                  decimals={false}
                  down={reps.min.down}
                  up={reps.min.up}
                  onChange={(v) => {
                    const n = v === null ? null : Math.max(1, Math.round(v));
                    const max = reps.max?.value ?? null;
                    setEdits({ ...edits, reps: n === null ? null : { min: n, max: reps.range && max !== null ? Math.max(max, n) : n } });
                  }}
                />
              ) : null}
            </>
          )}
        </StepperTileRow>
        {reps ? (
          <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: theme.space['3'] }}>
            <ChipRow>
              <Chip
                label="Range"
                selected={reps.range}
                onPress={() => {
                  const now = reps.min.value === null ? null : { min: reps.min.value, max: reps.max?.value ?? reps.min.value };
                  setEdits({ ...edits, reps: toggleRepRange(now) });
                }}
              />
            </ChipRow>
            {reps.max ? (
              <NumberStepper
                onSurface
                flex={1}
                label="to"
                unit={null}
                value={reps.max.value}
                decimals={false}
                down={reps.max.down}
                up={reps.max.up}
                onChange={(v) => {
                  const min = reps.min.value ?? 1;
                  setEdits({ ...edits, reps: { min, max: v === null ? min : Math.max(min, Math.round(v)) } });
                }}
              />
            ) : null}
          </View>
        ) : null}
        <AppText variant="callout" color="text.secondary" numeric>
          {view.text}
        </AppText>
        {view.targetRpe ? (
          <View style={{ gap: theme.space['1'] }}>
            <AppText variant="label" color="text.secondary">
              Target RPE
            </AppText>
            <ChipRow>
              {targetRpeChips(view.targetRpe).map((c) => (
                <Chip
                  key={c.key}
                  label={c.label}
                  selected={c.selected}
                  onPress={() => {
                    setEdits({ ...edits, targetRpe: c.value });
                  }}
                />
              ))}
            </ChipRow>
          </View>
        ) : null}
        <View style={{ gap: theme.space['2'] }}>
          <AppText variant="label" color="text.secondary">
            Set type
          </AppText>
          <ChipRow>
            {view.setType.choices.map((c) => (
              <Chip
                key={c.type}
                label={c.label}
                selected={c.selected}
                onPress={() => {
                  setEdits({ ...edits, setType: c.type });
                }}
              />
            ))}
          </ChipRow>
        </View>
        <View style={{ gap: theme.space['2'] }}>
          <AppText variant="label" color="text.secondary">
            Rest after
          </AppText>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space['3'] }}>
            <SecondaryButton label="−15 s" accessibilityLabel="Rest 15 seconds shorter" disabled={!view.rest.down.enabled} onPress={() => { if (view.rest.down.enabled) setEdits({ ...edits, restS: view.rest.down.value }); }} />
            <AppText variant="title2" numeric style={{ minWidth: 72, textAlign: 'center' }} accessibilityLabel={`Rest after this set ${view.rest.text}`}>
              {view.rest.text}
            </AppText>
            <SecondaryButton label="+15 s" accessibilityLabel="Rest 15 seconds longer" disabled={!view.rest.up.enabled} onPress={() => { if (view.rest.up.enabled) setEdits({ ...edits, restS: view.rest.up.value }); }} />
          </View>
        </View>
        <View style={{ gap: theme.space['2'] }}>
          <AppText variant="label" color="text.secondary">
            Note
          </AppText>
          <TextField accessibilityLabel="Note" value={noteText ?? storedNote ?? ''} onChangeText={setNoteText} multiline maxLength={NOTE_MAX} />
        </View>
        {error ? <StatusLine icon="info.circle" tone="info" text={error} /> : null}
        <PrimaryButton label="Save changes" disabled={!view.changed && !noteEdited} onPress={() => void save()} />
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.space['3'] }}>
          {!view.isCurrent ? <SecondaryButton label="Do next" onPress={() => void doNext()} /> : null}
          <SecondaryButton label="Insert set after" onPress={() => void insertAfter()} />
        </View>
        <View style={{ height: theme.space['8'] }} />
        <DangerTextButton label="Delete set" onPress={() => void remove()} />
      </ScrollView>
    </View>
  );
}
