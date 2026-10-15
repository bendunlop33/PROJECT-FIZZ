import { useFocusEffect, useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Keyboard, KeyboardAvoidingView, Linking, Pressable, ScrollView, View, type TextInput } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { undoOpId, type ContextDescription } from '@fizz/coach';
import { coachUndoRefusal, localDateOf, toIso, toMs } from '@fizz/domain';
import type { BenInput, BuildFocus, CoachThread } from '@fizz/schemas';

import { MANAGE_USAGE_URL } from '../../ai/coach-connection-view';
import { nowMs as clockNow } from '../../clock';
import { isGeneralEntry, type CoachAvailability, type CoachEntry } from '../../coach/coach-service';
import {
  applyProgress,
  COACH_DONE_ACCESSORY_ID,
  COACH_TRANSCRIPT_KEYBOARD,
  loadedOutOfContext,
  missingOutOfContext,
  routeLine,
  seesLabel,
  starterChips,
  type WorkoutChipContext,
  startLiveTurn,
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
} from '../../coach/sheet-view';
import { newUuid } from '../../device/runtime';
import { formatTime } from '../../format/dates';
import type { RootStackParams } from '../../navigation/types';
import { useDataChanged, useServices } from '../../shell/context';
import { TIMING, useTheme } from '../../theme';
import { AppText, Chip, DomainLabel, Icon, KeyboardDoneAccessory, TextButton, TextField } from '../../ui';
import { CoachCard } from './CoachCard';
import { BuildQuestionCard, BuildRequestCard, PendingBuildCard, QUESTION_COPY, WorkoutDraftCard } from './BuildCards';
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
  e.kind === 'today' ? 'today' : e.kind === 'progress' ? `progress:${e.period}` : e.kind === 'progress_exercise' ? `exercise:${e.exerciseName}:${e.seriesLabel}` : e.kind === 'draft' ? `draft:${e.draftId}` : `${e.kind}:${e.sessionId}`;

