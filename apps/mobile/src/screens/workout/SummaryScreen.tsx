import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import { useEffect, useRef, useState } from 'react';
import { ActionSheetIOS, Alert, Modal, Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { checkRoutineName, toIso, toMs, type WorkoutSummary } from '@fizz/domain';
import { nextTargetTapOpId } from '@fizz/coach';
import { readTextCoachState } from '@fizz/providers';

import { coachConnectionPorts } from '../../ai/coach-connection-ports';
import { summaryCoachView } from '../../ai/coach-connection-view';
import { nextTimeView, type NextTimeRowView, type NextTimeTap } from '../../coach/next-time-view';
import { nowMs as clockNow } from '../../clock';
import { haptic } from '../../device/haptics';
import { newUuid } from '../../device/runtime';
import { formatCalendarDate, formatDayMonth, formatShortDate, formatTime } from '../../format/dates';
import { popToTabs, popToToday } from '../../navigation/actions';
import type { RootStackParams } from '../../navigation/types';
import type { WorkoutPresence } from '../../services/history-services';
import { firstTime, useDataChanged, useScreenData, useServices } from '../../shell/context';
import { finishMotion, listEnterMotion, shouldPlayFinish, TIMING, useTheme } from '../../theme';
import { AppText, BottomBar, Card, DelayedFade, FadeIn, RevealOnce, Chip, ChecklistRow, ChipRow, HeroHeader, Icon, LinkLine, PrimaryButton, RuledSection, SecondaryButton, SectionHeader, StatGrid, StatusLine, Tag, TextButton, TEXT_PRESSED_OPACITY, Toast } from '../../ui';
import { stepTime } from '../../workout/finish';
import { createAfterDismiss } from '../../workout/after-dismiss';
import { NameSheet } from '../routines/NameSheet';
import { useSaveToWorkouts } from '../routines/SaveWorkoutSheet';
import { LIBRARY_COPY_UI } from '../../workout/library-view';
import { DELETE_COPY, deletedToastText, restoredToastText, summaryCanDelete } from '../../history/delete-view';
import { handOffDeleteToast } from '../../history/toast-handoff';
import { DeletedWorkoutView } from './DeletedWorkoutView';
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
  const { sessionId, back = false, justFinished: finishedNow = false, editTimes = false } = useRoute<RouteProp<RootStackParams, 'Summary'>>().params;
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
  const [data, reload] = useScreenData(async (s) => {
    // Keychain + settings file only, no network; a read failure counts as not connected.
    const coach = summaryCoachView(await readTextCoachState(coachConnectionPorts().ports).catch(() => null));
    const [summary, backup, painFlags, routines] = await Promise.all([s.workout.summary(sessionId, coach.coach), s.backups.getStatus(), s.pain.active(), s.routines.list().catch(() => [])]);
    // `Save to Workouts` (routines.md §A2.6): once saved from here, the link reads `Saved · Legs ›`.
    const savedAs = routines.find((r) => r.createdFromSessionId === sessionId) ?? null;
    // D21: the coach's saved targets over the built-in rule's, and the summary turn's checked reply as the note.
    const [coachRows, stale, availability, turnNote] = await Promise.all([s.coach.nextTargets(sessionId).catch(() => []), s.coach.staleNextTargets(sessionId).catch(() => new Set<string>()), s.coach.availability(), s.coach.summaryNote(sessionId).catch(() => null)]);
    const nextTime = summary === null ? null : nextTimeView({ title: summary.title, builtIn: summary.nextTime, coachRows, stale, availability, reviewing: s.coach.summaryRunning(sessionId) !== null && reviewing.current });
    // A deleted (or purged) workout opens read-only with Restore (delete-workouts §3.2).
    // A presence read that fails offers no delete rather than one that would be refused (review r2 N2).
    const presence = await s.history.presence(sessionId).catch((): WorkoutPresence => ({ kind: 'hidden' }));
    return { summary, backup, painFlags, savedAs, coachNote: turnNote ?? coach.note, nextTime, presence };
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

  // From a saved workout, the save lives in `⋯` so it doesn't read as a prompt (§A2.6).
  const fromSaved = sum.routineId !== null;
  const openSave = () => void saveSheet.open({ kind: 'session', sessionId }, sum.storedName ?? null);
  /** `⋯`: `Save to Workouts` (from a saved workout not saved again, §A2.6) and `Delete workout` (delete-workouts §2.2). */
  const moreItems: { label: string; run: () => void; destructive?: boolean }[] = [
    ...(fromSaved && savedAs === null ? [{ label: LIBRARY_COPY_UI.saveToWorkouts, run: openSave }] : []),
    ...(canDelete ? [{ label: DELETE_COPY.menuItem, run: () => void deleteThis(), destructive: true }] : []),
  ];
  /** `⋯` → `Delete workout` (§2.2, DW1, DW2): the tap is the confirmation; Undo comes as a toast where Ben lands. */
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

  const flaggedHere = painFlags.filter((f) => sum.exercises.some((e) => e.exerciseId === f.exerciseId));
  const tz = sum.tz;
  const range = `${formatTime(toMs(sum.startedAtUtc), tz)}–${sum.endedAtUtc ? formatTime(toMs(sum.endedAtUtc), tz) : ''}`;
  const edited = sum.timingEdited.end ? ' (end time edited)' : sum.timingEdited.start ? ' (start time edited)' : '';
  const line = backup.onPhone.line;
  const failed = backup.onPhone.state === 'failed';

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors['bg.canvas'] }}>
      <ScrollView contentContainerStyle={{ paddingTop: insets.top + theme.space['4'], paddingHorizontal: theme.components.screenMargin, paddingBottom: theme.space['8'], gap: theme.space['5'] }}>
        {/* The finish moment (premium-feel §6): the saved check draws once, then the title fades in. Done works from the first frame. */}
        <View style={{ gap: theme.space['1'] }} accessibilityRole="summary">
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space['2'] }}>
            <RevealOnce durationMs={finish.strokeMs} size={20} background={theme.colors['bg.canvas']}>
              <Icon name="checkmark.circle.fill" color="status.done" size={20} />
            </RevealOnce>
            <AppText variant="callout">Workout saved on this phone</AppText>
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
          ) : (
            <AppText variant="callout" color="text.secondary" numeric>
              {line.text}
            </AppText>
          )}
        </View>

        {/* D: a quiet hero (label, large title, facts); no tinted block. */}
        {/* A date-only (imported) workout shows its date and nothing else about time (rule 6). */}
        <DelayedFade delayMs={finish.titleDelayMs} durationMs={finish.titleFadeMs}>
          <View style={{ gap: theme.space['2'] }}>
            <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: theme.space['2'] }}>
              <View style={{ flex: 1 }}>
                <HeroHeader
                  eyebrow="Workout done"
                  title={sum.title}
                  lines={[(sum.dateOnly !== null ? [formatCalendarDate(sum.dateOnly), sum.gymName, 'date only'] : [formatShortDate(toMs(sum.startedAtUtc), tz), sum.gymName, `${range}${edited}`]).filter(Boolean).join(' · ')]}
                />
              </View>
              {/* Rename (premium-feel §6.2): a 44 pt pencil next to the title; the routine keeps its name. */}
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Rename workout, ${sum.title}`}
                onPress={() => {
                  openName('workout');
                }}
                style={({ pressed }) => ({ minWidth: theme.target.min.width, minHeight: theme.target.min.height, alignItems: 'center', justifyContent: 'center', opacity: pressed ? TEXT_PRESSED_OPACITY : 1 })}
              >
                <Icon name="pencil" color="text.secondary" size={18} />
              </Pressable>
              {(fromSaved && savedAs === null) || canDelete ? (
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
                  <Icon name="ellipsis" color="text.secondary" size={18} />
                </Pressable>
              ) : null}
            </View>
            {savedAs !== null ? (
              <LinkLine
                accessibilityLabel={`Saved to Workouts as ${savedAs.name}. Opens it.`}
                onPress={() => {
                  navigation.navigate('WorkoutOverview', { target: { kind: 'routine', routineId: savedAs.id } });
                }}
              >
                <AppText variant="callout" color="text.secondary">
                  {LIBRARY_COPY_UI.savedLink(savedAs.name)}
                </AppText>
              </LinkLine>
            ) : !fromSaved ? (
              <View style={{ alignSelf: 'flex-start' }}>
                <TextButton label={LIBRARY_COPY_UI.saveToWorkouts} onPress={openSave} />
              </View>
            ) : null}
          </View>
        </DelayedFade>

        {sum.highlight ? (
          <RuledSection title="Today" gap="2">
            <AppText variant="title1" numeric style={{ fontSize: 28, lineHeight: 34, fontWeight: '500' }}>
              {sum.highlight}
            </AppText>
          </RuledSection>
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

        {/* D: large light numerals on calm tiles. */}
        <FadeIn motion={follow(0)}>
        <StatGrid
          items={[
            ...(sum.facts.activeText !== null ? [{ label: 'Active time', value: sum.facts.activeText }] : []),
            { label: 'Exercises', value: `${String(sum.facts.exercisesDone)}/${String(sum.facts.exercisesTotal)}` },
            { label: 'Working sets', value: String(sum.facts.workingSets), unit: sum.facts.skippedSets > 0 ? `(${String(sum.facts.skippedSets)} skipped)` : null },
            ...(sum.facts.warmupSets > 0 ? [{ label: 'Warm-up sets', value: String(sum.facts.warmupSets) }] : []),
          ]}
        />
        </FadeIn>

        {sum.comparison ? (
          <FadeIn motion={follow(1)}>
            <Comparison c={sum.comparison} tz={tz} />
          </FadeIn>
        ) : null}
        {sum.records.length > 0 ? (
          // Heaviest-set lines (premium-feel §5.1), in the Comparison region; static, no badge or colour.
          <FadeIn motion={follow(1)}>
            <View style={{ gap: theme.space['2'] }}>
              {sum.records.map((r) => (
                <View key={r} accessible accessibilityLabel={r} style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space['2'] }}>
                  <Icon name="star" color="text.secondary" size={16} />
                  <AppText variant="callout" style={{ flex: 1 }}>
                    {r}
                  </AppText>
                </View>
              ))}
            </View>
          </FadeIn>
        ) : null}

        {sum.exercises.length > 0 ? (
          <View>
            <SectionHeader title="Exercises" />
            {sum.exercises.map((e, i) => (
              <View
                key={e.sessionExerciseId}
                style={{
                  gap: 2,
                  paddingVertical: theme.space['3'],
                  borderTopWidth: theme.dividerWidth,
                  borderBottomWidth: i === sum.exercises.length - 1 ? theme.dividerWidth : 0,
                  borderColor: theme.colors['border.divider'],
                  marginTop: i === 0 ? theme.space['2'] : 0,
                }}
              >
                {/* The exercise's history (progress.md §2.7, slice B): its series, with this workout's point selected. */}
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`${e.name}, ${e.setsText}`}
                  accessibilityHint="Opens this exercise’s history"
                  onPress={() => {
                    navigation.navigate('ExerciseProgress', { exerciseId: e.exerciseId, sessionId, sessionExerciseId: e.sessionExerciseId, name: e.name });
                  }}
                  style={({ pressed }) => ({ minHeight: theme.target.min.height, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: theme.space['2'], opacity: pressed ? 0.6 : 1 })}
                >
                  <AppText variant="headline" style={{ flex: 1 }}>
                    {e.name}
                  </AppText>
                  <AppText variant="callout" color="text.secondary" numeric>
                    {e.setsText}
                  </AppText>
                  <Icon name="chevron.right" color="text.tertiary" size={14} />
                </Pressable>
                {e.results !== '' ? (
                  <AppText variant="callout" numeric>
                    {e.results}
                  </AppText>
                ) : null}
                {e.skipped > 0 ? <AppText variant="callout" color="text.secondary" numeric>{`${String(e.skipped)} skipped`}</AppText> : null}
                {e.sides ? (
                  <AppText variant="callout" color="text.secondary" numeric>
                    {e.sides}
                  </AppText>
                ) : null}
              </View>
            ))}
          </View>
        ) : null}

        {nextTime ? (
          <View style={{ gap: theme.space['3'] }}>
            <SectionHeader title={nextTime.heading} />
            {nextTime.status !== null ? (
              <AppText variant="callout" color="text.secondary">
                {nextTime.status}
              </AppText>
            ) : null}
            {nextTime.emptyText ? (
              <AppText variant="callout" color="text.secondary">
                {nextTime.emptyText}
              </AppText>
            ) : null}
            {nextTime.rows.map((r) => (
              <NextRow key={r.key} row={r} onTap={(tap) => void tapNext(r, tap)} />
            ))}
            {nextTime.undoAll !== null ? (
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
        ) : null}

        <View style={{ gap: theme.space['1'] }}>
          <SectionHeader title="Coach note" />
          {coachNote !== null ? (
            <AppText variant="callout" color="text.secondary">
              {coachNote}
            </AppText>
          ) : null}
          {sum.dateOnly === null ? (
            <TextButton
              label="Ask about this workout"
              tone="secondary"
              onPress={() => {
                navigation.navigate('Coach', { entry: { kind: 'summary', sessionId } });
              }}
            />
          ) : null}
        </View>

        {/* A 0-set workout was offered Discard in the finish sheet; discarding a finished one isn't in the domain yet. */}
      </ScrollView>
      {toast ? <Toast icon="info.circle" text={toast.text} {...(toast.action ? { action: toast.action } : {})} {...(toast.onAction ? { onAction: toast.onAction } : {})} /> : null}
      <BottomBar>
        <View style={{ flexDirection: 'row', gap: theme.space['2'] }}>
          {sum.dateOnly === null ? (
            <View style={{ flex: 1 }}>
              <SecondaryButton
                label="Edit times"
                onPress={() => {
                  setTimes(true);
                }}
              />
            </View>
          ) : null}
          <View style={{ flex: 1 }}>
            <PrimaryButton label="Done" onPress={done} />
          </View>
        </View>
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
        onSaved={() => {
          setTimes(false);
          changed();
          if (editTimes) done();
          else reload();
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

function Fact({ label, value }: { label: string; value: string }) {
  const theme = useTheme();
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: theme.space['3'], flexWrap: 'wrap' }} accessible accessibilityLabel={`${label}: ${value}`}>
      <AppText variant="body" color="text.secondary">
        {label}
      </AppText>
      <AppText variant="body" numeric>
        {value}
      </AppText>
    </View>
  );
}

function Comparison({ c, tz }: { c: NonNullable<WorkoutSummary['comparison']>; tz: string }) {
  const theme = useTheme();
  return (
    <View style={{ gap: theme.space['1'] }}>
      <SectionHeader title="Compared with last time" />
      {c.kind === 'compared' ? (
        <>
          <AppText variant="headline">{`${c.exerciseName} · top set`}</AppText>
          <Fact label="Today" value={c.todayText} />
          <Fact label={formatDayMonth(toMs(c.lastAtUtc), tz)} value={c.lastText} />
          <AppText variant="callout" color="text.secondary">
            {c.why}
          </AppText>
        </>
      ) : (
        <AppText variant="callout" color="text.secondary">
          {c.text}
        </AppText>
      )}
    </View>
  );
}

/**
 * One `Next time` row (D21): the target and its %, the source tag, `Why?`
 * (the coach's reason, checks and the built-in rule's value, or the rule's
 * own facts) and the row's buttons. Values come from the saved rows.
 */
function NextRow({ row, onTap }: { row: NextTimeRowView; onTap: (tap: NextTimeTap) => void }) {
  const theme = useTheme();
  const [why, setWhy] = useState(false);
  return (
    <Card>
      <AppText variant="headline">{row.exerciseName}</AppText>
      <AppText variant="body" numeric>
        {row.pct === null ? row.target : `${row.target} · ${row.pct}`}
      </AppText>
      <Tag text={row.tag} />
      {row.note !== null ? (
        <AppText variant="callout" color="text.secondary">
          {row.note}
        </AppText>
      ) : null}
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: theme.space['8'] }}>
        <TextButton
          label={why ? 'Hide' : 'Why?'}
          tone="secondary"
          onPress={() => {
            setWhy((w) => !w);
          }}
        />
        <View style={{ flexDirection: 'row', gap: theme.space['4'] }}>
          {row.actions.map((a) => (
            <TextButton
              key={a.tap}
              label={a.label}
              onPress={() => {
                onTap(a.tap);
              }}
            />
          ))}
        </View>
      </View>
      {why ? (
        <View style={{ gap: theme.space['1'] }}>
          {row.why.map((f) => (
            <AppText key={f} variant="callout" color="text.secondary">
              {`· ${f}`}
            </AppText>
          ))}
        </View>
      ) : null}
    </Card>
  );
}

/** Summary `Edit times` (workout-summary §4): start and end, audited; bounds from the domain. */
function EditTimesSheet({ summary, visible, onClose, onSaved }: { summary: WorkoutSummary; visible: boolean; onClose: () => void; onSaved: () => void }) {
  const theme = useTheme();
  const services = useServices();
  const insets = useSafeAreaInsets();
  const tz = summary.tz;
  const [start, setStart] = useState(toMs(summary.startedAtUtc));
  const [end, setEnd] = useState(toMs(summary.endedAtUtc ?? summary.startedAtUtc));
  const [opId, setOpId] = useState(newUuid);
  const [error, setError] = useState<string | null>(null);
  const [lastShown, setLastShown] = useState(false);
  if (visible !== lastShown) {
    setLastShown(visible);
    if (visible) {
      setStart(toMs(summary.startedAtUtc));
      setEnd(toMs(summary.endedAtUtc ?? summary.startedAtUtc));
      setOpId(newUuid());
      setError(null);
    }
  }
  const startMax = Math.min(toMs(summary.timingBounds.startLatestUtc), end);
  const endMin = Math.max(toMs(summary.timingBounds.endEarliestUtc), start);
  const endMax = Math.min(toMs(summary.timingBounds.endLatestUtc), clockNow());

  async function save() {
    const startChanged = start !== toMs(summary.startedAtUtc);
    const endChanged = end !== toMs(summary.endedAtUtc ?? '');
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
      // The workout's own zone, not the phone's current one (review N6).
      startedAt: startChanged ? { utc: toIso(start), tz } : null,
      endedAt: endChanged ? { utc: toIso(end), tz } : null,
    });
    if (!r.ok) {
      setError(r.error.code === 'stale_version' ? 'The workout changed. Close and try again.' : r.error.message);
      return;
    }
    onSaved();
  }

  const row = (label: string, value: number, set: (v: number) => void, min: number, max: number) => (
    <View style={{ gap: theme.space['2'] }}>
      <AppText variant="label" color="text.secondary">
        {label}
      </AppText>
      <AppText variant="title2" numeric>
        {formatTime(value, tz)}
      </AppText>
      <ChipRow>
        {[-5, -1, 1, 5].map((m) => (
          <Chip key={m} label={`${m < 0 ? '−' : '+'}${String(Math.abs(m))} min`} selected={false} onPress={() => { set(stepTime(value, m, min, max)); }} />
        ))}
      </ChipRow>
    </View>
  );

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <ScrollView style={{ backgroundColor: theme.colors['bg.surface'] }} contentContainerStyle={{ padding: theme.space['4'], paddingBottom: theme.space['8'] + insets.bottom, gap: theme.space['4'] }}>
        <AppText variant="title2" accessibilityRole="header">
          Edit workout times
        </AppText>
        {row('Started at', start, setStart, toMs(summary.startedAtUtc) - 12 * 3600_000, startMax)}
        {row('Ended at', end, setEnd, endMin, endMax)}
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
