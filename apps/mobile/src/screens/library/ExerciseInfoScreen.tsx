import { useFocusEffect, useIsFocused, useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Pressable, ScrollView, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { addExercise, SLOT_SET_LIMITS, toMs, type AddDestination } from '@fizz/domain';

import { recordContainedError } from '../../diagnostics/crash-capture';
import { newUuid } from '../../device/runtime';
import { GuideBoundary } from '../../guide/GuideBoundary';
import { buildHowToView, bundledHowToSources } from '../../guide/how-to';
import { loadGuidePlayer } from '../../guide/load-player';
import type { ExerciseInfoParams, LibraryToastParam } from '../../navigation/types';
import { ResumeBar } from '../../progress/components';
import type { LibraryAddShape, LibraryDestinations, LibraryUndo } from '../../services/library-service';
import { useDataChanged, useScreenData, useServices } from '../../shell/context';
import { TIMING, useTheme } from '../../theme';
import { AppText, BottomCard, Card, DomainLabel, EffortSheet, Icon, PrimaryButton, Row, SecondaryButton, SetShapeControl, ShapeRepsSheet, StatusLine, Tag, TextButton, Toast } from '../../ui';
import { addEffortRow, addPrimary, addRepsRow, EXERCISE_INFO_COPY, initialAddShape, posterSize, repsDraftOfShape, slotShapeOfAdd } from '../../workout/exercise-info-view';
import { takeLibraryToast } from '../../workout/library-toast';
import { SET_SHAPE_COPY } from '../../workout/set-shape-view';

type Toasting = { text: string; undo?: LibraryUndo } | null;

/**
 * Exercise detail (exercise-library §9.4, EL11–EL14): header, `Add to a
 * workout`, then `Coaching knowledge` (a still guide poster that never
 * animates here, muscles, three cues, three don'ts, `Full how-to ›`) and
 * `Your data` (pain, Progress's own last/best/Est. 1RM for one named
 * series, `Progress and records ›`, `Used in`). Pushed in the Library and
 * Progress stacks, and over the editor (read-only). Local only; nothing
 * waits on a network or the coach.
 */
export function ExerciseInfoScreen() {
  const theme = useTheme();
  const services = useServices();
  const changed = useDataChanged();
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const route = useRoute<RouteProp<{ Info: ExerciseInfoParams }, 'Info'>>();
  const { exerciseId, readOnly } = route.params;
  const inProgressStack = (route.name as string) === 'ProgressExerciseInfo';
  const [data, reload] = useScreenData((s) => s.library.detail(exerciseId));
  const [toast, setToast] = useState<Toasting>(null);
  const [adding, setAdding] = useState(false);
  const [toastAction, setToastAction] = useState<(() => void) | null>(null);

  // The editor's `Saved <name>` [Undo] after `New workout` (handed off in memory).
  useFocusEffect(
    useCallback(() => {
      const t = takeLibraryToast();
      if (t !== null) showEditorToast(t);
    }, []),
  );
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => {
      setToast(null);
    }, TIMING.undoToast);
    return () => {
      clearTimeout(t);
    };
  }, [toast]);

  function showEditorToast(t: LibraryToastParam) {
    const undo = t.undo;
    if (undo === null || undo.kind === 'revert') {
      setToastAction(null);
      setToast(undo === null ? { text: t.text } : { text: t.text, undo: { kind: 'routine', actionId: undo.actionId } });
      return;
    }
    // A new workout's Undo deletes it (as the Workouts list's toast does).
    setToastAction(() => () => {
      void services.routines.remove({ routineId: undo.routineId, expectedVersion: undo.version, opId: newUuid() }).then((r) => {
        changed();
        reload();
        if (!r.ok) setToast({ text: r.message });
      });
    });
    setToast({ text: t.text });
  }

  const d = data.state === 'ready' ? data.value : null;
  const view = d?.view ?? null;

  if (data.state === 'loading') return <View style={{ flex: 1, backgroundColor: theme.colors['bg.canvas'] }} />;
  if (d === null || view === null) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.colors['bg.canvas'], padding: theme.components.screenMargin }}>
        <StatusLine icon="exclamationmark.triangle" tone="warning" text={EXERCISE_INFO_COPY.loadFailed} action={<TextButton label={EXERCISE_INFO_COPY.tryAgain} onPress={reload} />} />
      </View>
    );
  }
  const resumeShown = d.resume !== null;

  function undoToast() {
    const t = toast;
    setToast(null);
    if (toastAction !== null) {
      toastAction();
      setToastAction(null);
      return;
    }
    if (t?.undo === undefined) return;
    void services.library.undoAdd({ undo: t.undo, opId: newUuid() }).then((r) => {
      changed();
      reload();
      if (!r.ok) setToast({ text: r.message });
    });
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors['bg.canvas'] }}>
      <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ paddingHorizontal: theme.components.screenMargin, paddingTop: theme.space['3'], paddingBottom: theme.space['8'] + (resumeShown ? 0 : insets.bottom), gap: theme.space['4'] }}>
        <View style={{ gap: theme.space['1'] }}>
          <AppText variant="title2" accessibilityRole="header">
            {view.title}
          </AppText>
          {view.subtitle !== '' ? (
            <AppText variant="callout" color="text.secondary">
              {view.subtitle}
            </AppText>
          ) : null}
          {view.aliasesLine !== null ? (
            <AppText variant="callout" color="text.secondary" numberOfLines={1}>
              {view.aliasesLine}
            </AppText>
          ) : null}
          {d.editable && readOnly !== true ? (
            <View style={{ alignItems: 'flex-start' }}>
              <TextButton label={EXERCISE_INFO_COPY.edit} onPress={() => { navigation.navigate('ExerciseForm', { exerciseId }); }} />
            </View>
          ) : null}
          {view.tags.length > 0 || view.yours.pain !== null ? (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.space['2'], paddingTop: theme.space['1'] }}>
              {view.tags.map((t) => (
                <Tag key={t.kind} text={t.text} />
              ))}
              {view.yours.pain !== null ? <Tag icon="exclamationmark.triangle" text="May hurt" /> : null}
            </View>
          ) : null}
        </View>
        {readOnly === true ? null : resumeShown ? (
          <SecondaryButton label={EXERCISE_INFO_COPY.addToWorkout} onPress={() => { setAdding(true); }} />
        ) : (
          <PrimaryButton label={EXERCISE_INFO_COPY.addToWorkout} onPress={() => { setAdding(true); }} />
        )}

        <DomainLabel domain="coachingKnowledge" />
        {view.knowledge.poster !== null ? <GuidePoster catalogueKey={view.knowledge.poster.catalogueKey} name={view.title} onPlay={d.howTo === null ? null : () => { navigation.navigate('HowTo', d.howTo as { catalogueKey: string; name: string }); }} /> : null}
        {view.knowledge.muscles.map((m) => (
          <AppText key={m.label} variant="callout" color="text.secondary">
            {`${m.label} ${m.list}`}
          </AppText>
        ))}
        <Bullets title={EXERCISE_INFO_COPY.howToDo} items={view.knowledge.cues} icon={null} />
        <Bullets title={EXERCISE_INFO_COPY.whatNot} items={view.knowledge.avoid} icon="xmark" />
        {d.howTo !== null ? <Row title={EXERCISE_INFO_COPY.fullHowTo} onPress={() => { navigation.navigate('HowTo', d.howTo as { catalogueKey: string; name: string }); }} /> : null}

        <DomainLabel domain="yourData" />
        {view.yours.pain !== null ? (
          <Row
            title={view.yours.pain.text}
            icon="exclamationmark.triangle"
            iconColor="status.warning"
            onPress={() => {
              navigation.navigate('PainFlag', { flagId: view.yours.pain?.flagId ?? '' });
            }}
          />
        ) : null}
        {view.yours.history !== null ? (
          <View style={{ gap: theme.space['2'] }}>
            <AppText variant="callout" color="text.secondary">
              {view.yours.history.caption}
            </AppText>
            {view.yours.history.rows.map((r) => (
              <View key={r.label} accessible accessibilityLabel={`${r.label}${r.estimate ? ', an estimate,' : ''} ${r.value.replace('≈', 'about ')}`} style={{ flexDirection: 'row', gap: theme.space['3'], minHeight: 28 }}>
                <AppText variant="body" color="text.secondary" style={{ minWidth: 88 }}>
                  {r.label}
                </AppText>
                <AppText variant="body" numeric style={{ flex: 1 }}>
                  {r.value}
                </AppText>
              </View>
            ))}
            {view.yours.history.workouts !== '' ? (
              <AppText variant="callout" color="text.secondary" numeric>
                {view.yours.history.workouts}
              </AppText>
            ) : null}
            {d.progress !== null ? (
              <Row
                title={EXERCISE_INFO_COPY.progress}
                onPress={() => {
                  if (inProgressStack) navigation.goBack();
                  else navigation.navigate('ExerciseProgress', { exerciseId: d.exercise.id, name: d.exercise.name });
                }}
              />
            ) : null}
          </View>
        ) : (
          <AppText variant="body" color="text.secondary">
            {view.yours.empty}
          </AppText>
        )}
        {view.yours.usedIn.length > 0 ? (
          <View style={{ gap: theme.space['1'] }}>
            <AppText variant="callout" color="text.secondary">
              {EXERCISE_INFO_COPY.usedIn}
            </AppText>
            {view.yours.usedIn.map((u) => (
              <Row
                key={u.routineId}
                title={u.name}
                onPress={() => {
                  navigation.navigate('WorkoutOverview', { target: { kind: 'routine', routineId: u.routineId } });
                }}
              />
            ))}
          </View>
        ) : null}
      </ScrollView>
      {toast ? (
        <View style={{ position: 'absolute', left: 0, right: 0, bottom: (resumeShown ? 64 : insets.bottom) + theme.space['2'] }}>
          <Toast icon="info.circle" text={toast.text} {...(toast.undo !== undefined || toastAction !== null ? { action: EXERCISE_INFO_COPY.undo, onAction: undoToast } : {})} />
        </View>
      ) : null}
      {d.resume !== null ? (
        <ResumeBar
          bar={d.resume}
          now={() => toMs(services.now().utc)}
          onResume={() => {
            navigation.navigate('Workout');
          }}
        />
      ) : null}
      {readOnly === true ? null : (
        <AddToWorkoutSheet
          visible={adding}
          exerciseId={exerciseId}
          name={d.exercise.name}
          perSide={d.exercise.laterality === 'unilateral'}
          measurement={d.exercise.measurement}
          defaultShape={d.defaultShape}
          effortScale={d.effortScale}
          mayHurt={d.mayHurt}
          onClose={() => {
            setAdding(false);
          }}
          onAdded={(text, undo) => {
            setAdding(false);
            changed();
            reload();
            setToastAction(null);
            setToast(undo === null ? { text } : { text, undo });
          }}
          onNewWorkout={(shape) => {
            setAdding(false);
            const exercises = addExercise([], { id: d.exercise.id, measurement: d.exercise.measurement }, newUuid, slotShapeOfAdd(shape));
            navigation.navigate('WorkoutEditor', { routineId: null, from: 'ExerciseInfo', draft: { name: '', exercises } });
          }}
        />
      )}
    </View>
  );
}

