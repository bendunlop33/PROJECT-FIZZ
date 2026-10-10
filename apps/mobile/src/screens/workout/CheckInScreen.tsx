import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  asksReasons,
  CHECK_IN_REASON_LABEL,
  CHECK_IN_REASONS,
  DEFAULT_CHECK_IN_SETTINGS,
  PAIN_AREA_LABEL,
  PAIN_AREAS,
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
import { AppText, Chip, ChipRow, Icon, PrimaryButton, SecondaryButton, StatusLine, TextButton } from '../../ui';

type Step = 'score' | 'reasons' | 'pain' | 'ill';
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
  return route.params.mode === 'start' ? <StartCheckIn gymId={route.params.gymId} repeatOf={route.params.repeatOf ?? null} nextOf={route.params.nextOf ?? null} /> : <EditCheckIn checkInId={route.params.checkInId} />;
}

function Sheet({ title, lead, children, bar, onBack, backLabel }: { title: string; lead?: string; children?: React.ReactNode; bar: React.ReactNode; onBack?: () => void; backLabel?: string }) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <View style={{ flex: 1, backgroundColor: theme.colors['bg.surface'] }}>
      {/*
        The actions sit right after the content, inside the scroll view, not in
        a bar pinned to the bottom: UIKit keeps a sheet's content at its largest
        detent's height, so a pinned bar can be off-screen at the 0.55 detent
        (review workout-loop S8). Scrolling always reaches them.
      */}
      <ScrollView contentContainerStyle={{ padding: theme.space['4'], paddingBottom: theme.space['4'] + insets.bottom, gap: theme.space['4'] }} keyboardShouldPersistTaps="handled">
        {onBack ? <TextButton label={backLabel ?? 'Back'} icon="chevron.left" onPress={onBack} /> : null}
        <AppText variant="title2" accessibilityRole="header">
          {title}
        </AppText>
        {lead ? (
          <AppText variant="callout" color="text.secondary">
            {lead}
          </AppText>
        ) : null}
        {children}
        <View style={{ borderTopWidth: theme.dividerWidth, borderTopColor: theme.colors['border.divider'], paddingTop: theme.space['4'], gap: theme.space['3'] }}>{bar}</View>
      </ScrollView>
    </View>
  );
}

function ScoreRow({ chosen, onPick }: { chosen: CheckInScore | null; onPick: (s: CheckInScore) => void }) {
  const theme = useTheme();
  return (
    <View accessibilityLabel="How are you feeling today, 1 to 5" style={{ gap: theme.space['1'] }}>
      <View style={{ flexDirection: 'row', gap: theme.space['2'] }}>
        {SCORES.map((n) => {
          const selected = chosen === n;
          return (
            <Pressable
              key={n}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              accessibilityLabel={`${scoreText(n)}${n === 1 ? ', rough' : n === 5 ? ', great' : ''}`}
              onPress={() => {
                haptic('step');
                onPick(n);
              }}
              style={({ pressed }) => ({
                flex: 1,
                height: 64,
                borderRadius: theme.radius.md,
                borderWidth: selected ? 2 : 1,
                borderColor: selected ? theme.colors.accent : theme.colors['border.control'],
                backgroundColor: selected || pressed ? theme.colors['accent.subtle'] : theme.colors['bg.raised'],
                alignItems: 'center',
                justifyContent: 'center',
              })}
            >
              <AppText variant="keypad">{String(n)}</AppText>
              {selected ? <Icon name="checkmark" color="accent" size={14} /> : null}
            </Pressable>
          );
        })}
      </View>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', flexWrap: 'wrap' }}>
        <AppText variant="label" color="text.secondary">
          1 = rough
        </AppText>
        <AppText variant="label" color="text.secondary">
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
      {reasons.includes('pain') ? <StatusLine icon="info.circle" tone="info" text="Next you’ll choose which movements hurt." /> : null}
      <View style={{ gap: theme.space['1'] }}>
        <AppText variant="label">Note (optional)</AppText>
        <TextInput
          ref={noteRef}
          value={note}
          onChangeText={(t) => {
            setNote(t.slice(0, CHECK_IN_NOTE_MAX));
          }}
          placeholder={reasons.includes('other') ? 'What else?' : 'Anything else?'}
          placeholderTextColor={theme.colors['text.tertiary']}
          multiline
          maxLength={CHECK_IN_NOTE_MAX}
          returnKeyType="done"
          submitBehavior="blurAndSubmit"
          accessibilityLabel="Note, optional"
          maxFontSizeMultiplier={theme.type.body.maxFontSizeMultiplier}
          style={{
            minHeight: 52,
            maxHeight: 110,
            padding: theme.space['3'],
            borderRadius: theme.radius.sm,
            borderWidth: 1,
            borderColor: theme.colors['border.control'],
            backgroundColor: theme.colors['bg.raised'],
            color: theme.colors['text.primary'],
            fontSize: theme.type.body.fontSize,
          }}
        />
        {note.length >= 240 ? (
          <AppText variant="label" color="text.secondary" numeric>{`${String(note.length)} of ${String(CHECK_IN_NOTE_MAX)}`}</AppText>
        ) : null}
      </View>
    </>
  );
}

