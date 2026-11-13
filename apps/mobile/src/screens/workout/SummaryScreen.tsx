import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ActionSheetIOS, Alert, Modal, Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { checkRoutineName, startMoveWrite, summaryTimeBounds, summaryTimeline, timingUndoCommand, toIso, toMs, type StartMove, type WorkoutSummary } from '@fizz/domain';
import type { SessionAggregate } from '@fizz/schemas';
import { nextTargetTapOpId } from '@fizz/coach';
import { readTextCoachState } from '@fizz/providers';

import { coachConnectionPorts } from '../../ai/coach-connection-ports';
import { summaryCoachView } from '../../ai/coach-connection-view';
import { NEXT_LINE_COPY, nextTimeView, type NextTimeRowView, type NextTimeTap } from '../../coach/next-time-view';
import { FeelRow } from '../../reviews/FeelRow';
import { nowMs as clockNow } from '../../clock';
import { haptic } from '../../device/haptics';
import { newUuid } from '../../device/runtime';
import { formatCalendarDate, formatDayMonth, formatShortDate, formatTime } from '../../format/dates';
import { popToTabs, popToToday } from '../../navigation/actions';
import type { RootStackParams } from '../../navigation/types';
import type { WorkoutPresence } from '../../services/history-services';
import { firstTime, useDataChanged, useScreenData, useServices } from '../../shell/context';
import { finishMotion, listEnterMotion, shouldPlayFinish, TIMING, useTheme } from '../../theme';
import { AppText, BottomBar, Card, DelayedFade, FadeIn, RevealOnce, ChecklistRow, HeroHeader, Icon, LinkLine, PrimaryButton, SecondaryButton, SectionHeader, StatStrip, StatusLine, type StatItem, TextButton, TEXT_PRESSED_OPACITY, Toast } from '../../ui';
import { useAx } from '../../progress/components';
import { newBestLastLine, summaryDoneRows, summaryMenu, summarySavedLine, summaryShownRows, summaryStatItems, type SummaryMenuId } from '../../workout/summary-view';
import { createAfterDismiss } from '../../workout/after-dismiss';
import { NameSheet } from '../routines/NameSheet';
import { useSaveToWorkouts } from '../routines/SaveWorkoutSheet';
import { LIBRARY_COPY_UI } from '../../workout/library-view';
import { planChangeText, planChangeUndoOpId, type KeepMainLiftView, type KeepNextTimeView } from '../../builder/builder-service';
import { DELETE_COPY, deletedToastText, restoredToastText, summaryCanDelete } from '../../history/delete-view';
import { handOffDeleteToast } from '../../history/toast-handoff';
import { DeletedWorkoutView } from './DeletedWorkoutView';
import { WorkoutTimesRows, type WorkoutTimes } from './WorkoutTimesRows';
import { LinkedActivityRow } from './LinkedActivityRow';
import { PlanDayAskRow } from './PlanDayAskRow';
import { HEALTH_COPY } from '../../health/health-view';
import { painClearConfirm, painClearedToast } from '../../workout/pain-clear';

/**
 * Workout summary (workout-summary.md). Shown only after `finishWorkout`
 * committed. Facts first; `Next time` from the built-in rule, tagged with
 * its source; the check-in exactly as Ben gave it; the on-phone backup line.
 * The coach has no summary turn in this build (ADR 0020 C8): the tag and the
 * note follow the real connection state and never claim a coach review.
 */
