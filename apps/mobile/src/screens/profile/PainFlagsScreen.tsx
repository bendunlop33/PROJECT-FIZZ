import { useNavigation } from '@react-navigation/native';
import { useState } from 'react';

import { isPainCheckDue, toMs } from '@fizz/domain';
import type { PainArea } from '@fizz/schemas';

import { nowMs as clockNow } from '../../clock';
import { formatShortDate } from '../../format/dates';
import { useDataChanged, useScreenData, useServices } from '../../shell/context';
import { Group, Row, Screen, StatusLine, TextButton, Toast } from '../../ui';
import { confirmClearFlag, type PainToast } from '../../workout/pain-actions';

const AREA: Record<PainArea, string> = { shoulder: 'Shoulder', elbow: 'Elbow', wrist: 'Wrist', neck: 'Neck', back: 'Back', hip: 'Hip', knee: 'Knee', ankle: 'Ankle', other: 'Other' };

/**
 * Profile → Pain flags (review workout-loop S7): every active flag, and
 * `Clear` once Ben is ready. Only Ben clears a flag (rule 9), always through
 * the AW10 confirmation; while it is active, that movement's targets don't
 * go up. Tapping a flag opens its pain flag sheet (active-workout §2.14.4),
 * which asks `Still hurts?` when the two-weekly check is due. No diagnosis.
 */
export function PainFlagsScreen() {
  const services = useServices();
  const changed = useDataChanged();
  const navigation = useNavigation();
  const [toast, setToast] = useState<PainToast | null>(null);
  const [data, reload] = useScreenData((s) => s.pain.active());
  if (data.state === 'loading') return <Screen>{null}</Screen>;
  if (data.state === 'error') {
    return (
      <Screen>
        <StatusLine icon="exclamationmark.triangle" tone="warning" text="Couldn’t read pain flags." detail={data.message} action={<TextButton label="Try again" onPress={reload} />} />
      </Screen>
    );
  }
  const flags = [...data.value].sort((a, b) => (a.reportedAt.utc < b.reportedAt.utc ? 1 : -1));
  const now = clockNow();
  const report = (t: PainToast) => {
    setToast(t);
    changed();
    reload();
  };
  return (
    <Screen>
      {toast ? <Toast icon={toast.icon} text={toast.text} {...(toast.action && toast.onAction ? { action: toast.action, onAction: toast.onAction } : {})} /> : null}
      {flags.length === 0 ? (
        <StatusLine icon="checkmark.circle.fill" tone="done" text="No pain flags" />
      ) : (
        <Group>
          {flags.map((f) => (
            <Row
              key={f.id}
              icon="exclamationmark.triangle"
              iconColor="status.warning"
              title={f.exerciseName}
              subtitle={`${f.area ? `${AREA[f.area]} · ` : ''}flagged ${formatShortDate(toMs(f.reportedAt.utc), f.reportedAt.tz)}${f.source === 'check_in' ? ' from a check-in' : ''}`}
              secondLine={isPainCheckDue(f, now, services.now().tz) ? 'Check due' : null}
              onPress={() => {
                navigation.navigate('PainFlag', { flagId: f.id });
              }}
              trailing={
                <TextButton
                  label="Clear"
                  onPress={() => {
                    confirmClearFlag(services, f, report);
                  }}
                />
              }
            />
          ))}
        </Group>
      )}
    </Screen>
  );
}
