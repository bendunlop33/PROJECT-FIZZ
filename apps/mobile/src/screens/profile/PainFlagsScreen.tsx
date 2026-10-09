import { Alert } from 'react-native';

import { toMs } from '@fizz/domain';
import type { PainArea } from '@fizz/schemas';

import { formatShortDate } from '../../format/dates';
import { useDataChanged, useScreenData, useServices } from '../../shell/context';
import { AppText, Group, Row, Screen, StatusLine, TextButton } from '../../ui';
import { painClearConfirm } from '../../workout/pain-clear';

const AREA: Record<PainArea, string> = { shoulder: 'Shoulder', elbow: 'Elbow', wrist: 'Wrist', neck: 'Neck', back: 'Back', hip: 'Hip', knee: 'Knee', ankle: 'Ankle', other: 'Other' };

/**
 * Profile → Pain flags (review workout-loop S7): every active flag, and
 * `Clear` once Ben is ready. Only Ben clears a flag (rule 9); while it is
 * active, that movement's targets don't go up. No diagnosis, no advice.
 */
export function PainFlagsScreen() {
  const services = useServices();
  const changed = useDataChanged();
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
  return (
    <Screen>
      <AppText variant="callout" color="text.secondary">
        While a movement is flagged, its targets don’t go up. Clear a flag when you’re ready to progress it again.
      </AppText>
      {flags.length === 0 ? (
        <StatusLine icon="checkmark.circle.fill" tone="done" text="No pain flags" detail="Progression runs as normal." />
      ) : (
        <Group>
          {flags.map((f) => (
            <Row
              key={f.id}
              icon="exclamationmark.triangle"
              iconColor="status.warning"
              title={f.exerciseName}
              subtitle={`${f.area ? `${AREA[f.area]} · ` : ''}flagged ${formatShortDate(toMs(f.reportedAt.utc), f.reportedAt.tz)}${f.source === 'check_in' ? ' from a check-in' : ''}`}
              trailing={
                <TextButton
                  label="Clear"
                  onPress={() => {
                    Alert.alert(painClearConfirm(f.exerciseName).title, painClearConfirm(f.exerciseName).message, [
                      { text: 'Cancel', style: 'cancel' },
                      {
                        text: 'Clear',
                        onPress: () => {
                          void services.pain.clear([f.id]).then(() => {
                            changed();
                          });
                        },
                      },
                    ]);
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
