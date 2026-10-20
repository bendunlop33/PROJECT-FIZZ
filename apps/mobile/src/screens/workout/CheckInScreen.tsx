import type { StartChoice } from '../../builder/builder-service';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, View, type TextInput } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  asksReasons,
  CHECK_IN_REASON_LABEL,
  CHECK_IN_REASONS,
  DEFAULT_CHECK_IN_SETTINGS,
  PAIN_AREA_LABEL,
  PAIN_AREAS,
  PAIN_PROFESSIONAL_TEXT,
  PAIN_RED_FLAG_TEXT,
  scoreText,
  searchExercises,
} from '@fizz/domain';
import { CHECK_IN_NOTE_MAX, type CheckIn, type CheckInReason, type CheckInScore, type Exercise, type PainArea, type SessionCheckIn } from '@fizz/schemas';

import { haptic } from '../../device/haptics';
import { newUuid } from '../../device/runtime';
import { openStartedWorkout, popToToday } from '../../navigation/actions';
import type { RootStackParams, WorkoutToastParam } from '../../navigation/types';
import { useDataChanged, useServices } from '../../shell/context';
import { useTheme } from '../../theme';
import { AppText, Chip, ChipRow, Eyebrow, Icon, PrimaryButton, SecondaryButton, StatusLine, TextButton, TextField } from '../../ui';
import { NO_REASONS_WRITTEN, skipReasons, submitReasons, type ReasonsSheetState } from '../../workout/check-in-sheet';
import { checkInSheetEnd } from '../../workout/overview';

type Step = 'score' | 'reasons' | 'pain' | 'ill';
const CHECK_IN_NOT_SAVED = 'Check-in not saved';
const SCORES: readonly CheckInScore[] = [1, 2, 3, 4, 5];

/**
 * Pre-workout check-in sheet (check-in.md §2.2–2.5). It comes before the
 * session exists (CI1): swiping it away starts nothing (CI3). The score is
 * saved at the first tap (CI4); reasons and the note update the same record.
 * Talk is hidden: voice input isn't in this build. Settings use the defaults
 * until the Check-in settings screen exists.
 */
export function CheckInScreen() {
  const route = useRoute<RouteProp<RootStackParams, 'CheckIn'>>();
  const p = route.params;
  if (p.mode === 'start') return <StartCheckIn gymId={p.gymId} repeatOf={p.repeatOf ?? null} nextOf={p.nextOf ?? null} routineOf={p.routineOf ?? null} coachDraftOf={p.coachDraftOf ?? null} {...(p.builderStart === undefined ? {} : { builderStart: p.builderStart })} />;
  if (p.mode === 'overview') return <StartCheckIn gymId={null} repeatOf={null} nextOf={null} routineOf={null} overview={{ checkInId: p.checkInId, atScore: p.atScore === true }} />;
  return <EditCheckIn checkInId={p.checkInId} />;
}

function Sheet({
  title,
  lead,
  info,
  infoLabel,
  children,
  bar,
  onBack,
  backLabel,
  barFirst = false,
}: {
  title: string;
  lead?: string;
  /** Behind an ⓘ by the title (minimal copy): how a rule works, shown only on a tap. */
  info?: string;
  /** VoiceOver label for the ⓘ; defaults to `About <title>`. */
  infoLabel?: string;
  children?: React.ReactNode;
  bar: React.ReactNode;
  onBack?: () => void;
  backLabel?: string;
  /** Actions straight under the title, so they are visible at the 0.55 detent above a long list (audit F1). */
  barFirst?: boolean;
}) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const [infoOpen, setInfoOpen] = useState(false);
  return (
    <View style={{ flex: 1, backgroundColor: theme.colors['bg.surface'] }}>
      {/*
        The actions sit right after the content, inside the scroll view, not in
        a bar pinned to the bottom: UIKit keeps a sheet's content at its largest
        detent's height, so a pinned bar can be off-screen at the 0.55 detent
        (review workout-loop S8). Scrolling always reaches them.
      */}
      <ScrollView
        contentContainerStyle={{ paddingHorizontal: theme.components.screenMargin, paddingTop: theme.space['5'], paddingBottom: theme.space['4'] + insets.bottom, gap: theme.space['4'] }}
        keyboardShouldPersistTaps="handled"
        automaticallyAdjustKeyboardInsets
      >
        {onBack ? <TextButton label={backLabel ?? 'Back'} icon="chevron.left" onPress={onBack} /> : null}
        <View style={{ gap: theme.space['2'] }}>
          <Eyebrow>Check-in</Eyebrow>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space['2'] }}>
            <AppText variant="title2" accessibilityRole="header" style={{ flexShrink: 1 }}>
              {title}
            </AppText>
            {info ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={infoLabel ?? `About ${title}`}
                accessibilityState={{ expanded: infoOpen }}
                hitSlop={12}
                onPress={() => {
                  setInfoOpen((o) => !o);
                }}
              >
                <Icon name="info.circle" color="text.secondary" size={18} />
              </Pressable>
            ) : null}
          </View>
          {info && infoOpen ? (
            <AppText variant="callout" color="text.secondary">
              {info}
            </AppText>
          ) : null}
        </View>
        {lead ? (
          <AppText variant="callout" color="text.secondary">
            {lead}
          </AppText>
        ) : null}
        {barFirst ? <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: theme.space['3'] }}>{bar}</View> : null}
        {children}
        {barFirst ? null : <View style={{ borderTopWidth: theme.dividerWidth, borderTopColor: theme.colors['border.divider'], paddingTop: theme.space['4'], gap: theme.space['3'] }}>{bar}</View>}
      </ScrollView>
    </View>
  );
}

