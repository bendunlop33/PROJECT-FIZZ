import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import { useEffect, useState } from 'react';
import { ActionSheetIOS, Pressable, ScrollView, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { EQUIPMENT_WORD, pickerEquipmentLabel, pickerSections } from '@fizz/domain';

import { newUuid } from '../../device/runtime';
import { bundledHowToSources, hasHowTo } from '../../guide/how-to';
import { returnToWorkout } from '../../navigation/actions';
import type { RootStackParams } from '../../navigation/types';
import type { PickerExercise } from '../../services/workout-services';
import { useDataChanged, useServices } from '../../shell/context';
import { useTheme } from '../../theme';
import { AppText, Chip, Group, Icon, Row, SectionHeader, SetCountBar, SheetKeyboardAvoidingView, StatusLine, TEXT_PRESSED_OPACITY, TextButton, useKeyboardVisible } from '../../ui';
import { pickerEmptyText, type PickerLoad } from '../../workout/picker-empty';
import { pickerAddSets, pickerBarValue, SET_BAR, type PickerSetsBar } from '../../workout/set-shape-view';
import { supersetPickerView } from '../../workout/superset-picker';
import { UNDO_TOAST } from '../../workout/undo-op';

/**
 * Exercise picker (active-workout §2.10): recent, then the common lifts,
 * then the whole bundled catalogue A–Z (audit F4). The saved list shows at
 * once; the catalogue joins it a moment later (its first read is slower).
 * Exercises with a guide or cues get an ⓘ button that opens How to.
 * Choosing one calls `addExercise` once (opId per choice). When the gym has
 * more than one compatible item, Ben picks which; with none, the exercise is
 * added without equipment and loads aren't checked. An exercise with an
 * active pain flag is tagged `⚠ May hurt` and asks before it's added (EL9);
 * the row is never hidden and similar movements are never tagged.
 * The `Sets [−] 3 [+]` bar (exercise-library §10.2) sets how many pending
 * working sets the add makes; it starts at 3 each time, and a row tap still
 * adds in one tap.
 *
 * `Superset with…` (Ben, 19 Oct; `supersetWith`): the exercises already in
 * the workout it can pair with come first (a tap links them), then the whole
 * list, the same exercise included (a tap adds it as the partner, with as
 * many sets as the exercise has left unless Ben changes the count). Both
 * apply at once and return to the workout with Undo.
 */
export function ExercisePickerScreen() {
  const theme = useTheme();
  const services = useServices();
  const changed = useDataChanged();
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const keyboard = useKeyboardVisible();
  const { sessionId, supersetWith } = useRoute<RouteProp<RootStackParams, 'ExercisePicker'>>().params;
  const [pairing, setPairing] = useState<Awaited<ReturnType<typeof services.workout.supersetChoices>>>(null);
  const [query, setQuery] = useState('');
  const [list, setList] = useState<PickerExercise[]>([]);
  const [recent, setRecent] = useState<string[]>([]);
  const [choosing, setChoosing] = useState<PickerExercise | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [opIds] = useState(() => new Map<string, string>());
  const [bar, setBar] = useState<PickerSetsBar>({ value: SET_BAR.start, touched: false });
  // `Cardio` (19 Oct): rower, bike, treadmill and the like only; one set unless Ben changes it.
  const [cardio, setCardio] = useState(false);

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
    if (supersetWith === undefined) return;
    let alive = true;
    void services.workout
      .supersetChoices(sessionId, supersetWith)
      .then((c) => {
        if (alive) setPairing(c);
      })
      .catch(() => {
        // No list of exercises to pair with: the whole list below still adds one.
      });
    return () => {
      alive = false;
    };
  }, [services, sessionId, supersetWith]);
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
    // A cardio machine adds one set unless Ben set the count (review S2).
    const sets = pickerAddSets(bar, p.exercise.measurement, barStart);
    const key = `${p.exercise.id}:${equipmentId ?? ''}:${String(sets)}`;
    const opId = opIds.get(key) ?? newUuid();
    opIds.set(key, opId);
    const r = await services.workout.addExercise({ sessionId, exerciseId: p.exercise.id, equipmentId, opId, shape: { workingSets: sets }, ...(supersetWith === undefined ? {} : { supersetWithSessionExerciseId: supersetWith }) });
    setBusy(false);
    if (!r.ok) {
      setError(`Couldn’t add ${p.exercise.name}: ${r.error.message}`);
      return;
    }
    changed();
    if (supersetWith !== undefined && pairing !== null) {
      navigation.dispatch(returnToWorkout({ toast: { kind: 'undo_op', text: UNDO_TOAST.supersetted(pairing.name, p.exercise.name), targetOpId: opId } }));
      return;
    }
    navigation.goBack();
  }

  /** An exercise already in the workout: linked into the superset (`link_superset`), with Undo. */
  async function link(partner: { sessionExerciseId: string; exerciseName: string }) {
    if (busy || supersetWith === undefined || pairing === null) return;
    setBusy(true);
    setError(null);
    const key = `link:${partner.sessionExerciseId}`;
    const opId = opIds.get(key) ?? newUuid();
    opIds.set(key, opId);
    const r = await services.workout.linkSuperset({ sessionId, sessionExerciseId: supersetWith, withSessionExerciseId: partner.sessionExerciseId, expectedVersion: pairing.version, opId });
    setBusy(false);
    if (!r.ok) {
      setError(r.error.code === 'stale_version' ? 'Your workout changed. Try again.' : r.error.message);
      // A newer workout: read the choices again so a second tap uses it.
      void services.workout.supersetChoices(sessionId, supersetWith).then(setPairing);
      return;
    }
    changed();
    navigation.dispatch(returnToWorkout({ toast: { kind: 'undo_op', text: UNDO_TOAST.supersetted(pairing.name, partner.exerciseName), targetOpId: opId } }));
  }

  /**
   * A `May hurt` row asks first (EL9, active-workout §2.14.1): `Add anyway`
   * goes on as normal, `Choose another` adds nothing and keeps the query.
   */
  function choose(p: PickerExercise) {
    const flag = p.mayHurt;
    if (flag === null) {
      chooseEquipment(p);
      return;
    }
    ActionSheetIOS.showActionSheetWithOptions({ title: flag.confirm.title, message: flag.confirm.message, options: [flag.confirm.confirm, flag.confirm.cancel], cancelButtonIndex: 1 }, (i) => {
      if (i === 0) chooseEquipment(p);
    });
  }

  function chooseEquipment(p: PickerExercise) {
    const only = p.equipment[0];
    if (p.equipment.length <= 1) {
      void add(p, only?.id ?? null);
      return;
    }
    setChoosing(p);
  }

  const sections = pickerSections(list, query, recent, { cardio });
  const pairView = supersetPickerView(pairing, query);
  const barStart = pairing?.sets ?? SET_BAR.start;

  return (
    <SheetKeyboardAvoidingView style={{ flex: 1, backgroundColor: theme.colors['bg.canvas'] }}>
      {/* 2.8: a shorter header (title2, one line; Cardio beside the search), so more results show with the keyboard up. */}
      <View style={{ paddingHorizontal: theme.components.screenMargin, paddingTop: theme.space['3'], paddingBottom: theme.space['3'], gap: theme.space['3'], backgroundColor: theme.colors['bg.canvas'] }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <AppText variant="title2" accessibilityRole="header" style={{ flex: 1 }} numberOfLines={1}>
            {choosing ? choosing.exercise.name : (pairView?.title ?? 'Add exercise')}
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
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space['2'] }}>
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder="Search exercises"
              placeholderTextColor={theme.colors['text.tertiary']}
              accessibilityLabel="Search exercises"
              returnKeyType="search"
              clearButtonMode="while-editing"
              maxFontSizeMultiplier={theme.type.body.maxFontSizeMultiplier}
              style={{ flex: 1, minHeight: 48, paddingHorizontal: theme.space['4'], borderRadius: theme.radius.pill, borderWidth: 1, borderColor: theme.colors['border.divider'], backgroundColor: theme.colors['bg.surface'], color: theme.colors['text.primary'], fontSize: theme.type.body.fontSize }}
            />
            <Chip
              label="Cardio"
              selected={cardio}
              onPress={() => {
                setCardio(!cardio);
              }}
            />
          </View>
        )}
      </View>
      <ScrollView contentContainerStyle={{ paddingHorizontal: theme.components.screenMargin, paddingTop: theme.space['2'], gap: theme.space['4'], paddingBottom: theme.space['8'] }} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
        {error ? <StatusLine icon="exclamationmark.triangle" tone="warning" text={error} /> : null}
        {!choosing && pairView !== null && pairView.partners.length > 0 ? (
          <View style={{ gap: theme.space['2'] }}>
            <SectionHeader title="In this workout" />
            <Group>
              {pairView.partners.map((x) => (
                <Row key={x.sessionExerciseId} title={x.exerciseName} subtitle={x.detail} onPress={() => void link(x)} disabled={busy} />
              ))}
            </Group>
          </View>
        ) : null}
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
                          subtitle={pickerEquipmentLabel(p.exercise, p.equipment, p.needs)}
                          {...(p.mayHurt ? { tag: { icon: 'exclamationmark.triangle', color: 'status.warning', text: 'May hurt', accessibilityLabel: p.mayHurt.accessibilityLabel } as const } : {})}
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
      {choosing ? null : (
        <View style={{ paddingHorizontal: theme.components.screenMargin, paddingBottom: keyboard ? 0 : insets.bottom, backgroundColor: theme.colors['bg.surface'] }}>
          <SetCountBar value={pickerBarValue(bar, cardio, barStart)} limits={SET_BAR.limits} onChange={(n) => { setBar({ value: n, touched: true }); }} />
        </View>
      )}
    </SheetKeyboardAvoidingView>
  );
}
