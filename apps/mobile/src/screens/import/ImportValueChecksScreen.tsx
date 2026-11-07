import { useRoute, type RouteProp } from '@react-navigation/native';
import { useState } from 'react';

import { VALUE_CHECK_COPY, valueCheckView } from '../../import/layout-views';
import type { ProfileStackParams } from '../../navigation/types';
import { useDataChanged, useScreenData, useServices } from '../../shell/context';
import { AppText, Card, ChoiceCard, InfoLine, Screen, StatusLine, TextButton } from '../../ui';

/**
 * Values to check (data-import-export §9.2.6, AI13): each jump of more than
 * double (or a fall under half) since the same exercise's previous workout
 * in the file, as written, with nothing selected. The preview's primary
 * waits until every one is answered.
 */
export function ImportValueChecksScreen() {
  const services = useServices();
  const changed = useDataChanged();
  const { draftId } = useRoute<RouteProp<ProfileStackParams, 'ImportValueChecks'>>().params;
  const [error, setError] = useState<string | null>(null);
  const [data] = useScreenData((s) => s.imports.draft(draftId));
  if (data.state !== 'ready' || !data.value) return <Screen>{null}</Screen>;
  const draft = data.value;
  const checks = draft.analysis.valueChecks;

  async function answer(change: Parameters<typeof services.imports.answer>[2]) {
    setError(null);
    const r = await services.imports.answer(draftId, draft.mappingVersion, change);
    changed();
    if (!r.ok) setError('The preview changed. Try again.');
  }

  return (
    <Screen>
      <InfoLine text={VALUE_CHECK_COPY.title(checks.length)} info={VALUE_CHECK_COPY.why} infoLabel="Why?" />
      {error ? <StatusLine icon="exclamationmark.triangle" tone="warning" text={error} /> : null}
      {checks.map((c) => {
        const v = valueCheckView(c);
        return (
          <Card key={c.key}>
            <AppText variant="headline">{v.title}</AppText>
            <AppText variant="callout" numeric>
              {v.line}
            </AppText>
            <ChoiceCard title={VALUE_CHECK_COPY.importAsWritten} selected={v.answer === 'import'} onPress={() => void answer({ kind: 'value_check', key: c.key, answer: 'import' })} />
            <ChoiceCard title={v.skip} selected={v.answer === 'skip'} onPress={() => void answer({ kind: 'value_check', key: c.key, answer: 'skip' })} />
          </Card>
        );
      })}
      {checks.some((c) => c.answer === null) ? (
        <TextButton label={VALUE_CHECK_COPY.importAll} onPress={() => void answer({ kind: 'value_checks_all', keys: checks.filter((c) => c.answer === null).map((c) => c.key) })} />
      ) : null}
    </Screen>
  );
}
