import { useNavigation } from '@react-navigation/native';
import { useCallback, useEffect, useRef, useState } from 'react';
import { View } from 'react-native';

import { renderActionResult, undoOpId, type CoachTurnResult } from '@fizz/coach';
import type { ActionRecord, BenInput, SessionAggregate } from '@fizz/schemas';

import type { CoachAvailability, WorkoutOffer } from '../../coach/coach-service';
import { whyView, type WhyView } from '../../coach/sheet-view';
import { ADJUST_CHIP_LABEL, adjustControlView, chipForTrigger, coachCouldNotAnswer, offerCandidates, ruleOfferOutcome, slotAfterFailure, slotAfterTurn, slotView, syncAdjustment, type SlotView } from '../../coach/slot-view';
import { newUuid } from '../../device/runtime';
import { useServices } from '../../shell/context';
import { useTheme } from '../../theme';
import { AppText, Chip, Icon, Tag, TextButton } from '../../ui';
import { WhyPanel } from '../coach/CoachCard';

/**
 * The coach in the workout (coach-adjustments §2, ADR 0020 C7): `Adjust`
 * with its chips, the trigger offer during rest, pending, the applied
 * banner from the saved record with Undo, and one-line outcomes. Nothing
 * here adds a tap to the Log loop or waits on the network; Log never waits
 * for the coach (rule 1). The sheet never opens by itself.
 */

type Offer = WorkoutOffer;

export interface WorkoutCoach {
  availability: CoachAvailability | null;
  slot: SlotView | null;
  adjustOpen: boolean;
  toggleAdjust: () => void;
  /** After a set is logged or its effort changed: the pure trigger check (no AI call). */
  afterLog: (aggregate: SessionAggregate, setId: string) => void;
  /** Rest ended or Ben moved on: an unanswered offer goes. */
  clearOffer: () => void;
  ask: (input: BenInput) => void;
  /** `Ask again` / `Try again`: the same request on the current state. */
  retry: () => void;
  cancel: () => void;
  undo: (actionId: string) => void;
  acceptOffer: () => void;
  dismissOffer: () => void;
  why: WhyView | null;
  toggleWhy: () => void;
}

