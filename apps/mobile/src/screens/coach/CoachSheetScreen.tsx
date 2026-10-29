import { useFocusEffect, useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Keyboard, Linking, Pressable, ScrollView, useWindowDimensions, View, type TextInput } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { undoOpId, type ContextDescription } from '@fizz/coach';
import { coachUndoRefusal, localDateOf, toIso, toMs } from '@fizz/domain';
import type { BenInput, BuildFocus, CoachThread } from '@fizz/schemas';

import { MANAGE_USAGE_URL } from '../../ai/coach-connection-view';
import { nowMs as clockNow } from '../../clock';
import { coachScopeOf, isGeneralEntry, type CoachAvailability, type CoachEntry } from '../../coach/coach-service';
import { onThread } from '../../coach/running-turns';
import {
  COACH_DONE_ACCESSORY_ID,
  COACH_TRANSCRIPT_KEYBOARD,
  loadedOutOfContext,
  missingOutOfContext,
  routeLine,
  seesLabel,
  starterChips,
  offerLabel,
  isAtBottom,
  followOffset,
  replyText,
  stampedKeys,
  transcriptFollow,
  type WorkoutChipContext,
  startLiveTurn,
  liveTurnOf,
  statusView,
  thinkingLabel,
  threadRows,
  workoutBarText,
  type LiveTurn,
  answerSaveOf,
  type QuestionCardView,
  type StarterChip,
  type StatusAction,
  type ThreadRow,
  type ViewIcon,
  type WorkoutOutOfContext,
  takeAsk,
} from '../../coach/sheet-view';
import { useDevicePrefs } from '../../device/DevicePrefsContext';
import { newUuid } from '../../device/runtime';
import { addedMessage, takeAdded } from '../../library/exercise-form-handoff';
import { createReplyVoice, replyToSpeak, sheetReadOn } from '../../voice/read-aloud';
import { appleSpeaker, voiceCapability } from '../../voice/speaker';
import { formatTime, formatWhen } from '../../format/dates';
import type { RootStackParams } from '../../navigation/types';
import { useDataChanged, useServices } from '../../shell/context';
import { TIMING, useTheme } from '../../theme';
import { AppText, Chip, DomainLabel, Icon, KeyboardDoneAccessory, SecondaryButton, SheetKeyboardAvoidingView, TEXT_PRESSED_OPACITY, TextButton, TextField, useKeyboardVisible } from '../../ui';
import { DraftEditCard, SetupFillCard, useOpenSetup } from './DraftCards';
import { CoachCard } from './CoachCard';
import { HeaderButton, SendButton } from './SheetButtons';
import { BuildQuestionCard, BuildRequestCard, PendingBuildCard, QUESTION_COPY, WorkoutDraftCard } from './BuildCards';
import { PlanCard } from './PlanCard';
import { ActivityOfferCard, WeekProposalCard } from './WeekCards';
import { BUILD_COPY, buildCardView, needsCoachView, questionTap, type BuildDayChip } from '../../coach/build-view';

/**
 * The coach sheet (coach-sheet.md, ADR 0020 C6). A side door: it never opens
 * itself, and nothing in the workout waits for it. Every change shows as a
 * card from the saved record with Undo; the coach's words are only advice.
 * The typed text stays in the field when the coach can't answer, and nothing
 * is sent later on its own (CS4). Minimal copy: states are a word or two,
 * the rest behind `Why?`.
 */

/** Typed text per entry, kept while the app runs (closing the sheet keeps it; CS4). */
const drafts = new Map<string, string>();
const entryKey = (e: CoachEntry): string =>
  e.kind === 'today' ? 'today' : e.kind === 'progress' ? `progress:${e.period}` : e.kind === 'progress_exercise' ? `exercise:${e.exerciseName}:${e.seriesLabel}` : e.kind === 'draft' ? `draft:${e.draftId}` : e.kind === 'builder' ? `builder:${e.draftId}` : `${e.kind}:${e.sessionId}`;

export function CoachSheetScreen() {
  const params = useRoute<RouteProp<RootStackParams, 'Coach'>>().params;
  // ADR 0039 (Ben, 29 Oct): Your workout's bar opens the same thread sheet as every chat, with that draft in context and
  // the same tools; its changes to the draft come back as proposals with Apply / Skip (rule 3).
  return <ThreadCoachSheet {...params} entry={params.entry} />;
}

/** (Ben, 29 Oct) Today's words already sent from this app run (`takeAsk`): a remount never sends them twice. */
const sentAsks = new Set<string>();