function ScoreRow({ chosen, onPick, disabled = false }: { chosen: CheckInScore | null; onPick: (s: CheckInScore) => void; disabled?: boolean }) {
  const theme = useTheme();
  const d = theme.components.cardBorderWidth === 0;
  return (
    <View accessibilityLabel="How are you feeling today, 1 to 5" style={{ gap: theme.space['1'] }}>
      <View style={{ flexDirection: 'row', gap: theme.space['2'] }}>
        {SCORES.map((n) => {
          const selected = chosen === n;
          return (
            <Pressable
              key={n}
              accessibilityRole="button"
              accessibilityState={{ selected, disabled }}
              accessibilityLabel={`${scoreText(n)}${n === 1 ? ', rough' : n === 5 ? ', great' : ''}`}
              disabled={disabled}
              onPress={() => {
                haptic('step');
                onPick(n);
              }}
              style={({ pressed }) =>
                d
                  ? {
                      // D (D-Rest effort pills): a full accent pill with a check when chosen.
                      flex: 1,
                      height: 64,
                      borderRadius: theme.radius.pill,
                      borderWidth: selected ? 0 : 1,
                      borderColor: theme.colors['border.divider'],
                      backgroundColor: selected ? theme.colors.accent : pressed ? theme.colors['bg.raised'] : theme.colors['bg.canvas'],
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexDirection: 'row',
                      gap: 2,
                    }
                  : {
                      flex: 1,
                      height: 64,
                      borderRadius: theme.radius.md,
                      borderWidth: selected ? 2 : 1,
                      borderColor: selected ? theme.colors.accent : theme.colors['border.control'],
                      backgroundColor: selected || pressed ? theme.colors['accent.subtle'] : theme.colors['bg.raised'],
                      alignItems: 'center',
                      justifyContent: 'center',
                    }
              }
            >
              {d && selected ? <Icon name="checkmark" color="on.accent" size={14} /> : null}
              <AppText variant="keypad" color={d && selected ? 'on.accent' : 'text.primary'} style={d ? { fontWeight: '300' } : undefined}>
                {String(n)}
              </AppText>
              {!d && selected ? <Icon name="checkmark" color="accent" size={14} /> : null}
            </Pressable>
          );
        })}
      </View>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', flexWrap: 'wrap' }}>
        <AppText variant="callout" color="text.tertiary">
          1 = rough
        </AppText>
        <AppText variant="callout" color="text.tertiary">
          5 = great
        </AppText>
      </View>
    </View>
  );
}

