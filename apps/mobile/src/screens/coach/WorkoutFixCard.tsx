import { useEffect, useRef, useState } from 'react';
import { Alert, View } from 'react-native';

import type { ActionRecord } from '@fizz/schemas';

import { workoutFixLines } from '../../coach/sheet-view';
import { newUuid } from '../../device/runtime';
import { WORKOUT_FIX_COPY, type WorkoutFixCardState } from '../../services/workout-fix-service';
import { useServices } from '../../shell/context';
import { useTheme } from '../../theme';
import { AppText, Icon, TextButton } from '../../ui';
import { CardActions, CoachCardFrame } from './CoachCardFrame';

/**
 * (Ben, 2 Nov) A past workout's fix from the coach: `Pull A`, `Tue 28 Oct · 18:04–19:02 → Mon 27 Oct · 18:04–19:02`.
 * `Skip` · `Apply` (a delete: `Delete`, after a confirm), then `Undo`. Nothing changes until Ben taps (rule 2); Apply is
 * on the versions the card shows (`Out of date. Ask again.` otherwise, rule 5). Every value is from the record.
 */
export function WorkoutFixCard({ record, onChanged }: { record: ActionRecord; onChanged?: () => void }) {
  const theme = useTheme();
  const services = useServices();
  const [state, setState] = useState<WorkoutFixCardState | { kind: 'skipped' } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const busy = useRef(false);
  const undoOp = useRef(newUuid());

  useEffect(() => {
    const screen = { alive: true };
    void services.workoutFix
      .card(record.actionId)
      .catch((): WorkoutFixCardState => ({ kind: 'gone' }))
      .then((s) => {
        if (screen.alive) setState(s);
      });
    return () => {
      screen.alive = false;
    };
  }, [services, record.actionId]);

  const lines = workoutFixLines(record);
  if (lines === null || state === null || state.kind === 'gone') return null;

  async function run(write: () => Promise<void>) {
    if (busy.current) return;
    busy.current = true;
    try {
      await write();
      const next = await services.workoutFix.card(record.actionId).catch((): WorkoutFixCardState => ({ kind: 'gone' }));
      setState(next);
      onChanged?.();
    } catch {
      setNotice(WORKOUT_FIX_COPY.failed);
    } finally {
      busy.current = false;
    }
  }

  const apply = () =>
    void run(async () => {
      const r = await services.workoutFix.apply(record.actionId);
      setNotice(r.ok ? null : r.line);
    });

  return (
    <CoachCardFrame>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space['2'] }}>
        <Icon name={lines.icon} color="text.secondary" size={18} />
        <AppText variant="label" color="text.secondary">
          {lines.head}
        </AppText>
      </View>
      <AppText variant="callout">{lines.change}</AppText>
      {notice !== null ? (
        <AppText variant="callout" color="text.secondary">
          {notice}
        </AppText>
      ) : null}
      <CardActions>
        {state.kind === 'open' ? (
          <>
            <TextButton
              label={WORKOUT_FIX_COPY.skip}
              onPress={() => {
                setState({ kind: 'skipped' });
              }}
            />
            <TextButton
              label={lines.applyLabel}
              onPress={() => {
                if (!lines.destructive) {
                  apply();
                  return;
                }
                // A clear confirm before a delete (Undo stays on the card after).
                Alert.alert(WORKOUT_FIX_COPY.confirmTitle(lines.head), lines.change.split(' → ')[0], [
                  { text: WORKOUT_FIX_COPY.cancel, style: 'cancel' },
                  { text: WORKOUT_FIX_COPY.delete, style: 'destructive', onPress: apply },
                ]);
              }}
            />
          </>
        ) : null}
        {state.kind === 'applied' ? (
          <>
            <AppText variant="callout" color="text.secondary">
              {lines.destructive ? WORKOUT_FIX_COPY.deleted : WORKOUT_FIX_COPY.applied}
            </AppText>
            <TextButton
              label={WORKOUT_FIX_COPY.undo}
              onPress={() =>
                void run(async () => {
                  const ok = await services.workoutFix.undo(record.actionId, undoOp.current);
                  setNotice(ok ? null : WORKOUT_FIX_COPY.notUndone);
                })
              }
            />
          </>
        ) : null}
        {state.kind === 'skipped' || state.kind === 'undone' ? (
          <AppText variant="callout" color="text.secondary">
            {state.kind === 'skipped' ? WORKOUT_FIX_COPY.skipped : WORKOUT_FIX_COPY.undone}
          </AppText>
        ) : null}
      </CardActions>
    </CoachCardFrame>
  );
}
