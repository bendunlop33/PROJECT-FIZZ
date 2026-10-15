import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import { useRef, useState } from 'react';
import { View } from 'react-native';

import { notCopiedText, scoreText, toMs } from '@fizz/domain';

import { useStartAlertsAsk } from '../../alerts/AlertsAskSheet';
import { newUuid } from '../../device/runtime';
import { formatDayMonth, formatShortDate, formatTime } from '../../format/dates';
import { DELETE_COPY } from '../../history/delete-view';
import { openStartedWorkout } from '../../navigation/actions';
import type { RootStackParams } from '../../navigation/types';
import { useDataChanged, useScreenData, useServices } from '../../shell/context';
import { TIMING, useTheme } from '../../theme';
import { AppText, Card, PrimaryButton, Screen, StatusLine, TextButton } from '../../ui';
import { GymChip, GymSwitcherSheet } from '../workout/GymSwitch';
import { useSaveToWorkouts } from '../routines/SaveWorkoutSheet';
import { LIBRARY_COPY_UI } from '../../workout/library-view';

/**
 * Repeat a workout (routines.md §2.4): the targets the new workout will have
 * at today's gym, the notes for anything rounded or missing, and `Start
 * workout` (through the same check-in gate as Today). Saves nothing until
 * Start; the start is idempotent by one opId per screen.
 *
 * `Checked for [gym ▾]` (gym-switch GS10): choosing another gym re-checks
 * the preview with the same fit Start uses, and starts nothing.
 */
