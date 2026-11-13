import { useNavigation } from '@react-navigation/native';
import { useState } from 'react';
import { Pressable, View } from 'react-native';

import { weekdayDayMonth, type ActivityView, type DayListRow, type DayTile, type LegendItem, type ProgressHomeView, type TileMark, type TrainingPeriodView } from '@fizz/domain';
import type { Activity, ProgressGrouping } from '@fizz/schemas';

import { haptic } from '../../device/haptics';
import { consistencyCardView, type ConsistencyCardView } from '../../progress/consistency-view';
import { FrequencyHeader, FrequencyRow, FrequencySubRows, Segmented, useAx } from '../../progress/components';
import { unreadableText } from '../../progress/copy';
import { barLook, markHex, tileLook } from '../../progress/training-view';
import { RecapCard } from '../../reviews/RecapCard';
import { useReloadOn } from '../../progress/use-reload-on';
import type { PeriodChoice, ProgressTraining } from '../../services/progress-service';
import { useDataChanged, useScreenData, useServices } from '../../shell/context';
import { useTheme } from '../../theme';
import { AppText, Card, Group, Icon, Row, StatStrip, StatusLine, TextButton } from '../../ui';
import { ActivitySheet, type ActivitySaved } from '../activity/ActivitySheet';

/**
 * Progress › Training (redesign v3 C3–C4, Ben 27 Oct) for the period bar's period. Month: the calendar (a shaded tile
 * a day, light green with anything logged, a dot per session coloured by its plan day, a ring per activity, the
 * legend), `October workouts · 11 ›`, totals against the previous period, Consistency, Muscles · sets. Week: the 7
 * days and the same totals. 3M/6M/1Y: a bar per week, totals, muscles. Records last. Lays out the service's view
 * models; computes nothing. Local data only.
 */