export function SummaryScreen() {
  const theme = useTheme();
  const changed = useDataChanged();
  const services = useServices();
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const ax = useAx();
  const { sessionId, back = false, justFinished: finishedNow = false, editTimes = false } = useRoute<RouteProp<RootStackParams, 'Summary'>>().params;
  // (Ben, 27 Oct) `⋯ › Link activity from Health`: how many Health workouts could be linked, and the pick list.
  const [healthChoices, setHealthChoices] = useState(0);
  const [healthPicker, setHealthPicker] = useState(false);
  // Opened from Progress `Edit times`: the time correction shows at once, and closing it returns there (progress.md §2.3).
  const [times, setTimes] = useState(editTimes);
  const [choosePain, setChoosePain] = useState(false);
  const [toast, setToast] = useState<{ text: string; action?: string; onAction?: () => void } | null>(null);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => {
      setToast(null);
    }, TIMING.undoToast);
    return () => {
      clearTimeout(t);
    };
  }, [toast]);
  // True while this Summary's own review runs (shows `Reviewing…` on Next time).
  const reviewing = useRef(false);
  // `Keep for next time?`: one tap at a time (Apply then Skip can't race).
  const [keepBusy, setKeepBusy] = useState(false);
  // (Ben, 27 Oct; redesign §E2) `Exercises · done` shows 3, then `N more`.
  const [showAll, setShowAll] = useState(false);
  const [data, reload] = useScreenData(async (s) => {
    // Keychain + settings file only, no network; a read failure counts as not connected.
    const coach = summaryCoachView(await readTextCoachState(coachConnectionPorts().ports).catch(() => null));
    const [summary, backup, painFlags, routines, planVsDone] = await Promise.all([s.workout.summary(sessionId, coach.coach), s.backups.getStatus(), s.pain.active(), s.routines.list().catch(() => []), s.workout.planVsDone(sessionId).catch(() => null)]);
    // `Save to Workouts` (routines.md §A2.6): once saved from here, the link reads `Saved · Legs ›`.
    const savedAs = routines.find((r) => r.createdFromSessionId === sessionId) ?? null;
    // D21: the coach's saved targets over the built-in rule's, and the summary turn's checked reply as the note.
    const [coachRows, stale, availability, turnNote, ruleRows] = await Promise.all([s.coach.nextTargets(sessionId).catch(() => []), s.coach.staleNextTargets(sessionId).catch(() => new Set<string>()), s.coach.availability(), s.coach.summaryNote(sessionId).catch(() => null), s.coach.ruleResets(sessionId).catch(() => [])]);
    const nextTime = summary === null ? null : nextTimeView({ title: summary.title, builtIn: summary.nextTime, from: summary.nextFrom, coachRows, ruleRows, stale, availability, reviewing: s.coach.summaryRunning(sessionId) !== null && reviewing.current });
    // A deleted (or purged) workout opens read-only with Restore (delete-workouts §3.2).
    // A presence read that fails offers no delete rather than one that would be refused (review r2 N2).
    const presence = await s.history.presence(sessionId).catch((): WorkoutPresence => ({ kind: 'hidden' }));
    // (workout-builder-v3 §2.8) The plan change this Start made (`Chest · bench updated · Undo`), stored with the session.
    const planChange = await s.builder.planChangeOf(sessionId).catch(() => null);
    // (Ben, 23 Oct, D1) `Keep for next time?`: only when the structure differs from the plan day or saved workout.
    const keep = await s.builder.keepNextTimeOf(sessionId).catch(() => null);
    // (Ben, 23 Oct) A main lift Ben swapped on Your workout: its own row, `Make <lift> the main lift for <day>?`.
    const mainLift = await s.builder.keepMainLiftOf(sessionId).catch(() => null);
    // Progress v3 (Ben, 21 Oct): new PBs at the tracked reps, the Lifts chart's definition. Local only.
    const newBests = await s.reviews.sessionBests(sessionId).catch(() => []);
    return { summary, backup, painFlags, savedAs, coachNote: turnNote ?? coach.note, nextTime, presence, planVsDone, planChange, keep, mainLift, newBests };
  });
  // The one coach review after Finish (D21). It runs in the service, so leaving the Summary doesn't stop it;
  // its small changes are saved when it answers, until a workout starts from this one (CA10).
  useEffect(() => {
    if (!finishedNow) return;
    const run = services.coach.runSummaryTurn(sessionId);
    reviewing.current = true;
    reload();
    void run.finally(() => {
      reviewing.current = false;
      reload();
      changed();
    });
  }, [finishedNow, services, sessionId, reload, changed]);

  // The name sheets (premium-feel §2.6): one opId per sheet opening, so a double tap saves once.
  const [nameSheet, setNameSheet] = useState<'workout' | null>(null);
  const [nameVisible, setNameVisible] = useState(false);
  const nameOp = useRef(newUuid());
  const [nameAfter] = useState(() => createAfterDismiss());
  /** One op ID per Delete intent on this screen (a retry after a failure reuses it). */
  const deleteOp = useRef(newUuid());
  const openName = (kind: 'workout') => {
    nameOp.current = newUuid();
    setNameSheet(kind);
    setNameVisible(true);
  };

  // `Save to Workouts` (WL6): any finished workout, one sheet; Undo deletes the new workout.
  const saveSheet = useSaveToWorkouts(
    (made) => {
      changed();
      reload();
      setToast({
        text: LIBRARY_COPY_UI.savedToWorkouts,
        action: LIBRARY_COPY_UI.undo,
        onAction: () => {
          setToast(null);
          void services.routines.remove({ routineId: made.id, expectedVersion: made.version, opId: newUuid() }).then((u) => {
            if (!u.ok) setToast({ text: u.message });
            changed();
            reload();
          });
        },
      });
    },
    () => {
      setToast({ text: LIBRARY_COPY_UI.nothingToSave });
    },
  );

  const done = () => {
    if (back && navigation.canGoBack()) navigation.goBack();
    else navigation.dispatch(popToToday());
  };

  // The finish moment (premium-feel §6): one `haptic.finish` when a just-finished workout's summary
  // first shows, after the commit. Only when Finish itself opened it (review B2): a later visit from Today
  // or Progress is static. Never for a discard (no summary).
  const endedUtc = data.state === 'ready' ? (data.value.summary?.endedAtUtc ?? null) : null;
  const [justFinished] = useState(() => finishedNow);
  const [playedFinish] = useState(() => new Set<string>());
  useEffect(() => {
    if (endedUtc === null) return;
    const fresh = justFinished && clockNow() - toMs(endedUtc) < 5 * 60_000;
    if (shouldPlayFinish({ sessionStatus: 'finished', justFinished: fresh, played: playedFinish, sessionId }) && firstTime(`summary-success:${sessionId}`)) {
      playedFinish.add(sessionId);
      haptic('finish');
    }
  }, [endedUtc, sessionId, justFinished, playedFinish]);
  // The check draws and the title fades only for the moment itself; a later visit is static.
  const finish = finishMotion(theme.a11y.reduceMotion || !justFinished);
  /** Facts and rows follow the title (`motion.listEnter`), only in the finish moment itself. */
  const follow = (i: number) => {
    const m = finish.strokeMs > 0 ? listEnterMotion(i, theme.a11y.reduceMotion) : null;
    return m === null ? null : { ...m, delayMs: m.delayMs + finish.titleDelayMs + finish.titleFadeMs };
  };

  if (data.state === 'loading') return <View style={{ flex: 1, backgroundColor: theme.colors['bg.canvas'] }} />;
  if (data.state === 'ready' && (data.value.presence.kind === 'deleted' || data.value.presence.kind === 'gone')) {
    const p = data.value.presence;
    return <DeletedWorkoutView summary={p.kind === 'deleted' ? data.value.summary : null} goneOn={p.kind === 'deleted' ? p.goneOn : null} version={p.kind === 'deleted' ? p.version : null} onDone={done} />;
  }
  if (data.state === 'error' || data.value.summary === null) {
    // Never a blank full-screen modal (review S2): say so, offer a retry and a way out.
    return (
      <View style={{ flex: 1, backgroundColor: theme.colors['bg.canvas'], paddingTop: insets.top + theme.space['4'], paddingHorizontal: theme.components.screenMargin, gap: theme.space['4'] }}>
        <StatusLine
          icon="exclamationmark.triangle"
          tone="warning"
          text={data.state === 'error' ? 'Couldn’t show this summary.' : 'This workout wasn’t found.'}
          detail={data.state === 'error' ? `Your workout is saved. ${data.message}` : null}
        />
        {data.state === 'error' ? <SecondaryButton label="Try again" onPress={reload} /> : null}
        <TextButton label="Done" onPress={done} />
      </View>
    );
  }
  const { summary: sum, backup, painFlags, savedAs, coachNote, nextTime, presence } = data.value;
  const canDelete = summaryCanDelete(presence);

  const openSave = () => void saveSheet.open({ kind: 'session', sessionId }, sum.storedName ?? null);
  /**
   * (Ben, 27 Oct; redesign §E2) `⋯`: Edit times, Save as workout (until saved), Rename, Link activity from Health,
   * Delete workout (delete-workouts §2.2; the tap is the confirmation, Undo comes as a toast where Ben lands).
   */
  const menuRun: Record<SummaryMenuId, () => void> = {
    edit_times: () => {
      setTimes(true);
    },
    save: openSave,
    rename: () => {
      openName('workout');
    },
    link_health: () => {
      setHealthPicker(true);
    },
    delete: () => void deleteThis(),
  };
  const moreItems = summaryMenu({ dateOnly: sum.dateOnly !== null, saved: savedAs !== null, canDelete, healthChoices, linkLabel: HEALTH_COPY.linkFromHealth }).map((m) => ({ ...m, run: menuRun[m.id] }));
  function openMenu() {
    const options = [...moreItems.map((m) => m.label), DELETE_COPY.cancel];
    const destructive = moreItems.findIndex((m) => m.destructive === true);
    ActionSheetIOS.showActionSheetWithOptions({ options, ...(destructive >= 0 ? { destructiveButtonIndex: destructive } : {}), cancelButtonIndex: moreItems.length }, (i) => {
      moreItems[i]?.run();
    });
  }
  async function deleteThis() {
    const r = await services.history.deleteWorkouts([{ sessionId, expectedVersion: sum.sessionVersion }], deleteOp.current, { from: 'opened' });
    if (!r.ok) {
      if (r.kind === 'stale') deleteOp.current = newUuid();
      setToast({ text: r.message });
      reload();
      return;
    }
    const row = { title: sum.title, startedAtUtc: sum.startedAtUtc, tz: sum.tz, localDate: sum.dateOnly, source: sum.source, sessionId, version: sum.sessionVersion, gymName: sum.gymName ?? '', sets: sum.facts.workingSets };
    handOffDeleteToast({ text: deletedToastText([row], services.now().tz), undo: r.refs.map((x) => ({ sessionId: x.sessionId, expectedVersion: x.version })), restoredText: restoredToastText([row], services.now().tz) });
    changed();
    done();
  }

  async function tapNext(row: NextTimeRowView, tap: NextTimeTap) {
    // (Ben, 23 Oct) The built-in rule's own reset: Apply / Skip, then Undo. Offline too.
    const reset = row.reset;
    if (reset !== undefined) {
      const r = await services.coach.tapRuleReset(sessionId, reset, tap).catch(() => null);
      if (r === null) setToast({ text: tap === 'undo' ? 'Couldn’t undo.' : 'Couldn’t save.' });
      else if (r.status === 'not_possible') setToast({ text: r.reason === 'used' ? 'Already used.' : 'Changed since. Check it again.' });
      reload();
      changed();
      return;
    }
    if (row.row === null) return;
    // One opId per tap on this version of the row: a double tap replays instead of reading as `Changed since`.
    const r = await services.coach.tapNextTarget(row.row, tap, nextTargetTapOpId(row.row, tap)).catch(() => null);
    if (r === null) setToast({ text: tap === 'undo' ? 'Couldn’t undo.' : 'Couldn’t save.' });
    else if (r.status === 'not_possible') setToast({ text: r.reason === 'used' ? 'Already used.' : 'Changed since. Check it again.' });
    reload();
    changed();
  }
  async function renameWorkout(name: string): Promise<string | null> {
    const before = sum.storedName;
    const r = await services.workout.dispatch(sessionId, { type: 'rename_session', at: services.now(), opId: nameOp.current, name, expectedVersion: sum.sessionVersion });
    if (!r.ok) {
      if (r.error.code === 'stale_version') reload();
      return r.error.code === 'stale_version' ? 'The workout changed. Check it and try again.' : r.error.message;
    }
    const version = r.aggregate.session.version;
    nameAfter.arm(() => {
      setNameSheet(null);
      setToast({
        text: `Renamed to ${name}`,
        action: 'Undo',
        onAction: () => {
          setToast(null);
          void services.workout.dispatch(sessionId, { type: 'rename_session', at: services.now(), opId: newUuid(), name: before, expectedVersion: version }).then((u) => {
            if (!u.ok) setToast({ text: `Couldn’t undo: ${u.error.message}` });
            changed();
            reload();
          });
        },
      });
    });
    setNameVisible(false);
    changed();
    reload();
    return null;
  }

  /** `Keep for next time?` and the main-lift offer: one tap at a time (Apply then Skip can't race). */
  const keepTap = (run: () => Promise<{ ok: true } | { ok: false; message: string }>) => {
    if (keepBusy) return;
    setKeepBusy(true);
    void run()
      .catch(() => ({ ok: false as const, message: 'Couldn’t save. Try again.' }))
      .then((r) => {
        setKeepBusy(false);
        if (!r.ok) setToast({ text: r.message });
        changed();
        reload();
      });
  };

  const pvd = data.value.planVsDone;
  // (Ben, 27 Oct; redesign §E2) Time / Sets / Exercises.
  const statItems: StatItem[] = summaryStatItems(sum.facts, pvd);
  const doneRows = summaryShownRows(summaryDoneRows(sum.exercises, pvd?.rows ?? null), showAll);
  const flaggedHere = painFlags.filter((f) => sum.exercises.some((e) => e.exerciseId === f.exerciseId));
  const tz = sum.tz;
  const range = `${formatTime(toMs(sum.startedAtUtc), tz)}–${sum.endedAtUtc ? formatTime(toMs(sum.endedAtUtc), tz) : ''}`;
  const edited = sum.timingEdited.end ? ' (end time edited)' : sum.timingEdited.start ? ' (start time edited)' : '';
  const failed = backup.onPhone.state === 'failed';
  const savedLine = summarySavedLine(sum.endedAtUtc === null ? null : toMs(sum.endedAtUtc), (ms) => formatTime(ms, tz));
  const bests = data.value.newBests;
  const mainLift = data.value.mainLift;
  const keep = data.value.keep;
  const nextOpen = nextTime !== null || mainLift !== null || keep !== null;

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors['bg.canvas'] }}>
      <ScrollView contentContainerStyle={{ paddingTop: insets.top + theme.space['3'], paddingHorizontal: theme.components.screenMargin, paddingBottom: theme.space['8'], gap: theme.space['5'] }}>
        {/* (Ben, 27 Oct; redesign §E2) The Saved line and ⋯: the check draws once (premium-feel §6), then the title fades in. */}
        <View style={{ gap: theme.space['1'] }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space['2'] }}>
            <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: theme.space['1'] }} accessible accessibilityLabel={`${savedLine} on this phone`}>
              <RevealOnce durationMs={finish.strokeMs} size={14} background={theme.colors['bg.canvas']}>
                <Icon name="checkmark.circle.fill" color="status.done" size={14} />
              </RevealOnce>
              <AppText variant="callout" color="text.secondary" numeric>
                {savedLine}
              </AppText>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="More"
              accessibilityActions={moreItems.map((m) => ({ name: m.label, label: m.label }))}
              onAccessibilityAction={(e) => {
                moreItems.find((m) => m.label === e.nativeEvent.actionName)?.run();
              }}
              onPress={openMenu}
              style={({ pressed }) => ({ minWidth: theme.target.min.width, minHeight: theme.target.min.height, alignItems: 'center', justifyContent: 'center', opacity: pressed ? TEXT_PRESSED_OPACITY : 1 })}
            >
              <Icon name="ellipsis" color="text.secondary" size={20} />
            </Pressable>
          </View>
          {failed ? (
            <LinkLine
              accessibilityLabel="Backup didn’t save. Open Data and backup."
              onPress={() => {
                navigation.dispatch(popToTabs({ screen: 'Profile', params: { screen: 'DataBackup', initial: false } }));
              }}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space['1'] }}>
                <Icon name="exclamationmark.triangle" color="status.warning" size={16} />
                <AppText variant="callout">Backup didn’t save ›</AppText>
              </View>
            </LinkLine>
          ) : null}
          <DelayedFade delayMs={finish.titleDelayMs} durationMs={finish.titleFadeMs}>
            <View style={{ gap: theme.space['1'] }}>
              {/* A date-only (imported) workout shows its date and nothing else about time (rule 6). */}
              <HeroHeader
                title={sum.title}
                titleLines={2}
                lines={[(sum.dateOnly !== null ? [formatCalendarDate(sum.dateOnly), sum.gymName, 'date only'] : [formatShortDate(toMs(sum.startedAtUtc), tz), sum.gymName, `${range}${edited}`]).filter(Boolean).join(' · ')]}
              />
              {savedAs !== null ? (
                <LinkLine
                  accessibilityLabel={`Saved to Workouts as ${savedAs.name}. Opens it.`}
                  onPress={() => {
                    navigation.navigate('BuilderWorkout', { open: { kind: 'routine', routineId: savedAs.id }, back: 'Summary' });
                  }}
                >
                  <AppText variant="callout" color="text.secondary">
                    {LIBRARY_COPY_UI.savedLink(savedAs.name)}
                  </AppText>
                </LinkLine>
              ) : null}
            </View>
          </DelayedFade>
        </View>

        {data.value.planChange !== null ? (
          <StatusLine
            icon="checkmark.circle"
            tone="info"
            text={planChangeText(data.value.planChange)}
            action={
              <TextButton
                label="Undo"
                onPress={() => {
                  const u = data.value.planChange;
                  if (u === null) return;
                  void services.builder.undoPlanChange(u, planChangeUndoOpId(sessionId)).then((r) => {
                    if (!r.ok) setToast({ text: r.message });
                    changed();
                    reload();
                  });
                }}
              />
            }
          />
        ) : null}

        {bests.length > 0 ? (
          // (Ben, 27 Oct; redesign §E2) New best first: the tracked lifts' new PBs (the Lifts chart's definition), each
          // with the best it beat.
          <FadeIn motion={follow(0)}>
            <Card>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space['2'] }}>
                <Icon name="star.fill" color="accent" size={14} />
                <AppText variant="sectionLabel">New best</AppText>
              </View>
              {bests.map((b) => {
                const last = newBestLastLine(b.last, (ms) => formatDayMonth(ms, tz));
                return (
                  <View key={b.exerciseId} accessible accessibilityLabel={[b.accessibilityLabel, last].filter((x): x is string => x !== null).join('. ')} style={{ gap: 2 }}>
                    <AppText numeric style={{ fontSize: 26, lineHeight: 32, fontWeight: '600' }} maxFontSizeMultiplier={1.6}>
                      {b.name !== undefined && b.set !== undefined ? `${b.name} ${b.set}` : b.text}
                    </AppText>
                    {last !== null ? (
                      <AppText variant="callout" color="text.secondary" numeric>
                        {last}
                      </AppText>
                    ) : null}
                  </View>
                );
              })}
            </Card>
          </FadeIn>
        ) : null}

        <FadeIn motion={follow(1)}>
          <StatStrip ax={ax} accessibilityLabel={statItems.map((it) => `${it.label} ${it.value}`).join(', ')} items={statItems} />
          {/* Progress v3: the reps behind This week's `Mon – 92%`, and what was short or skipped (extras can't hide it). */}
          {pvd?.reps != null ? (
            <View accessible accessibilityLabel={[pvd.reps.text, pvd.reps.short].filter((x): x is string => x !== null).join('. ')} style={{ paddingTop: theme.space['2'], gap: 2 }}>
              <AppText variant="callout" color="text.secondary" numeric>
                {pvd.reps.text}
              </AppText>
              {pvd.reps.short !== null ? (
                <AppText variant="callout" color="text.secondary">
                  {pvd.reps.short}
                </AppText>
              ) : null}
            </View>
          ) : null}
        </FadeIn>

        {doneRows.shown.length > 0 ? (
          // (Ben, 30 Oct; redesign §E2) What he just did, before Next time: one line per exercise.
          <View>
            <SectionHeader title="Exercises · done" />
            {doneRows.shown.map((e, i) => (
              <View key={e.key} style={{ borderTopWidth: i === 0 ? 0 : theme.dividerWidth, borderColor: theme.colors['border.divider'], marginTop: i === 0 ? theme.space['1'] : 0 }}>
                {/* The exercise's history (progress.md §2.7, slice B): its series, with this workout's point selected. */}
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={e.spoken}
                  accessibilityHint="Opens this exercise’s history"
                  onPress={() => {
                    navigation.navigate('ExerciseProgress', { exerciseId: e.exerciseId, sessionId, sessionExerciseId: e.sessionExerciseId, name: e.name });
                  }}
                  style={({ pressed }) => ({ minHeight: theme.target.min.height, flexDirection: 'row', alignItems: 'center', gap: theme.space['2'], opacity: pressed ? 0.6 : 1 })}
                >
                  {/* The name gives way first; the numbers keep their width (up to most of the row). */}
                  <AppText variant="body" numberOfLines={1} ellipsizeMode="tail" style={{ flex: 1, flexShrink: 1 }}>
                    {e.name}
                  </AppText>
                  {e.line !== '' ? (
                    <AppText variant="callout" numeric numberOfLines={1} ellipsizeMode="tail" style={{ flexShrink: 0, maxWidth: '70%' }}>
                      {e.line}
                    </AppText>
                  ) : null}
                  {e.aside !== '' ? (
                    <AppText variant="callout" color="text.secondary" numeric numberOfLines={1} style={{ flexShrink: 0 }}>
                      {e.aside}
                    </AppText>
                  ) : null}
                </Pressable>
              </View>
            ))}
            {doneRows.more !== null ? (
              <View style={{ alignSelf: 'flex-start' }}>
                <TextButton
                  label={doneRows.more}
                  tone="secondary"
                  onPress={() => {
                    setShowAll(true);
                  }}
                />
              </View>
            ) : null}
          </View>
        ) : null}

        {nextOpen ? (
          // (Ben, 27 Oct; redesign §E2) One Next time list: the targets (Why? / Undo; offers Skip / Apply), the
          // coach's or the rule's offers to keep a change, Undo all at the top.
          <View style={{ gap: theme.space['2'] }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space['2'] }}>
              <View style={{ flex: 1 }}>
                <SectionHeader title={nextTime?.heading ?? 'Next time'} />
              </View>
              {nextTime?.undoAll != null ? (
                <TextButton
                  label="Undo all"
                  tone="secondary"
                  onPress={() => {
                    const all = nextTime.undoAll;
                    if (all === null) return;
                    void services.coach
                      .undoNextTargets(all.actionId, all.rows)
                      .catch(() => ({ ok: false }))
                      .then((r) => {
                        if (!r.ok) setToast({ text: 'Couldn’t undo.' });
                        reload();
                        changed();
                      });
                  }}
                />
              ) : null}
            </View>
            {nextTime?.status != null ? (
              <AppText variant="callout" color="text.secondary">
                {nextTime.status}
              </AppText>
            ) : null}
            {nextTime?.emptyText != null ? (
              <AppText variant="callout" color="text.secondary">
                {nextTime.emptyText}
              </AppText>
            ) : null}
            {(nextTime?.rows ?? []).map((r) => (
              <NextRow key={r.key} row={r} onTap={(tap) => void tapNext(r, tap)} />
            ))}
            {mainLift !== null ? (
              <MainLiftRow
                view={mainLift}
                busy={keepBusy}
                onTap={(tap) => {
                  keepTap(() => (tap === 'undo' ? services.builder.undoKeepMainLift(sessionId) : services.builder.keepMainLift(sessionId, tap)));
                }}
              />
            ) : null}
            {keep !== null ? (
              <KeepRow
                view={keep}
                busy={keepBusy}
                onTap={(tap) => {
                  keepTap(() => (tap === 'undo' ? services.builder.undoKeepNextTime(sessionId) : services.builder.keepNextTime(sessionId, tap)));
                }}
              />
            ) : null}
          </View>
        ) : null}

        {sum.checkIn ? (
          <View style={{ gap: theme.space['1'] }}>
            <LinkLine
              accessibilityLabel={`How you said you felt before this workout: ${sum.checkIn.scoreText}. ${sum.checkIn.reasons ?? ''}${sum.checkIn.note ? ` Note: ${sum.checkIn.note}` : ''}`}
              onPress={() => {
                if (sum.checkIn) navigation.navigate('CheckIn', { mode: 'edit', checkInId: sum.checkIn.checkInId });
              }}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space['2'] }}>
                <AppText variant="body" numeric style={{ flex: 1 }}>{`How you said you felt: ${sum.checkIn.scoreText}`}</AppText>
                <Icon name="chevron.right" size={14} color="text.tertiary" />
              </View>
            </LinkLine>
            {sum.checkIn.reasons ? (
              <AppText variant="callout" color="text.secondary">
                {sum.checkIn.reasons}
              </AppText>
            ) : null}
            {sum.checkIn.note ? (
              // The note exactly as given, never cut off (review S4).
              <AppText variant="callout" color="text.secondary">{`“${sum.checkIn.note}”`}</AppText>
            ) : null}
            {sum.checkIn.painNotFlagged ? (
              <StatusLine
                icon="exclamationmark.triangle"
                tone="warning"
                text="Pain mentioned · which movements?"
                action={
                  <TextButton
                    label="Choose movements"
                    onPress={() => {
                      setChoosePain(true);
                    }}
                  />
                }
              />
            ) : null}
          </View>
        ) : null}

        {flaggedHere.map((f) => (
          <StatusLine
            key={f.id}
            icon="exclamationmark.triangle"
            tone="warning"
            text={`Pain flag: ${f.exerciseName} · no increases`}
            action={
              <TextButton
                label="Clear"
                onPress={() => {
                  // Same confirm as the set card and Profile, plus Undo here (rule 9, review S4).
                  const c = painClearConfirm(f);
                  Alert.alert(c.title, undefined, [
                    { text: c.cancel, style: 'cancel' },
                    {
                      text: c.confirm,
                      onPress: () => {
                        void services.pain.clearConfirmed({ flagId: f.id, expectedVersion: f.version }).then((w) => {
                          const r = w.ok ? { ok: true, cleared: w.cleared ? [w.cleared] : [] } : { ok: false, cleared: [] };
                          changed();
                          if (!r.ok) {
                            setToast({ text: 'The pain flag wasn’t cleared. Try again.' });
                            return;
                          }
                          const t = painClearedToast(f.exerciseName);
                          setToast({
                            text: t.text,
                            action: t.action,
                            onAction: () => {
                              setToast(null);
                              void services.pain.undoClear(r.cleared).then((ok) => {
                                changed();
                                if (!ok) setToast({ text: 'Couldn’t undo: flag changed' });
                              });
                            },
                          });
                        });
                      },
                    },
                  ]);
                }}
              />
            }
          />
        ))}

        {/* (Ben, 28 Oct) An imported or past-logged workout the plan couldn't place for sure: `Count as Pull?` once. */}
        <PlanDayAskRow sessionId={sessionId} onToast={setToast} />

        {/* (Ben, 21 Oct; workout-builder-v3 §6.2) One tap, a weekly review fact. */}
        <FeelRow sessionId={sessionId} />

        {/* (Ben, 27 Oct; apple-health.md §2.3) The watch's actuals for this workout, or `Link to this workout?`; nothing otherwise. */}
        <LinkedActivityRow
          sessionId={sessionId}
          pickerOpen={healthPicker}
          onPickerClose={() => {
            setHealthPicker(false);
          }}
          onChoices={setHealthChoices}
          onTimesChanged={reload}
        />

        <View style={{ gap: theme.space['1'] }}>
          {/* No orphan label (design pass 3.5): the heading only over a note. */}
          {coachNote !== null ? <SectionHeader title="Coach note" /> : null}
          {coachNote !== null ? (
            <AppText variant="callout" color="text.secondary">
              {coachNote}
            </AppText>
          ) : null}
          {sum.dateOnly === null ? (
            <View style={{ alignSelf: 'flex-start' }}>
              <TextButton
                label="Ask about this workout"
                tone="secondary"
                onPress={() => {
                  navigation.navigate('Coach', { entry: { kind: 'summary', sessionId } });
                }}
              />
            </View>
          ) : null}
        </View>

        {/* A 0-set workout was offered Discard in the finish sheet; discarding a finished one isn't in the domain yet. */}
      </ScrollView>
      {toast ? <Toast icon="info.circle" text={toast.text} {...(toast.action ? { action: toast.action } : {})} {...(toast.onAction ? { onAction: toast.onAction } : {})} /> : null}
      <BottomBar>
        <PrimaryButton label="Done" onPress={done} />
      </BottomBar>
      {nameSheet !== null ? (
        <NameSheet
          visible={nameVisible}
          title="Rename workout"
          buttonLabel="Save name"
          initialName={sum.title}
          check={(n) => Promise.resolve(checkRoutineName(n, []))}
          onSubmit={renameWorkout}
          onClose={() => {
            setNameVisible(false);
          }}
          onDismissed={nameAfter.dismissed}
        />
      ) : null}
      {saveSheet.sheet}
      <EditTimesSheet
        summary={sum}
        visible={times}
        onClose={() => {
          setTimes(false);
          if (editTimes) done();
        }}
        onSaved={(after, editOpId) => {
          setTimes(false);
          changed();
          if (editTimes) done();
          else reload();
          // (Ben, 25 Oct) Only times moved; one tap puts them back (on the version this edit made, rule 5).
          const undo = timingUndoCommand(after, editOpId, newUuid(), services.now());
          if (undo === null || editTimes) return;
          setToast({
            text: 'Times changed',
            action: 'Undo',
            onAction: () => {
              setToast(null);
              void services.workout.dispatch(sessionId, { ...undo, at: services.now() }).then((u) => {
                if (!u.ok) setToast({ text: u.error.code === 'stale_version' ? 'Couldn’t undo: changed since' : `Couldn’t undo: ${u.error.message}` });
                changed();
                reload();
              });
            },
          });
        }}
      />
      <PainChooseSheet
        summary={sum}
        visible={choosePain}
        onClose={() => {
          setChoosePain(false);
        }}
        onSaved={() => {
          setChoosePain(false);
          changed();
          reload();
        }}
      />
    </View>
  );
}