function Bullets({ title, items, icon }: { title: string; items: readonly string[]; icon: 'xmark' | null }) {
  const theme = useTheme();
  if (items.length === 0) return null;
  return (
    <View style={{ gap: theme.space['2'] }}>
      <AppText variant="sectionLabel" color="text.tertiary" accessibilityRole="header">
        {title}
      </AppText>
      {items.map((text) => (
        <View key={text} style={{ flexDirection: 'row', gap: theme.space['2'] }}>
          <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={{ paddingTop: 3 }}>
            {icon === null ? (
              <AppText variant="body" color="text.secondary">
                •
              </AppText>
            ) : (
              <Icon name={icon} size={16} color="text.secondary" />
            )}
          </View>
          <AppText variant="body" style={{ flex: 1 }}>
            {text}
          </AppText>
        </View>
      ))}
    </View>
  );
}

/**
 * `GuidePoster` (design-system §9.90, EL12): the guide's key position 1 as a
 * still; it never animates here, under any setting. `▷ Play` opens How to.
 * The player is required behind its guard; a failure leaves no poster, and
 * the cues still show.
 */
function GuidePoster({ catalogueKey, name, onPlay }: { catalogueKey: string; name: string; onPlay: (() => void) | null }) {
  const theme = useTheme();
  const focused = useIsFocused();
  const { width } = useWindowDimensions();
  const view = useMemo(() => buildHowToView({ name, catalogueKey }, bundledHowToSources()), [name, catalogueKey]);
  const player = view.guide === null ? null : loadGuidePlayer();
  const [failed, setFailed] = useState(false);
  const onError = useCallback((error: unknown) => {
    recordContainedError(error, 'guide');
    setFailed(true);
  }, []);
  const Player = player?.ok === true && !failed ? player.value : null;
  if (view.guide === null || Player === null) return null;
  const size = posterSize(width, theme.components.screenMargin, theme.space['3']);
  return (
    <Card style={{ padding: theme.space['3'], gap: theme.space['3'], alignItems: 'center' }}>
      {view.guide.draftLabel !== null ? (
        <View style={{ alignSelf: 'flex-start' }}>
          <Tag text={view.guide.draftLabel} />
        </View>
      ) : null}
      <GuideBoundary onError={onError}>
        <Player guide={view.guide} size={size} visible={focused} poster />
      </GuideBoundary>
      {onPlay !== null ? (
        <View style={{ alignSelf: 'stretch' }}>
          <SecondaryButton label={EXERCISE_INFO_COPY.play} icon="play.fill" onPress={onPlay} accessibilityLabel="Play guide" />
        </View>
      ) : null}
    </Card>
  );
}

