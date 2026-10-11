import { useNavigation } from '@react-navigation/native';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ActionSheetIOS } from 'react-native';

import { newUuid } from '../../device/runtime';
import { plural } from '../../format/numbers';
import {
  DELETE_COPY,
  deletedToastText,
  deleteToolbarLabel,
  keepSelection,
  pastRowDetail,
  pastRowTitle,
  recentlyDeletedFooter,
  restoredToastText,
  rowCustomActions,
  selectAllLabel,
  selectRowLabel,
  selectTitle,
  toggleAll,
  toggleOne,
} from '../../history/delete-view';
import { useDeleteToast } from '../../history/useDeleteToast';
import { importedNotListedLine } from '../../import/views';
import type { RepeatCandidate } from '../../services/workout-services';
import { useDataChanged, useScreenData, useServices } from '../../shell/context';
import { AppText, DangerTextButton, Group, LinkLine, Row, Screen, SelectionToolbar, SelectRow, StatusLine, TextButton, Toast } from '../../ui';

/**
 * Past workouts (Today → `Past workouts`): pick one to repeat, or delete
 * (delete-workouts §2.3). `Select` → tick → `Delete (n)` → one confirm
 * sheet → one all-or-nothing write → toast with Undo. VoiceOver has a
 * `Delete` action on each row. Imported FitNotes workouts aren't listed
 * here (P-I3); they are deleted from their import's view.
 */
export function PastWorkoutsScreen() {
  const navigation = useNavigation();
  const services = useServices();
  const changed = useDataChanged();
  const [data, reload] = useScreenData(async (s) => ({ list: await s.repeat.candidates(), deleted: await s.history.recentlyDeletedCount() }));
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [line, setLine] = useState<{ tone: 'info' | 'warning'; text: string; retry?: () => void } | null>(null);
  /** One op ID per delete intent, reused by `Try again` (§3.1 Write failed). */
  const opId = useRef<string | null>(null);
  const { toast, showDeleted } = useDeleteToast();
  const tz = services.now().tz;
  const rows = data.state === 'ready' ? data.value.list.rows : [];

  // After a reload (stale, or a change elsewhere) the selection keeps only what is still listed.
  useEffect(() => {
    if (data.state === 'ready') setSelected((s) => keepSelection(s, data.value.list.rows));
  }, [data]);

  useLayoutEffect(() => {
    navigation.setOptions({
      title: selecting ? selectTitle(selected.size) : 'Past workouts',
      headerLeft: selecting
        ? () => (
            <TextButton
              label={selectAllLabel(selected, rows)}
              onPress={() => {
                setSelected(toggleAll(selected, rows));
              }}
            />
          )
        : undefined,
      headerRight: () =>
        rows.length === 0 ? null : (
          <TextButton
            label={selecting ? DELETE_COPY.cancel : DELETE_COPY.select}
            onPress={() => {
              setSelecting(!selecting);
              setSelected(new Set());
              setLine(null);
            }}
          />
        ),
    });
  }, [navigation, selecting, selected, rows]);

  async function remove(target: readonly RepeatCandidate[], op: string) {
    const r = await services.history.deleteWorkouts(
      target.map((t) => ({ sessionId: t.sessionId, expectedVersion: t.version })),
      op,
    );
    if (r.ok) {
      opId.current = null;
      setSelecting(false);
      setSelected(new Set());
      setLine(null);
      showDeleted({ text: deletedToastText(target, tz), undo: r.refs.map((x) => ({ sessionId: x.sessionId, expectedVersion: x.version })), restoredText: restoredToastText(target, tz) });
      changed();
      return;
    }
    if (r.kind === 'stale') {
      // Nothing was deleted; the list reloads and the selection keeps what is still listed.
      opId.current = null;
      setLine({ tone: 'info', text: r.message });
      reload();
      return;
    }
    setLine({ tone: 'warning', text: r.message, retry: () => void remove(target, op) });
  }

  function confirmSelected() {
    const target = rows.filter((r) => selected.has(r.sessionId));
    const view = services.history.confirmView(target);
    if (view === null) return;
    const op = opId.current ?? newUuid();
    opId.current = op;
    ActionSheetIOS.showActionSheetWithOptions(
      { title: view.title, message: [view.range, view.importedLine].filter((x) => x !== null).join('\n'), options: [view.confirmLabel, DELETE_COPY.cancel], destructiveButtonIndex: 0, cancelButtonIndex: 1 },
      (i) => {
        if (i === 0) void remove(target, op);
      },
    );
  }

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
            text={`${plural(list.unreadable, 'workout', 'workouts')} couldn’t be read and ${list.unreadable === 1 ? 'isn’t' : 'aren’t'} listed.`}
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
        {list.importedNotListed > 0 && !selecting ? (
          <LinkLine
            accessibilityLabel={`${importedNotListedLine(list.importedNotListed).replace(' ›', '')}. Opens Past imports.`}
            onPress={() => {
              navigation.navigate('Tabs', { screen: 'Profile', params: { screen: 'PastImports', initial: false } });
            }}
          >
            <AppText variant="callout" color="text.secondary">
              {importedNotListedLine(list.importedNotListed)}
            </AppText>
          </LinkLine>
        ) : null}
        {list.rows.length === 0 ? (
          <AppText variant="body">{list.importedNotListed > 0 ? 'No workouts logged in the app yet.' : 'No finished workouts yet.'}</AppText>
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
                  setSelected(toggleOne(selected, c.sessionId));
                }}
              />
            ))}
          </Group>
        ) : (
          <Group>
            {list.rows.map((c) => (
              <Row
                key={c.sessionId}
                title={pastRowTitle(c, tz)}
                subtitle={c.exerciseNames.join(', ')}
                secondLine={pastRowDetail(c)}
                actions={rowCustomActions('past')}
                onAction={() => void remove([c], newUuid())}
                onPress={() => {
                  navigation.navigate('Repeat', { sessionId: c.sessionId });
                }}
              />
            ))}
          </Group>
        )}
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
      {toast ? <Toast icon="trash" text={toast.text} {...(toast.action ? { action: toast.action } : {})} {...(toast.onAction ? { onAction: toast.onAction } : {})} /> : null}
      {selecting ? <SelectionToolbar trailing={<DangerTextButton label={deleteToolbarLabel(selected.size)} disabled={selected.size === 0} onPress={confirmSelected} />} /> : null}
    </>
  );
}
