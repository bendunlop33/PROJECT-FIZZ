import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { NO_FILTERS, toMs, withBroadGroup, type BrowseRowView, type ExerciseFilters } from '@fizz/domain';

import { useDevicePrefs } from '../../device/DevicePrefsContext';
import { EXERCISE_FORM_COPY } from '../../library/exercise-form-view';
import type { LibrarySegment, LibraryStackParams } from '../../navigation/types';
import { ResumeBar, Segmented } from '../../progress/components';
import { useScreenData, useServices } from '../../shell/context';
import { TIMING, useTheme } from '../../theme';
import { AppText, BottomCard, Chip, ChipRow, Icon, StatusLine, TextButton, TextField } from '../../ui';
import { filterChipLabel, filterOptions, filterValues, LIBRARY_BROWSE_COPY, muscleChips, toggled, withFilter, type FilterKind } from '../../workout/library-browse-view';
import { NewWorkoutButton, WorkoutsList } from '../routines/WorkoutsScreen';
import { PlanTab } from './PlanTab';

/**
 * The Library tab (exercise-library §9, EL10; Ben, 22 Oct: `Plan | Workouts |
 * Exercises`): `Plan` (Your plan, or `Set up a plan`; Previous plans with
 * `Start again`, `PlanTab`), `Workouts` (the Workouts list; the header's `＋`
 * is `New workout`) and `Exercises` (every exercise, the muscle chip row,
 * search with aliases and typos, filters; a row opens Exercise detail).
 * Remembers its last segment on this phone. Nothing here needs a network or
 * the coach (rule 1) except Plan's coach hand-off; it never animates. The
 * `ResumeBar` shows while a workout is unfinished.
 */
export function LibraryScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const route = useRoute<RouteProp<LibraryStackParams, 'LibraryHome'>>();
  const { prefs, update } = useDevicePrefs();
  const asked = route.params?.segment;
  const [segment, setSegment] = useState<LibrarySegment>(asked ?? prefs.librarySegment);
  useEffect(() => {
    if (asked !== undefined) {
      setSegment(asked);
      update({ librarySegment: asked });
    }
  }, [asked, route.params?.toast?.key, route.params?.plan]);

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors['bg.canvas'], paddingTop: insets.top }}>
      <View style={{ paddingHorizontal: theme.components.screenMargin, paddingTop: theme.space['3'], gap: theme.space['3'] }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 44 }}>
          <AppText variant="title1" accessibilityRole="header" style={{ flex: 1 }}>
            {LIBRARY_BROWSE_COPY.title}
          </AppText>
          {/* `＋` (§9.3, review B1): `New workout` on Workouts; `New exercise` on Exercises (Ben, 19 Oct). */}
          {segment === 'workouts' ? <NewWorkoutButton from="Library" /> : segment === 'exercises' ? <NewExerciseButton /> : null}
        </View>
        <Segmented
          options={LIBRARY_BROWSE_COPY.segments}
          selected={segment}
          label={LIBRARY_BROWSE_COPY.segmentLabel}
          onSelect={(k) => {
            setSegment(k);
            update({ librarySegment: k });
          }}
        />
      </View>
      {segment === 'exercises' ? (
        <ExercisesBrowse />
      ) : segment === 'plan' ? (
        <PlanTab scrollTopKey={route.params?.plan} />
      ) : (
        <WorkoutsList
          from="Library"
          handedToast={route.params?.toast}
          onHandedToast={() => {
            navigation.setParams({ toast: undefined } as never);
          }}
        />
      )}
    </View>
  );
}

