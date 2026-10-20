import { useFocusEffect, useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Pressable, ScrollView, View } from 'react-native';
import type { ReactNode } from 'react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { slotsOf, type BuilderEditOp } from '@fizz/domain';
import type { BuilderGroup, CheckInScore, SessionCheckIn } from '@fizz/schemas';

import type { BuilderSnapshot, BuilderToast, BuilderWriteResult, StartChoice, StartPrompt } from '../../builder/builder-service';
import { coachBarWord, coachStatusOf, editsFromText, promptView, workoutView, WORKOUT_COPY, type CoachBarStatus, type WorkoutRowView } from '../../builder/builder-view';
import { builderReviewProvider, runReview, type BuilderReview } from '../../builder/review';
import { newUuid } from '../../device/runtime';
import { builderPage, openStartedWorkout } from '../../navigation/actions';
import type { RootStackParams } from '../../navigation/types';
import { useDataChanged, useServices } from '../../shell/context';
import { useTheme } from '../../theme';
import { AppText, BottomCard, CheckInScale, PrimaryButton, SecondaryButton, StatusLine, TextButton, Toast, ToastHost } from '../../ui';
import { useStartAlertsAsk } from '../../alerts/AlertsAskSheet';
import { saveScore, scoreStepOf } from '../../workout/overview-start';
import { CoachBar, SwipeRow } from './BuilderParts';
import { ExerciseSheet, PromptSheet, ReviewSheet, SwapSheet, type ChoiceSection } from './BuilderSheets';

/**
 * Your workout (workout-builder-v3 §2.3): numbered rounds, supersets as
 * one box (3a/3b), `Exercise | Sets | Top set`. Tap a row for the pop-up;
 * swipe left to Delete (Undo), right to Swap; the pop-up and VoiceOver
 * actions do the same, plus Move up/down, Superset with next and Unlink
 * (drag is S4b, §9 Q18). Start asks `Use these changes for` only when the
 * structure differs from the plan day (Q11).
 */
