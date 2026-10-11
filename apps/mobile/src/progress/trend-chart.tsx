import { useRef, useState } from 'react';
import { Pressable, View, type AccessibilityActionEvent, type GestureResponderEvent } from 'react-native';

import type { ChartPointView, MarkerView, RepTableView, TableRowView } from '@fizz/domain';

import { haptic } from '../device/haptics';
import { useTheme } from '../theme';
import { AppText, Icon, Tag, type SymbolName } from '../ui';
import { useAx } from './components';
import { loadTrendCanvas } from './load-charts';
import { markerX, nearestPointIndex, trendLayout } from './trend-layout';

/**
 * Exercise detail's chart pieces (progress.md §2.7, §7; design-system §9.23,
 * §9.24, §9.27, §9.73): `TrendChart`, its marker lane, the `ChartDataTable`
 * and the `RepTable`. They lay out the view model; the geometry is the pure
 * `trendLayout`. No animation anywhere (Reduce Motion or not: nothing moves).
 */

const AXIS_WIDTH = 44;
const INSET = 10;
const MARKER_ICON: Record<MarkerView['kind'], SymbolName> = { gap: 'ellipsis', edited: 'pencil', not_counted: 'slash.circle' };

export interface TrendChartProps {
  points: readonly ChartPointView[];
  markers: readonly MarkerView[];
  from: string;
  to: string;
  bars: boolean;
  axisUnit: string;
  axisFormat: 'number' | 'duration';
  words: string;
  selected: number | null;
  onSelect: (index: number | null) => void;
  onOpen: (sessionId: string) => void;
}

