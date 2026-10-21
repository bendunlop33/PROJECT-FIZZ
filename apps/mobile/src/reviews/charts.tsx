import { useState } from 'react';
import { Pressable, View, type DimensionValue } from 'react-native';

import { REVIEW_COPY, sparkPoints, type LiftChartView, type ReviewConsistencyView, type SetsBarsView } from '@fizz/domain';

import { useAxisWidth } from '../progress/axis-measure';
import { TICK_MAX_SCALE } from '../progress/axis-width';
import { useAx, XLabels } from '../progress/components';
import { loadTrendCanvas } from '../progress/load-charts';
import { trendLayout } from '../progress/trend-layout';
import { useTheme } from '../theme';
import { AppText, Sparkline, TextButton } from '../ui';

/**
 * Progress › Reviews charts (workout-builder-v3 §6.2; the approved `progress-reviews.html` look, minus its
 * fakes). Each lays out a pure view model and computes nothing. Accessible: every chart carries a
 * VoiceOver summary and a `Table` view with the same values; states are a mark and a word, never colour
 * alone; text scales with Dynamic Type. No projection line anywhere: a lift target is a level line.
 */

/** A fraction (0–1) of the bar's width as a style length. */
const pct = (f: number): DimensionValue => `${String(Math.round(f * 1000) / 10)}%` as DimensionValue;

function TableToggle({ table, onToggle, what }: { table: boolean; onToggle: () => void; what: string }) {
  return <TextButton label={table ? REVIEW_COPY.chart : REVIEW_COPY.table} tone="secondary" onPress={onToggle} accessibilityLabel={`${table ? 'Show chart' : 'Show table'}: ${what}`} />;
}

function Header({ title, right }: { title: string; right?: React.ReactNode }) {
  const theme = useTheme();
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', columnGap: theme.space['2'] }}>
      <AppText variant="sectionLabel" color="text.tertiary" accessibilityRole="header">
        {title}
      </AppText>
      {right}
    </View>
  );
}

function TableRows({ rows }: { rows: readonly { key: string; cells: readonly string[] }[] }) {
  const theme = useTheme();
  return (
    <View>
      {rows.map((r) => (
        <View key={r.key} accessible accessibilityLabel={r.cells.join(', ')} style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.space['3'], minHeight: 44, alignItems: 'center', borderTopWidth: theme.dividerWidth, borderColor: theme.colors['border.divider'] }}>
          {r.cells.map((c, i) => (
            <AppText key={`${r.key}-${String(i)}`} variant="callout" numeric color={i === 0 ? 'text.secondary' : 'text.primary'} style={i === 0 ? { flexGrow: 1 } : null}>
              {c}
            </AppText>
          ))}
        </View>
      ))}
    </View>
  );
}

/** This week's day dots (a letter each; done filled, to do dashed, runs outlined `R`) and 6 weeks of planned vs done. */
export function ConsistencyBlock({ view }: { view: ReviewConsistencyView }) {
  const theme = useTheme();
  const [table, setTable] = useState(false);
  const dot = 28;
  const barH = 72;
  return (
    <View style={{ gap: theme.space['3'] }}>
      <Header title={view.title} right={<TableToggle table={table} onToggle={() => { setTable((t) => !t); }} what={view.title} />} />
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: theme.space['2'] }}>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.space['2'] }}>
          {view.dots.map((d) => (
            <View
              key={d.key}
              accessible
              accessibilityLabel={d.accessibilityLabel}
              style={{
                width: dot,
                height: dot,
                borderRadius: dot / 2,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: d.kind === 'done' ? theme.colors['text.primary'] : 'transparent',
                borderWidth: d.kind === 'done' ? 0 : 1.5,
                borderStyle: d.kind === 'todo' ? 'dashed' : 'solid',
                borderColor: d.kind === 'run' ? theme.colors['text.secondary'] : theme.colors['text.tertiary'],
              }}
            >
              <AppText variant="label" color={d.kind === 'done' ? 'bg.canvas' : 'text.secondary'} maxFontSizeMultiplier={1.2}>
                {d.label}
              </AppText>
            </View>
          ))}
        </View>
        <AppText variant="callout" numeric>
          {view.summary}
        </AppText>
      </View>
      {view.missed !== null ? (
        <AppText variant="callout" color="text.secondary">
          {view.missed}
        </AppText>
      ) : null}
      {table ? (
        <TableRows rows={view.table.map((r) => ({ key: r.key, cells: [r.week, r.sessions, `${r.runs} runs`] }))} />
      ) : (
        <View accessible accessibilityLabel={view.words} style={{ flexDirection: 'row', alignItems: 'flex-end', gap: theme.space['2'] }}>
          {view.bars.map((b) => {
            const planned = b.planned === null ? 0 : (b.planned / view.scaleMax) * barH;
            const done = (b.done / view.scaleMax) * barH;
            return (
              <View key={b.key} style={{ flex: 1, minWidth: 0, alignItems: 'center', gap: 2 }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
                <AppText variant="label" numeric numberOfLines={1} maxFontSizeMultiplier={1.3}>
                  {b.value}
                </AppText>
                <View style={{ height: barH, width: '70%', justifyContent: 'flex-end' }}>
                  {/* Planned: an outline to the plan's height; done: the fill. Numbers above say both. */}
                  {b.planned !== null ? <View style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: Math.max(2, planned), borderWidth: 1, borderColor: theme.colors['border.control'], borderRadius: 4 }} /> : null}
                  <View style={{ height: Math.max(b.done > 0 ? 3 : 0, done), backgroundColor: theme.colors['text.primary'], borderRadius: 4 }} />
                </View>
                <AppText variant="label" color="text.tertiary" numeric numberOfLines={1} maxFontSizeMultiplier={1.3}>
                  {b.label}
                </AppText>
                {/* Runs on their own line, so a large text size never cuts them off (review b3-wave3-ux S4). */}
                {b.runs > 0 ? (
                  <AppText variant="label" color="text.tertiary" numeric numberOfLines={1} maxFontSizeMultiplier={1.3}>
                    {`R${String(b.runs)}`}
                  </AppText>
                ) : null}
              </View>
            );
          })}
        </View>
      )}
    </View>
  );
}

