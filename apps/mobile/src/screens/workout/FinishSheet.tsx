import { useEffect, useState } from 'react';
import { View } from 'react-native';

import { pastLogDefaultEnd, startMoveWrite, timelineOf, toIso, toMs, workoutTimeBounds, type StartMove } from '@fizz/domain';
import type { SessionAggregate } from '@fizz/schemas';

import { nowMs as clockNow } from '../../clock';
import { newUuid } from '../../device/runtime';
import { formatTime } from '../../format/dates';
import { useServices } from '../../shell/context';
import { useTheme } from '../../theme';
import { AppText, BottomCard, DangerTextButton, PrimaryButton, SecondaryButton, StatusLine, TextButton } from '../../ui';
import { finishLine, finishLineSpoken, finishModel } from '../../workout/finish';
import { WorkoutTimesRows, type WorkoutTimes } from './WorkoutTimesRows';

/**
 * Finish sheet (active-workout §4.8; today.md §4 for a stale workout; redesign-27oct §E1: opened from the top bar's
 * `Finish`, a bottom card with `15 of 16 sets · 1 not done`, Finish, Keep going and Discard).
 * Nothing is written until `Finish`: one `finish` with the end time (now, or the last set + 3 min after a forgotten
 * Finish; a past log's own times, set here on the wheels, and its start when Ben moved it; Ben, 19 Oct) in the same
 * transaction (ADR 0003 S5). A stale version reloads and says so (review N8). With nothing logged, `Discard workout`
 * is the primary.
 *
 * (Ben, 25 Oct) Moving Started moves the whole workout (its sets, pauses and rests with it) to any
 * past date and time; the `finish` then carries `shift: true` and the end as shown. A past log's
 * end starts an hour after its start (`pastLogDefaultEnd`), with no `Use now`.
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
  const [opId, setOpId] = useState(newUuid);
  const [now, setNow] = useState(clockNow);
  const pastLog = aggregate.session.pastLog !== undefined;
  const timeline = timelineOf(aggregate);
  const defaultEnd = (t: number): number => (pastLog ? pastLogDefaultEnd(timeline.startMs, timeline.lastSetMs, t) : finishModel(aggregate, t).defaultEndMs);
  const model = finishModel(aggregate, now);
  const recordedStartMs = toMs(aggregate.session.startedAt.utc);
  const [times, setTimes] = useState<WorkoutTimes>({ startMs: recordedStartMs, endMs: defaultEnd(now) });
  const endMs = times.endMs;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // (Ben, 26 Oct) A moved Started: the whole workout (default) or only the start.
  const [startMove, setStartMove] = useState<StartMove>('whole');
  const tz = aggregate.session.startedAt.tz;

  // Each opening is a new intent: fresh opId, fresh default time.
  useEffect(() => {
    if (!visible) return;
    const t = clockNow();
    setNow(t);
    setTimes({ startMs: toMs(aggregate.session.startedAt.utc), endMs: pastLog ? pastLogDefaultEnd(timeline.startMs, timeline.lastSetMs, t) : finishModel(aggregate, t).defaultEndMs });
    setOpId(newUuid());
    setError(null);
    setStartMove('whole');
  }, [visible, aggregate]);

  async function finish() {
    if (busy) return;
    setBusy(true);
    setError(null);
    const at = services.now();
    const moved = times.startMs !== recordedStartMs;
    // `Only the start` (Ben, 26 Oct): the sets stay, so the end is Ben's own as on any finish.
    const whole = moved && (pastLog || startMove === 'whole');
    const chosenIsNow = !whole && !pastLog && Math.abs(endMs - now) < 60_000;
    const r = await services.workout.dispatch(aggregate.session.id, {
      type: 'finish',
      at,
      opId,
      expectedVersion: aggregate.session.version,
      endedAt: chosenIsNow ? null : { utc: toIso(endMs), tz: moved || pastLog ? tz : at.tz },
      // The workout's own zone (review N6); only when Ben moved it. The whole workout moves (Ben, 25 Oct) unless he
      // chose `Only the start` (Ben, 26 Oct; a past log always moves whole).
      ...(moved ? { startedAt: { utc: toIso(times.startMs), tz }, ...startMoveWrite(pastLog ? 'whole' : startMove, true) } : {}),
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
    // (Ben, 27 Oct; redesign §E1) A bottom card from the top bar's Finish: the sets done, Finish, Keep going, Discard.
    // A live workout's times are edited on the Summary (⋯ › Edit times); a past log sets its times here.
    <BottomCard
      visible={visible}
      onClose={onClose}
      closeLabel="Keep going"
      {...(onDismissed ? { onDismissed } : {})}
      header={
        <View style={{ gap: theme.space['1'] }}>
          <AppText variant="title2" accessibilityRole="header">
            Finish workout?
          </AppText>
          <AppText variant="callout" color="text.secondary" numeric accessibilityLabel={finishLineSpoken(model)}>
            {finishLine(model)}
          </AppText>
          {/* A forgotten Finish ends at the last set + 3 min (finishModel): shown, one tap away on the Summary. */}
          {!pastLog && !model.nothingLogged && model.forgotten ? (
            <AppText variant="callout" color="text.secondary" numeric>
              {`Ends ${formatTime(endMs, tz)}`}
            </AppText>
          ) : null}
        </View>
      }
      footer={
        <>
          {error ? <StatusLine icon="exclamationmark.triangle" tone="warning" text={error} /> : null}
          {model.nothingLogged ? (
            <>
              <PrimaryButton label="Discard workout" onPress={onDiscard} disabled={busy} />
              <TextButton label="Finish anyway" onPress={() => void finish()} disabled={busy} />
            </>
          ) : (
            <PrimaryButton label="Finish" busy={busy} onPress={() => void finish()} />
          )}
          <SecondaryButton label="Keep going" onPress={onClose} />
          {!model.nothingLogged ? (
            <View style={{ alignItems: 'center' }}>
              <DangerTextButton label="Discard workout" onPress={onDiscard} disabled={busy} />
            </View>
          ) : null}
        </>
      }
    >
      {pastLog && !model.nothingLogged ? (
        <WorkoutTimesRows
          times={times}
          shift={{ timeline, nowMs: now }}
          startMove={{ mode: startMove, onMode: setStartMove, fixed: workoutTimeBounds(aggregate, now), pastLog }}
          tz={tz}
          onChange={setTimes}
          endNow={null}
          endEstimate={defaultEnd(now)}
        />
      ) : null}
    </BottomCard>
  );
}
