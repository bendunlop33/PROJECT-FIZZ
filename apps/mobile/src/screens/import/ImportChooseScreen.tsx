import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import { useState } from 'react';
import { TextInput } from 'react-native';

import { EQUIPMENT_WORD, type AnswerChange } from '@fizz/domain';
import { CustomExerciseKindSchema, type CustomExerciseKind } from '@fizz/schemas';

import type { ProfileStackParams } from '../../navigation/types';
import { useDataChanged, useScreenData, useServices } from '../../shell/context';
import { useTheme } from '../../theme';
import { AppText, ChoiceCard, Group, Row, Screen, StatusLine, TextButton } from '../../ui';

/**
 * `Choose…` (an exercise for one FitNotes name, search prefilled with the
 * name) and `Add new` (a custom exercise with that name; the equipment type
 * decides its load convention) from data-import-export §2.5 step 3a.
 * Nothing is created until the import commits.
 */
export function ImportChooseScreen() {
  const theme = useTheme();
  const services = useServices();
  const changed = useDataChanged();
  const navigation = useNavigation();
  const { draftId, key, name, mode } = useRoute<RouteProp<ProfileStackParams, 'ImportChoose'>>().params;
  const [query, setQuery] = useState(name);
  const [error, setError] = useState<string | null>(null);
  const [data] = useScreenData((s) => s.imports.draft(draftId));
  if (data.state !== 'ready' || !data.value) return <Screen>{null}</Screen>;
  const draft = data.value;
  const current = draft.answers.names[key] ?? null;

  async function answer(change: AnswerChange) {
    setError(null);
    const r = await services.imports.answer(draftId, draft.mappingVersion, change);
    changed();
    if (!r.ok) {
      setError(r.reason === 'invalid' ? r.message : 'The preview changed. Try again.');
      return;
    }
    navigation.goBack();
  }

  if (mode === 'new') {
    return (
      <Screen>
        <AppText variant="body">{`“${name}” becomes a new exercise with that name. What equipment is it done on?`}</AppText>
        {error ? <StatusLine icon="exclamationmark.triangle" tone="warning" text={error} /> : null}
        {CustomExerciseKindSchema.options.map((kind: CustomExerciseKind) => (
          <ChoiceCard
            key={kind}
            title={EQUIPMENT_WORD[kind]}
            selected={current?.kind === 'new' && current.equipment === kind}
            onPress={() => void answer({ kind: 'name', key, answer: { kind: 'new', equipment: kind } })}
          />
        ))}
      </Screen>
    );
  }

  const results = services.imports.searchExercises(draftId, query).slice(0, 60);
  return (
    <Screen>
      <TextInput
        value={query}
        onChangeText={setQuery}
        placeholder="Search exercises"
        placeholderTextColor={theme.colors['text.tertiary']}
        accessibilityLabel="Search exercises"
        returnKeyType="search"
        clearButtonMode="while-editing"
        maxFontSizeMultiplier={theme.type.body.maxFontSizeMultiplier}
        style={{ minHeight: 52, paddingHorizontal: theme.space['3'], borderRadius: theme.radius.sm, borderWidth: 1, borderColor: theme.colors['border.control'], backgroundColor: theme.colors['bg.raised'], color: theme.colors['text.primary'], fontSize: theme.type.body.fontSize }}
      />
      {error ? <StatusLine icon="exclamationmark.triangle" tone="warning" text={error} /> : null}
      {results.length === 0 ? (
        <AppText variant="callout" color="text.secondary">
          No exercise matches. Try fewer words, or Add new.
        </AppText>
      ) : (
        <Group>
          {results.map((c) => (
            <Row
              key={c.exerciseId}
              title={c.name}
              subtitle={c.compatibleEquipment.map((k) => (k in EQUIPMENT_WORD ? EQUIPMENT_WORD[k as keyof typeof EQUIPMENT_WORD] : k)).join(', ')}
              icon={current?.kind === 'exercise' && current.exerciseId === c.exerciseId ? 'checkmark.circle.fill' : 'circle'}
              onPress={() => void answer({ kind: 'name', key, answer: { kind: 'exercise', exerciseId: c.exerciseId } })}
            />
          ))}
        </Group>
      )}
      <TextButton label="Skip this exercise" tone="secondary" onPress={() => void answer({ kind: 'name', key, answer: { kind: 'skip' } })} />
      {current !== null ? <TextButton label="Clear my answer" tone="secondary" onPress={() => void answer({ kind: 'name', key, answer: null })} /> : null}
    </Screen>
  );
}
