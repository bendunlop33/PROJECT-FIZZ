import { useNavigation } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Pressable, ScrollView, View } from 'react-native';

import type { ProgressStackParams } from '../../navigation/types';
import { ChangeRow, PROGRESS_TEXT, ProgressCard } from '../../reviews/charts';
import { useProposalActions } from '../../reviews/ReviewsSection';
import { useScreenData } from '../../shell/context';
import { useTheme } from '../../theme';
import { AppText, Icon } from '../../ui';

/**
 * Progress › Past weeks (Progress v3: `Past weeks ›` under Coach's changes): each earlier week's facts and
 * the changes it made, as stored (never recomputed). Local only.
 */
export function PastWeeksScreen() {
  const theme = useTheme();
  const navigation = useNavigation();
  const [data] = useScreenData((s) => s.reviews.pastWeeks());
  const rows = data.state === 'ready' ? data.value : [];
  return (
    <ScrollView contentInsetAdjustmentBehavior="automatic" style={{ backgroundColor: theme.colors['bg.canvas'] }} contentContainerStyle={{ paddingHorizontal: theme.components.screenMargin, paddingTop: theme.space['4'], paddingBottom: theme.space['8'] }}>
      {data.state === 'ready' && rows.length === 0 ? (
        <AppText variant="body" color="text.secondary">
          No past weeks yet
        </AppText>
      ) : null}
      {rows.map((h, i) => (
        <Pressable
          key={h.reviewId}
          accessibilityRole="button"
          accessibilityLabel={h.accessibilityLabel}
          onPress={() => {
            navigation.navigate('Tabs', { screen: 'Progress', params: { screen: 'ProgressReview', params: { reviewId: h.reviewId } } });
          }}
          style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: theme.space['3'], minHeight: 56, paddingVertical: theme.space['2'], borderTopWidth: i === 0 ? 0 : theme.dividerWidth, borderColor: theme.colors['border.divider'], opacity: pressed ? 0.7 : 1 })}
        >
          <View style={{ flex: 1, gap: 2 }}>
            <AppText variant="body" numeric>
              {h.title}
            </AppText>
            <AppText variant="callout" color="text.secondary" numeric>
              {h.detail}
            </AppText>
          </View>
          <Icon name="chevron.right" size={14} color="text.tertiary" />
        </Pressable>
      ))}
    </ScrollView>
  );
}

/** One past week in full: the coach's verdict (or `Not reviewed`), every fact, and its changes (Undo / Redo while they still apply). */
export function ReviewDetailScreen({ route }: NativeStackScreenProps<ProgressStackParams, 'ProgressReview'>) {
  const theme = useTheme();
  const [data, reload] = useScreenData((s) => s.reviews.review(route.params.reviewId));
  const d = data.state === 'ready' ? data.value : null;
  const actions = useProposalActions(d?.card.reviewId ?? null, reload);
  return (
    <ScrollView contentInsetAdjustmentBehavior="automatic" style={{ backgroundColor: theme.colors['bg.canvas'] }} contentContainerStyle={{ paddingHorizontal: theme.components.screenMargin, paddingTop: theme.space['4'], paddingBottom: theme.space['8'], gap: theme.space['4'] }}>
      {data.state === 'ready' && d === null ? (
        <AppText variant="body" color="text.secondary">
          Not found
        </AppText>
      ) : null}
      {d !== null ? (
        <>
          <ProgressCard>
            <View accessible accessibilityLabel={d.card.accessibilityLabel} style={{ gap: theme.space['2'] }}>
              <AppText variant="label" color="text.secondary" numeric style={PROGRESS_TEXT.sub}>
                {d.card.week}
              </AppText>
              <AppText variant="body" color={d.card.reviewed ? 'text.primary' : 'text.secondary'} style={PROGRESS_TEXT.note}>
                {d.card.verdict}
              </AppText>
              {[...d.card.lines, ...d.card.facts].map((l, i) => (
                <AppText key={`l${String(i)}`} variant="callout" color={i < d.card.lines.length ? 'text.primary' : 'text.secondary'} numeric style={PROGRESS_TEXT.why}>
                  {l}
                </AppText>
              ))}
            </View>
          </ProgressCard>
          {d.changes !== null && d.changes.rows.length + d.changes.asks.length > 0 ? (
            <ProgressCard>
              {[...d.changes.rows, ...d.changes.asks].map((r, i) => (
                <ChangeRow
                  key={r.id}
                  row={r}
                  first={i === 0}
                  onUndo={() => {
                    actions.undo(r);
                  }}
                  onRedo={() => {
                    actions.redo(r);
                  }}
                />
              ))}
              {actions.message !== null ? (
                <AppText variant="callout" color="text.secondary" accessibilityLiveRegion="polite">
                  {actions.message}
                </AppText>
              ) : null}
            </ProgressCard>
          ) : null}
        </>
      ) : null}
    </ScrollView>
  );
}