function ThreadCoachSheet({ entry, focus = false, build: buildParam, draft: draftParam, ask: askParam }: Omit<RootStackParams['Coach'], 'entry'> & { entry: CoachEntry }) {
  const theme = useTheme();
  const services = useServices();
  const changed = useDataChanged();
  const navigation = useNavigation();
  const openSetup = useOpenSetup();
  const insets = useSafeAreaInsets();
  const key = entryKey(entry);

  const [availability, setAvailability] = useState<CoachAvailability | null>(null);
  const [threadId, setThreadId] = useState<string | null | undefined>(undefined);
  const [title, setTitle] = useState<string>('Coach');
  const [rows, setRows] = useState<ThreadRow[]>([]);
  const [live, setLive] = useState<LiveTurn | null>(null);
  // `draft` (Your plan's `Ask coach to change`, 19 Oct) starts an empty field; text Ben already typed here wins. Nothing is sent.
  const [text, setText] = useState(() => {
    const kept = drafts.get(key) ?? '';
    return kept.trim() === '' && draftParam !== undefined ? draftParam : kept;
  });
  const [now, setNow] = useState(clockNow);
  const [statusWhy, setStatusWhy] = useState(false);
  const [sees, setSees] = useState<ContextDescription | null>(null);
  /** Today in the profile zone, as the coach context uses (review ben-bugs r2 N2). */
  const [profileToday, setProfileToday] = useState<string | null>(null);
  const [threads, setThreads] = useState<CoachThread[] | null>(null);
  const [workout, setWorkout] = useState<{ title: string | null; active: boolean; out: WorkoutOutOfContext | null; bar: string; exercise: { id: string; name: string } | null; chips: WorkoutChipContext | null } | null>(null);
  const [askPain, setAskPain] = useState(false);
  /** The movements `Pain` can flag (named, else the focus row, else all); `picking` shows them as chips. */
  const [painChoices, setPainChoices] = useState<{ exerciseId: string; name: string }[]>([]);
  const [picking, setPicking] = useState(false);
  /** Show the choices as chips even when there is one (a short name, say "bench"; never flagged on a guess). */
  const [painPick, setPainPick] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  /**
   * (v2, §6.2; review S7) `Saved to Profile · Undo` is read from the training profile's applied ops, so it
   * survives closing and reopening the sheet. `undoFailed`: this screen's own `Not undone` line.
   */
  const [profileOps, setProfileOps] = useState<{ recentOps: string[]; version: number } | null>(null);
  const [undoFailed, setUndoFailed] = useState<Record<string, true>>({});
  const loadProfileOps = useCallback(async () => {
    setProfileOps(await services.training.appliedOps().catch(() => null));
  }, [services]);
  const savedAnswer = (actionId: string): { text: string; canUndo: boolean } | null => {
    if (undoFailed[actionId] === true) return { text: QUESTION_COPY.notUndone, canUndo: false };
    const s0 = answerSaveOf(actionId, profileOps);
    return s0 === null ? null : s0.state === 'undone' ? { text: 'Undone', canUndo: false } : { text: QUESTION_COPY.saved, canUndo: s0.canUndo };
  };
  /** The Build card (workout-builder §4.1), shown by the chip or an entry from `Build with coach`. */
  const [showBuild, setShowBuild] = useState(buildParam === true);
  /** A build turn running (the pending card, §4.2). */
  const [building, setBuilding] = useState<{ focus: BuildFocus; dayName: string | null; minutes: number; startedAtMs: number } | null>(null);
  /** F19: the Settings split's days for the Build card, the next one selected, and the session length. */
  const [buildCard, setBuildCard] = useState<Awaited<ReturnType<typeof services.training.buildCard>> | null>(null);
  /** The selected gym a build uses (§4.1 gym line). */
  const [buildGym, setBuildGym] = useState<{ id: string; name: string } | null>(null);
  const sendGuard = useRef(0);
  const scroll = useRef<ScrollView>(null);
  /** Design pass 4.1: the transcript follows new content only while Ben is at its end. */
  const followState = useRef(transcriptFollow()).current;
  /**
   * 21 Oct (Ben's Build B report): the transcript's size and the newest turn's top, so following new content shows the
   * newest turn from its start (an outcome line or card never half under the top edge, `followOffset`).
   */
  const transcript = useRef<{ contentHeight: number; viewportHeight: number; turnTop: number | null }>({ contentHeight: 0, viewportHeight: 0, turnTop: null });
  const keyboardUp = useKeyboardVisible();
  const { fontScale, height: windowHeight } = useWindowDimensions();
  /**
   * Replies read aloud (Ben, 19 Oct 2026): by default whenever a workout is in progress (review S4);
   * the header's speaker overrides it for this sheet only, never Settings › Voice (review S5).
   * Stops on typing, closing, or the next reply; a reply arriving after the sheet closed, or while
   * Ben is typing, is never spoken (review B2).
   */
  const { prefs } = useDevicePrefs();
  const replyVoice = useMemo(() => createReplyVoice(appleSpeaker), []);
  const readAloud = useRef(false);
  const [readOverride, setReadOverride] = useState<boolean | null>(null);
  /** A workout in progress, however the sheet was opened. */
  const [sessionActive, setSessionActive] = useState(false);
  /** The sheet is showing (focused and mounted). */
  const sheetOpen = useRef(false);
  const typedText = useRef(text);
  typedText.current = text;
  // (19 Oct) Back from the new-exercise card's Edit with it saved: Ben's `Added <name>.` carries the coach on.
  const afterAddedRef = useRef<(name: string) => void>(() => undefined);
  useFocusEffect(
    useCallback(() => {
      const added = takeAdded();
      if (added !== null) afterAddedRef.current(added.name);
    }, []),
  );
  useFocusEffect(
    useCallback(() => {
      sheetOpen.current = true;
      let alive = true;
      void services.sessions
        .active()
        .then((a) => {
          if (alive) setSessionActive(a !== null && a.session.status === 'active');
        })
        .catch(() => undefined);
      return () => {
        alive = false;
        sheetOpen.current = false;
        void replyVoice.hush();
      };
    }, [services, replyVoice]),
  );
  const field = useRef<TextInput>(null);

  const loadRows = useCallback(
    async (id: string | null) => {
      if (id === null) {
        setRows([]);
        setTitle('Coach');
        return;
      }
      const data = await services.coach.loadThread(id);
      if (data === null) return;
      // (Ben, 28 Oct) A turn running in the service shows as the live turn; one saved `running` that isn't was cut off.
      setRows(threadRows({ ...data, nowUtc: toIso(clockNow()), running: (turnId) => services.coach.isRunning(turnId) }));
      setTitle(data.thread.title);
    },
    [services],
  );

  /**
   * (Ben, 28 Oct: "it stops 'running' if I move away from the chat screen") The turn runs in the service, not here.
   * The sheet attaches to the turn running on its thread (on mount, on focus, when its thread is known) and follows
   * it: the same live rows and Stop, Send off. When it ends the rows are read again, whether or not the sheet was
   * open the whole time.
   */
  const scope = coachScopeOf(entry);
  const threadRef = useRef(threadId);
  threadRef.current = threadId;
  const attached = useRef<string | null>(null);
  const syncLive = useCallback(() => {
    const r = services.coach.running.runningOn(threadRef.current ?? null, scope);
    attached.current = r?.turnId ?? null;
    setLive(r === null ? null : liveTurnOf(r));
  }, [services, scope]);
  useEffect(() => {
    syncLive();
    return services.coach.running.subscribe((e) => {
      if (e.kind === 'finished') {
        if (attached.current !== e.turn.turnId) return;
        attached.current = null;
        setLive(null);
        const id = e.turn.threadId ?? threadRef.current ?? null;
        if ((threadRef.current ?? null) === null && id !== null) setThreadId(id);
        void loadRows(id);
        return;
      }
      if (!onThread(e.turn, threadRef.current ?? null, scope)) {
        if (attached.current === e.turn.turnId) syncLive();
        return;
      }
      attached.current = e.turn.turnId;
      setLive(liveTurnOf(e.turn));
    });
  }, [services, scope, loadRows, syncLive]);
  useEffect(() => {
    syncLive();
  }, [threadId, syncLive]);
  useFocusEffect(syncLive);

  /** The workout as last read; the bar is worked out from it each second without reading SQLite (review N3). */
  const loadedWorkout = useRef<Awaited<ReturnType<typeof services.workout.load>>>(null);
  /** Set when the thread's workout couldn't be loaded: purged (`deleted`) or not readable (`unavailable`). */
  const missingWorkout = useRef<WorkoutOutOfContext | null>(null);
  const showWorkout = useCallback(() => {
    const d = loadedWorkout.current;
    if (d === null) {
      // The coach gets nothing of it; the chip never says `Sees: this workout` then (review r2 N3).
      const out = missingWorkout.current;
      setWorkout(out === null ? null : { title: null, active: false, out, bar: '', exercise: null, chips: null });
      return;
    }
    const active = d.aggregate.session.status === 'active';
    const v = active ? services.workout.view(d, clockNow(), null) : null;
    const rest = v?.rest ?? null;
    setWorkout({
      title: d.aggregate.session.routineName ?? d.title,
      active,
      // Out of the coach's context; the chip says so (delete-workouts §5, DW16): deleted, or discarded/reverted (review r2 N3).
      out: loadedOutOfContext(d.aggregate.session),
      bar: workoutBarText(rest === null ? null : rest.kind === 'ended' ? { kind: 'ended' } : { kind: rest.kind, remainingMs: rest.remainingMs }, d.aggregate.session.pause !== null),
      exercise: v?.focus ? { id: v.focus.exerciseId, name: v.focus.exerciseName } : null,
      chips: active ? services.workout.chatContext(d) : null,
    });
  }, [services]);

  const loadWorkout = useCallback(async () => {
    if (isGeneralEntry(entry)) return;
    loadedWorkout.current = await services.workout.load(entry.sessionId).catch(() => null);
    missingWorkout.current =
      loadedWorkout.current !== null ? null : missingOutOfContext((await services.history.presence(entry.sessionId).catch(() => ({ kind: 'missing' as const }))).kind);
    showWorkout();
  }, [entry, services, showWorkout]);

  useFocusEffect(
    useCallback(() => {
      const screen = { alive: true };
      const alive = (): boolean => screen.alive;
      void (async () => {
        const a = await services.coach.availability();
        if (!alive()) return;
        setAvailability(a);
        const g = await services.yourData.currentGym().catch(() => null);
        if (!alive()) return;
        setBuildGym(g === null ? null : { id: g.id, name: g.name });
        const card = await services.training.buildCard().catch(() => null);
        if (!alive()) return;
        setBuildCard(card);
        const ops = await services.training.appliedOps().catch(() => null);
        if (!alive()) return;
        setProfileOps(ops);
        const today = await services.coach.today().catch(() => null);
        if (!alive()) return;
        setProfileToday(today);
        const id = threadId === undefined ? await services.coach.resolveThread(entry).catch(() => null) : threadId;
        if (!alive()) return;
        if (threadId === undefined) setThreadId(id);
        await loadRows(id);
        await loadWorkout();
      })();
      return () => {
        screen.alive = false;
      };
    }, [services, entry, threadId, loadRows, loadWorkout]),
  );

  // (Ben, 29 Oct: "The mic listens but doesn't do anything") Words from Today's bar go as his message as soon as the
  // sheet knows its thread: the running turn shows at once, and a failure is the sheet's own line (`Not sent.`).
  const sendRef = useRef<(input: BenInput) => Promise<void>>(() => Promise.resolve());
  useEffect(() => {
    if (threadId === undefined || availability === null) return;
    const input = takeAsk(sentAsks, askParam);
    if (input === null) return;
    sendRef.current(input).catch(() => {
      setDraft(input.text);
      setNotice('Not sent.');
    });
  }, [threadId, availability, askParam]);

  // One ticker for the elapsed label and the workout bar; no animation (check 22). The bar is
  // worked out from the loaded workout; it's read again on focus, after a change, and every 15 s.
  useEffect(() => {
    let ticks = 0;
    const t = setInterval(() => {
      setNow(clockNow());
      if (entry.kind !== 'workout') return;
      ticks += 1;
      if (ticks % 15 === 0) void loadWorkout();
      else showWorkout();
    }, 1000);
    return () => {
      clearInterval(t);
    };
  }, [entry, loadWorkout, showWorkout]);

  useEffect(() => {
    if (!focus) return;
    const id = requestAnimationFrame(() => field.current?.focus());
    return () => {
      cancelAnimationFrame(id);
    };
  }, [focus]);

  const setDraft = (t: string) => {
    setText(t);
    if (t !== '') void replyVoice.hush();
    if (t === '') drafts.delete(key);
    else drafts.set(key, t);
  };

  sendRef.current = send;
  async function send(input: BenInput) {
    // A double tap within the commit guard sends once; a turn running blocks another.
    if (live !== null || clockNow() - sendGuard.current < TIMING.commitGuard) return;
    sendGuard.current = clockNow();
    const turnId = newUuid();
    setNotice(null);
    setAskPain(false);
    setLive(startLiveTurn(turnId, input, clockNow()));
    const typed = input.kind === 'words' ? input.text : null;
    if (typed !== null) setDraft('');
    // Build 131: the keyboard goes down on Send so the answer has the room; the transcript keeps to its end.
    Keyboard.dismiss();
    void replyVoice.hush();
    try {
      // Its live rows follow the service's running turn (`syncLive`), so they carry on if the sheet closes and reopens.
      const r = await services.coach.send({ entry, threadId: threadId ?? null, input, turnId });
      setThreadId(r.threadId);
      const words = replyToSpeak(r, readAloud.current, { open: sheetOpen.current, typing: typedText.current.trim() !== '' });
      if (words !== null) void replyVoice.say(words);
      setPicking(false);
      if (r.askPain === null) setAskPain(false);
      else {
        // The movement Ben's words name (chips if several); in a workout, else the one in focus (review S5, r2 S1).
        const focusEx = workout?.active === true && workout.exercise !== null ? { exerciseId: workout.exercise.id, name: workout.exercise.name } : null;
        const pc = await services.coach.painChoices(entry, typed, focusEx).catch(() => ({ choices: focusEx === null ? [] : [focusEx], pick: true }));
        setPainChoices(pc.choices);
        setPainPick(pc.pick);
        setAskPain(pc.choices.length > 0);
      }
      await loadRows(r.threadId);
      if (r.cards.length > 0) {
        changed();
        void loadWorkout();
      }
    } catch {
      // Not sent (no route): the words go back in the field; nothing is queued (CS4).
      if (typed !== null) setDraft(typed);
      setNotice('Not sent.');
    } finally {
      syncLive();
      setAvailability(await services.coach.availability());
    }
  }

  /**
   * A tap on the coach's question (workout-builder v2.1 §6.2): sends the answer
   * (or `Skip`) as Ben's message. Offline, nothing is saved or sent (`Needs the
   * coach`). A tapped main lift for a split day Ben hasn't set is saved to his
   * training profile (versioned), with Undo on the card.
   */
  async function answerQuestion(q: QuestionCardView, a: { label: string; catalogueId: string | null } | 'skip') {
    if (live !== null) return;
    const tap = questionTap(await services.coach.buildBlock(), q, a, QUESTION_COPY.skip);
    if (tap.kind === 'blocked') {
      setNotice(tap.line);
      return;
    }
    if (tap.saveMainLift !== null) {
      const saved = await services.training.saveMainLiftAnswer(tap.saveMainLift).catch(() => null);
      if (saved !== null) await loadProfileOps();
    }
    await send({ kind: 'words', text: tap.text, spoken: false });
  }

  async function undoAnswerSave(q: QuestionCardView) {
    const s0 = answerSaveOf(q.actionId, profileOps);
    if (s0 === null || !s0.canUndo || q.day === null || profileOps === null) return;
    // Undo only on the version the answer saved: it is still the profile's newest change (`canUndo`).
    const r = await services.training.undoMainLiftAnswer({ dayId: q.day.id, savedVersion: profileOps.version, opId: `${q.actionId}:main-lift-undo` }).catch(() => 'changed' as const);
    if (r !== 'undone') setUndoFailed((m) => ({ ...m, [q.actionId]: true }));
    await loadProfileOps();
  }

  /** `Build` on the Build card (§4.1): one message from the chips and one build turn; the pending card until it ends. */
  async function build(minutes: number | null, chip: BuildDayChip | null) {
    if (live !== null || clockNow() - sendGuard.current < TIMING.commitGuard) return;
    sendGuard.current = clockNow();
    const turnId = newUuid();
    const f: BuildFocus = chip?.focus ?? 'coach_picks';
    const message = buildCardView({ minutes, days: chip === null ? [] : [chip], dayId: chip?.id ?? null, gymName: buildGym?.name ?? null }).message;
    setShowBuild(false);
    setNotice(null);
    Keyboard.dismiss();
    setBuilding({ focus: f, dayName: chip?.day.name ?? null, minutes: minutes ?? 60, startedAtMs: clockNow() });
    setLive(startLiveTurn(turnId, { kind: 'words', text: message, spoken: false }, clockNow()));
    try {
      const r = await services.coach.buildWorkout({
        entry,
        threadId: threadId ?? null,
        turnId,
        minutes,
        focus: f,
        day: chip?.day ?? null,
        mainLift: chip === null ? null : (buildCard?.mainLifts[chip.id]?.name ?? null),
        extra: text,
        origin: 'card',
      });
      if (!r.ok) {
        setNotice(needsCoachView(r.block).line);
        return;
      }
      setDraft('');
      setThreadId(r.result.threadId);
      await loadRows(r.result.threadId);
      if (r.result.cards.length > 0) changed();
    } catch {
      setNotice('Not sent.');
    } finally {
      setBuilding(null);
      syncLive();
      setAvailability(await services.coach.availability());
    }
  }

  /** `Open ›` (§4.2): close the sheet, then the draft on Your workout (22 Oct: the Workout overview is retired). */
  function openDraft(draftId: string) {
    navigation.goBack();
    navigation.navigate('BuilderWorkout', { open: { kind: 'coach_draft', draftId }, back: 'Back' });
  }

  function openRoutine(routineId: string) {
    navigation.goBack();
    navigation.navigate('BuilderWorkout', { open: { kind: 'routine', routineId }, back: 'Back' });
  }

  /** `Try again` on a turn's row: that turn's own words as a new turn; a cut-off summary review runs again. */
  async function retry(input: BenInput) {
    if (input.kind !== 'summary') return send(input);
    if (isGeneralEntry(entry) || live !== null) return;
    setNotice(null);
    setLive(startLiveTurn(newUuid(), input, clockNow()));
    try {
      // Null: the coach can't answer now (review N1); the same word `send` shows.
      const r = await services.coach.runSummaryTurn(entry.sessionId).catch(() => null);
      if (r === null) setNotice('Not sent.');
    } finally {
      syncLive();
      setAvailability(await services.coach.availability());
    }
    await loadRows(threadId ?? (await services.coach.resolveThread(entry).catch(() => null)));
    changed();
  }

  async function undo(actionId: string) {
    const r = await services.coach.undo(actionId, undoOpId(actionId)).catch(() => null);
    if (r === null) {
      setNotice('Couldn’t undo.');
      return;
    }
    setNotice(r.result.status === 'not_possible' ? `Couldn’t undo: ${r.undo.failure ?? 'it changed since'}.` : null);
    await loadRows(threadId ?? null);
    changed();
    void loadWorkout();
  }

  /** Apply or Not now on a structural proposal (ADR 0020 §3): saved at once; a stale card comes back `Out of date`. */
  async function tapProposal(proposalId: string, tap: 'apply' | 'not_now') {
    const r = await services.coach.tapProposal(proposalId, tap).catch(() => null);
    setNotice(r === null ? 'Couldn’t apply.' : r.ok ? null : r.state === 'out_of_date' || r.state === 'used' ? 'Out of date. Nothing changed.' : 'Couldn’t apply.');
    await loadRows(threadId ?? null);
    changed();
  }

  /** (20 Oct, ADR 0029) Apply or Not now on the coach's gym suggestion; a gym that changed since comes back `Out of date`. */
  async function tapGymProposal(proposalId: string, tap: 'apply' | 'not_now') {
    const r = await services.coach.tapGymProposal(proposalId, tap).catch(() => null);
    setNotice(r === null ? 'Couldn’t apply.' : r.ok ? null : r.state === 'out_of_date' ? 'Out of date. Nothing changed.' : null);
    await loadRows(threadId ?? null);
    changed();
  }

  /**
   * (19 Oct) The coach's new-exercise card: `Add` saves it now (rule 3), then Ben's `Added <name>.`
   * goes to the coach so it carries on with what he asked (only when it can answer: the exercise is
   * saved either way). `Edit` opens the form with the card's fields; its Save is the Add.
   */
  async function tapNewExercise(actionId: string, tap: 'add' | 'edit') {
    if (tap === 'edit') {
      const card = await services.coach.exerciseProposal(actionId).catch(() => null);
      if (card === null || card.state !== 'open') return;
      navigation.navigate('ExerciseForm', { proposalActionId: actionId, fields: card.fields });
      return;
    }
    const r = await services.coach.addProposedExercise({ actionId, opId: `${actionId}:add` }).catch(() => null);
    if (r === null || !r.ok) {
      setNotice(r?.message ?? 'Couldn’t save.');
      await loadRows(threadId ?? null);
      return;
    }
    changed();
    await afterAdded(r.exercise.name);
  }

  async function afterAdded(name: string) {
    await loadRows(threadId ?? null);
    if (status?.canSend === true && live === null) await send({ kind: 'words', text: addedMessage(name), spoken: false });
  }
  afterAddedRef.current = (name) => {
    void afterAdded(name);
  };

  /** Save, Not now or (CM9 split) Add to playbook on a memory suggestion (coach-memory §2.4, §2.4a). */
  async function decideMemory(memoryId: string, version: number, decision: 'save' | 'not_now' | 'playbook') {
    if (decision === 'playbook') {
      const p = await services.coach.memoryToPlaybook(memoryId, version, newUuid()).catch(() => null);
      setNotice(p === null || (!p.ok && p.reason === 'missing') ? 'Couldn’t save.' : p.ok ? (p.rejectedBefore ? 'Rejected before.' : null) : 'Out of date.');
      await loadRows(threadId ?? null);
      changed();
      return;
    }
    const r = await services.coach.decideMemory(memoryId, version, decision).catch(() => null);
    setNotice(r === null || r.status === 'missing' ? 'Couldn’t save.' : r.status === 'duplicate' ? 'Already saved.' : r.status === 'stale' ? 'Out of date.' : null);
    await loadRows(threadId ?? null);
    changed();
  }

  async function flag(ex: { id: string; name: string }) {
    const r = await services.pain.flagMovement({ exerciseId: ex.id, exerciseName: ex.name, opId: newUuid() });
    setAskPain(false);
    setPicking(false);
    setNotice(r.ok ? `Pain noted for ${ex.name}.` : r.message);
    changed();
    void loadWorkout();
  }

  async function pain() {
    const [only, ...more] = painChoices;
    if (only === undefined) return;
    if (more.length === 0 && !painPick) return flag({ id: only.exerciseId, name: only.name });
    setPicking(true);
  }

  function statusAction(a: StatusAction) {
    if (a === 'manage_usage') {
      void Linking.openURL(MANAGE_USAGE_URL);
      return;
    }
    navigation.navigate('Tabs', { screen: 'Profile', params: { screen: 'CoachConnection' } });
  }

  /** A coach change to today's sets can't be undone once the gym changed after it (review r2 B1). */
  const undoBlocked = (actionId: string): boolean => {
    const d = loadedWorkout.current;
    return d !== null && coachUndoRefusal(d.aggregate, actionId) !== null;
  };

  // Design pass 4.2: with the keyboard up, the Sees panel closes (its chip hides) so the conversation keeps its room.
  useEffect(() => {
    if (keyboardUp) setSees(null);
  }, [keyboardUp]);

  const status = availability === null ? null : statusView(availability, entry.kind === 'workout' && workout?.active === true);
  const route = availability === null ? null : routeLine(availability);
  const chips: StarterChip[] = availability === null ? [] : starterChips(entry, availability, workout?.active === true, workout?.chips ?? null);
  const empty = rows.length === 0 && live === null;
  const running = live !== null;
  const canSend = status?.canSend === true && text.trim() !== '' && !running;
  const liveWorkout = (entry.kind === 'workout' && workout?.active === true) || sessionActive;
  const canSpeak = voiceCapability().speech;
  const readOn = canSpeak && sheetReadOn(prefs.voice.readReplies, liveWorkout, readOverride);
  readAloud.current = readOn;

  const header = (
    <View style={{ flexDirection: 'row', alignItems: 'center', minHeight: 44, paddingHorizontal: theme.space['2'] }}>
      <HeaderButton
        icon="list.bullet"
        label="Conversations"
        onPress={() => {
          void services.coach.listThreads().then(setThreads);
        }}
      />
      <AppText variant="headline" accessibilityRole="header" maxFontSizeMultiplier={1.5} numberOfLines={1} style={{ flex: 1, textAlign: 'center' }}>
        {title}
      </AppText>
      {canSpeak ? (
        <HeaderButton
          icon={readOn ? 'speaker.wave.2' : 'speaker.slash'}
          label="Read replies aloud"
          toggle={{ on: readOn }}
          onPress={() => {
            if (readOn) void replyVoice.hush();
            setReadOverride(!readOn);
          }}
        />
      ) : null}
      <HeaderButton
        icon="square.and.pencil"
        label="New conversation"
        onPress={() => {
          setThreadId(null);
          setRows([]);
          setTitle('Coach');
          setThreads(null);
        }}
      />
      <HeaderButton icon="xmark" label="Close" onPress={() => { navigation.goBack(); }} />
    </View>
  );

  if (threads !== null) {
    const n = services.now();
    return (
      <View style={{ flex: 1, backgroundColor: theme.colors['bg.canvas'], paddingTop: theme.space['2'] }}>
        {/* Design pass 4.8: the list has its own header (Back, the name, Close) and dated rows. */}
        <View style={{ flexDirection: 'row', alignItems: 'center', minHeight: 44, paddingHorizontal: theme.space['2'] }}>
          <HeaderButton icon="chevron.left" label="Back" onPress={() => { setThreads(null); }} />
          <AppText variant="headline" accessibilityRole="header" maxFontSizeMultiplier={1.5} numberOfLines={1} style={{ flex: 1, textAlign: 'center' }}>
            Conversations
          </AppText>
          <HeaderButton icon="xmark" label="Close" onPress={() => { navigation.goBack(); }} />
        </View>
        <ScrollView contentContainerStyle={{ padding: theme.components.screenMargin, gap: theme.space['2'] }}>
          {threads.length === 0 ? (
            <AppText variant="callout" color="text.secondary">
              No conversations
            </AppText>
          ) : null}
          {threads.map((t) => (
            <Pressable
              key={t.id}
              accessibilityRole="button"
              onPress={() => {
                setThreads(null);
                setThreadId(t.id);
              }}
              style={({ pressed }) => ({ minHeight: 64, justifyContent: 'center', borderBottomWidth: theme.dividerWidth, borderBottomColor: theme.colors['border.divider'], opacity: pressed ? TEXT_PRESSED_OPACITY : 1 })}
            >
              <AppText variant="body" numberOfLines={1}>
                {t.title}
              </AppText>
              <AppText variant="label" color="text.secondary" numeric>
                {formatWhen(toMs(t.updatedAtUtc), toMs(n.utc), n.tz)}
              </AppText>
            </Pressable>
          ))}
        </ScrollView>
      </View>
    );
  }

  /** New rows, a live turn or a build count as added content (4.1). */
  const contentCount = rows.length + (live === null ? 0 : 1 + live.cards.length) + (building === null ? 0 : 1);
  const starters = empty && chips.length > 0 && !showBuild;
  const follow = (): void => {
    // Review S2: another conversation (or a new one) opens at its end.
    followState.thread(threadId);
    if (followState.follow(contentCount, starters)) scroll.current?.scrollTo({ y: followOffset(transcript.current), animated: false });
  };
  /** The newest turn starts at the live turn, else at Ben's last message. */
  const lastBenKey = live !== null ? null : ([...rows].reverse().find((r) => r.kind === 'ben')?.key ?? null);
  const turnTopAt = (y: number): void => {
    transcript.current.turnTop = theme.components.screenMargin + y;
  };
  const stamps = stampedKeys(rows, (utc, tz) => formatTime(toMs(utc), tz));

  return (
    <SheetKeyboardAvoidingView style={{ flex: 1, backgroundColor: theme.colors['bg.canvas'], paddingTop: theme.space['2'] }}>
      {header}
      {workout?.active === true ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Back to workout. ${workout.bar}`}
          onPress={() => { navigation.goBack(); }}
          // 21 Oct: shorter while the keyboard is up, and a gap below it so the transcript never starts flush under it.
          style={{ marginHorizontal: theme.components.screenMargin, marginBottom: theme.space['1'], minHeight: keyboardUp ? 44 : 52, flexDirection: 'row', alignItems: 'center', gap: theme.space['2'], paddingHorizontal: theme.space['3'], backgroundColor: theme.colors['bg.surface'], borderRadius: theme.radius.md }}
        >
          <Icon name="timer" size={18} />
          <AppText variant="callout" numeric style={{ flex: 1 }}>
            {workout.bar}
          </AppText>
          <AppText variant="callout" color="accent">
            Back to workout ›
          </AppText>
        </Pressable>
      ) : null}
      {status?.word ? (
        <View style={{ marginHorizontal: theme.components.screenMargin, marginTop: theme.space['2'], gap: theme.space['1'] }}>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: theme.space['2'] }}>
            <Icon name={status.icon} size={18} color="status.warning" />
            <AppText variant="callout" style={{ flexGrow: 1, flexShrink: 1 }}>
              {status.word}
            </AppText>
            {status.why !== null ? <TextButton label="Why?" tone="secondary" onPress={() => { setStatusWhy((w) => !w); }} /> : null}
            {status.action !== null ? <TextButton label={status.action.label} onPress={() => { statusAction(status.action?.action ?? 'connect'); }} /> : null}
          </View>
          {statusWhy && status.why !== null ? (
            <AppText variant="callout" color="text.secondary">
              {status.why}
            </AppText>
          ) : null}
        </View>
      ) : null}

      <ScrollView
        ref={scroll}
        // 21 Oct (Ben's Build B report): the transcript takes the space left below the status pill and clips at its own
        // top edge, with a hairline there, so nothing in it is ever drawn under the pill.
        style={{ flex: 1, borderTopWidth: theme.dividerWidth, borderTopColor: theme.colors['border.divider'] }}
        // Design pass 4.1: follow new content, or keep the end in view when the keyboard resizes the transcript,
        // only while Ben is at the end; a Why? opened higher up never jumps the view.
        onContentSizeChange={(_w, h) => {
          transcript.current.contentHeight = h;
          follow();
        }}
        onLayout={(e) => {
          transcript.current.viewportHeight = e.nativeEvent.layout.height;
          follow();
        }}
        onScroll={(e) => {
          const n = e.nativeEvent;
          followState.scrolled(isAtBottom({ contentOffsetY: n.contentOffset.y, contentHeight: n.contentSize.height, viewportHeight: n.layoutMeasurement.height }));
        }}
        scrollEventThrottle={64}
        contentContainerStyle={{ padding: theme.components.screenMargin, flexGrow: 1 }}
        {...COACH_TRANSCRIPT_KEYBOARD}
      >
        {/* A tap on the conversation (not on a button in it) hides the keyboard. */}
        <Pressable accessible={false} onPress={() => { Keyboard.dismiss(); }} style={{ flexGrow: 1, gap: theme.space['4'] }}>
        {starters ? (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.space['2'] }}>
            {chips.map((c) => (
              <Chip
                key={c.label}
                label={'build' in c && !c.build.enabled ? `${c.label} · ${BUILD_COPY.needsCoach}` : c.label}
                selected={false}
                disabled={'build' in c && !c.build.enabled}
                onPress={() => {
                  // `Build a workout` (workout-builder §3): the Build card; disabled with `Needs the coach` (§5.4).
                  if ('build' in c) {
                    if (c.build.enabled) setShowBuild(true);
                    return;
                  }
                  if (c.input === null) void pain();
                  else void send(c.input);
                }}
              />
            ))}
          </View>
        ) : null}
        {showBuild && live === null ? (
          <BuildRequestCard gymName={buildGym?.name ?? null} defaultMinutes={buildCard?.sessionMinutes ?? null} days={buildCard?.days ?? []} defaultDayId={buildCard?.nextDayId ?? null} disabled={status?.canSend !== true} onBuild={(minutes, chip) => void build(minutes, chip)} />
        ) : null}
        {building !== null ? <PendingBuildCard focus={building.focus} dayName={building.dayName} minutes={building.minutes} startedAtMs={building.startedAtMs} nowMs={now} onCancel={() => { if (live !== null) services.coach.stop(live.turnId); }} /> : null}
        {rows.map((r) => (
          <View key={r.key} onLayout={r.key === lastBenKey ? (e) => { turnTopAt(e.nativeEvent.layout.y); } : undefined}>
          <Row
            row={r}
            undoBlocked={undoBlocked}
            onUndo={(id) => void undo(id)}
            onProposal={(id, tap) => void tapProposal(id, tap)}
            onGymChange={(id, tap) => void tapGymProposal(id, tap)}
            onMemory={(id, v, d) => void decideMemory(id, v, d)}
            onNewExercise={(id, tap) => void tapNewExercise(id, tap)}
            onRetry={() => r.kind === 'outcome' && r.input !== null && void retry(r.input)}
            onAccept={() => r.kind === 'offer' && live === null && void send(r.input)}
            onDraft={{ gymId: buildGym?.id ?? null, open: openDraft, openRoutine: openRoutine, openSetup, changed: () => { changed(); void loadRows(threadId ?? null); } }}
            stamped={stamps.has(r.key)}
            onQuestion={{
              disabled: live !== null || status?.canSend !== true,
              disabledReason: status?.canSend !== true ? BUILD_COPY.needsCoach : null,
              saved: (actionId) => savedAnswer(actionId),
              answer: (q, a) => void answerQuestion(q, a),
              undoSave: (q) => void undoAnswerSave(q),
            }}
          />
          </View>
        ))}
        {live !== null ? (
          <View onLayout={(e) => { turnTopAt(e.nativeEvent.layout.y); }}>
            <LiveRows live={live} now={now} />
          </View>
        ) : null}
        {askPain ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space['2'] }}>
            <AppText variant="callout" style={{ flex: 1 }}>
              Sore or pain?
            </AppText>
            <TextButton label="Sore" tone="secondary" onPress={() => { setAskPain(false); setPicking(false); }} />
            <TextButton label="Pain" onPress={() => void pain()} />
          </View>
        ) : null}
        {askPain && picking ? (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.space['2'] }} accessibilityLabel="Which movement?">
            {painChoices.map((c) => (
              <Chip key={c.exerciseId} label={c.name} selected={false} onPress={() => void flag({ id: c.exerciseId, name: c.name })} />
            ))}
          </View>
        ) : null}
        {notice !== null ? (
          <AppText variant="callout" color="text.secondary">
            {notice}
          </AppText>
        ) : null}
        </Pressable>
      </ScrollView>

      {/* Design pass 4.2: with the keyboard up, the footer sits on it (no home-indicator room), the Sees chip hides
          and the route line is a short label (still visible, rule 7). */}
      <View style={{ paddingHorizontal: theme.components.screenMargin, paddingBottom: keyboardUp ? theme.space['2'] : insets.bottom + theme.space['2'], gap: theme.space['2'] }}>
        {keyboardUp ? null : (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="What the coach can see"
          onPress={() => {
            if (sees !== null) {
              setSees(null);
              return;
            }
            void services.coach.describe(entry, threadId ?? null).then(setSees);
          }}
          style={{ alignSelf: 'flex-start', minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: theme.space['1'], paddingHorizontal: theme.space['3'], borderRadius: theme.radius.pill, borderWidth: 1, borderColor: theme.colors['border.control'], backgroundColor: theme.colors['bg.raised'] }}
        >
          <Icon name="eye" size={16} />
          <AppText variant="label">{seesLabel(entry, workout?.title ?? null, workout?.active === true, workout?.out ?? null, profileToday ?? localDateOf(toMs(services.now().utc), services.now().tz))}</AppText>
        </Pressable>
        )}
        {sees !== null && !keyboardUp ? <SeesPanel sees={sees} maxHeight={Math.round(windowHeight * 0.35)} /> : null}
        <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: theme.space['2'] }}>
          <View style={{ flex: 1 }}>
            <TextField ref={field} value={text} onChangeText={setDraft} placeholder={status?.placeholder ?? 'Ask the coach…'} multiline inputAccessoryViewID={COACH_DONE_ACCESSORY_ID} style={{ maxHeight: Math.round(140 * Math.min(Math.max(fontScale, 1), 2)) }} accessibilityLabel="Message to the coach" />
          </View>
          {running ? (
            <SendButton icon="stop.fill" label="Stop the coach" enabled onPress={() => {
                services.coach.stop(live.turnId);
              }}
            />
          ) : (
            <SendButton icon="arrow.up" label="Send message" enabled={canSend} onPress={() => void send({ kind: 'words', text: text.trim(), spoken: false })} />
          )}
        </View>
        {route !== null && keyboardUp ? (
          <AppText variant="label" color="text.secondary" numberOfLines={1}>
            {route.text}
          </AppText>
        ) : route !== null ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space['1'] }}>
            <AppText variant="label" color="text.secondary">
              {`${route.text} ·`}
            </AppText>
            <TextButton label={route.link.label} tone="secondary" onPress={() => { statusAction(route.link.action); }} />
          </View>
        ) : null}
      </View>
      <KeyboardDoneAccessory nativeID={COACH_DONE_ACCESSORY_ID} />
    </SheetKeyboardAvoidingView>
  );
}

function Row({
  row,
  undoBlocked,
  onUndo,
  onProposal,
  onGymChange,
  onMemory,
  onNewExercise,
  onRetry,
  onAccept,
  onDraft,
  onQuestion,
  stamped = true,
}: {
  row: ThreadRow;
  /** This row shows its time (once per run of the same minute). */
  stamped?: boolean;
  undoBlocked: (actionId: string) => boolean;
  onUndo: (actionId: string) => void;
  onProposal: (proposalId: string, tap: 'apply' | 'not_now') => void;
  onGymChange: (proposalId: string, tap: 'apply' | 'not_now') => void;
  onMemory: (memoryId: string, version: number, decision: 'save' | 'not_now' | 'playbook') => void;
  onNewExercise: (actionId: string, tap: 'add' | 'edit') => void;
  onRetry: () => void;
  /** `Adjust` on the coach's offer (CA1). */
  onAccept: () => void;
  /** A coach draft's card (workout-builder §4.2): `Open ›` closes the sheet and opens its overview; the sheet never opens it by itself. */
  onDraft?: { gymId: string | null; open: (draftId: string) => void; openRoutine: (routineId: string) => void; changed: () => void; /** ADR 0039: Set up filled from Ben's words. */ openSetup: () => void };
  /** (v2, §4.2) The coach's question card: tap answers, `Skip`, and Undo on a saved main lift. */
  onQuestion?: { disabled: boolean; disabledReason: string | null; saved: (actionId: string) => { text: string; canUndo: boolean } | null; answer: (q: QuestionCardView, a: { label: string; catalogueId: string | null } | 'skip') => void; undoSave: (q: QuestionCardView) => void };
}) {
  const theme = useTheme();
  switch (row.kind) {
    case 'ben':
      return (
        <View style={{ alignSelf: 'flex-end', maxWidth: '80%', gap: theme.space['1'] }}>
          <View style={{ backgroundColor: theme.colors['bg.raised'], borderRadius: theme.radius.md, padding: theme.space['3'] }}>
            <AppText variant="body">{row.text}</AppText>
          </View>
          {stamped ? (
            <AppText variant="label" color="text.secondary" numeric align="right">
              {formatTime(toMs(row.atUtc), row.tz)}
            </AppText>
          ) : null}
        </View>
      );
    case 'coach':
      return (
        <View style={{ gap: theme.space['1'] }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space['2'] }}>
            <AppText variant="label" color="text.secondary" style={{ flex: 1 }}>
              Coach
            </AppText>
            {stamped ? (
              <AppText variant="label" color="text.secondary" numeric>
                {formatTime(toMs(row.atUtc), row.tz)}
              </AppText>
            ) : null}
          </View>
          <AppText variant="body">{replyText(row.sentences)}</AppText>
        </View>
      );
    case 'tools':
      return <ToolsLine lines={row.lines} />;
    case 'card':
      if (row.card.question !== undefined && onQuestion !== undefined) {
        const q = row.card.question;
        return (
          <BuildQuestionCard
            view={q}
            disabled={onQuestion.disabled}
            disabledReason={onQuestion.disabledReason}
            saved={onQuestion.saved(q.actionId)}
            onAnswer={(a) => {
              onQuestion.answer(q, a);
            }}
            onSkip={() => {
              onQuestion.answer(q, 'skip');
            }}
            onUndoSave={() => {
              onQuestion.undoSave(q);
            }}
          />
        );
      }
      if (row.card.week !== undefined && onDraft !== undefined) return <WeekProposalCard record={row.card.week} onChanged={onDraft.changed} />;
      if (row.card.draftEdit !== undefined && onDraft !== undefined) return <DraftEditCard record={row.card.draftEdit} onChanged={onDraft.changed} />;
      if (row.card.setupFill !== undefined && onDraft !== undefined) return <SetupFillCard record={row.card.setupFill} onOpen={onDraft.openSetup} />;
      if (row.card.activityOffer !== undefined && onDraft !== undefined) return <ActivityOfferCard record={row.card.activityOffer} onChanged={onDraft.changed} />;
      if (row.card.plan !== undefined && onDraft !== undefined) return <PlanCard record={row.card.plan} onOpenRoutine={onDraft.openRoutine} onChanged={onDraft.changed} />;
      if (row.card.draft !== undefined && onDraft !== undefined) return <WorkoutDraftCard record={row.card.draft} gymId={onDraft.gymId} onOpen={onDraft.open} onOpenRoutine={onDraft.openRoutine} onChanged={onDraft.changed} />;
      return <CoachCard card={row.card.canUndo && undoBlocked(row.card.actionId) ? { ...row.card, canUndo: false } : row.card} onUndo={onUndo} onProposal={onProposal} onGymChange={onGymChange} onMemory={onMemory} onNewExercise={onNewExercise} />;
    case 'note':
      return (
        <View style={{ flexDirection: 'row', gap: theme.space['2'], alignItems: 'center' }}>
          <Icon name="info.circle" size={16} />
          <AppText variant="callout" color="text.secondary">
            {row.text}
          </AppText>
        </View>
      );
    case 'offer':
      return (
        <View style={{ flexDirection: 'row' }}>
          <SecondaryButton label={offerLabel(row.input.offer)} onPress={onAccept} />
        </View>
      );
    case 'outcome':
      return <OutcomeRow text={row.text} icon={row.icon} retry={row.retry} why={row.why} onRetry={onRetry} />;
  }
}

/** A turn that didn't finish: its line, `Try again`, and the recorded reason behind `Why?` (F12). */
function OutcomeRow({ text, icon, retry, why, onRetry }: { text: string; icon: ViewIcon; retry: boolean; why: string | null; onRetry: () => void }) {
  const theme = useTheme();
  const [open, setOpen] = useState(false);
  return (
    <View style={{ gap: theme.space['1'] }}>
      {/* 21 Oct: the line wraps, and Why? / Try again move to the next line when there's no room (large text). */}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', columnGap: theme.space['2'], alignItems: 'center' }}>
        <Icon name={icon} size={16} />
        <AppText variant="callout" color="text.secondary" style={{ flexGrow: 1, flexShrink: 1, flexBasis: 160 }}>
          {text}
        </AppText>
        {why !== null ? (
          <TextButton
            label="Why?"
            tone="secondary"
            accessibilityLabel={open ? 'Hide why' : 'Why the coach didn’t answer'}
            onPress={() => {
              setOpen((o) => !o);
            }}
          />
        ) : null}
        {retry ? <TextButton label="Try again" onPress={onRetry} /> : null}
      </View>
      {open && why !== null ? (
        <AppText variant="callout" color="text.secondary">
          {why}
        </AppText>
      ) : null}
    </View>
  );
}

function LiveRows({ live, now }: { live: LiveTurn; now: number }) {
  const theme = useTheme();
  const thinking = thinkingLabel(live, now);
  return (
    <View style={{ gap: theme.space['3'] }}>
      {live.benText !== null ? (
        <View style={{ alignSelf: 'flex-end', maxWidth: '80%', backgroundColor: theme.colors['bg.raised'], borderRadius: theme.radius.md, padding: theme.space['3'] }}>
          <AppText variant="body">{live.benText}</AppText>
        </View>
      ) : null}
      {live.tools.length > 0 ? <ToolsLine lines={live.tools} /> : null}
      {live.cards.map((c) => (
        <CoachCard key={c.actionId} card={{ ...c, canUndo: false }} onUndo={() => undefined} />
      ))}
      {thinking !== null ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space['2'] }}>
          <Icon name="ellipsis" size={16} />
          <AppText variant="label" color="text.secondary" numeric>
            {thinking}
          </AppText>
        </View>
      ) : (
        <AppText variant="body">{replyText(live.sentences)}</AppText>
      )}
    </View>
  );
}

/** The tools a turn used (design pass nit): a quiet `ⓘ Tools` link; tap shows them, as written. */
function ToolsLine({ lines }: { lines: readonly string[] }) {
  const theme = useTheme();
  const [open, setOpen] = useState(false);
  return (
    <View style={{ gap: theme.space['1'] }}>
      <View style={{ alignSelf: 'flex-start' }}>
        <TextButton
          label="Tools"
          icon="info.circle"
          tone="secondary"
          accessibilityLabel={open ? 'Hide the tools the coach used' : 'Tools the coach used'}
          onPress={() => {
            setOpen((o) => !o);
          }}
        />
      </View>
      {open ? (
        <AppText variant="callout" color="text.secondary">
          {lines.join(', ')}
        </AppText>
      ) : null}
    </View>
  );
}

/** Design pass 4.3: scrolls inside a cap (35% of the window), so the composer stays on screen at AX. */
function SeesPanel({ sees, maxHeight }: { sees: ContextDescription; maxHeight: number }) {
  const theme = useTheme();
  return (
    <ScrollView style={{ maxHeight, backgroundColor: theme.colors['bg.surface'], borderRadius: theme.radius.md }} contentContainerStyle={{ gap: theme.space['2'], padding: theme.space['3'] }}>
      <AppText variant="headline">What the coach can see</AppText>
      <DomainLabel domain="yourData" />
      {sees.yourData.map((d) => (
        <AppText key={`y:${d.label}`} variant="callout">{`✓ ${d.label}: ${d.detail}`}</AppText>
      ))}
      <DomainLabel domain="coachingKnowledge" />
      {sees.coachingKnowledge.map((d) => (
        <AppText key={`k:${d.label}`} variant="callout">{`✓ ${d.label}: ${d.detail}`}</AppText>
      ))}
      <AppText variant="label" color="text.tertiary">
        Not available
      </AppText>
      {sees.notAvailable.map((n) => (
        <AppText key={n} variant="callout" color="text.secondary">{`– ${n}`}</AppText>
      ))}
    </ScrollView>
  );
}
