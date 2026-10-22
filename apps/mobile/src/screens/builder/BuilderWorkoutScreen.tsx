import { useFocusEffect, useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, ActionSheetIOS, Alert, Pressable, ScrollView, View } from 'react-native';
import type { ReactNode } from 'react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { builderApplyOpId, type BuilderCoachReach, type BuilderProposal } from '@fizz/coach';
import { dropBuilderSlot, slotsOf, type BuilderEditOp } from '@fizz/domain';
import type { BuilderGroup, CheckInScore, PlanChangeUndo, Routine, SessionCheckIn } from '@fizz/schemas';

import { planChangeText, type BuilderSnapshot, type BuilderToast, type BuilderWriteResult, type StartChoice, type StartPrompt } from '../../builder/builder-service';
import { reviewAfterApply } from '../../builder/review';
import { UPDATE_PLAN_DAY_ACTION } from '../../coach/builder-review-provider';
import { editAskView, EDIT_ASK_COPY, proposalCardView, replyCardView, type ProposalState } from '../../coach/builder-coach-view';
import { editsFromText, popupLinks, promptView, workoutView, WORKOUT_COPY, type WorkoutRowView } from '../../builder/builder-view';
import { bundledHowToSources, howToRouteFor } from '../../guide/how-to';
import { builderReviewProvider, runReview, type BuilderReview } from '../../builder/review';
import { newUuid } from '../../device/runtime';
import { builderPage, openStartedWorkout, popToToday } from '../../navigation/actions';
import type { BuilderBack, RootStackParams } from '../../navigation/types';
import { useSaveToWorkouts } from '../routines/SaveWorkoutSheet';
import { useDataChanged, useServices } from '../../shell/context';
import { useTheme } from '../../theme';
import { AppText, BottomCard, CheckInScale, PrimaryButton, SecondaryButton, StatusLine, TextButton, Toast, ToastHost } from '../../ui';
import { useStartAlertsAsk } from '../../alerts/AlertsAskSheet';
import { saveScore, scoreStepOf } from '../../workout/check-in-score';
import { CoachAskBar } from '../../ui/coach-ask-bar';
import { createOnDeviceSpeech } from '../../voice/on-device-speech';
import { SwipeRow } from './BuilderParts';
import { DragItem, DragList, useDragHandle } from '../../ui/drag-list';
import { holdMenu } from '../../ui/exercise-popup-model';
import { ExerciseSheet, PromptSheet, ProposalSheet, ReviewSheet, SwapSheet, type ChoiceSection } from './BuilderSheets';

/**
 * Your workout (workout-builder-v3 §2.3): numbered rounds, supersets as
 * one box (3a/3b), `Exercise | Sets | Top set`. Tap a row for the pop-up;
 * swipe left to Delete (Undo), right to Swap; the pop-up and VoiceOver
 * actions do the same, plus Move up/down, Superset with next and Unlink
 * (drag is S4b, §9 Q18). Start asks `Use these changes for` only when the
 * structure differs from the plan day (Q11).
 */
/** The toast Undo that undoes a plan change (`Chest · bench updated · Undo`), not a draft edit. */
const PLAN_UNDO = 'plan-change';