/**
 * (Ben, 23 Oct, D1; one line, Ben 30 Oct) `Keep for next time?` as one line (`Swap Leg extension → Leg press`, `+1` when
 * more changed) with compact `Skip` / `Apply`; every change behind `Why?`. Once kept, `<day> updated` with `Undo`.
 * Values from the builder service only.
 */
function KeepRow({ view, busy, onTap }: { view: KeepNextTimeView; busy: boolean; onTap: (tap: 'apply' | 'skip' | 'undo') => void }) {
  if (view.state === 'kept') {
    return <StatusLine icon="checkmark.circle" tone="info" text={view.text} {...(view.canUndo ? { action: <TextButton label="Undo" disabled={busy} onPress={() => { onTap('undo'); }} /> } : {})} />;
  }
  const first = view.short[0] ?? view.lines[0] ?? KEEP_COPY.title;
  const more = view.short.length - 1;
  return (
    <OneLineRow
      text={more > 0 ? `${first} +${String(more)}` : first}
      spoken={`${KEEP_COPY.title} ${view.short.join(', ')}`}
      info={[KEEP_COPY.title, ...view.short]}
      actions={[
        { label: KEEP_COPY.skip, tone: 'secondary', disabled: busy, onPress: () => { onTap('skip'); } },
        { label: KEEP_COPY.apply, accessibilityLabel: `${KEEP_COPY.apply}: keep for next ${view.label}`, disabled: busy, onPress: () => { onTap('apply'); } },
      ]}
    />
  );
}

