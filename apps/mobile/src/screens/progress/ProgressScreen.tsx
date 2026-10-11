import { useNavigation } from '@react-navigation/native';
import { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';

import { toMs, type ProgressHomeView } from '@fizz/domain';
import type { ProgressGrouping, ProgressWindowDays } from '@fizz/schemas';

import { newUuid } from '../../device/runtime';
import { runCountIt, type CountItToast } from '../../progress/count-it';
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

type Toasted = CountItToast | null;

export function ProgressScreen() {
  const theme = useTheme();
  const navigation = useNavigation();
  const services = useServices();
  const ax = useAx();
  const [segment, setSegment] = useState<'overview' | 'calendar'>('overview');
  const [month, setMonth] = useState<string | null>(null);
  const [calendarSeen, setCalendarSeen] = useState(false);
  // No local window or grouping: the service holds the one shared choice, so home and Muscles never disagree (check 15).
  const [data, reload] = useScreenData((s) => s.progress.home());
  const [timeOpen, setTimeOpen] = useState(false);
  const [howOpen, setHowOpen] = useState(false);
  const [toast, setToast] = useState<Toasted>(null);
  const [placeholder, setPlaceholder] = useState(false);
  const [toastHeight, setToastHeight] = useState(0);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlight = useRef(new Set<string>());

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
    // The choice is shared the moment it's made; reload again once saved (a failed save falls back to the saved setting).
    const saved = services.progress.saveSettings(patch);
    reload();
    void saved.then(reload);
  };

  const hide = () => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast(null);
  };

  const countDeps = {
    confirm: (req: { sessionId: string; expectedVersion: number; opId: string }) => services.progress.confirmDuration(req),
    undo: (req: { sessionId: string; expectedVersion: number; opId: string }) => services.progress.undoConfirmDuration(req),
    newId: newUuid,
    closeSheet: () => {
      setTimeOpen(false);
    },
    show,
    hide,
    reload,
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
          onSelect={(k) => {
            if (k === 'calendar') setCalendarSeen(true);
            setSegment(k);
          }}
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
    // Loading: grey blocks after the delay. Ready with no profile: the empty state, never a blank page (review N3).
    body = data.state === 'loading' ? (placeholder ? <Placeholder /> : null) : <EmptyState hasResume={false} />;
  } else if (home.view.dataState === 'empty') {
    body = <EmptyState hasResume={resume !== null} />;
  } else {
    // Both segments stay mounted once seen, so each keeps its place (selected day, scroll) on `Overview ⇄ Calendar` (§3.5).
    body = (
      <>
        {calendarSeen || segment === 'calendar' ? (
          <View style={segment === 'calendar' ? null : { display: 'none' }}>
            <CalendarView
              month={month}
              onMonth={(m) => {
                setMonth(m);
              }}
            />
          </View>
        ) : null}
        <View style={segment === 'overview' ? null : { display: 'none' }}>
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
          setCalendarSeen(true);
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
        </View>
      </>
    );
  }

  const days = home?.days ?? null;
  return (
    <View style={{ flex: 1, backgroundColor: theme.colors['bg.canvas'] }}>
      {/* Everything that floats (Ask, toast) lives in this area, which ends above the ResumeBar, so the bar never covers them (review S1). */}
      <View style={{ flex: 1 }}>
        <ScrollView
          contentInsetAdjustmentBehavior="automatic"
          contentContainerStyle={{ paddingHorizontal: theme.components.screenMargin, paddingTop: theme.space['4'], paddingBottom: theme.space['8'] + 56 + (toast ? toastHeight : 0), gap: theme.space['5'] }}
        >
          {header}
          {body}
        </ScrollView>
        <AskPill
          bottom={theme.space['4'] + (toast ? toastHeight : 0)}
          onPress={() => {
            navigation.navigate('Coach', { entry: days === null ? { kind: 'today' } : { kind: 'progress', days } });
          }}
        />
        {toast ? (
          <View
            style={{ position: 'absolute', left: 0, right: 0, bottom: 0 }}
            onLayout={(e) => {
              setToastHeight(e.nativeEvent.layout.height);
            }}
          >
            <Toast icon="info.circle" text={toast.text} {...(toast.action ? { action: toast.action } : {})} {...(toast.onAction ? { onAction: toast.onAction } : {})} />
          </View>
        ) : null}
      </View>
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
            void runCountIt(r, countDeps, inFlight.current);
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
      <WindowPicker days={home.days} datesLine={view.datesLine} datesWords={view.datesWords} onChange={onWindow} />

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
              key={r.key}
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
