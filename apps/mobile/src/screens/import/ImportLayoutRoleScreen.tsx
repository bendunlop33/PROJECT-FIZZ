import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useEffect, useState } from 'react';

import type { LayoutRole } from '@fizz/schemas';

import { ROLE_REFUSAL_TEXT, roleMovedToast, roleSheetView } from '../../import/layout-views';
import type { ProfileStackParams } from '../../navigation/types';
import { useDataChanged, useScreenData, useServices } from '../../shell/context';
import { AppText, ChoiceCard, Screen, StatusLine } from '../../ui';

/**
 * The column role sheet (data-import-export §9.2.5): a fixed list. A
 * `Check` column has nothing selected and shows the coach's `Suggested`.
 * `Weight unit` is refused unless every value is a unit word; a result
 * role is refused on a target column. Taking a role another column holds
 * moves that column to `Not imported`, with a toast and [Undo]. Every
 * change re-runs the checks (rule 5: versioned).
 */
export function ImportLayoutRoleScreen() {
  const services = useServices();
  const changed = useDataChanged();
  const navigation = useNavigation<NativeStackNavigationProp<ProfileStackParams>>();
  const { layoutId, column } = useRoute<RouteProp<ProfileStackParams, 'ImportLayoutRole'>>().params;
  const [refusal, setRefusal] = useState<string | null>(null);
  const [data] = useScreenData((s) => Promise.resolve(s.importLayouts.getLayoutReview(layoutId)));
  const review = data.state === 'ready' ? data.value : null;

  useEffect(() => {
    if (review) navigation.setOptions({ title: `“${review.header[column] ?? ''}”` });
  }, [navigation, review, column]);

  if (!review) return <Screen>{null}</Screen>;
  const values = services.importLayouts.columnValues(layoutId, column);
  const v = roleSheetView(review, column, values);

  function choose(role: LayoutRole) {
    if (!review) return;
    setRefusal(null);
    const r = services.importLayouts.updateImportLayout(layoutId, { kind: 'role', column, role }, review.layoutVersion);
    changed();
    if (!r.ok) {
      setRefusal(r.reason === 'refused' ? ROLE_REFUSAL_TEXT[r.refusal] : 'The layout changed. Try again.');
      return;
    }
    const moved = r.displaced[0];
    navigation.navigate('ImportLayoutCheck', { layoutId, ...(moved ? { moved: roleMovedToast(moved.header) } : {}) });
  }

  return (
    <Screen>
      <AppText variant="callout" color="text.secondary" style={{ fontFamily: 'Menlo' }}>
        {v.values}
      </AppText>
      <AppText variant="callout" color="text.secondary" numeric>
        {v.rows}
      </AppText>
      {refusal ? <StatusLine icon="exclamationmark.triangle" tone="warning" text={refusal} /> : null}
      {v.options.map((o) => (
        <ChoiceCard
          key={o.role}
          title={o.label}
          subtitle={o.suggested ? 'Suggested' : null}
          selected={o.selected}
          onPress={() => {
            choose(o.role);
          }}
        />
      ))}
    </Screen>
  );
}