export function TrainingTab({
  choice,
  active,
  onMonthList,
  onTime,
  onHow,
  onMuscles,
  onActivitySaved,
}: {
  choice: PeriodChoice;
  active: boolean;
  /** `October workouts ›`: that month's list. */
  onMonthList: (month: string) => void;
  onTime: (sheet: ActivityView['sheet']) => void;
  onHow: () => void;
  onMuscles: () => void;
  onActivitySaved: (saved: ActivitySaved) => void;
}) {
  const theme = useTheme();
  const ax = useAx();
  const navigation = useNavigation();
  const services = useServices();
  const changed = useDataChanged();
  const [data, reload] = useScreenData((s) => s.progress.training(choice), { enabled: active });
  const [consistencyData] = useScreenData((s) => s.plans.consistency(), { enabled: active && choice.span === 'month' });
  const [recapData, reloadRecap] = useScreenData((s) => s.progress.recap(), { enabled: active });
  const [selected, setSelected] = useState<string | null>(null);
  // A new period on the bar: read again (the selected busy day belongs to the old one).
  useReloadOn(`${choice.span}:${String(choice.offset)}`, reload);
  const [editing, setEditing] = useState<Activity | null>(null);

  if (data.state === 'error') {
    return <StatusLine icon="exclamationmark.triangle" tone="warning" text="Couldn’t open your training data." info={data.message} infoLabel="Error details" action={<TextButton label="Try again" onPress={reload} />} />;
  }
  if (data.state !== 'ready' || data.value === null) return null;
  const t: ProgressTraining = data.value;
  const view = t.view;
  const home = t.home.view;
  const recap = recapData.state === 'ready' ? (recapData.value?.view ?? null) : null;

  const openSession = (sessionId: string) => {
    navigation.navigate('Summary', { sessionId, back: true });
  };
  const openActivity = (activityId: string) => {
    void services.activities.get(activityId).then((a) => {
      if (a !== null) setEditing(a);
    });
  };
  const tap = (tile: DayTile) => {
    const o = tile.open;
    if (o === null) return;
    if (o.kind === 'session') openSession(o.sessionId);
    else if (o.kind === 'activity') openActivity(o.activityId);
    else setSelected((cur) => (cur === o.date ? null : o.date));
  };
  const busyDay = selected !== null && view?.dayRows[selected] !== undefined ? selected : null;

  return (
    <View style={{ gap: theme.space['5'] }}>
      {recap !== null ? (
        <RecapCard
          view={recap}
          onOpenWorkout={openSession}
          onDismiss={() => {
            haptic('step');
            void services.progress.dismissRecap(recap.month).then(() => {
              changed();
              reloadRecap();
            });
          }}
        />
      ) : null}
      {view === null || home.dataState === 'empty' ? (
        <AppText variant="body" color="text.secondary">
          Nothing logged yet.
        </AppText>
      ) : (
        <>
          {view.month !== null ? (
            <View style={{ gap: theme.space['3'] }}>
              <WeekdayLetters letters={view.weekdayLetters} />
              <View style={{ gap: 7 }}>
                {view.month.weeks.map((week, wi) => (
                  <View key={String(wi)} style={{ flexDirection: 'row', gap: 7 }}>
                    {week.map((d, di) => (d === null ? <View key={`pad-${String(di)}`} style={{ flex: 1 }} /> : <Tile key={d.date} tile={d} selected={d.date === busyDay} onPress={tap} />))}
                  </View>
                ))}
              </View>
              <Legend items={view.legend} />
            </View>
          ) : null}
          {view.week !== null ? (
            <View style={{ gap: theme.space['3'] }}>
              <WeekdayLetters letters={view.weekdayLetters} />
              <View style={{ flexDirection: 'row', gap: 7 }}>
                {view.week.map((d) => (
                  <Tile key={d.date} tile={d} selected={d.date === busyDay} onPress={tap} />
                ))}
              </View>
              <Legend items={view.legend} />
            </View>
          ) : null}
          {busyDay !== null ? <DayList date={busyDay} rows={view.dayRows[busyDay] ?? []} onSession={openSession} onActivity={openActivity} /> : null}
          {view.month !== null ? (
            <Group>
              <Row
                title={view.month.workouts.label}
                trailing={
                  <AppText variant="callout" color="text.secondary" numeric>
                    {String(view.month.workouts.count)}
                  </AppText>
                }
                onPress={() => {
                  onMonthList(view.month?.workouts.month ?? '');
                }}
              />
            </Group>
          ) : null}
          {view.bars !== null ? <WeekBars bars={view.bars} /> : null}
          <View style={{ gap: theme.space['2'] }}>
            <StatStrip items={view.totals.map((s) => ({ value: s.value, label: s.label.toUpperCase(), ...(s.delta !== null ? { note: s.delta } : {}) }))} accessibilityLabel={view.totalsWords} ax={ax} />
            {home.activity.footnote !== null ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`${home.activity.footnote}. Shows what was left out.`}
                onPress={() => {
                  onTime(home.activity.sheet);
                }}
                style={{ minHeight: theme.target.min.height, flexDirection: 'row', alignItems: 'center', gap: theme.space['2'] }}
              >
                <Icon name="info.circle" color="text.secondary" size={16} />
                <AppText variant="callout" color="text.secondary" numeric>
                  {home.activity.footnote}
                </AppText>
              </Pressable>
            ) : null}
          </View>
          {view.month !== null && consistencyData.state === 'ready' && consistencyData.value !== null ? <ConsistencyCard ax={ax} view={consistencyCardView(consistencyData.value, t.home.today)} /> : null}
          <Muscles
            view={home}
            grouping={t.home.grouping}
            onGrouping={(grouping) => {
              const saved = services.progress.saveSettings({ grouping });
              reload();
              void saved.then(reload);
            }}
            onHow={onHow}
            onMuscles={onMuscles}
          />
          {/* Records last: a row opens the workout it was set in. */}
          <Records view={home} onOpen={openSession} />
          {t.home.unreadable > 0 ? <StatusLine icon="exclamationmark.triangle" tone="warning" text={unreadableText(t.home.unreadable)} /> : null}
        </>
      )}
      <ActivitySheet
        visible={editing !== null}
        activity={editing}
        onClose={() => {
          setEditing(null);
        }}
        onSaved={(saved) => {
          setEditing(null);
          changed();
          reload();
          onActivitySaved(saved);
        }}
      />
    </View>
  );
}

