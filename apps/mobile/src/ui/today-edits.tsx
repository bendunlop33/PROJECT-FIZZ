import { Pressable, View } from 'react-native';

import type { SubstituteRow as SubstituteRowData } from '@fizz/domain';

import { useTheme } from '../theme';
import { TODAY_EDITS_COPY, type ReorderUnit } from '../workout/overview-edits';
import { Icon } from './Icon';
import { OutlinePill } from './overview';
import { AppText } from './Text';

/**
 * Today's edits on the Workout overview (overview-today-edits.md §2;
 * design-system §9.11, §9.66–9.68): `ReorderRow`, `SubstituteRow` (target
 * variant) and the inline Ben-authored `ChangeReviewCard`. Direction D
 * tokens only; no new colours. They show what they're given and compute
 * nothing. `Start workout` stays the page's only filled pill: Apply is an
 * outline pill in the accent's text colour.
 */

/** A 44 × 44 icon button (Reorder's `↑` / `↓`); disabled at the ends. */
function MoveButton({ up, disabled, label, onPress }: { up: boolean; disabled: boolean; label: string; onPress: () => void }) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => ({
        width: 44,
        height: 44,
        borderRadius: theme.radius.pill,
        borderWidth: 1,
        borderColor: theme.colors['border.control'],
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: pressed ? theme.colors['bg.raised'] : 'transparent',
        opacity: disabled ? 0.35 : 1,
      })}
    >
      <Icon name={up ? 'chevron.up' : 'chevron.down'} color="text.primary" size={16} weight="semibold" />
    </Pressable>
  );
}

/**
 * Reorder mode's row (§2.3): index, name (a superset's members stacked
 * beside a bracket; `· skipped` in `text.tertiary`), then `↑` `↓`. At AX
 * sizes the buttons go under the name. No drag, no animation.
 */
export function ReorderRow({ unit, stacked, onUp, onDown }: { unit: ReorderUnit; stacked: boolean; onUp: () => void; onDown: () => void }) {
  const theme = useTheme();
  const buttons = (
    <View style={{ flexDirection: 'row', gap: theme.space['2'] }}>
      <MoveButton up disabled={!unit.up} label={unit.upLabel} onPress={onUp} />
      <MoveButton up={false} disabled={!unit.down} label={unit.downLabel} onPress={onDown} />
    </View>
  );
  return (
    <View style={{ borderTopWidth: theme.dividerWidth, borderColor: theme.colors['border.divider'], paddingVertical: theme.space['2'], flexDirection: stacked ? 'column' : 'row', alignItems: stacked ? 'flex-start' : 'center', gap: theme.space['2'] }}>
      <View style={{ flex: stacked ? undefined : 1, flexDirection: 'row', gap: 6 }}>
        <View style={{ minWidth: 30 }}>
          <AppText numeric color="text.tertiary" style={{ fontSize: 16, lineHeight: 22, fontWeight: '500', fontVariant: ['tabular-nums'] }}>
            {unit.indexText}
          </AppText>
        </View>
        <View style={{ flex: 1, flexDirection: 'row', gap: theme.space['2'] }}>
          {unit.superset ? <View accessible={false} importantForAccessibility="no" style={{ width: 3, borderRadius: 2, backgroundColor: theme.colors['text.tertiary'] }} /> : null}
          <View style={{ flex: 1, gap: 2 }}>
            {unit.names.map((n, i) => (
              <AppText key={`${n}:${String(i)}`} variant="headline" color={unit.skipped[i] === true ? 'text.tertiary' : 'text.primary'}>
                {unit.skipped[i] === true ? `${n} ${TODAY_EDITS_COPY.skippedSuffix}` : n}
              </AppText>
            ))}
          </View>
        </View>
      </View>
      {buttons}
    </View>
  );
}

/**
 * A Swap sheet row (§2.4, design-system §9.68): ≥ 64 pt, the whole row one
 * button. Name (`· planned` on `Swap again`), `⚠ May hurt` when flagged;
 * equipment · `last …` (an actual) or `No history`; the target it will get.
 */
export function SubstituteRowView({ row, stacked, onPress }: { row: SubstituteRowData; stacked: boolean; onPress: () => void }) {
  const theme = useTheme();
  const target = (
    <AppText variant="body" numeric color={row.targetText.startsWith('—') ? 'text.secondary' : 'text.primary'} style={{ fontVariant: ['tabular-nums'] }}>
      {row.targetText}
    </AppText>
  );
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={row.accessibilityLabel}
      onPress={onPress}
      style={({ pressed }) => ({ minHeight: 64, paddingVertical: theme.space['2'] + 2, borderTopWidth: theme.dividerWidth, borderColor: theme.colors['border.divider'], backgroundColor: pressed ? theme.colors['bg.raised'] : 'transparent', flexDirection: 'row', gap: theme.space['3'] })}
    >
      <View style={{ flex: 1, gap: 3 }}>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: theme.space['2'] }}>
          <AppText variant="headline">{row.planned ? `${row.name} · ${TODAY_EDITS_COPY.planned}` : row.name}</AppText>
          {row.mayHurt !== null ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              <Icon name="exclamationmark.triangle" color="status.warning" size={13} />
              <AppText variant="label" color="status.warning">
                {TODAY_EDITS_COPY.mayHurt}
              </AppText>
            </View>
          ) : null}
        </View>
        <AppText variant="callout" color="text.secondary" numeric>{`${row.equipmentWord} · ${row.lastText}`}</AppText>
        {stacked ? target : null}
      </View>
      {stacked ? null : <View style={{ justifyContent: 'flex-end' }}>{target}</View>}
    </Pressable>
  );
}

