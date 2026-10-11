import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import { useEffect, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { buildSetEditView, EXCLUSION_HEADING, EXCLUSION_LABEL, EXCLUSION_ORDER, toMs } from '@fizz/domain';
import type { SessionAggregate, SetExclusion, SetType, SetValues } from '@fizz/schemas';

import { newUuid } from '../../device/runtime';
import { formatTime } from '../../format/dates';
import type { RootStackParams } from '../../navigation/types';
import { useDataChanged, useServices } from '../../shell/context';
import { UNDO_TOAST } from '../../workout/undo-op';
import { useTheme } from '../../theme';
import { AppText, Chip, ChipRow, DangerTextButton, NumberAccessory, NumberStepper, PrimaryButton, StatusLine, TextButton, TextField } from '../../ui';
import { NOTE_MAX, noteChanged, noteValue } from '../../workout/notes';

/**
 * Correction sheet for a logged set (active-workout §4.4): `correct_set`
 * guarded on the set's own version; the rest timer is never touched.
 * `Delete set` deletes at once and keeps an audited record; the workout
 * screen shows `Set 2 deleted` [Undo] (copy D4). A value change hands back
 * `Set 2 updated` [Undo]. The exclusion chips (§2.13) save in the same
 * `correct_set`; their toast (with its own Undo) wins when they changed.
 */
export function EditSetScreen() {
  const theme = useTheme();
  const services = useServices();
  const changed = useDataChanged();
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const { sessionId, setId } = useRoute<RouteProp<RootStackParams, 'EditSet'>>().params;
  const [aggregate, setAggregate] = useState<SessionAggregate | null>(null);
  const [values, setValues] = useState<SetValues | null>(null);
  const [exclusions, setExclusions] = useState<SetExclusion[] | null>(null);
  const [setType, setSetType] = useState<SetType | null>(null);
  const [effortScale, setEffortScale] = useState<'rpe' | 'rir' | 'off'>('rpe');
  const [error, setError] = useState<string | null>(null);
  const [saveOp] = useState(newUuid);
  const [deleteOp] = useState(newUuid);
  const [noteOp] = useState(newUuid);
  /** The note field as typed; null = untouched (shows the stored note). */
  const [noteText, setNoteText] = useState<string | null>(null);

  async function load() {
    const d = await services.workout.load(sessionId);
    if (!d) return;
    setAggregate(d.aggregate);
    setEffortScale(d.effortScale);
  }
  useEffect(() => {
    void load();
  }, [sessionId, setId]);

  const view = aggregate ? buildSetEditView(aggregate, setId, values, exclusions, setType) : null;
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
    let corrected: Extract<Awaited<ReturnType<typeof services.workout.correctSet>>, { ok: true }> | null = null;
    if (view.changed) {
      const patch: Partial<SetValues> & { exclusions?: SetExclusion[] } = {};
      for (const k of ['load', 'reps', 'rpe', 'rir'] as const) {
        if (JSON.stringify(current[k]) !== JSON.stringify(actual[k])) Object.assign(patch, { [k]: current[k] });
      }
      if (exclusions !== null) patch.exclusions = view.exclusions;
      const typed: Parameters<typeof services.workout.correctSet>[0]['patch'] = view.setType.changed ? { ...patch, setType: view.setType.value } : patch;
      const r = await services.workout.correctSet({ sessionId, setId, expectedSetVersion: view.setVersion, patch: typed, opId: saveOp });
      if (!r.ok) {
        setError(r.message);
        setValues(null);
        setExclusions(null);
        setSetType(null);
        void load();
        return;
      }
      corrected = r;
      sessionVersion = r.aggregate.session.version;
    }
    // The set's note (Your data) is its own versioned write; it never changes a value.
    if (noteEdited) {
      const n = await services.workout.setNote({ sessionId, target: { kind: 'set', setId }, note: noteValue(noteText), expectedVersion: sessionVersion, opId: noteOp });
      if (!n.ok) {
        setError(n.error.code === 'stale_version' ? 'The workout changed. Try again.' : n.error.message);
        void load();
        return;
      }
    }
    changed();
    if (corrected !== null && corrected.toast !== null && corrected.undo !== null) {
      navigation.navigate('Workout', { toast: { kind: 'exclusion', key: saveOp, text: corrected.toast, undo: { sessionId, ...corrected.undo } } });
      return;
    }
    if (corrected !== null && !corrected.duplicate) {
      navigation.navigate('Workout', { toast: { kind: 'undo_op', text: UNDO_TOAST.corrected(view.setNumber), targetOpId: saveOp } });
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
    navigation.navigate('Workout', { toast: { kind: 'undo_op', text: UNDO_TOAST.deleted(view.setNumber), targetOpId: deleteOp } });
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors['bg.surface'] }}>
      <NumberAccessory />
      <ScrollView contentContainerStyle={{ padding: theme.space['4'], gap: theme.space['4'], paddingBottom: theme.space['8'] + insets.bottom }} keyboardShouldPersistTaps="handled">
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <AppText variant="title2" accessibilityRole="header">{`Edit set ${String(view.setNumber)} · ${view.exerciseName}`}</AppText>
          <TextButton label="Cancel" tone="secondary" icon="xmark" onPress={() => { navigation.goBack(); }} />
        </View>
        {view.completedAtUtc ? <AppText variant="callout" color="text.secondary" numeric>{`Done at ${formatTime(toMs(view.completedAtUtc), tz)}`}</AppText> : null}
        <View style={{ flexDirection: 'row', gap: theme.space['3'] }}>
          {view.loadField && ex ? (
            <NumberStepper
              onSurface
              label={view.loadField.label}
              unit={view.loadField.unitText}
              value={view.loadField.value}
              decimals
              down={view.loadField.down}
              up={view.loadField.up}
              onChange={(v) => {
                setValues({ ...current, load: v === null ? null : { value: v, unit: ex.unit, convention: ex.loadConvention } });
              }}
            />
          ) : null}
          {view.reps ? (
            <NumberStepper
              onSurface
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
        </View>
        {effortScale !== 'off' ? (
          <View style={{ gap: theme.space['1'] }}>
            <AppText variant="label" color="text.secondary">
              {effortScale === 'rir' ? 'Reps in reserve' : 'Effort (RPE)'}
            </AppText>
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
          />
        </View>
        <AppText variant="callout" color="text.secondary" numeric>{`Saved as: ${view.text}`}</AppText>
        {error ? <StatusLine icon="info.circle" tone="info" text={error} /> : null}
        <PrimaryButton label="Save changes" disabled={!view.changed && !noteEdited} onPress={() => void save()} />
        <View style={{ height: theme.space['8'] }} />
        <DangerTextButton label="Delete set" onPress={() => void remove()} />
      </ScrollView>
    </View>
  );
}
