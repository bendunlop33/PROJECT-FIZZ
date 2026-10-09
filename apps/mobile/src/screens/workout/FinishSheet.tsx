import { useEffect, useState } from 'react';
import { Modal, Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { toIso } from '@fizz/domain';
import type { SessionAggregate } from '@fizz/schemas';

import { nowMs as clockNow } from '../../clock';
import { newUuid } from '../../device/runtime';
import { formatTime } from '../../format/dates';
import { useServices } from '../../shell/context';
import { useTheme } from '../../theme';
import { AppText, DangerTextButton, PrimaryButton, StatusLine, TextButton } from '../../ui';
import { finishModel, stepTime } from '../../workout/finish';

/**
 * Finish sheet (active-workout §4.8; today.md §4 for a stale workout).
 * Nothing is written until `Finish`: one `finish` with the chosen end time
 * in the same transaction (ADR 0003 S5). A stale version reloads and says so
 * (review N8). With nothing logged, `Discard workout` is the primary.
 */
export function FinishSheet({
  aggregate,
  visible,
  onClose,
  onFinished,
  onDiscard,
  onStale,
}: {
  aggregate: SessionAggregate;
  visible: boolean;
  onClose: () => void;
  onFinished: (sessionId: string) => void;
  onDiscard: () => void;
  onStale: () => void;
}) {
  const theme = useTheme();
  const services = useServices();
  const insets = useSafeAreaInsets();
  const [opId, setOpId] = useState(newUuid);
  const [now, setNow] = useState(clockNow);
  const model = finishModel(aggregate, now);
  const [endMs, setEndMs] = useState(model.defaultEndMs);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const tz = aggregate.session.startedAt.tz;

  // Each opening is a new intent: fresh opId, fresh default time.
  useEffect(() => {
    if (!visible) return;
    const t = clockNow();
    setNow(t);
    setEndMs(finishModel(aggregate, t).defaultEndMs);
    setOpId(newUuid());
    setError(null);
  }, [visible, aggregate]);

  async function finish() {
    if (busy) return;
    setBusy(true);
    setError(null);
    const at = services.now();
    const chosenIsNow = Math.abs(endMs - now) < 60_000;
    const r = await services.workout.dispatch(aggregate.session.id, {
      type: 'finish',
      at,
      opId,
      expectedVersion: aggregate.session.version,
      endedAt: chosenIsNow ? null : { utc: toIso(endMs), tz: at.tz },
    });
    setBusy(false);
    if (!r.ok) {
      if (r.error.code === 'stale_version') {
        setError('The workout changed since this opened. Check it and try again.');
        onStale();
        return;
      }
      if (r.error.code === 'work_interval_running') {
        setError('Stop the timer first.');
        return;
      }
      setError('Couldn’t finish the workout. Nothing was lost; try again.');
      return;
    }
    onFinished(aggregate.session.id);
  }

  const timeButton = (label: string, minutes: number) => (
    <Pressable
      key={label}
      accessibilityRole="button"
      accessibilityLabel={`${minutes < 0 ? 'Earlier' : 'Later'} by ${String(Math.abs(minutes))} minutes`}
      onPress={() => {
        setEndMs((v) => stepTime(v, minutes, model.minEndMs, model.maxEndMs));
      }}
      style={({ pressed }) => ({
        minWidth: theme.target.workout.width,
        minHeight: theme.target.workout.height,
        borderRadius: theme.radius.sm,
        borderWidth: 1,
        borderColor: theme.colors['border.control'],
        backgroundColor: pressed ? theme.colors['accent.subtle'] : theme.colors['bg.raised'],
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: theme.space['2'],
      })}
    >
      <AppText variant="label" numeric>
        {label}
      </AppText>
    </Pressable>
  );

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: theme.colors['bg.surface'], padding: theme.space['4'], paddingBottom: theme.space['4'] + insets.bottom, gap: theme.space['4'] }}>
        <AppText variant="title2" accessibilityRole="header">
          Finish workout?
        </AppText>
        {model.nothingLogged ? (
          <AppText variant="body">Nothing logged yet.</AppText>
        ) : (
          <AppText variant="body" numeric>
            {`${String(model.done)} of ${String(model.total)} sets done.${model.willSkip > 0 ? ` ${String(model.willSkip)} not done will be marked skipped.` : ''}`}
          </AppText>
        )}
        {!model.nothingLogged ? (
          <View style={{ gap: theme.space['2'] }}>
            <AppText variant="label" color="text.secondary">
              Ended at
            </AppText>
            <AppText variant="title2" numeric accessibilityLiveRegion="polite">
              {`${formatTime(endMs, tz)}${Math.abs(endMs - now) < 60_000 ? ' (now)' : model.forgotten && endMs === model.defaultEndMs ? ' (last set + 3 min)' : ''}`}
            </AppText>
            <View style={{ flexDirection: 'row', gap: theme.space['2'], flexWrap: 'wrap' }}>
              {timeButton('−5 min', -5)}
              {timeButton('−1 min', -1)}
              {timeButton('+1 min', 1)}
              {timeButton('+5 min', 5)}
            </View>
            {Math.abs(endMs - now) >= 60_000 ? (
              <TextButton
                label={`Use now (${formatTime(now, tz)})`}
                onPress={() => {
                  setEndMs(now);
                }}
              />
            ) : null}
            <AppText variant="callout" color="text.secondary">
              Only times between the last logged set and now.
            </AppText>
          </View>
        ) : null}
        {error ? <StatusLine icon="exclamationmark.triangle" tone="warning" text={error} /> : null}
        <View style={{ flex: 1 }} />
        {model.nothingLogged ? (
          <>
            <PrimaryButton label="Discard workout" onPress={onDiscard} disabled={busy} />
            <TextButton label="Finish anyway" onPress={() => void finish()} disabled={busy} />
          </>
        ) : (
          <PrimaryButton label="Finish" busy={busy} onPress={() => void finish()} />
        )}
        <TextButton label="Keep going" tone="secondary" onPress={onClose} />
        {!model.nothingLogged ? <View style={{ height: theme.space['2'] }} /> : null}
        {!model.nothingLogged ? <DangerTextButton label="Discard workout" onPress={onDiscard} disabled={busy} /> : null}
      </View>
    </Modal>
  );
}
