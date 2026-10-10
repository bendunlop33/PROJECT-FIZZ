import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { EQUIPMENT_WORD, pickerEquipmentLabel, pickerSections } from '@fizz/domain';

import { newUuid } from '../../device/runtime';
import { bundledHowToSources, hasHowTo } from '../../guide/how-to';
import type { RootStackParams } from '../../navigation/types';
import type { PickerExercise } from '../../services/workout-services';
import { useDataChanged, useServices } from '../../shell/context';
import { useTheme } from '../../theme';
import { AppText, Group, Icon, Row, SectionHeader, StatusLine, TextButton, TEXT_PRESSED_OPACITY } from '../../ui';
import { pickerEmptyText, type PickerLoad } from '../../workout/picker-empty';

/**
 * Exercise picker (active-workout §2.10): recent, then the common lifts,
 * then the whole bundled catalogue A–Z (audit F4). The saved list shows at
 * once; the catalogue joins it a moment later (its first read is slower).
 * Exercises with a guide or cues get an ⓘ button that opens How to.
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

  const [withCatalogue, setWithCatalogue] = useState(false);
  const [load, setLoad] = useState<PickerLoad>('loading');
  useEffect(() => {
    let alive = true;
    void services.workout
      .pickerExercises(sessionId, '', { withCatalogue })
      .then((l) => {
        if (!alive) return;
        setList(l);
        if (!withCatalogue) setWithCatalogue(true);
        else setLoad('ready');
      })
      .catch(() => {
        if (!alive) return;
        // Saved list failed: still try the whole catalogue. Catalogue failed: the saved list
        // (if any) is still shown, and an empty list says so rather than "Loading" (review S4).
        if (!withCatalogue) setWithCatalogue(true);
        else setLoad((cur) => (cur === 'loading' ? 'failed' : cur));
      });
    return () => {
      alive = false;
    };
  }, [services, sessionId, withCatalogue]);
  useEffect(() => {
    services.workout
      .recentExerciseIds()
      .then(setRecent)
      .catch(() => {
        // No recent list; the picker still works.
      });
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

  const sections = pickerSections(list, query, recent);

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors['bg.canvas'] }}>
      <View style={{ paddingHorizontal: theme.components.screenMargin, paddingTop: theme.space['5'], paddingBottom: theme.space['3'], gap: theme.space['3'], backgroundColor: theme.colors['bg.canvas'] }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <AppText variant="title1" accessibilityRole="header" style={{ flex: 1 }} numberOfLines={2}>
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
            placeholder="Search exercises"
            placeholderTextColor={theme.colors['text.tertiary']}
            accessibilityLabel="Search exercises"
            returnKeyType="search"
            clearButtonMode="while-editing"
            maxFontSizeMultiplier={theme.type.body.maxFontSizeMultiplier}
            style={{ minHeight: 48, paddingHorizontal: theme.space['4'], borderRadius: theme.radius.pill, borderWidth: 1, borderColor: theme.colors['border.divider'], backgroundColor: theme.colors['bg.surface'], color: theme.colors['text.primary'], fontSize: theme.type.body.fontSize }}
          />
        )}
      </View>
      <ScrollView contentContainerStyle={{ paddingHorizontal: theme.components.screenMargin, paddingTop: theme.space['2'], gap: theme.space['4'], paddingBottom: theme.space['8'] + insets.bottom }} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
        {error ? <StatusLine icon="exclamationmark.triangle" tone="warning" text={error} /> : null}
        {choosing ? (
          <Group>
            {choosing.equipment.map((e) => (
              <Row key={e.id} title={e.name} subtitle={EQUIPMENT_WORD[e.kind]} onPress={() => void add(choosing, e.id)} disabled={busy} />
            ))}
          </Group>
        ) : sections.length === 0 ? (
          <AppText variant="callout" color="text.secondary">
            {pickerEmptyText(load === 'failed' && list.length > 0 ? 'ready' : load, query)}
          </AppText>
        ) : (
          sections.map((section) => (
            <View key={section.title} style={{ gap: theme.space['2'] }}>
              <SectionHeader title={section.title} />
              <Group>
                {section.items.map((p) => {
                  const key = p.exercise.catalogueKey ?? null;
                  const howTo = key !== null && hasHowTo(key, bundledHowToSources()) ? key : null;
                  return (
                    <View key={p.exercise.id} style={{ flexDirection: 'row', alignItems: 'center' }}>
                      <View style={{ flex: 1 }}>
                        <Row
                          title={p.exercise.name}
                          subtitle={pickerEquipmentLabel(p.exercise, p.equipment)}
                          onPress={() => {
                            choose(p);
                          }}
                          disabled={busy}
                        />
                      </View>
                      {/* A separate 44 pt button, so tapping the row still adds the exercise in one tap (ADR 0013). */}
                      {howTo !== null ? (
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel={`How to do ${p.exercise.name}`}
                          // While an add is saving, How to would be popped with the picker when it closes (review N3).
                          disabled={busy}
                          accessibilityState={{ disabled: busy }}
                          onPress={() => {
                            navigation.navigate('HowTo', { catalogueKey: howTo, name: p.exercise.name });
                          }}
                          style={({ pressed }) => ({ width: theme.target.min.width, height: theme.target.min.height, alignItems: 'center', justifyContent: 'center', marginRight: theme.space['2'], opacity: busy ? 0.4 : pressed ? TEXT_PRESSED_OPACITY : 1 })}
                        >
                          <Icon name="info.circle" color="text.secondary" size={22} />
                        </Pressable>
                      ) : null}
                    </View>
                  );
                })}
              </Group>
            </View>
          ))
        )}
      </ScrollView>
    </View>
  );
}
