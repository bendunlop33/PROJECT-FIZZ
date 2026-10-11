import { useNavigation } from '@react-navigation/native';

import { plural } from '../../format/numbers';
import { deleteToolbarLabel, pastRowDetail, pastRowTitle, recentlyDeletedFooter, rowCustomActions, selectRowLabel } from '../../history/delete-view';
import { DeleteToastView } from '../../history/DeleteToastView';
import { useDeleteToast } from '../../history/useDeleteToast';
import { useSelectDelete } from '../../history/useSelectDelete';
import { importedNotListedLine } from '../../import/views';
import { useScreenData, useServices } from '../../shell/context';
import { AppText, DangerTextButton, Group, LinkLine, Row, Screen, SelectionToolbar, SelectRow, StatusLine, TextButton } from '../../ui';

/**
 * Past workouts (Today → `Past workouts`): pick one to repeat, or delete
 * (delete-workouts §2.3). `Select` → tick → `Delete (n)` → one confirm
 * sheet → one all-or-nothing write → toast with Undo. VoiceOver has a
 * `Delete` action on each row. Swipe-to-delete isn't built (ADR 0024).
 * Imported FitNotes workouts aren't listed here (P-I3); they are deleted
 * from their import's view.
 */
export function PastWorkoutsScreen() {
  const navigation = useNavigation();
  const services = useServices();
  const [data, reload] = useScreenData(async (s) => ({ list: await s.repeat.candidates(), deleted: await s.history.recentlyDeletedCount() }));
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
      <DeleteToastView state={toast} />
      {selecting ? <SelectionToolbar trailing={<DangerTextButton label={deleteToolbarLabel(selected.size)} disabled={selected.size === 0} onPress={sel.confirmSelected} />} /> : null}
    </>
  );
}

const NO_ROWS: never[] = [];
