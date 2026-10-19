import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import { ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { LibraryStackParams } from '../../navigation/types';
import { PLAN_COPY } from '../../services/plan-services';
import { useScreenData } from '../../shell/context';
import { useTheme } from '../../theme';
import { AppText, HeroHeader, PrimaryButton, StatusLine, TextButton } from '../../ui';

export const PLAN_DAY_COPY = {
  start: (name: string) => `Start ${name}`,
  edit: 'Edit',
  askCoach: 'Ask coach',
  coachDraft: (name: string) => `Change ${name} in my plan: `,
} as const;

/**
 * Your plan › a day (Ben, 19 Oct; mockup approved): the day's name, `Day 2
 * of 4 · Main gym · about 60 min`, each exercise's planned sets × reps ·
 * load at this gym with last time's sets and targets hit (or `est.`), then
 * `Start` (the Workout overview, where every start begins), `Edit` (the
 * saved workout) and `Ask coach` (the coach sheet with a draft; nothing is
 * sent). Every value comes from `services.plans.planDay`; nothing is
 * computed here. Local only (rule 1).
 */
export function PlanDayScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const { routineId, name: shownName } = useRoute<RouteProp<LibraryStackParams, 'LibraryPlanDay'>>().params;
  const [data, reload] = useScreenData((s) => s.plans.planDay(routineId));
  const day = data.state === 'ready' ? data.value : null;
  const name = day?.name ?? shownName ?? '';

  return (
    <ScrollView style={{ flex: 1, backgroundColor: theme.colors['bg.canvas'] }} contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ paddingHorizontal: theme.components.screenMargin, paddingTop: theme.space['3'], paddingBottom: theme.space['8'] + insets.bottom, gap: theme.space['5'] }}>
      {data.state === 'error' ? <StatusLine icon="exclamationmark.triangle" tone="warning" text={PLAN_COPY.failed} action={<TextButton label="Try again" onPress={reload} />} /> : null}
      {data.state === 'ready' && day === null ? <StatusLine icon="info.circle" tone="info" text={PLAN_COPY.missing} /> : null}
      {day !== null ? (
        <>
          <HeroHeader size="screen" title={day.name} lines={[day.header]} />
          {day.status !== 'planned' ? <StatusLine icon="info.circle" tone="info" text={day.status === 'no_gym' ? PLAN_COPY.noGym : PLAN_COPY.notHere} /> : null}
          {day.rows.length > 0 ? (
            <View style={{ backgroundColor: theme.colors['bg.surface'], borderRadius: theme.radius.lg, paddingHorizontal: theme.space['4'], paddingVertical: theme.space['1'] }}>
              {day.rows.map((r, i) => (
                <View key={r.key} accessible accessibilityLabel={r.accessibilityLabel} style={{ paddingVertical: theme.space['3'], gap: 2, borderTopWidth: i === 0 ? 0 : theme.dividerWidth, borderTopColor: theme.colors['border.divider'] }}>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', columnGap: theme.space['3'] }}>
                    <AppText variant="body" style={{ flexShrink: 1 }}>
                      {r.name}
                    </AppText>
                    <AppText variant="body" numeric>
                      {r.line}
                    </AppText>
                  </View>
                  {r.sub !== null ? (
                    <AppText variant="callout" color="text.secondary" numeric>
                      {r.sub}
                    </AppText>
                  ) : null}
                </View>
              ))}
            </View>
          ) : null}
          <PrimaryButton
            label={PLAN_DAY_COPY.start(name)}
            onPress={() => {
              navigation.navigate('WorkoutOverview', { target: { kind: 'routine', routineId: day.routineId } });
            }}
          />
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', columnGap: theme.space['5'] }}>
            <TextButton
              label={PLAN_DAY_COPY.edit}
              onPress={() => {
                navigation.navigate('WorkoutEditor', { routineId: day.routineId, from: 'Library' });
              }}
            />
            <TextButton
              label={PLAN_DAY_COPY.askCoach}
              onPress={() => {
                navigation.navigate('Coach', { entry: { kind: 'today' }, focus: true, draft: PLAN_DAY_COPY.coachDraft(name) });
              }}
            />
          </View>
        </>
      ) : null}
    </ScrollView>
  );
}
