import { useEffect, useState } from 'react';
import { Pressable, ScrollView, useWindowDimensions, View } from 'react-native';

import {
  customRangeFromMonths,
  defaultCustomMonths,
  monthKeyOf,
  monthShortTitle,
  pickerMonths,
  PROGRESS_PERIODS,
  resumeBarText,
  type ActivityChartView,
  type DateRange,
  type FrequencyRowView,
  type ResumeBar as ResumeBarData,
} from '@fizz/domain';
import type { ProgressPeriodKey } from '@fizz/schemas';

import { haptic } from '../device/haptics';
import { useTheme } from '../theme';
import { AppText, Icon, PrimaryButton } from '../ui';
import { AX_FONT_SCALE } from '../workout/overview';
import { ACTIVITY_LINE_DIMS, activityLineLayout, barLabelBox, barLabelRoom, countBarWidth, visibleLabels } from './chart-layout';
import { FREQUENCY_COLUMNS, FREQUENCY_HEADERS } from './frequency-columns';
import { loadTrendCanvas } from './load-charts';
import { nearestPointIndex } from './trend-layout';

/**
 * Progress components (design-system §9.69–9.72): `Segmented`,
 * `PeriodPicker`, `ActivityChart`, `FrequencyRow` and the
 * `ResumeBar`. They show the view model they are given and compute nothing.
 * No animation anywhere; AX sizes switch to lists.
 */

export function useAx(): boolean {
  return useWindowDimensions().fontScale >= AX_FONT_SCALE;
}

/** A full-width segmented control, 44pt (selected: `accent.subtle` with `text.primary`; never colour alone, the label is Semibold). `selected: null`: none (a custom period). */
export function Segmented<K extends string | number>({ options, selected, onSelect, label }: { options: readonly { key: K; label: string }[]; selected: K | null; onSelect: (k: K) => void; label: string }) {
  const theme = useTheme();
  return (
    <View accessibilityRole="tablist" accessibilityLabel={label} style={{ flexDirection: 'row', backgroundColor: theme.colors['bg.raised'], borderRadius: theme.radius.sm, padding: 2, gap: 2 }}>
      {options.map((o, i) => {
        const on = o.key === selected;
        return (
          <Pressable
            key={String(o.key)}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            accessibilityLabel={`${label}, ${o.label}, ${String(i + 1)} of ${String(options.length)}`}
            onPress={() => {
              if (on) return;
              haptic('step');
              onSelect(o.key);
            }}
            style={{
              flex: 1,
              minHeight: theme.target.min.height,
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: theme.radius.sm - 2,
              backgroundColor: on ? theme.colors['accent.subtle'] : 'transparent',
            }}
          >
            <AppText variant="label" numeric color={on ? 'text.primary' : 'text.secondary'} style={{ fontWeight: on ? '600' : '400' }} numberOfLines={1}>
              {o.label}
            </AppText>
          </Pressable>
        );
      })}
    </View>
  );
}

/**
 * `PeriodPicker` (Ben, 13 Oct 2026): one dropdown button listing `1 month`,
 * `3 months`, `6 months`, `1 year` and `Custom`. Custom drops down a Start
 * and an End month list, scrolled to pick; `Show` applies it. Under the
 * button, the window's dates.
 */
