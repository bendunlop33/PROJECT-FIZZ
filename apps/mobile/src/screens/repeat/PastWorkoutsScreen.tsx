import { useNavigation } from '@react-navigation/native';

import { toMs } from '@fizz/domain';

import { formatShortDate } from '../../format/dates';
import { importedNotListedLine } from '../../import/views';
import { plural } from '../../format/numbers';
import { useScreenData, useServices } from '../../shell/context';
import { AppText, Group, Row, Screen, StatusLine, TextButton } from '../../ui';

/**
 * `Start from a past workout`: a lightweight stand-in for routines
 * (critic-pass-1 #1, T9). Pick any finished workout to repeat its sets as
 * targets. Nothing starts until `Start workout` on the next screen.
 * Imported FitNotes workouts aren't listed (no equipment checked their
 * loads; P-I3 open, review r2 B1), and the screen says so.
 */
export function PastWorkoutsScreen() {
  const navigation = useNavigation();
  const services = useServices();
  const [data, reload] = useScreenData((s) => s.repeat.candidates());
  if (data.state === 'loading') return <Screen>{null}</Screen>;
  if (data.state === 'error') {
    return (
      <Screen>
        <StatusLine icon="exclamationmark.triangle" tone="warning" text="Couldn’t read past workouts." detail={data.message} action={<TextButton label="Try again" onPress={reload} />} />
      </Screen>
    );
  }
  const tz = services.now().tz;
  return (
    <Screen>
      <AppText variant="callout" color="text.secondary">
        Pick a workout to do again. Its sets become today’s targets; nothing is marked done.
      </AppText>
      {data.value.unreadable > 0 ? (
        <StatusLine
          icon="exclamationmark.triangle"
          tone="warning"
          text={`${plural(data.value.unreadable, 'workout', 'workouts')} couldn’t be read and ${data.value.unreadable === 1 ? 'isn’t' : 'aren’t'} listed.`}
          detail="Your other workouts are fine. Check all data in Data & backup for details."
        />
      ) : null}
      {data.value.importedNotListed > 0 ? (
        <StatusLine icon="info.circle" tone="info" text={importedNotListedLine(data.value.importedNotListed)} />
      ) : null}
      {data.value.rows.length === 0 ? (
        <AppText variant="body">{data.value.importedNotListed > 0 ? 'No workouts logged in the app yet.' : 'No finished workouts yet.'}</AppText>
      ) : (
        <Group>
          {data.value.rows.map((c) => (
            <Row
              key={c.sessionId}
              title={`${formatShortDate(toMs(c.startedAtUtc), c.tz || tz)} · ${c.title}`}
              subtitle={c.exerciseNames.join(', ')}
              secondLine={`${c.gymName} · ${plural(c.sets, 'set', 'sets')}`}
              onPress={() => {
                navigation.navigate('Repeat', { sessionId: c.sessionId });
              }}
            />
          ))}
        </Group>
      )}
    </Screen>
  );
}
