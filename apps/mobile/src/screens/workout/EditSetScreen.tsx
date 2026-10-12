import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import { useEffect, useState } from 'react';
import { Alert, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { EXCLUSION_HEADING, EXCLUSION_LABEL, EXCLUSION_ORDER, toMs } from '@fizz/domain';
import type { SetExclusion, SetValues } from '@fizz/schemas';

import { newUuid } from '../../device/runtime';
import type { ActiveWorkoutData } from '../../services/workout-services';
import { formatTime } from '../../format/dates';
import { returnToWorkout } from '../../navigation/actions';
import { targetRpeChips } from '../../workout/exercise-menu';
import type { RootStackParams } from '../../navigation/types';
import { useDataChanged, useServices } from '../../shell/context';
import { useTheme } from '../../theme';
import { AppText, Chip, ChipRow, DangerTextButton, NumberAccessory, NumberStepper, PrimaryButton, StatusLine, TextButton } from '../../ui';

/**
 * Correction sheet for a logged set (active-workout §4.4): `correct_set`
 * guarded on the set's own version; the rest timer is never touched.
 * `Delete set` always confirms and keeps an audited record (no Undo yet).
 * The exclusion chips (§2.13) save in the same `correct_set`; the toast with
 * Undo is handed back to the workout screen. In an active workout, `Target
 * RPE` sets Ben's own target for this set in the same `correct_set`
 * (CHANGELOG 2026-10-11 (b) "Edit set"); the offer check runs on it again (F4).
 */
export function EditSetScreen() {
  const theme = useTheme();
  const services = useServices();
  const changed = useDataChanged();
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const { sessionId, setId } = useRoute<RouteProp<RootStackParams, 'EditSet'>>().params;
  const [data, setData] = useState<ActiveWorkoutData | null>(null);
  const aggregate = data?.aggregate ?? null;
  const [values, setValues] = useState<SetValues | null>(null);
  const [exclusions, setExclusions] = useState<SetExclusion[] | null>(null);
  /** Ben's target RPE as edited: a value, null cleared, undefined untouched. */
  const [targetRpe, setTargetRpe] = useState<number | null | undefined>(undefined);
  const [effortScale, setEffortScale] = useState<'rpe' | 'rir' | 'off'>('rpe');
  const [error, setError] = useState<string | null>(null);
  const [saveOp] = useState(newUuid);
  const [deleteOp] = useState(newUuid);

  async function load() {
    const d = await services.workout.load(sessionId);
    if (!d) return;
    setData(d);
    setEffortScale(d.effortScale);
  }
  useEffect(() => {
    void load();
  }, [sessionId, setId]);

  const view = data ? services.workout.editView(data, setId, values, exclusions, targetRpe) : null;
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

  async function save() {
    if (!view) return;
    const actual = aggregate?.sets.find((s) => s.id === setId)?.actual;
    if (!actual) return;
    const patch: Partial<SetValues> & { exclusions?: SetExclusion[]; targetRpe?: number | null } = {};
    for (const k of ['load', 'reps', 'rpe', 'rir'] as const) {
      if (JSON.stringify(current[k]) !== JSON.stringify(actual[k])) Object.assign(patch, { [k]: current[k] });
    }
    if (exclusions !== null) patch.exclusions = view.exclusions;
    if (view.targetRpe?.changed === true) patch.targetRpe = view.targetRpe.override;
    const r = await services.workout.correctSet({ sessionId, setId, expectedSetVersion: view.setVersion, patch, opId: saveOp });
    if (!r.ok) {
      setError(r.message);
      setValues(null);
      setExclusions(null);
      setTargetRpe(undefined);
      void load();
      return;
    }
    changed();
    // F4: a corrected rep or effort count, or the set's target RPE, runs the same offer check as a log (rule T: every logged working set).
    const effortOrReps = patch.reps !== undefined || patch.rpe !== undefined || patch.rir !== undefined || patch.targetRpe !== undefined;
    const corrected = effortOrReps ? { corrected: { setId, key: saveOp } } : {};
    if (r.toast !== null && r.undo !== null) {
      navigation.dispatch(returnToWorkout({ toast: { kind: 'exclusion', key: saveOp, text: r.toast, undo: { sessionId, ...r.undo } }, ...corrected }));
      return;
    }
    if (effortOrReps) {
      navigation.dispatch(returnToWorkout(corrected));
      return;
    }
    navigation.goBack();
  }

  function toggle(x: SetExclusion) {
    const now = view?.exclusions ?? [];
    setExclusions(now.includes(x) ? now.filter((y) => y !== x) : [...now, x]);
  }

  function remove() {
    if (!view) return;
    Alert.alert(`Delete set ${String(view.setNumber)}?`, 'It’s removed from this workout’s totals and history. The edit log keeps a record.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          void services.workout.dispatch(sessionId, { type: 'delete_set', at: services.now(), opId: deleteOp, setId, expectedSetVersion: view.setVersion }).then((r) => {
            if (!r.ok) {
              setError(r.error.message);
              void load();
              return;
            }
            changed();
            navigation.goBack();
          });
        },
      },
    ]);
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
        <AppText variant="callout" color="text.secondary" numeric>{`Saved as: ${view.text}`}</AppText>
        {error ? <StatusLine icon="info.circle" tone="info" text={error} /> : null}
        <PrimaryButton label="Save changes" disabled={!view.changed} onPress={() => void save()} />
        <View style={{ height: theme.space['8'] }} />
        <DangerTextButton label="Delete set" onPress={remove} />
      </ScrollView>
    </View>
  );
}