function StartCheckIn({ gymId, repeatOf, nextOf }: { gymId: string; repeatOf: string | null; nextOf: string | null }) {
  const theme = useTheme();
  const services = useServices();
  const changed = useDataChanged();
  const navigation = useNavigation();
  const noteRef = useRef<TextInput>(null);
  // One ID per sheet: the check-in, its first write, the start. Retries reuse them (rule 5).
  const [checkInId] = useState(newUuid);
  const [recordOp] = useState(newUuid);
  const [startOp] = useState(newUuid);
  const [step, setStep] = useState<Step>('score');
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

  async function start(checkIn: SessionCheckIn, toast: WorkoutToastParam | null) {
    setBusy(true);
    let r: Awaited<ReturnType<typeof services.workout.start>>;
    try {
      r = await services.workout.start({ gymId, opId: startOp, checkIn, repeatOf, nextOf });
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
    navigation.dispatch(openStartedWorkout(toast ? { toast } : undefined));
  }

  const savedToast = (c: CheckIn): WorkoutToastParam => ({ kind: 'check_in', text: `Check-in saved · ${scoreText(c.score)}`, checkInId: c.id });

  async function pickScore(n: CheckInScore) {
    if (busy) return;
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
    if (saved === null) {
      // Never blocks logging (check-in.md §3 Write failed).
      await start({ kind: 'skipped', atUtc: services.now().utc }, { kind: 'info', text: 'Check-in wasn’t saved. Your workout started as normal.' });
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

  async function done() {
    if (record === null || busy) return;
    setBusy(true);
    const r = await services.checkIns.update(record.id, { reasons, note: note.trim() === '' ? null : note }, record.version, `${recordOp}:reasons`);
    setBusy(false);
    const saved = r.ok ? r.checkIn : record;
    setRecord(saved);
    changed();
    if (reasons.includes('pain')) setStep('pain');
    else if (reasons.includes('ill')) setStep('ill');
    else await start({ kind: 'answered', checkInId: saved.id }, savedToast(saved));
  }

  async function afterPain(flagged: { flagIds: string[]; names: string[]; checkIn: CheckIn } | null) {
    const current = flagged?.checkIn ?? record;
    if (current === null) return;
    const toast: WorkoutToastParam = flagged ? { kind: 'pain', text: `Pain noted for ${flagged.names.join(', ')}`, flagIds: flagged.flagIds } : savedToast(current);
    if (reasons.includes('ill')) {
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
    await afterPain({ flagIds: r.flagIds ?? [], names: painPicked.map((e) => e.name), checkIn: r.checkIn });
  }

  async function skipWorkout() {
    if (record === null || busy) return;
    setBusy(true);
    await services.checkIns.update(record.id, { outcome: 'skipped_workout' }, record.version, `${recordOp}:skip`);
    setBusy(false);
    changed();
    navigation.dispatch(popToToday('No workout started. Your check-in is saved.'));
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
          lead="Before your workout. Saved with it. Nothing changes unless you say so."
          bar={
            <SecondaryButton
              label="Skip"
              disabled={busy}
              onPress={() => {
                // A score already given (back from What's up?) is kept; otherwise nothing is written.
                void start(record ? { kind: 'answered', checkInId: record.id } : { kind: 'skipped', atUtc: services.now().utc }, record ? savedToast(record) : null);
              }}
            />
          }
        >
          <ScoreRow chosen={score} onPick={(n) => void pickScore(n)} />
          {errorLine}
        </Sheet>
      );

    case 'reasons':
      return (
        <Sheet
          title="What’s up?"
          lead="Pick any that apply. Optional."
          onBack={() => {
            setStep('score');
          }}
          backLabel={score === null ? 'Back' : scoreText(score)}
          bar={
            <>
              <TextButton
                label="Skip"
                tone="secondary"
                accessibilityHint="Keeps your score and starts the workout."
                onPress={() => {
                  if (record) void start({ kind: 'answered', checkInId: record.id }, savedToast(record));
                }}
              />
              <PrimaryButton label="Done" busy={busy} onPress={() => void done()} />
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
          lead="No increases on these until you clear the flag. This isn’t a diagnosis."
          onBack={() => {
            setStep('reasons');
          }}
          backLabel="What’s up?"
          bar={
            <>
              <TextButton label="Not now" tone="secondary" onPress={() => void afterPain(null)} />
              <PrimaryButton
                label={painPicked.length === 0 ? 'Choose a movement' : `Flag ${String(painPicked.length)} ${painPicked.length === 1 ? 'movement' : 'movements'}`}
                disabled={painPicked.length === 0}
                busy={busy}
                onPress={() => void flagPain()}
              />
            </>
          }
        >
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Search exercises"
            placeholderTextColor={theme.colors['text.tertiary']}
            accessibilityLabel="Search exercises"
            style={{ minHeight: 52, paddingHorizontal: theme.space['3'], borderRadius: theme.radius.sm, borderWidth: 1, borderColor: theme.colors['border.control'], backgroundColor: theme.colors['bg.raised'], color: theme.colors['text.primary'], fontSize: theme.type.body.fontSize }}
          />
          {query.trim() === '' && recentIds.length > 0 ? <AppText variant="label">Recent</AppText> : null}
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
          <AppText variant="label">Where? (optional)</AppText>
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
            If pain is sharp, keeps coming back or doesn’t settle, see a physio or doctor. The coach can’t diagnose.
          </AppText>
          <AppText variant="callout" color="text.secondary">
            Stop and get medical help now if you have chest pain, feel faint or have sudden severe pain.
          </AppText>
          {errorLine}
        </Sheet>
      );

    case 'ill':
      return (
        <Sheet
          title="Rest might be the better call today."
          lead="You picked Feeling ill. It’s your call. Nothing changes either way."
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
    <Sheet title="Change check-in" lead="Changing it never changes your sets or next-time targets." bar={<PrimaryButton label="Save changes" busy={busy} disabled={record === null} onPress={() => void save()} />}>
      <ScoreRow chosen={score} onPick={setScore} />
      <ReasonsEditor reasons={reasons} setReasons={setReasons} note={note} setNote={setNote} noteRef={noteRef} />
      {message ? <StatusLine icon="info.circle" tone="info" text={message} /> : null}
    </Sheet>
  );
}