export function PeriodPicker({
  period,
  custom,
  today,
  earliest,
  current,
  datesLine,
  datesWords,
  onPreset,
  onCustom,
}: {
  period: ProgressPeriodKey;
  /** A custom period is showing. */
  custom: boolean;
  today: string;
  /** The first workout's date: the month lists start there. */
  earliest: string;
  /** The dates showing now. */
  current: DateRange;
  datesLine: string;
  datesWords: string;
  onPreset: (k: ProgressPeriodKey) => void;
  onCustom: (range: DateRange) => void;
}) {
  const theme = useTheme();
  const [open, setOpen] = useState(false);
  const [customOpen, setCustomOpen] = useState(false);
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const label = custom ? 'Custom' : (PROGRESS_PERIODS.find((p) => p.key === period)?.label ?? '1 month');
  const months = pickerMonths(earliest, today);
  const openCustom = () => {
    const d = custom ? { start: monthKeyOf(current.from), end: monthKeyOf(current.to) } : defaultCustomMonths(today);
    setStart(d.start);
    setEnd(d.end);
    setCustomOpen(true);
  };
  const row = (key: string, text: string, on: boolean, onPress: () => void) => (
    <Pressable
      key={key}
      accessibilityRole="button"
      accessibilityState={{ selected: on }}
      onPress={onPress}
      style={({ pressed }) => ({ minHeight: theme.target.min.height, flexDirection: 'row', alignItems: 'center', gap: theme.space['2'], paddingHorizontal: theme.space['3'], backgroundColor: pressed ? theme.colors['bg.raised'] : 'transparent' })}
    >
      <AppText variant="body" style={{ flex: 1 }}>
        {text}
      </AppText>
      {on ? <Icon name="checkmark" color="text.primary" /> : null}
    </Pressable>
  );
  return (
    <View style={{ gap: theme.space['1'] }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Period, ${label}. ${datesWords}`}
        accessibilityState={{ expanded: open }}
        onPress={() => {
          setOpen((o) => !o);
          setCustomOpen(false);
        }}
        style={({ pressed }) => ({ minHeight: theme.target.min.height, alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: theme.space['2'], paddingHorizontal: theme.space['3'], borderRadius: theme.radius.sm, backgroundColor: pressed ? theme.colors['accent.subtle'] : theme.colors['bg.raised'] })}
      >
        <AppText variant="headline">{label}</AppText>
        <Icon name={open ? 'chevron.up' : 'chevron.down'} color="text.secondary" size={14} />
      </Pressable>
      {open ? (
        <View style={{ borderRadius: theme.radius.md, backgroundColor: theme.colors['bg.surface'], borderWidth: theme.dividerWidth, borderColor: theme.colors['border.divider'], overflow: 'hidden' }}>
          {PROGRESS_PERIODS.map((p) =>
            row(p.key, p.label, !custom && p.key === period, () => {
              setOpen(false);
              if (custom || p.key !== period) {
                haptic('step');
                onPreset(p.key);
              }
            }),
          )}
          {row('custom', 'Custom', custom, () => {
            if (customOpen) setCustomOpen(false);
            else openCustom();
          })}
          {customOpen ? (
            <View style={{ gap: theme.space['3'], padding: theme.space['3'] }}>
              <View style={{ flexDirection: 'row', gap: theme.space['3'] }}>
                <MonthList label="Start" months={months} selected={start} onSelect={setStart} />
                <MonthList label="End" months={months} selected={end} onSelect={setEnd} />
              </View>
              <PrimaryButton
                label="Show"
                onPress={() => {
                  const r = customRangeFromMonths(start, end, today);
                  if (r === null) return;
                  setOpen(false);
                  setCustomOpen(false);
                  haptic('step');
                  onCustom(r);
                }}
              />
            </View>
          ) : null}
        </View>
      ) : null}
      <AppText variant="callout" color="text.secondary" numeric accessibilityLabel={datesWords}>
        {datesLine}
      </AppText>
    </View>
  );
}

const MONTH_ROW = 40;
const MONTH_ROWS_SHOWN = 5;

/** A scrolling list of months (`Apr 2025`), opened on the selected one. */
function MonthList({ label, months, selected, onSelect }: { label: string; months: readonly string[]; selected: string; onSelect: (m: string) => void }) {
  const theme = useTheme();
  const index = Math.max(0, months.indexOf(selected));
  return (
    <View style={{ flex: 1, gap: theme.space['1'] }}>
      <AppText variant="sectionLabel" color="text.tertiary">
        {label.toUpperCase()}
      </AppText>
      <ScrollView
        style={{ height: MONTH_ROW * MONTH_ROWS_SHOWN, borderRadius: theme.radius.sm, backgroundColor: theme.colors['bg.raised'] }}
        contentOffset={{ x: 0, y: Math.max(0, (index - Math.floor(MONTH_ROWS_SHOWN / 2)) * MONTH_ROW) }}
        nestedScrollEnabled
        accessibilityLabel={label}
      >
        {months.map((m) => {
          const on = m === selected;
          return (
            <Pressable
              key={m}
              accessibilityRole="button"
              accessibilityLabel={`${label}, ${monthShortTitle(m)}`}
              accessibilityState={{ selected: on }}
              onPress={() => {
                onSelect(m);
              }}
              style={{ height: MONTH_ROW, justifyContent: 'center', alignItems: 'center', borderRadius: theme.radius.sm - 2, backgroundColor: on ? theme.colors['accent.subtle'] : 'transparent' }}
            >
              <AppText variant="body" numeric color={on ? 'text.primary' : 'text.secondary'} style={{ fontWeight: on ? '600' : '400' }}>
                {monthShortTitle(m)}
              </AppText>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

/** Activity over time: a line chart (one point a week or month); AX sizes get the list. One VoiceOver element; the card around it is the button. */
export function ActivityChart({ chart }: { chart: ActivityChartView }) {
  const ax = useAx();
  if (ax) return <PointList chart={chart} />;
  return <ActivityLine chart={chart} />;
}

function PointList({ chart }: { chart: ActivityChartView }) {
  return (
    <View accessible accessibilityLabel={chart.words}>
      {chart.points.map((p) => (
        <AppText key={p.from} variant="callout" numeric color={p.count === 0 ? 'text.tertiary' : 'text.primary'}>
          {p.listText}
        </AppText>
      ))}
    </View>
  );
}

function ActivityLine({ chart }: { chart: ActivityChartView }) {
  const theme = useTheme();
  const [width, setWidth] = useState(0);
  // The tapped point, by its first date: a new period clears it.
  const [selectedFrom, setSelectedFrom] = useState<string | null>(null);
  const dims = ACTIVITY_LINE_DIMS;
  const layout = activityLineLayout(
    chart.points.map((p) => p.count),
    chart.yTicks,
    width,
    dims,
  );
  const selectedIndex = selectedFrom === null ? -1 : chart.points.findIndex((p) => p.from === selectedFrom);
  const selected = selectedIndex >= 0 ? (chart.points[selectedIndex] ?? null) : null;
  const room = barLabelRoom(chart.unit);
  const labels = new Set(visibleLabels(chart.points.length, layout.plot.width, room));
  const canvas = loadTrendCanvas();
  const grid = theme.a11y.increaseContrast ? theme.colors['border.control'] : theme.colors['chart.grid'];
  return (
    <View
      accessible
      accessibilityLabel={chart.words}
      onLayout={(e) => {
        setWidth(Math.floor(e.nativeEvent.layout.width));
      }}
    >
      <View style={{ height: 20 }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        {selected ? (
          <AppText variant="label" numeric color="text.primary" numberOfLines={1}>
            {selected.valueText}
          </AppText>
        ) : null}
      </View>
      <View style={{ height: dims.height }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        {width > 0 ? (
          canvas.ok ? (
            <canvas.value
              layout={layout}
              width={width}
              height={dims.height}
              bars={false}
              hollow={[]}
              selected={selectedIndex >= 0 ? selectedIndex : null}
              lineWidth={theme.chart.activeLineWidth}
              pointSize={theme.chart.point}
              pointSelectedSize={theme.chart.pointSelected}
              gridWidth={theme.dividerWidth}
              colors={{ line: theme.colors['chart.line'], point: theme.colors['chart.point'], selected: theme.colors['chart.selected'], grid, bar: theme.colors['chart.bar'], surface: theme.colors['bg.surface'] }}
            />
          ) : (
            // Skia unavailable: the points as plain views (the label and the list still carry every value).
            layout.xs.map((x, i) => {
              const size = i === selectedIndex ? theme.chart.pointSelected : theme.chart.point;
              return <View key={String(i)} style={{ position: 'absolute', left: x - size / 2, top: (layout.ys[i] ?? 0) - size / 2, width: size, height: size, borderRadius: size / 2, backgroundColor: theme.colors['chart.point'] }} />;
            })
          )
        ) : null}
        {layout.yTicks.map((t) => (
          <View key={t.label} style={{ position: 'absolute', left: 0, width: dims.axisWidth - 6, top: t.y - 9, height: 18, alignItems: 'flex-end', justifyContent: 'center' }}>
            <AppText variant="label" color="chart.axisText" numeric maxFontSizeMultiplier={1.4}>
              {t.label}
            </AppText>
          </View>
        ))}
        <Pressable
          accessible={false}
          onPress={(e) => {
            const i = nearestPointIndex(layout.xs, e.nativeEvent.locationX + layout.plot.x);
            const p = chart.points[i];
            if (!p) return;
            haptic('step');
            setSelectedFrom((cur) => (cur === p.from ? null : p.from));
          }}
          style={{ position: 'absolute', left: layout.plot.x, top: 0, width: layout.plot.width, height: dims.height }}
        />
      </View>
      <View style={{ height: 20, marginTop: theme.space['1'] }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        {chart.points.map((p, i) => {
          if (!labels.has(i)) return null;
          const box = barLabelBox(layout.xs[i] ?? 0, width, 60, room);
          return (
            <View key={p.from} style={{ position: 'absolute', left: box.left, width: 60, alignItems: box.align }}>
              <AppText variant="label" color="chart.axisText" numeric maxFontSizeMultiplier={1.4} numberOfLines={1}>
                {p.label}
              </AppText>
            </View>
          );
        })}
      </View>
    </View>
  );
}

/** Column headers over the frequency rows (`SESSIONS`, `SETS`, `PER WEEK`). */
export function FrequencyHeader({ perWeek }: { perWeek: boolean }) {
  const theme = useTheme();
  const ax = useAx();
  if (ax) return null;
  const head = (text: string, width: number) => (
    <AppText variant="sectionLabel" color="text.tertiary" numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7} style={{ width, textAlign: 'right' }}>
      {text}
    </AppText>
  );
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: theme.space['3'] }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {head(FREQUENCY_HEADERS.sessions, FREQUENCY_COLUMNS.sessions)}
      {head(FREQUENCY_HEADERS.sets, FREQUENCY_COLUMNS.sets)}
      {perWeek ? head(FREQUENCY_HEADERS.perWeek, FREQUENCY_COLUMNS.perWeek) : null}
      <View style={{ width: 14 }} />
    </View>
  );
}

/** `FrequencyRow` (§9.72): one button, numbers always printed; the bar is decoration and dropped at AX sizes. */
export function FrequencyRow({ row, onPress, expanded, perWeek, hint }: { row: FrequencyRowView; onPress: () => void; expanded?: boolean; perWeek: boolean; hint?: string }) {
  const theme = useTheme();
  const ax = useAx();
  const [track, setTrack] = useState(0);
  const numColor = row.zero ? 'text.tertiary' : 'text.primary';
  const numbers = (
    <>
      <AppText variant="body" numeric color={numColor} style={ax ? undefined : { width: FREQUENCY_COLUMNS.sessions, textAlign: 'right' }}>
        {ax ? `${String(row.sessions)} sessions` : String(row.sessions)}
      </AppText>
      <AppText variant="body" numeric color={numColor} style={ax ? undefined : { width: FREQUENCY_COLUMNS.sets, textAlign: 'right' }}>
        {ax ? `${row.setsText} sets` : row.setsText}
      </AppText>
      {perWeek && row.perWeek !== null ? (
        <AppText variant="body" numeric color={numColor} style={ax ? undefined : { width: FREQUENCY_COLUMNS.perWeek, textAlign: 'right' }}>
          {ax ? `${row.perWeek} a week` : row.perWeek}
        </AppText>
      ) : null}
    </>
  );
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={row.words}
      {...(hint ? { accessibilityHint: hint } : {})}
      {...(expanded === undefined ? {} : { accessibilityState: { expanded } })}
      onPress={onPress}
      style={({ pressed }) => ({ minHeight: theme.target.min.height, paddingVertical: theme.space['2'], backgroundColor: pressed ? theme.colors['bg.raised'] : 'transparent' })}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space['3'] }}>
        <View style={{ flex: 1, gap: theme.space['1'] }}>
          <AppText variant="body" color={row.zero ? 'text.secondary' : 'text.primary'}>
            {row.label}
          </AppText>
          {ax ? (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.space['3'] }}>{numbers}</View>
          ) : (
            <View
              onLayout={(e) => {
                setTrack(Math.floor(e.nativeEvent.layout.width));
              }}
              style={{ height: theme.chart.countBar.height, borderRadius: theme.chart.countBar.radius, backgroundColor: theme.colors['bg.raised'] }}
            >
              <View style={{ width: countBarWidth(row.fraction, track), height: theme.chart.countBar.height, borderRadius: theme.chart.countBar.radius, backgroundColor: theme.colors['chart.bar'] }} />
            </View>
          )}
        </View>
        {ax ? null : numbers}
        <Icon name={expanded ? 'chevron.down' : 'chevron.right'} color="text.tertiary" size={14} />
      </View>
    </Pressable>
  );
}

/** The `ResumeBar` (PG5): the whole bar resumes the workout; the rest countdown ticks once a second. */
export function ResumeBar({ bar, onResume, now }: { bar: ResumeBarData; onResume: () => void; now: () => number }) {
  const theme = useTheme();
  const [nowMs, setNowMs] = useState(now);
  useEffect(() => {
    if (bar.deadlineMs === null) return;
    const t = setInterval(() => {
      setNowMs(now());
    }, 1000);
    return () => {
      clearInterval(t);
    };
  }, [bar.deadlineMs, now]);
  const text = resumeBarText(bar, nowMs);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${text.replace(' · ', ', ')}. Resume.`}
      onPress={onResume}
      style={({ pressed }) => ({
        minHeight: 60,
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.space['3'],
        paddingHorizontal: theme.components.screenMargin,
        borderTopWidth: theme.dividerWidth,
        borderTopColor: theme.colors['border.divider'],
        backgroundColor: pressed ? theme.colors['bg.raised'] : theme.colors['bg.surface'],
      })}
    >
      <Icon name="play.fill" color="text.primary" size={16} />
      <AppText variant="body" numeric style={{ flex: 1 }} numberOfLines={1}>
        {text}
      </AppText>
      <View style={{ minHeight: theme.target.min.height, justifyContent: 'center', paddingHorizontal: theme.space['3'], borderRadius: theme.radius.pill, backgroundColor: theme.colors.accent }}>
        <AppText variant="headline" color="on.accent">
          Resume
        </AppText>
      </View>
    </Pressable>
  );
}
