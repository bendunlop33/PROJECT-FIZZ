import { useFocusEffect, useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, ActionSheetIOS, Alert, Pressable, ScrollView, View } from 'react-native';
import type { ReactNode } from 'react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { builderApplyOpId, type BuilderCoachReach, type BuilderProposal } from '@fizz/coach';
import { dropBuilderSlot, sessionCheckInForSkip, slotsOf, type BuilderEditOp } from '@fizz/domain';
import type { BuilderGroup, CheckInScore, Routine, SessionCheckIn } from '@fizz/schemas';

import type { BuilderSnapshot, BuilderToast, BuilderWriteResult, TodayOptionChange, TodayOptions } from '../../builder/builder-service';
import { TodayOptionRows } from '../today/TodaySession';
import { reviewAfterApply } from '../../builder/review';
import { editAskView, EDIT_ASK_COPY, proposalCardView, replyCardView, type ProposalState } from '../../coach/builder-coach-view';
import { addAnywayConfirm, earlierEditsMenu, OPTIONS_ROW_COPY, popupLinks, todayOptionsSummary, todayOptionsView, workoutView, WORKOUT_COPY, type WorkoutRowView } from '../../builder/builder-view';
import { bundledHowToSources, howToRouteFor } from '../../guide/how-to';
import { builderReviewProvider, runReview, type BuilderReview } from '../../builder/review';
import { newUuid } from '../../device/runtime';
import { builderPage, openStartedWorkout, popToToday } from '../../navigation/actions';
import type { BuilderBack, RootStackParams } from '../../navigation/types';
import { useSaveToWorkouts } from '../routines/SaveWorkoutSheet';
import { NameSheet } from '../routines/NameSheet';
import { useDataChanged, useServices } from '../../shell/context';
import { useTheme } from '../../theme';
import { AppText, BottomCard, CheckInScale, Icon, PrimaryButton, SecondaryButton, StatusLine, TextButton, Toast, ToastHost } from '../../ui';
import { useStartAlertsAsk } from '../../alerts/AlertsAskSheet';
import { saveScore, scoreStepOf } from '../../workout/check-in-score';
import { CoachAskBar } from '../../ui/coach-ask-bar';
import { useAddOwn } from '../../ui/use-add-own';
import { useExercisePicker, usePickerView } from '../../ui/use-exercise-picker';
import { TimeDetailSheet, TimeNoteRow } from '../../ui/time-stepper';
import { createOnDeviceSpeech } from '../../voice/on-device-speech';
import { WorkoutTable } from './WorkoutTable';
import { ExerciseSheet, ProposalSheet, ReviewSheet, SwapSheet, type ChoiceSection } from './BuilderSheets';