/** Sets per muscle: done (fill), the goal range (band) and the plan (tick); `✓`/`▼`/`▲` with the number. */
export function SetsBars({ view }: { view: SetsBarsView }) {
  const theme = useTheme();
  const [table, setTable] = useState(false);
  // Large text: the name above its bar, never cut off (review b3-wave3-ux S4).
  const stacked = useAx();
  if (view.empty !== null) {
    return (
      <View style={{ gap: theme.space['2'] }}>
        <Header title={view.title} />
        <AppText variant="callout" color="text.secondary">
          {view.empty}
        </AppText>
      </View>
    );
  }
  return (
    <View style={{ gap: theme.space['2'] }}>
      <Header title={view.title} right={<TableToggle table={table} onToggle={() => { setTable((t) => !t); }} what={view.title} />} />
      {table ? (
        <TableRows rows={view.rows.map((r) => ({ key: r.key, cells: [r.label, `${String(r.sets)} sets`, r.planned === null ? '' : `plan ${String(r.planned)}`, r.range === null ? '' : `range ${String(r.range.min)}–${String(r.range.max)}`, r.statusWord ?? ''].filter((c) => c !== '') }))} />
      ) : (
        <View accessible accessibilityLabel={`${view.title}: ${view.words}`}>
          {view.rows.map((r) => (
            <View key={r.key} accessible accessibilityLabel={r.accessibilityLabel} style={{ flexDirection: 'row', flexWrap: stacked ? 'wrap' : 'nowrap', alignItems: 'center', columnGap: theme.space['2'], rowGap: 2, minHeight: 32 }}>
              <AppText variant="callout" style={stacked ? { width: '100%' } : { minWidth: 96, flexShrink: 0 }}>
                {r.label}
              </AppText>
              <View style={{ flex: 1, minWidth: 80, height: 12, borderRadius: 6, backgroundColor: theme.colors['bg.raised'] }}>
                {r.band !== null ? <View style={{ position: 'absolute', top: 0, bottom: 0, left: pct(r.band.from), width: pct(r.band.to - r.band.from), backgroundColor: theme.colors['chart.bandFill'], borderWidth: 1, borderColor: theme.colors['chart.bandEdge'], borderRadius: 3 }} /> : null}
                <View style={{ position: 'absolute', top: 3, bottom: 3, left: 0, width: pct(r.fill), backgroundColor: theme.colors['text.primary'], borderRadius: 3 }} />
                {r.plannedAt !== null ? <View style={{ position: 'absolute', top: -2, bottom: -2, left: pct(r.plannedAt), width: 2, backgroundColor: theme.colors['text.secondary'] }} /> : null}
              </View>
              <AppText variant="callout" numeric style={{ minWidth: 48, textAlign: 'right' }}>
                {r.mark === null ? String(r.sets) : `${String(r.sets)} ${r.mark}`}
              </AppText>
            </View>
          ))}
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.space['3'] }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
            <AppText variant="label" color="text.tertiary">
              {`■ ${view.legend.done}`}
            </AppText>
            {view.legend.range !== null ? (
              <AppText variant="label" color="text.tertiary">
                {`▭ ${view.legend.range}`}
              </AppText>
            ) : null}
            {view.legend.plan !== null ? (
              <AppText variant="label" color="text.tertiary">
                {`| ${view.legend.plan}`}
              </AppText>
            ) : null}
          </View>
        </View>
      )}
    </View>
  );
}

const LIFT_HEIGHT = 150;
const INSET = 10;

function liftTableRows(chart: LiftChartView) {
  return chart.table.map((r) => ({ key: r.key, cells: [r.date, r.value, r.set] }));
}