const KEEP_COPY = { title: 'Keep for next time?', skip: 'Skip', apply: 'Apply' } as const;

/**
 * (Ben, 23 Oct) A main lift Ben swapped: `Make Incline barbell press the main lift for Chest?` with compact `Skip` /
 * `Apply`; once kept, `<lift> · main lift for <day>` with `Undo`. Values from the builder service only.
 */
function MainLiftRow({ view, busy, onTap }: { view: KeepMainLiftView; busy: boolean; onTap: (tap: 'apply' | 'skip' | 'undo') => void }) {
  if (view.state === 'kept') {
    return <StatusLine icon="checkmark.circle" tone="info" text={view.text} {...(view.canUndo ? { action: <TextButton label="Undo" disabled={busy} onPress={() => { onTap('undo'); }} /> } : {})} />;
  }
  return (
    <OneLineRow
      text={view.text}
      spoken={view.text}
      lines={2}
      actions={[
        { label: KEEP_COPY.skip, tone: 'secondary', disabled: busy, onPress: () => { onTap('skip'); } },
        { label: KEEP_COPY.apply, accessibilityLabel: `${KEEP_COPY.apply}: ${view.text}`, disabled: busy, onPress: () => { onTap('apply'); } },
      ]}
    />
  );
}

/** (Ben, 27 Oct; redesign §E2) One item of the one `Next time` list: ruled rows, not cards. */
function NextTimeItem({ children }: { children: ReactNode }) {
  const theme = useTheme();
  return <View style={{ gap: theme.space['1'], paddingTop: theme.space['1'], borderTopWidth: theme.dividerWidth, borderColor: theme.colors['border.divider'] }}>{children}</View>;
}