function ReasonsEditor({ reasons, setReasons, note, setNote, noteRef }: { reasons: CheckInReason[]; setReasons: (r: CheckInReason[]) => void; note: string; setNote: (n: string) => void; noteRef: React.RefObject<TextInput | null> }) {
  const theme = useTheme();
  return (
    <>
      <ChipRow>
        {CHECK_IN_REASONS.map((r) => (
          <Chip
            key={r}
            label={r === 'other' ? 'Other…' : CHECK_IN_REASON_LABEL[r]}
            selected={reasons.includes(r)}
            onPress={() => {
              const on = reasons.includes(r);
              setReasons(on ? reasons.filter((x) => x !== r) : [...reasons, r]);
              if (r === 'other' && !on) noteRef.current?.focus();
            }}
          />
        ))}
      </ChipRow>
      <View style={{ gap: theme.space['1'] }}>
        <Eyebrow>Note (optional)</Eyebrow>
        <TextField
          ref={noteRef}
          value={note}
          onChangeText={(t) => {
            setNote(t.slice(0, CHECK_IN_NOTE_MAX));
          }}
          placeholder={reasons.includes('other') ? 'What else?' : 'Anything else?'}
          multiline
          maxLength={CHECK_IN_NOTE_MAX}
          returnKeyType="done"
          submitBehavior="blurAndSubmit"
          accessibilityLabel="Note, optional"
          style={{ maxHeight: 110 }}
        />
        {note.length >= 240 ? (
          <AppText variant="label" color="text.secondary" numeric>{`${String(note.length)} of ${String(CHECK_IN_NOTE_MAX)}`}</AppText>
        ) : null}
      </View>
    </>
  );
}

/**
 * `overview`: opened over the Workout overview (workout-overview §2.2). The
 * session doesn't exist yet and this sheet never starts one: `Done`, `Skip`,
 * `Not now`, `Flag n movements` and `Train anyway` save and return to the
 * overview, which re-reads its plan (a new pain flag shows `HELD`). `Skip
 * workout` still closes to Today. `checkInId`: the score already saved on
 * the page (opens at What's up?); null opens at the score (AX sizes).
 */