function WeekdayLetters({ letters }: { letters: readonly string[] }) {
  return (
    <View style={{ flexDirection: 'row', gap: 7 }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {letters.map((l, i) => (
        <AppText key={String(i)} variant="label" color="text.secondary" style={{ flex: 1, textAlign: 'center' }}>
          {l}
        </AppText>
      ))}
    </View>
  );
}

function Mark({ mark, size = 8 }: { mark: TileMark; size?: number }) {
  const theme = useTheme();
  const hex = markHex(mark, theme.scheme);
  return hex === null ? (
    <View style={{ width: size, height: size, borderRadius: size / 2, borderWidth: 1.5, borderColor: theme.colors['text.secondary'] }} />
  ) : (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: hex }} />
  );
}

/** One day: a shaded tile with the date and its dots; a tap opens the day's one thing (or its list). */
function Tile({ tile, selected, onPress }: { tile: DayTile; selected: boolean; onPress: (t: DayTile) => void }) {
  const theme = useTheme();
  const look = tileLook(tile, selected);
  const style = {
    flex: 1,
    minHeight: 46,
    aspectRatio: 1 / 1.05,
    borderRadius: 12,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    gap: 5,
    backgroundColor: look.fill === null ? 'transparent' : theme.colors[look.fill],
    borderWidth: look.borderWidth,
    borderColor: look.border === null ? 'transparent' : theme.colors[look.border],
  };
  const body = (
    <>
      <AppText variant="callout" color={look.day} numeric maxFontSizeMultiplier={1.3} style={{ fontSize: 14, lineHeight: 16 }}>
        {String(tile.day)}
      </AppText>
      <View style={{ height: 8, flexDirection: 'row', alignItems: 'center', gap: 3 }}>
        {tile.marks.map((m, i) => (
          <Mark key={String(i)} mark={m} />
        ))}
        {tile.more > 0 ? (
          <AppText variant="label" color="text.secondary" numeric maxFontSizeMultiplier={1.2} style={{ fontSize: 10, lineHeight: 10 }}>
            +
          </AppText>
        ) : null}
      </View>
    </>
  );
  if (tile.open === null) {
    return (
      <View accessible accessibilityLabel={tile.words} style={style}>
        {body}
      </View>
    );
  }
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={tile.words}
      accessibilityState={{ selected }}
      onPress={() => {
        onPress(tile);
      }}
      style={({ pressed }) => [style, { opacity: pressed ? 0.7 : 1 }]}
    >
      {body}
    </Pressable>
  );
}

/** Under the grid, always: each colour with its name, never colour alone. */
function Legend({ items }: { items: readonly LegendItem[] }) {
  const theme = useTheme();
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', columnGap: theme.space['4'], rowGap: theme.space['1'] }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {items.map((it) => (
        <View key={it.key} style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
          <Mark mark={it.mark} />
          <AppText variant="label" color="text.secondary">
            {it.label}
          </AppText>
        </View>
      ))}
    </View>
  );
}

function DayList({ date, rows, onSession, onActivity }: { date: string; rows: readonly DayListRow[]; onSession: (id: string) => void; onActivity: (id: string) => void }) {
  const theme = useTheme();
  return (
    <View style={{ gap: theme.space['2'] }}>
      <AppText variant="headline" accessibilityRole="header">
        {weekdayDayMonth(date)}
      </AppText>
      <Group>
        {rows.map((r) => (
          <Row
            key={r.key}
            title={r.title}
            subtitle={r.detail}
            {...(r.kind === 'activity' ? { icon: 'figure.run' as const } : {})}
            onPress={() => {
              if (r.kind === 'session') onSession(r.id);
              else onActivity(r.id);
            }}
          />
        ))}
      </Group>
    </View>
  );
}

