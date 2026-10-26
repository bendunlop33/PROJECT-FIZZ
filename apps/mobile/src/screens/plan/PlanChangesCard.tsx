import { Pressable, View } from 'react-native';

import { PB_EDIT_COPY } from '@fizz/domain';

import type { PlanEditView } from '../../services/plan-builder-service';
import { useTheme } from '../../theme';
import { AppText, Card, Chip, TextButton } from '../../ui';

/** `This week onwards` · `From week N` · `Only week N` (N: the week viewed on the strip, never before this week). */
export type PlanEditScopeKind = 'now' | 'from' | 'only';

/**
 * (Ben, 22 Oct; 26 Oct. plan-builder.md "Editing a running plan"; prototype `changesCard`) The Changes card on the plan
 * in use: each difference one line, tapped between `✓ Accept` and `✕ Reject`, `Accept all` / `Reject all`, then
 * `Apply to` this week onwards, from week N or only week N, and `2 of 5`. Draws the service's preview; nothing here
 * decides a change.
 */
export function PlanChangesCard({
  view,
  scope,
  week,
  onToggle,
  onAll,
  onScope,
}: {
  view: PlanEditView;
  scope: PlanEditScopeKind;
  /** N for `From week N` / `Only week N`. */
  week: number;
  onToggle: (id: string) => void;
  onAll: (accept: boolean) => void;
  onScope: (kind: PlanEditScopeKind) => void;
}) {
  const theme = useTheme();
  const has = view.items.length > 0;
  return (
    <Card style={{ gap: theme.space['2'] }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: theme.space['2'] }}>
        <AppText variant="headline" accessibilityRole="header">
          {PB_EDIT_COPY.changes}
        </AppText>
        {has ? (
          <View style={{ flexDirection: 'row', columnGap: theme.space['3'] }}>
            <TextButton label={PB_EDIT_COPY.acceptAll} onPress={() => { onAll(true); }} />
            <TextButton label={PB_EDIT_COPY.rejectAll} tone="secondary" onPress={() => { onAll(false); }} />
          </View>
        ) : (
          <AppText variant="callout" color="text.secondary">
            {PB_EDIT_COPY.none}
          </AppText>
        )}
      </View>
      {view.items.map((it) => (
        <Pressable
          key={it.id}
          accessibilityRole="switch"
          accessibilityState={{ checked: it.accepted }}
          accessibilityLabel={`${it.text}, ${it.accepted ? 'accepted' : 'rejected'}`}
          onPress={() => { onToggle(it.id); }}
          style={({ pressed }) => ({ minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: theme.space['2'], opacity: pressed ? 0.7 : 1 })}
        >
          <AppText variant="callout" numeric color={it.accepted ? 'text.primary' : 'text.tertiary'} style={{ flex: 1, ...(it.accepted ? {} : { textDecorationLine: 'line-through' }) }}>
            {it.text}
          </AppText>
          <AppText variant="callout" color={it.accepted ? 'status.done' : 'text.tertiary'}>
            {it.accepted ? PB_EDIT_COPY.accept : PB_EDIT_COPY.reject}
          </AppText>
        </Pressable>
      ))}
      {has ? (
        <View style={{ gap: theme.space['2'], paddingTop: theme.space['2'], borderTopWidth: theme.dividerWidth, borderTopColor: theme.colors['border.divider'] }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' }}>
            <AppText variant="sectionLabel" color="text.secondary">
              {PB_EDIT_COPY.applyTo}
            </AppText>
            <AppText variant="label" color="text.tertiary" numeric>
              {view.counted}
            </AppText>
          </View>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.space['2'] }}>
            <Chip size="min" label={PB_EDIT_COPY.thisWeekOn} selected={scope === 'now'} onPress={() => { onScope('now'); }} />
            <Chip size="min" label={PB_EDIT_COPY.fromWeek(week)} selected={scope === 'from'} onPress={() => { onScope('from'); }} />
            <Chip size="min" label={PB_EDIT_COPY.onlyWeek(week)} selected={scope === 'only'} onPress={() => { onScope('only'); }} />
          </View>
        </View>
      ) : null}
    </Card>
  );
}