export function useWorkoutCoach(sessionId: string | null, onApplied: () => void, workout: SessionAggregate | null = null): WorkoutCoach {
  const services = useServices();
  const [availability, setAvailability] = useState<CoachAvailability | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [adjustment, setAdjustment] = useState<ActionRecord | null>(null);
  const [outcome, setOutcome] = useState<{ text: string; retry: boolean } | null>(null);
  const [offer, setOffer] = useState<Offer | null>(null);
  const [adjustOpen, setAdjustOpen] = useState(false);
  const [why, setWhy] = useState<WhyView | null>(null);
  const lastAsk = useRef<BenInput | null>(null);
  /** The offer whose `Adjust` started the running turn: if the coach can't answer, the rule's offer takes its place (F3). */
  const askedOffer = useRef<Offer | null>(null);
  /** Only the latest log's offer check may set the offer. */
  const offerCheck = useRef(0);
  /** Sets logged with no rest running, checked when the next rest starts (F7). Per workout. */
  const heldSets = useRef<{ sessionId: string | null; ids: string[] }>({ sessionId: null, ids: [] });
  const appliedRef = useRef(onApplied);
  appliedRef.current = onApplied;

  useEffect(() => {
    void services.coach.availability().then(setAvailability);
  }, [services]);

  // Each time the workout reloads (focus, after a change), the banner's record is read again: an Undo
  // made in the sheet shows here as undone, not as a live Undo.
  const liveAdjustment = adjustment?.undoneBy === null ? adjustment : null;
  useEffect(() => {
    if (liveAdjustment === null) return;
    let alive = true;
    void syncAdjustment(liveAdjustment, (id) => services.coach.getAction(id)).then((fresh) => {
      // Only an Undo since changes what's shown (setting an equal record again would only re-run this).
      if (alive && fresh !== null && fresh.undoneBy !== null) setAdjustment((cur) => (cur?.actionId === fresh.actionId ? fresh : cur));
    });
    return () => {
      alive = false;
    };
  }, [services, liveAdjustment, workout]);

  const ask = useCallback(
    (input: BenInput, fromOffer: Offer | null = null) => {
      if (sessionId === null || pending !== null) return;
      const turnId = newUuid();
      lastAsk.current = input;
      askedOffer.current = fromOffer;
      setPending(turnId);
      setOffer(null);
      setOutcome(null);
      setAdjustOpen(false);
      setWhy(null);
      void (async () => {
        let result: CoachTurnResult | null = null;
        let after: ReturnType<typeof slotAfterTurn>;
        try {
          const threadId = await services.coach.resolveThread({ kind: 'workout', sessionId });
          result = await services.coach.send({ entry: { kind: 'workout', sessionId }, threadId, input, turnId });
          after = slotAfterTurn(result);
        } catch {
          // Read what this turn saved before saying "Nothing changed" (review N2).
          const threadId = await services.coach.resolveThread({ kind: 'workout', sessionId }).catch(() => null);
          const data = threadId === null ? null : await services.coach.loadThread(threadId).catch(() => null);
          after = slotAfterFailure(data?.actionsByTurn.get(turnId) ?? []);
        }
        // F3: Adjust on an offer, and the coach couldn't answer: the built-in rule's offer for the same trigger instead.
        const offered = askedOffer.current;
        askedOffer.current = null;
        const fallback = offered !== null && after.adjustment === null && coachCouldNotAnswer(result) ? await services.coach.ruleOfferFor(offered).catch(() => null) : null;
        setAdjustment(after.adjustment);
        setOutcome(fallback === null ? after.outcome : null);
        if (fallback !== null) setOffer(fallback);
        if (after.adjustment !== null) appliedRef.current();
        setPending(null);
        setAvailability(await services.coach.availability());
      })();
    },
    [services, sessionId, pending],
  );

  /** `Adjust` on the built-in rule's offer: applied at once (a local write), with Undo in the banner. */
  const applyRule = useCallback(
    (o: Offer) => {
      setOffer(null);
      setOutcome(null);
      setWhy(null);
      void services.coach
        .applyRuleOffer(o)
        .then((r) => {
          if (r.status === 'applied') {
            setAdjustment(r.record);
            appliedRef.current();
          } else setOutcome(ruleOfferOutcome(r.status));
        })
        .catch(() => {
          setOutcome(ruleOfferOutcome('failed'));
        });
    },
    [services],
  );

  const slot = slotView({ pending: pending !== null, adjustment, outcome, offer, workout });

  return {
    availability,
    slot,
    adjustOpen,
    toggleAdjust: () => {
      setAdjustOpen((o) => !o);
    },
    afterLog: (aggregate, setId) => {
      // A new log closes the row and replaces an older line (§3.2); a pending request is left to finish (its result is version-checked).
      setAdjustOpen(false);
      if (pending === null) setOutcome(null);
      if (adjustment !== null && adjustment.undoneBy === null) setAdjustment(null);
      const resting = aggregate.restTimer?.status === 'running';
      const check = ++offerCheck.current;
      setOffer(null);
      const sid = aggregate.session.id;
      const held = heldSets.current.sessionId === sid ? heldSets.current.ids : [];
      const { check: toCheck, held: nextHeld } = offerCandidates(held, setId, resting);
      heldSets.current = { sessionId: sid, ids: nextHeld };
      // Re-read the status on each log: `Offline` from an earlier failure lapses once the network is back.
      // Not reachable: the built-in rule offers instead (CA6 revised); nothing it can change, nothing shown.
      void services.coach
        .availability()
        .then(async (now) => {
          setAvailability(now);
          for (const id of toCheck) {
            const next = await services.coach.offerAfterLog({ aggregate, setId: id, resting, coachReachable: now.status === 'ok', pending: pending !== null });
            if (next !== null) return next;
          }
          return null;
        })
        .catch(() => null)
        .then((next) => {
          if (check === offerCheck.current) setOffer(next);
        });
    },
    clearOffer: () => {
      setOffer(null);
    },
    ask,
    retry: () => {
      if (lastAsk.current !== null) ask(lastAsk.current);
    },
    cancel: () => {
      if (pending !== null) services.coach.stop(pending);
    },
    undo: (actionId) => {
      // One opId per action: a double tap (or an Undo already made in the sheet) replays, never `already undone`.
      void services.coach
        .undo(actionId, undoOpId(actionId))
        .then((r) => {
          // The line is rendered from the saved undo record (what came back, what was already logged).
          setAdjustment(null);
          setWhy(null);
          setOutcome({ text: renderActionResult(r.undo, 'slot').text, retry: false });
          if (r.result.status === 'written' || r.result.status === 'replayed') appliedRef.current();
        })
        .catch(() => {
          // A store error: the banner and its Undo stay, so Ben can try again (review N1).
          setOutcome({ text: 'Couldn’t undo.', retry: false });
        });
    },
    // CA1: Adjust on an offer is Ben asking, in the trigger's direction. The rule's offer applies its own change.
    acceptOffer: () => {
      if (offer === null) return;
      if (offer.by === 'rule') applyRule(offer);
      else ask({ kind: 'chip', chip: chipForTrigger(offer.kind), sessionExerciseId: offer.sessionExerciseId }, offer);
    },
    dismissOffer: () => {
      setOffer(null);
    },
    why,
    toggleWhy: () => {
      if (why !== null || adjustment === null) setWhy(null);
      else setWhy(whyView(adjustment));
    },
  };
}

