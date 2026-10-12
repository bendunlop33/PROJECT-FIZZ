import { useNavigation } from '@react-navigation/native';
import { useEffect, useState } from 'react';
import { ActionSheetIOS, Pressable, View } from 'react-native';

import { toMs } from '@fizz/domain';

import { formatShortDate } from '../../format/dates';
import { importedNotListedLine } from '../../import/views';
import { plural } from '../../format/numbers';
import { newUuid } from '../../device/runtime';
import { useDataChanged, useScreenData, useServices } from '../../shell/context';
import { TIMING } from '../../theme';
import { AppText, Group, Icon, LinkLine, Row, Screen, StatusLine, TextButton, Toast } from '../../ui';
import { LIBRARY_COPY_UI } from '../../workout/library-view';
import { useSaveToWorkouts } from '../routines/SaveWorkoutSheet';

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
  const changed = useDataChanged();
  const [toast, setToast] = useState<{ text: string; action?: string; onAction?: () => void } | null>(null);
  const [data, reload] = useScreenData((s) => s.repeat.candidates());
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => {
      setToast(null);
    }, TIMING.undoToast);
    return () => {
      clearTimeout(t);
    };
  }, [toast]);
  const save = useSaveToWorkouts(
    (made) => {
      changed();
      setToast({
        text: LIBRARY_COPY_UI.savedToWorkouts,
        action: LIBRARY_COPY_UI.undo,
        onAction: () => {
          setToast(null);
          void services.routines.remove({ routineId: made.id, expectedVersion: made.version, opId: newUuid() }).then((u) => {
            changed();
            if (!u.ok) setToast({ text: u.message });
          });
        },
      });
    },
    () => {
      setToast({ text: LIBRARY_COPY_UI.nothingToSave });
    },
  );
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
    <View style={{ flex: 1 }}>
    <Screen>
      {data.value.unreadable > 0 ? (
        <StatusLine
          icon="exclamationmark.triangle"
          tone="warning"
          text={`${plural(data.value.unreadable, 'workout', 'workouts')} couldn’t be read and ${data.value.unreadable === 1 ? 'isn’t' : 'aren’t'} listed.`}
          action={
            <TextButton
              label="Check data ›"
              tone="secondary"
              onPress={() => {
                navigation.navigate('Tabs', { screen: 'Profile', params: { screen: 'DataBackup', initial: false } });
              }}
            />
          }
        />
      ) : null}
      {data.value.importedNotListed > 0 ? (
        <LinkLine
          accessibilityLabel={`${importedNotListedLine(data.value.importedNotListed).replace(' ›', '')}. Opens Past imports.`}
          onPress={() => {
            navigation.navigate('Tabs', { screen: 'Profile', params: { screen: 'PastImports', initial: false } });
          }}
        >
          <AppText variant="callout" color="text.secondary">
            {importedNotListedLine(data.value.importedNotListed)}
          </AppText>
        </LinkLine>
      ) : null}
      {data.value.rows.length === 0 ? (
        <AppText variant="body">{data.value.importedNotListed > 0 ? 'No workouts logged in the app yet.' : 'No finished workouts yet.'}</AppText>
      ) : (
        <Group>
          {data.value.rows.map((c) => (
            <View key={c.sessionId} style={{ flexDirection: 'row', alignItems: 'center' }}>
              <View style={{ flex: 1 }}>
                <Row
                  title={`${formatShortDate(toMs(c.startedAtUtc), c.tz || tz)} · ${c.title}`}
                  subtitle={c.exerciseNames.join(', ')}
                  secondLine={`${c.gymName} · ${plural(c.sets, 'set', 'sets')}`}
                  onPress={() => {
                    navigation.navigate('Repeat', { sessionId: c.sessionId });
                  }}
                />
              </View>
              {/* `⋯` → `Save to Workouts` (routines.md §A2.6): what was done, loads Auto. */}
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`More, ${c.title}`}
                accessibilityActions={[{ name: LIBRARY_COPY_UI.saveToWorkouts, label: LIBRARY_COPY_UI.saveToWorkouts }]}
                onAccessibilityAction={() => void save.open({ kind: 'session', sessionId: c.sessionId }, null)}
                onPress={() => {
                  const options = [LIBRARY_COPY_UI.saveToWorkouts, LIBRARY_COPY_UI.cancel];
                  ActionSheetIOS.showActionSheetWithOptions({ title: c.title, options, cancelButtonIndex: 1 }, (i) => {
                    if (i === 0) void save.open({ kind: 'session', sessionId: c.sessionId }, null);
                  });
                }}
                style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}
              >
                <Icon name="ellipsis" color="text.secondary" />
              </Pressable>
            </View>
          ))}
        </Group>
      )}
    </Screen>
      {toast ? (
        <View style={{ position: 'absolute', left: 0, right: 0, bottom: 24 }}>
          <Toast icon="info.circle" text={toast.text} {...(toast.action ? { action: toast.action } : {})} {...(toast.onAction ? { onAction: toast.onAction } : {})} />
        </View>
      ) : null}
      {save.sheet}
    </View>
  );
}
