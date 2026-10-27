import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import { useEffect, useMemo, useState } from 'react';
import { ActionSheetIOS, Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { FEED_FILTERS, HISTORY_COPY, type FeedFilter, type FeedItem, type FeedWeek } from '@fizz/domain';
import type { Activity } from '@fizz/schemas';

import { activitySavedToast, type ActivitySaved } from '../../activity/activity-toast';
import { deleteToolbarLabel, pastRowDetail, pastRowOpens, pastRowTitle, recentlyDeletedFooter, rowCustomActions, selectRowLabel, unreadableLine } from '../../history/delete-view';
import { DeleteToastView } from '../../history/DeleteToastView';
import { HEALTH_COPY } from '../../health/health-view';
import { historyFeedFrom, historyRowTitle, historyTitle, historyView, historyWorkoutLine } from '../../history/history-view';
import type { ProgressStackParams } from '../../navigation/types';
import { useDeleteToast } from '../../history/useDeleteToast';
import { useSelectDelete } from '../../history/useSelectDelete';
import { newUuid } from '../../device/runtime';
import { Segmented } from '../../progress/components';
import type { RepeatCandidate } from '../../services/workout-services';
import { useDataChanged, useScreenData, useServices } from '../../shell/context';
import { TIMING, useTheme } from '../../theme';
import { AppText, DangerTextButton, Group, Icon, Row, Screen, SelectionToolbar, SelectRow, StatusLine, TextButton, Toast, ToastHost, toastBottom } from '../../ui';
import { LIBRARY_COPY_UI } from '../../workout/library-view';
import { useSaveToWorkouts } from '../routines/SaveWorkoutSheet';
import { ActivitySheet } from '../activity/ActivitySheet';
import { LogPastWorkoutSheet } from '../workout/LogPastWorkoutSheet';
import { PAST_LOG_COPY } from '../../workout/past-log-view';

/**
 * History (docs/design/history.md; Ben, 26 Oct: "the app isn't very good at showing recent activity beyond the last
 * couple of days"). Everything Ben did, workouts and activities merged, newest first, grouped by Monday-first week
 * (`This week`, `Last week`, `13–19 Oct`) with each week's tiny total; `All · Workouts · Activities`; `Show more`
 * loads older weeks. Opened from Today's `All history ›`, Library › Workouts and Progress's `All workouts` (redesign v3
 * C6: titled `All workouts`, list only, back to Progress) or Training's `October workouts ›` (that month only).
 *
 * It is the old Past workouts list grown, so every capability stays (delete-workouts §2.3, routines §A2.6): a
 * workout opens Repeat (one with nothing logged its Summary); `Select` → tick → `Delete (n)` → one confirm sheet →
 * one all-or-nothing write → toast with Undo (select mode lists workouts only); VoiceOver `Delete` on each workout
 * row; `⋯` → `Save to Workouts`; `Log a past workout`; `Recently deleted (n) ›`. An activity opens its sheet (edit,
 * delete, Undo toast).
 */
export function HistoryScreen() {
  const navigation = useNavigation();
  const services = useServices();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  // The oldest Monday loaded; `Show more` moves it back (whole weeks, a long gap skipped).
  const [from, setFrom] = useState<string | undefined>(undefined);
  const [filter, setFilter] = useState<FeedFilter>('all');
  // (Redesign v3 C3) Training's `October workouts ›`: that month only.
  const route = useRoute<RouteProp<ProgressStackParams, 'ProgressHistory'>>();
  const month = route.params?.month ?? null;
  const [data, reload] = useScreenData(async (s) => {
    const start = historyFeedFrom(month, from);
    return { feed: await s.history.feed(start === undefined ? {} : { from: start }), deleted: await s.history.recentlyDeletedCount() };
  });
  const toast = useDeleteToast();
  const tz = services.now().tz;
  // Kept while the page is the same: select mode keeps its ticks across renders.
  const rows = useMemo(() => (data.state === 'ready' ? historyView(data.value.feed, 'workouts', true, month).selectable : NO_ROWS), [data, month]);
  const sel = useSelectDelete({ rows, loaded: data.state === 'ready', title: historyTitle(month, data.state === 'ready' ? data.value.feed.today : ''), reload, toast });
  const { selecting, selected, line } = sel;
  const changed = useDataChanged();
  const [saveToast, setSaveToast] = useState<{ text: string; action?: string; onAction?: () => void } | null>(null);
  const [pastLog, setPastLog] = useState(false);
  const [editing, setEditing] = useState<Activity | null>(null);
  useEffect(() => {
    if (!saveToast) return;
    const t = setTimeout(() => {
      setSaveToast(null);
    }, TIMING.undoToast);
    return () => {
      clearTimeout(t);
    };
  }, [saveToast]);
  const save = useSaveToWorkouts(
    (made) => {
      changed();
      setSaveToast({
        text: LIBRARY_COPY_UI.savedToWorkouts,
        action: LIBRARY_COPY_UI.undo,
        onAction: () => {
          setSaveToast(null);
          void services.routines.remove({ routineId: made.id, expectedVersion: made.version, opId: newUuid() }).then((u) => {
            changed();
            if (!u.ok) setSaveToast({ text: u.message });
          });
        },
      });
    },
    () => {
      setSaveToast({ text: LIBRARY_COPY_UI.nothingToSave });
    },
  );

  // The same toast with Undo as Today's and the calendar's (review B2).
  function activitySaved(saved: ActivitySaved) {
    setEditing(null);
    changed();
    reload();
    setSaveToast(activitySavedToast(saved, { undo: services.activities.undo, newOpId: newUuid, changed, show: setSaveToast }));
  }

  if (data.state === 'loading') return <Screen>{null}</Screen>;
  if (data.state === 'error') {
    return (
      <Screen>
        <StatusLine icon="exclamationmark.triangle" tone="warning" text="Couldn’t read your history." detail={data.message} action={<TextButton label="Try again" onPress={reload} />} />
      </Screen>
    );
  }
  const { feed, deleted } = data.value;
  const view = historyView(feed, filter, selecting, month);
  const footer = recentlyDeletedFooter(deleted);

  /** One-tap Link (Ben, 27 Oct): linked at once, rows merge, `Linked · Undo`. */
  async function linkNow(healthUuid: string, sessionId: string) {
    const r = await services.health.link({ healthUuid, sessionId, opId: newUuid() });
    changed();
    reload();
    if (!r.ok) {
      setSaveToast({ text: r.message });
      return;
    }
    setSaveToast({
      text: HEALTH_COPY.linked,
      action: HEALTH_COPY.undo,
      onAction: () => {
        setSaveToast(null);
        void services.health.unlink({ healthUuid: r.healthUuid, expectedVersion: r.version, opId: newUuid() }).then((u) => {
          changed();
          reload();
          if (!u.ok) setSaveToast({ text: u.message });
        });
      },
    });
  }

  const workoutRow = (item: Extract<FeedItem, { kind: 'workout' }>, c: RepeatCandidate) =>
    selecting ? (
      <SelectRow
        key={item.key}
        title={pastRowTitle(c, tz)}
        lines={[pastRowDetail(c)]}
        selected={selected.has(c.sessionId)}
        accessibilityLabel={selectRowLabel(c, tz, selected.has(c.sessionId))}
        onToggle={() => {
          sel.toggle(c.sessionId);
        }}
      />
    ) : (
      // Design pass 6.7: the `⋯` is the row's trailing control (beside the tap target, no chevron); names on one line.
      <Row
        key={item.key}
        title={historyRowTitle(item, c, tz)}
        subtitle={c.exerciseNames.join(', ')}
        subtitleLines={1}
        secondLine={historyWorkoutLine(item, c)}
        // (ADR 0035) A linked watch workout: one row, with a small mark naming its source.
        {...(item.linkedSource !== undefined ? { tag: { icon: 'heart.fill' as const, color: 'text.secondary' as const, text: item.linkedSource, accessibilityLabel: `linked to ${item.linkedSource} activity` } } : {})}
        actions={rowCustomActions('past')}
        onAction={() => {
          sel.removeOne(c);
        }}
        onPress={() => {
          if (pastRowOpens(c) === 'summary') navigation.navigate('Summary', { sessionId: c.sessionId, back: true });
          else navigation.navigate('Repeat', { sessionId: c.sessionId });
        }}
        trailing={
          // `⋯` → `Save to Workouts` (routines.md §A2.6): what was done, loads Auto.
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`More, ${pastRowTitle(c, tz)}`}
            accessibilityActions={[{ name: LIBRARY_COPY_UI.saveToWorkouts, label: LIBRARY_COPY_UI.saveToWorkouts }]}
            onAccessibilityAction={() => void save.open({ kind: 'session', sessionId: c.sessionId }, null)}
            onPress={() => {
              const options = [LIBRARY_COPY_UI.saveToWorkouts, LIBRARY_COPY_UI.cancel];
              ActionSheetIOS.showActionSheetWithOptions({ title: pastRowTitle(c, tz), options, cancelButtonIndex: 1 }, (i) => {
                if (i === 0) void save.open({ kind: 'session', sessionId: c.sessionId }, null);
              });
            }}
            style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}
          >
            <Icon name="ellipsis" color="text.secondary" />
          </Pressable>
        }
      />
    );

  const week = (w: FeedWeek) => (
    <View key={w.monday} style={{ gap: theme.space['2'] }}>
      {/* The week and its tiny total, read as one header. */}
      <View accessible accessibilityRole="header" accessibilityLabel={w.accessibilityLabel} style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'baseline', justifyContent: 'space-between', columnGap: theme.space['2'], marginTop: theme.space['2'] }}>
        <AppText variant="headline" numeric>
          {w.header}
        </AppText>
        <AppText variant="callout" color="text.secondary" numeric>
          {w.total}
        </AppText>
      </View>
      <Group>
        {w.items.map((item) => {
          if (item.kind === 'workout') {
            const c = feed.workouts[item.sessionId];
            return c === undefined ? null : workoutRow(item, c);
          }
          const linkTo = item.linkTo;
          return (
            <Row
              key={item.key}
              title={historyRowTitle(item, undefined, tz)}
              subtitle={item.value}
              {...(item.fromHealth !== undefined ? { icon: 'heart.fill' as const } : {})}
              onPress={() => {
                void services.activities.get(item.activityId).then((a) => {
                  if (a !== null) setEditing(a);
                });
              }}
              // (Ben, 27 Oct; TrainingPeaks-style) One tap links a Health strength workout to that day's gym workout; Undo.
              trailing={linkTo !== undefined ? <TextButton label={HEALTH_COPY.link} accessibilityLabel={`${HEALTH_COPY.link} to ${linkTo.title}`} onPress={() => void linkNow(item.activityId, linkTo.sessionId)} /> : null}
            />
          );
        })}
      </Group>
    </View>
  );

  return (
    <>
      <Screen>
        {!selecting ? <Segmented options={FEED_FILTERS} selected={filter} onSelect={setFilter} label={HISTORY_COPY.filter} /> : null}
        {/* (Ben, 25 Oct) A workout done on another day, entered now. */}
        {!selecting ? (
          <TextButton
            label={PAST_LOG_COPY.entry}
            icon="plus"
            onPress={() => {
              setPastLog(true);
            }}
          />
        ) : null}
        {line ? (
          <StatusLine
            icon={line.tone === 'warning' ? 'exclamationmark.triangle' : 'info.circle'}
            tone={line.tone}
            text={line.text}
            {...(line.retry ? { action: <TextButton label="Try again" onPress={line.retry} /> } : {})}
          />
        ) : null}
        {feed.unreadable > 0 ? (
          <StatusLine
            icon="exclamationmark.triangle"
            tone="warning"
            text={unreadableLine(feed.unreadable)}
            action={
              <TextButton
                label="Check data ›"
                tone="secondary"
                onPress={() => {
                  navigation.navigate('Tabs', { screen: 'Profile', params: { screen: 'DataBackup', initial: false } });
                }}
              />
            }
          />
        ) : null}
        {view.empty !== null ? <AppText variant="body">{view.empty}</AppText> : null}
        {view.weeks.map(week)}
        {view.more ? (
          <TextButton
            label={HISTORY_COPY.showMore}
            tone="secondary"
            onPress={() => {
              setFrom(feed.olderFrom ?? undefined);
              reload();
            }}
          />
        ) : null}
        {footer !== null && !selecting ? (
          <Group>
            <Row
              title={footer}
              onPress={() => {
                navigation.navigate('RecentlyDeleted');
              }}
            />
          </Group>
        ) : null}
      </Screen>
      {/* 0.6: one floating place for every toast, clear of the home indicator; the list never reflows. */}
      <ToastHost bottom={toastBottom({ footerHeight: null, insetBottom: insets.bottom, space2: theme.space['2'] })}>
        {toast.toast ? (
          <DeleteToastView state={toast} />
        ) : saveToast ? (
          <Toast icon="info.circle" text={saveToast.text} {...(saveToast.action ? { action: saveToast.action } : {})} {...(saveToast.onAction ? { onAction: saveToast.onAction } : {})} />
        ) : null}
      </ToastHost>
      {save.sheet}
      <ActivitySheet
        visible={editing !== null}
        activity={editing}
        onClose={() => {
          setEditing(null);
        }}
        onSaved={activitySaved}
      />
      <LogPastWorkoutSheet
        visible={pastLog}
        onClose={() => {
          setPastLog(false);
        }}
      />
      {selecting ? <SelectionToolbar trailing={<DangerTextButton label={deleteToolbarLabel(selected.size)} disabled={selected.size === 0} onPress={sel.confirmSelected} />} /> : null}
    </>
  );
}

const NO_ROWS: never[] = [];