/** 3M/6M/1Y: sessions a week, one bar each; weeks under the aim greyed, the aim drawn as a line. */
function WeekBars({ bars }: { bars: NonNullable<TrainingPeriodView['bars']> }) {
  const theme = useTheme();
  const plot = 96;
  return (
    <View style={{ gap: theme.space['1'] }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <AppText variant="sectionLabel" color="text.tertiary" accessibilityRole="header">
          SESSIONS A WEEK
        </AppText>
        {bars.aim !== null ? (
          <AppText variant="callout" color="text.secondary" numeric>
            {bars.aim}
          </AppText>
        ) : null}
      </View>
      <View accessible accessibilityLabel={bars.words} style={{ height: plot, flexDirection: 'row', alignItems: 'flex-end', gap: bars.weeks.length > 30 ? 1 : 3 }}>
        {bars.aimLine !== null ? <View style={{ position: 'absolute', left: 0, right: 0, bottom: bars.aimLine * plot, borderTopWidth: 1, borderStyle: 'dashed', borderColor: theme.colors['text.tertiary'] }} /> : null}
        {bars.weeks.map((w) => {
          const look = barLook(w, bars.max);
          return <View key={w.monday} style={{ flex: 1, height: Math.max(2, look.height * plot), borderRadius: 2, backgroundColor: theme.colors[look.fill] }} />;
        })}
      </View>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <AppText variant="label" color="text.tertiary" numeric>
          {bars.first}
        </AppText>
        <AppText variant="label" color="text.tertiary" numeric>
          {bars.last}
        </AppText>
      </View>
    </View>
  );
}

/**
 * `Consistency` (plan tracker v1): counts and a mark per week, never colour alone; never "missed".
 * Design pass 6.1: 8 equal columns (`flex: 1, minWidth: 0`) with day-number labels on one line,
 * capped in scale, so the newest week is always visible; at AX sizes, one row per week.
 */
function ConsistencyCard({ view, ax }: { view: ConsistencyCardView; ax: boolean }) {
  const theme = useTheme();
  return (
    <Card>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'baseline', justifyContent: 'space-between', columnGap: theme.space['2'] }}>
        <AppText variant="sectionLabel" color="text.tertiary" accessibilityRole="header">
          {view.title.toUpperCase()}
        </AppText>
        <AppText variant="callout" numeric>
          {view.thisWeek}
        </AppText>
      </View>
      {ax ? (
        <View>
          {view.weeks.map((w) => (
            <View key={w.key} accessible accessibilityLabel={w.accessibilityLabel} style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space['2'], minHeight: 44, borderTopWidth: theme.dividerWidth, borderColor: theme.colors['border.divider'] }}>
              <AppText variant="callout" color="text.secondary" numeric style={{ flex: 1 }}>
                {w.rowLabel}
              </AppText>
              <AppText variant="callout" numeric>
                {w.value}
              </AppText>
              {w.atAim === true ? <Icon name="checkmark" size={14} color="text.secondary" /> : <View style={{ width: 14 }} />}
            </View>
          ))}
        </View>
      ) : (
        <View style={{ flexDirection: 'row' }}>
          {view.weeks.map((w) => (
            <View key={w.key} accessible accessibilityLabel={w.accessibilityLabel} style={{ flex: 1, minWidth: 0, alignItems: 'center', gap: 2 }}>
              <AppText variant="callout" numeric numberOfLines={1} maxFontSizeMultiplier={1.3}>
                {w.value}
              </AppText>
              {w.atAim === true ? <Icon name="checkmark" size={12} color="text.secondary" /> : <View style={{ height: 12 }} />}
              <AppText variant="label" color="text.tertiary" numeric numberOfLines={1} maxFontSizeMultiplier={1.3}>
                {w.label}
              </AppText>
            </View>
          ))}
        </View>
      )}
      {view.atAim !== null ? (
        <AppText variant="callout" color="text.secondary" numeric>
          {view.atAim}
        </AppText>
      ) : null}
      {view.plan !== null ? (
        <AppText variant="callout" color="text.secondary" numeric>
          {view.plan}
        </AppText>
      ) : null}
    </Card>
  );
}

