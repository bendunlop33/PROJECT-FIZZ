import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useState } from 'react';
import { View } from 'react-native';

import type { AnswerChange } from '@fizz/domain';

import { namesView, type NameRowView } from '../../import/views';
import type { ProfileStackParams } from '../../navigation/types';
import { useDataChanged, useScreenData, useServices } from '../../shell/context';
import { useTheme } from '../../theme';
import { AppText, Card, Icon, Screen, SecondaryButton, StatusLine, TextButton } from '../../ui';

const TONE_COLOR = { done: 'status.done', warning: 'status.warning', info: 'text.secondary' } as const;

/**
 * `Check exercise names` (data-import-export §2.5 step 3a). Names needing
 * Ben come first; plain matches are collapsed. `Matched` / `Check` /
 * `No match` always with an icon and the word; no scores. Every answer is
 * remembered for the next import when the import commits.
 */
export function ImportNamesScreen() {
  const theme = useTheme();
  const services = useServices();
  const changed = useDataChanged();
  const navigation = useNavigation<NativeStackNavigationProp<ProfileStackParams>>();
  const { draftId } = useRoute<RouteProp<ProfileStackParams, 'ImportNames'>>().params;
  const [showMatched, setShowMatched] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data] = useScreenData((s) => s.imports.draft(draftId));
  if (data.state !== 'ready' || !data.value) return <Screen>{null}</Screen>;
  const draft = data.value;
  const view = namesView(draft.analysis, (id) => services.imports.candidate(draftId, id)?.name ?? null);

  async function answer(change: AnswerChange) {
    setError(null);
    const r = await services.imports.answer(draftId, draft.mappingVersion, change);
    if (!r.ok) setError(r.reason === 'invalid' ? r.message : 'The preview changed. Check the answer again.');
    changed();
  }

  function card(n: NameRowView) {
    return (
      <Card key={n.key}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: theme.space['3'] }}>
          <AppText variant="headline" style={{ flex: 1 }}>
            {n.title}
          </AppText>
          <AppText variant="callout" color="text.secondary" numeric>
            {n.sets}
          </AppText>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space['2'] }} accessible accessibilityLabel={`${n.status.word}: ${n.status.text}`}>
          <Icon name={n.status.icon} color={TONE_COLOR[n.status.tone]} />
          <AppText variant="body" style={{ flex: 1 }}>
            {n.status.text}
          </AppText>
          <AppText variant="label" color="text.secondary">
            {n.status.word}
          </AppText>
        </View>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.space['2'] }}>
          {n.actions.includes('use') && n.suggestionId !== null ? (
            <SecondaryButton
              label="Use this"
              onPress={() => {
                if (n.suggestionId !== null) void answer({ kind: 'name', key: n.key, answer: { kind: 'exercise', exerciseId: n.suggestionId } });
              }}
            />
          ) : null}
          {n.actions.includes('choose') || n.actions.includes('change') ? (
            <TextButton
              label={n.actions.includes('change') ? 'Change' : 'Choose…'}
              onPress={() => {
                navigation.navigate('ImportChoose', { draftId, key: n.key, name: n.title, mode: 'choose' });
              }}
            />
          ) : null}
          {n.actions.includes('new') ? (
            <TextButton
              label="Add new"
              onPress={() => {
                navigation.navigate('ImportChoose', { draftId, key: n.key, name: n.title, mode: 'new' });
              }}
            />
          ) : null}
          {n.actions.includes('skip') ? <TextButton label="Skip" tone="secondary" onPress={() => void answer({ kind: 'name', key: n.key, answer: { kind: 'skip' } })} /> : null}
        </View>
      </Card>
    );
  }

  return (
    <Screen>
      <AppText variant="callout" color="text.secondary">
        FitNotes name → GymSmarter exercise
      </AppText>
      {error ? <StatusLine icon="exclamationmark.triangle" tone="warning" text={error} /> : null}
      {view.rows.map(card)}
      {view.matchedCount > 0 ? (
        <TextButton
          label={`${String(view.matchedCount)} matched by name · ${showMatched ? 'Hide' : 'Show'}`}
          onPress={() => {
            setShowMatched((x) => !x);
          }}
        />
      ) : null}
      {showMatched ? view.matched.map(card) : null}
    </Screen>
  );
}
