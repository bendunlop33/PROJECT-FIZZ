import { useCallback, useState } from 'react';
import { View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';

import type { TodayHealthLine } from '@fizz/domain';

import { healthTrendViews, type HealthTrendView } from '../../health/health-view';
import { useServices } from '../../shell/context';
import { useTheme } from '../../theme';
import { AppText, RuledSection, Sparkline } from '../../ui';

/**
 * (Ben, 27 Oct, Q8) Progress: resting heart rate and sleep as small trend lines, one value a day for the last 30,
 * each labelled with its source. Raw values only: no score, target or verdict (rule 6). Nothing while the switches
 * are off or Health has fewer than two days. (Ben, 27 Oct; gym first) Above them, last night's sleep and this
 * morning's resting heart rate against its 28-day median (`Sleep 6h 10m · RHR 58 ↑4`), only when there is one.
 */
export function HealthTrends() {
  const theme = useTheme();
  const services = useServices();
  const [trends, setTrends] = useState<HealthTrendView[]>([]);
  const [line, setLine] = useState<TodayHealthLine | null>(null);
  useFocusEffect(
    useCallback(() => {
      let alive = true;
      void services.health.lastNight().then(
        (r) => {
          if (!alive) return;
          setTrends(healthTrendViews(r.signals));
          setLine(r.line);
        },
        () => undefined,
      );
      return () => {
        alive = false;
      };
    }, [services]),
  );
  if (trends.length === 0 && line === null) return null;
  return (
    <RuledSection title="Apple Health">
      {line !== null ? (
        <AppText variant="callout" numeric accessibilityLabel={line.accessibilityLabel}>
          {line.text}
        </AppText>
      ) : null}
      {trends.map((t) => (
        <View key={t.key} accessible accessibilityLabel={t.accessibilityLabel} style={{ gap: theme.space['1'] }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: theme.space['2'] }}>
            <AppText variant="callout">{t.title}</AppText>
            <AppText variant="callout" numeric>
              {t.latest}
            </AppText>
          </View>
          <Sparkline points={(width) => scale(t.points, width, 32)} height={32} />
          <AppText variant="callout" color="text.secondary">
            {t.source}
          </AppText>
        </View>
      ))}
    </RuledSection>
  );
}

function scale(points: readonly { x: number; y: number }[], width: number, height: number): { x: number; y: number }[] {
  if (points.length === 0) return [];
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const [x0, x1] = [Math.min(...xs), Math.max(...xs)];
  const [y0, y1] = [Math.min(...ys), Math.max(...ys)];
  const pad = 4;
  return points.map((p) => ({
    x: x1 === x0 ? width / 2 : ((p.x - x0) / (x1 - x0)) * width,
    y: y1 === y0 ? height / 2 : pad + (1 - (p.y - y0) / (y1 - y0)) * (height - 2 * pad),
  }));
}