function StartCheckIn({ gymId, repeatOf, nextOf, routineOf, coachDraftOf = null, builderStart, overview }: { gymId: string | null; repeatOf: string | null; nextOf: string | null; routineOf: string | null; /** (Today v2) Today's session card: its committed builder draft. */ coachDraftOf?: string | null; /** (v3 §2.8) Today's edited card: the prompt's choice, started through the builder. */ builderStart?: { choice: StartChoice; expectedVersion: number }; overview?: { checkInId: string | null; atScore: boolean } }) {
  const services = useServices();
  const changed = useDataChanged();
  const navigation = useNavigation();
  const noteRef = useRef<TextInput>(null);
  // One ID per sheet: the check-in, its first write, the start. Retries reuse them (rule 5).
  const [checkInId] = useState(newUuid);
  const [recordOp] = useState(newUuid);
  const [startOp] = useState(newUuid);
  const reasonsWrites = useRef<ReasonsSheetState>(NO_REASONS_WRITTEN);
  const [step, setStep] = useState<Step>(overview?.checkInId && !overview.atScore ? 'reasons' : 'score');
  const [record, setRecord] = useState<CheckIn | null>(null);
  const [score, setScore] = useState<CheckInScore | null>(null);
  const [reasons, setReasons] = useState<CheckInReason[]>([]);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  /** Pain flagged before the ill step: its toast (with Undo) is kept for the start (review S7). */
  const [painToast, setPainToast] = useState<WorkoutToastParam | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [painPicked, setPainPicked] = useState<Exercise[]>([]);
  const [painArea, setPainArea] = useState<PainArea | null>(null);
  const [query, setQuery] = useState('');
  const [exercises, setExercises] = useState<Exercise[]>([]);
  const [recentIds, setRecentIds] = useState<string[]>([]);

  useEffect(() => {
    let alive = true;
    void Promise.all([services.coachingKnowledge.exercises(), services.workout.recentExerciseIds()]).then(([list, recent]) => {
      if (!alive) return;
      setExercises(list);
      setRecentIds(recent);
    });
    return () => {
      alive = false;
    };
  }, [services]);

  // Over the overview: the check-in Ben already has (the score saved there, or a reused one).
  const existingId = overview?.checkInId ?? null;
  useEffect(() => {
    if (existingId === null) return;
    let alive = true;
    void services.checkIns.get(existingId).then((c) => {
      if (!alive || !c) return;
      setRecord(c);
      setScore(c.score);
      setReasons(c.reasons);
      setNote(c.note ?? '');
    });
    return () => {
      alive = false;
    };
  }, [services, existingId]);

  async function start(checkIn: SessionCheckIn, toast: WorkoutToastParam | null) {
    if (checkInSheetEnd({ overview: overview !== undefined, gymId }) === 'back_to_overview' || gymId === null) {
      // Back to the overview: it re-reads, and its Start links this check-in.
      changed();
      navigation.goBack();
      return;
    }
    setBusy(true);
    if (builderStart !== undefined && coachDraftOf !== null) {
      // The edited card's §2.8 choice: the plan write and the session in the builder's one Start (same op ID on retry).
      const b = await services.builder.start(coachDraftOf, { choice: builderStart.choice, opId: startOp, expectedVersion: builderStart.expectedVersion, gymId, checkIn }).catch(() => null);
      setBusy(false);
      if (b === null || !b.ok) {
        setError(b === null ? 'Couldn’t start the workout. Try again.' : b.message);
        return;
      }
      changed();
      navigation.dispatch(openStartedWorkout(toast ? { toast } : undefined));
      return;
    }
    let r: Awaited<ReturnType<typeof services.workout.start>>;
    try {
      r = await services.workout.start({ gymId, opId: startOp, checkIn, repeatOf, nextOf, routineOf, coachDraftOf });
    } catch (e) {
      // Never a stuck sheet (audit F9): say so; the same opId makes a retry safe.
      setBusy(false);
      setError(`Couldn’t start the workout: ${e instanceof Error ? e.message : String(e)}. Try again.`);
      return;
    }
    setBusy(false);
    if (!r.ok) {
      setError(r.error.code === 'session_already_active' ? 'A workout is already in progress. Resume it from Today.' : r.error.message);
      return;
    }
    changed();
    // A start notice (targets not worked out; review S2) rides on the check-in toast, or is its own.
    const notice = r.notice ?? null;
    const shown: WorkoutToastParam | null = notice === null ? toast : toast ? { ...toast, text: `${toast.text}. ${notice}` } : { kind: 'info', text: notice };
    navigation.dispatch(openStartedWorkout(shown ? { toast: shown } : undefined));
  }

  const savedToast = (c: CheckIn): WorkoutToastParam => ({ kind: 'check_in', text: `Check-in saved · ${scoreText(c.score)}`, checkInId: c.id });

  async function pickScore(n: CheckInScore) {
    if (busy || (existingId !== null && record === null)) return;
    setScore(n);
    setError(null);
    setBusy(true);
    let saved = record;
    if (saved === null) {
      const r = await services.checkIns.record({ checkInId, opId: recordOp, score: n });
      saved = r.ok ? r.checkIn : null;
    } else if (saved.score !== n) {
      const r = await services.checkIns.update(saved.id, { score: n }, saved.version, newUuid());
      saved = r.ok ? r.checkIn : saved;
    }
    setBusy(false);
    if (saved === null && checkInSheetEnd({ overview: overview !== undefined, gymId }) === 'back_to_overview') {
      // Over the overview nothing starts here: say so on the sheet; the overview's Start still works (review r2 N4).
      setError(CHECK_IN_NOT_SAVED);
      return;
    }
    if (saved === null) {
      // Never blocks logging (check-in.md §3 Write failed).
      await start({ kind: 'skipped', atUtc: services.now().utc }, { kind: 'info', text: CHECK_IN_NOT_SAVED });
      return;
    }
    setRecord(saved);
    changed();
    if (asksReasons(n, DEFAULT_CHECK_IN_SETTINGS)) {
      setStep('reasons');
      return;
    }
    await start({ kind: 'answered', checkInId: saved.id }, savedToast(saved));
  }

  /** A refused reasons write: say so; when stale, show the latest check-in, chips and note included (review N1). */
  function reasonsFailed(r: { message: string; latest: CheckIn | null }) {
    if (r.latest) {
      setRecord(r.latest);
      setScore(r.latest.score);
      setReasons(r.latest.reasons);
      setNote(r.latest.note ?? '');
    }
    setError(r.message);
  }

  async function done() {
    if (record === null || busy) return;
    setBusy(true);
    setError(null);
    // A new opId per distinct Done (Back from the pain step and a change is a new write); a retry reuses it.
    const r = await submitReasons(services.checkIns, record, { reasons, note: note.trim() === '' ? null : note }, reasonsWrites.current, newUuid);
    reasonsWrites.current = r.state;
    setBusy(false);
    if (!r.ok) {
      reasonsFailed(r);
      return;
    }
    const saved = r.checkIn;
    setRecord(saved);
    changed();
    if (r.next === 'pain' || r.next === 'ill') setStep(r.next);
    else await start({ kind: 'answered', checkInId: saved.id }, savedToast(saved));
  }

  /** `Skip` once a score is saved: the score only, so reasons saved by an earlier Done are put back first (review S1). */
  async function skipWithScore() {
    if (record === null || busy) return;
    setBusy(true);
    setError(null);
    const r = await skipReasons(services.checkIns, record, reasonsWrites.current, newUuid);
    reasonsWrites.current = r.state;
    setBusy(false);
    if (!r.ok) {
      if (r.stale || checkInSheetEnd({ overview: overview !== undefined, gymId }) === 'back_to_overview') {
        reasonsFailed(r);
        return;
      }
      // Never blocks logging (check-in.md §3 Write failed): start without the check-in.
      await start({ kind: 'skipped', atUtc: services.now().utc }, { kind: 'info', text: CHECK_IN_NOT_SAVED });
      return;
    }
    if (r.checkIn !== record) {
      setRecord(r.checkIn);
      changed();
    }
    await start({ kind: 'answered', checkInId: r.checkIn.id }, savedToast(r.checkIn));
  }

  async function afterPain(flagged: { flags: { id: string; version: number }[]; names: string[]; checkIn: CheckIn } | null) {
    const current = flagged?.checkIn ?? record;
    if (current === null) return;
    const toast: WorkoutToastParam = flagged ? { kind: 'pain', text: `Pain noted for ${flagged.names.join(', ')}`, flags: flagged.flags } : savedToast(current);
    if (current.reasons.includes('ill')) {
      setRecord(current);
      setPainToast(flagged ? toast : null);
      setStep('ill');
      return;
    }
    await start({ kind: 'answered', checkInId: current.id }, toast);
  }

  async function flagPain() {
    if (record === null || painPicked.length === 0 || busy) return;
    setBusy(true);
    const r = await services.pain.flagFromCheckIn({ checkIn: record, exercises: painPicked, area: painArea, opId: `${recordOp}:pain` });
    setBusy(false);
    if (!r.ok) {
      setError(r.message);
      return;
    }
    changed();
    await afterPain({ flags: r.flags ?? [], names: painPicked.map((e) => e.name), checkIn: r.checkIn });
  }

  async function skipWorkout() {
    if (record === null || busy) return;
    setBusy(true);
    await services.checkIns.update(record.id, { outcome: 'skipped_workout' }, record.version, `${recordOp}:skip`);
    setBusy(false);
    changed();
    navigation.dispatch(popToToday('Check-in saved · no workout'));
  }

  const errorLine = error ? <StatusLine icon="exclamationmark.triangle" tone="warning" text={error} /> : null;

  const painList = useMemo(() => {
    const found = searchExercises(exercises, query);
    if (query.trim() !== '') return found.slice(0, 30);
    const recent = recentIds.map((id) => exercises.find((e) => e.id === id)).filter((e): e is Exercise => e !== undefined);
    return [...recent, ...found.filter((e) => !recentIds.includes(e.id))].slice(0, 30);
  }, [exercises, query, recentIds]);

  switch (step) {
    case 'score':
      return (
        <Sheet
          title="How are you feeling today?"
          bar={
            <SecondaryButton
              label="Skip"
              disabled={busy}
              onPress={() => {
                // A score already given (back from What's up?) is kept; otherwise nothing is written.
                if (record) void skipWithScore();
                else void start({ kind: 'skipped', atUtc: services.now().utc }, null);
              }}
            />
          }
        >
          {/* Over the overview with a saved score: wait for it, so a tap updates it rather than recording a second one (N1). */}
          <ScoreRow chosen={score} disabled={existingId !== null && record === null} onPick={(n) => void pickScore(n)} />
          {errorLine}
        </Sheet>
      );

    case 'reasons':
      return (
        <Sheet
          title="What’s up?"
          {...(overview?.checkInId && !overview.atScore
            ? {}
            : {
                onBack: () => {
                  setStep('score');
                },
              })}
          backLabel={score === null ? 'Back' : scoreText(score)}
          barFirst
          bar={
            <>
              <TextButton
                label="Skip"
                tone="secondary"
                accessibilityHint={overview ? 'Keeps your score.' : 'Keeps your score and starts the workout.'}
                onPress={() => void skipWithScore()}
              />
              <View style={{ flex: 1 }}>
                <PrimaryButton label="Done" busy={busy} onPress={() => void done()} />
              </View>
            </>
          }
        >
          <ReasonsEditor reasons={reasons} setReasons={setReasons} note={note} setNote={setNote} noteRef={noteRef} />
          {errorLine}
        </Sheet>
      );

    case 'pain':
      return (
        <Sheet
          title="Which movements hurt?"
          info="Flagged movements don’t go up until you clear the flag."
          infoLabel="About pain flags"
          onBack={() => {
            setStep('reasons');
          }}
          backLabel="What’s up?"
          // 2.6: the bar under the title, so `Flag 2` stays visible while searching with the keyboard up.
          barFirst
          bar={
            <>
              <TextButton label="Not now" tone="secondary" onPress={() => void afterPain(null)} />
              <View style={{ flex: 1 }}>
                <PrimaryButton
                  label={painPicked.length === 0 ? 'Choose a movement' : `Flag ${String(painPicked.length)} ${painPicked.length === 1 ? 'movement' : 'movements'}`}
                  disabled={painPicked.length === 0}
                  busy={busy}
                  onPress={() => void flagPain()}
                />
              </View>
            </>
          }
        >
          <TextField value={query} onChangeText={setQuery} placeholder="Search exercises" accessibilityLabel="Search exercises" />
          {query.trim() === '' && recentIds.length > 0 ? <Eyebrow>Recent</Eyebrow> : null}
          <ChipRow>
            {painList.map((e) => (
              <Chip
                key={e.id}
                label={e.name}
                selected={painPicked.some((p) => p.id === e.id)}
                onPress={() => {
                  setPainPicked((cur) => (cur.some((p) => p.id === e.id) ? cur.filter((p) => p.id !== e.id) : [...cur, e]));
                }}
              />
            ))}
          </ChipRow>
          <Eyebrow>Where? (optional)</Eyebrow>
          <ChipRow>
            {PAIN_AREAS.map((a) => (
              <Chip
                key={a}
                label={PAIN_AREA_LABEL[a]}
                selected={painArea === a}
                onPress={() => {
                  setPainArea((cur) => (cur === a ? null : a));
                }}
              />
            ))}
          </ChipRow>
          <AppText variant="callout" color="text.secondary">
            {PAIN_PROFESSIONAL_TEXT}
          </AppText>
          <AppText variant="callout" color="text.secondary">
            {PAIN_RED_FLAG_TEXT}
          </AppText>
          {errorLine}
        </Sheet>
      );

    case 'ill':
      return (
        <Sheet
          title="Rest today?"
          bar={
            <>
              {/* Reschedule needs the weekly plan (not in this build), so it is hidden, not disabled. */}
              <SecondaryButton label="Skip workout" disabled={busy} onPress={() => void skipWorkout()} />
              <SecondaryButton
                label="Train anyway"
                disabled={busy}
                onPress={() => {
                  if (record) void start({ kind: 'answered', checkInId: record.id }, painToast ?? savedToast(record));
                }}
              />
            </>
          }
        >
          {errorLine}
        </Sheet>
      );
  }
}