/** `TrendChart` (§9.23): one series, y labels and unit, month ticks, marker lane; the whole plot is the hit area; VoiceOver adjustable. */
export function TrendChart({ points, markers, from, to, bars, axisUnit, axisFormat, words, selected, onSelect, onOpen }: TrendChartProps) {
  const theme = useTheme();
  const ax = useAx();
  const [width, setWidth] = useState(0);
  const height = ax ? theme.chart.detailHeightAX : theme.chart.detailHeight;
  const layout = trendLayout({ points, from, to, width, height, bars, format: axisFormat, axisWidth: AXIS_WIDTH, inset: INSET });
  const canvas = loadTrendCanvas();
  const grant = useRef<{ index: number; moved: boolean; wasSelected: boolean } | null>(null);

  const pick = (e: GestureResponderEvent): number => nearestPointIndex(layout.xs, e.nativeEvent.locationX);
  const onAction = (e: AccessibilityActionEvent) => {
    const n = points.length;
    if (n === 0) return;
    if (e.nativeEvent.actionName === 'increment') onSelect(selected === null ? 0 : Math.min(n - 1, selected + 1));
    else if (e.nativeEvent.actionName === 'decrement') onSelect(selected === null ? n - 1 : Math.max(0, selected - 1));
    else if (e.nativeEvent.actionName === 'activate' && selected !== null) {
      const p = points[selected];
      if (p) onOpen(p.sessionId);
    }
  };
  const sel = selected === null ? null : (points[selected] ?? null);

  return (
    <View
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel={words}
      {...(sel ? { accessibilityValue: { text: `${sel.words} Double-tap to open the workout.` } } : {})}
      accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }, { name: 'activate' }]}
      onAccessibilityAction={onAction}
    >
      <AppText variant="label" color="chart.axisText" maxFontSizeMultiplier={1.6}>
        {axisUnit}
      </AppText>
      <View
        style={{ height }}
        onLayout={(e) => {
          setWidth(Math.floor(e.nativeEvent.layout.width));
        }}
        onStartShouldSetResponder={() => points.length > 0}
        onMoveShouldSetResponder={() => points.length > 0}
        onResponderGrant={(e) => {
          const i = pick(e);
          grant.current = { index: i, moved: false, wasSelected: i === selected };
          if (i >= 0 && i !== selected) {
            haptic('step');
            onSelect(i);
          }
        }}
        onResponderMove={(e) => {
          const i = pick(e);
          if (grant.current && i !== grant.current.index) grant.current = { ...grant.current, index: i, moved: true };
          if (i >= 0 && i !== selected) {
            haptic('step');
            onSelect(i);
          }
        }}
        onResponderRelease={() => {
          // Tapping the selected point again clears it (§4.2).
          if (grant.current?.wasSelected === true && !grant.current.moved) onSelect(null);
          grant.current = null;
        }}
      >
        {width > 0 ? (
          canvas.ok ? (
            <canvas.value
              layout={layout}
              width={width}
              height={height}
              bars={bars}
              hollow={points.map((p) => p.hollow)}
              selected={selected}
              lineWidth={theme.chart.activeLineWidth}
              pointSize={theme.chart.point}
              pointSelectedSize={theme.chart.pointSelected}
              gridWidth={theme.a11y.increaseContrast ? 2 : 1}
              colors={{
                line: theme.colors['chart.line'],
                point: theme.colors['chart.point'],
                selected: theme.colors['chart.selected'],
                grid: theme.a11y.increaseContrast ? theme.colors['border.control'] : theme.colors['chart.grid'],
                bar: theme.colors['chart.bar'],
                surface: theme.colors['bg.canvas'],
              }}
            />
          ) : (
            // Skia unavailable: the points as plain views (no line); the table has everything.
            <View style={{ width, height }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
              {layout.xs.map((x, i) => {
                const size = i === selected ? theme.chart.pointSelected : theme.chart.point;
                return <View key={points[i]?.sessionId ?? String(i)} style={{ position: 'absolute', left: x - size / 2, top: (layout.ys[i] ?? 0) - size / 2, width: size, height: size, borderRadius: size / 2, backgroundColor: theme.colors['chart.point'] }} />;
              })}
            </View>
          )
        ) : null}
        {layout.yTicks.map((t) => (
          <View key={t.label} pointerEvents="none" style={{ position: 'absolute', left: 0, width: AXIS_WIDTH - 6, top: t.y - 10 }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
            <AppText variant="label" numeric color="chart.axisText" align="right" numberOfLines={1} maxFontSizeMultiplier={1.6}>
              {t.label}
            </AppText>
          </View>
        ))}
      </View>
      <View style={{ height: 22 }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        {layout.months.map((m) => (
          <View key={`${m.label}${String(Math.round(m.x))}`} style={{ position: 'absolute', left: m.x - 24, width: 48, alignItems: 'center' }}>
            <AppText variant="label" color="chart.axisText" numberOfLines={1} maxFontSizeMultiplier={1.4}>
              {m.label}
            </AppText>
          </View>
        ))}
      </View>
      <MarkerLane markers={markers} from={from} to={to} plotX={layout.plot.x} plotWidth={layout.plot.width} />
    </View>
  );
}

/** The marker lane (§9.24): icon + word under the axis; when markers crowd, icons only (the words are in the panel and the table). */
function MarkerLane({ markers, from, to, plotX, plotWidth }: { markers: readonly MarkerView[]; from: string; to: string; plotX: number; plotWidth: number }) {
  const theme = useTheme();
  if (markers.length === 0 || plotWidth <= 1) return null;
  const xs = markers.map((m) => markerX(m, from, to, { x: plotX, width: plotWidth }));
  const sorted = [...xs].sort((a, b) => a - b);
  const crowded = sorted.some((x, i) => i > 0 && x - (sorted[i - 1] ?? 0) < 96);
  return (
    <View style={{ height: theme.chart.markerLane }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {markers.map((m, i) => {
        const x = xs[i] ?? 0;
        const w = crowded ? 20 : 110;
        return (
          <View key={m.key} style={{ position: 'absolute', left: Math.max(0, Math.min(plotX + plotWidth - w, x - w / 2)), width: w, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, height: theme.chart.markerLane }}>
            <Icon name={MARKER_ICON[m.kind]} color="chart.marker" size={14} />
            {crowded ? null : (
              <AppText variant="label" color="chart.marker" numberOfLines={1} maxFontSizeMultiplier={1.4}>
                {m.label}
              </AppText>
            )}
          </View>
        );
      })}
    </View>
  );
}

/** `ChartDataTable` (§9.27): the same values as the chart, every session, each row a button to the workout. Stacks at AX sizes. */
export function ChartTable({ headers, rows, onOpen }: { headers: readonly [string, string, string]; rows: readonly TableRowView[]; onOpen: (sessionId: string) => void }) {
  const theme = useTheme();
  const ax = useAx();
  return (
    <View>
      {ax ? null : (
        <View style={{ flexDirection: 'row', gap: theme.space['3'], paddingBottom: theme.space['1'] }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          <AppText variant="sectionLabel" color="text.tertiary" style={{ width: 76 }}>
            {headers[0].toUpperCase()}
          </AppText>
          <AppText variant="sectionLabel" color="text.tertiary" style={{ flex: 1 }}>
            {headers[1].toUpperCase()}
          </AppText>
          <AppText variant="sectionLabel" color="text.tertiary" style={{ flex: 1 }}>
            {headers[2].toUpperCase()}
          </AppText>
        </View>
      )}
      {rows.map((r) => (
        <Pressable
          key={r.key}
          accessibilityRole="button"
          accessibilityLabel={r.words}
          onPress={() => {
            onOpen(r.sessionId);
          }}
          style={({ pressed }) => ({ minHeight: theme.target.min.height, paddingVertical: theme.space['2'], flexDirection: ax ? 'column' : 'row', gap: ax ? 2 : theme.space['3'], alignItems: ax ? 'flex-start' : 'center', borderTopWidth: theme.dividerWidth, borderTopColor: theme.colors['border.divider'], backgroundColor: pressed ? theme.colors['bg.raised'] : 'transparent' })}
        >
          <AppText variant="body" numeric style={ax ? undefined : { width: 76 }}>
            {r.date}
          </AppText>
          <AppText variant="body" numeric style={ax ? undefined : { flex: 1 }}>
            {r.value}
          </AppText>
          <AppText variant="callout" color="text.secondary" style={ax ? undefined : { flex: 1 }}>
            {r.notes}
          </AppText>
        </Pressable>
      ))}
    </View>
  );
}

/** `RepTable` (§9.73): plain rows, each a button to the workout; `from 6 reps` notes; FitNotes tags; `Show all (n)`. */
export function RepTable({ table, showAll, onShowAll, onOpen }: { table: RepTableView; showAll: boolean; onShowAll: () => void; onOpen: (sessionId: string) => void }) {
  const theme = useTheme();
  const ax = useAx();
  const rows = showAll ? table.rows : table.rows.slice(0, table.initial);
  return (
    <View>
      {ax ? null : (
        <View style={{ flexDirection: 'row', gap: theme.space['3'], paddingBottom: theme.space['1'] }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          {table.headers.map((h, i) => (
            <AppText key={h} variant="sectionLabel" color="text.tertiary" style={{ flex: i === 1 ? 2 : 1, textAlign: i === 2 ? 'right' : 'left' }}>
              {h.toUpperCase()}
            </AppText>
          ))}
        </View>
      )}
      {rows.map((r) => {
        const id = r.sessionId;
        const content = (
          <>
            <AppText variant="body" numeric style={ax ? undefined : { flex: 1 }}>
              {r.cells[0]}
            </AppText>
            <View style={ax ? { flexDirection: 'row', flexWrap: 'wrap', gap: theme.space['2'] } : { flex: 2, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: theme.space['2'] }}>
              <AppText variant="body" numeric>
                {r.cells[1]}
              </AppText>
              {r.note !== null ? (
                <AppText variant="callout" color="text.secondary" numeric>
                  {r.note}
                </AppText>
              ) : null}
              {r.tag !== null ? <Tag text={r.tag} /> : null}
            </View>
            <AppText variant="callout" color="text.secondary" numeric style={ax ? undefined : { flex: 1, textAlign: 'right' }}>
              {r.cells[2]}
            </AppText>
          </>
        );
        const style = { minHeight: theme.target.min.height, paddingVertical: theme.space['2'], flexDirection: ax ? ('column' as const) : ('row' as const), alignItems: ax ? ('flex-start' as const) : ('center' as const), gap: ax ? 2 : theme.space['3'], borderTopWidth: theme.dividerWidth, borderTopColor: theme.colors['border.divider'] };
        return id === null ? (
          <View key={r.key} accessible accessibilityLabel={r.words} style={style}>
            {content}
          </View>
        ) : (
          <Pressable
            key={r.key}
            accessibilityRole="button"
            accessibilityLabel={r.words}
            accessibilityHint="Opens the workout"
            onPress={() => {
              onOpen(id);
            }}
            style={({ pressed }) => ({ ...style, backgroundColor: pressed ? theme.colors['bg.raised'] : 'transparent' })}
          >
            {content}
          </Pressable>
        );
      })}
      {!showAll && table.rows.length > table.initial ? (
        <Pressable accessibilityRole="button" onPress={onShowAll} style={{ minHeight: theme.target.min.height, justifyContent: 'center' }}>
          <AppText variant="body" color="accent">{`Show all (${String(table.rows.length)})`}</AppText>
        </Pressable>
      ) : null}
    </View>
  );
}
