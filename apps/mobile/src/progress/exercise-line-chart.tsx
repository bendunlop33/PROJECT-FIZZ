import { useState } from 'react';
import { View } from 'react-native';

import type { ExerciseTabView } from '@fizz/domain';

import { haptic } from '../device/haptics';
import { useTheme } from '../theme';
import { AppText } from '../ui';
import { XLabels } from './components';
import { loadTrendCanvas } from './load-charts';
import { nearestPointIndex, trendLayout } from './trend-layout';

/**
 * The Exercises tab chart (Ben, 13–14 Oct 2026): always a line (even with 1–2
 * points), a labelled Y axis with gridlines, the trailing average as a thin
 * dashed line, and tap a point for its date and value (estimates say so).
 * Geometry from the pure `trendLayout`; the canvas only draws it.
 */

const AXIS_WIDTH = 44;
const INSET = 10;
const HEIGHT = 260;

export function ExerciseLineChart({ chart, selected, onSelect }: { chart: ExerciseTabView['chart']; selected: string | null; onSelect: (sessionId: string | null) => void }) {
  const theme = useTheme();
  const [width, setWidth] = useState(0);
  // One run, no gap breaks: Ben asked for a line every time.
  const points = chart.points.map((p) => ({ date: p.date, value: p.value, breakBefore: false }));
  const layout = trendLayout({ points, from: chart.from, to: chart.to, width, height: HEIGHT, bars: false, format: chart.format, axisWidth: AXIS_WIDTH, inset: INSET, overlay: chart.points.map((p) => p.average) });
  const canvas = loadTrendCanvas();
  const index = selected === null ? -1 : chart.points.findIndex((p) => p.sessionId === selected);
  const point = index >= 0 ? chart.points[index] : undefined;
  const grid = theme.a11y.increaseContrast ? theme.colors['border.control'] : theme.colors['chart.grid'];
  return (
    <View accessible accessibilityLabel={chart.words} {...(point ? { accessibilityValue: { text: point.words } } : {})}>
      <View style={{ minHeight: 22, flexDirection: 'row', justifyContent: 'space-between', gap: theme.space['2'] }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <AppText variant="label" color="chart.axisText" maxFontSizeMultiplier={1.6}>
          {chart.unit}
        </AppText>
        {point ? (
          <AppText variant="label" numeric color="text.primary" numberOfLines={1} style={{ flexShrink: 1 }}>
            {point.readout}
          </AppText>
        ) : null}
      </View>
      <View
        style={{ height: HEIGHT }}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        onLayout={(e) => {
          setWidth(Math.floor(e.nativeEvent.layout.width));
        }}
        onStartShouldSetResponder={() => chart.points.length > 0}
        onResponderGrant={(e) => {
          const i = nearestPointIndex(layout.xs, e.nativeEvent.locationX);
          const p = chart.points[i];
          if (!p) return;
          haptic('step');
          onSelect(p.sessionId === selected ? null : p.sessionId);
        }}
      >
        {width > 0 ? (
          canvas.ok ? (
            <canvas.value
              layout={layout}
              width={width}
              height={HEIGHT}
              bars={false}
              hollow={[]}
              selected={index >= 0 ? index : null}
              lineWidth={theme.chart.activeLineWidth}
              pointSize={theme.chart.point}
              pointSelectedSize={theme.chart.pointSelected}
              gridWidth={theme.a11y.increaseContrast ? 2 : 1}
              overlay={{ color: theme.colors['chart.bar'], width: 1.5 }}
              colors={{ line: theme.colors['chart.line'], point: theme.colors['chart.point'], selected: theme.colors['chart.selected'], grid, bar: theme.colors['chart.bar'], surface: theme.colors['bg.canvas'] }}
            />
          ) : (
            // Skia unavailable: the points as plain views; the sessions table has every value.
            layout.xs.map((x, i) => {
              const size = i === index ? theme.chart.pointSelected : theme.chart.point;
              return <View key={chart.points[i]?.sessionId ?? String(i)} style={{ position: 'absolute', left: x - size / 2, top: (layout.ys[i] ?? 0) - size / 2, width: size, height: size, borderRadius: size / 2, backgroundColor: theme.colors['chart.point'] }} />;
            })
          )
        ) : null}
        {layout.yTicks.map((t) => (
          <View key={t.label} pointerEvents="none" style={{ position: 'absolute', left: 0, width: AXIS_WIDTH - 6, top: t.y - 10 }}>
            <AppText variant="label" numeric color="chart.axisText" align="right" numberOfLines={1} maxFontSizeMultiplier={1.6}>
              {t.label}
            </AppText>
          </View>
        ))}
      </View>
      <XLabels labels={layout.months.map((m) => ({ key: `${m.label}${String(Math.round(m.x))}`, x: m.x, text: m.label }))} width={width} />
    </View>
  );
}
