import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { ScrollView, View } from 'react-native';

import type { ProgressStackParams } from '../../navigation/types';
import { ConsistencyBlock, LiftTrend, SetsBars } from '../../reviews/charts';
import { ReviewCard } from '../../reviews/ReviewsSection';
import { useScreenData } from '../../shell/context';
import { useTheme } from '../../theme';
import { AppText, Card } from '../../ui';

/**
 * One past week's review in full (Progress › Reviews › History; workout-builder-v3 §6.2): the verdict (or
 * `Not reviewed`), every fact, its proposals, and the week's consistency, sets and lift charts as stored
 * (facts are the review's own, not recomputed). Local only.
 */
export function ReviewDetailScreen({ route }: NativeStackScreenProps<ProgressStackParams, 'ProgressReview'>) {
  const theme = useTheme();
  const [data, reload] = useScreenData((s) => s.reviews.review(route.params.reviewId));
  const d = data.state === 'ready' ? data.value : null;
  return (
    <ScrollView contentInsetAdjustmentBehavior="automatic" style={{ backgroundColor: theme.colors['bg.canvas'] }} contentContainerStyle={{ paddingHorizontal: theme.components.screenMargin, paddingTop: theme.space['4'], paddingBottom: theme.space['8'], gap: theme.space['5'] }}>
      {data.state === 'ready' && d === null ? (
        <AppText variant="body" color="text.secondary">
          Not found
        </AppText>
      ) : null}
      {d !== null ? (
        <>
          <ReviewCard card={d.card} onReload={reload} />
          <Card>
            <View style={{ gap: theme.space['5'] }}>
              <ConsistencyBlock view={d.consistency} />
              <SetsBars view={d.sets} />
              {d.lifts.map((c) => (
                <LiftTrend key={c.exerciseId} chart={c} />
              ))}
            </View>
          </Card>
        </>
      ) : null}
    </ScrollView>
  );
}
