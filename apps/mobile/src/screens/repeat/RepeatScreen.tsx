import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import { useRef, useState } from 'react';
import { View } from 'react-native';

import { scoreText, toMs } from '@fizz/domain';

import { newUuid } from '../../device/runtime';
import { formatDayMonth, formatShortDate, formatTime } from '../../format/dates';
import { openStartedWorkout } from '../../navigation/actions';
import type { RootStackParams } from '../../navigation/types';
import { useDataChanged, useScreenData, useServices } from '../../shell/context';
import { TIMING, useTheme } from '../../theme';
import { AppText, Card, PrimaryButton, Screen, StatusLine, TextButton } from '../../ui';

/**
 * Repeat a workout (routines.md §2.4): the targets the new workout will have
 * at today's gym, the notes for anything rounded or missing, and `Start
 * workout` (through the same check-in gate as Today). Saves nothing until
 * Start; the start is idempotent by one opId per screen.
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
  const [data, reload] = useScreenData(async (s) => {
    const gym = await s.yourData.currentGym();
    const [preview, active] = await Promise.all([gym ? s.repeat.preview(sessionId, gym.id) : Promise.resolve(null), s.sessions.active()]);
    return { gym, preview, active };
  });
  if (data.state === 'loading') return <Screen>{null}</Screen>;
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
  const { gym, preview, active } = data.value;
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
      navigation.dispatch(openStartedWorkout(ci ? { toast: { kind: 'check_in', text: `Using your check-in from ${formatTime(toMs(ci.recordedAt.utc), ci.recordedAt.tz)} · ${scoreText(ci.score)}`, checkInId: ci.id } } : undefined));
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
        <AppText variant="callout">{`Targets are what you did on ${day}. Nothing is marked done. Progression isn’t applied.`}</AppText>
        {preview.sourceGymId !== gym.id ? <AppText variant="callout" color="text.secondary">{`Checked for ${gym.name}.`}</AppText> : null}
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
        <StatusLine key={`${n.exerciseName}:${n.text}`} icon="info.circle" tone="info" text={`${n.exerciseName}: ${n.text}`} />
      ))}
      {preview.notCopied.length > 0 ? (
        <AppText variant="callout" color="text.secondary">
          {`Not copied: ${preview.notCopied.map((n) => `${String(n.skipped)} skipped ${n.skipped === 1 ? 'set' : 'sets'} (${n.exerciseName})`).join(', ')}`}
        </AppText>
      ) : null}
      {error ? <StatusLine icon="exclamationmark.triangle" tone="warning" text={error} /> : null}
    </Screen>
  );
}
