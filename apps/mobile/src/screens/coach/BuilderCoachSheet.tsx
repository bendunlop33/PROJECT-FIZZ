import { useNavigation } from '@react-navigation/native';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ScrollView, useWindowDimensions, View, type TextInput } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { builderApplyOpId, type BuilderCoachReach } from '@fizz/coach';
import { toMs } from '@fizz/domain';

import { editAskView, EDIT_ASK_COPY } from '../../coach/builder-coach-view';
import {
  applyTurn,
  askTurn,
  BUILDER_SHEET_COPY,
  builderSeesLabel,
  builderSheetStatus,
  retryTurn,
  sendPlan,
  settleTurn,
  skipTurn,
  turnCard,
  undoTurn,
  type BuilderCoachEntry,
  type BuilderTurn,
} from '../../coach/builder-sheet-view';
import { COACH_DONE_ACCESSORY_ID, COACH_TRANSCRIPT_KEYBOARD } from '../../coach/sheet-view';
import { newUuid } from '../../device/runtime';
import { formatTime } from '../../format/dates';
import { useDataChanged, useServices } from '../../shell/context';
import { useTheme } from '../../theme';
import { AppText, Icon, KeyboardDoneAccessory, PrimaryButton, SecondaryButton, SheetKeyboardAvoidingView, StatusLine, TextButton, TextField, useKeyboardVisible } from '../../ui';
import { HeaderButton, SendButton } from './SheetButtons';

/**
 * (Ben, 26 Oct, follow-up 3 option a) The coach sheet opened from Your workout's bar: the same look as Today's
 * (header, status word, transcript, `Sees` chip, field and Send). Typed words go to the builder's `askEdit`; what
 * comes back is a proposal card with Apply / Skip. Nothing is written to the draft without Apply (rule 3); Apply is
 * checked again against the draft as it is now (`Out of date. Ask again.`), and an applied card keeps its Undo.
 * Your workout reloads when the sheet closes.
 */

/** Turns and typed text per draft, kept while the app runs (closing the sheet keeps them). */
const turnsByDraft = new Map<string, BuilderTurn[]>();
const typedByDraft = new Map<string, string>();

