import { useScreenData } from '../shell/context';
import { plural } from '../format/numbers';
import { AppText, Screen, StatusLine } from '../ui';

/** Progress tab placeholder (progress.md comes in a later slice). Honest, no fake charts. */
export function ProgressScreen() {
  const [data] = useScreenData((s) => s.yourData.counts());
  const count = data.state === 'ready' ? data.value.finishedWorkouts : null;
  return (
    <Screen>
      <AppText variant="title2" accessibilityRole="header">
        Progress
      </AppText>
      <StatusLine
        icon="info.circle"
        tone="info"
        text="Coming in a later build"
        detail="Trends, records and the calendar of past workouts aren’t built yet."
      />
      {count !== null ? (
        <StatusLine
          icon="checkmark.circle.fill"
          tone="done"
          text="Saved on this phone"
          detail={count === 0 ? 'No workouts logged yet.' : `${plural(count, 'workout', 'workouts')} logged.`}
        />
      ) : null}
    </Screen>
  );
}
