import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import { useEffect, useState } from 'react';

import { longDate, previewRowLines } from '../../import/views';
import type { ImportSkipKey, ProfileStackParams } from '../../navigation/types';
import { useScreenData, useServices } from '../../shell/context';
import { AppText, Group, Row, Screen, TextButton } from '../../ui';

const RESULTS: Record<ImportSkipKey, readonly string[]> = {
  cardio: ['skipped_cardio'],
  unsupported: ['skipped_unsupported'],
  unreadable: ['unreadable'],
  date_exists: ['skipped_date_exists'],
  duplicate: ['skipped_duplicate'],
  exercise: ['skipped_exercise'],
  not_a_set: ['skipped_not_a_set'],
  value_to_check: ['skipped_value_to_check'],
};
const TITLES: Record<ImportSkipKey, string> = {
  cardio: 'Cardio rows',
  unsupported: 'Timed, distance or weight-only sets',
  unreadable: 'Rows that can’t be read',
  date_exists: 'Dates already in GymSmarter',
  duplicate: 'From an earlier import',
  exercise: 'Exercises you chose to skip',
  not_a_set: 'Not a set',
  value_to_check: 'Values you chose to skip',
};
const PAGE = 100;

/**
 * One preview workout (data-import-export §2.5 step 3d: each set's mapped
 * value with the original FitNotes row under it), or one `Will be skipped`
 * list with every row and why. Read-only; rows are data, shown as text.
 */
export function ImportRowsScreen() {
  const services = useServices();
  const navigation = useNavigation();
  const { draftId, date, skip } = useRoute<RouteProp<ProfileStackParams, 'ImportRows'>>().params;
  const [shown, setShown] = useState(PAGE);
  const [data] = useScreenData((s) => s.imports.draft(draftId));
  useEffect(() => {
    navigation.setOptions({ title: date !== undefined ? `${longDate(date)} · date only` : skip !== undefined ? TITLES[skip] : 'Rows' });
  }, [navigation, date, skip]);
  if (data.state !== 'ready' || !data.value) return <Screen>{null}</Screen>;
  const draft = data.value;
  const rows = date !== undefined ? services.imports.previewRows(draftId, date) : skip !== undefined ? services.imports.previewRowsWith(draftId, RESULTS[skip]) : [];
  return (
    <Screen>
      {rows.length === 0 ? <AppText variant="callout" color="text.secondary">Nothing here.</AppText> : null}
      <Group>
        {rows.slice(0, shown).map(({ row, fate }) => {
          const candidate = fate.result === 'imported' ? services.imports.candidate(draftId, fate.set.exerciseId) : null;
          const lines = previewRowLines(draft.variant, row, fate, candidate);
          return <Row key={row.row} title={lines.title} subtitle={lines.detail} />;
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
