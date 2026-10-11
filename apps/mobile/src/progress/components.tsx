import { useEffect, useState } from 'react';
import { Pressable, useWindowDimensions, View } from 'react-native';

import { resumeBarText, type BarsView, type FrequencyRowView, type ResumeBar as ResumeBarData } from '@fizz/domain';
import type { ProgressWindowDays } from '@fizz/schemas';

import { haptic } from '../device/haptics';
import { useTheme } from '../theme';
import { AppText, Icon } from '../ui';
import { AX_FONT_SCALE } from '../workout/overview';
import { countBarWidth, visibleLabels, weekBarsLayout } from './chart-layout';
import { loadWeekBarsCanvas } from './load-charts';

/**
 * Progress components (design-system §9.69–9.72): `Segmented`,
 * `WindowPicker`, `WeekBars`, `DayStrip`, `FrequencyRow` and the
 * `ResumeBar`. They show the view model they are given and compute nothing.
 * No animation anywhere; numbers are always printed, so no bar or glyph is
 * the only carrier of a value; AX sizes switch to lists.
 */

export function useAx(): boolean {
  return useWindowDimensions().fontScale >= AX_FONT_SCALE;
}

/** A full-width segmented control, 44pt (selected: `accent.subtle` with `text.primary`; never colour alone, the label is Semibold). */
export function Segmented<K extends string | number>({ options, selected, onSelect, label }: { options: readonly { key: K; label: string }[]; selected: K; onSelect: (k: K) => void; label: string }) {
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

const WINDOWS: readonly { key: ProgressWindowDays; label: string }[] = [
  { key: 7, label: '7 days' },
  { key: 14, label: '14 days' },
  { key: 30, label: '30 days' },
  { key: 60, label: '60 days' },
];

/** `WindowPicker` (§9.69): segmented, or at AX sizes a `Last 30 days ▾` button that lists the four. */
export function WindowPicker({ days, datesLine, datesWords, onChange }: { days: ProgressWindowDays; datesLine: string; datesWords: string; onChange: (d: ProgressWindowDays) => void }) {
  const theme = useTheme();
  const ax = useAx();
  const [open, setOpen] = useState(false);
  return (
    <View style={{ gap: theme.space['2'] }}>
      {ax ? (
        <View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Window, ${String(days)} days. ${datesWords}`}
            accessibilityState={{ expanded: open }}
            onPress={() => {
              setOpen((o) => !o);
            }}
            style={{ minHeight: theme.target.min.height, justifyContent: 'center' }}
          >
            <AppText variant="headline" color="accent">{`Last ${String(days)} days ${open ? '▴' : '▾'}`}</AppText>
          </Pressable>
          {open
            ? WINDOWS.map((w) => (
                <Pressable
                  key={w.key}
                  accessibilityRole="button"
                  accessibilityState={{ selected: w.key === days }}
                  onPress={() => {
                    setOpen(false);
                    if (w.key !== days) {
                      haptic('step');
                      onChange(w.key);
                    }
                  }}
                  style={{ minHeight: theme.target.min.height, flexDirection: 'row', alignItems: 'center', gap: theme.space['2'] }}
                >
                  <AppText variant="body">{`Last ${w.label}`}</AppText>
                  {w.key === days ? <Icon name="checkmark" color="text.primary" /> : null}
                </Pressable>
              ))
            : null}
        </View>
      ) : (
        <Segmented options={WINDOWS} selected={days} onSelect={onChange} label="Window" />
      )}
      <AppText variant="callout" color="text.secondary" numeric accessibilityLabel={datesWords}>
        {datesLine}
      </AppText>
    </View>
  );
}

/** `WeekBars` (§9.70) or `DayStrip` (§9.71), from the view model. One VoiceOver element; the card around it is the button. */
export function ActivityBars({ bars }: { bars: BarsView }) {
  const ax = useAx();
  if (bars.kind === 'weeks') return ax ? <WeekList bars={bars} /> : <WeekBars bars={bars} />;
  return ax ? <DayList bars={bars} /> : <DayStrip bars={bars} />;
}

function WeekList({ bars }: { bars: Extract<BarsView, { kind: 'weeks' }> }) {
  return (
    <View accessible accessibilityLabel={bars.words}>
      {bars.bars.map((b) => (
        <AppText key={b.from} variant="callout" numeric color={b.count === 0 ? 'text.tertiary' : 'text.primary'}>{`Week from ${b.label} · ${String(b.count)}`}</AppText>
      ))}
    </View>
  );
}

function WeekBars({ bars }: { bars: Extract<BarsView, { kind: 'weeks' }> }) {
  const theme = useTheme();
  const [width, setWidth] = useState(0);
  const dims = theme.chart.weekBars;
  const rects = weekBarsLayout(
    bars.bars.map((b) => b.count),
    width,
    bars.max,
    dims,
  );
  const labels = new Set(visibleLabels(bars.bars.length, width, 52));
  const canvas = loadWeekBarsCanvas();
  const countHeight = 20;
  return (
    <View
      accessible
      accessibilityLabel={bars.words}
      onLayout={(e) => {
        setWidth(Math.floor(e.nativeEvent.layout.width));
      }}
    >
      <View style={{ height: countHeight + dims.height }}>
        {width > 0 ? (
          <View style={{ position: 'absolute', top: countHeight, left: 0 }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
            {canvas.ok ? (
              <canvas.value bars={rects} width={width} height={dims.height} radius={dims.radius} barColor={theme.colors['chart.bar']} stubColor={theme.colors['chart.grid']} />
            ) : (
              // Skia unavailable: the same rectangles as plain views.
              <View style={{ width, height: dims.height }}>
                {rects.map((r, i) => (
                  <View key={String(i)} style={{ position: 'absolute', left: r.x, top: r.y, width: r.width, height: r.height, backgroundColor: r.zero ? theme.colors['chart.grid'] : theme.colors['chart.bar'], borderTopLeftRadius: r.zero ? 0 : dims.radius, borderTopRightRadius: r.zero ? 0 : dims.radius }} />
                ))}
              </View>
            )}
          </View>
        ) : null}
        {rects.map((r, i) => {
          const b = bars.bars[i];
          if (!b) return null;
          return (
            <View key={b.from} style={{ position: 'absolute', left: r.centreX - 20, width: 40, top: r.y, alignItems: 'center' }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
              <AppText variant="label" numeric color={b.count === 0 ? 'text.tertiary' : 'text.primary'} maxFontSizeMultiplier={1.4}>
                {String(b.count)}
              </AppText>
            </View>
          );
        })}
      </View>
      <View style={{ height: 20, marginTop: theme.space['1'] }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        {rects.map((r, i) => {
          const b = bars.bars[i];
          if (!b || !labels.has(i)) return null;
          return (
            <View key={b.from} style={{ position: 'absolute', left: r.centreX - 30, width: 60, alignItems: 'center' }}>
              <AppText variant="label" color="chart.axisText" numeric maxFontSizeMultiplier={1.4} numberOfLines={1}>
                {b.label}
              </AppText>
            </View>
          );
        })}
      </View>
    </View>
  );
}

function DayStrip({ bars }: { bars: Extract<BarsView, { kind: 'days' }> }) {
  const theme = useTheme();
  const d = theme.chart.dayCell;
  return (
    <View accessible accessibilityLabel={bars.words} style={{ gap: theme.space['3'] }}>
      {bars.rows.map((row) => (
        <View key={row.firstDate} style={{ gap: theme.space['1'] }}>
          {bars.rows.length > 1 ? (
            <AppText variant="label" color="text.secondary" numeric>
              {row.firstDate}
            </AppText>
          ) : null}
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            {row.cells.map((c) => (
              <View key={c.date} style={{ minWidth: d.minColumn, alignItems: 'center', gap: theme.space['1'] }}>
                <AppText variant="label" color={c.isToday ? 'text.primary' : 'text.secondary'} style={{ fontWeight: c.isToday ? '700' : '400' }} maxFontSizeMultiplier={1.4}>
                  {c.letter}
                </AppText>
                <View style={{ height: 18, justifyContent: 'center', alignItems: 'center' }}>
                  {c.count >= 2 ? (
                    <AppText variant="label" numeric maxFontSizeMultiplier={1.4}>
                      {String(c.count)}
                    </AppText>
                  ) : c.count === 1 ? (
                    <View style={{ width: d.diameter, height: d.diameter, borderRadius: d.diameter / 2, backgroundColor: theme.colors['text.primary'] }} />
                  ) : (
                    <View style={{ width: 4, height: 4, borderRadius: 2, backgroundColor: theme.colors['text.tertiary'] }} />
                  )}
                </View>
              </View>
            ))}
          </View>
        </View>
      ))}
    </View>
  );
}

function DayList({ bars }: { bars: Extract<BarsView, { kind: 'days' }> }) {
  const days = bars.rows.flatMap((r) => r.cells).filter((c) => c.count > 0);
  return (
    <View accessible accessibilityLabel={bars.words}>
      {days.length === 0 ? (
        <AppText variant="callout" color="text.tertiary">
          No workouts
        </AppText>
      ) : (
        days.map((c) => <AppText key={c.date} variant="callout" numeric>{`${c.dateText} · ${String(c.count)} ${c.count === 1 ? 'workout' : 'workouts'}`}</AppText>)
      )}
    </View>
  );
}

/** Column headers over the frequency rows (`SESSIONS`, `SETS`, `PER WEEK`). */
export function FrequencyHeader({ perWeek }: { perWeek: boolean }) {
  const theme = useTheme();
  const ax = useAx();
  if (ax) return null;
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: theme.space['3'] }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <AppText variant="sectionLabel" color="text.tertiary" style={{ width: 72, textAlign: 'right' }}>
        SESSIONS
      </AppText>
      <AppText variant="sectionLabel" color="text.tertiary" style={{ width: 52, textAlign: 'right' }}>
        SETS
      </AppText>
      {perWeek ? (
        <AppText variant="sectionLabel" color="text.tertiary" style={{ width: 72, textAlign: 'right' }}>
          PER WEEK
        </AppText>
      ) : null}
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
      <AppText variant="body" numeric color={numColor} style={ax ? undefined : { width: 72, textAlign: 'right' }}>
        {ax ? `${String(row.sessions)} sessions` : String(row.sessions)}
      </AppText>
      <AppText variant="body" numeric color={numColor} style={ax ? undefined : { width: 52, textAlign: 'right' }}>
        {ax ? `${row.setsText} sets` : row.setsText}
      </AppText>
      {perWeek && row.perWeek !== null ? (
        <AppText variant="body" numeric color={numColor} style={ax ? undefined : { width: 72, textAlign: 'right' }}>
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