/** `Adjust` (§2.2): left of `⋯` in the exercise header. */
export function AdjustButton({ coach }: { coach: WorkoutCoach }) {
  const view = coach.availability === null ? null : adjustControlView(coach.availability);
  return <TextButton label={view?.caption ? `Adjust · ${view.caption}` : 'Adjust'} tone="secondary" onPress={coach.toggleAdjust} />;
}

/** The inline chip row under the header (no sheet). */
export function AdjustRow({ coach, sessionId, onPain }: { coach: WorkoutCoach; sessionId: string; onPain: () => void }) {
  const theme = useTheme();
  const navigation = useNavigation();
  if (!coach.adjustOpen || coach.availability === null) return null;
  const view = adjustControlView(coach.availability);
  return (
    <View style={{ gap: theme.space['2'] }}>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.space['2'] }}>
        {view.chips.map((c) => (
          <Chip
            key={c}
            label={ADJUST_CHIP_LABEL[c]}
            selected={false}
            onPress={() => {
              if (c === 'type') {
                coach.toggleAdjust();
                navigation.navigate('Coach', { entry: { kind: 'workout', sessionId }, focus: true });
              } else if (c === 'pain') {
                onPain();
                coach.toggleAdjust();
              } else coach.ask({ kind: 'chip', chip: c });
            }}
          />
        ))}
      </View>
      {view.line !== null ? (
        <AppText variant="callout" color="text.secondary">
          {view.line}
        </AppText>
      ) : null}
    </View>
  );
}

/** What the coach slot shows (one item). Values from the saved record; the reason behind `Why?`. */
export function CoachSlotContent({ coach }: { coach: WorkoutCoach }) {
  const theme = useTheme();
  const s = coach.slot;
  if (s === null) return null;
  switch (s.kind) {
    case 'pending':
      return (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space['2'] }}>
          <Icon name="ellipsis" size={18} />
          <AppText variant="callout" style={{ flex: 1 }}>
            {s.title}
          </AppText>
          <TextButton label="Cancel" tone="secondary" onPress={coach.cancel} />
        </View>
      );
    case 'banner':
      return (
        <View style={{ gap: theme.space['2'] }} accessible={false}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space['2'] }} accessible accessibilityLabel={`Saved change${s.tag === null ? '' : `, ${s.tag}`}. ${s.title}. ${s.detail ?? ''}`}>
            <Icon name="checkmark.circle.fill" color="status.done" size={18} />
            <AppText variant="headline" style={{ flex: 1 }}>
              {s.title}
            </AppText>
            {s.tag !== null ? <Tag text={s.tag} /> : null}
          </View>
          {s.detail !== null ? (
            <AppText variant="body" numeric>
              {s.detail}
            </AppText>
          ) : null}
          {s.notes.map((n) => (
            <AppText key={n} variant="callout" color="text.secondary">
              {n}
            </AppText>
          ))}
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <TextButton label={coach.why === null ? 'Why?' : 'Hide'} tone="secondary" onPress={coach.toggleWhy} />
            {s.canUndo ? (
              <TextButton
                label="Undo"
                onPress={() => {
                  coach.undo(s.actionId);
                }}
              />
            ) : null}
          </View>
          {coach.why !== null ? <WhyPanel why={coach.why} /> : null}
        </View>
      );
    case 'outcome':
      return (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space['2'] }}>
          <Icon name="info.circle" size={18} />
          <AppText variant="callout" style={{ flex: 1 }}>
            {s.text}
          </AppText>
          {s.retry ? <TextButton label="Ask again" onPress={coach.retry} /> : null}
        </View>
      );
    case 'offer':
      return (
        <View style={{ gap: theme.space['2'] }}>
          <AppText variant="callout">{s.prompt}</AppText>
          <AppText variant="callout" color="text.secondary" numeric>
            {s.fact}
          </AppText>
          {s.change !== null ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space['2'] }} accessible accessibilityLabel={`${s.tag ?? ''} ${s.change}`}>
              <AppText variant="body" numeric style={{ flex: 1 }}>
                {s.change}
              </AppText>
              {s.tag !== null ? <Tag text={s.tag} /> : null}
            </View>
          ) : null}
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <TextButton label="No thanks" tone="secondary" onPress={coach.dismissOffer} />
            <TextButton label="Adjust" onPress={coach.acceptOffer} />
          </View>
        </View>
      );
  }
}
