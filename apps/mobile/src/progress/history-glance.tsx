import { useState } from 'react';
import { View } from 'react-native';

import type { HistoryGlanceView } from '@fizz/domain';

import { useTheme } from '../theme';
import { AppText, Eyebrow } from '../ui';
import { Divider, Table } from '../ui/table-parts';
import { ExerciseLineChart } from './exercise-line-chart';

/** The small chart's plot height: about a third of the Lifts tab's. */
const GLANCE_CHART_HEIGHT = 110;

/**
 * (Ben, 26 Oct) The exercise pop-up's read-only `History` mid-workout: the last 3 comparable sessions
 * (`12 Oct · 100 × 8, 8, 7`) and a small top-set chart drawn by the Progress chart component. Values only;
 * nothing here is editable. `null` view: still being read (nothing shown).
 */
export function HistoryGlance({ view }: { view: HistoryGlanceView | null }) {
  const theme = useTheme();
  const [selected, setSelected] = useState<string | null>(null);
  if (view === null) return null;
  return (
    <View style={{ gap: theme.space['2'] }}>
      <Eyebrow>History</Eyebrow>
      {view.empty !== null ? (
        <AppText variant="callout" color="text.secondary">
          {view.empty}
        </AppText>
      ) : (
        <>
          {view.chart !== null && view.chart.points.length > 1 ? <ExerciseLineChart chart={view.chart} selected={selected} onSelect={setSelected} height={GLANCE_CHART_HEIGHT} /> : null}
          <Table>
            {view.rows.map((r, i) => (
              <View key={r.sessionId}>
                {i > 0 ? <Divider /> : null}
                <View accessible accessibilityLabel={r.accessibilityLabel} style={{ minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: theme.space['3'], paddingHorizontal: theme.space['4'] }}>
                  <AppText variant="callout" color="text.secondary" numeric style={{ minWidth: 56 }}>
                    {r.date}
                  </AppText>
                  <AppText variant="body" numeric style={{ flex: 1 }} numberOfLines={2}>
                    {r.text}
                  </AppText>
                </View>
              </View>
            ))}
          </Table>
        </>
      )}
    </View>
  );
}
