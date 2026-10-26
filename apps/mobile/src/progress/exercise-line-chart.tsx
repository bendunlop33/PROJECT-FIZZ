import { useState } from 'react';
import { Pressable, View } from 'react-native';

import type { ExerciseTabView } from '@fizz/domain';

import { haptic } from '../device/haptics';
import { useTheme } from '../theme';
import { AppText } from '../ui';
import { useAxisWidth } from './axis-measure';
import { TICK_MAX_SCALE } from './axis-width';
import { XLabels } from './components';
import { loadTrendCanvas } from './load-charts';
import { nearestPointIndex, trendLayout } from './trend-layout';

/**
 * The Exercises tab chart (Ben, 13–14 Oct 2026): always a line (even with 1–2
 * points), a labelled Y axis with gridlines, the trailing average as a thin
 * dashed line, and tap a point for its date and value (estimates say so).
 * Geometry from the pure `trendLayout`; the canvas only draws it.
 */

const INSET = 10;
const HEIGHT = 260;

/** `readout`: the selected session's line from the table, shown when it has no point for the measure (`8 Oct · Est. 1RM —`). */
/** `height`: the plot's height (the exercise pop-up's small `History` chart uses less; Ben, 26 Oct). */
export function ExerciseLineChart({ chart, selected, readout = null, onSelect, height = HEIGHT }: { chart: ExerciseTabView['chart']; selected: string | null; readout?: string | null; onSelect: (sessionId: string | null) => void; height?: number }) {
  const theme = useTheme();
  const [width, setWidth] = useState(0);
  // One run, no gap breaks: Ben asked for a line every time.
  const points = chart.points.map((p) => ({ date: p.date, value: p.value, breakBefore: false }));
  const base = { points, from: chart.from, to: chart.to, width, height, bars: false, format: chart.format, inset: INSET, overlay: chart.points.map((p) => p.average) };
  // Design pass 6.3: the axis is as wide as its widest label (the ticks don't depend on the width).
  const axis = useAxisWidth(trendLayout({ ...base, axisWidth: 44 }).yTicks.map((t) => t.label));
  const layout = trendLayout({ ...base, axisWidth: axis.width });
  const canvas = loadTrendCanvas();
  const index = selected === null ? -1 : chart.points.findIndex((p) => p.sessionId === selected);
  const point = index >= 0 ? chart.points[index] : undefined;
  const shown = point?.readout ?? (selected === null ? null : readout);
  const grid = theme.a11y.increaseContrast ? theme.colors['border.control'] : theme.colors['chart.grid'];
  return (
    <View accessible accessibilityLabel={chart.words} {...(point ? { accessibilityValue: { text: point.words } } : {})}>
      <View style={{ minHeight: 22, flexDirection: 'row', justifyContent: 'space-between', gap: theme.space['2'] }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <AppText variant="label" color="chart.axisText" maxFontSizeMultiplier={1.6}>
          {chart.unit}
        </AppText>
        {shown !== null ? (
          <AppText variant="label" numeric color="text.primary" numberOfLines={1} style={{ flexShrink: 1 }}>
            {shown}
          </AppText>
        ) : null}
      </View>
      <View
        style={{ height }}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        onLayout={(e) => {
          setWidth(Math.floor(e.nativeEvent.layout.width));
        }}
>
        {width > 0 ? (
          canvas.ok ? (
            <canvas.value
              layout={layout}
              width={width}
              height={height}
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
        {layout.yTicks.map((t, i) => (
          <View key={`${String(i)}-${t.label}`} pointerEvents="none" style={{ position: 'absolute', left: 0, width: axis.width - 6, top: t.y - 10 }}>
            <AppText variant="label" numeric color="chart.axisText" align="right" maxFontSizeMultiplier={TICK_MAX_SCALE}>
              {t.label}
            </AppText>
          </View>
        ))}
        {axis.measure}
        {/* Design pass 6.3: tap only. A scroll that starts on the chart scrolls; it never selects or buzzes. */}
        {chart.points.length > 0 ? (
          <Pressable
            accessible={false}
            style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0 }}
            onPress={(e) => {
              const i = nearestPointIndex(layout.xs, e.nativeEvent.locationX);
              const p = chart.points[i];
              if (!p) return;
              haptic('step');
              onSelect(p.sessionId === selected ? null : p.sessionId);
            }}
          />
        ) : null}
      </View>
      <XLabels labels={layout.months.map((m) => ({ key: `${m.label}${String(Math.round(m.x))}`, x: m.x, text: m.label }))} width={width} />
    </View>
  );
}