export function RepeatScreen() {
  const theme = useTheme();
  const services = useServices();
  const changed = useDataChanged();
  const navigation = useNavigation();
  const { sessionId } = useRoute<RouteProp<RootStackParams, 'Repeat'>>().params;
  const startOp = useRef(newUuid());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** The gym chosen on the chip; null = today's gym. */
  const [chosenGymId, setChosenGymId] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const alertsAsk = useStartAlertsAsk();
  // `Save to Workouts` (routines.md §4.6, §A2.6, WL6): the Repeat preview at this gym, its loads as Fixed. One opId per sheet opening.
  const [saved, setSaved] = useState<{ id: string; name: string; version: number } | null>(null);
  const saveSheet = useSaveToWorkouts(
    (made) => {
      setSaved({ id: made.id, name: made.name, version: made.version });
      changed();
      reload();
    },
    () => {
      setError(LIBRARY_COPY_UI.nothingToSave);
    },
  );
  const [data, reload] = useScreenData(async (s) => {
    const gyms = await s.yourData.gyms();
    const gym = gyms.find((g) => g.id === chosenGymId) ?? (await s.yourData.currentGym());
    const [preview, active, routines] = await Promise.all([gym ? s.repeat.preview(sessionId, gym.id) : Promise.resolve(null), s.sessions.active(), s.routines.list().catch(() => [])]);
    const choices = await Promise.all(
      gyms.map(async (g) => ({ id: g.id, name: g.name, current: g.id === gym?.id, items: (await s.yourData.equipment(g.id).catch(() => [])).filter((e) => e.availability === 'available').length })),
    );
    const sourceGymName = preview?.sourceGymId ? (gyms.find((g) => g.id === preview.sourceGymId)?.name ?? null) : null;
    // A source deleted since the list loaded (or purged) says so, not `nothing to repeat` (delete-workouts §5; review r2 N4).
    const presence = preview === null ? (await s.history.presence(sessionId).catch(() => null))?.kind : null;
    return { gym, preview, active, choices, sourceGymName, savedAs: routines.find((r) => r.createdFromSessionId === sessionId) ?? null, deleted: presence === 'deleted' || presence === 'gone' };
  });
  if (data.state === 'loading') return <Screen>{null}</Screen>;
  if (data.state === 'ready' && data.value.deleted) {
    return (
      <Screen>
        <StatusLine icon="info.circle" tone="info" text={DELETE_COPY.gone} />
      </Screen>
    );
  }
  if (data.state === 'error' || data.value.preview === null || data.value.gym === null) {
    return (
      <Screen>
        <StatusLine
          icon="exclamationmark.triangle"
          tone="warning"
          text={data.state === 'error' ? 'Couldn’t read that workout.' : data.value.gym === null ? 'A workout needs a gym.' : 'That workout has nothing to repeat.'}
          detail={data.state === 'error' ? data.message : null}
          action={<TextButton label="Try again" onPress={reload} />}
        />
      </Screen>
    );
  }
  const { gym, preview, active, choices, sourceGymName, savedAs } = data.value;

  const day = formatDayMonth(toMs(preview.sourceStartedAtUtc), preview.tz);

  async function start() {
    if (busy) return;
    setBusy(true);
    setError(null);
    setTimeout(() => {
      setBusy(false);
    }, TIMING.commitGuard);
    try {
      await startNow();
    } catch (e) {
      // Never a silent failure (audit F9); the same opId makes a retry safe.
      setError(`Couldn’t start the workout: ${e instanceof Error ? e.message : String(e)}. Try again.`);
    }
  }

  async function startNow() {
    // First Start ever: the one-time Rest alerts question, then the same Start (premium-feel §3.5).
    await alertsAsk.ensureAsked();
    const gate = await services.checkIns.gate();
    if (gate.kind === 'ask') {
      navigation.navigate('CheckIn', { mode: 'start', gymId: gym.id, repeatOf: sessionId });
      return;
    }
    const checkIn =
      gate.kind === 'reuse'
        ? ({ kind: 'answered', checkInId: gate.checkInId } as const)
        : gate.reason === 'off' || gate.reason === 'not_a_check_in_day'
          ? ({ kind: 'not_asked', reason: gate.reason } as const)
          : null;
    const r = await services.workout.start({ gymId: gym.id, opId: startOp.current, checkIn, repeatOf: sessionId });
    if (!r.ok) {
      setError(r.error.code === 'session_already_active' ? 'A workout is already in progress. Resume it from Today.' : r.error.message);
      return;
    }
    changed();
    if (gate.kind === 'reuse') {
      const ci = await services.checkIns.get(gate.checkInId);
      navigation.dispatch(openStartedWorkout(ci ? { toast: { kind: 'check_in', text: `Check-in ${formatTime(toMs(ci.recordedAt.utc), ci.recordedAt.tz)} · ${scoreText(ci.score)}`, checkInId: ci.id } } : undefined));
      return;
    }
    navigation.dispatch(openStartedWorkout());
  }

  return (
    <Screen
      footer={
        <>
          {active ? <AppText variant="callout" color="text.secondary">Finish or discard the workout in progress to start this.</AppText> : null}
          <PrimaryButton label="Start workout" busy={busy} disabled={active !== null} onPress={() => void start()} />
        </>
      }
    >
      <View style={{ gap: theme.space['1'] }}>
        <AppText variant="title2" accessibilityRole="header">{`Repeat ${formatShortDate(toMs(preview.sourceStartedAtUtc), preview.tz)}`}</AppText>
        {sourceGymName !== null ? <AppText variant="callout" color="text.secondary">{`Done at ${sourceGymName}`}</AppText> : null}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space['2'], flexWrap: 'wrap' }}>
          <AppText variant="callout">Checked for</AppText>
          <GymChip
            gymName={gym.name}
            onPress={() => {
              setSheetOpen(true);
            }}
          />
        </View>
        <AppText variant="callout">{`Targets: as on ${day}`}</AppText>
      </View>
      <AppText variant="label" color="text.secondary">
        All values are targets.
      </AppText>
      {preview.exercises.map((e) => (
        <Card key={e.exerciseName}>
          <AppText variant="headline">{`${e.exerciseName}${e.equipmentName ? ` · ${e.equipmentName}` : ''}`}</AppText>
          <AppText variant="callout" numeric>
            {e.line}
          </AppText>
        </Card>
      ))}
      {preview.notes.map((n) => (
        <StatusLine key={`${n.exerciseName}:${n.text}`} icon={n.tone === 'warning' ? 'exclamationmark.triangle' : 'info.circle'} tone={n.tone} text={`${n.exerciseName}: ${n.text}`} />
      ))}
      {notCopiedText(preview.notCopied) !== null ? (
        <AppText variant="callout" color="text.secondary">
          {notCopiedText(preview.notCopied)}
        </AppText>
      ) : null}
      {saved ? (
        <StatusLine
          icon="checkmark.circle.fill"
          tone="done"
          text={LIBRARY_COPY_UI.savedLink(saved.name).replace(' ›', '')}
          action={
            <TextButton
              label="Undo"
              onPress={() => {
                const s = saved;
                setSaved(null);
                void services.routines.remove({ routineId: s.id, expectedVersion: s.version, opId: newUuid() }).then((u) => {
                  if (!u.ok) setError(u.message);
                  changed();
                  reload();
                });
              }}
            />
          }
        />
      ) : savedAs === null ? (
        <View style={{ alignSelf: 'flex-start' }}>
          <TextButton
            label={LIBRARY_COPY_UI.saveToWorkouts}
            onPress={() => {
              void saveSheet.open({ kind: 'repeat', sessionId, gymId: gym.id }, preview.title);
            }}
          />
        </View>
      ) : null}
      {error ? <StatusLine icon="exclamationmark.triangle" tone="warning" text={error} /> : null}
      <GymSwitcherSheet
        visible={sheetOpen}
        gyms={choices}
        onChoose={(g) => {
          setSheetOpen(false);
          if (g.id === gym.id) return;
          // Re-check only: nothing is started or saved (GS10).
          setChosenGymId(g.id);
          // A start at another gym is another operation: a retry of a failed start at the
          // old gym must not return that gym's workout (review N4).
          startOp.current = newUuid();
          reload();
        }}
        onClose={() => {
          setSheetOpen(false);
        }}
      />
      {alertsAsk.sheet}
      {saveSheet.sheet}
    </Screen>
  );
}