/**
 * `AddToWorkoutSheet` (§9.5, design-system §9.91): the `SetShapeControl`,
 * `NOW` (the workout in progress) and `YOUR WORKOUTS`, `New workout`; the
 * primary names the destination. Nothing is preselected. A flagged exercise
 * asks first (EL9); an exercise this gym can't do asks before an add to the
 * workout in progress (§4.2). One opId per destination and shape, so a retry
 * is the same write.
 */
function AddToWorkoutSheet({
  visible,
  exerciseId,
  name,
  perSide,
  measurement,
  defaultShape,
  effortScale,
  mayHurt,
  onClose,
  onAdded,
  onNewWorkout,
}: {
  visible: boolean;
  exerciseId: string;
  name: string;
  perSide: boolean;
  measurement: 'reps' | 'duration' | 'distance' | 'cardio';
  defaultShape: Parameters<typeof initialAddShape>[0];
  effortScale: 'rpe' | 'rir' | null;
  mayHurt: { title: string; message: string; confirm: string; cancel: string } | null;
  onClose: () => void;
  onAdded: (text: string, undo: LibraryUndo | null) => void;
  onNewWorkout: (shape: LibraryAddShape) => void;
}) {
  const theme = useTheme();
  const services = useServices();
  const [shape, setShape] = useState<LibraryAddShape>(() => initialAddShape(defaultShape, effortScale, measurement));
  const [dest, setDest] = useState<LibraryDestinations | null>(null);
  const [selected, setSelected] = useState<AddDestination | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sub, setSub] = useState<'reps' | 'effort' | null>(null);
  const opIds = useRef(new Map<string, string>());

  const load = useCallback(() => {
    void services.library
      .destinations(exerciseId)
      .then((r) => {
        setDest(r);
        setSelected((cur) => (cur === null || r === null ? null : ([...(r.destinations.now ? [r.destinations.now] : []), ...r.destinations.workouts].find((x) => x.id === cur.id && !x.disabled) ?? null)));
      })
      .catch(() => {
        setDest(null);
      });
  }, [services, exerciseId]);
  useEffect(() => {
    if (!visible) return;
    setShape(initialAddShape(defaultShape, effortScale, measurement));
    setSelected(null);
    setError(null);
    opIds.current = new Map();
    load();
  }, [visible]);

  const primary = addPrimary(selected);
  const repsRow = measurement === 'distance' ? null : addRepsRow(shape, perSide);
  const effortRow = addEffortRow(shape, effortScale);

  async function write(target: AddDestination) {
    if (target.kind === 'new') {
      onNewWorkout(shape);
      return;
    }
    const key = `${target.id ?? ''}:${JSON.stringify(shape)}`;
    const opId = opIds.current.get(key) ?? newUuid();
    opIds.current.set(key, opId);
    setBusy(true);
    setError(null);
    const r = await services.library.addToWorkout({
      exerciseId,
      shape,
      to: target.kind === 'session' ? { kind: 'session', sessionId: target.id ?? '' } : { kind: 'routine', routineId: target.id ?? '', expectedVersion: target.version ?? 0 },
      opId,
    });
    setBusy(false);
    if (r.ok) {
      onAdded(r.toast, r.undo);
      return;
    }
    setError(r.message);
    // Changed since the sheet read it (rule 5): the list re-reads; nothing was written.
    if (r.reason === 'stale' || r.reason === 'already') load();
  }

  function confirmThen(target: AddDestination) {
    const notHere = target.kind === 'session' ? (dest?.notAtGym ?? null) : null;
    const ask = (title: string, message: string | undefined, yes: string, no: string, then: () => void) => {
      Alert.alert(title, message, [
        { text: no, style: 'cancel' },
        { text: yes, onPress: then },
      ]);
    };
    const go = () => void write(target);
    if (mayHurt !== null && notHere !== null) {
      ask(mayHurt.title, `${mayHurt.message}\n${notHere}`, EXERCISE_INFO_COPY.addAnyway, mayHurt.cancel, go);
      return;
    }
    if (mayHurt !== null) {
      ask(mayHurt.title, mayHurt.message, mayHurt.confirm, mayHurt.cancel, go);
      return;
    }
    if (notHere !== null) {
      ask(notHere, undefined, EXERCISE_INFO_COPY.addAnyway, EXERCISE_INFO_COPY.cancel, go);
      return;
    }
    go();
  }

  const rows = dest === null ? [] : dest.destinations.workouts;
  return (
    <BottomCard visible={visible} onClose={onClose} closeLabel={EXERCISE_INFO_COPY.cancel}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space['2'] }}>
        <AppText variant="title2" accessibilityRole="header" style={{ flex: 1 }} numberOfLines={2}>
          {EXERCISE_INFO_COPY.addTitle(name)}
        </AppText>
        <TextButton label={EXERCISE_INFO_COPY.cancel} tone="secondary" onPress={onClose} />
      </View>
      <ScrollView style={{ flexShrink: 1 }} contentContainerStyle={{ gap: theme.space['3'] }}>
        <SetShapeControl
          workingSets={shape.workingSets}
          warmups={shape.warmups}
          setsLimits={SLOT_SET_LIMITS.working}
          warmupLimits={SLOT_SET_LIMITS.warmups}
          onSets={(n) => {
            setShape((s) => ({ ...s, workingSets: n }));
          }}
          onWarmups={(n) => {
            setShape((s) => ({ ...s, warmups: n }));
          }}
          reps={repsRow === null ? null : { ...repsRow, onPress: () => { setSub('reps'); } }}
          effort={effortRow === null ? null : { ...effortRow, onPress: () => { setSub('effort'); } }}
        />
        {dest?.destinations.now ? (
          <View>
            <AppText variant="sectionLabel" color="text.tertiary" accessibilityRole="header">
              {EXERCISE_INFO_COPY.now}
            </AppText>
            <Radio d={dest.destinations.now} selected={selected?.id === dest.destinations.now.id} onPress={setSelected} />
          </View>
        ) : null}
        <View>
          <AppText variant="sectionLabel" color="text.tertiary" accessibilityRole="header">
            {EXERCISE_INFO_COPY.yourWorkouts}
          </AppText>
          {rows.map((w) => (
            <Radio key={w.id ?? 'new'} d={w} selected={selected?.id === w.id && selected.kind === w.kind} onPress={setSelected} />
          ))}
          {dest !== null ? <Radio d={dest.destinations.newWorkout} selected={selected?.kind === 'new'} onPress={setSelected} /> : null}
        </View>
        {error !== null ? <StatusLine icon="exclamationmark.triangle" tone="warning" text={error} /> : null}
      </ScrollView>
      <PrimaryButton
        label={primary.label}
        disabled={primary.disabled}
        busy={busy}
        onPress={() => {
          if (selected !== null) confirmThen(selected);
        }}
      />
      {/* Nested in this sheet's modal, so iOS presents them over it. */}
      <ShapeRepsSheet
        visible={sub === 'reps'}
        title={EXERCISE_INFO_COPY.repsTitle(name)}
        start={repsDraftOfShape(shape)}
        onDone={(v) => {
          setShape((s) => ('cardio' in v ? { ...s, durationS: v.cardio.durationS, distanceM: v.cardio.distanceM, reps: null, repsTouched: true } : 'reps' in v ? { ...s, reps: v.reps, durationS: null, repsTouched: true } : { ...s, durationS: v.durationS, reps: null, repsTouched: true }));
          setSub(null);
        }}
        onClose={() => {
          setSub(null);
        }}
      />
      {effortScale !== null ? (
        <EffortSheet
          visible={sub === 'effort'}
          scale={effortScale}
          title={EXERCISE_INFO_COPY.effortTitle(effortScale === 'rpe' ? SET_SHAPE_COPY.targetRpe : SET_SHAPE_COPY.targetRir, name)}
          value={shape.effort.value}
          onPick={(v) => {
            setShape((s) => ({ ...s, effort: { scale: effortScale, value: v } }));
          }}
          onClose={() => {
            setSub(null);
          }}
        />
      ) : null}
    </BottomCard>
  );
}

