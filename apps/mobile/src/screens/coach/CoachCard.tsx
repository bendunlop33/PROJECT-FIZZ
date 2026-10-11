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
export function CoachCard({ card, onUndo }: { card: CardView; onUndo: (actionId: string) => void }) {
  const theme = useTheme();
  const services = useServices();
  const [why, setWhy] = useState<WhyView | null>(null);
  const toneColor = card.status.word === 'Applied' || card.status.word === 'Saved' ? 'status.done' : card.status.word === 'Out of date' || card.status.word === 'Couldn’t apply' ? 'status.warning' : 'text.secondary';
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
      <AppText variant="callout" numeric>
        {card.text}
      </AppText>
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
      </View>
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
