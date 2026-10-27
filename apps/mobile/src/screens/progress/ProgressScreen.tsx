import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import { useEffect, useRef, useState } from 'react';
import { ScrollView, View } from 'react-native';

import { ACTIVITY_COPY, offsetHolding, toMs, type ActivityView, type PeriodSpan } from '@fizz/domain';

import { newUuid } from '../../device/runtime';
import { activitySavedToast } from '../../activity/activity-toast';
import { DeleteToastView } from '../../history/DeleteToastView';
import { useDeleteToast, type ToastState } from '../../history/useDeleteToast';
import { runCountIt, type CountItToast } from '../../progress/count-it';
import { ResumeBar, Segmented } from '../../progress/components';
import { PeriodBar } from '../../progress/PeriodBar';
import { useReloadOn } from '../../progress/use-reload-on';
import type { ProgressStackParams } from '../../navigation/types';
import type { PeriodChoice, ProgressShell } from '../../services/progress-service';
import { useDataChanged, useScreenData, useServices } from '../../shell/context';
import { useTheme } from '../../theme';
import { AppText, Card, PrimaryButton, SecondaryButton, StatusLine, TextButton, Toast } from '../../ui';
import { AskPill } from '../coach/AskPill';
import type { ActivitySaved } from '../activity/ActivitySheet';
import { HealthTrends } from './HealthTrends';
import { BodyweightCard } from './BodyweightCard';
import { ExercisesTab } from './ExercisesTab';
import { TrainingTab } from './TrainingTab';
import { HowCountedSheet, TimeSheet } from './sheets';

/**
 * Progress (redesign v3 C, Ben 27 Oct): looking back. `Progress` with `All workouts` top right; `Lifts | Training |
 * Body`; under them one period bar `Week | Month | 3M | 6M | 1Y` with `‹ ›` that every tab follows (default Month).
 * The plan's This week card and Coach's changes live in Library now; the Overview tab and the Calendar segment are
 * replaced by Training's Month view. Local data only: identical offline and with no coach. The screen lays out the
 * services' view models and computes nothing.
 */

type Tab = 'lifts' | 'training' | 'body';
type Toasted = CountItToast | null;

const TABS: readonly { key: Tab; label: string }[] = [
  { key: 'lifts', label: 'Lifts' },
  { key: 'training', label: 'Training' },
  { key: 'body', label: 'Body' },
];