export function BuilderCoachSheet({ entry }: { entry: BuilderCoachEntry }) {
  const theme = useTheme();
  const services = useServices();
  const changed = useDataChanged();
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const keyboardUp = useKeyboardVisible();
  const { fontScale } = useWindowDimensions();
  const field = useRef<TextInput>(null);
  const scroll = useRef<ScrollView>(null);
  const [reach, setReach] = useState<BuilderCoachReach>('not_connected');
  const [turns, setTurnsState] = useState<BuilderTurn[]>(() => turnsByDraft.get(entry.draftId) ?? []);
  const turnsRef = useRef(turns);
  const [text, setTextState] = useState(() => typedByDraft.get(entry.draftId) ?? '');
  const [busy, setBusy] = useState<string | null>(null);
  const [failed, setFailed] = useState<Record<string, true>>({});
  const undoOps = useRef(new Map<string, string>());

  const setTurns = useCallback(
    (next: (cur: BuilderTurn[]) => BuilderTurn[]) => {
      const t = next(turnsRef.current);
      turnsRef.current = t;
      turnsByDraft.set(entry.draftId, t);
      setTurnsState(t);
    },
    [entry.draftId],
  );
  const setText = (t: string) => {
    typedByDraft.set(entry.draftId, t);
    setTextState(t);
  };

  useEffect(() => {
    let live = true;
    void services.builderCoach
      .status()
      .catch((): BuilderCoachReach => 'not_connected')
      .then((r) => {
        if (live) setReach(r);
      });
    return () => {
      live = false;
    };
  }, [services]);

  const asking = turns.some((t) => t.result.kind === 'asking');
  const status = builderSheetStatus(reach, asking);
  const canSend = status.canSend && text.trim() !== '';

  async function send() {
    const words = text.trim();
    if (!canSend || words === '') return;
    // (Ben, 26 Oct) "Again" right after an ask that got no answer sends that ask again, not the word.
    const plan = sendPlan(turnsRef.current, words);
    if (plan.kind === 'retry') {
      setText('');
      await retry(plan.turn);
      return;
    }
    const now = services.now();
    const id = newUuid();
    setTurns((cur) => askTurn(cur, { id, words, atUtc: now.utc, tz: now.tz }));
    if (!turnsRef.current.some((t) => t.id === id)) return;
    setText('');
    await ask(id, words, false);
  }

  async function ask(id: string, words: string, again: boolean) {
    const r = await services.builderCoach.askEdit({ draftId: entry.draftId, words, opId: id, retry: again }).catch(() => null);
    const v = r === null ? ({ kind: 'toast', text: EDIT_ASK_COPY.noAnswer } as const) : editAskView(r);
    const settled = settleTurn(turnsRef.current, id, v);
    setTurns(() => settled.turns);
    if (settled.reach !== null) setReach(settled.reach);
  }

  /** `Retry` on a turn that got no answer: the same words and ask ID again, tried even when the sheet reads Offline. */
  async function retry(t: BuilderTurn) {
    setTurns((cur) => retryTurn(cur, t.id));
    if (turnsRef.current.find((x) => x.id === t.id)?.result.kind !== 'asking') return;
    await ask(t.id, t.words, true);
  }

  /** `Apply` (Ben's tap, rule 3): one versioned write under the proposal's op ID; a stale draft is refused. */
  async function apply(t: BuilderTurn) {
    if (t.result.kind !== 'proposal' || t.result.state !== 'open' || busy !== null) return;
    const proposal = t.result.proposal;
    setBusy(t.id);
    try {
      const r = await services.builderCoach.apply(proposal).catch(() => ({ kind: 'failed' }) as const);
      const outcome = r.kind === 'applied' ? 'applied' : r.kind === 'out_of_date' ? 'out_of_date' : 'failed';
      setTurns((cur) => applyTurn(cur, t.id, outcome));
      setFailed((f) => (outcome === 'failed' ? { ...f, [t.id]: true } : Object.fromEntries(Object.entries(f).filter(([k]) => k !== t.id))));
      if (outcome === 'applied') changed();
    } finally {
      setBusy(null);
    }
  }

  async function undo(t: BuilderTurn) {
    if (t.result.kind !== 'proposal' || t.result.undo !== 'available' || busy !== null) return;
    const op = undoOps.current.get(t.id) ?? newUuid();
    undoOps.current.set(t.id, op);
    setBusy(t.id);
    try {
      const r = await services.builder.undo(entry.draftId, builderApplyOpId(t.result.proposal.id), op).catch(() => null);
      const ok = r !== null && (r.status === 'written' || r.status === 'replayed');
      setTurns((cur) => undoTurn(cur, t.id, ok));
      if (ok) changed();
    } finally {
      setBusy(null);
    }
  }

  return (
    <SheetKeyboardAvoidingView style={{ flex: 1, backgroundColor: theme.colors['bg.canvas'], paddingTop: theme.space['2'] }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', minHeight: 44, paddingHorizontal: theme.space['2'] }}>
        <View style={{ width: theme.target.min.width }} />
        <AppText variant="headline" accessibilityRole="header" maxFontSizeMultiplier={1.5} numberOfLines={1} style={{ flex: 1, textAlign: 'center' }}>
          {BUILDER_SHEET_COPY.title}
        </AppText>
        <HeaderButton icon="xmark" label="Close" onPress={() => { navigation.goBack(); }} />
      </View>
      {status.word !== null ? (
        <View style={{ marginHorizontal: theme.components.screenMargin, marginTop: theme.space['2'], flexDirection: 'row', alignItems: 'center', gap: theme.space['2'] }}>
          <Icon name="exclamationmark.triangle" size={18} color="status.warning" />
          <AppText variant="callout" style={{ flex: 1 }}>
            {status.word}
          </AppText>
        </View>
      ) : null}
      <ScrollView
        ref={scroll}
        style={{ flex: 1, borderTopWidth: theme.dividerWidth, borderTopColor: theme.colors['border.divider'], marginTop: theme.space['2'] }}
        onContentSizeChange={() => scroll.current?.scrollToEnd({ animated: false })}
        // (27 Oct) The keyboard shrinks the transcript: keep the latest turn in view above the composer.
        onLayout={() => scroll.current?.scrollToEnd({ animated: false })}
        contentContainerStyle={{ padding: theme.components.screenMargin, gap: theme.space['4'], flexGrow: 1 }}
        {...COACH_TRANSCRIPT_KEYBOARD}
      >
        {turns.map((t) => (
          <View key={t.id} style={{ gap: theme.space['3'] }}>
            <View style={{ alignSelf: 'flex-end', maxWidth: '80%', gap: theme.space['1'] }}>
              <View style={{ backgroundColor: theme.colors['bg.raised'], borderRadius: theme.radius.md, padding: theme.space['3'] }}>
                <AppText variant="body">{t.words}</AppText>
              </View>
              <AppText variant="label" color="text.secondary" numeric align="right">
                {formatTime(toMs(t.atUtc), t.tz)}
              </AppText>
            </View>
            <TurnResult turn={t} busy={busy === t.id} notApplied={failed[t.id] === true} canRetry={!asking} onRetry={() => void retry(t)} onApply={() => void apply(t)} onSkip={() => { setTurns((cur) => skipTurn(cur, t.id)); }} onUndo={() => void undo(t)} />
          </View>
        ))}
      </ScrollView>
      <View style={{ paddingHorizontal: theme.components.screenMargin, paddingBottom: keyboardUp ? theme.space['2'] : insets.bottom + theme.space['2'], gap: theme.space['2'] }}>
        {keyboardUp ? null : (
          <View style={{ alignSelf: 'flex-start', minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: theme.space['1'], paddingHorizontal: theme.space['3'], borderRadius: theme.radius.pill, borderWidth: 1, borderColor: theme.colors['border.control'], backgroundColor: theme.colors['bg.raised'] }}>
            <Icon name="eye" size={16} />
            <AppText variant="label">{builderSeesLabel(entry.name, services.builderCoach.sees().lastDays)}</AppText>
          </View>
        )}
        <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: theme.space['2'] }}>
          <View style={{ flex: 1 }}>
            <TextField ref={field} value={text} onChangeText={setText} placeholder={BUILDER_SHEET_COPY.placeholder} multiline autoFocus inputAccessoryViewID={COACH_DONE_ACCESSORY_ID} style={{ maxHeight: Math.round(140 * Math.min(Math.max(fontScale, 1), 2)) }} accessibilityLabel="Message to the coach" />
          </View>
          <SendButton icon="arrow.up" label="Send message" enabled={canSend} onPress={() => void send()} />
        </View>
      </View>
      <KeyboardDoneAccessory nativeID={COACH_DONE_ACCESSORY_ID} />
    </SheetKeyboardAvoidingView>
  );
}

