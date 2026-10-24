import { useState } from 'react';
import { View } from 'react-native';

import type { CardView, WhyView } from '../../coach/sheet-view';
import { whyView } from '../../coach/sheet-view';
import { useServices } from '../../shell/context';
import { useTheme } from '../../theme';
import { AppText, Icon, SecondaryButton, TextButton } from '../../ui';
import { CardActions, CoachCardFrame } from './CoachCardFrame';

/**
 * An action card (coach-sheet §2.6): status icon and word, the line from the
 * saved record, `Why?` (the coach's reason in quotes, the rest from the
 * record) and `Undo`. Never the model's words as a change.
 */
export function CoachCard({
  card,
  onUndo,
  onProposal,
  onMemory,
  onNewExercise,
  onGymChange,
}: {
  card: CardView;
  /** (20 Oct, ADR 0029) The coach's gym suggestion: Apply saves exactly what the card shows; Not now closes it. */
  onGymChange?: (proposalId: string, tap: 'apply' | 'not_now') => void;
  /** (19 Oct) The coach's new-exercise card: Add (saved only now, rule 3) or Edit (the form, prefilled). */
  onNewExercise?: (actionId: string, tap: 'add' | 'edit') => void;
  onUndo: (actionId: string) => void;
  onProposal?: (proposalId: string, tap: 'apply' | 'not_now') => void;
  onMemory?: (memoryId: string, version: number, decision: 'save' | 'not_now' | 'playbook') => void;
}) {
  const theme = useTheme();
  const services = useServices();
  const [why, setWhy] = useState<WhyView | null>(null);
  // Apply is disabled for a second after a tap (coach-sheet §4: no double apply; the write is idempotent anyway).
  const [busy, setBusy] = useState(false);
  const p = card.proposal;
  const toneColor = card.status.word === 'Applied' || card.status.word === 'Saved' || card.status.word === 'Logged' ? 'status.done' : card.status.word === 'Out of date' || card.status.word === 'Couldn’t apply' || card.status.word === 'Couldn’t apply here' ? 'status.warning' : 'text.secondary';
  return (
    <CoachCardFrame>
      {/* The status word and the card's line are one VoiceOver element, read once (design pass nit). */}
      <View accessible accessibilityLabel={`${card.accessibilityPrefix} ${card.status.word}. ${p === undefined ? card.text : p.title}`} style={{ gap: theme.space['2'] }}>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: theme.space['2'] }}>
          <Icon name={card.status.icon} color={toneColor} size={18} />
          <AppText variant="label" color="text.secondary" style={{ flexGrow: 1, flexShrink: 1 }}>
            {card.status.word}
          </AppText>
        </View>
        {p === undefined ? (
          <AppText variant="callout" numeric>
            {card.text}
          </AppText>
        ) : null}
      </View>
      {p === undefined ? null : (
        <View style={{ gap: theme.space['1'] }}>
          <AppText variant="headline">{p.title}</AppText>
          {p.lines.map((l) => (
            <AppText key={l} variant="callout">
              {l}
            </AppText>
          ))}
          <AppText variant="callout" color="text.secondary">{`Before: ${p.before}`}</AppText>
          <AppText variant="callout" color="text.secondary">{`After: ${p.after}`}</AppText>
        </View>
      )}
      <CardActions>
        <TextButton
          label={why === null ? 'Why?' : 'Hide'}
          tone="secondary"
          onPress={() => {
            if (why !== null) {
              setWhy(null);
              return;
            }
            void services.coach.getAction(card.actionId).then((r) => {
              if (r !== null) setWhy(whyView(r));
            });
          }}
        />
        {card.canUndo ? (
          <TextButton
            label="Undo"
            onPress={() => {
              onUndo(card.actionId);
            }}
          />
        ) : null}
        {p?.canApply === true && onProposal !== undefined ? (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: theme.space['3'], rowGap: theme.space['1'] }}>
            <TextButton
              label="Not now"
              tone="secondary"
              onPress={() => {
                onProposal(p.proposalId, 'not_now');
              }}
            />
            <SecondaryButton
              label="Apply"
              disabled={busy}
              onPress={() => {
                setBusy(true);
                setTimeout(() => {
                  setBusy(false);
                }, 1000);
                onProposal(p.proposalId, 'apply');
              }}
            />
          </View>
        ) : null}
        {card.gymChange?.undoActionId != null ? (
          <TextButton
            label="Undo"
            onPress={() => {
              if (card.gymChange?.undoActionId != null) onUndo(card.gymChange.undoActionId);
            }}
          />
        ) : null}
        {card.gymChange?.canApply === true && onGymChange !== undefined ? (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: theme.space['3'], rowGap: theme.space['1'] }}>
            <TextButton
              label="Not now"
              tone="secondary"
              onPress={() => {
                if (card.gymChange) onGymChange(card.gymChange.proposalId, 'not_now');
              }}
            />
            <SecondaryButton
              label="Apply"
              disabled={busy}
              onPress={() => {
                setBusy(true);
                setTimeout(() => {
                  setBusy(false);
                }, 1000);
                if (card.gymChange) onGymChange(card.gymChange.proposalId, 'apply');
              }}
            />
          </View>
        ) : null}
        {card.newExercise?.canAdd === true && onNewExercise !== undefined ? (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: theme.space['3'], rowGap: theme.space['1'] }}>
            <TextButton
              label="Edit"
              tone="secondary"
              onPress={() => {
                onNewExercise(card.actionId, 'edit');
              }}
            />
            <SecondaryButton
              label="Add"
              disabled={busy}
              onPress={() => {
                setBusy(true);
                setTimeout(() => {
                  setBusy(false);
                }, 1000);
                onNewExercise(card.actionId, 'add');
              }}
            />
          </View>
        ) : null}
        {card.memoryChoice !== undefined && !card.memoryChoice.split && onMemory !== undefined ? (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: theme.space['3'], rowGap: theme.space['1'] }}>
            <TextButton
              label="Not now"
              tone="secondary"
              onPress={() => {
                if (card.memoryChoice) onMemory(card.memoryChoice.memoryId, card.memoryChoice.version, 'not_now');
              }}
            />
            <SecondaryButton
              label="Save"
              disabled={busy}
              onPress={() => {
                setBusy(true);
                setTimeout(() => {
                  setBusy(false);
                }, 1000);
                if (card.memoryChoice) onMemory(card.memoryChoice.memoryId, card.memoryChoice.version, 'save');
              }}
            />
          </View>
        ) : null}
        {p?.undoActionId != null ? (
          <TextButton
            label="Undo"
            onPress={() => {
              if (p.undoActionId !== null) onUndo(p.undoActionId);
            }}
          />
        ) : null}
      </CardActions>
      {card.memoryChoice?.split === true && onMemory !== undefined ? (
        <View style={{ gap: theme.space['1'], alignItems: 'flex-start' }}>
          {(
            [
              ['Save as a memory about me', 'save'],
              ['Add to playbook', 'playbook'],
              ['Not now', 'not_now'],
            ] as const
          ).map(([label, decision]) => (
            <TextButton
              key={decision}
              label={label}
              tone={decision === 'not_now' ? 'secondary' : 'accent'}
              disabled={busy && decision !== 'not_now'}
              onPress={() => {
                if (decision !== 'not_now') {
                  setBusy(true);
                  setTimeout(() => {
                    setBusy(false);
                  }, 1000);
                }
                if (card.memoryChoice) onMemory(card.memoryChoice.memoryId, card.memoryChoice.version, decision);
              }}
            />
          ))}
        </View>
      ) : null}
      {why !== null ? <WhyPanel why={why} /> : null}
    </CoachCardFrame>
  );
}

export function WhyPanel({ why }: { why: WhyView }) {
  const theme = useTheme();
  const section = (title: string, lines: readonly string[]) =>
    lines.length === 0 ? null : (
      <View style={{ gap: theme.space['1'] }}>
        <AppText variant="label" color="text.tertiary">
          {title}
        </AppText>
        {lines.map((l) => (
          <AppText key={l} variant="callout" color="text.secondary">
            {l}
          </AppText>
        ))}
      </View>
    );
  return (
    <View style={{ gap: theme.space['3'] }}>
      <AppText variant="headline">{why.heading}</AppText>
      {why.reason !== null ? section('Coach’s reason', [why.reason]) : null}
      {section('Checks', why.checks)}
      {section('Not changed', why.notChanged)}
      {section('Not known', why.notKnown)}
    </View>
  );
}
