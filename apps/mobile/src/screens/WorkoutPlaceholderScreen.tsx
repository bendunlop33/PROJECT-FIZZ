import { useNavigation } from '@react-navigation/native';
import { useState } from 'react';
import { Alert, View } from 'react-native';

import { toMs } from '@fizz/domain';

import { useDataChanged, useScreenData, useServices } from '../shell/context';
import { newUuid } from '../device/runtime';
import { formatShortDate, formatTime } from '../format/dates';
import { plural } from '../format/numbers';
import { useTheme } from '../theme';
import { AppText, DangerTextButton, PrimaryButton, Screen, StatusLine, TextButton } from '../ui';

/**
 * Stand-in for Active set / Rest / Summary, which the next slice builds. It
 * exists so the session lifecycle is testable on the phone now: start,
 * force-close and reopen (it opens straight here when under 6 h), finish
 * (which starts the automatic on-phone backup) or discard. It says plainly
 * that logging isn't here yet.
 */
export function WorkoutPlaceholderScreen() {
  const theme = useTheme();
  const services = useServices();
  const changed = useDataChanged();
  const navigation = useNavigation();
  // One operation ID per screen visit: a double tap or a retry is the same command.
  const [finishOp] = useState(newUuid);
  const [discardOp] = useState(newUuid);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data] = useScreenData((s) => s.sessions.active());
  const now = services.now();

  const close = () => {
    if (navigation.canGoBack()) navigation.goBack();
    else navigation.navigate('Tabs', { screen: 'Today' });
  };

  if (data.state !== 'ready') return <Screen>{null}</Screen>;
  const active = data.value;
  if (active === null) {
    return (
      <Screen footer={<PrimaryButton label="Go to Today" onPress={close} />}>
        <StatusLine icon="checkmark.circle.fill" tone="done" text="No workout in progress" detail="Saved on this phone" />
      </Screen>
    );
  }
  const startedMs = toMs(active.session.startedAt.utc);
  const logged = active.sets.filter((s) => s.status === 'completed').length;

  async function run(kind: 'finish' | 'discard') {
    if (busy || active === null) return;
    setBusy(true);
    setError(null);
    const r = kind === 'finish' ? await services.sessions.finish(active, finishOp) : await services.sessions.discard(active, discardOp);
    setBusy(false);
    if (!r.ok) {
      setError(kind === 'finish' ? `Couldn’t finish the workout. Nothing was lost; try again. (${r.error.message})` : `Couldn’t discard: ${r.error.message} Nothing was changed.`);
      return;
    }
    changed();
    close();
  }

  return (
    <Screen
      footer={<PrimaryButton label="Finish workout" busy={busy} onPress={() => void run('finish')} />}
    >
      <View style={{ flexDirection: 'row', justifyContent: 'flex-start' }}>
        <TextButton label="Minimise" icon="chevron.down" onPress={close} />
      </View>
      <AppText variant="title2" accessibilityRole="header">
        Workout in progress
      </AppText>
      <StatusLine
        icon="checkmark.circle.fill"
        tone="done"
        text="Saved on this phone"
        detail={`Started ${formatShortDate(startedMs, now.tz)}, ${formatTime(startedMs, now.tz)} · ${logged === 0 ? 'nothing logged' : plural(logged, 'set', 'sets')}`}
      />
      <StatusLine
        icon="info.circle"
        tone="info"
        text="Logging sets isn’t in this build yet"
        detail="The set, rest and summary screens come next. For now you can finish or discard this workout. Finishing starts a backup on this phone."
      />
      {error ? <StatusLine icon="exclamationmark.triangle" tone="warning" text={error} /> : null}
      <View style={{ marginTop: theme.space['8'] }}>
        <DangerTextButton
          label="Discard workout"
          disabled={busy}
          onPress={() => {
            // Nothing logged: discard at once (today.md §4 Undo). Otherwise confirm.
            if (logged === 0) {
              void run('discard');
              return;
            }
            Alert.alert('Discard this workout?', `${plural(logged, 'logged set is', 'logged sets are')} hidden from history. This can’t be undone.`, [
              { text: 'Cancel', style: 'cancel' },
              { text: 'Discard', style: 'destructive', onPress: () => void run('discard') },
            ]);
          }}
        />
      </View>
    </Screen>
  );
}
