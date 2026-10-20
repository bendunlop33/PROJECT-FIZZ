import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import { useEffect, useState } from 'react';
import { ScrollView, useWindowDimensions, View } from 'react-native';

import { EXCLUSION_HEADING, EXCLUSION_LABEL, EXCLUSION_ORDER, toMs } from '@fizz/domain';
import type { SetExclusion, SetType, SetValues } from '@fizz/schemas';

import { newUuid } from '../../device/runtime';
import type { ActiveWorkoutData } from '../../services/workout-services';
import { formatTime } from '../../format/dates';
import { returnToWorkout } from '../../navigation/actions';
import { targetRpeChips } from '../../workout/exercise-menu';
import type { RootStackParams } from '../../navigation/types';
import { useDataChanged, useServices } from '../../shell/context';
import { correctionToastText, UNDO_TOAST } from '../../workout/undo-op';
import { useTheme } from '../../theme';
import { WORKOUT_KEYBOARD } from '../../workout/keyboard';
import { ActionBar, AppText, Chip, ChipRow, DangerTextButton, EffortHeading, NUMBER_ACCESSORY_ID, NumberAccessory, NumberStepper, SecondaryButton, SheetKeyboardAvoidingView, StatusLine, StepperTileRow, TextButton, TextField, useKeyboardVisible } from '../../ui';
import { PlannedSetEdit } from './PlannedSetEdit';
import { NOTE_MAX, noteChanged, noteValue } from '../../workout/notes';
import { stepperRowTiles } from '../../workout/tile-fit';

/**
 * Correction sheet for a logged set (active-workout §4.4): `correct_set`
 * guarded on the set's own version; the rest timer is never touched.
 * `Delete set` deletes at once and keeps an audited record; the workout
 * screen shows `Set 2 deleted` [Undo] (copy D4). A value change hands back
 * `Set 2 updated` [Undo]. The exclusion chips (§2.13) save in the same
 * `correct_set`; their toast (with its own Undo) wins when they changed.
 * In an active workout, `Target RPE` sets Ben's own target for this set in
 * the same `correct_set` (CHANGELOG 2026-10-11 (b) "Edit set"); the offer
 * check runs on it again (F4). A set not done yet opens `PlannedSetEdit`
 * instead (14 Oct): its plan, never a result.
 */