/** `Change check-in` (check-in.md §4.6): score, reasons and note; versioned and audited. */
function EditCheckIn({ checkInId }: { checkInId: string }) {
  const services = useServices();
  const changed = useDataChanged();
  const navigation = useNavigation();
  const noteRef = useRef<TextInput>(null);
  const [record, setRecord] = useState<CheckIn | null>(null);
  const [score, setScore] = useState<CheckInScore | null>(null);
  const [reasons, setReasons] = useState<CheckInReason[]>([]);
  const [note, setNote] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [saveOp] = useState(newUuid);

  useEffect(() => {
    let alive = true;
    void services.checkIns.get(checkInId).then((c) => {
      if (!alive || !c) return;
      setRecord(c);
      setScore(c.score);
      setReasons(c.reasons);
      setNote(c.note ?? '');
    });
    return () => {
      alive = false;
    };
  }, [services, checkInId]);

  async function save() {
    if (!record || score === null || busy) return;
    setBusy(true);
    const r = await services.checkIns.update(record.id, { score, reasons, note: note.trim() === '' ? null : note }, record.version, saveOp);
    setBusy(false);
    if (!r.ok) {
      setMessage(r.message);
      const latest = await services.checkIns.get(checkInId);
      if (latest) {
        setRecord(latest);
        setScore(latest.score);
        setReasons(latest.reasons);
        setNote(latest.note ?? '');
      }
      return;
    }
    changed();
    navigation.goBack();
  }

  return (
    <Sheet title="Change check-in" bar={<PrimaryButton label="Save changes" busy={busy} disabled={record === null} onPress={() => void save()} />}>
      <ScoreRow chosen={score} onPick={setScore} />
      <ReasonsEditor reasons={reasons} setReasons={setReasons} note={note} setNote={setNote} noteRef={noteRef} />
      {message ? <StatusLine icon="info.circle" tone="info" text={message} /> : null}
    </Sheet>
  );
}