interface RowAction {
  label: string;
  accessibilityLabel?: string | undefined;
  tone?: 'accent' | 'secondary';
  disabled?: boolean;
  onPress: () => void;
}

/** A compact trailing action (`Why?`, `Undo`, `Skip`, `Apply`): callout text, a full-size touch target. */
function CompactAction({ a, expanded }: { a: RowAction; expanded?: boolean }) {
  const theme = useTheme();
  const disabled = a.disabled === true;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={a.accessibilityLabel ?? a.label}
      accessibilityState={{ disabled, ...(expanded !== undefined ? { expanded } : {}) }}
      disabled={disabled}
      onPress={a.onPress}
      hitSlop={{ top: 4, bottom: 4, left: 2, right: 2 }}
      style={({ pressed }) => ({ minHeight: theme.target.min.height, minWidth: 32, justifyContent: 'center', alignItems: 'center', opacity: pressed ? TEXT_PRESSED_OPACITY : 1 })}
    >
      <AppText variant="callout" color={disabled ? 'text.tertiary' : a.tone === 'secondary' ? 'text.secondary' : 'accent'} numberOfLines={1}>
        {a.label}
      </AppText>
    </Pressable>
  );
}

/**
 * (Ben, 30 Oct; redesign §E2) One `Next time` line: the name (truncated first), the value (`100 → 102.5 kg`, never
 * truncated), `Why?` when there is something behind it, then the row's compact actions or a one-word state. `Why?`
 * opens the reasons as an info line under the row. VoiceOver: `Bench press, 100 to 102.5 kilograms`, then each button.
 */
