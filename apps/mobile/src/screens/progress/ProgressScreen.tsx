import { useNavigation } from '@react-navigation/native';
import { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';

import { toMs, type ProgressHomeView, type TimeSheetRow } from '@fizz/domain';
import type { ProgressGrouping, ProgressWindowDays } from '@fizz/schemas';

import { newUuid } from '../../device/runtime';
import { ActivityBars, FrequencyHeader, FrequencyRow, ResumeBar, Segmented, useAx, WindowPicker } from '../../progress/components';
import type { ProgressHome } from '../../services/progress-service';
import { useScreenData, useServices } from '../../shell/context';
import { useTheme } from '../../theme';
import { AppText, Card, Icon, PrimaryButton, SecondaryButton, StatStrip, StatusLine, TextButton, Toast } from '../../ui';
import { AskPill } from '../coach/AskPill';
import { CalendarView } from './CalendarView';
import { HowCountedSheet, TimeSheet } from './sheets';

/**
 * Progress home (progress.md v1.0 slice A, §2.2): one window drives every
 * card; Activity (sessions, time, bars), Muscles (Body parts | Push/Pull/
 * Legs), Records; `Overview | Calendar`. Local data only: identical offline
 * and with no coach (check 20). The screen lays out the service's view model
 * and computes nothing.
 */

type Toasted = { text: string; action?: string; onAction?: () => void } | null;

export function ProgressScreen() {
  const theme = useTheme();
  const navigation = useNavigation();
  const services = useServices();
  const ax = useAx();
  const [segment, setSegment] = useState<'overview' | 'calendar'>('overview');
  const [month, setMonth] = useState<string | null>(null);
  const [req, setReq] = useState<{ days?: ProgressWindowDays; grouping?: ProgressGrouping }>({});
  const [data, reload] = useScreenData((s) => s.progress.home(req));
  const [timeOpen, setTimeOpen] = useState(false);
  const [howOpen, setHowOpen] = useState(false);
  const [toast, setToast] = useState<Toasted>(null);
  const [placeholder, setPlaceholder] = useState(false);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    // Loading: nothing for `timing.placeholderDelay`, then still grey blocks (no shimmer).
    const t = setTimeout(() => {
      setPlaceholder(true);
    }, theme.timing.placeholderDelay);
    return () => {
      clearTimeout(t);
    };
  }, [theme.timing.placeholderDelay]);
  useEffect(
    () => () => {
      if (toastTimer.current) clearTimeout(toastTimer.current);
    },
    [],
  );

  const show = (t: Toasted) => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast(t);
    toastTimer.current = setTimeout(() => {
      setToast(null);
    }, theme.timing.undoToast);
  };

  const change = (patch: { days?: ProgressWindowDays; grouping?: ProgressGrouping }) => {
    setReq((r) => ({ ...r, ...patch }));
    reload();
    void services.progress.saveSettings(patch);
  };

  const countIt = async (row: TimeSheetRow) => {
    const out = await services.progress.confirmDuration({ sessionId: row.sessionId, expectedVersion: row.version, opId: newUuid() });
    if (!out.ok) {
      show({ text: out.message });
      reload();
      return;
    }
    reload();
    const duration = row.text.split(' · ').at(-1) ?? '';
    show({
      text: `Counted ${row.title}, ${duration}`,
      action: 'Undo',
      onAction: () => {
        setToast(null);
        void services.progress.undoConfirmDuration({ sessionId: out.sessionId, expectedVersion: out.version, opId: newUuid() }).then((u) => {
          if (!u.ok) show({ text: u.message });
          reload();
        });
      },
    });
  };

  const home: ProgressHome | null = data.state === 'ready' ? data.value : null;
  const resume = home?.resume ?? null;

  const header = (
    <View style={{ gap: theme.space['4'] }}>
      <AppText variant="title1" accessibilityRole="header">
        Progress
      </AppText>
      {home?.view.dataState === 'normal' ? (
        <Segmented
          options={[
            { key: 'overview', label: 'Overview' },
            { key: 'calendar', label: 'Calendar' },
          ]}
          selected={segment}
          onSelect={setSegment}
          label="Progress"
        />
      ) : null}
    </View>
  );

  let body: React.ReactNode;
  if (data.state === 'error') {
    body = (
      <StatusLine
        icon="exclamationmark.triangle"
        tone="warning"
        text="Couldn’t open your training data."
        info={data.message}
        infoLabel="Error details"
        action={
          <View style={{ flexDirection: 'row', gap: theme.space['3'] }}>
            <TextButton label="Try again" onPress={reload} />
            <TextButton
              label="Restore from backup"
              onPress={() => {
                navigation.navigate('Tabs', { screen: 'Profile', params: { screen: 'Restore', params: { mode: 'restore' }, initial: false } });
              }}
            />
          </View>
        }
      />
    );
  } else if (home === null) {
    body = data.state === 'loading' && placeholder ? <Placeholder /> : null;
  } else if (home.view.dataState === 'empty') {
    body = <EmptyState hasResume={resume !== null} />;
  } else if (segment === 'calendar') {
    body = (
      <CalendarView
        month={month}
        onMonth={(m) => {
          setMonth(m);
        }}
      />
    );
  } else {
    body = (
      <Overview
        home={home}
        view={home.view}
        ax={ax}
        onWindow={(days) => {
          change({ days });
        }}
        onGrouping={(grouping) => {
          change({ grouping });
        }}
        onCalendar={() => {
          setMonth(null);
          setSegment('calendar');
        }}
        onTime={() => {
          setTimeOpen(true);
        }}
        onHow={() => {
          setHowOpen(true);
        }}
        onMuscle={(group) => {
          navigation.navigate('Tabs', { screen: 'Progress', params: { screen: 'ProgressMuscles', params: { group } } });
        }}
        onWorkout={(sessionId) => {
          navigation.navigate('Summary', { sessionId, back: true });
        }}
      />
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors['bg.canvas'] }}>
      <ScrollView
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{ paddingHorizontal: theme.components.screenMargin, paddingTop: theme.space['4'], paddingBottom: theme.space['8'] + 56, gap: theme.space['5'] }}
      >
        {header}
        {body}
      </ScrollView>
      <AskPill
        onPress={() => {
          navigation.navigate('Coach', { entry: { kind: 'today' } });
        }}
      />
      {toast ? <Toast icon="info.circle" text={toast.text} {...(toast.action ? { action: toast.action } : {})} {...(toast.onAction ? { onAction: toast.onAction } : {})} /> : null}
      {resume ? (
        <ResumeBar
          bar={resume}
          now={() => toMs(services.now().utc)}
          onResume={() => {
            navigation.navigate('Workout');
          }}
        />
      ) : null}
      {home?.view.dataState === 'normal' ? (
        <TimeSheet
          visible={timeOpen}
          sheet={home.view.activity.sheet}
          onClose={() => {
            setTimeOpen(false);
          }}
          onCount={(r) => {
            void countIt(r);
          }}
          onEdit={(r) => {
            setTimeOpen(false);
            navigation.navigate('Summary', { sessionId: r.sessionId, back: true });
          }}
        />
      ) : null}
      <HowCountedSheet
        visible={howOpen}
        onClose={() => {
          setHowOpen(false);
        }}
      />
    </View>
  );
}