export function CoachSheetScreen() {
  const theme = useTheme();
  const services = useServices();
  const changed = useDataChanged();
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const { entry, focus = false, build: buildParam } = useRoute<RouteProp<RootStackParams, 'Coach'>>().params;
  const key = entryKey(entry);

  const [availability, setAvailability] = useState<CoachAvailability | null>(null);
  const [threadId, setThreadId] = useState<string | null | undefined>(undefined);
  const [title, setTitle] = useState<string>('Coach');
  const [rows, setRows] = useState<ThreadRow[]>([]);
  const [live, setLive] = useState<LiveTurn | null>(null);
  const [text, setText] = useState(drafts.get(key) ?? '');
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
      setRows(threadRows({ ...data, nowUtc: toIso(clockNow()) }));
      setTitle(data.thread.title);
    },
    [services],
  );

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
    if (t === '') drafts.delete(key);
    else drafts.set(key, t);
  };

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
    try {
      const r = await services.coach.send({
        entry,
        threadId: threadId ?? null,
        input,
        turnId,
        onProgress: (p) => {
          setLive((l) => (l === null || l.turnId !== turnId ? l : applyProgress(l, p)));
        },
      });
      setThreadId(r.threadId);
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
      setLive(null);
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
        onProgress: (p) => {
          setLive((l) => (l === null || l.turnId !== turnId ? l : applyProgress(l, p)));
        },
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
      setLive(null);
      setAvailability(await services.coach.availability());
    }
  }

  /** `Open ›` (§4.2): close the sheet, then present the draft's overview. */
  function openDraft(draftId: string) {
    navigation.goBack();
    navigation.navigate('WorkoutOverview', { target: { kind: 'coach_draft', draftId } });
  }

  function openRoutine(routineId: string) {
    navigation.goBack();
    navigation.navigate('WorkoutOverview', { target: { kind: 'routine', routineId } });
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
      setLive(null);
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

  const status = availability === null ? null : statusView(availability);
  const route = availability === null ? null : routeLine(availability);
  const chips: StarterChip[] = availability === null ? [] : starterChips(entry, availability, workout?.active === true, workout?.chips ?? null);
  const empty = rows.length === 0 && live === null;
  const running = live !== null;
  const canSend = status?.canSend === true && text.trim() !== '' && !running;

  const header = (
    <View style={{ flexDirection: 'row', alignItems: 'center', minHeight: 44, paddingHorizontal: theme.space['2'] }}>
      <HeaderButton
        icon="list.bullet"
        label="Conversations"
        onPress={() => {
          void services.coach.listThreads().then(setThreads);
        }}
      />
      <AppText variant="headline" numberOfLines={1} style={{ flex: 1, textAlign: 'center' }}>
        {title}
      </AppText>
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
    return (
      <View style={{ flex: 1, backgroundColor: theme.colors['bg.canvas'], paddingTop: theme.space['2'] }}>
        {header}
        <ScrollView contentContainerStyle={{ padding: theme.components.screenMargin, gap: theme.space['2'] }}>
          <TextButton label="Back" tone="secondary" onPress={() => { setThreads(null); }} />
          {threads.map((t) => (
            <Pressable
              key={t.id}
              accessibilityRole="button"
              onPress={() => {
                setThreads(null);
                setThreadId(t.id);
              }}
              style={{ minHeight: 64, justifyContent: 'center', borderBottomWidth: 1, borderBottomColor: theme.colors['border.divider'] }}
            >
              <AppText variant="body" numberOfLines={1}>
                {t.title}
              </AppText>
              <AppText variant="label" color="text.secondary">
                {formatTime(toMs(t.updatedAtUtc), services.now().tz)}
              </AppText>
            </Pressable>
          ))}
        </ScrollView>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView behavior="padding" style={{ flex: 1, backgroundColor: theme.colors['bg.canvas'], paddingTop: theme.space['2'] }}>
      {header}
      {workout?.active === true ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Back to workout. ${workout.bar}`}
          onPress={() => { navigation.goBack(); }}
          style={{ marginHorizontal: theme.components.screenMargin, minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: theme.space['2'], paddingHorizontal: theme.space['3'], backgroundColor: theme.colors['bg.surface'], borderRadius: theme.radius.md }}
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
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space['2'] }}>
            <Icon name={status.icon} size={18} color="status.warning" />
            <AppText variant="callout" style={{ flex: 1 }}>
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
        onContentSizeChange={() => scroll.current?.scrollToEnd({ animated: false })}
        // The keyboard showing or hiding resizes the transcript (KeyboardAvoidingView): keep the newest reply in view.
        onLayout={() => scroll.current?.scrollToEnd({ animated: false })}
        contentContainerStyle={{ padding: theme.components.screenMargin, flexGrow: 1 }}
        {...COACH_TRANSCRIPT_KEYBOARD}
      >
        {/* A tap on the conversation (not on a button in it) hides the keyboard. */}
        <Pressable accessible={false} onPress={() => { Keyboard.dismiss(); }} style={{ flexGrow: 1, gap: theme.space['4'] }}>
        {empty && chips.length > 0 && !showBuild ? (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.space['2'] }}>
            {chips.map((c) => (
              <Chip
                key={c.label}
                label={'build' in c && !c.build.enabled ? `${c.label} · ${BUILD_COPY.needsCoach}` : c.label}
                selected={false}
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
          <Row
            key={r.key}
            row={r}
            undoBlocked={undoBlocked}
            onUndo={(id) => void undo(id)}
            onProposal={(id, tap) => void tapProposal(id, tap)}
            onMemory={(id, v, d) => void decideMemory(id, v, d)}
            onRetry={() => r.kind === 'outcome' && r.input !== null && void retry(r.input)}
            onAccept={() => r.kind === 'offer' && live === null && void send(r.input)}
            onDraft={{ gymId: buildGym?.id ?? null, open: openDraft, openRoutine: openRoutine, changed: () => { changed(); void loadRows(threadId ?? null); } }}
            onQuestion={{
              disabled: live !== null || status?.canSend !== true,
              saved: (actionId) => savedAnswer(actionId),
              answer: (q, a) => void answerQuestion(q, a),
              undoSave: (q) => void undoAnswerSave(q),
            }}
          />
        ))}
        {live !== null ? <LiveRows live={live} now={now} /> : null}
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

      <View style={{ paddingHorizontal: theme.components.screenMargin, paddingBottom: insets.bottom + theme.space['2'], gap: theme.space['2'] }}>
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
        {sees !== null ? <SeesPanel sees={sees} /> : null}
        <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: theme.space['2'] }}>
          <View style={{ flex: 1 }}>
            <TextField ref={field} value={text} onChangeText={setDraft} placeholder={status?.placeholder ?? 'Ask the coach…'} multiline inputAccessoryViewID={COACH_DONE_ACCESSORY_ID} style={{ maxHeight: 140 }} accessibilityLabel="Message to the coach" />
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
        {route !== null ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space['1'] }}>
            <AppText variant="label" color="text.secondary">
              {`${route.text} ·`}
            </AppText>
            <TextButton label={route.link.label} tone="secondary" onPress={() => { statusAction(route.link.action); }} />
          </View>
        ) : null}
      </View>
      <KeyboardDoneAccessory nativeID={COACH_DONE_ACCESSORY_ID} />
    </KeyboardAvoidingView>
  );
}

function HeaderButton({ icon, label, onPress }: { icon: 'list.bullet' | 'square.and.pencil' | 'xmark'; label: string; onPress: () => void }) {
  const theme = useTheme();
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={{ width: theme.target.min.width, height: theme.target.min.height, alignItems: 'center', justifyContent: 'center' }}>
      <Icon name={icon} color="text.primary" size={20} />
    </Pressable>
  );
}

function SendButton({ icon, label, enabled, onPress }: { icon: 'arrow.up' | 'stop.fill'; label: string; enabled: boolean; onPress: () => void }) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !enabled }}
      disabled={!enabled}
      onPress={onPress}
      style={{ width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center', backgroundColor: enabled ? theme.colors.accent : theme.colors['bg.raised'] }}
    >
      <Icon name={icon} color={enabled ? 'on.accent' : 'text.secondary'} size={20} />
    </Pressable>
  );
}

function Row({
  row,
  undoBlocked,
  onUndo,
  onProposal,
  onMemory,
  onRetry,
  onAccept,
  onDraft,
  onQuestion,
}: {
  row: ThreadRow;
  undoBlocked: (actionId: string) => boolean;
  onUndo: (actionId: string) => void;
  onProposal: (proposalId: string, tap: 'apply' | 'not_now') => void;
  onMemory: (memoryId: string, version: number, decision: 'save' | 'not_now' | 'playbook') => void;
  onRetry: () => void;
  /** `Adjust` on the coach's offer (CA1). */
  onAccept: () => void;
  /** A coach draft's card (workout-builder §4.2): `Open ›` closes the sheet and opens its overview; the sheet never opens it by itself. */
  onDraft?: { gymId: string | null; open: (draftId: string) => void; openRoutine: (routineId: string) => void; changed: () => void };
  /** (v2, §4.2) The coach's question card: tap answers, `Skip`, and Undo on a saved main lift. */
  onQuestion?: { disabled: boolean; saved: (actionId: string) => { text: string; canUndo: boolean } | null; answer: (q: QuestionCardView, a: { label: string; catalogueId: string | null } | 'skip') => void; undoSave: (q: QuestionCardView) => void };
}) {
  const theme = useTheme();
  switch (row.kind) {
    case 'ben':
      return (
        <View style={{ alignSelf: 'flex-end', maxWidth: '80%', gap: theme.space['1'] }}>
          <View style={{ backgroundColor: theme.colors['bg.raised'], borderRadius: theme.radius.md, padding: theme.space['3'] }}>
            <AppText variant="body">{row.text}</AppText>
          </View>
          <AppText variant="label" color="text.secondary" align="center">
            {formatTime(toMs(row.atUtc), row.tz)}
          </AppText>
        </View>
      );
    case 'coach':
      return (
        <View style={{ gap: theme.space['1'] }}>
          <AppText variant="label" color="text.secondary">{`Coach · ${formatTime(toMs(row.atUtc), row.tz)}`}</AppText>
          <AppText variant="body">{row.sentences.join(' ')}</AppText>
        </View>
      );
    case 'tools':
      return (
        <AppText variant="callout" color="text.secondary">
          {`Used: ${row.lines.join(', ').toLowerCase()}`}
        </AppText>
      );
    case 'card':
      if (row.card.question !== undefined && onQuestion !== undefined) {
        const q = row.card.question;
        return (
          <BuildQuestionCard
            view={q}
            disabled={onQuestion.disabled}
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
      if (row.card.draft !== undefined && onDraft !== undefined) return <WorkoutDraftCard record={row.card.draft} gymId={onDraft.gymId} onOpen={onDraft.open} onOpenRoutine={onDraft.openRoutine} onChanged={onDraft.changed} />;
      return <CoachCard card={row.card.canUndo && undoBlocked(row.card.actionId) ? { ...row.card, canUndo: false } : row.card} onUndo={onUndo} onProposal={onProposal} onMemory={onMemory} />;
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
          <TextButton label="Adjust" onPress={onAccept} />
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
      <View style={{ flexDirection: 'row', gap: theme.space['2'], alignItems: 'center' }}>
        <Icon name={icon} size={16} />
        <AppText variant="callout" color="text.secondary" style={{ flex: 1 }}>
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
      {live.tools.length > 0 ? (
        <AppText variant="callout" color="text.secondary">
          {`Used: ${live.tools.join(', ').toLowerCase()}`}
        </AppText>
      ) : null}
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
        <AppText variant="body">{live.sentences.join(' ')}</AppText>
      )}
    </View>
  );
}

function SeesPanel({ sees }: { sees: ContextDescription }) {
  const theme = useTheme();
  return (
    <View style={{ gap: theme.space['2'], padding: theme.space['3'], backgroundColor: theme.colors['bg.surface'], borderRadius: theme.radius.md }}>
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
    </View>
  );
}