function ExercisesBrowse() {
  const theme = useTheme();
  const services = useServices();
  const navigation = useNavigation();
  const stack = useNavigation<NativeStackNavigationProp<LibraryStackParams, 'LibraryHome'>>();
  const [query, setQuery] = useState('');
  const [filters, setFilters] = useState<ExerciseFilters>(NO_FILTERS);
  const [sheet, setSheet] = useState<FilterKind | null>(null);
  const [placeholder, setPlaceholder] = useState(false);
  const [data, reload] = useScreenData((s) => s.library.browse({ query, filters }));
  useEffect(() => {
    reload();
  }, [query, filters, reload]);
  useEffect(() => {
    const t = setTimeout(() => {
      setPlaceholder(true);
    }, TIMING.placeholderDelay);
    return () => {
      clearTimeout(t);
    };
  }, []);

  const value = data.state === 'ready' ? data.value : null;
  const view = value?.view ?? null;
  const open = (row: BrowseRowView) => {
    stack.navigate('LibraryExercise', { exerciseId: row.exerciseId, name: row.name });
  };

  return (
    <>
      <ScrollView keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" contentContainerStyle={{ paddingHorizontal: theme.components.screenMargin, paddingTop: theme.space['3'], paddingBottom: theme.space['8'], gap: theme.space['4'] }}>
        {/* (D5) Muscle chips in one row: `All` + six broad groups, above search (prototype `renderLibrary`). */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled" accessibilityLabel={LIBRARY_BROWSE_COPY.muscle} style={{ flexGrow: 0, marginHorizontal: -theme.components.screenMargin }} contentContainerStyle={{ paddingHorizontal: theme.components.screenMargin, gap: theme.space['2'] }}>
          {muscleChips(filters).map((c) => (
            <Chip
              key={c.label}
              label={c.label}
              selected={c.selected}
              onPress={() => {
                setFilters((f) => withBroadGroup(f, c.group));
              }}
            />
          ))}
        </ScrollView>
        <TextField value={query} onChangeText={setQuery} placeholder={LIBRARY_BROWSE_COPY.search} accessibilityLabel={LIBRARY_BROWSE_COPY.search} autoCorrect={false} returnKeyType="search" clearButtonMode="while-editing" />
        {/* One horizontally scrolling chip row (Ben, 20 Oct; exercise-library.md §9). */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled" style={{ flexGrow: 0, marginHorizontal: -theme.components.screenMargin }} contentContainerStyle={{ paddingHorizontal: theme.components.screenMargin, gap: theme.space['2'] }}>
          <Chip
            label={view?.gymChip.label ?? 'Any gym'}
            selected={filters.atGym && view?.gymChip.enabled === true}
            onPress={() => {
              if (view?.gymChip.enabled === true) setFilters((f) => ({ ...f, atGym: !f.atGym }));
            }}
          />
          {(['equipment', 'movement'] as const).map((k) => (
            <Chip key={k} label={`${filterChipLabel(filters, k)} ▾`} selected={filterValues(filters, k).length > 0} onPress={() => { setSheet(k); }} accessibilityLabel={`${filterChipLabel(filters, k)}, filter`} />
          ))}
        </ScrollView>
        {data.state === 'error' || (data.state === 'ready' && view === null) ? (
          <StatusLine icon="exclamationmark.triangle" tone="warning" text={LIBRARY_BROWSE_COPY.loadFailed} action={<TextButton label={LIBRARY_BROWSE_COPY.tryAgain} onPress={reload} />} />
        ) : view === null ? (
          placeholder ? (
            <View accessibilityElementsHidden style={{ gap: theme.space['3'] }}>
              {[0, 1, 2, 3].map((i) => (
                <View key={String(i)} style={{ height: 52, borderRadius: theme.radius.sm, backgroundColor: theme.colors['bg.surface'] }} />
              ))}
            </View>
          ) : null
        ) : (
          <>
            {view.sections.map((section) => (
              <View key={section.key} style={{ gap: theme.space['1'] }}>
                <AppText variant="sectionLabel" color="text.tertiary" accessibilityRole="header" numeric>
                  {section.title}
                </AppText>
                {section.rows.map((row, i) => (
                  <BrowseRow key={row.exerciseId} row={row} first={i === 0} onPress={() => { open(row); }} />
                ))}
              </View>
            ))}
            {view.hiddenText !== null ? (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: theme.space['2'] }}>
                <AppText variant="callout" color="text.secondary" numeric>
                  {view.hiddenText}
                </AppText>
                <TextButton label={`${LIBRARY_BROWSE_COPY.show} ›`} onPress={() => { setFilters((f) => ({ ...f, atGym: false })); }} />
              </View>
            ) : null}
            {view.empty !== null ? (
              <View style={{ gap: theme.space['2'], alignItems: 'flex-start' }}>
                <AppText variant="body" color="text.secondary">
                  {view.empty}
                </AppText>
                {view.canClear ? <TextButton label={LIBRARY_BROWSE_COPY.clearFilters} onPress={() => { setFilters(NO_FILTERS); }} /> : null}
                {query.trim() !== '' ? <TextButton icon="plus" label={EXERCISE_FORM_COPY.createNamed(query.trim())} onPress={() => { navigation.navigate('ExerciseForm', { name: query.trim() }); }} /> : null}
              </View>
            ) : null}
          </>
        )}
      </ScrollView>
      {value?.resume ? (
        <ResumeBar
          bar={value.resume}
          now={() => toMs(services.now().utc)}
          onResume={() => {
            navigation.navigate('Workout');
          }}
        />
      ) : null}
      <FilterSheet
        kind={sheet}
        selected={sheet === null ? [] : filterValues(filters, sheet)}
        onChange={(keys) => {
          if (sheet !== null) setFilters((f) => withFilter(f, sheet, keys));
        }}
        onClose={() => {
          setSheet(null);
        }}
      />
    </>
  );
}

