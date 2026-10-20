import { useNavigation } from '@react-navigation/native';
import { useState } from 'react';
import { Pressable, View } from 'react-native';

import { nothingLoggedText, weekdayDayMonth, type ActivityRow, type CalendarSessionRow } from '@fizz/domain';
import type { Activity } from '@fizz/schemas';

import { useDataChanged, useScreenData, useServices } from '../../shell/context';
import { ActivitySheet } from '../activity/ActivitySheet';
import { useTheme } from '../../theme';
import { AppText, Group, Icon, Row, StatusLine, TextButton } from '../../ui';

/**
 * Progress › Calendar (progress.md §2.5, §3.3): a Monday-first month with a
 * mark on workout days, and the selected day's workouts, each opening its
 * Summary. Nothing here is planned or estimated.
 */
export function CalendarView({ month, onMonth }: { month: string | null; onMonth: (m: string) => void }) {
  const theme = useTheme();
  const navigation = useNavigation();
  const [data, reload] = useScreenData((s) => s.progress.calendar(month ?? undefined));
  const [selected, setSelected] = useState<string | null>(null);
  const services = useServices();
  const changed = useDataChanged();
  // (Ben, 20 Oct) An activity opens in the activity sheet (edit or delete).
  const [editing, setEditing] = useState<Activity | null>(null);

  if (data.state === 'error') {
    return <StatusLine icon="exclamationmark.triangle" tone="warning" text="Couldn’t open your training data." action={<TextButton label="Try again" onPress={reload} />} />;
  }
  if (data.state !== 'ready' || data.value === null) return null;
  const view = data.value.view;
  const day = selected !== null && selected.startsWith(view.month) ? selected : view.defaultSelected;
  const rows: CalendarSessionRow[] = day === null ? [] : (view.days[day] ?? []);
  const acts: ActivityRow[] = day === null ? [] : (view.activityDays[day] ?? []);

  const open = (r: CalendarSessionRow) => {
    if (r.kind === 'finished') navigation.navigate('Summary', { sessionId: r.sessionId, back: true });
    else if (r.kind === 'in_progress') navigation.navigate('Workout');
    else navigation.navigate('Tabs', { screen: 'Today' });
  };
  const go = (m: string) => {
    setSelected(null);
    onMonth(m);
    reload();
  };

  return (
    <View style={{ gap: theme.space['4'] }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Previous month"
          onPress={() => {
            go(view.previousMonth);
          }}
          style={{ minWidth: theme.target.min.width, minHeight: theme.target.min.height, alignItems: 'center', justifyContent: 'center' }}
        >
          <Icon name="chevron.left" color="accent" />
        </Pressable>
        <AppText variant="headline" accessibilityRole="header">
          {view.title}
        </AppText>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Next month"
          onPress={() => {
            go(view.nextMonth);
          }}
          style={{ minWidth: theme.target.min.width, minHeight: theme.target.min.height, alignItems: 'center', justifyContent: 'center' }}
        >
          <Icon name="chevron.right" color="accent" />
        </Pressable>
      </View>

      <View>
        <View style={{ flexDirection: 'row' }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((l, i) => (
            <AppText key={String(i)} variant="label" color="text.secondary" style={{ flex: 1, textAlign: 'center' }}>
              {l}
            </AppText>
          ))}
        </View>
        {view.weeks.map((week, wi) => (
          <View key={String(wi)} style={{ flexDirection: 'row' }}>
            {week.map((d, di) =>
              d === null ? (
                <View key={`pad-${String(di)}`} style={{ flex: 1, minHeight: theme.target.min.height + 8 }} />
              ) : (
                <Pressable
                  key={d.date}
                  accessibilityRole="button"
                  accessibilityLabel={d.words}
                  accessibilityState={{ selected: d.date === day }}
                  onPress={() => {
                    setSelected(d.date);
                  }}
                  style={{ flex: 1, minHeight: theme.target.min.height + 8, alignItems: 'center', justifyContent: 'center', gap: 2 }}
                >
                  <View
                    style={{
                      minWidth: 30,
                      height: 30,
                      borderRadius: 15,
                      alignItems: 'center',
                      justifyContent: 'center',
                      borderWidth: d.isToday ? 1 : 0,
                      borderColor: theme.colors['text.secondary'],
                      backgroundColor: d.date === day ? theme.colors['accent.subtle'] : 'transparent',
                    }}
                  >
                    <AppText variant="callout" numeric style={{ fontWeight: d.date === day ? '600' : '400' }}>
                      {String(d.day)}
                    </AppText>
                  </View>
                  <View style={{ height: 12, flexDirection: 'row', alignItems: 'center', gap: 2 }}>
                    {d.count > 0 ? <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: theme.colors['text.primary'] }} /> : null}
                    {d.count > 1 ? (
                      <AppText variant="label" numeric maxFontSizeMultiplier={1.2}>
                        {String(d.count)}
                      </AppText>
                    ) : null}
                    {d.activities > 0 ? <View style={{ width: 6, height: 6, borderRadius: 3, borderWidth: 1, borderColor: theme.colors['text.primary'] }} /> : null}
                  </View>
                </Pressable>
              ),
            )}
          </View>
        ))}
        <AppText variant="label" color="text.secondary" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          ● workout  ○ activity
        </AppText>
      </View>

      {view.empty !== null && rows.length === 0 && acts.length === 0 ? (
        <AppText variant="callout" color="text.secondary">
          {view.empty}
        </AppText>
      ) : day === null ? null : (
        <View style={{ gap: theme.space['2'] }}>
          <AppText variant="headline" accessibilityRole="header">
            {weekdayDayMonth(day)}
          </AppText>
          {rows.length === 0 && acts.length === 0 ? (
            <AppText variant="callout" color="text.secondary">
              {nothingLoggedText(day)}
            </AppText>
          ) : (
            <Group>
              {rows.map((r) => (
                <Row
                  key={r.sessionId}
                  title={r.title}
                  subtitle={r.detail}
                  onPress={() => {
                    open(r);
                  }}
                />
              ))}
              {acts.map((a) => (
                <Row
                  key={a.activityId}
                  icon="figure.run"
                  title={a.title}
                  subtitle={a.detail}
                  onPress={() => {
                    void services.activities.get(a.activityId).then((x) => {
                      if (x !== null) setEditing(x);
                    });
                  }}
                />
              ))}
            </Group>
          )}
        </View>
      )}
      <ActivitySheet
        visible={editing !== null}
        activity={editing}
        onClose={() => {
          setEditing(null);
        }}
        onSaved={() => {
          setEditing(null);
          changed();
          reload();
        }}
      />
      {data.value.unreadable > 0 ? <StatusLine icon="exclamationmark.triangle" tone="warning" text={`${String(data.value.unreadable)} ${data.value.unreadable === 1 ? 'workout couldn’t be read and isn’t' : 'workouts couldn’t be read and aren’t'} counted.`} /> : null}
    </View>
  );
}