export function EditSetScreen() {
  const theme = useTheme();
  const services = useServices();
  const changed = useDataChanged();
  const navigation = useNavigation();
  const keyboard = useKeyboardVisible();
  const { width: windowWidth } = useWindowDimensions();
  const { sessionId, setId } = useRoute<RouteProp<RootStackParams, 'EditSet'>>().params;
  const [data, setData] = useState<ActiveWorkoutData | null>(null);
  const aggregate = data?.aggregate ?? null;
  const [values, setValues] = useState<SetValues | null>(null);
  const [exclusions, setExclusions] = useState<SetExclusion[] | null>(null);
  const [setType, setSetType] = useState<SetType | null>(null);
  /** Ben's target RPE as edited: a value, null cleared, undefined untouched. */
  const [targetRpe, setTargetRpe] = useState<number | null | undefined>(undefined);
  const [effortScale, setEffortScale] = useState<'rpe' | 'rir' | 'off'>('rpe');
  const [error, setError] = useState<string | null>(null);
  const [saveOp] = useState(newUuid);
  const [deleteOp] = useState(newUuid);
  const [noteOp] = useState(newUuid);
  const [insertOp] = useState(newUuid);
  const [modeOp] = useState(newUuid);
  /** The note field as typed; null = untouched (shows the stored note). */
  const [noteText, setNoteText] = useState<string | null>(null);

  async function load() {
    const d = await services.workout.load(sessionId);
    if (!d) return;
    setData(d);
    setEffortScale(d.effortScale);
  }
  useEffect(() => {
    void load();
  }, [sessionId, setId]);

  const view = data ? services.workout.editView(data, setId, values, exclusions, targetRpe, setType) : null;
  // A set not done yet edits its plan (14 Oct): target, type, target RPE, rest, note.
  if (data && aggregate?.session.status === 'active' && aggregate.sets.find((s) => s.id === setId)?.status === 'pending') {
    // Keyed on the revision so a reload starts fresh; the refusal lives here so it survives that remount (review S4).
    return (
      <PlannedSetEdit
        key={`${setId}:${String(aggregate.revision)}`}
        data={data}
        setId={setId}
        error={error}
        onRefused={(message) => {
          setError(message);
          void load();
        }}
        onReload={() => {
          setError(null);
          void load();
        }}
      />
    );
  }
  if (!aggregate || !view) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.colors['bg.surface'], padding: theme.space['4'] }}>
        <AppText variant="body">{aggregate ? 'This set isn’t logged any more.' : ''}</AppText>
        {aggregate ? <TextButton label="Close" onPress={() => { navigation.goBack(); }} /> : null}
      </View>
    );
  }
  const ex = aggregate.exercises.find((e) => aggregate.sets.find((s) => s.id === setId)?.sessionExerciseId === e.id);
  const tz = aggregate.session.startedAt.tz;
  const current = view.values;

  const storedNote = aggregate.sets.find((s) => s.id === setId)?.note ?? null;
  const noteEdited = noteText !== null && noteChanged(storedNote, noteText);

  async function save() {
    if (!view || !aggregate) return;
    const actual = aggregate.sets.find((s) => s.id === setId)?.actual;
    if (!actual) return;
    let sessionVersion = aggregate.session.version;
    let modeFailed = false;
    let corrected: Extract<Awaited<ReturnType<typeof services.workout.correctSet>>, { ok: true }> | null = null;
    const patch: Parameters<typeof services.workout.correctSet>[0]['patch'] = {};
    if (view.changed) {
      for (const k of ['load', 'reps', 'durationS', 'distanceM', 'rpe', 'rir'] as const) {
        if (JSON.stringify(current[k]) !== JSON.stringify(actual[k])) Object.assign(patch, { [k]: current[k] });
      }
      if (exclusions !== null) patch.exclusions = view.exclusions;
      if (view.setType.changed) patch.setType = view.setType.value;
      if (view.targetRpe?.changed === true) patch.targetRpe = view.targetRpe.override;
      const r = await services.workout.correctSet({ sessionId, setId, expectedSetVersion: view.setVersion, patch, opId: saveOp });
      if (!r.ok) {
        setError(r.message);
        setValues(null);
        setExclusions(null);
        setSetType(null);
        setTargetRpe(undefined);
        void load();
        return;
      }
      corrected = r;
      sessionVersion = r.aggregate.session.version;
      // `+ Weight` (or back) on a logged set: the rest of today's sets of this exercise follow it.
      const mode = patch.load?.convention;
      if (ex && aggregate.session.status === 'active' && view.addWeight && (mode === 'added' || mode === 'bodyweight') && mode !== ex.loadConvention) {
        const m = await services.workout.dispatch(sessionId, { type: 'set_load_mode', at: services.now(), opId: modeOp, expectedVersion: sessionVersion, sessionExerciseId: ex.id, mode });
        // The correction is saved either way; say when the other sets didn't follow (review S2).
        if (m.ok) sessionVersion = m.aggregate.session.version;
        else modeFailed = true;
      }
    }
    // The set's note (Your data) is its own versioned write; it never changes a value.
    let noteFailed = false;
    if (noteEdited) {
      const n = await services.workout.setNote({ sessionId, target: { kind: 'set', setId }, note: noteValue(noteText), expectedVersion: sessionVersion, opId: noteOp });
      if (!n.ok) {
        // No correction saved: stay and say so. A correction saved: hand over its Undo toast anyway (review gaps N7).
        if (corrected === null || corrected.duplicate) {
          setError(n.error.code === 'stale_version' ? 'The workout changed. Try again.' : n.error.message);
          void load();
          return;
        }
        noteFailed = true;
      }
    }
    changed();
    const withNote = (text: string) => {
      const t = correctionToastText(text, noteFailed);
      return modeFailed ? `${t} · other sets unchanged` : t;
    };
    // F4: a corrected rep or effort count, the set's target RPE or its type, runs the same offer check as a log (rule T: every logged working set).
    const effortOrReps = corrected !== null && (patch.reps !== undefined || patch.rpe !== undefined || patch.rir !== undefined || patch.targetRpe !== undefined || patch.setType !== undefined);
    const check = effortOrReps ? { corrected: { setId, key: saveOp } } : {};
    if (corrected !== null && corrected.toast !== null && corrected.undo !== null) {
      navigation.dispatch(returnToWorkout({ toast: { kind: 'exclusion', key: saveOp, text: withNote(corrected.toast), undo: { sessionId, ...corrected.undo } }, ...check }));
      return;
    }
    if (corrected !== null && !corrected.duplicate) {
      navigation.dispatch(returnToWorkout({ toast: { kind: 'undo_op', text: withNote(UNDO_TOAST.corrected(view.setNumber)), targetOpId: saveOp }, ...check }));
      return;
    }
    if (effortOrReps) {
      navigation.dispatch(returnToWorkout(check));
      return;
    }
    navigation.goBack();
  }

  function toggle(x: SetExclusion) {
    const now = view?.exclusions ?? [];
    setExclusions(now.includes(x) ? now.filter((y) => y !== x) : [...now, x]);
  }

  async function remove() {
    if (!view) return;
    // No confirm (copy D4): the workout screen offers Undo.
    const r = await services.workout.dispatch(sessionId, { type: 'delete_set', at: services.now(), opId: deleteOp, setId, expectedSetVersion: view.setVersion });
    if (!r.ok) {
      setError(r.error.message);
      void load();
      return;
    }
    changed();
    navigation.dispatch(returnToWorkout({ toast: { kind: 'undo_op', text: UNDO_TOAST.deleted(view.setNumber), targetOpId: deleteOp } }));
  }

  /** `Insert set after` (14 Oct): a new set straight after this one, copying it, with Undo. The logged set is never touched. */
  async function insertAfter() {
    if (!view || !ex || aggregate?.session.status !== 'active') return;
    const r = await services.workout.addSet({ sessionId, sessionExerciseId: ex.id, opId: insertOp, newSetId: newUuid(), afterSetId: setId });
    if (!r.ok) {
      setError(r.error.code === 'stale_version' || r.error.code === 'write_conflict' ? 'The workout changed. Try again.' : r.error.message);
      void load();
      return;
    }
    changed();
    navigation.dispatch(returnToWorkout({ toast: { kind: 'undo_op', text: UNDO_TOAST.added(view.setNumber + 1), targetOpId: insertOp } }));
  }

  return (
    // 2.1: the sheet avoids the keyboard; Save sits in a fixed bar on it, so a change saves without scrolling.
    // Review S1: the avoiding view alone lifts it (no automaticallyAdjustKeyboardInsets, or the inset counts twice).
    <SheetKeyboardAvoidingView style={{ flex: 1, backgroundColor: theme.colors['bg.surface'] }}>
      <NumberAccessory />
      <ScrollView contentContainerStyle={{ padding: theme.space['4'], gap: theme.space['4'], paddingBottom: theme.space['8'] }} {...WORKOUT_KEYBOARD}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <AppText variant="title2" accessibilityRole="header">{`Edit set ${String(view.setNumber)} · ${view.exerciseName}`}</AppText>
          <TextButton label="Cancel" tone="secondary" icon="xmark" onPress={() => { navigation.goBack(); }} />
        </View>
        {view.completedAtUtc ? <AppText variant="callout" color="text.secondary" numeric>{`Done at ${formatTime(toMs(view.completedAtUtc), tz)}`}</AppText> : null}
        <StepperTileRow
          tiles={stepperRowTiles({ loadFlex: 1, load: view.loadField && ex ? { ...view.loadField, unit: view.loadField.unitText } : null, time: view.duration, distance: view.distance, reps: view.reps })}
          estimate={windowWidth - 2 * theme.space['4']}
        >
          {({ numeralSize, compact, flexOf }) => (
          <>
          {view.loadField && ex ? (
            <NumberStepper
              onSurface
              flex={flexOf(1)}
              numeralSize={numeralSize}
              compact={compact}
              label={view.loadField.label}
              unit={view.loadField.unitText}
              value={view.loadField.value}
              decimals
              down={view.loadField.down}
              up={view.loadField.up}
              onChange={(v) => {
                setValues({ ...current, load: v === null ? null : { value: v, unit: ex.unit, convention: view.convention } });
              }}
            />
          ) : null}
          {view.duration && view.distance ? (
            // Cardio (19 Oct): time and distance both; the time in minutes.
            <NumberStepper
              onSurface
              flex={flexOf(1)}
              numeralSize={numeralSize}
              compact={compact}
              label="Time"
              unit={null}
              decimals={false}
              time
              value={view.duration.value}
              down={view.duration.down}
              up={view.duration.up}
              onChange={(v) => {
                setValues({ ...current, durationS: v });
              }}
            />
          ) : view.duration ? (
            <NumberStepper
              onSurface
              flex={flexOf(1)}
              numeralSize={numeralSize}
              compact={compact}
              label="Time"
              unit="s"
              value={view.duration.value}
              decimals={false}
              down={view.duration.down}
              up={view.duration.up}
              onChange={(v) => {
                setValues({ ...current, durationS: v === null ? null : Math.max(0, Math.round(v)) });
              }}
            />
          ) : null}
          {view.distance ? (
            <NumberStepper
              onSurface
              flex={flexOf(1)}
              numeralSize={numeralSize}
              compact={compact}
              label="Distance"
              unit="m"
              value={view.distance.value}
              decimals
              down={view.distance.down}
              up={view.distance.up}
              onChange={(v) => {
                setValues({ ...current, distanceM: v === null ? null : Math.max(0, v) });
              }}
            />
          ) : null}
          {view.reps ? (
            <NumberStepper
              onSurface
              flex={flexOf(1)}
              numeralSize={numeralSize}
              compact={compact}
              label="Reps"
              unit={null}
              value={view.reps.value}
              decimals={false}
              down={view.reps.down}
              up={view.reps.up}
              onChange={(v) => {
                setValues({ ...current, reps: v === null ? null : Math.round(v) });
              }}
            />
          ) : null}
          </>
          )}
        </StepperTileRow>
        {view.addWeight && ex ? (
          <View style={{ alignItems: 'flex-start' }}>
            <TextButton
              label={view.addWeight.on ? 'Bodyweight' : '+ Weight'}
              tone="secondary"
              onPress={() => {
                setValues({ ...current, load: { value: 0, unit: ex.unit, convention: view.addWeight?.on === true ? 'bodyweight' : 'added' } });
              }}
            />
          </View>
        ) : null}
        {effortScale !== 'off' ? (
          <View style={{ gap: theme.space['1'] }}>
            <EffortHeading scale={effortScale}>
              <AppText variant="label" color="text.secondary">
                {effortScale === 'rir' ? 'Reps in reserve' : 'Effort (RPE)'}
              </AppText>
            </EffortHeading>
            <ChipRow>
              {(effortScale === 'rir' ? [4, 3, 2, 1, 0] : [6, 7, 8, 9, 10]).map((n) => {
                const selected = (effortScale === 'rir' ? current.rir : current.rpe) === n;
                return (
                  <Chip
                    key={n}
                    label={effortScale === 'rir' && n === 4 ? '4+' : String(n)}
                    selected={selected}
                    onPress={() => {
                      setValues(effortScale === 'rir' ? { ...current, rir: selected ? null : n } : { ...current, rpe: selected ? null : n });
                    }}
                  />
                );
              })}
            </ChipRow>
          </View>
        ) : null}
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
                    setTargetRpe(c.value);
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
                  setSetType(c.type);
                }}
              />
            ))}
          </ChipRow>
        </View>
        <View style={{ gap: theme.space['2'] }}>
          <AppText variant="label" color="text.secondary" accessibilityRole="header">
            {EXCLUSION_HEADING}
          </AppText>
          <ChipRow>
            {EXCLUSION_ORDER.map((x) => (
              <Chip key={x} label={EXCLUSION_LABEL[x]} selected={view.exclusions.includes(x)} onPress={() => { toggle(x); }} />
            ))}
          </ChipRow>
          {view.painLine ? <StatusLine icon="exclamationmark.triangle" tone="warning" text={view.painLine} /> : null}
        </View>
        <View style={{ gap: theme.space['2'] }}>
          <AppText variant="label" color="text.secondary">
            Note
          </AppText>
          <TextField
            accessibilityLabel="Note"
            value={noteText ?? storedNote ?? ''}
            onChangeText={setNoteText}
            multiline
            maxLength={NOTE_MAX}
            inputAccessoryViewID={NUMBER_ACCESSORY_ID}
          />
        </View>
        <AppText variant="callout" color="text.secondary" numeric>{`Saved as: ${view.text}`}</AppText>
        {error ? <StatusLine icon="info.circle" tone="info" text={error} /> : null}
        {aggregate.session.status === 'active' ? (
          <View style={{ flexDirection: 'row' }}>
            <SecondaryButton label="Insert set after" onPress={() => void insertAfter()} />
          </View>
        ) : null}
        <View style={{ height: theme.space['8'] }} />
        <DangerTextButton label="Delete set" onPress={() => void remove()} />
      </ScrollView>
      <ActionBar surface keypadOpen={keyboard} primary={{ label: 'Save changes', disabled: !view.changed && !noteEdited, onPress: () => void save() }} />
    </SheetKeyboardAvoidingView>
  );
}
