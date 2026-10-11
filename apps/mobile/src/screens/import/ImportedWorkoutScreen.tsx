import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import { useEffect, useRef, useState } from 'react';
import { ActionSheetIOS, Pressable } from 'react-native';

import { newUuid } from '../../device/runtime';
import { DELETE_COPY, deletedBannerText, deletedToastText, restoredToastText } from '../../history/delete-view';
import { handOffDeleteToast } from '../../history/toast-handoff';
import { importedSetLines, longDate } from '../../import/views';
import type { ProfileStackParams } from '../../navigation/types';
import { useDataChanged, useScreenData, useServices } from '../../shell/context';
import { useTheme } from '../../theme';
import { AppText, Group, Icon, PrimaryButton, Row, Screen, StatusLine, TextButton } from '../../ui';

const PAGE = 100;

/**
 * One workout an import brought in (check 24; review S2): every set as it
 * came in (`imported as …`; a later correction in the app isn't shown here,
 * review r2 N3), with the file, row number and original FitNotes values
 * under it. Names and comments are data, shown as text (rule 8).
 * Nav-bar `⋯` → `Delete workout` (delete-workouts §2.1, DW24); while it is in
 * Recently deleted it shows the `Deleted` line and `Restore`.
 */
export function ImportedWorkoutScreen() {
  const navigation = useNavigation();
  const theme = useTheme();
  const services = useServices();
  const changed = useDataChanged();
  const { jobId, date } = useRoute<RouteProp<ProfileStackParams, 'ImportedWorkout'>>().params;
  const [shown, setShown] = useState(PAGE);
  const [line, setLine] = useState<string | null>(null);
  const deleteOp = useRef(newUuid());
  const [data, reload] = useScreenData(async (s) => {
    const found = await s.imports.importedRows(jobId, date);
    const sessionId = found?.rows.find((r) => r.sessionId !== null)?.sessionId ?? null;
    const session = sessionId === null ? null : await s.repeat.describeById(sessionId);
    const presence = sessionId === null ? null : await s.history.presence(sessionId);
    return found === null ? null : { ...found, session, presence };
  });
  const value = data.state === 'ready' ? data.value : null;
  const live = value?.presence?.kind === 'live' && value.session !== null;

  useEffect(() => {
    navigation.setOptions({
      title: `${longDate(date)} · date only`,
      headerRight: live
        ? () => (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="More"
              onPress={openMenu}
              style={{ minWidth: theme.target.min.width, minHeight: theme.target.min.height, alignItems: 'center', justifyContent: 'center' }}
            >
              <Icon name="ellipsis.circle" color="accent" size={22} />
            </Pressable>
          )
        : undefined,
    });
  });

  function openMenu() {
    ActionSheetIOS.showActionSheetWithOptions({ options: [DELETE_COPY.menuItem, DELETE_COPY.cancel], destructiveButtonIndex: 0, cancelButtonIndex: 1 }, (i) => {
      if (i === 0) void remove();
    });
  }

  async function remove() {
    const row = value?.session;
    if (!row) return;
    const r = await services.history.deleteWorkouts([{ sessionId: row.sessionId, expectedVersion: row.version }], deleteOp.current, { from: 'opened' });
    if (!r.ok) {
      if (r.kind === 'stale') deleteOp.current = newUuid();
      setLine(r.message);
      reload();
      return;
    }
    const tz = services.now().tz;
    handOffDeleteToast({ text: deletedToastText([row], tz), undo: r.refs.map((x) => ({ sessionId: x.sessionId, expectedVersion: x.version })), restoredText: restoredToastText([row], tz) });
    changed();
    navigation.goBack();
  }

  async function restore() {
    const row = value?.session;
    const p = value?.presence;
    if (!row || p?.kind !== 'deleted') return;
    const r = await services.history.restoreWorkouts([{ sessionId: row.sessionId, expectedVersion: p.version }], newUuid());
    setLine(r.ok ? restoredToastText([row], services.now().tz) : r.message);
    changed();
    reload();
  }

  if (data.state !== 'ready') return <Screen>{null}</Screen>;
  if (!data.value) {
    return (
      <Screen>
        <StatusLine icon="info.circle" tone="info" text="This import wasn’t found." />
      </Screen>
    );
  }
  const { job, rows, presence } = data.value;
  if (presence?.kind === 'gone') {
    return (
      <Screen>
        <AppText variant="body">{DELETE_COPY.gone}</AppText>
      </Screen>
    );
  }
  return (
    <Screen {...(presence?.kind === 'deleted' ? { footer: <PrimaryButton label={DELETE_COPY.restore} onPress={() => void restore()} /> } : {})}>
      {presence?.kind === 'deleted' ? <StatusLine icon="trash" tone="info" text={deletedBannerText(presence.goneOn)} /> : null}
      {line ? <StatusLine icon="info.circle" tone="info" text={line} /> : null}
      <AppText variant="callout" color="text.secondary">{`From ${job.fileName}`}</AppText>
      {rows.length === 0 ? <AppText variant="callout" color="text.secondary">Nothing came in on this date.</AppText> : null}
      <Group>
        {rows.slice(0, shown).map((r) => {
          const l = importedSetLines(job, r);
          return <Row key={r.row} title={l.title} subtitle={l.source} secondLine={l.original} />;
        })}
      </Group>
      {rows.length > shown ? (
        <TextButton
          label="Show more"
          onPress={() => {
            setShown((n) => n + PAGE);
          }}
        />
      ) : null}
    </Screen>
  );
}