function OneLineRow({ name, text, spoken, info = [], actions, trailing = null, lines = 1 }: { name?: string; text: string; spoken: string; info?: readonly string[]; actions: readonly RowAction[]; trailing?: string | null; lines?: number }) {
  const theme = useTheme();
  const [why, setWhy] = useState(false);
  return (
    <NextTimeItem>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space['2'] }}>
        <View accessible accessibilityLabel={name === undefined ? spoken : `${name}, ${spoken}`} style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: theme.space['2'] }}>
          {name !== undefined ? (
            <>
              <AppText variant="body" numberOfLines={1} ellipsizeMode="tail" style={{ flex: 1, flexShrink: 1 }}>
                {name}
              </AppText>
              <AppText variant="callout" numeric numberOfLines={1} style={{ flexShrink: 0 }}>
                {text}
              </AppText>
            </>
          ) : (
            <AppText variant="body" numberOfLines={lines} ellipsizeMode="tail" style={{ flex: 1, flexShrink: 1 }}>
              {text}
            </AppText>
          )}
        </View>
        {info.length > 0 ? (
          <CompactAction
            a={{ label: NEXT_LINE_COPY.why, tone: 'secondary', onPress: () => { setWhy((w) => !w); } }}
            expanded={why}
          />
        ) : null}
        {actions.map((a) => (
          <CompactAction key={a.label} a={a} />
        ))}
        {actions.length === 0 && trailing !== null ? (
          <AppText variant="callout" color="text.secondary" numberOfLines={1} style={{ flexShrink: 0 }}>
            {trailing}
          </AppText>
        ) : null}
      </View>
      {why ? (
        <AppText variant="callout" color="text.secondary" style={{ paddingBottom: theme.space['2'] }}>
          {info.join(' · ')}
        </AppText>
      ) : null}
    </NextTimeItem>
  );
}