/**
 * The inline change-review card (§2.5, design-system §9.11): Ben-authored,
 * scope `Push A from now on`, one `Changed` line before → after, then
 * `Not now` and `Apply`. Applied: `✓ Applied · Push A from now on` + Undo.
 * Out of date: the lines in `text.secondary` under `Was suggested:`, Apply
 * hidden, `Dismiss` shown (CR4).
 */
export function ChangeReviewCard({
  state,
  routineName,
  fromName,
  toName,
  busy,
  onApply,
  onNotNow,
  onUndo,
  onDismiss,
}: {
  state: 'ready' | 'applied' | 'out_of_date';
  routineName: string;
  fromName: string;
  toName: string;
  busy: boolean;
  onApply: () => void;
  onNotNow: () => void;
  onUndo: () => void;
  onDismiss: () => void;
}) {
  const theme = useTheme();
  if (state === 'applied') {
    return (
      <View accessible accessibilityLabel={TODAY_EDITS_COPY.applied(routineName).replace('✓ ', '')} style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', rowGap: theme.space['2'] }}>
        <AppText variant="callout">{TODAY_EDITS_COPY.applied(routineName)}</AppText>
        <OutlinePill label={TODAY_EDITS_COPY.undo} onPress={onUndo} accessibilityLabel={`Undo the change to ${routineName}`} />
      </View>
    );
  }
  const stale = state === 'out_of_date';
  const lineColor = stale ? 'text.secondary' : 'text.primary';
  return (
    <View style={{ borderRadius: theme.radius.md, borderWidth: 1, borderColor: theme.colors['border.control'], padding: theme.space['3'], gap: theme.space['2'] }}>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: theme.space['2'] }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: theme.colors['bg.raised'], borderRadius: theme.radius.sm, paddingVertical: theme.space['1'], paddingHorizontal: theme.space['2'] }}>
          <Icon name="person" color="text.secondary" size={12} />
          <AppText variant="label" color="text.secondary">
            Ben
          </AppText>
        </View>
        <AppText variant="headline" accessibilityRole="header">
          {TODAY_EDITS_COPY.changeTitle(routineName)}
        </AppText>
      </View>
      <View style={{ alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: theme.colors['bg.raised'], borderWidth: 1, borderColor: theme.colors['border.control'], borderRadius: theme.radius.sm, paddingVertical: theme.space['1'], paddingHorizontal: theme.space['2'] }}>
        <Icon name="calendar" color="text.primary" size={12} />
        <AppText variant="label">{TODAY_EDITS_COPY.scope(routineName)}</AppText>
      </View>
      {stale ? (
        <AppText variant="callout" color="text.secondary">
          {TODAY_EDITS_COPY.wasSuggested}
        </AppText>
      ) : null}
      <View accessible accessibilityLabel={`${TODAY_EDITS_COPY.changed}: ${fromName} to ${toName}`} style={{ flexDirection: 'row', gap: theme.space['2'] }}>
        <Icon name="pencil" color={lineColor} size={13} />
        <View style={{ flex: 1 }}>
          <AppText variant="label" color={lineColor}>
            {TODAY_EDITS_COPY.changed}
          </AppText>
          <AppText variant="callout" color={lineColor}>{`${fromName} → ${toName}`}</AppText>
        </View>
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', gap: theme.space['2'] }}>
        {stale ? (
          <OutlinePill label={TODAY_EDITS_COPY.dismiss} onPress={onDismiss} />
        ) : (
          <>
            <OutlinePill label={TODAY_EDITS_COPY.notNow} onPress={onNotNow} />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Apply: change ${routineName} from now on`}
              accessibilityState={{ disabled: busy }}
              disabled={busy}
              onPress={onApply}
              style={({ pressed }) => ({
                minHeight: theme.target.min.height,
                paddingHorizontal: theme.space['4'],
                borderRadius: theme.radius.pill,
                borderWidth: 1,
                borderColor: theme.colors.accent,
                backgroundColor: pressed ? theme.colors['accent.subtle'] : 'transparent',
                justifyContent: 'center',
              })}
            >
              <AppText variant="label" color="accent">
                {TODAY_EDITS_COPY.apply}
              </AppText>
            </Pressable>
          </>
        )}
      </View>
    </View>
  );
}

/** `Change Push A too ›`: a text link at the end of a swapped row's panel (routine basis only). */
export function ChangeRoutineLink({ routineName, onPress }: { routineName: string; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`Change ${routineName} too`} onPress={onPress} hitSlop={8} style={{ minHeight: 44, justifyContent: 'center', alignSelf: 'flex-start' }}>
      <AppText variant="callout" color="text.primary">
        {TODAY_EDITS_COPY.changeLink(routineName)}
      </AppText>
    </Pressable>
  );
}