export function ProgressScreen() {
  const theme = useTheme();
  const navigation = useNavigation();
  const services = useServices();
  const changed = useDataChanged();
  const [tab, setTab] = useState<Tab>('lifts');
  const [seen, setSeen] = useState<ReadonlySet<Tab>>(new Set<Tab>(['lifts']));
  const [choice, setChoice] = useState<PeriodChoice>({ span: 'month', offset: 0 });
  // (Perf, Ben 26 Oct) The shell (is there history, the period bar, the ResumeBar) always; each tab reads only while it shows.
  const [shellData, reloadShell] = useScreenData((s) => s.progress.shell(choice));
  useReloadOn(`${choice.span}:${String(choice.offset)}`, reloadShell);
  const [timeSheet, setTimeSheet] = useState<ActivityView['sheet'] | null>(null);
  const [howOpen, setHowOpen] = useState(false);
  const [toast, setToast] = useState<Toasted>(null);
  const [placeholder, setPlaceholder] = useState(false);
  const [toastHeight, setToastHeight] = useState(0);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlight = useRef(new Set<string>());
  // A workout deleted from a Summary opened here comes back with Undo (delete-workouts DW1).
  const deleted = useDeleteToast();
  const toastShown = toast !== null || deleted.toast !== null;
  const route = useRoute<RouteProp<ProgressStackParams, 'ProgressHome'>>();
  const scroll = useRef<ScrollView>(null);
  // Today's old `Reviews ›` link still lands here, at the top (reviews moved to Library, redesign v3 C5).
  const focusN = route.params?.focus === 'reviews' ? (route.params.n ?? 0) : null;
  useEffect(() => {
    if (focusN === null) return;
    scroll.current?.scrollTo({ y: 0, animated: false });
  }, [focusN]);

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
  const hide = () => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast(null);
  };
  const reload = () => {
    changed();
    reloadShell();
  };
  const countDeps = {
    confirm: (req: { sessionId: string; expectedVersion: number; opId: string }) => services.progress.confirmDuration(req),
    undo: (req: { sessionId: string; expectedVersion: number; opId: string }) => services.progress.undoConfirmDuration(req),
    newId: newUuid,
    closeSheet: () => {
      setTimeSheet(null);
    },
    show,
    hide,
    reload,
  };
  const activitySaved = (saved: ActivitySaved) => {
    // (review B2) Calendar edits and deletes get Today's toast with Undo (the delete toast's timing and VoiceOver close).
    const showDeleted = (t: ToastState | null) => {
      if (t === null) deleted.dismiss();
      else deleted.show(t);
    };
    deleted.show(activitySavedToast(saved, { undo: services.activities.undo, newOpId: newUuid, changed, show: showDeleted }));
  };

  const shell: ProgressShell | null = shellData.state === 'ready' ? shellData.value : null;
  const resume = shell?.resume ?? null;
  const bar = shell?.bar ?? null;
  const dates = bar === null ? null : { from: bar.window.from, to: bar.window.to };

  const pickTab = (k: Tab) => {
    setSeen((s) => (s.has(k) ? s : new Set([...s, k])));
    setTab(k);
  };
  const onSpan = (span: PeriodSpan) => {
    // A span change keeps the place (Week after stepping back to September shows September's last week).
    setChoice({ span, offset: shell === null || bar === null ? 0 : offsetHolding(shell.today, span, bar.window.to) });
  };
  const onStep = (by: -1 | 1) => {
    if (bar === null || (by < 0 && !bar.canBack) || (by > 0 && !bar.canForward)) return;
    setChoice((c) => ({ span: c.span, offset: Math.min(0, c.offset + by) }));
  };
  const openList = (month: string | null) => {
    navigation.navigate('Tabs', { screen: 'Progress', params: { screen: 'ProgressHistory', params: month === null ? {} : { month } } });
  };

  const header = (
    <View style={{ gap: theme.space['4'] }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: theme.target.min.height }}>
        <AppText variant="title1" accessibilityRole="header">
          Progress
        </AppText>
        <TextButton
          label="All workouts"
          onPress={() => {
            openList(null);
          }}
        />
      </View>
      {shell?.hasData === true && bar !== null ? (
        <>
          <Segmented options={TABS} selected={tab} onSelect={pickTab} label="Progress" />
          <PeriodBar bar={bar} onSpan={onSpan} onStep={onStep} />
        </>
      ) : null}
    </View>
  );

  let body: React.ReactNode;
  if (shellData.state === 'error') {
    body = (
      <StatusLine
        icon="exclamationmark.triangle"
        tone="warning"
        text="Couldn’t open your training data."
        info={shellData.message}
        infoLabel="Error details"
        action={
          <View style={{ flexDirection: 'row', gap: theme.space['3'] }}>
            <TextButton label="Try again" onPress={reloadShell} />
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
  } else if (shell === null || bar === null || dates === null) {
    // Loading: grey blocks after the delay. Ready with no profile: the empty state, never a blank page (review N3).
    body = shellData.state === 'loading' ? placeholder ? <Placeholder /> : null : <EmptyState hasResume={false} />;
  } else if (!shell.hasData) {
    body = <EmptyState hasResume={resume !== null} />;
  } else {
    // Every tab stays mounted once seen, so each keeps its place (selected exercise, day, scroll) (§3.5).
    body = (
      <>
        <View style={tab === 'lifts' ? null : { display: 'none' }}>
          <ExercisesTab active={tab === 'lifts'} shared={{ period: bar.preset, range: dates }} />
        </View>
        {seen.has('training') ? (
          <View style={tab === 'training' ? null : { display: 'none' }}>
            <TrainingTab
              choice={choice}
              active={tab === 'training'}
              onMonthList={openList}
              onTime={setTimeSheet}
              onHow={() => {
                setHowOpen(true);
              }}
              onMuscles={() => {
                navigation.navigate('Tabs', { screen: 'Progress', params: { screen: 'ProgressMuscles', params: { group: '' } } });
              }}
              onActivitySaved={activitySaved}
            />
          </View>
        ) : null}
        {seen.has('body') ? (
          <View style={tab === 'body' ? { gap: theme.space['5'] } : { display: 'none' }}>
            <BodyweightCard active={tab === 'body'} window={dates} />
            {/* (Ben, 27 Oct, Q8) Resting heart rate and sleep from Apple Health, raw and labelled; nothing while off. */}
            {tab === 'body' ? <HealthTrends window={dates} /> : null}
          </View>
        ) : null}
      </>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors['bg.canvas'] }}>
      {/* Everything that floats (Ask, toast) lives in this area, which ends above the ResumeBar, so the bar never covers them (review S1). */}
      <View style={{ flex: 1 }}>
        <ScrollView
          ref={scroll}
          contentInsetAdjustmentBehavior="automatic"
          // Design pass 6.2: one tap on a search result opens it; a drag hides the keyboard.
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          // (27 Oct) The Lifts search and `Other` fields scroll above the keyboard.
          automaticallyAdjustKeyboardInsets
          contentContainerStyle={{ paddingHorizontal: theme.components.screenMargin, paddingTop: theme.space['4'], paddingBottom: theme.space['8'] + 56 + (toastShown ? toastHeight : 0), gap: theme.space['5'] }}
        >
          {header}
          {body}
        </ScrollView>
        <AskPill
          bottom={theme.space['4'] + (toastShown ? toastHeight : 0)}
          onPress={() => {
            navigation.navigate('Coach', { entry: bar === null ? { kind: 'today' } : { kind: 'progress', period: bar.preset, range: { from: bar.window.from, to: bar.window.to } } });
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
      {timeSheet !== null ? (
        <TimeSheet
          visible
          sheet={timeSheet}
          onClose={() => {
            setTimeSheet(null);
          }}
          onCount={(r) => {
            void runCountIt(r, countDeps, inFlight.current);
          }}
          onEdit={(r) => {
            setTimeSheet(null);
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
