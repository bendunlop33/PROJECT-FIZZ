import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useEffect, useState } from 'react';

import type { LayoutQuestion } from '@fizz/domain';
import type { MarkerMeaning, NotationAnswer } from '@fizz/schemas';

import type { LayoutChange } from '../../import/layout-service';
import { questionScreenView } from '../../import/layout-views';
import type { ProfileStackParams } from '../../navigation/types';
import { useDataChanged, useScreenData, useServices } from '../../shell/context';
import { AppText, ChoiceCard, Screen, StatusLine } from '../../ui';

/**
 * One layout question (data-import-export §9.2.5, §9.2.7): what the file
 * is, the weight unit, the date order, what an `x` cell means, a marker,
 * or a new column. Every option is rendered from real rows; nothing is
 * selected until Ben answers. A tap answers and returns.
 */
export function ImportLayoutQuestionScreen() {
  const services = useServices();
  const changed = useDataChanged();
  const navigation = useNavigation<NativeStackNavigationProp<ProfileStackParams>>();
  const { layoutId, kind, column, token } = useRoute<RouteProp<ProfileStackParams, 'ImportLayoutQuestion'>>().params;
  const [error, setError] = useState<string | null>(null);
  const [data] = useScreenData((s) => Promise.resolve(s.importLayouts.getLayoutReview(layoutId)));
  const review = data.state === 'ready' ? data.value : null;
  const q: LayoutQuestion | undefined = review?.review.questions.find(
    (x) => x.kind === kind && (x.kind !== 'notation' || x.column === column) && (x.kind !== 'new_column' || x.column === column) && (x.kind !== 'marker' || x.marker.token === token),
  );

  useEffect(() => {
    if (q) navigation.setOptions({ title: questionScreenView(q).title });
  }, [navigation, q]);

  if (!review || !q) return <Screen>{null}</Screen>;
  const v = questionScreenView(q);

  function answer(value: string) {
    if (!review || !q) return;
    let change: LayoutChange;
    switch (q.kind) {
      case 'record_kind':
        change = { kind: 'record_kind', answer: value === 'plan' ? 'plan' : 'done' };
        break;
      case 'unit':
        change = { kind: 'unit', answer: value === 'lb' ? 'lb' : 'kg' };
        break;
      case 'date_order':
        change = { kind: 'date_order', answer: value === 'month_first' ? 'month_first' : 'day_first' };
        break;
      case 'notation':
        change = { kind: 'notation', column: q.column, answer: value as NotationAnswer };
        break;
      case 'marker':
        change = { kind: 'marker', token: q.marker.token, meaning: value as MarkerMeaning };
        break;
      case 'new_column':
        if (value === 'other') {
          navigation.navigate('ImportLayoutRole', { layoutId, column: q.column });
          return;
        }
        change = { kind: 'role', column: q.column, role: value === 'notes' ? 'notes' : 'not_imported' };
        break;
    }
    const r = services.importLayouts.updateImportLayout(layoutId, change, review.layoutVersion);
    changed();
    if (!r.ok) {
      setError('The layout changed. Try again.');
      return;
    }
    navigation.goBack();
  }

  return (
    <Screen>
      {v.lines.map((l) => (
        <AppText key={l} variant="callout" color="text.secondary" numeric>
          {l}
        </AppText>
      ))}
      {error ? <StatusLine icon="exclamationmark.triangle" tone="warning" text={error} /> : null}
      {v.options.map((o) => (
        <ChoiceCard
          key={o.value}
          title={o.label}
          subtitle={o.detail}
          selected={o.selected}
          onPress={() => {
            answer(o.value);
          }}
        />
      ))}
    </Screen>
  );
}
