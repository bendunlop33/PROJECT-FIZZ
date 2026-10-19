import { useState } from 'react';
import { View } from 'react-native';

import type { CardView, WhyView } from '../../coach/sheet-view';
import { whyView } from '../../coach/sheet-view';
import { useServices } from '../../shell/context';
import { useTheme } from '../../theme';
import { AppText, Icon, TextButton } from '../../ui';

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
}: {
  card: CardView;
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
    <View
      style={{ backgroundColor: theme.colors['bg.surface'], borderRadius: theme.radius.md, borderWidth: theme.components.cardBorderWidth, borderColor: theme.colors['border.control'], padding: theme.space['3'], gap: theme.space['2'] }}
      accessible={false}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space['2'] }} accessible accessibilityLabel={`${card.accessibilityPrefix} ${card.status.word}. ${card.text}`}>
        <Icon name={card.status.icon} color={toneColor} size={18} />
        <AppText variant="label" color="text.secondary">
          {card.status.word}
        </AppText>
      </View>
      {p === undefined ? (
        <AppText variant="callout" numeric>
          {card.text}
        </AppText>
      ) : (
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
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
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
          <View style={{ flexDirection: 'row', gap: theme.space['3'] }}>
            <TextButton
              label="Not now"
              tone="secondary"
              onPress={() => {
                onProposal(p.proposalId, 'not_now');
              }}
            />
            <TextButton
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
        {card.newExercise?.canAdd === true && onNewExercise !== undefined ? (
          <View style={{ flexDirection: 'row', gap: theme.space['3'] }}>
            <TextButton
              label="Edit"
              tone="secondary"
              onPress={() => {
                onNewExercise(card.actionId, 'edit');
              }}
            />
            <TextButton
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
          <View style={{ flexDirection: 'row', gap: theme.space['3'] }}>
            <TextButton
              label="Not now"
              tone="secondary"
              onPress={() => {
                if (card.memoryChoice) onMemory(card.memoryChoice.memoryId, card.memoryChoice.version, 'not_now');
              }}
            />
            <TextButton
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
      </View>
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
    </View>
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
