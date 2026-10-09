import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import { useEffect, useState } from 'react';
import { ScrollView, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { EQUIPMENT_WORD } from '@fizz/domain';

import { newUuid } from '../../device/runtime';
import type { RootStackParams } from '../../navigation/types';
import type { PickerExercise } from '../../services/workout-services';
import { useDataChanged, useServices } from '../../shell/context';
import { useTheme } from '../../theme';
import { AppText, Group, Row, StatusLine, TextButton } from '../../ui';

/**
 * Exercise picker (active-workout §2.10): a minimal search over the starter
 * exercise list in the database (the rich catalogue isn't wired yet).
 * Choosing one calls `addExercise` once (opId per choice). When the gym has
 * more than one compatible item, Ben picks which; with none, the exercise is
 * added without equipment and loads aren't checked.
 */
export function ExercisePickerScreen() {
  const theme = useTheme();
  const services = useServices();
  const changed = useDataChanged();
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const { sessionId } = useRoute<RouteProp<RootStackParams, 'ExercisePicker'>>().params;
  const [query, setQuery] = useState('');
  const [list, setList] = useState<PickerExercise[]>([]);
  const [recent, setRecent] = useState<string[]>([]);
  const [choosing, setChoosing] = useState<PickerExercise | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [opIds] = useState(() => new Map<string, string>());

  useEffect(() => {
    let alive = true;
    void services.workout.pickerExercises(sessionId, query).then((l) => {
      if (alive) setList(l);
    });
    return () => {
      alive = false;
    };
  }, [services, sessionId, query]);
  useEffect(() => {
    void services.workout.recentExerciseIds().then(setRecent);
  }, [services]);

  async function add(p: PickerExercise, equipmentId: string | null) {
    if (busy) return;
    setBusy(true);
    setError(null);
    const key = `${p.exercise.id}:${equipmentId ?? ''}`;
    const opId = opIds.get(key) ?? newUuid();
    opIds.set(key, opId);
    const r = await services.workout.addExercise({ sessionId, exerciseId: p.exercise.id, equipmentId, opId });
    setBusy(false);
    if (!r.ok) {
      setError(`Couldn’t add ${p.exercise.name}: ${r.error.message}`);
      return;
    }
    changed();
    navigation.goBack();
  }

  function choose(p: PickerExercise) {
    const only = p.equipment[0];
    if (p.equipment.length <= 1) {
      void add(p, only?.id ?? null);
      return;
    }
    setChoosing(p);
  }

  const ordered = query.trim() === '' ? [...list].sort((a, b) => Number(recent.includes(b.exercise.id)) - Number(recent.includes(a.exercise.id))) : list;

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors['bg.canvas'] }}>
      <View style={{ padding: theme.space['4'], gap: theme.space['3'], backgroundColor: theme.colors['bg.surface'] }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <AppText variant="title2" accessibilityRole="header">
            {choosing ? choosing.exercise.name : 'Add exercise'}
          </AppText>
          <TextButton
            label={choosing ? 'Back' : 'Cancel'}
            tone="secondary"
            icon={choosing ? 'chevron.left' : 'xmark'}
            onPress={() => {
              if (choosing) setChoosing(null);
              else navigation.goBack();
            }}
          />
        </View>
        {choosing ? (
          <AppText variant="callout" color="text.secondary">
            Which one at this gym?
          </AppText>
        ) : (
          <TextInput
            value={query}
            onChangeText={setQuery}
            autoFocus
            placeholder="Search exercises"
            placeholderTextColor={theme.colors['text.tertiary']}
            accessibilityLabel="Search exercises"
            returnKeyType="search"
            clearButtonMode="while-editing"
            maxFontSizeMultiplier={theme.type.body.maxFontSizeMultiplier}
            style={{ minHeight: 52, paddingHorizontal: theme.space['3'], borderRadius: theme.radius.sm, borderWidth: 1, borderColor: theme.colors['border.control'], backgroundColor: theme.colors['bg.raised'], color: theme.colors['text.primary'], fontSize: theme.type.body.fontSize }}
          />
        )}
      </View>
      <ScrollView contentContainerStyle={{ padding: theme.space['4'], gap: theme.space['3'], paddingBottom: theme.space['8'] + insets.bottom }} keyboardShouldPersistTaps="handled">
        {error ? <StatusLine icon="exclamationmark.triangle" tone="warning" text={error} /> : null}
        {choosing ? (
          <Group>
            {choosing.equipment.map((e) => (
              <Row key={e.id} title={e.name} subtitle={EQUIPMENT_WORD[e.kind]} onPress={() => void add(choosing, e.id)} disabled={busy} />
            ))}
          </Group>
        ) : ordered.length === 0 ? (
          <AppText variant="callout" color="text.secondary">
            No exercise matches. Custom exercises come with the exercise library.
          </AppText>
        ) : (
          <Group>
            {ordered.map((p) => (
              <Row
                key={p.exercise.id}
                title={p.exercise.name}
                subtitle={
                  p.equipment.length === 0
                    ? p.exercise.compatibleEquipment.length === 0
                      ? 'No equipment needed'
                      : 'Not at this gym · loads won’t be checked'
                    : p.equipment.map((e) => e.name).join(' · ')
                }
                secondLine={recent.includes(p.exercise.id) && query.trim() === '' ? 'Recent' : null}
                onPress={() => {
                  choose(p);
                }}
                disabled={busy}
              />
            ))}
          </Group>
        )}
      </ScrollView>
    </View>
  );
}