/** `＋` on Exercises (§9.3; Ben, 19 Oct): `New exercise`. */
function NewExerciseButton() {
  const navigation = useNavigation();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={EXERCISE_FORM_COPY.newExercise}
      onPress={() => {
        navigation.navigate('ExerciseForm', {});
      }}
      style={{ minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' }}
    >
      <Icon name="plus" color="text.primary" size={22} />
    </Pressable>
  );
}

/** `ExerciseRow`, browse variant (design-system §9.89): one button, ≥ 52pt; `▷` = has a guide (decorative). */
function BrowseRow({ row, first, onPress }: { row: BrowseRowView; first: boolean; onPress: () => void }) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={row.accessibilityLabel}
      onPress={onPress}
      style={({ pressed }) => ({ minHeight: 52, paddingVertical: theme.space['2'], gap: 2, borderTopWidth: first ? 0 : theme.dividerWidth, borderTopColor: theme.colors['border.divider'], opacity: pressed ? 0.7 : 1 })}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space['2'] }}>
        <AppText variant="headline" numberOfLines={2} style={{ flex: 1 }}>
          {row.name}
        </AppText>
        {row.hasGuide ? <Icon name="play.rectangle" color="text.secondary" size={20} /> : null}
        <Icon name="chevron.right" color="text.tertiary" size={14} />
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: theme.space['2'] }}>
        {row.line2 !== '' ? (
          <AppText variant="callout" color="text.secondary">
            {row.line2}
          </AppText>
        ) : null}
        {row.tags.map((t) => (
          <View key={t.kind} style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            {t.kind === 'may_hurt' ? <Icon name="exclamationmark.triangle" color="status.warning" size={14} /> : null}
            <AppText variant="label" color={t.kind === 'may_hurt' ? 'status.warning' : 'text.secondary'}>
              {t.text}
            </AppText>
          </View>
        ))}
      </View>
      {row.line3 !== null ? (
        <AppText variant="callout" color="text.secondary" numeric>
          {row.line3}
        </AppText>
      ) : null}
    </Pressable>
  );
}

/** A filter sheet (§2.3): multi-select chips, `Clear`, `Done`. */
function FilterSheet({ kind, selected, onChange, onClose }: { kind: FilterKind | null; selected: readonly string[]; onChange: (keys: string[]) => void; onClose: () => void }) {
  const theme = useTheme();
  const title = kind === 'muscle' ? LIBRARY_BROWSE_COPY.muscle : kind === 'equipment' ? LIBRARY_BROWSE_COPY.equipment : LIBRARY_BROWSE_COPY.movement;
  return (
    <BottomCard visible={kind !== null} onClose={onClose} closeLabel={LIBRARY_BROWSE_COPY.done}>
      {kind !== null ? (
        <View style={{ gap: theme.space['4'] }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space['2'] }}>
            <AppText variant="title2" accessibilityRole="header" style={{ flex: 1 }}>
              {title}
            </AppText>
            <TextButton label={LIBRARY_BROWSE_COPY.clear} tone="secondary" onPress={() => { onChange([]); }} />
            <TextButton label={LIBRARY_BROWSE_COPY.done} onPress={onClose} />
          </View>
          <ChipRow>
            {filterOptions(kind).map((o) => (
              <Chip key={o.key} label={o.label} selected={selected.includes(o.key)} onPress={() => { onChange(toggled(selected, o.key)); }} />
            ))}
          </ChipRow>
        </View>
      ) : null}
    </BottomCard>
  );
}