/**
 * Your workout (workout-builder-v3 §2.3): numbered rounds, supersets as
 * one box (3a/3b), `Exercise | Sets | Top set`. Tap a row for the pop-up;
 * swipe left to Delete (Undo), right to Swap; the pop-up and VoiceOver
 * actions do the same, plus Move up/down, Superset with next and Unlink
 * (drag is S4b, §9 Q18). Start always starts, today only (Ben, 23 Oct, D1):
 * a structural change is offered for the plan on the Summary.
 */

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
  // `onUndo`: an Undo that isn't the draft's own (a variation saved from `⋯`).
  const [toast, setToast] = useState<(BuilderToast & { whyOpen: boolean; onUndo?: () => void }) | null>(null);
  // (Ben, 23 Oct) `⋯ Save as a variation`: the name sheet (its prefill), one op ID per opening.
  const [variationName, setVariationName] = useState<string | null>(null);
  const variationOp = useRef(newUuid());
  const [popup, setPopup] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [swap, setSwap] = useState<{ slotKey: string | null; sections: ChoiceSection[] } | null>(null);
  // (Ben, 25 Oct) Swap / Add's full list: every exercise, read once per open; search and chips are pure over it.
  const picker = useExercisePicker();
  const pickerView = usePickerView(
    picker,
    snap === null ? [] : slotsOf(snap.workout.blocks).map((s) => s.exerciseId),
    (swap?.sections ?? []).flatMap((x) => x.items.map((i) => i.exerciseId)),
  );
  const [startBusy, setStartBusy] = useState(false);
  const [review, setReview] = useState<BuilderReview | null>(null);
  // (22 Oct) The detail behind the Time note: what the fit changed, and its Undo.
  const [timeDetail, setTimeDetail] = useState(false);
  // (D3) Opened from Today: the options that left Today's card (Main lift, Accessories, Abs, Supersets).
  const [todayOpts, setTodayOpts] = useState<TodayOptions | null>(null);
  // (Ben, 26 Oct) The `Options` row starts collapsed.
  const [optionsOpen, setOptionsOpen] = useState(false);
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
  const [checkInSheet, setCheckInSheet] = useState(false);
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
        // (D8) A coach change Ben applied in chat that landed on opening: its `✦ … · Undo` shows once the page loads.
        if (r.status === 'written' && r.toast !== null) toastLater.current = r.toast;
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
    // (Ben, 23 Oct, D8) A change Ben applied in chat for this workout lands here, once, with `✦ … · Undo`.
    if (s !== null) {
      const cur = s;
      const landed = await inTurn(() => services.builder.landCoachChanges(cur.draftId).catch(() => null));
      if (landed?.snapshot != null) s = landed.snapshot;
      if (landed?.status === 'written' && landed.toast !== null) toastLater.current = landed.toast;
    }
    setSnap(s);
    if (toastLater.current !== null) {
      showToastRef.current(toastLater.current);
      toastLater.current = null;
    }
    setReach(await services.builderCoach.status().catch((): BuilderCoachReach => 'not_connected'));
    setEarlier((await services.builder.earlierEdits().catch(() => [])).filter((e) => e.draftId !== draftId));
    setTodayOpts(params.back === 'Today' && s !== null ? await services.builder.todayOptions(s.draftId).catch(() => null) : null);
  }, [services, draftId, inTurn, setSnap, params.back]);

  useFocusEffect(
    useCallback(() => {
      void reload();
    }, [reload]),
  );

  useEffect(() => {
    void AccessibilityInfo.isScreenReaderEnabled().then(setScreenReader);
  }, []);

  const showToast = useCallback(
    (t: (BuilderToast & { onUndo?: () => void }) | null) => {
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

  /**
   * (22 Oct, Ben: "add option to reduce time") Time: the service fits today's draft to the new length (the same
   * built-in fit as Today's; offline, no coach call). Steps run one at a time on the latest snapshot, so quick taps
   * add up: `dir` steps from the estimate now (the view's next length down or up past the length, `liveTime`; none at
   * a limit); `to` is the detail's Undo (back to the length before the first change).
   */
  function setTime(step: { dir: -1 | 1 } | { to: number }): Promise<void> {
    return inTurn(async () => {
      const cur = snapRef.current;
      if (cur === null) return;
      const t = workoutView(cur).time;
      const to = 'to' in step ? step.to : step.dir < 0 ? t.less : t.more;
      if (to === null) return;
      const r = await services.builder.setTime(cur.draftId, to, { opId: newUuid(), expectedVersion: cur.version });
      if (r.snapshot !== null) setSnap(r.snapshot);
      if (r.status === 'written') changed();
      else if (r.status !== 'replayed') showToast({ text: r.message, undoOpId: null, why: null });
    });
  }

  /**
   * (D3) One of Today's options, run after any edit still in flight: Set up's own change on this draft (the service
   * keeps Ben's edits and Time), with Undo. A new main lift can land on that lift's own draft: the page follows it.
   */
  function setTodayOption(change: TodayOptionChange): Promise<void> {
    return inTurn(async () => {
      const cur = snapRef.current;
      if (cur === null) return;
      const r = await services.builder.setTodayOption(cur.draftId, change, { opId: newUuid(), expectedVersion: cur.version });
      if (r.snapshot !== null) {
        if (r.snapshot.draftId !== cur.draftId) {
          setDraftId(r.snapshot.draftId);
          navigation.setParams({ draftId: r.snapshot.draftId });
        }
        setSnap(r.snapshot);
        setTodayOpts(await services.builder.todayOptions(r.snapshot.draftId).catch(() => null));
      }
      if (r.status === 'written') {
        changed();
        showToast(r.toast);
      } else if (r.status !== 'replayed') showToast({ text: r.message, undoOpId: null, why: null });
    });
  }

  /** (Ben, 23 Oct) The carry-over of the sets Time cut: `Carry over` (toast `Carried over · Undo`), `✕`, or `Undo`. */
  function carryOver(choice: 'carried' | 'skipped' | 'clear'): Promise<void> {
    return inTurn(async () => {
      const cur = snapRef.current;
      if (cur === null) return;
      const r = await services.builder.carryOver(cur.draftId, choice, { opId: newUuid(), expectedVersion: cur.version });
      if (r.snapshot !== null) setSnap(r.snapshot);
      if (r.status === 'written') {
        changed();
        if (r.toast !== null) showToast(r.toast);
      } else if (r.status !== 'replayed') showToast({ text: r.message, undoOpId: null, why: null });
    });
  }

  /** (Ben, 23 Oct) `↻ Mix it up`: one accessory swapped for a fresh one, run after any edit in flight; `<from> → <to> · Undo`. */
  function mixItUp(): Promise<void> {
    return inTurn(async () => {
      const cur = snapRef.current;
      if (cur === null) return;
      const r = await services.builder.mixItUp(cur.draftId, { opId: newUuid(), expectedVersion: cur.version });
      if (r.snapshot !== null) setSnap(r.snapshot);
      if (r.status === 'written') {
        changed();
        showToast(r.toast);
      } else if (r.status !== 'replayed') showToast({ text: r.message, undoOpId: null, why: null });
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

  /** Swap / Add (§2.5): the suggestions for a group (the chip; none: the exercise's own) and, on a fresh open, the full list. */
  async function openSwap(slotKey: string | null, opts: { group?: BuilderGroup; fresh?: boolean; query?: string } = {}) {
    if (snap === null) return;
    const draftId = snap.draftId;
    if (opts.fresh !== false) picker.open(() => services.exercisePicker.forDraft(draftId, { add: slotKey === null }), opts.query ?? '');
    const c = await services.builder.exerciseChoices(draftId, opts.group === undefined ? { slotKey } : { slotKey, group: opts.group }).catch(() => null);
    setSwap({ slotKey, sections: c?.sections ?? [] });
  }
  const addOwn = useAddOwn<string | null>((slotKey, name) => void openSwap(slotKey, { query: name }));

  function closeSwap() {
    setSwap(null);
    picker.close();
  }

  async function pick(exerciseId: string) {
    if (swap === null) return;
    const op: BuilderEditOp = swap.slotKey === null ? { kind: 'add_exercise', exerciseId } : { kind: 'swap', slotKey: swap.slotKey, exerciseId };
    closeSwap();
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
        // (Ben, 23 Oct) Not asked by default: nothing is recorded about how he feels; the workout offers the check-in.
        return sessionCheckInForSkip(gate.reason);
    }
  }

  /** `Start` (Ben, 23 Oct, D1): always starts, today only; a structural change is offered for the plan on the Summary. */
  async function start(given?: SessionCheckIn | null) {
    if (snap === null || startBusy) return;
    const checkIn = given === undefined ? await checkInFor() : given;
    if (checkIn === 'ask') {
      setCheckInSheet(true);
      return;
    }
    // First Start ever: the one-time Rest alerts question; either answer continues this Start.
    await alertsAsk.ensureAsked();
    setStartBusy(true);
    const r = await services.builder.start(snap.draftId, { opId: startOp.current, expectedVersion: snap.version, checkIn });
    setStartBusy(false);
    if (r.ok) {
      setCheckInSheet(false);
      changed();
      navigation.dispatch(openStartedWorkout());
      return;
    }
    // Nothing was created: a new tap is a new op ID.
    startOp.current = newUuid();
    // Another workout is in progress: Today, where it resumes.
    if (r.reason === 'active') {
      setCheckInSheet(false);
      navigation.dispatch(popToToday(r.message));
      return;
    }
    if (r.reason === 'stale') {
      await reload();
      showToast({ text: r.message, undoOpId: null, why: null });
      return;
    }
    showToast({ text: r.message, undoOpId: null, why: null });
  }

  async function openReview() {
    if (snap === null) return;
    // The bar's reach is the sheet's status too (one source on the page; wiring S2).
    await runReview(snap, reach, builderReviewProvider(), setReview);
  }

  async function pickScore(n: CheckInScore) {
    if (!checkInSheet || scoring) return;
    setScoring(true);
    const r = await saveScore({ record: (q) => services.checkIns.record(q), update: (id, patch, version, opId) => services.checkIns.update(id, patch, version, opId), newOpId: newUuid }, { current: null, score: n, checkInId, opId: checkInOp });
    setScoring(false);
    if (r.kind !== 'saved') {
      showToast({ text: r.kind === 'failed' ? r.message : WORKOUT_COPY.outOfDate, undoOpId: null, why: null });
      return;
    }
    changed();
    setCheckInSheet(false);
    // At or below the What's up? setting: the reasons step first; its exits come back here, and Start reuses this check-in.
    if (scoreStepOf(r, n) === 'reasons') {
      navigation.navigate('CheckIn', { mode: 'overview', checkInId: r.checkIn.id });
      return;
    }
    await start({ kind: 'answered', checkInId: r.checkIn.id });
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
  const todayView = todayOptionsView(todayOpts, snap);

  /**
   * `⋯` (§7): `Save to Workouts` for a workout that isn't a plan day or a saved workout already; (Ben, 23 Oct) `Save as a
   * variation` for a plan day (§1.3).
   */
  const moreItems: { label: string; run: () => void }[] = [
    ...(snap.canSave ? [{ label: WORKOUT_COPY.saveToWorkouts, run: () => void save.open({ kind: 'draft', draftId: snap.draftId, gymId: snap.gymId }, snap.name) }] : []),
    ...(snap.canSaveVariation ? [{ label: services.builder.copy.saveAsVariation, run: () => void openVariationName() }] : []),
    // (Redesign v3 §A9) Earlier unused edits: offered here, not as status lines on the page.
    ...earlierEditsMenu(earlier).map((e) => ({ label: e.label, run: () => { navigation.dispatch(builderPage('BuilderWorkout', { draftId: e.draftId })); } })),
  ];
  const openMore = () => {
    const options = [...moreItems.map((m) => m.label), 'Cancel'];
    ActionSheetIOS.showActionSheetWithOptions({ options, cancelButtonIndex: moreItems.length }, (i) => {
      moreItems[i]?.run();
    });
  };

  async function openVariationName() {
    const cur = snapRef.current;
    if (cur === null) return;
    const prefill = await services.builder.variationPrefill(cur.draftId).catch(() => null);
    variationOp.current = newUuid();
    setVariationName(prefill ?? '');
  }

  /** The name sheet's Save: one write; `<label> saved · Undo` (Undo deletes it). Null closes the sheet; text is its error. */
  async function saveVariation(label: string): Promise<string | null> {
    const cur = snapRef.current;
    if (cur === null) return services.builder.copy.failed;
    const r = await services.builder.saveAsVariation(cur.draftId, { label, opId: variationOp.current }).catch(() => ({ ok: false as const, message: services.builder.copy.failed }));
    if (!r.ok) return r.message;
    setVariationName(null);
    changed();
    const u = r.undo;
    showToast({ text: services.builder.copy.saved(u.label), undoOpId: null, why: null, onUndo: () => {
      showToast(null);
      void services.builder.deleteVariation(u.id, { opId: newUuid(), expectedVersion: u.version }).then((d) => {
        if (!d.ok) showToast({ text: d.message, undoOpId: null, why: null });
        changed();
      });
    } });
    return null;
  }

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
        {...(toast.onUndo !== undefined ? { action: WORKOUT_COPY.undo, onAction: toast.onUndo } : toast.undoOpId !== null ? { action: WORKOUT_COPY.undo, onAction: () => void undo(toast.undoOpId ?? '') } : {})}
        {...(toast.why !== null && !toast.whyOpen ? { secondary: WORKOUT_COPY.why, onSecondary: () => { setToast({ ...toast, whyOpen: true }); } } : {})}
        onDismiss={() => { showToast(null); }}
        showClose={screenReader}
      />
    );

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
              {moreItems.length > 0 ? <TextButton label="⋯" accessibilityLabel={WORKOUT_COPY.more} tone="secondary" onPress={openMore} /> : null}
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
          <TimeNoteRow
            minutes={v.time.minutes}
            over={v.time.over}
            note={v.time.note}
            noteLabel={v.time.noteLabel}
            onStep={(d) => void setTime({ dir: d })}
            onNote={() => {
              setTimeDetail(true);
            }}
          />
        </View>
        <ScrollArea scrollEnabled={!dragging}>
          {/* (D3, §2.3a; Ben, 26 Oct) Today's options fold into one `Options` row so the exercises start at the top; their state is the snapshot's (review todaylean S1, S3). */}
          {todayView !== null ? <OptionsRow options={todayView} open={optionsOpen} onToggle={() => { setOptionsOpen((o) => !o); }} onChange={(c) => void setTodayOption(c)} onMix={() => void mixItUp()} /> : null}
          {/* (D8; review batch23 S1) The coach's change Ben applied in chat, landed here: it stays with its Undo while it's the last change, not only as a toast. */}
          {snap.coachLanded !== null && toast?.undoOpId !== snap.coachLanded.undoOpId ? (
            <StatusLine
              icon="sparkles"
              tone="info"
              text={snap.coachLanded.text}
              action={
                <TextButton
                  label={WORKOUT_COPY.undo}
                  onPress={() => {
                    const landed = snapRef.current?.coachLanded ?? null;
                    if (landed !== null) void undo(landed.undoOpId);
                  }}
                />
              }
            />
          ) : null}
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
                          const add = () => {
                            for (const id of l.add) void edit({ kind: 'add_exercise', exerciseId: id });
                          };
                          // Rule 9: a flagged exercise asks first, as the Swap and Add sheets do.
                          const c = addAnywayConfirm(snap, l.add);
                          if (c === null) {
                            add();
                            return;
                          }
                          Alert.alert(c.title, c.message ?? undefined, [
                            { text: c.cancel, style: 'cancel' },
                            { text: c.confirm, onPress: add },
                          ]);
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
          {/* The table, shared with the one workout editor (Ben, 23 Oct): drops the builder takes only (the main lift, more than 4, a no-op spring back; review S5). */}
          <WorkoutTable
            rounds={v.rounds}
            topHeader={v.topHeader}
            canAdd={v.canAdd}
            dragging={dragging}
            onDragChange={setDragging}
            canDrop={(slotKey, t) => snapRef.current !== null && dropBuilderSlot(snapRef.current.workout.blocks, slotKey, t.key, t.edge) !== null}
            onDrop={(slotKey, t) => void edit({ kind: 'drop', slotKey, targetKey: t.key, edge: t.edge })}
            onRowPress={(r) => {
              setPopup(r.slotKey);
            }}
            onRowAction={rowAction}
            onAdd={() => void openSwap(null)}
          />
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
            // (Ben, 26 Oct; app review finding 10, option a) Typing opens the coach sheet, as on Today: its `builder`
            // entry sends the words to askEdit and shows proposal cards with Apply / Skip there (rule 3).
            navigation.navigate('Coach', { entry: { kind: 'builder', draftId: snap.draftId, name: snap.name }, focus: true });
          }}
        />
        <View style={{ flexDirection: 'row', gap: theme.space['2'], alignItems: 'center' }}>
          <View style={{ flex: 1 }}>
            <StartButton enabled={v.startEnabled} busy={startBusy} onPress={() => void start()} />
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
        sections={swap?.sections ?? []}
        actionWord={swap?.slotKey == null ? 'Add' : 'Swap'}
        onPick={(id) => void pick(id)}
        onClose={closeSwap}
        onDismissed={addOwn.onDismissed}
        picker={{
          view: pickerView,
          query: picker.query,
          onQuery: picker.setQuery,
          index: picker.index,
          equipment: picker.equipment,
          onEquipment: picker.setEquipment,
          onChip: (g) => {
            picker.setGroup(g);
            if (swap !== null) void openSwap(swap.slotKey, g === null ? { fresh: false } : { group: g, fresh: false });
          },
          onAddOwn: (name) => {
            if (swap === null) return;
            addOwn.start(swap.slotKey, name);
            closeSwap();
          },
        }}
      />
      <TimeDetailSheet
        visible={timeDetail && v.time.note !== null}
        minutes={v.time.minutes}
        lines={v.time.lines}
        undoMinutes={v.time.undoMinutes}
        onUndo={(back) => void setTime({ to: back })}
        onClose={() => {
          setTimeDetail(false);
        }}
        carry={snap.carry === null ? null : { state: snap.carry.state, lines: snap.carry.lines }}
        onCarry={(c) => void carryOver(c)}
      />
      {alertsAsk.sheet}
      {save.sheet}
      <NameSheet
        visible={variationName !== null}
        title={services.builder.copy.saveAsVariation}
        buttonLabel="Save"
        initialName={variationName ?? ''}
        check={(n) => Promise.resolve(n.trim() === '' ? { ok: false as const, message: 'Give it a name' as const } : { ok: true as const, name: n.trim(), note: null })}
        onSubmit={saveVariation}
        onClose={() => {
          setVariationName(null);
        }}
      />
      <BottomCard visible={checkInSheet} onClose={() => { setCheckInSheet(false); }}>
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
            setCheckInSheet(false);
            if (pending) void start({ kind: 'skipped', atUtc: services.now().utc });
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

/**
 * (Ben, 26 Oct; app review finding 7; §2.3a; redesign v3 §A8) Today's options as one clear card: a bold `Options`
 * label on a ≥ 56 pt row with what's on (`Abs · Supersets`) and `⌄`. Collapsed by default so the table starts near the
 * top; a tap shows the same controls (Main lift, Accessories, Abs, Supersets, Mix it up) under it. Each control is
 * still one change the service makes, with Undo.
 */
/** (Redesign v3 §A8) The Options card's row height. */
const OPTIONS_ROW_MIN_HEIGHT = 56;

function OptionsRow({ options, open, onToggle, onChange, onMix }: { options: TodayOptions; open: boolean; onToggle: () => void; onChange: (c: TodayOptionChange) => void; onMix: () => void }) {
  const theme = useTheme();
  const summary = todayOptionsSummary(options);
  return (
    <View style={{ borderRadius: theme.radius.lg, backgroundColor: theme.colors['bg.surface'], paddingHorizontal: theme.space['4'] }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={summary.accessibilityLabel}
        accessibilityState={{ expanded: open }}
        onPress={onToggle}
        style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', minHeight: OPTIONS_ROW_MIN_HEIGHT, gap: theme.space['2'], opacity: pressed ? 0.7 : 1 })}
      >
        <AppText variant="headline">{OPTIONS_ROW_COPY.title}</AppText>
        <AppText variant="callout" color="text.secondary" numberOfLines={1} style={{ flex: 1, textAlign: 'right' }}>
          {open ? '' : summary.text}
        </AppText>
        <Icon name={open ? 'chevron.up' : 'chevron.down'} color="text.secondary" size={16} />
      </Pressable>
      {open ? <TodayOptionRows options={options} onChange={onChange} onMix={onMix} /> : null}
    </View>
  );
}