/** A lift as a small tile (the prototype's lift tiles): name, now, was → now → target, a sparkline; tap for the full chart. */
export function LiftTile({ chart, onOpen }: { chart: LiftChartView; onOpen: () => void }) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={[chart.title, chart.empty ?? chart.header, chart.progress].filter((x): x is string => x !== null).join('. ').replaceAll('\u00a0', ' ')}
      accessibilityHint="Shows the chart"
      onPress={onOpen}
      style={({ pressed }) => ({ flexGrow: 1, flexBasis: 150, minHeight: 44, gap: 2, padding: theme.space['3'], borderRadius: theme.radius.md, backgroundColor: pressed ? theme.colors['bg.raised'] : 'transparent', borderWidth: theme.dividerWidth, borderColor: theme.colors['border.divider'] })}
    >
      <AppText variant="callout">{chart.title}</AppText>
      <AppText variant="label" color="text.secondary" numeric>
        {chart.empty ?? chart.header}
      </AppText>
      {chart.progress !== null ? (
        <AppText variant="label" numeric>
          {chart.progress}
        </AppText>
      ) : null}
      {chart.points.length >= 2 ? <HistorySpark values={chart.points.map((p) => p.value)} /> : null}
    </Pressable>
  );
}

/** One lift's trend: est. 1RM (labelled), best set or reps; the target as a dotted level line. No projection. */
export function LiftTrend({ chart, onCollapse }: { chart: LiftChartView; onCollapse?: () => void }) {
  const theme = useTheme();
  const [width, setWidth] = useState(0);
  const [table, setTable] = useState(false);
  const base = { points: chart.points, from: chart.from, to: chart.to, width, height: LIFT_HEIGHT, bars: false, format: 'number' as const, inset: INSET, target: chart.target };
  const axis = useAxisWidth(trendLayout({ ...base, axisWidth: 44 }).yTicks.map((t) => t.label));
  const layout = trendLayout({ ...base, axisWidth: axis.width });
  const canvas = loadTrendCanvas();
  const grid = theme.a11y.increaseContrast ? theme.colors['border.control'] : theme.colors['chart.grid'];
  return (
    <View style={{ gap: theme.space['2'] }}>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'baseline', justifyContent: 'space-between', columnGap: theme.space['2'] }}>
        <AppText variant="headline" accessibilityRole="header" style={{ flexShrink: 1 }}>
          {chart.title}
        </AppText>
        <View style={{ flexDirection: 'row', gap: theme.space['2'] }}>
          {chart.empty === null ? <TableToggle table={table} onToggle={() => { setTable((t) => !t); }} what={chart.title} /> : null}
          {onCollapse !== undefined ? <TextButton label="Less" tone="secondary" onPress={onCollapse} accessibilityLabel={`Hide the chart: ${chart.title}`} /> : null}
        </View>
      </View>
      <AppText variant="label" color="text.secondary" numeric>
        {chart.empty ?? chart.header}
      </AppText>
      {chart.progress !== null ? (
        <AppText variant="callout" numeric>
          {chart.progress}
        </AppText>
      ) : null}
      {chart.empty !== null ? null : table || !canvas.ok ? (
        // No chart engine (Skia didn't load): the table, never a blank box (review b3-wave3-ux S5).
        <TableRows rows={liftTableRows(chart)} />
      ) : chart.sparse ? null : (
        <View accessible accessibilityLabel={chart.words}>
          <View
            style={{ height: LIFT_HEIGHT }}
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            onLayout={(e) => {
              setWidth(Math.floor(e.nativeEvent.layout.width));
            }}
          >
            {width > 0 ? (
              <canvas.value
                layout={layout}
                width={width}
                height={LIFT_HEIGHT}
                bars={false}
                hollow={[]}
                selected={chart.points.length - 1}
                lineWidth={theme.chart.activeLineWidth}
                pointSize={theme.chart.point}
                pointSelectedSize={theme.chart.pointSelected}
                gridWidth={theme.a11y.increaseContrast ? 2 : 1}
                targetColor={theme.colors['text.secondary']}
                colors={{ line: theme.colors['chart.line'], point: theme.colors['chart.point'], selected: theme.colors['chart.selected'], grid, bar: theme.colors['chart.bar'], surface: theme.colors['bg.canvas'] }}
              />
            ) : null}
            {layout.yTicks.map((t, i) => (
              <View key={`${String(i)}-${t.label}`} pointerEvents="none" style={{ position: 'absolute', left: 0, width: axis.width - 6, top: t.y - 10 }}>
                <AppText variant="label" numeric color="chart.axisText" align="right" maxFontSizeMultiplier={TICK_MAX_SCALE}>
                  {t.label}
                </AppText>
              </View>
            ))}
            {axis.measure}
          </View>
          <XLabels labels={layout.months.map((m) => ({ key: `${m.label}${String(Math.round(m.x))}`, x: m.x, text: m.label }))} width={width} />
        </View>
      )}
    </View>
  );
}

/** A history row's sparkline (decorative: the row's words carry it). */
export function HistorySpark({ values }: { values: readonly number[] }) {
  if (values.length < 2) return <View style={{ width: 64 }} />;
  return (
    <View style={{ width: 64 }}>
      <Sparkline height={22} points={(w) => sparkPoints(values, w, 22)} />
    </View>
  );
}
