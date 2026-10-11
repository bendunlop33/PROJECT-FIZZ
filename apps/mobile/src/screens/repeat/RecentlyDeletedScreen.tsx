import { useNavigation } from '@react-navigation/native';
import { useEffect, useLayoutEffect, useState } from 'react';
import { Alert } from 'react-native';

import { newUuid } from '../../device/runtime';
import {
  DELETE_COPY,
  deletedRowLines,
  deletedToastText,
  deleteNowAlert,
  keepSelection,
  restoredToastText,
  restoreToolbarLabels,
  rowCustomActions,
  selectAllLabel,
  selectRowLabel,
  selectTitle,
  toggleAll,
  toggleOne,
} from '../../history/delete-view';
import { useDeleteToast } from '../../history/useDeleteToast';
import type { DeletedWorkoutRow } from '../../services/history-services';
import { useDataChanged, useScreenData, useServices } from '../../shell/context';
import { AppText, DangerTextButton, Group, InfoLine, Row, Screen, SelectionToolbar, SelectRow, StatusLine, TextButton, Toast } from '../../ui';

/**
 * Recently deleted (delete-workouts §2.5): newest deletion first, each with
 * `Gone on <date>`. Restore needs no confirm and has its own Undo; `Delete
 * now` asks once. Past their 30 days, workouts are never listed.
 */
export function RecentlyDeletedScreen() {
  const navigation = useNavigation();
  const services = useServices();
  const changed = useDataChanged();
  const [data, reload] = useScreenData((s) => s.history.recentlyDeleted());
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [line, setLine] = useState<string | null>(null);
  const { toast, show } = useDeleteToast();
  const tz = services.now().tz;
  const rows = data.state === 'ready' ? data.value.rows : [];

  useEffect(() => {
    if (data.state === 'ready') setSelected((s) => keepSelection(s, data.value.rows));
  }, [data]);

  useLayoutEffect(() => {
    navigation.setOptions({
      title: selecting ? selectTitle(selected.size) : DELETE_COPY.recentlyDeleted,
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
            }}
          />
        ),
    });
  }, [navigation, selecting, selected, rows]);

  async function restore(target: readonly DeletedWorkoutRow[]) {
    const r = await services.history.restoreWorkouts(
      target.map((t) => ({ sessionId: t.sessionId, expectedVersion: t.version })),
      newUuid(),
    );
    if (!r.ok) {
      setLine(r.message);
      reload();
      return;
    }
    setLine(null);
    setSelecting(false);
    setSelected(new Set());
    // Undo of a restore deletes them again (the 30-day clock starts again from now, §3.3).
    const undoOp = newUuid();
    show({
      text: restoredToastText(target, tz),
      action: DELETE_COPY.undo,
      onAction: () => {
        void services.history.deleteWorkouts(r.refs.map((x) => ({ sessionId: x.sessionId, expectedVersion: x.version })), undoOp, { from: 'opened' }).then((d) => {
          show({ text: d.ok ? deletedToastText(target, tz) : d.message });
          changed();
        });
      },
    });
    changed();
  }

  function deleteNow(target: readonly DeletedWorkoutRow[]) {
    const ask = deleteNowAlert(target.length);
    const op = newUuid();
    Alert.alert(ask.title, ask.message, [
      { text: DELETE_COPY.cancel, style: 'cancel' },
      {
        text: ask.confirm,
        style: 'destructive',
        onPress: () => {
          void services.history.deleteNow(
            target.map((t) => t.sessionId),
            op,
          ).then((r) => {
            setLine(r.ok ? null : r.message);
            setSelecting(false);
            setSelected(new Set());
            changed();
          });
        },
      },
    ]);
  }

  if (data.state === 'loading') return <Screen>{null}</Screen>;
  if (data.state === 'error') {
    return (
      <Screen>
        <StatusLine icon="exclamationmark.triangle" tone="warning" text="Couldn’t read Recently deleted." detail={data.message} action={<TextButton label="Try again" onPress={reload} />} />
      </Screen>
    );
  }
  const chosen = rows.filter((r) => selected.has(r.sessionId));
  const labels = restoreToolbarLabels(selected.size);
  return (
    <>
      <Screen>
        {line ? <StatusLine icon="info.circle" tone="info" text={line} /> : null}
        {rows.length === 0 ? (
          <AppText variant="body">{DELETE_COPY.empty}</AppText>
        ) : (
          <Group>
            {rows.map((r) => {
              const l = deletedRowLines(r, tz);
              return selecting ? (
                <SelectRow
                  key={r.sessionId}
                  title={l.title}
                  lines={[l.detail, l.gone]}
                  selected={selected.has(r.sessionId)}
                  accessibilityLabel={selectRowLabel(r, tz, selected.has(r.sessionId))}
                  onToggle={() => {
                    setSelected(toggleOne(selected, r.sessionId));
                  }}
                />
              ) : (
                <Row
                  key={r.sessionId}
                  title={l.title}
                  subtitle={l.detail}
                  secondLine={l.gone}
                  actions={rowCustomActions('deleted')}
                  onAction={() => void restore([r])}
                  onPress={() => {
                    navigation.navigate('Summary', { sessionId: r.sessionId, back: true });
                  }}
                />
              );
            })}
          </Group>
        )}
        {rows.length > 0 ? <InfoLine variant="callout" text={DELETE_COPY.footnote} info={DELETE_COPY.footnoteInfo} /> : null}
      </Screen>
      {toast ? <Toast icon="info.circle" text={toast.text} {...(toast.action ? { action: toast.action } : {})} {...(toast.onAction ? { onAction: toast.onAction } : {})} /> : null}
      {selecting ? (
        <SelectionToolbar
          leading={<TextButton label={labels.restore} disabled={selected.size === 0} onPress={() => void restore(chosen)} />}
          trailing={
            <DangerTextButton
              label={labels.deleteNow}
              disabled={selected.size === 0}
              onPress={() => {
                deleteNow(chosen);
              }}
            />
          }
        />
      ) : null}
    </>
  );
}
