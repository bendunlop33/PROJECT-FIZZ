import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import { useCallback, useLayoutEffect, useState } from 'react';
import { ScrollView, View } from 'react-native';

import { DeleteToastView } from '../../history/DeleteToastView';
import { useDeleteToast } from '../../history/useDeleteToast';
import type { ExerciseDetailParams } from '../../navigation/types';
import type { ExerciseTab } from '../../services/progress-service';
import { useTheme } from '../../theme';
import { TextButton } from '../../ui';
import { AskPill } from '../coach/AskPill';
import { ExercisesTab } from './ExercisesTab';

/**
 * Exercise detail (Summary, a workout's `History`, the editors, Library's exercise page). (Ben, 26 Oct: one
 * exercise-progress screen) It is Progress › Lifts' own body for this exercise (`ExercisesTab` with
 * `exerciseId`): the same chart, series / Measure / Period controls, periods, stat line, trailing average and
 * sessions table, then `BEST REPS` and `RECORDS`, with no chip row. Opened on a workout (a Summary row), it
 * shows that workout's series and selects it. A tap on a point, a record or a row opens that workout.
 * Local only: identical offline and with no coach (check 41).
 */

type Route = RouteProp<{ ProgressExercise: ExerciseDetailParams; ExerciseProgress: ExerciseDetailParams }, 'ProgressExercise' | 'ExerciseProgress'>;

export function ExerciseDetailScreen() {
  const theme = useTheme();
  const navigation = useNavigation();
  const route = useRoute<Route>();
  // A workout deleted from a Summary opened here comes back with Undo (delete-workouts DW1).
  const deleted = useDeleteToast();
  const [toastHeight, setToastHeight] = useState(0);
  const { exerciseId } = route.params;
  // Opened on a workout: its series, selected, in a period that holds it (until Ben picks his own).
  const [opening] = useState(() => (route.params.sessionId ? { sessionId: route.params.sessionId, sessionExerciseId: route.params.sessionExerciseId ?? null } : null));
  const [tab, setTab] = useState<ExerciseTab | null>(null);
  const onLoaded = useCallback((t: ExerciseTab | null) => {
    setTab(t);
  }, []);
  const view = tab?.view ?? null;

  useLayoutEffect(() => {
    const title = view?.title ?? route.params.name ?? '';
    navigation.setOptions(
      route.name === 'ExerciseProgress'
        ? {
            title,
            headerRight: () => (
              <TextButton
                label="Done"
                onPress={() => {
                  navigation.goBack();
                }}
              />
            ),
          }
        : { title },
    );
  }, [navigation, route.name, route.params.name, view?.title]);

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors['bg.canvas'] }}>
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingHorizontal: theme.components.screenMargin, paddingTop: theme.space['3'], paddingBottom: theme.space['8'] + 56 + (deleted.toast ? toastHeight : 0), gap: theme.space['5'] }}
      >
        {route.name === 'ProgressExercise' && view !== null ? (
          <View style={{ alignSelf: 'flex-end' }}>
            <TextButton
              label="Exercise info"
              onPress={() => {
                navigation.navigate('Tabs', { screen: 'Progress', params: { screen: 'ProgressExerciseInfo', params: { exerciseId, name: view.title } } });
              }}
            />
          </View>
        ) : null}
        <ExercisesTab exerciseId={exerciseId} opening={opening} onLoaded={onLoaded} />
      </ScrollView>
      {view !== null && tab !== null ? (
        <AskPill
          bottom={theme.space['4'] + (deleted.toast ? toastHeight : 0)}
          onPress={() => {
            navigation.navigate('Coach', { entry: { kind: 'progress_exercise', exerciseName: view.title, seriesLabel: view.series.find((s) => s.id === view.seriesId)?.label ?? '', from: tab.window.from, to: tab.window.to } });
          }}
        />
      ) : null}
      {/* The delete Undo toast floats over every state: deleting the exercise's only workout leaves no chart, but the Undo must still show (review progress-merge S1). */}
      {deleted.toast ? (
        <View
          style={{ position: 'absolute', left: 0, right: 0, bottom: 0 }}
          onLayout={(e) => {
            setToastHeight(e.nativeEvent.layout.height);
          }}
        >
          <DeleteToastView state={deleted} />
        </View>
      ) : null}
    </View>
  );
}