function Muscles({ view, grouping, onGrouping, onHow, onMuscles }: { view: Extract<ProgressHomeView, { dataState: 'normal' }>; grouping: ProgressGrouping; onGrouping: (g: ProgressGrouping) => void; onHow: () => void; onMuscles: () => void }) {
  const theme = useTheme();
  const { muscles } = view;
  // D2: parents only; a row opens to its sub-rows in place.
  const [openRows, setOpenRows] = useState<ReadonlySet<string>>(new Set());
  return (
    <View style={{ gap: theme.space['3'] }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space['1'] }}>
        <AppText variant="sectionLabel" color="text.tertiary" accessibilityRole="header">
          MUSCLES · SETS
        </AppText>
        <Pressable accessibilityRole="button" accessibilityLabel="How muscles are counted" onPress={onHow} style={{ minWidth: theme.target.min.width, minHeight: theme.target.min.height, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="info.circle" color="text.secondary" size={16} />
        </Pressable>
      </View>
      <Segmented
        options={[
          { key: 'body_part' as const, label: 'Body parts' },
          { key: 'ppl' as const, label: 'Push/Pull/Legs' },
        ]}
        selected={grouping}
        onSelect={onGrouping}
        label="Muscles"
      />
      {muscles.noneSet ? (
        <AppText variant="callout" color="text.secondary">
          No muscles set on these exercises.
        </AppText>
      ) : (
        <View>
          <FrequencyHeader perWeek={false} />
          {muscles.rows.map((r) => {
            const expanded = openRows.has(r.key);
            return (
              <View key={r.key}>
                <FrequencyRow
                  row={r}
                  perWeek={false}
                  expanded={expanded}
                  onPress={() => {
                    setOpenRows((prev) => {
                      const next = new Set(prev);
                      if (next.has(r.key)) next.delete(r.key);
                      else next.add(r.key);
                      return next;
                    });
                  }}
                />
                {expanded ? <FrequencySubRows rows={r.subRows} empty={r.lastTrained} /> : null}
              </View>
            );
          })}
        </View>
      )}
      {muscles.noMusclesLine !== null ? (
        <Pressable accessibilityRole="button" accessibilityLabel={`${muscles.noMusclesLine}. Opens Muscles.`} onPress={onMuscles} style={{ minHeight: theme.target.min.height, justifyContent: 'center' }}>
          <AppText variant="callout" color="text.secondary">{`${muscles.noMusclesLine} ›`}</AppText>
        </Pressable>
      ) : null}
    </View>
  );
}

function Records({ view, onOpen }: { view: Extract<ProgressHomeView, { dataState: 'normal' }>; onOpen: (sessionId: string) => void }) {
  const theme = useTheme();
  const { records } = view;
  // `All records (n) ›` lists the rest in place; for one window only (review progress-B r2 N3).
  const windowKey = `${view.window.from}:${view.window.to}`;
  const [allFor, setAllFor] = useState<string | null>(null);
  const all = allFor === windowKey;
  const rows = all ? records.items : records.items.slice(0, records.initial);
  return (
    <View style={{ gap: theme.space['2'] }}>
      <AppText variant="sectionLabel" color="text.tertiary" accessibilityRole="header">
        RECORDS
      </AppText>
      {records.empty !== null ? (
        <AppText variant="callout" color="text.secondary">
          {records.empty}
        </AppText>
      ) : (
        rows.map((r) => (
          <Pressable
            key={r.key}
            accessibilityRole="button"
            accessibilityLabel={r.words}
            accessibilityHint="Opens the workout"
            onPress={() => {
              onOpen(r.sessionId);
            }}
            style={({ pressed }) => ({ minHeight: theme.target.min.height, paddingVertical: theme.space['2'], flexDirection: 'row', alignItems: 'center', gap: theme.space['3'], backgroundColor: pressed ? theme.colors['bg.raised'] : 'transparent' })}
          >
            <View style={{ flex: 1, gap: 2 }}>
              <AppText variant="body">{r.title}</AppText>
              <AppText variant="callout" color="text.secondary" numeric>{`${r.label}  ${r.value} · ${r.date}`}</AppText>
            </View>
            <Icon name="chevron.right" color="text.tertiary" size={14} />
          </Pressable>
        ))
      )}
      {!all && records.more !== null ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={records.more.words}
          accessibilityHint="Lists every record"
          onPress={() => {
            setAllFor(windowKey);
          }}
          style={({ pressed }) => ({ minHeight: theme.target.min.height, flexDirection: 'row', alignItems: 'center', gap: theme.space['3'], backgroundColor: pressed ? theme.colors['bg.raised'] : 'transparent' })}
        >
          <AppText variant="callout" color="text.secondary" style={{ flex: 1 }}>
            {records.more.label}
          </AppText>
          <Icon name="chevron.right" color="text.tertiary" size={14} />
        </Pressable>
      ) : null}
    </View>
  );
}

