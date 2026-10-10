import { useNavigation } from '@react-navigation/native';

import { toMs } from '@fizz/domain';

import { formatShortDate } from '../format/dates';
import { plural } from '../format/numbers';
import { useScreenData, useServices } from '../shell/context';
import { AppText, Group, Row, Screen, SectionHeader, StatusLine, TextButton } from '../ui';

/**
 * Progress (audit F6): until progress.md's charts are built, an honest list
 * of past workouts, newest first, each opening its summary. No fake charts,
 * no invented trends (rule 6).
 */
export function ProgressScreen() {
  const navigation = useNavigation();
  const services = useServices();
  const [data, reload] = useScreenData((s) => s.repeat.candidates(50));
  const tz = services.now().tz;
  return (
    <Screen>
      <AppText variant="title1" accessibilityRole="header">
        Progress
      </AppText>
      {data.state === 'error' ? (
        <StatusLine icon="exclamationmark.triangle" tone="warning" text="Couldn’t read past workouts." detail={data.message} action={<TextButton label="Try again" onPress={reload} />} />
      ) : null}
      {data.state === 'ready' ? (
        <>
          <SectionHeader title="Workouts" />
          {data.value.rows.length === 0 ? (
            <AppText variant="callout" color="text.secondary">
              No finished workouts yet. They’ll show here, newest first.
            </AppText>
          ) : (
            <Group>
              {data.value.rows.map((c) => (
                <Row
                  key={c.sessionId}
                  title={`${c.title} · ${formatShortDate(toMs(c.startedAtUtc), c.tz || tz)}`}
                  subtitle={c.exerciseNames.join(', ')}
                  secondLine={`${c.gymName} · ${plural(c.sets, 'set', 'sets')}`}
                  onPress={() => {
                    navigation.navigate('Summary', { sessionId: c.sessionId, back: true });
                  }}
                />
              ))}
            </Group>
          )}
          {data.value.unreadable > 0 ? (
            <StatusLine icon="exclamationmark.triangle" tone="warning" text={`${plural(data.value.unreadable, 'workout', 'workouts')} couldn’t be read and ${data.value.unreadable === 1 ? 'isn’t' : 'aren’t'} listed.`} />
          ) : null}
          {data.value.importedNotListed > 0 ? (
            <StatusLine icon="info.circle" tone="info" text={`${plural(data.value.importedNotListed, 'workout', 'workouts')} imported from FitNotes ${data.value.importedNotListed === 1 ? 'isn’t' : 'aren’t'} listed here yet. They’re in Data & backup, under Past imports.`} />
          ) : null}
          <AppText variant="callout" color="text.tertiary">
            Trends and records come in a later build.
          </AppText>
        </>
      ) : null}
    </Screen>
  );
}