export function BuilderWorkoutScreen() {
  const theme = useTheme();
  const services = useServices();
  const changed = useDataChanged();
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const params = useRoute<RouteProp<RootStackParams, 'BuilderWorkout'>>().params;
  // (22 Oct) Opened on a workout, a past workout, a chat draft or Up next: today's draft for it is opened first.
  const [draftId, setDraftId] = useState<string | null>(params.draftId ?? null);
  const [openFailed, setOpenFailed] = useState<string | null>(null);
  const [openOp] = useState(newUuid);
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
  // The bar's reach (builder coach) and on-device speech (§2.6); a message returns a proposal, applied only on Apply.
  const [reach, setReach] = useState<BuilderCoachReach>('not_connected');
  // One request with the coach at a time (wiring S3): the ref guards a second submit before the state lands.
  const [asking, setAsking] = useState(false);
  const askingRef = useRef(false);
  const [reply, setReply] = useState<string | null>(null);
  const [speech] = useState(createOnDeviceSpeech);
  const [proposal, setProposal] = useState<{ proposal: BuilderProposal; state: ProposalState } | null>(null);
  const [applying, setApplying] = useState(false);
  const [toast, setToast] = useState<(BuilderToast & { whyOpen: boolean }) | null>(null);
  const [popup, setPopup] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [swap, setSwap] = useState<{ slotKey: string | null; group: BuilderGroup; groups: BuilderGroup[]; sections: ChoiceSection[] } | null>(null);
  const [prompt, setPrompt] = useState<StartPrompt | null>(null);
  const [startBusy, setStartBusy] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const [review, setReview] = useState<BuilderReview | null>(null);
  // Coach review's `Update plan day` (§2.9): the §2.8 choice with no Start; its Undo is the plan change's inverse.
  const [planOnly, setPlanOnly] = useState(false);
  const planUndo = useRef<PlanChangeUndo | null>(null);
  const [earlier, setEarlier] = useState<{ draftId: string; localDate: string; name: string }[]>([]);
  const [screenReader, setScreenReader] = useState(false);
  const startOp = useRef(newUuid());
  const toastLater = useRef<BuilderToast | null>(null);
  const showToastRef = useRef<(t: BuilderToast | null) => void>(() => undefined);
  const alertsAsk = useStartAlertsAsk();
  const save = useSaveToWorkouts(
    (r: Routine) => {
      changed();
      showToastRef.current({ text: WORKOUT_COPY.saved(r.name), undoOpId: null, why: null });
    },
    () => {
      showToastRef.current({ text: WORKOUT_COPY.nothingToSave, undoOpId: null, why: null });
    },
  );
  const [checkInSheet, setCheckInSheet] = useState<{ choice: StartChoice } | null>(null);
  const [scoring, setScoring] = useState(false);
  const [checkInId] = useState(newUuid);
  const [checkInOp] = useState(newUuid);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const shownKey = useRef<string | null>(null);

  useEffect(() => {
    const target = params.open;
    if (draftId !== null || target === undefined) return;
    let live = true;
    void services.builder
      .openTarget(target, openOp)
      .catch(() => null)
      .then((r) => {
        if (!live) return;
        if (r?.snapshot == null) {
          setOpenFailed(r !== null && 'message' in r ? r.message : services.builder.copy.failed);
          return;
        }
        changed();
        setDraftId(r.snapshot.draftId);
        // A relaunch or a re-render reopens this draft, not a new one.
        navigation.setParams({ draftId: r.snapshot.draftId });
      });
    return () => {
      live = false;
    };
  }, [draftId, params.open, openOp, services, changed, navigation]);

  const reload = useCallback(async () => {
    if (draftId === null) return;
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
    setReach(await services.builderCoach.status().catch((): BuilderCoachReach => 'not_connected'));
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
    if (opId === PLAN_UNDO) {
      const u = planUndo.current;
      if (u === null) return Promise.resolve();
      return services.builder.undoPlanChange(u, newUuid()).then(async (r) => {
        if (!r.ok) showToast({ text: r.message, undoOpId: null, why: null });
        else planUndo.current = null;
        changed();
        await reload();
      });
    }
    return inTurn(async () => {
      const cur = snapRef.current;
      if (cur === null) return;
      const r = await services.builder.undo(cur.draftId, opId, newUuid());
      if (r.snapshot !== null) setSnap(r.snapshot);
      if (r.status === 'written') changed();
      else if (r.status !== 'replayed') showToast({ text: r.message, undoOpId: null, why: null });
    });
  }

  /**
   * Your workout's bar (§2.6): the words go to the coach (`propose_workout_edit`); its proposal opens the sheet.
   * One request at a time, with `Asking…` on the bar meanwhile (wiring S3); a reply with nothing to apply stays
   * in the sheet until Ben closes it.
   */
  async function askWorkout(words: string) {
    const cur = snapRef.current;
    if (cur === null || words.trim() === '' || askingRef.current) return;
    askingRef.current = true;
    setAsking(true);
    let r: Awaited<ReturnType<typeof services.builderCoach.askEdit>> | null;
    try {
      r = await services.builderCoach.askEdit({ draftId: cur.draftId, words: words.trim(), opId: newUuid() }).catch(() => null);
    } finally {
      askingRef.current = false;
      setAsking(false);
    }
    const v = r === null ? ({ kind: 'toast', text: EDIT_ASK_COPY.noAnswer } as const) : editAskView(r);
    switch (v.kind) {
      case 'proposal':
        setReply(null);
        setProposal({ proposal: v.proposal, state: 'open' });
        return;
      case 'reply':
        setReply(v.text);
        return;
      case 'toast':
        showToast({ text: v.text, undoOpId: null, why: null });
        return;
      case 'reach':
        setReach(v.reach);
        return;
      case 'gone':
        await reload();
        return;
      case 'none':
        return;
    }
  }

  /** `Apply` (Ben's tap, rule 3): checked again against the draft now, one versioned write; `Applied · Undo`. */
  async function applyProposal() {
    const p = proposal;
    if (p === null || p.state !== 'open' || applying) return;
    setApplying(true);
    try {
      const r = await services.builderCoach.apply(p.proposal).catch(() => ({ kind: 'failed' }) as const);
      if (r.kind === 'out_of_date') {
        setProposal({ proposal: p.proposal, state: 'out_of_date' });
        return;
      }
      setProposal(null);
      if (r.kind === 'failed') {
        showToast({ text: EDIT_ASK_COPY.notApplied, undoOpId: null, why: null });
        return;
      }
      changed();
      await reload();
      showToast({ text: WORKOUT_COPY.applied, undoOpId: builderApplyOpId(p.proposal.id), why: null });
    } finally {
      setApplying(false);
    }
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
    // Another workout is in progress: Today, where it resumes.
    if (r.reason === 'active') {
      setPrompt(null);
      setCheckInSheet(null);
      navigation.dispatch(popToToday(r.message));
      return;
    }
    if (r.reason === 'stale') {
      setPrompt(null);
      await reload();
      showToast({ text: r.message, undoOpId: null, why: null });
      return;
    }
    if (prompt !== null) setStartError(r.message);
    else showToast({ text: r.message, undoOpId: null, why: null });
  }

  /** `Update plan day` from Coach review: the §2.8 choice (Update / Save as new variation / Cancel), before Start. */
  async function openPlanUpdate() {
    if (snap === null) return;
    const p = await services.builder.startPrompt(snap.draftId);
    setReview(null);
    if (p === null) {
      showToast({ text: WORKOUT_COPY.noChanges, undoOpId: null, why: null });
      return;
    }
    setStartError(null);
    setPlanOnly(true);
    setPrompt(p);
  }

  async function updatePlanDay(choice: Exclude<StartChoice, { kind: 'today' }>) {
    if (snap === null || startBusy) return;
    setStartBusy(true);
    const r = await services.builder.updatePlanDay(snap.draftId, { choice, opId: startOp.current, expectedVersion: snap.version });
    setStartBusy(false);
    startOp.current = newUuid();
    if (!r.ok) {
      setStartError(r.message);
      return;
    }
    setPrompt(null);
    setPlanOnly(false);
    changed();
    await reload();
    if (r.planChange !== null) {
      planUndo.current = r.planChange;
      showToast({ text: planChangeText(r.planChange), undoOpId: PLAN_UNDO, why: null });
    }
  }

  async function onStart() {
    if (snap === null) return;
    setPlanOnly(false);
    const p = await services.builder.startPrompt(snap.draftId);
    if (p === null) await start({ kind: 'today' });
    else {
      setStartError(null);
      setPrompt(p);
    }
  }

  async function openReview() {
    if (snap === null) return;
    // The bar's reach is the sheet's status too (one source on the page; wiring S2).
    await runReview(snap, reach, builderReviewProvider(), setReview);
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

  const back = params.back;
  const backControl = (
    <TextButton
      label={backLabel(back)}
      tone="secondary"
      onPress={() => {
        navigation.goBack();
      }}
    />
  );
  if (snap === null)
    return (
      <View style={{ flex: 1, paddingTop: insets.top, paddingHorizontal: theme.components.screenMargin, gap: theme.space['3'], backgroundColor: theme.colors['bg.canvas'] }}>
        {openFailed !== null || back !== undefined ? <View style={{ flexDirection: 'row' }}>{backControl}</View> : null}
        {openFailed !== null ? <StatusLine icon="info.circle" tone="info" text={openFailed} /> : null}
      </View>
    );
  const v = workoutView(snap);

  /** `⋯` (§7): `Save to Workouts` for a workout that isn't a plan day or a saved workout already. */
  const openMore = () => {
    const options = [WORKOUT_COPY.saveToWorkouts, 'Cancel'];
    ActionSheetIOS.showActionSheetWithOptions({ options, cancelButtonIndex: 1 }, (i) => {
      if (i === 0) void save.open({ kind: 'draft', draftId: snap.draftId, gymId: snap.gymId }, snap.name);
    });
  };

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
    <DragItem key={r.slotKey} dragKey={r.slotKey} draggable>
      <HeldSwipeRow
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
            // Wraps (no ellipsis), like the Today strip: `Lower back, glutes, hamstrings` is never cut (Ben, 21 Oct).
            <AppText variant="label" color="text.secondary">
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
      </HeldSwipeRow>
    </DragItem>
  );

  /** A hold released without a drag (§2.3's fallback): the row's own actions, as VoiceOver has them. */
  const rowMenu = (slotKey: string) => {
    const r = v.rounds.flatMap((x) => x.rows).find((x) => x.slotKey === slotKey);
    if (r === undefined) return;
    const m = holdMenu(r.actions);
    ActionSheetIOS.showActionSheetWithOptions({ title: r.name, options: m.options, cancelButtonIndex: m.cancelButtonIndex, destructiveButtonIndex: m.destructiveButtonIndex }, (i) => {
      const a = m.actionAt(i);
      if (a !== null) rowAction(r, a);
    });
  };

  const popupSlot = popup;
  // (22 Oct) The pop-up's `How to` and `History`, where the overview's rows had them; the sheet closes first.
  const links = popupSlot === null ? null : popupLinks(snap, popupSlot, (x) => howToRouteFor(x, bundledHowToSources()));
  const howTo = links?.howTo ?? null;
  const history = links?.history ?? null;
  return (
    <View style={{ flex: 1, paddingTop: insets.top, backgroundColor: theme.colors['bg.canvas'] }}>
      <View style={{ flex: 1 }}>
        <View style={{ paddingHorizontal: theme.components.screenMargin, gap: theme.space['2'] }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            {/* Opened from Today, the Library, a chat draft or a Summary: only `‹ Today` / `‹ Library` (§2.3, review V1); no Set up. */}
            {back !== undefined || snap.from !== null ? (
              backControl
            ) : (
              <TextButton label={WORKOUT_COPY.back} tone="secondary" onPress={() => { navigation.dispatch(builderPage('BuilderSetup', { draftId: snap.draftId })); }} />
            )}
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              {snap.canSave ? <TextButton label="⋯" accessibilityLabel={WORKOUT_COPY.more} tone="secondary" onPress={openMore} /> : null}
              {back === undefined && snap.from === null ? <TextButton label="Close" tone="secondary" onPress={() => { navigation.goBack(); }} /> : null}
            </View>
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
        <ScrollArea scrollEnabled={!dragging}>
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
          {/* Review B1: what this workout has that Your workout can't hold (an exercise it can't find, past its limits) is named, never dropped silently; cardio, timed sets and a second copy show as saved (22 Oct). */}
          {snap.leftOut.length > 0 ? (
            <StatusLine
              icon="info.circle"
              tone="info"
              text={services.builder.copy.leftOut(snap.leftOut.length)}
              action={
                <TextButton
                  label={WORKOUT_COPY.why}
                  onPress={() => {
                    Alert.alert(services.builder.copy.leftOut(snap.leftOut.length), snap.leftOut.join('\n'));
                  }}
                />
              }
            />
          ) : null}
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
          {/* Press and hold a row, then drag (§2.3, Q18): an edge = move there, the middle = superset. Built once, shared with the workout (workout-table-v3 §7). */}
          <DragList
            enabled
            allowOnto
            // Only drops the builder takes are highlighted (the main lift, more than 4, a no-op spring back; review S5).
            canDrop={(slotKey, t) => snapRef.current !== null && dropBuilderSlot(snapRef.current.workout.blocks, slotKey, t.key, t.edge) !== null}
            onDrop={(slotKey, t) => void edit({ kind: 'drop', slotKey, targetKey: t.key, edge: t.edge })}
            onMenu={rowMenu}
            onDragChange={setDragging}
            style={{ gap: theme.space['3'] }}
          >
            {v.rounds.map((round) => (
              <View
                key={`${String(round.n)}:${round.rows[0]?.slotKey ?? ''}`}
                style={{ borderRadius: theme.radius.md, overflow: dragging ? 'visible' : 'hidden', backgroundColor: theme.colors['bg.surface'], borderWidth: round.superset ? 1.5 : 0, borderColor: theme.colors['text.tertiary'] }}
              >
                {round.rows.map(row)}
              </View>
            ))}
          </DragList>
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
        <CoachAskBar
          page="workout"
          reach={reach}
          asking={asking}
          speech={speech}
          onOpen={(heard) => {
            if (heard !== undefined && heard.trim() !== '') {
              void askWorkout(heard);
              return;
            }
            Alert.prompt(WORKOUT_COPY.bar, undefined, (text) => {
              if (text.trim() !== '') void askWorkout(text);
            });
          }}
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
        onHowTo={
          howTo === null
            ? undefined
            : () => {
                setPopup(null);
                navigation.navigate('HowTo', howTo);
              }
        }
        onHistory={
          history === null
            ? undefined
            : () => {
                setPopup(null);
                navigation.navigate('ExerciseProgress', history);
              }
        }
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
        hideToday={planOnly}
        onToday={() => void start({ kind: 'today' })}
        onUpdate={() => void (planOnly ? updatePlanDay({ kind: 'update' }) : start({ kind: 'update' }))}
        onVariation={(label) => void (planOnly ? updatePlanDay({ kind: 'variation', label }) : start({ kind: 'variation', label }))}
        onClose={() => {
          setPrompt(null);
          setPlanOnly(false);
        }}
      />
      {alertsAsk.sheet}
      {save.sheet}
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
      <ProposalSheet
        card={proposal === null ? (reply === null ? null : replyCardView(reply)) : proposalCardView(proposal.proposal, proposal.state)}
        busy={applying}
        onApply={() => void applyProposal()}
        onSkip={() => {
          setProposal(null);
          setReply(null);
        }}
      />
      <ReviewSheet
        visible={review !== null}
        review={review}
        onApply={(id) => {
          // `Update plan day` is the builder's own §2.8 choice (it owns plan-day writes); the provider never applies it.
          if (id === UPDATE_PLAN_DAY_ACTION) {
            void openPlanUpdate();
            return;
          }
          const p = builderReviewProvider();
          if (p === null) return;
          void p.apply(snap.draftId, id, newUuid()).then(async (r) => {
            setReview((cur) => (cur === null ? cur : reviewAfterApply(cur, id, r.ok)));
            if (r.ok) {
              changed();
              if (r.undoOpId !== null) showToast({ text: WORKOUT_COPY.applied, undoOpId: r.undoOpId, why: null });
            } else showToast({ text: r.message, undoOpId: null, why: null });
            await reload();
          });
        }}
        onDone={(ticked) => {
          const p = builderReviewProvider();
          if (p !== null && ticked.length > 0 && review?.status === 'reviewed')
            void p.saveNotes(snap.draftId, ticked, newUuid()).then((r) => {
              if ((r.notSaved?.length ?? 0) > 0 || !r.ok) showToast({ text: WORKOUT_COPY.notSaved, undoOpId: null, why: null });
            });
          setReview(null);
        }}
        onClose={() => { setReview(null); }}
      />
    </View>
  );
}

/** A row's swipe and tap, with the drag's hold on its own press (`useDragHandle`, inside its `DragItem`). */
function HeldSwipeRow(p: Omit<Parameters<typeof SwipeRow>[0], 'holdProps'>) {
  const hold = useDragHandle();
  return <SwipeRow {...p} holdProps={hold} />;
}

function ScrollArea({ children, scrollEnabled }: { children: ReactNode; scrollEnabled: boolean }) {
  const theme = useTheme();
  // A plain scroll view: the list is short (≤ 10 exercises) and the bottom bar stays visible. It holds still while a row is dragged.
  return (
    <ScrollView scrollEnabled={scrollEnabled} keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingHorizontal: theme.components.screenMargin, paddingVertical: theme.space['3'], gap: theme.space['3'] }}>
      {children}
    </ScrollView>
  );
}

/** `‹ Today`, `‹ Library`, `‹ Summary`, else `‹ Back`. */
function backLabel(back: BuilderBack | undefined): string {
  return `‹ ${back ?? 'Back'}`;
}

function StartButton({ enabled, busy, onPress }: { enabled: boolean; busy: boolean; onPress: () => void }) {
  return <PrimaryButton label={WORKOUT_COPY.start} onPress={onPress} disabled={!enabled} busy={busy} />;
}