/**
 * One `Next time` row (D21; one line, Ben 30 Oct): `Bench press  100 → 102.5 kg  Why?  Undo`. The source, %, note and
 * reasons sit behind `Why?`. Values come from the saved rows (`nextTimeView`).
 */
function NextRow({ row, onTap }: { row: NextTimeRowView; onTap: (tap: NextTimeTap) => void }) {
  return (
    <OneLineRow
      name={row.exerciseName}
      text={row.line.text}
      spoken={row.line.spoken}
      info={row.info}
      trailing={row.trailing}
      actions={row.actions.map((a) => ({ label: a.label, accessibilityLabel: a.accessibilityLabel, onPress: () => { onTap(a.tap); } }))}
    />
  );
}

/**
 * Summary `Edit times` (workout-summary §4), also a past workout's: Started / Ended on the same
 * wheels as the Finish sheet (Ben, 19 Oct), bounds from the domain; one audited
 * `update_session_timing`, versioned. (Ben, 25 Oct) Moving Started moves the whole workout to any
 * past date and time (its sets with it, `shift`); Ended can then be set on its own. Logged values
 * never change; the caller shows `Times changed` with Undo.
 */
function EditTimesSheet({ summary, visible, onClose, onSaved }: { summary: WorkoutSummary; visible: boolean; onClose: () => void; onSaved: (after: SessionAggregate, editOpId: string) => void }) {
  const theme = useTheme();
  const services = useServices();
  const insets = useSafeAreaInsets();
  const tz = summary.tz;
  const recorded = (): WorkoutTimes => ({ startMs: toMs(summary.startedAtUtc), endMs: toMs(summary.endedAtUtc ?? summary.startedAtUtc) });
  const [times, setTimes] = useState<WorkoutTimes>(recorded);
  const [opId, setOpId] = useState(newUuid);
  const [error, setError] = useState<string | null>(null);
  // (Ben, 26 Oct) A moved Started: the whole workout (default) or only the start.
  const [startMove, setStartMove] = useState<StartMove>('whole');
  const [lastShown, setLastShown] = useState(false);
  if (visible !== lastShown) {
    setLastShown(visible);
    if (visible) {
      setTimes(recorded());
      setOpId(newUuid());
      setError(null);
      setStartMove('whole');
    }
  }
  const timeline = summaryTimeline(summary.startedAtUtc, summary.timeline);
  const pastLog = summary.pastLog;

  async function save() {
    const startChanged = times.startMs !== toMs(summary.startedAtUtc);
    const endChanged = times.endMs !== toMs(summary.endedAtUtc ?? '');
    if (!startChanged && !endChanged) {
      onClose();
      return;
    }
    const at = services.now();
    const r = await services.workout.dispatch(summary.sessionId, {
      type: 'update_session_timing',
      at,
      opId,
      expectedVersion: summary.sessionVersion,
      // The workout's own zone, not the phone's current one (review N6). A moved start moves the whole workout.
      startedAt: startChanged ? { utc: toIso(times.startMs), tz } : null,
      endedAt: endChanged || startChanged ? { utc: toIso(times.endMs), tz } : null,
      // `Only the start` (Ben, 26 Oct) keeps the sets where they were; a past log always moves whole.
      ...startMoveWrite(pastLog ? 'whole' : startMove, startChanged),
    });
    if (!r.ok) {
      setError(r.error.code === 'stale_version' ? 'The workout changed. Close and try again.' : r.error.message);
      return;
    }
    onSaved(r.aggregate, opId);
  }

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <ScrollView style={{ backgroundColor: theme.colors['bg.surface'] }} contentContainerStyle={{ padding: theme.space['4'], paddingBottom: theme.space['8'] + insets.bottom, gap: theme.space['4'] }}>
        <AppText variant="title2" accessibilityRole="header">
          Edit workout times
        </AppText>
        <WorkoutTimesRows
          times={times}
          shift={{ timeline, nowMs: clockNow() }}
          startMove={{ mode: startMove, onMode: setStartMove, fixed: summaryTimeBounds(summary.timingBounds, summary.startedAtUtc, clockNow()), pastLog }}
          tz={tz}
          onChange={setTimes}
        />
        {error ? <StatusLine icon="exclamationmark.triangle" tone="warning" text={error} /> : null}
        <PrimaryButton label="Save" onPress={() => void save()} />
        <TextButton label="Cancel" tone="secondary" onPress={onClose} />
      </ScrollView>
    </Modal>
  );
}

