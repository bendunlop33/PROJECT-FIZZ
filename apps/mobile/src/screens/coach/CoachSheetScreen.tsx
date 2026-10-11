import { useFocusEffect, useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import { useCallback, useEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, Linking, Pressable, ScrollView, View, type TextInput } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { ContextDescription } from '@fizz/coach';
import { toMs } from '@fizz/domain';
import type { BenInput, CoachThread } from '@fizz/schemas';

import { MANAGE_USAGE_URL } from '../../ai/coach-connection-view';
import { nowMs as clockNow } from '../../clock';
import type { CoachAvailability, CoachEntry } from '../../coach/coach-service';
import {
  applyProgress,
  routeLine,
  seesLabel,
  starterChips,
  startLiveTurn,
  statusView,
  thinkingLabel,
  threadRows,
  workoutBarText,
  type LiveTurn,
  type StarterChip,
  type StatusAction,
  type ThreadRow,
} from '../../coach/sheet-view';
import { newUuid } from '../../device/runtime';
import { formatTime } from '../../format/dates';
import type { RootStackParams } from '../../navigation/types';
import { useDataChanged, useServices } from '../../shell/context';
import { TIMING, useTheme } from '../../theme';
import { AppText, Chip, DomainLabel, Icon, TextButton, TextField } from '../../ui';
import { CoachCard } from './CoachCard';

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
const entryKey = (e: CoachEntry): string => (e.kind === 'today' ? 'today' : `${e.kind}:${e.sessionId}`);

export function CoachSheetScreen() {
  const theme = useTheme();
  const services = useServices();
  const changed = useDataChanged();
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const { entry, focus = false } = useRoute<RouteProp<RootStackParams, 'Coach'>>().params;
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
  const [threads, setThreads] = useState<CoachThread[] | null>(null);
  const [workout, setWorkout] = useState<{ title: string | null; active: boolean; bar: string; exercise: { id: string; name: string } | null } | null>(null);
  const [askPain, setAskPain] = useState(false);
  /** Outside a workout: the movements `Pain` can flag; `picking` shows them as chips. */
  const [painChoices, setPainChoices] = useState<{ exerciseId: string; name: string }[]>([]);
  const [picking, setPicking] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const lastInput = useRef<BenInput | null>(null);
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
      setRows(threadRows(data));
      setTitle(data.thread.title);
    },
    [services],
  );

  const loadWorkout = useCallback(async () => {
    if (entry.kind === 'today') return;
    const d = await services.workout.load(entry.sessionId).catch(() => null);
    if (d === null) {
      setWorkout(null);
      return;
    }
    const active = d.aggregate.session.status === 'active';
    const v = active ? services.workout.view(d, clockNow(), null) : null;
    const rest = v?.rest ?? null;
    setWorkout({
      title: d.aggregate.session.routineName ?? d.title,
      active,
      bar: workoutBarText(rest === null ? null : rest.kind === 'ended' ? { kind: 'ended' } : { kind: rest.kind, remainingMs: rest.remainingMs }, d.aggregate.session.pause !== null),
      exercise: v?.focus ? { id: v.focus.exerciseId, name: v.focus.exerciseName } : null,
    });
  }, [entry, services]);

  useFocusEffect(
    useCallback(() => {
      const screen = { alive: true };
      const alive = (): boolean => screen.alive;
      void (async () => {
        const a = await services.coach.availability();
        if (!alive()) return;
        setAvailability(a);
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

  // One ticker for the elapsed label and the workout bar; no animation (check 22).
  useEffect(() => {
    const t = setInterval(() => {
      setNow(clockNow());
      if (entry.kind === 'workout') void loadWorkout();
    }, 1000);
    return () => {
      clearInterval(t);
    };
  }, [entry, loadWorkout]);

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
    lastInput.current = input;
    setNotice(null);
    setAskPain(false);
    setLive(startLiveTurn(turnId, input, clockNow()));
    const typed = input.kind === 'words' ? input.text : null;
    if (typed !== null) setDraft('');
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
      else if (workout?.active === true && workout.exercise !== null) setAskPain(true);
      else {
        // Outside a workout too (review S5): the named movement, or which one.
        const choices = await services.coach.painChoices(entry, typed).catch(() => []);
        setPainChoices(choices);
        setAskPain(choices.length > 0);
      }
      await loadRows(r.threadId);
      if (r.cards.length > 0) changed();
    } catch {
      // Not sent (no route): the words go back in the field; nothing is queued (CS4).
      if (typed !== null) setDraft(typed);
      setNotice('Not sent.');
    } finally {
      setLive(null);
      setAvailability(await services.coach.availability());
    }
  }

  async function undo(actionId: string) {
    const r = await services.coach.undo(actionId, `undo:${actionId}:${newUuid()}`).catch(() => null);
    if (r === null) {
      setNotice('Couldn’t undo.');
      return;
    }
    setNotice(r.result.status === 'not_possible' ? `Couldn’t undo: ${r.undo.failure ?? 'it changed since'}.` : null);
    await loadRows(threadId ?? null);
    changed();
  }

  async function flag(ex: { id: string; name: string }) {
    const r = await services.pain.flagMovement({ exerciseId: ex.id, exerciseName: ex.name, opId: newUuid() });
    setAskPain(false);
    setPicking(false);
    setNotice(r.ok ? `Pain noted for ${ex.name}.` : r.message);
    changed();
  }

  async function pain() {
    const ex = workout?.active === true ? (workout.exercise ?? null) : null;
    if (ex !== null) return flag(ex);
    const [only, ...more] = painChoices;
    if (only === undefined) return;
    if (more.length === 0) return flag({ id: only.exerciseId, name: only.name });
    setPicking(true);
  }

  function statusAction(a: StatusAction) {
    if (a === 'manage_usage') {
      void Linking.openURL(MANAGE_USAGE_URL);
      return;
    }
    navigation.navigate('Tabs', { screen: 'Profile', params: { screen: 'CoachConnection' } });
  }

  const status = availability === null ? null : statusView(availability);
  const route = availability === null ? null : routeLine(availability);
  const chips: StarterChip[] = availability === null ? [] : starterChips(entry, availability, workout?.active === true);
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

      <ScrollView ref={scroll} onContentSizeChange={() => scroll.current?.scrollToEnd({ animated: false })} contentContainerStyle={{ padding: theme.components.screenMargin, gap: theme.space['4'], flexGrow: 1 }} keyboardShouldPersistTaps="handled">
        {empty && chips.length > 0 ? (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.space['2'] }}>
            {chips.map((c) => (
              <Chip
                key={c.label}
                label={c.label}
                selected={false}
                onPress={() => {
                  if (c.input === null) void pain();
                  else void send(c.input);
                }}
              />
            ))}
          </View>
        ) : null}
        {rows.map((r) => (
          <Row key={r.key} row={r} onUndo={(id) => void undo(id)} onRetry={() => lastInput.current !== null && void send(lastInput.current)} />
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
          <AppText variant="label">{seesLabel(entry, workout?.title ?? null, workout?.active === true)}</AppText>
        </Pressable>
        {sees !== null ? <SeesPanel sees={sees} /> : null}
        <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: theme.space['2'] }}>
          <View style={{ flex: 1 }}>
            <TextField ref={field} value={text} onChangeText={setDraft} placeholder={status?.placeholder ?? 'Ask the coach…'} multiline style={{ maxHeight: 140 }} accessibilityLabel="Message to the coach" />
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

function Row({ row, onUndo, onRetry }: { row: ThreadRow; onUndo: (actionId: string) => void; onRetry: () => void }) {
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
      return <CoachCard card={row.card} onUndo={onUndo} />;
    case 'note':
      return (
        <View style={{ flexDirection: 'row', gap: theme.space['2'], alignItems: 'center' }}>
          <Icon name="info.circle" size={16} />
          <AppText variant="callout" color="text.secondary">
            {row.text}
          </AppText>
        </View>
      );
    case 'outcome':
      return (
        <View style={{ flexDirection: 'row', gap: theme.space['2'], alignItems: 'center' }}>
          <Icon name={row.icon} size={16} />
          <AppText variant="callout" color="text.secondary" style={{ flex: 1 }}>
            {row.text}
          </AppText>
          {row.retry ? <TextButton label="Try again" onPress={onRetry} /> : null}
        </View>
      );
  }
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
