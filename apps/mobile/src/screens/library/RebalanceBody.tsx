import { useState } from 'react';
import { Pressable, View } from 'react-native';

import { PB_EDIT_COPY } from '@fizz/domain';

import type { RebalanceCardData } from '../../services/plan-muscles-service';
import { useTheme } from '../../theme';
import { AppText } from '../../ui';

/**
 * (Ben, 1–2 Nov) Rebalance's body: each change a line (tap to skip), the bars and day lengths before → after, Why?.
 * Plan › Muscles and the coach's card draw the same body from the same `RebalanceCardData`, so they never disagree.
 * `onToggle` null: the lines are read-only (applied, undone or out of date).
 */
export function RebalanceBody({ card: c, onToggle }: { card: RebalanceCardData; onToggle: ((id: string) => void) | null }) {
  const theme = useTheme();
  const [why, setWhy] = useState(false);
  return (
    <>
      {c.empty ? (
        <AppText variant="callout" color="text.secondary">
          Nothing fits within your days’ time.
        </AppText>
      ) : null}
      {c.lines.map((l) => (
        <Pressable
          key={l.id}
          disabled={onToggle === null}
          accessibilityRole="switch"
          accessibilityState={{ checked: l.accepted, disabled: onToggle === null }}
          accessibilityLabel={`${l.text}, ${l.accepted ? 'accepted' : 'skipped'}`}
          onPress={() => {
            onToggle?.(l.id);
          }}
          style={({ pressed }) => ({ minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: theme.space['2'], opacity: pressed ? 0.7 : 1 })}
        >
          <AppText variant="callout" numeric color={l.accepted ? 'text.primary' : 'text.tertiary'} style={{ flex: 1, ...(l.accepted ? {} : { textDecorationLine: 'line-through' }) }}>
            {l.text}
          </AppText>
          {onToggle === null ? null : (
            <AppText variant="callout" color={l.accepted ? 'status.done' : 'text.tertiary'}>
              {l.accepted ? PB_EDIT_COPY.accept : PB_EDIT_COPY.reject}
            </AppText>
          )}
        </Pressable>
      ))}
      {c.bars.length > 0 ? (
        <View style={{ gap: theme.space['1'], paddingTop: theme.space['2'], borderTopWidth: theme.dividerWidth, borderTopColor: theme.colors['border.divider'] }}>
          {c.bars.map((b) => (
            <AppText key={b.group} variant="callout" numeric color={b.statusAfter === 'in' ? 'status.done' : 'status.warning'}>
              {b.text}
            </AppText>
          ))}
        </View>
      ) : null}
      {c.minutes.length > 0 ? (
        <View style={{ gap: theme.space['1'] }}>
          {c.minutes.map((m) => (
            <AppText key={m.dayIndex} variant="callout" numeric color={m.over ? 'status.warning' : 'text.secondary'}>
              {m.text}
            </AppText>
          ))}
        </View>
      ) : null}
      <Pressable accessibilityRole="button" accessibilityLabel="Why? Rebalance" accessibilityState={{ expanded: why }} onPress={() => { setWhy((w) => !w); }} style={{ minHeight: 44, justifyContent: 'center', alignSelf: 'flex-start' }}>
        <AppText variant="callout" color="text.secondary" style={{ textDecorationLine: 'underline' }}>
          Why?
        </AppText>
      </Pressable>
      {why
        ? c.why.map((l) => (
            <AppText key={l} variant="callout" color="text.secondary" numeric>
              {l}
            </AppText>
          ))
        : null}
    </>
  );
}