/** Summary `Choose movements` (check-in.md CI8): flag the exercises that hurt; the rest progress again. */
function PainChooseSheet({ summary, visible, onClose, onSaved }: { summary: WorkoutSummary; visible: boolean; onClose: () => void; onSaved: () => void }) {
  const theme = useTheme();
  const services = useServices();
  const insets = useSafeAreaInsets();
  const [picked, setPicked] = useState<string[]>([]);
  const [opId] = useState(newUuid);
  const [error, setError] = useState<string | null>(null);
  async function save() {
    const id = summary.checkIn?.checkInId;
    const checkIn = id ? await services.checkIns.get(id) : null;
    if (!checkIn) {
      setError('That check-in wasn’t found.');
      return;
    }
    const exercises = summary.exercises.filter((e) => picked.includes(e.exerciseId)).map((e) => ({ id: e.exerciseId, name: e.name }));
    const r = await services.pain.flagFromCheckIn({ checkIn, exercises, area: null, opId });
    if (!r.ok) {
      setError(r.message);
      return;
    }
    onSaved();
  }
  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <ScrollView style={{ flex: 1, backgroundColor: theme.colors['bg.surface'] }} contentContainerStyle={{ padding: theme.space['4'], paddingBottom: theme.space['4'] + insets.bottom, gap: theme.space['3'] }}>
        <AppText variant="title2" accessibilityRole="header">
          Which movements hurt?
        </AppText>
        {summary.exercises.map((e) => (
          <ChecklistRow
            key={e.sessionExerciseId}
            title={e.name}
            checked={picked.includes(e.exerciseId)}
            onToggle={() => {
              setPicked((p) => (p.includes(e.exerciseId) ? p.filter((x) => x !== e.exerciseId) : [...p, e.exerciseId]));
            }}
          />
        ))}
        {error ? <StatusLine icon="exclamationmark.triangle" tone="warning" text={error} /> : null}
        <PrimaryButton label={picked.length === 0 ? 'Choose at least one' : `Flag ${String(picked.length)} ${picked.length === 1 ? 'movement' : 'movements'}`} disabled={picked.length === 0} onPress={() => void save()} />
        <TextButton label="Cancel" tone="secondary" onPress={onClose} />
      </ScrollView>
    </Modal>
  );
}