export function BuilderWorkoutScreen() {
  const theme = useTheme();
  const services = useServices();
  const changed = useDataChanged();
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const params = useRoute<RouteProp<RootStackParams, 'BuilderWorkout'>>().params;
  const draftId = params.draftId;
  const [snap, setSnapState] = useState<BuilderSnapshot | null>(null);
  // The latest snapshot, for edits that run after the ones before them (review S4).
  const snapRef = useRef<BuilderSnapshot | null>(null);
  const setSnap = useCallback((s: BuilderSnapshot | null) => {
    snapRef.current = s;
    setSnapState(s);
  }, []);
  // Ben's edits run one at a time, each on the draft the one before left: quick taps never go stale against each other.
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const inTurn = useCallback(<T,>(run: () => Promise<T>): Promise<T> => {
    const p = queue.current.then(run, run);
    queue.current = p.catch(() => undefined);
    return p;
  }, []);
  const [coach, setCoach] = useState<CoachBarStatus>('not_connected');
  const [toast, setToast] = useState<(BuilderToast & { whyOpen: boolean }) | null>(null);
  const [popup, setPopup] = useState<string | null>(null);
  const [swap, setSwap] = useState<{ slotKey: string | null; group: BuilderGroup; groups: BuilderGroup[]; sections: ChoiceSection[] } | null>(null);
  const [prompt, setPrompt] = useState<StartPrompt | null>(null);
  const [startBusy, setStartBusy] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const [review, setReview] = useState<BuilderReview | null>(null);
  const [earlier, setEarlier] = useState<{ draftId: string; localDate: string; name: string }[]>([]);
  const [screenReader, setScreenReader] = useState(false);
  const startOp = useRef(newUuid());
  const toastLater = useRef<BuilderToast | null>(null);
  const showToastRef = useRef<(t: BuilderToast | null) => void>(() => undefined);
  const alertsAsk = useStartAlertsAsk();
  const [checkInSheet, setCheckInSheet] = useState<{ choice: StartChoice } | null>(null);
  const [scoring, setScoring] = useState(false);
  const [checkInId] = useState(newUuid);
  const [checkInOp] = useState(newUuid);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const shownKey = useRef<string | null>(null);

  const reload = useCallback(async () => {
    let s = await inTurn(() => services.builder.read(draftId));
    // The plan day changed elsewhere and Ben hasn't edited this draft: it reloads without a word (§2.3).
    if (s?.planDayChanged?.silent === true) {
      const cur = s;
      const r = await inTurn(() => services.builder.reloadPlanDay(cur.draftId, { opId: newUuid(), expectedVersion: cur.version, silent: true }));
      if (r.snapshot !== null) s = r.snapshot;
    }
    // Ben is at another gym now: the workout moves there, with `Gym changed · Undo` (§2.3).
    if (s?.gymChanged === true) {
      const cur = s;
      const r = await inTurn(() => services.builder.changeGym(cur.draftId, { opId: newUuid(), expectedVersion: cur.version }));
      if (r.snapshot !== null) s = r.snapshot;
      if (r.status === 'written' && r.toast !== null) toastLater.current = r.toast;
    }
    setSnap(s);
    if (toastLater.current !== null) {
      showToastRef.current(toastLater.current);
      toastLater.current = null;
    }
    const a = await services.coach.availability().catch(() => null);
    setCoach(coachStatusOf(a?.status ?? 'not_connected'));
    setEarlier((await services.builder.earlierEdits().catch(() => [])).filter((e) => e.draftId !== draftId));
  }, [services, draftId, inTurn, setSnap]);

  useFocusEffect(
    useCallback(() => {
      void reload();
    }, [reload]),
  );

  useEffect(() => {
    void AccessibilityInfo.isScreenReaderEnabled().then(setScreenReader);
  }, []);

  const showToast = useCallback(
    (t: BuilderToast | null) => {
      if (toastTimer.current !== null) clearTimeout(toastTimer.current);
      setToast(t === null ? null : { ...t, whyOpen: false });
      // With VoiceOver on, an Undo toast stays until dismissed (close button).
      if (t !== null && !screenReader)
        toastTimer.current = setTimeout(() => {
          setToast(null);
        }, theme.timing.undoToast);
    },
    [screenReader, theme.timing.undoToast],
  );

  showToastRef.current = showToast;

  // A toast handed back from Set up (`Rebuilt · Undo`), once.
  useEffect(() => {
    const t = params.toast;
    if (t === undefined || shownKey.current === t.key) return;
    shownKey.current = t.key;
    showToast({ text: t.text, undoOpId: t.undoOpId, why: t.why });
  }, [params.toast, showToast]);

  /** One of Ben's edits, run after any still in flight, on the snapshot the last one left (review S4). */
  function edit(input: BuilderEditOp | ((now: BuilderSnapshot) => BuilderEditOp | null)): Promise<BuilderWriteResult | null> {
    return inTurn(async () => {
      const cur = snapRef.current;
      if (cur === null) return null;
      const op = typeof input === 'function' ? input(cur) : input;
      if (op === null) return null;
      const slots = 'slotKey' in op ? [op.slotKey] : [];
      // Edits on one exercise name only that slot (rule 5: refused only if it moved); the rest name the version.
      const basis = slots.length === 1 && op.kind !== 'move' && op.kind !== 'superset_next' && op.kind !== 'unlink' && op.kind !== 'delete_exercise' ? { slots: slots.map((k) => ({ slotKey: k, rev: cur.revs[k] ?? 1 })) } : { version: cur.version };
      const r = await services.builder.edit(cur.draftId, op, { opId: newUuid(), basis });
      if (r.snapshot !== null) setSnap(r.snapshot);
      if (r.status === 'written') {
        changed();
        if (r.toast !== null) showToast(r.toast);
      } else if (r.status !== 'replayed') {
        showToast({ text: r.message, undoOpId: null, why: null });
      }
      return r;
    });
  }

  function undo(opId: string): Promise<void> {
    showToast(null);
    return inTurn(async () => {
      const cur = snapRef.current;
      if (cur === null) return;
      const r = await services.builder.undo(cur.draftId, opId, newUuid());
      if (r.snapshot !== null) setSnap(r.snapshot);
      if (r.status === 'written') changed();
      else if (r.status !== 'replayed') showToast({ text: r.message, undoOpId: null, why: null });
    });
  }

  async function openSwap(slotKey: string | null, group?: BuilderGroup) {
    if (snap === null) return;
    const c = await services.builder.exerciseChoices(snap.draftId, group === undefined ? { slotKey } : { slotKey, group });
    if (c !== null) setSwap({ slotKey, group: c.group, groups: c.groups, sections: c.sections });
  }

  async function pick(exerciseId: string) {
    if (swap === null) return;
    const op: BuilderEditOp = swap.slotKey === null ? { kind: 'add_exercise', exerciseId } : { kind: 'swap', slotKey: swap.slotKey, exerciseId };
    setSwap(null);
    await edit(op);
  }

  /**
   * The check-in before the first set (§2.1, Q1: it moved onto this page;
   * review S10): reused when there is one, asked when it's due, else not
   * asked. Null: ask Ben first (the sheet opens).
   */
  async function checkInFor(): Promise<SessionCheckIn | null | 'ask'> {
    const gate = await services.checkIns.gate().catch(() => null);
    if (gate === null) return null;
    switch (gate.kind) {
      case 'reuse':
        return { kind: 'answered', checkInId: gate.checkInId };
      case 'ask':
        return 'ask';
      case 'skip':
        return gate.reason === 'off' || gate.reason === 'not_a_check_in_day' ? { kind: 'not_asked', reason: gate.reason } : null;
    }
  }

  async function start(choice: StartChoice, given?: SessionCheckIn | null) {
    if (snap === null || startBusy) return;
    const checkIn = given === undefined ? await checkInFor() : given;
    if (checkIn === 'ask') {
      setPrompt(null);
      setCheckInSheet({ choice });
      return;
    }
    // First Start ever: the one-time Rest alerts question; either answer continues this Start.
    await alertsAsk.ensureAsked();
    setStartBusy(true);
    setStartError(null);
    const r = await services.builder.start(snap.draftId, { choice, opId: startOp.current, expectedVersion: snap.version, checkIn });
    setStartBusy(false);
    if (r.ok) {
      setPrompt(null);
      setCheckInSheet(null);
      changed();
      navigation.dispatch(openStartedWorkout());
      return;
    }
    // Nothing was created: the same op ID may try again only for the same choice.
    startOp.current = newUuid();
    if (r.reason === 'stale') {
      setPrompt(null);
      await reload();
      showToast({ text: r.message, undoOpId: null, why: null });
      return;
    }
    if (prompt !== null) setStartError(r.message);
    else showToast({ text: r.message, undoOpId: null, why: null });
  }

  async function onStart() {
    if (snap === null) return;
    const p = await services.builder.startPrompt(snap.draftId);
    if (p === null) await start({ kind: 'today' });
    else {
      setStartError(null);
      setPrompt(p);
    }
  }

  async function openReview() {
    if (snap === null) return;
    await runReview(snap, coach, builderReviewProvider(), setReview);
  }

  async function pickScore(n: CheckInScore) {
    const pending = checkInSheet;
    if (pending === null || scoring) return;
    setScoring(true);
    const r = await saveScore({ record: (q) => services.checkIns.record(q), update: (id, patch, version, opId) => services.checkIns.update(id, patch, version, opId), newOpId: newUuid }, { current: null, score: n, checkInId, opId: checkInOp });
    setScoring(false);
    if (r.kind !== 'saved') {
      showToast({ text: r.kind === 'failed' ? r.message : WORKOUT_COPY.outOfDate, undoOpId: null, why: null });
      return;
    }
    changed();
    setCheckInSheet(null);
    // At or below the What's up? setting: the reasons step first; its exits come back here, and Start reuses this check-in.
    if (scoreStepOf(r, n) === 'reasons') {
      navigation.navigate('CheckIn', { mode: 'overview', checkInId: r.checkIn.id });
      return;
    }
    await start(pending.choice, { kind: 'answered', checkInId: r.checkIn.id });
  }

  const kgStep = async (slotKey: string, value: number | null, dir: 1 | -1): Promise<number | null> => {
    if (snap === null) return null;
    const slot = slotsOf(snap.workout.blocks).find((s) => s.key === slotKey);
    if (slot === undefined) return null;
    const k = await services.overview.loadKeypad({ equipmentId: snap.items[slotKey] ?? null, unit: slot.unit, convention: slot.convention, value }).catch(() => null);
    const t = k === null ? null : dir === 1 ? k.up : k.down;
    return t !== null && t.enabled ? t.value : null;
  };

  if (snap === null) return <View style={{ flex: 1, backgroundColor: theme.colors['bg.canvas'] }} />;
  const v = workoutView(snap);

  const rowAction = (row: WorkoutRowView, name: string) => {
    switch (name) {
      case 'delete':
        void edit({ kind: 'delete_exercise', slotKey: row.slotKey });
        break;
      case 'swap':
        void openSwap(row.slotKey);
        break;
      case 'move_up':
        void edit({ kind: 'move', slotKey: row.slotKey, dir: 'up' });
        break;
      case 'move_down':
        void edit({ kind: 'move', slotKey: row.slotKey, dir: 'down' });
        break;
      case 'superset_next':
        void edit({ kind: 'superset_next', slotKey: row.slotKey });
        break;
      case 'unlink':
        void edit({ kind: 'unlink', slotKey: row.slotKey });
        break;
      default:
        break;
    }
  };

  const toastNode =
    toast === null ? null : (
      <Toast
        icon="info.circle"
        text={toast.whyOpen && toast.why !== null ? toast.why : toast.text}
        {...(toast.undoOpId !== null ? { action: WORKOUT_COPY.undo, onAction: () => void undo(toast.undoOpId ?? '') } : {})}
        {...(toast.why !== null && !toast.whyOpen ? { secondary: WORKOUT_COPY.why, onSecondary: () => { setToast({ ...toast, whyOpen: true }); } } : {})}
        onDismiss={() => { showToast(null); }}
        showClose={screenReader}
      />
    );

  const row = (r: WorkoutRowView) => (
    <SwipeRow
      key={r.slotKey}
      onPress={() => { setPopup(r.slotKey); }}
      accessibilityLabel={r.accessibilityLabel}
      actions={r.actions}
      onAction={(name) => { rowAction(r, name); }}
      leftAction={{ label: WORKOUT_COPY.delete, onPress: () => { rowAction(r, 'delete'); } }}
      rightAction={{ label: WORKOUT_COPY.swap, onPress: () => { rowAction(r, 'swap'); } }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space['2'], paddingHorizontal: theme.space['3'], paddingVertical: theme.space['2'] }}>
        <View style={{ width: 28, alignItems: 'flex-start' }}>
          <AppText variant="callout" color={r.label.length > 1 ? 'text.primary' : 'text.secondary'} numeric>
            {r.label}
          </AppText>
          {r.linkedToNext ? <View style={{ position: 'absolute', left: 8, top: 24, height: 34, width: 2, borderRadius: 1, backgroundColor: theme.colors['text.tertiary'] }} /> : null}
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <AppText variant="callout" numberOfLines={2}>
            {r.name}
            {r.main ? <AppText variant="label" color="text.secondary">{`  ${WORKOUT_COPY.main}`}</AppText> : null}
          </AppText>
          {r.works !== null ? (
            <AppText variant="label" color="text.secondary" numberOfLines={1}>
              {r.works}
            </AppText>
          ) : null}
          {r.mayHurt ? (
            <AppText variant="label" color="status.warning">
              {WORKOUT_COPY.mayHurt}
            </AppText>
          ) : null}
          {r.notHere ? (
            <AppText variant="label" color="status.warning">
              {WORKOUT_COPY.notHere}
            </AppText>
          ) : null}
        </View>
        <View style={{ width: 40, alignItems: 'flex-end' }}>
          <AppText variant="callout" numeric>
            {r.setsText}
          </AppText>
          {r.warmText !== null ? (
            <AppText variant="label" color="text.secondary" numeric>
              {r.warmText}
            </AppText>
          ) : null}
        </View>
        <AppText variant="callout" numeric align="right" style={{ width: 76 }}>
          {r.topText}
        </AppText>
      </View>
    </SwipeRow>
  );

  const popupSlot = popup;
  return (
    <View style={{ flex: 1, paddingTop: insets.top, backgroundColor: theme.colors['bg.canvas'] }}>
      <View style={{ flex: 1 }}>
        <View style={{ paddingHorizontal: theme.components.screenMargin, gap: theme.space['2'] }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <TextButton label={WORKOUT_COPY.back} tone="secondary" onPress={() => { navigation.dispatch(builderPage('BuilderSetup', { draftId: snap.draftId })); }} />
            <TextButton label="Close" tone="secondary" onPress={() => { navigation.goBack(); }} />
          </View>
          <AppText variant="title1" accessibilityRole="header" numeric>
            {v.title}
          </AppText>
          {v.overLine !== null ? (
            <AppText variant="label" color="status.warning" numeric>
              {v.overLine}
            </AppText>
          ) : null}
        </View>
        <ScrollArea>
          {earlier.map((e) => (
            <StatusLine key={e.draftId} icon="clock" tone="info" text={editsFromText(e.localDate)} action={<TextButton label={WORKOUT_COPY.useEdits} onPress={() => { navigation.dispatch(builderPage('BuilderWorkout', { draftId: e.draftId })); }} />} />
          ))}
          {snap.planDayChanged !== null && !snap.planDayChanged.silent ? (
            <StatusLine
              icon="arrow.clockwise"
              tone="info"
              text={snap.planDayChanged.text}
              action={
                <TextButton
                  label={WORKOUT_COPY.reload}
                  onPress={() => {
                    void inTurn(async () => {
                      const cur = snapRef.current;
                      if (cur === null) return;
                      const r = await services.builder.reloadPlanDay(cur.draftId, { opId: newUuid(), expectedVersion: cur.version });
                      if (r.snapshot !== null) setSnap(r.snapshot);
                      if (r.status === 'written') {
                        changed();
                        showToast(r.toast);
                      } else if (r.status !== 'replayed') showToast({ text: r.message, undoOpId: null, why: null });
                    });
                  }}
                />
              }
            />
          ) : null}
          {v.notApplied.map((l) => (
            <StatusLine
              key={l.text}
              icon="info.circle"
              tone="info"
              text={l.text}
              {...(l.add.length > 0
                ? {
                    action: (
                      <TextButton
                        label={WORKOUT_COPY.addAnyway}
                        onPress={() => {
                          for (const id of l.add) void edit({ kind: 'add_exercise', exerciseId: id });
                        }}
                      />
                    ),
                  }
                : {})}
            />
          ))}
          <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={{ flexDirection: 'row', gap: theme.space['2'], paddingHorizontal: theme.space['3'] }}>
            <View style={{ width: 28 }} />
            <AppText variant="label" color="text.secondary" style={{ flex: 1 }}>
              {WORKOUT_COPY.exercise}
            </AppText>
            <AppText variant="label" color="text.secondary" align="right" style={{ width: 40 }}>
              {WORKOUT_COPY.sets}
            </AppText>
            <AppText variant="label" color="text.secondary" align="right" style={{ width: 76 }}>
              {v.topHeader}
            </AppText>
          </View>
          {v.rounds.map((round) => (
            <View
              key={`${String(round.n)}:${round.rows[0]?.slotKey ?? ''}`}
              style={{ borderRadius: theme.radius.md, overflow: 'hidden', backgroundColor: theme.colors['bg.surface'], borderWidth: round.superset ? 1.5 : 0, borderColor: theme.colors['text.tertiary'] }}
            >
              {round.rows.map(row)}
            </View>
          ))}
          {v.canAdd ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Add exercise"
              onPress={() => void openSwap(null)}
              style={({ pressed }) => ({ minHeight: 50, borderRadius: theme.radius.md, borderWidth: 1.5, borderStyle: 'dashed', borderColor: theme.colors['border.divider'], alignItems: 'center', justifyContent: 'center', opacity: pressed ? 0.7 : 1 })}
            >
              <AppText variant="callout">{WORKOUT_COPY.addExercise}</AppText>
            </Pressable>
          ) : null}
        </ScrollArea>
        <ToastHost bottom={8}>{popupSlot === null ? toastNode : null}</ToastHost>
      </View>
      <View style={{ paddingHorizontal: theme.components.screenMargin, paddingTop: theme.space['2'], paddingBottom: insets.bottom + theme.space['2'], gap: theme.space['2'], backgroundColor: theme.colors['bg.canvas'] }}>
        <CoachBar
          text={WORKOUT_COPY.bar}
          statusWord={coachBarWord(coach)}
          disabled={coach !== 'ok'}
          onOpen={() => { navigation.navigate('Coach', { entry: { kind: 'today' }, focus: true }); }}
          onMic={() => { navigation.navigate('Coach', { entry: { kind: 'today' }, focus: true }); }}
        />
        <View style={{ flexDirection: 'row', gap: theme.space['2'], alignItems: 'center' }}>
          <View style={{ flex: 1 }}>
            <StartButton enabled={v.startEnabled} busy={startBusy} onPress={() => void onStart()} />
          </View>
          <SecondaryButton label={WORKOUT_COPY.review} size="primary" onPress={() => void openReview()} />
        </View>
      </View>

      <ExerciseSheet
        snap={snap}
        slotKey={popupSlot}
        onEdit={edit}
        onSwap={() => {
          const k = popupSlot;
          setPopup(null);
          if (k !== null) void openSwap(k);
        }}
        onDelete={() => {
          const k = popupSlot;
          setPopup(null);
          if (k !== null) void edit({ kind: 'delete_exercise', slotKey: k });
        }}
        onClose={() => { setPopup(null); }}
        why={(k) => services.builder.whyWeight(snap.draftId, k)}
        kgStep={kgStep}
        toast={toastNode}
      />
      <SwapSheet
        visible={swap !== null}
        title={swap?.slotKey == null ? 'Add exercise' : `Swap ${snap.facts[slotsOf(snap.workout.blocks).find((s) => s.key === swap.slotKey)?.exerciseId ?? '']?.name ?? ''}`}
        group={swap?.group ?? 'Chest'}
        groups={swap?.groups ?? []}
        sections={swap?.sections ?? []}
        actionWord={swap?.slotKey == null ? 'Add' : 'Swap'}
        onGroup={(g) => void openSwap(swap?.slotKey ?? null, g)}
        onPick={(id) => void pick(id)}
        onClose={() => { setSwap(null); }}
      />
      <PromptSheet
        view={prompt === null ? null : promptView(prompt)}
        suggestedLabel={prompt?.suggestedLabel ?? ''}
        busy={startBusy}
        error={startError}
        onToday={() => void start({ kind: 'today' })}
        onUpdate={() => void start({ kind: 'update' })}
        onVariation={(label) => void start({ kind: 'variation', label })}
        onClose={() => { setPrompt(null); }}
      />
      {alertsAsk.sheet}
      <BottomCard visible={checkInSheet !== null} onClose={() => { setCheckInSheet(null); }}>
        <AppText variant="title2" accessibilityRole="header">
          {WORKOUT_COPY.checkIn}
        </AppText>
        <CheckInScale selected={null} disabled={scoring || startBusy} onPick={(n) => void pickScore(n)} />
        <TextButton
          label={WORKOUT_COPY.skip}
          tone="secondary"
          disabled={scoring || startBusy}
          onPress={() => {
            const pending = checkInSheet;
            setCheckInSheet(null);
            if (pending !== null) void start(pending.choice, { kind: 'skipped', atUtc: services.now().utc });
          }}
        />
      </BottomCard>
      <ReviewSheet
        visible={review !== null}
        review={review}
        onApply={(id) => {
          const p = builderReviewProvider();
          if (p !== null) void p.apply(snap.draftId, id, newUuid()).then(() => reload());
        }}
        onDone={(ticked) => {
          const p = builderReviewProvider();
          if (p !== null && ticked.length > 0 && review?.status === 'reviewed') void p.saveNotes(snap.draftId, ticked, newUuid());
          setReview(null);
        }}
        onClose={() => { setReview(null); }}
      />
    </View>
  );
}

function ScrollArea({ children }: { children: ReactNode }) {
  const theme = useTheme();
  // A plain scroll view: the list is short (≤ 10 exercises) and the bottom bar stays visible.
  return (
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingHorizontal: theme.components.screenMargin, paddingVertical: theme.space['3'], gap: theme.space['3'] }}>
      {children}
    </ScrollView>
  );
}

function StartButton({ enabled, busy, onPress }: { enabled: boolean; busy: boolean; onPress: () => void }) {
  return <PrimaryButton label={WORKOUT_COPY.start} onPress={onPress} disabled={!enabled} busy={busy} />;
}