function Overview({
  home,
  view,
  ax,
  onWindow,
  onGrouping,
  onCalendar,
  onTime,
  onHow,
  onMuscle,
  onWorkout,
}: {
  home: ProgressHome;
  view: Extract<ProgressHomeView, { dataState: 'normal' }>;
  ax: boolean;
  onWindow: (d: ProgressWindowDays) => void;
  onGrouping: (g: ProgressGrouping) => void;
  onCalendar: () => void;
  onTime: () => void;
  onHow: () => void;
  onMuscle: (group: string) => void;
  onWorkout: (sessionId: string) => void;
}) {
  const theme = useTheme();
  const { activity, muscles, records } = view;
  return (
    <View style={{ gap: theme.space['5'] }}>
      <WindowPicker days={home.days} datesLine={view.datesLine} datesWords={view.datesLine.replace('–', 'to')} onChange={onWindow} />

      <View style={{ gap: theme.space['2'] }}>
        <Pressable accessibilityRole="button" accessibilityLabel={activity.cardWords} onPress={onCalendar}>
          <Card>
            <View style={{ gap: theme.space['4'] }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
              <StatStrip items={activity.stats.map((s) => ({ value: s.value, label: s.label }))} accessibilityLabel={activity.statsWords} ax={ax} />
              <ActivityBars bars={activity.bars} />
              <AppText variant="callout" color="text.secondary" numeric>
                {activity.comparison}
              </AppText>
              {activity.lastWorkout !== null ? (
                <AppText variant="callout" color="text.secondary" numeric>
                  {activity.lastWorkout}
                </AppText>
              ) : null}
            </View>
          </Card>
        </Pressable>
        {activity.footnote !== null ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${activity.footnote}. Shows what was left out.`}
            onPress={onTime}
            style={{ minHeight: theme.target.min.height, flexDirection: 'row', alignItems: 'center', gap: theme.space['2'] }}
          >
            <Icon name="info.circle" color="text.secondary" size={16} />
            <AppText variant="callout" color="text.secondary" numeric>
              {activity.footnote}
            </AppText>
          </Pressable>
        ) : null}
      </View>

      <View style={{ gap: theme.space['3'] }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space['1'] }}>
          <AppText variant="sectionLabel" color="text.tertiary" accessibilityRole="header">
            MUSCLES
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
          selected={home.grouping}
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
            {muscles.rows.map((r) => (
              <FrequencyRow
                key={r.key}
                row={r}
                perWeek={false}
                hint="Opens Muscles"
                onPress={() => {
                  onMuscle(r.key);
                }}
              />
            ))}
          </View>
        )}
        {muscles.noMusclesLine !== null ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${muscles.noMusclesLine}. Opens Muscles.`}
            onPress={() => {
              onMuscle('');
            }}
            style={{ minHeight: theme.target.min.height, justifyContent: 'center' }}
          >
            <AppText variant="callout" color="text.secondary">{`${muscles.noMusclesLine} ›`}</AppText>
          </Pressable>
        ) : null}
      </View>

      <View style={{ gap: theme.space['2'] }}>
        <AppText variant="sectionLabel" color="text.tertiary" accessibilityRole="header">
          RECORDS
        </AppText>
        {records.empty !== null ? (
          <AppText variant="callout" color="text.secondary">
            {records.empty}
          </AppText>
        ) : (
          records.items.map((r) => (
            <Pressable
              key={`${r.sessionId}:${r.exerciseId}`}
              accessibilityRole="button"
              accessibilityLabel={r.words}
              accessibilityHint="Opens the workout"
              onPress={() => {
                onWorkout(r.sessionId);
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
      </View>

      {home.unreadable > 0 ? (
        <StatusLine icon="exclamationmark.triangle" tone="warning" text={`${String(home.unreadable)} ${home.unreadable === 1 ? 'workout couldn’t be read and isn’t' : 'workouts couldn’t be read and aren’t'} counted.`} />
      ) : null}
    </View>
  );
}

function EmptyState({ hasResume }: { hasResume: boolean }) {
  const theme = useTheme();
  const navigation = useNavigation();
  const toToday = () => {
    navigation.navigate('Tabs', { screen: 'Today' });
  };
  const toImport = () => {
    navigation.navigate('Tabs', { screen: 'Profile', params: { screen: 'ImportIntro', initial: false } });
  };
  return (
    <Card>
      <View style={{ gap: theme.space['3'] }}>
        <AppText variant="headline">Nothing to show yet</AppText>
        <AppText variant="body" color="text.secondary">
          Log a workout or import your FitNotes history.
        </AppText>
        {/* With the ResumeBar showing, its Resume is the one accent-filled button. */}
        {hasResume ? <SecondaryButton label="Go to Today" onPress={toToday} /> : <PrimaryButton label="Go to Today" onPress={toToday} />}
        <SecondaryButton label="Import FitNotes history" onPress={toImport} />
      </View>
    </Card>
  );
}

function Placeholder() {
  const theme = useTheme();
  const block = (h: number) => <View style={{ height: h, borderRadius: theme.radius.md, backgroundColor: theme.colors['bg.raised'] }} />;
  return (
    <View style={{ gap: theme.space['5'] }} accessible accessibilityLabel="Loading">
      {block(44)}
      {block(180)}
      {block(260)}
    </View>
  );
}
