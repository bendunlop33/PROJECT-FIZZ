import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import { useEffect, useState } from 'react';

import { importedSetLines, longDate } from '../../import/views';
import type { ProfileStackParams } from '../../navigation/types';
import { useScreenData } from '../../shell/context';
import { AppText, Group, Row, Screen, StatusLine, TextButton } from '../../ui';

const PAGE = 100;

/**
 * One workout an import brought in (check 24; review S2): every set as it is
 * in the app, with the file, row number and original FitNotes values under
 * it. Read-only; names and comments are data, shown as text (rule 8).
 */
export function ImportedWorkoutScreen() {
  const navigation = useNavigation();
  const { jobId, date } = useRoute<RouteProp<ProfileStackParams, 'ImportedWorkout'>>().params;
  const [shown, setShown] = useState(PAGE);
  const [data] = useScreenData((s) => s.imports.importedRows(jobId, date));
  useEffect(() => {
    navigation.setOptions({ title: `${longDate(date)} · date only` });
  }, [navigation, date]);
  if (data.state !== 'ready') return <Screen>{null}</Screen>;
  if (!data.value) {
    return (
      <Screen>
        <StatusLine icon="info.circle" tone="info" text="This import wasn’t found." />
      </Screen>
    );
  }
  const { job, rows } = data.value;
  return (
    <Screen>
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
