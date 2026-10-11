import { useNavigation } from '@react-navigation/native';
import { useState } from 'react';

import { deleteToolbarLabel, pastRowDetail, pastRowOpens, pastRowTitle, recentlyDeletedFooter, rowCustomActions, selectRowLabel, unreadableLine } from '../../history/delete-view';
import { DeleteToastView } from '../../history/DeleteToastView';
import { useDeleteToast } from '../../history/useDeleteToast';
import { useSelectDelete } from '../../history/useSelectDelete';
import { importedNotListedLine } from '../../import/views';
import { PAST_PAGE } from '../../services/history-services';
import { useScreenData, useServices } from '../../shell/context';
import { AppText, DangerTextButton, Group, LinkLine, Row, Screen, SelectionToolbar, SelectRow, StatusLine, TextButton } from '../../ui';

/**
 * Past workouts (Today → `Past workouts`): pick one to repeat, or delete
 * (delete-workouts §2.3). Every workout logged in the app is listed, with
 * `Show more` for older ones; one with nothing logged opens its Summary
 * (with `⋯`) instead of Repeat (review r2 B1, B2). `Select` → tick →
 * `Delete (n)` → one confirm sheet → one all-or-nothing write → toast with
 * Undo. VoiceOver has a `Delete` action on each row. Swipe-to-delete isn't
 * built (ADR 0024).
 * Imported FitNotes workouts aren't listed here (P-I3); they are deleted
 * from their import's view.
 */
export function PastWorkoutsScreen() {
  const navigation = useNavigation();
  const services = useServices();
  // Pages of 30; `Show more` widens what is loaded, and `Select all` covers only that (§2.3; review r2 B2).
  const [limit, setLimit] = useState(PAST_PAGE);
  const [data, reload] = useScreenData(async (s) => ({ list: await s.history.pastWorkouts({ limit }), deleted: await s.history.recentlyDeletedCount() }));
  const toast = useDeleteToast();
  const tz = services.now().tz;
  const rows = data.state === 'ready' ? data.value.list.rows : NO_ROWS;
  const sel = useSelectDelete({ rows, loaded: data.state === 'ready', title: 'Past workouts', reload, toast });
  const { selecting, selected, line } = sel;

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
                  sel.toggle(c.sessionId);
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
                onAction={() => {
                  sel.removeOne(c);
                }}
                onPress={() => {
                  if (pastRowOpens(c) === 'summary') navigation.navigate('Summary', { sessionId: c.sessionId, back: true });
                  else navigation.navigate('Repeat', { sessionId: c.sessionId });
                }}
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
      <DeleteToastView state={toast} />
      {selecting ? <SelectionToolbar trailing={<DangerTextButton label={deleteToolbarLabel(selected.size)} disabled={selected.size === 0} onPress={sel.confirmSelected} />} /> : null}
    </>
  );
}

const NO_ROWS: never[] = [];
