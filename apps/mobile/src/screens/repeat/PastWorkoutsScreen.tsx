import { useNavigation } from '@react-navigation/native';
import { useEffect, useState } from 'react';
import { ActionSheetIOS, Pressable } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { deleteToolbarLabel, pastRowDetail, pastRowOpens, pastRowTitle, recentlyDeletedFooter, rowCustomActions, selectRowLabel, unreadableLine } from '../../history/delete-view';
import { DeleteToastView } from '../../history/DeleteToastView';
import { useDeleteToast } from '../../history/useDeleteToast';
import { useSelectDelete } from '../../history/useSelectDelete';
import { newUuid } from '../../device/runtime';
import { PAST_PAGE } from '../../services/history-services';
import { useDataChanged, useScreenData, useServices } from '../../shell/context';
import { TIMING, useTheme } from '../../theme';
import { AppText, DangerTextButton, Group, Icon, Row, Screen, SelectionToolbar, SelectRow, StatusLine, TextButton, Toast, ToastHost, toastBottom } from '../../ui';
import { LIBRARY_COPY_UI } from '../../workout/library-view';
import { useSaveToWorkouts } from '../routines/SaveWorkoutSheet';
import { LogPastWorkoutSheet } from '../workout/LogPastWorkoutSheet';
import { PAST_LOG_COPY } from '../../workout/past-log-view';

/**
 * Past workouts (Today → `Past workouts`): pick one to repeat, or delete
 * (delete-workouts §2.3). Every workout logged in the app is listed, with
 * `Show more` for older ones; one with nothing logged opens its Summary
 * (with `⋯`) instead of Repeat (review r2 B1, B2). `Select` → tick →
 * `Delete (n)` → one confirm sheet → one all-or-nothing write → toast with
 * Undo. VoiceOver has a `Delete` action on each row. Swipe-to-delete isn't
 * built (ADR 0024). `⋯` on a row → `Save to Workouts` (routines.md §A2.6):
 * what was done, loads Auto.
 * Imported FitNotes workouts are listed with an `Imported` tag and repeat
 * like any other (B7, DW-Q3); their loads are fitted to the gym at Start.
 */
export function PastWorkoutsScreen() {
  const navigation = useNavigation();
  const services = useServices();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  // Pages of 30; `Show more` widens what is loaded, and `Select all` covers only that (§2.3; review r2 B2).
  const [limit, setLimit] = useState(PAST_PAGE);
  const [data, reload] = useScreenData(async (s) => ({ list: await s.history.pastWorkouts({ limit }), deleted: await s.history.recentlyDeletedCount() }));
  const toast = useDeleteToast();
  const tz = services.now().tz;
  const rows = data.state === 'ready' ? data.value.list.rows : NO_ROWS;
  const sel = useSelectDelete({ rows, loaded: data.state === 'ready', title: 'Past workouts', reload, toast });
  const { selecting, selected, line } = sel;
  const changed = useDataChanged();
  const [saveToast, setSaveToast] = useState<{ text: string; action?: string; onAction?: () => void } | null>(null);
  const [pastLog, setPastLog] = useState(false);
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

  if (data.state === 'loading') return <Screen>{null}</Screen>;
  if (data.state === 'error') {
    return (
      <Screen>
        <StatusLine icon="exclamationmark.triangle" tone="warning" text="Couldn’t read past workouts." detail={data.message} action={<TextButton label="Try again" onPress={reload} />} />
      </Screen>
    );
  }
  const { list, deleted } = data.value;
  const footer = recentlyDeletedFooter(deleted);
  return (
    <>
      <Screen>
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
        {list.unreadable > 0 ? (
          <StatusLine
            icon="exclamationmark.triangle"
            tone="warning"
            text={unreadableLine(list.unreadable)}
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
        {list.rows.length === 0 ? (
          <AppText variant="body">No finished workouts yet.</AppText>
        ) : selecting ? (
          <Group>
            {list.rows.map((c) => (
              <SelectRow
                key={c.sessionId}
                title={pastRowTitle(c, tz)}
                lines={[pastRowDetail(c)]}
                selected={selected.has(c.sessionId)}
                accessibilityLabel={selectRowLabel(c, tz, selected.has(c.sessionId))}
                onToggle={() => {
                  sel.toggle(c.sessionId);
                }}
              />
            ))}
          </Group>
        ) : (
          <Group>
            {list.rows.map((c) => (
              // Design pass 6.7: the `⋯` is the row's trailing control (beside the tap target, no chevron); names on one line.
              <Row
                key={c.sessionId}
                title={pastRowTitle(c, tz)}
                subtitle={c.exerciseNames.join(', ')}
                subtitleLines={1}
                secondLine={pastRowDetail(c)}
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
            ))}
          </Group>
        )}
        {list.more ? (
          <TextButton
            label="Show more"
            tone="secondary"
            onPress={() => {
              setLimit((n) => n + PAST_PAGE);
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
      {/* 0.6: one floating place for both toasts, clear of the home indicator; the list never reflows. */}
      <ToastHost bottom={toastBottom({ footerHeight: null, insetBottom: insets.bottom, space2: theme.space['2'] })}>
        {toast.toast ? (
          <DeleteToastView state={toast} />
        ) : saveToast ? (
          <Toast icon="info.circle" text={saveToast.text} {...(saveToast.action ? { action: saveToast.action } : {})} {...(saveToast.onAction ? { onAction: saveToast.onAction } : {})} />
        ) : null}
      </ToastHost>
      {save.sheet}
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