/** `RadioRow` (§9.91), ≥ 52pt: `circle` / `largecircle.fill.circle`; a disabled row says why. */
function Radio({ d, selected, onPress }: { d: AddDestination; selected: boolean; onPress: (d: AddDestination) => void }) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected, disabled: d.disabled }}
      accessibilityLabel={[d.label, d.detail, d.disabledText].filter((x) => x !== null).join(', ')}
      disabled={d.disabled}
      onPress={() => {
        onPress(d);
      }}
      style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', minHeight: 52, gap: theme.space['3'], opacity: pressed ? 0.7 : 1 })}
    >
      <Icon name={selected ? 'largecircle.fill.circle' : 'circle'} color={d.disabled ? 'text.tertiary' : selected ? 'accent' : 'text.secondary'} size={22} />
      <View style={{ flex: 1 }}>
        <AppText variant="body" color={d.disabled ? 'text.secondary' : 'text.primary'}>
          {d.label}
        </AppText>
        {d.detail !== null ? (
          <AppText variant="callout" color="text.secondary">
            {d.detail}
          </AppText>
        ) : null}
      </View>
      {d.disabledText !== null ? (
        <AppText variant="callout" color="text.secondary">
          {d.disabledText}
        </AppText>
      ) : null}
    </Pressable>
  );
}