function TurnResult({ turn, busy, notApplied, canRetry, onRetry, onApply, onSkip, onUndo }: { turn: BuilderTurn; busy: boolean; notApplied: boolean; canRetry: boolean; onRetry: () => void; onApply: () => void; onSkip: () => void; onUndo: () => void }) {
  const theme = useTheme();
  const [whyOpen, setWhyOpen] = useState(false);
  if (turn.result.kind === 'asking')
    return (
      <AppText variant="callout" color="text.secondary" accessibilityLiveRegion="polite">
        Asking…
      </AppText>
    );
  if (turn.result.kind === 'line')
    return (
      <View style={{ flexDirection: 'row', gap: theme.space['2'], alignItems: 'center' }}>
        <Icon name="info.circle" size={16} />
        <AppText variant="callout" color="text.secondary">
          {turn.result.text}
        </AppText>
        {turn.result.retry === true ? <TextButton label={BUILDER_SHEET_COPY.retry} onPress={onRetry} disabled={!canRetry} /> : null}
      </View>
    );
  const card = turnCard(turn);
  if (card === null) return null;
  return (
    <View style={{ gap: theme.space['2'], backgroundColor: theme.colors['bg.surface'], borderRadius: theme.radius.md, padding: theme.space['3'] }}>
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <AppText variant="label" color="text.secondary" style={{ flex: 1 }}>
          Coach
        </AppText>
        {card.notes.length > 0 && !whyOpen ? <TextButton label="Why?" tone="secondary" onPress={() => { setWhyOpen(true); }} /> : null}
      </View>
      {card.lines.length > 0 ? (
        <View style={{ backgroundColor: theme.colors['bg.raised'], borderRadius: theme.radius.md, padding: theme.space['3'], gap: theme.space['1'] }}>
          {card.lines.map((l) => (
            <AppText key={l} variant="callout" numeric>
              {l}
            </AppText>
          ))}
          {card.minutes !== '' ? (
            <AppText variant="label" color="text.secondary" numeric>
              {card.minutes}
            </AppText>
          ) : null}
        </View>
      ) : null}
      {card.warnings.map((w) => (
        <StatusLine key={w} icon="exclamationmark.triangle" tone="warning" text={w} />
      ))}
      {card.reason !== null ? <AppText variant="callout">{card.reason}</AppText> : null}
      {whyOpen
        ? card.notes.map((n) => (
            <AppText key={n} variant="label" color="text.secondary">
              {n}
            </AppText>
          ))
        : null}
      {notApplied && card.actions !== null ? (
        <AppText variant="label" color="status.warning" accessibilityLiveRegion="polite">
          {BUILDER_SHEET_COPY.notApplied}
        </AppText>
      ) : null}
      {card.actions !== null ? (
        <View style={{ flexDirection: 'row', gap: theme.space['2'] }}>
          <View style={{ flex: 1 }}>
            <PrimaryButton label={card.actions.apply} onPress={onApply} busy={busy} disabled={busy} />
          </View>
          <SecondaryButton label={card.actions.skip} size="primary" onPress={onSkip} disabled={busy} />
        </View>
      ) : null}
      {card.state !== null || card.undoState !== null ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space['2'] }}>
          <AppText variant="label" color={turn.result.kind === 'proposal' && turn.result.state === 'out_of_date' ? 'status.warning' : 'text.secondary'} accessibilityLiveRegion="polite">
            {card.undoState ?? card.state}
          </AppText>
          {card.undo ? <TextButton label={BUILDER_SHEET_COPY.undo} onPress={onUndo} disabled={busy} /> : null}
        </View>
      ) : null}
    </View>
  );
}
