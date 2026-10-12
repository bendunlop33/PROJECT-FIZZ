import { useNavigation } from '@react-navigation/native';
import { useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';

import type { MuscleGroup } from '@fizz/domain';

import { useScreenData } from '../../shell/context';
import { useTheme } from '../../theme';
import { AppText, Chip, Icon, StatusLine, TextButton, TextField } from '../../ui';

/**
 * Exercises (progress.md §2.6, slice B): exercises with a finished session,
 * by last done; search, and body-part filter chips that wrap at AX sizes.
 * Each row opens exercise detail. Local only.
 */
export function ExercisesScreen() {
  const theme = useTheme();
  const navigation = useNavigation();
  const [query, setQuery] = useState('');
  const [group, setGroup] = useState<MuscleGroup | null>(null);
  const [data, reload] = useScreenData((s) => s.progress.exercises({ query, group }));

  const view = data.state === 'ready' ? (data.value?.view ?? null) : null;
  return (
    <ScrollView
      contentInsetAdjustmentBehavior="automatic"
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
      style={{ backgroundColor: theme.colors['bg.canvas'] }}
      contentContainerStyle={{ paddingHorizontal: theme.components.screenMargin, paddingTop: theme.space['3'], paddingBottom: theme.space['8'], gap: theme.space['4'] }}
    >
      <TextField
        value={query}
        placeholder="Search"
        returnKeyType="search"
        clearButtonMode="while-editing"
        autoCorrect={false}
        accessibilityLabel="Search exercises"
        onChangeText={(t) => {
          setQuery(t);
          reload();
        }}
      />
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.space['2'] }} accessibilityRole="tablist" accessibilityLabel="Body part">
        {(view?.groups ?? []).map((g) => (
          <Chip
            key={g.label}
            label={g.label}
            selected={g.key === group}
            onPress={() => {
              setGroup(g.key);
              reload();
            }}
          />
        ))}
      </View>
      {data.state === 'error' ? (
        <StatusLine icon="exclamationmark.triangle" tone="warning" text="Couldn’t open your training data." info={data.message} infoLabel="Error details" action={<TextButton label="Try again" onPress={reload} />} />
      ) : null}
      {view?.empty === true ? (
        <AppText variant="body" color="text.secondary">
          Nothing logged yet.
        </AppText>
      ) : null}
      {view?.noMatches !== null && view?.noMatches !== undefined ? (
        <AppText variant="body" color="text.secondary">
          {view.noMatches}
        </AppText>
      ) : null}
      <View>
        {(view?.rows ?? []).map((r) => (
          <Pressable
            key={r.exerciseId}
            accessibilityRole="button"
            accessibilityLabel={r.words}
            onPress={() => {
              navigation.navigate('Tabs', { screen: 'Progress', params: { screen: 'ProgressExercise', params: { exerciseId: r.exerciseId, name: r.name } } });
            }}
            style={({ pressed }) => ({
              minHeight: theme.target.min.height,
              paddingVertical: theme.space['3'],
              flexDirection: 'row',
              alignItems: 'center',
              gap: theme.space['3'],
              borderTopWidth: theme.dividerWidth,
              borderTopColor: theme.colors['border.divider'],
              backgroundColor: pressed ? theme.colors['bg.raised'] : 'transparent',
            })}
          >
            <View style={{ flex: 1, gap: 2 }}>
              <AppText variant="body">{r.name}</AppText>
              <AppText variant="callout" color="text.secondary" numeric>
                {r.line}
              </AppText>
            </View>
            <Icon name="chevron.right" color="text.tertiary" size={14} />
          </Pressable>
        ))}
      </View>
    </ScrollView>
  );
}
