import { useNavigation } from '@react-navigation/native';
import { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';

import { ACTIVITY_COPY, toMs, type DateRange, type ProgressHomeView, type RecordView } from '@fizz/domain';
import type { ProgressGrouping, ProgressPeriodKey } from '@fizz/schemas';

import { newUuid } from '../../device/runtime';
import { activitySavedToast } from '../../activity/activity-toast';
import { DeleteToastView } from '../../history/DeleteToastView';
import { useDeleteToast, type ToastState } from '../../history/useDeleteToast';
import { runCountIt, type CountItToast } from '../../progress/count-it';
import { consistencyCardView, type ConsistencyCardView } from '../../progress/consistency-view';
import { ActivityChart, FrequencyHeader, FrequencyRow, FrequencySubRows, PeriodPicker, ResumeBar, Segmented, useAx } from '../../progress/components';
import type { ProgressHome } from '../../services/progress-service';
import { useDataChanged, useScreenData, useServices } from '../../shell/context';
import { useTheme } from '../../theme';
import { AppText, Card, Icon, PrimaryButton, SecondaryButton, StatStrip, StatusLine, TextButton, Toast } from '../../ui';
import { AskPill } from '../coach/AskPill';
import { CalendarView } from './CalendarView';
import { unreadableText } from '../../progress/copy';
import { ExercisesTab, type ExercisesFocus } from './ExercisesTab';
import { HowCountedSheet, TimeSheet } from './sheets';

/**
 * Progress home (progress.md v1.0 slice A, §2.2): one period drives every
 * card; Activity (sessions, time, bars), Muscles (Body parts | Push/Pull/
 * Legs; D2: parents that open to sub-rows), Records; `Activity | Exercises |
 * Calendar` (Ben, 13–14 Oct 2026). Local data only: identical offline
 * and with no coach (check 20). The screen lays out the service's view model
 * and computes nothing.
 */

type Toasted = CountItToast | null;

export function ProgressScreen() {
  const theme = useTheme();
  const navigation = useNavigation();
  const services = useServices();
  const changed = useDataChanged();
  const ax = useAx();
  const [segment, setSegment] = useState<'activity' | 'exercises' | 'calendar'>('activity');
  const [month, setMonth] = useState<string | null>(null);
  const [calendarSeen, setCalendarSeen] = useState(false);
  const [exercisesSeen, setExercisesSeen] = useState(false);
  // A record tap opens the Exercises tab on that exercise and workout (review S3); `n` makes a repeat tap re-open it.
  const [exercisesFocus, setExercisesFocus] = useState<ExercisesFocus | null>(null);
  // No local window or grouping: the service holds the one shared choice, so home and Muscles never disagree (check 15).
  const [data, reload] = useScreenData((s) => s.progress.home());
  // Plan tracker v1 (19 Oct): the last 8 weeks against Ben's days-a-week aim, and his plan's days this week.
  const [consistencyData] = useScreenData((s) => s.plans.consistency());
  const [timeOpen, setTimeOpen] = useState(false);
  const [howOpen, setHowOpen] = useState(false);
  const [toast, setToast] = useState<Toasted>(null);
  const [placeholder, setPlaceholder] = useState(false);
  const [toastHeight, setToastHeight] = useState(0);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlight = useRef(new Set<string>());
  // A workout deleted from a Summary opened here comes back with Undo (delete-workouts DW1).
  const deleted = useDeleteToast();
  const toastShown = toast !== null || deleted.toast !== null;

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

  const change = (patch: { period?: ProgressPeriodKey; grouping?: ProgressGrouping }) => {
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
            { key: 'activity', label: 'Activity' },
            { key: 'exercises', label: 'Exercises' },
            { key: 'calendar', label: 'Calendar' },
          ]}
          selected={segment}
          onSelect={(k) => {
            if (k === 'calendar') setCalendarSeen(true);
            if (k === 'exercises') setExercisesSeen(true);
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
    // Every segment stays mounted once seen, so each keeps its place (selected day, exercise, scroll) (§3.5).
    body = (
      <>
        {exercisesSeen || segment === 'exercises' ? (
          <View style={segment === 'exercises' ? null : { display: 'none' }}>
            <ExercisesTab focus={exercisesFocus} />
          </View>
        ) : null}
        {calendarSeen || segment === 'calendar' ? (
          <View style={segment === 'calendar' ? null : { display: 'none' }}>
            <CalendarView
              month={month}
              onMonth={(m) => {
                setMonth(m);
              }}
              onActivitySaved={(saved) => {
                // (review B2) Calendar edits and deletes get Today's toast with Undo (the delete toast's timing and VoiceOver close).
                const show = (t: ToastState | null) => {
                  if (t === null) deleted.dismiss();
                  else deleted.show(t);
                };
                deleted.show(activitySavedToast(saved, { undo: services.activities.undo, newOpId: newUuid, changed, show }));
              }}
            />
          </View>
        ) : null}
        <View style={segment === 'activity' ? { gap: theme.space['5'] } : { display: 'none' }}>
      {consistencyData.state === 'ready' && consistencyData.value !== null ? <ConsistencyCard ax={ax} view={consistencyCardView(consistencyData.value, home.today)} /> : null}
      <Overview
        home={home}
        view={home.view}
        ax={ax}
        onPeriod={(period) => {
          change({ period });
        }}
        onCustom={(r) => {
          services.progress.choosePeriod(r);
          reload();
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
        onMuscles={() => {
          navigation.navigate('Tabs', { screen: 'Progress', params: { screen: 'ProgressMuscles', params: { group: '' } } });
        }}
        onRecord={(r) => {
          setExercisesFocus((f) => ({ exerciseId: r.exerciseId, sessionId: r.sessionId, sessionExerciseId: r.sessionExerciseId, n: (f?.n ?? 0) + 1 }));
          setExercisesSeen(true);
          setSegment('exercises');
        }}
      />
        </View>
      </>
    );
  }

  const period = home?.period ?? null;
  const range = home?.range ?? null;
  return (
    <View style={{ flex: 1, backgroundColor: theme.colors['bg.canvas'] }}>
      {/* Everything that floats (Ask, toast) lives in this area, which ends above the ResumeBar, so the bar never covers them (review S1). */}
      <View style={{ flex: 1 }}>
        <ScrollView
          contentInsetAdjustmentBehavior="automatic"
          // Design pass 6.2: one tap on a search result opens it; a drag hides the keyboard.
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          contentContainerStyle={{ paddingHorizontal: theme.components.screenMargin, paddingTop: theme.space['4'], paddingBottom: theme.space['8'] + 56 + (toastShown ? toastHeight : 0), gap: theme.space['5'] }}
        >
          {header}
          {body}
        </ScrollView>
        <AskPill
          bottom={theme.space['4'] + (toastShown ? toastHeight : 0)}
          onPress={() => {
            navigation.navigate('Coach', { entry: period === null ? { kind: 'today' } : { kind: 'progress', period, ...(range === null ? {} : { range }) } });
          }}
        />
        {toastShown ? (
          <View
            style={{ position: 'absolute', left: 0, right: 0, bottom: 0 }}
            onLayout={(e) => {
              setToastHeight(e.nativeEvent.layout.height);
            }}
          >
            {deleted.toast ? (
              <DeleteToastView state={deleted} {...(deleted.toast.text === ACTIVITY_COPY.saved ? { icon: 'checkmark.circle.fill' as const } : {})} />
            ) : toast ? (
              <Toast icon="info.circle" text={toast.text} {...(toast.action ? { action: toast.action } : {})} {...(toast.onAction ? { onAction: toast.onAction } : {})} />
            ) : null}
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
            navigation.navigate('Summary', { sessionId: r.sessionId, back: true, editTimes: true });
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

function Overview({
  home,
  view,
  ax,
  onPeriod,
  onCustom,
  onGrouping,
  onCalendar,
  onTime,
  onHow,
  onMuscles,
  onRecord,
}: {
  home: ProgressHome;
  view: Extract<ProgressHomeView, { dataState: 'normal' }>;
  ax: boolean;
  onPeriod: (p: ProgressPeriodKey) => void;
  onCustom: (r: DateRange) => void;
  onGrouping: (g: ProgressGrouping) => void;
  onCalendar: () => void;
  onTime: () => void;
  onHow: () => void;
  onMuscles: () => void;
  onRecord: (r: RecordView) => void;
}) {
  const theme = useTheme();
  const { activity, muscles, records } = view;
  // `All records (n) ›` lists the rest in place (§2.2 region 5).
  // Expanded for one window only: a window change shows 3 again (review progress-B r2 N3).
  const windowKey = `${view.window.from}:${view.window.to}`;
  const [recordsAllFor, setRecordsAllFor] = useState<string | null>(null);
  const recordsAll = recordsAllFor === windowKey;
  const recordRows = recordsAll ? records.items : records.items.slice(0, records.initial);
  // D2: parents only; a row opens to its sub-rows in place.
  const [openRows, setOpenRows] = useState<ReadonlySet<string>>(new Set());
  return (
    <View style={{ gap: theme.space['5'] }}>
      <PeriodPicker
        period={home.period}
        custom={home.range !== null}
        today={home.today}
        earliest={home.earliest}
        current={view.window}
        datesLine={view.datesLine}
        datesWords={view.datesWords}
        onPreset={onPeriod}
        onCustom={onCustom}
      />

      <View style={{ gap: theme.space['2'] }}>
        <Pressable accessibilityRole="button" accessibilityLabel={activity.cardWords} onPress={onCalendar}>
          <Card>
            <View style={{ gap: theme.space['4'] }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
              <StatStrip items={activity.stats.map((s) => ({ value: s.value, label: s.label, ...(s.note !== undefined ? { note: s.note } : {}) }))} accessibilityLabel={activity.statsWords} ax={ax} />
              <ActivityChart chart={activity.chart} />
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
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${muscles.noMusclesLine}. Opens Muscles.`}
            onPress={onMuscles}
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
          recordRows.map((r) => (
            <Pressable
              key={r.key}
              accessibilityRole="button"
              accessibilityLabel={r.words}
              accessibilityHint="Opens the exercise"
              onPress={() => {
                onRecord(r);
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
        {!recordsAll && records.more !== null ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={records.more.words}
            accessibilityHint="Lists every record"
            onPress={() => {
              setRecordsAllFor(windowKey);
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

      {home.unreadable > 0 ? (
        <StatusLine icon="exclamationmark.triangle" tone="warning" text={unreadableText(home.unreadable)} />
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
    navigation.navigate('Tabs', { screen: 'Profile', params: { screen: 'ImportHistory', initial: false } });
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
