import { useEffect, useState } from 'react';
import { Modal, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { toIso, toMs, workoutTimeBounds } from '@fizz/domain';
import type { SessionAggregate } from '@fizz/schemas';

import { nowMs as clockNow } from '../../clock';
import { newUuid } from '../../device/runtime';
import { formatTime } from '../../format/dates';
import { useServices } from '../../shell/context';
import { useTheme } from '../../theme';
import { AppText, DangerTextButton, Eyebrow, PrimaryButton, StatusLine, TextButton } from '../../ui';
import { finishModel } from '../../workout/finish';
import { WorkoutTimesRows, type WorkoutTimes } from './WorkoutTimesRows';

/**
 * Finish sheet (active-workout §4.8; today.md §4 for a stale workout).
 * Nothing is written until `Finish`: one `finish` with the chosen end time
 * (and start, when Ben moved it on the wheel; Ben, 19 Oct) in the same
 * transaction (ADR 0003 S5). A stale version reloads and says so
 * (review N8). With nothing logged, `Discard workout` is the primary.
 */
export function FinishSheet({
  aggregate,
  visible,
  onClose,
  onFinished,
  onDiscard,
  onStale,
  onDismissed,
}: {
  aggregate: SessionAggregate;
  visible: boolean;
  onClose: () => void;
  onFinished: (sessionId: string) => void;
  onDiscard: () => void;
  onStale: () => void;
  /** After the sheet has fully closed (iOS `onDismiss`): navigate from here, never mid-dismissal (review S8). */
  onDismissed?: () => void;
}) {
  const theme = useTheme();
  const services = useServices();
  const insets = useSafeAreaInsets();
  const [opId, setOpId] = useState(newUuid);
  const [now, setNow] = useState(clockNow);
  const model = finishModel(aggregate, now);
  const recordedStartMs = toMs(aggregate.session.startedAt.utc);
  const [times, setTimes] = useState<WorkoutTimes>({ startMs: recordedStartMs, endMs: model.defaultEndMs });
  const endMs = times.endMs;
  const bounds = workoutTimeBounds(aggregate, now);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const tz = aggregate.session.startedAt.tz;

  // Each opening is a new intent: fresh opId, fresh default time.
  useEffect(() => {
    if (!visible) return;
    const t = clockNow();
    setNow(t);
    setTimes({ startMs: toMs(aggregate.session.startedAt.utc), endMs: finishModel(aggregate, t).defaultEndMs });
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
      // The workout's own zone (review N6); only when Ben moved it.
      ...(times.startMs === recordedStartMs ? {} : { startedAt: { utc: toIso(times.startMs), tz } }),
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
      setError('Couldn’t finish. Try again.');
      return;
    }
    onFinished(aggregate.session.id);
  }

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose} {...(onDismissed ? { onDismiss: onDismissed } : {})}>
      <View style={{ flex: 1, backgroundColor: theme.colors['bg.surface'], paddingHorizontal: theme.components.screenMargin, paddingTop: theme.space['5'], paddingBottom: theme.space['4'] + insets.bottom, gap: theme.space['4'] }}>
        <View style={{ gap: theme.space['2'] }}>
          <Eyebrow>Finish</Eyebrow>
          <AppText variant="title2" accessibilityRole="header">
            Finish workout?
          </AppText>
        </View>
        {model.nothingLogged ? (
          <AppText variant="body">Nothing logged yet.</AppText>
        ) : (
          <AppText variant="body" numeric>
            {`${String(model.done)} of ${String(model.total)} sets done.${model.willSkip > 0 ? ` ${String(model.willSkip)} not done will be marked skipped.` : ''}`}
          </AppText>
        )}
        {!model.nothingLogged ? (
          <View style={{ gap: theme.space['2'] }}>
            <WorkoutTimesRows times={times} bounds={bounds} tz={tz} onChange={setTimes} endNow={now} endEstimate={model.forgotten ? model.defaultEndMs : null} />
            {Math.abs(endMs - now) >= 60_000 ? (
              <TextButton
                label={`Use now (${formatTime(now, tz)})`}
                onPress={() => {
                  setTimes((t) => ({ ...t, endMs: now }));
                }}
              />
            ) : null}
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
