import { useNavigation } from '@react-navigation/native';
import { useCallback, useEffect, useRef, useState } from 'react';
import { View } from 'react-native';

import { renderActionResult } from '@fizz/coach';
import type { CoachTrigger } from '@fizz/domain';
import type { ActionRecord, BenInput, SessionAggregate } from '@fizz/schemas';

import type { CoachAvailability } from '../../coach/coach-service';
import { whyView, type WhyView } from '../../coach/sheet-view';
import { ADJUST_CHIP_LABEL, adjustControlView, chipForTrigger, slotAfterTurn, slotView, type SlotView } from '../../coach/slot-view';
import { newUuid } from '../../device/runtime';
import { useServices } from '../../shell/context';
import { useTheme } from '../../theme';
import { AppText, Chip, Icon, TextButton } from '../../ui';
import { WhyPanel } from '../coach/CoachCard';

/**
 * The coach in the workout (coach-adjustments §2, ADR 0019 C7): `Adjust`
 * with its chips, the trigger offer during rest, pending, the applied
 * banner from the saved record with Undo, and one-line outcomes. Nothing
 * here adds a tap to the Log loop or waits on the network; Log never waits
 * for the coach (rule 1). The sheet never opens by itself.
 */

type Offer = CoachTrigger & { sessionExerciseId: string };

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

export function useWorkoutCoach(sessionId: string | null, onApplied: () => void): WorkoutCoach {
  const services = useServices();
  const [availability, setAvailability] = useState<CoachAvailability | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [adjustment, setAdjustment] = useState<ActionRecord | null>(null);
  const [outcome, setOutcome] = useState<{ text: string; retry: boolean } | null>(null);
  const [offer, setOffer] = useState<Offer | null>(null);
  const [adjustOpen, setAdjustOpen] = useState(false);
  const [why, setWhy] = useState<WhyView | null>(null);
  const lastAsk = useRef<BenInput | null>(null);
  const appliedRef = useRef(onApplied);
  appliedRef.current = onApplied;

  useEffect(() => {
    void services.coach.availability().then(setAvailability);
  }, [services]);

  const ask = useCallback(
    (input: BenInput) => {
      if (sessionId === null || pending !== null) return;
      const turnId = newUuid();
      lastAsk.current = input;
      setPending(turnId);
      setOffer(null);
      setOutcome(null);
      setAdjustOpen(false);
      setWhy(null);
      void (async () => {
        try {
          const threadId = await services.coach.resolveThread({ kind: 'workout', sessionId });
          const r = await services.coach.send({ entry: { kind: 'workout', sessionId }, threadId, input, turnId });
          const after = slotAfterTurn(r);
          setAdjustment(after.adjustment);
          setOutcome(after.outcome);
          if (after.adjustment !== null) appliedRef.current();
        } catch {
          setOutcome({ text: 'Couldn’t reach the coach. Nothing changed.', retry: true });
        } finally {
          setPending(null);
          setAvailability(await services.coach.availability());
        }
      })();
    },
    [services, sessionId, pending],
  );

  const slot = slotView({ pending: pending !== null, adjustment, outcome, offer });

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
      const next = services.coach.offerAfterLog({ aggregate, setId, resting, coachReachable: availability?.status === 'ok', pending: pending !== null });
      setOffer(next);
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
      void services.coach.undo(actionId, `undo:${actionId}:${newUuid()}`).then((r) => {
        // The line is rendered from the saved undo record (what came back, what was already logged).
        setAdjustment(null);
        setWhy(null);
        setOutcome({ text: renderActionResult(r.undo, 'slot').text, retry: false });
        if (r.result.status === 'written' || r.result.status === 'replayed') appliedRef.current();
      });
    },
    // CA1: Adjust on an offer is Ben asking, in the trigger's direction.
    acceptOffer: () => {
      if (offer !== null) ask({ kind: 'chip', chip: chipForTrigger(offer.kind) });
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
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space['2'] }} accessible accessibilityLabel={`Saved change. ${s.title}. ${s.detail ?? ''}`}>
            <Icon name="checkmark.circle.fill" color="status.done" size={18} />
            <AppText variant="headline" style={{ flex: 1 }}>
              {s.title}
            </AppText>
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
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <TextButton label="No thanks" tone="secondary" onPress={coach.dismissOffer} />
            <TextButton label="Adjust" onPress={coach.acceptOffer} />
          </View>
        </View>
      );
  }
}
