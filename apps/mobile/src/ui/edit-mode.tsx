import { Pressable, View, type AccessibilityActionEvent } from 'react-native';

import type { OverviewRow as OverviewRowData, TemplateLine } from '@fizz/domain';

import { useTheme } from '../theme';
import { EDIT_MODE_COPY, editRowPills, type EditRowAction, type EditRowPillKey, type ReorderUnit } from '../workout/overview-edits';
import { Icon } from './Icon';
import { ChangeMarker, OutlinePill } from './overview';
import { AppText } from './Text';

/**
 * Edit mode on the Workout overview (overview-today-edits §11.3, §11.5;
 * mockup frame 3): `EditRow` (index, name, marker, `↑` `↓`; the set-count
 * stepper and reps; the target load and pills) and the multi-line Ben
 * `UpdateCard`. Direction D tokens only, no new colours, no animation
 * (nothing to reduce for Reduce Motion). They show what the domain gave them
 * and compute nothing. Every control is ≥ 44 pt; markers carry icon + word;
 * numbers are tabular. At AX sizes (`stacked`) the row stacks: name;
 * stepper and reps; load; pills; `↑` `↓` on their own line.
 */

function CircleButton({ glyph, label, disabled, onPress }: { glyph: 'minus' | 'plus' | 'chevron.up' | 'chevron.down'; label: string; disabled: boolean; onPress: () => void }) {
  const theme = useTheme();
  const round = glyph === 'minus' || glyph === 'plus';
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
        borderRadius: round ? theme.radius.pill : 12,
        borderWidth: 1,
        borderColor: theme.colors['border.control'],
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: pressed ? theme.colors['bg.raised'] : 'transparent',
        opacity: disabled ? 0.35 : 1,
      })}
    >
      <Icon name={glyph} color="text.primary" size={16} weight="semibold" />
    </Pressable>
  );
}

/** A value that opens its sheet: `6–8 reps ›`, `100 kg ›`. Tabular, 44 pt. */
function ValueButton({ text, big, label, onPress, disabled = false }: { text: string; big: boolean; label: string; onPress: () => void; disabled?: boolean }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled }} disabled={disabled} onPress={onPress} hitSlop={4} style={({ pressed }) => ({ minHeight: 44, justifyContent: 'center', opacity: pressed ? 0.6 : 1 })}>
      <AppText variant={big ? 'headline' : 'body'} numeric style={big ? { fontSize: 22, lineHeight: 26, fontWeight: '500' } : undefined}>
        {disabled ? text : `${text} ›`}
      </AppText>
    </Pressable>
  );
}

export interface EditRowProps {
  row: OverviewRowData;
  /** `↑` `↓` on this row (a single row, or a superset's first member); null on other members. */
  moves: ReorderUnit | null;
  stacked: boolean;
  last: boolean;
  customActions: readonly EditRowAction[];
  onSets: (step: NonNullable<OverviewRowData['editRow']['setsUp']>) => void;
  onReps: () => void;
  onLoad: () => void;
  onPill: (key: EditRowPillKey) => void;
  onMove: (how: 'up' | 'down') => void;
  onCustomAction: (name: EditRowAction['name']) => void;
}

/** `EditRow` (§11.3). A skipped row shows its name in `text.tertiary` and `Bring back` only. */
export function EditRow({ row, moves, stacked, last, customActions, onSets, onReps, onLoad, onPill, onMove, onCustomAction }: EditRowProps) {
  const theme = useTheme();
  const e = row.editRow;
  const skipped = row.edit?.kind === 'skipped';
  const marker = row.marker.kind === 'added' || row.marker.kind === 'edited' || row.marker.kind === 'skipped' || row.marker.kind === 'swapped' || row.marker.kind === 'held' || row.marker.kind === 'no_load' ? row.marker : null;
  const pills = editRowPills(row);
  const moveButtons =
    moves === null ? null : (
      <View style={{ flexDirection: 'row', gap: theme.space['2'] }}>
        <CircleButton glyph="chevron.up" label={moves.upLabel} disabled={!moves.up} onPress={() => { onMove('up'); }} />
        <CircleButton glyph="chevron.down" label={moves.downLabel} disabled={!moves.down} onPress={() => { onMove('down'); }} />
      </View>
    );
  const onAction = (ev: AccessibilityActionEvent) => {
    const hit = customActions.find((a) => a.name === ev.nativeEvent.actionName);
    if (hit) onCustomAction(hit.name);
  };
  const header = (
    <View
      accessible
      accessibilityLabel={skipped ? row.accessibilityLabel : e.accessibilityLabel}
      accessibilityActions={customActions.map((a) => ({ name: a.name, label: a.label }))}
      onAccessibilityAction={onAction}
      style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', columnGap: theme.space['2'], minHeight: 44, flex: 1 }}
    >
      <AppText variant="body" color="text.tertiary" numeric style={{ width: 26 }}>
        {row.indexText}
      </AppText>
      <AppText variant="headline" color={skipped ? 'text.tertiary' : 'text.primary'} style={{ flexShrink: 1 }}>
        {row.name}
      </AppText>
      {marker ? <ChangeMarker marker={marker} /> : null}
    </View>
  );
  const sets = skipped ? null : (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space['2'] }}>
      <CircleButton glyph="minus" label={`Remove set: ${row.name}`} disabled={e.setsDown === null} onPress={() => { if (e.setsDown) onSets(e.setsDown); }} />
      <AppText variant="body" numeric style={{ minWidth: 56, textAlign: 'center' }} accessibilityElementsHidden importantForAccessibility="no">
        {e.setsText}
      </AppText>
      <CircleButton glyph="plus" label={`Add set: ${row.name}`} disabled={e.setsUp === null} onPress={() => { if (e.setsUp) onSets(e.setsUp); }} />
    </View>
  );
  const reps = skipped ? null : <ValueButton text={e.repsText} big={false} label={`Change reps: ${row.name}, ${e.repsText.replace('–', ' to ')}`} onPress={onReps} />;
  const load = skipped ? null : e.keypad === null ? (
    <AppText variant="headline" numeric style={{ fontSize: 22, lineHeight: 26, fontWeight: '500' }}>
      {e.loadText ?? '—'}
    </AppText>
  ) : (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space['2'], flexWrap: 'wrap' }}>
      <ValueButton text={e.loadText ?? `—${e.noHistory ? `  ${EDIT_MODE_COPY.noHistory}` : ''}`} big label={`Change target: ${row.name}, ${e.noHistory ? 'no history' : (e.loadText ?? 'no load target')}`} onPress={onLoad} />
      {e.benLoad ? (
        <View accessible accessibilityLabel="Your target today" style={{ flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: theme.colors['bg.raised'], borderRadius: theme.radius.sm, paddingVertical: 2, paddingHorizontal: theme.space['2'] }}>
          <Icon name="person" color="text.secondary" size={11} />
          <AppText variant="label" color="text.secondary">
            {EDIT_MODE_COPY.ben}
          </AppText>
        </View>
      ) : null}
    </View>
  );
  const pillRow = (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.space['2'], justifyContent: stacked ? 'flex-start' : 'flex-end' }}>
      {pills.map((p) => (
        <OutlinePill key={p.key} label={p.label} accessibilityLabel={p.accessibilityLabel} onPress={() => { onPill(p.key); }} />
      ))}
    </View>
  );
  return (
    <View style={{ borderTopWidth: theme.dividerWidth, borderTopColor: theme.colors['border.divider'], paddingTop: theme.space['2'], paddingBottom: last ? theme.space['3'] : theme.space['2'] + 2, gap: theme.space['2'] }}>
      {stacked ? (
        <>
          {header}
          {sets}
          {reps}
          {load}
          {pillRow}
          {moveButtons}
        </>
      ) : (
        <>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space['2'] }}>
            {header}
            {moveButtons}
          </View>
          {skipped ? (
            <View style={{ marginLeft: 26 }}>{pillRow}</View>
          ) : (
            <>
              <View style={{ marginLeft: 26, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', rowGap: theme.space['1'] }}>
                {sets}
                {reps}
              </View>
              <View style={{ marginLeft: 26, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', rowGap: theme.space['1'] }}>
                {load}
                {pillRow}
              </View>
            </>
          )}
        </>
      )}
    </View>
  );
}

/** A 44 pt row link in Edit mode (`＋ Add exercise`, `Update Push A ›`). */
export function EditLink({ text, icon, onPress, accessibilityLabel }: { text: string; icon?: 'plus'; onPress: () => void; accessibilityLabel?: string }) {
  const theme = useTheme();
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={accessibilityLabel ?? text.replace(' ›', '')} onPress={onPress} style={({ pressed }) => ({ minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: theme.space['2'], opacity: pressed ? 0.6 : 1, borderTopWidth: theme.dividerWidth, borderTopColor: theme.colors['border.divider'] })}>
      {icon ? <Icon name={icon} color="text.primary" size={16} weight="semibold" /> : null}
      <AppText variant="body">{text}</AppText>
    </Pressable>
  );
}

/** One `CheckRow` (§11.5): a 44 pt checkbox with the line's label and text; a swap's second line under it. */
function CheckRow({ line, checked, stale, onToggle }: { line: TemplateLine; checked: boolean; stale: boolean; onToggle: () => void }) {
  const theme = useTheme();
  const color = stale ? 'text.secondary' : 'text.primary';
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked, disabled: stale }}
      accessibilityLabel={line.accessibilityLabel}
      disabled={stale}
      onPress={onToggle}
      style={{ minHeight: 44, flexDirection: 'row', alignItems: 'flex-start', gap: theme.space['2'], paddingVertical: theme.space['1'] }}
    >
      {stale ? null : (
        <View style={{ width: 22, height: 22, marginTop: 1, borderRadius: 6, borderWidth: 1.5, borderColor: checked ? theme.colors.accent : theme.colors['border.control'], backgroundColor: checked ? theme.colors['accent.subtle'] : 'transparent', alignItems: 'center', justifyContent: 'center' }}>
          {checked ? <Icon name="checkmark" color="accent" size={12} weight="bold" /> : null}
        </View>
      )}
      <AppText variant="label" color={color} style={{ width: 72 }}>
        {line.label}
      </AppText>
      <View style={{ flex: 1 }}>
        <AppText variant="callout" color={color} numeric>
          {line.text}
        </AppText>
        {line.detail !== null ? (
          <AppText variant="callout" color={color} numeric>
            {line.detail}
          </AppText>
        ) : null}
      </View>
    </Pressable>
  );
}

/**
 * `Update Push A` (§11.5): Ben-authored change-review card, scope `Push A
 * from now on`, one `CheckRow` per change, `Not now` and `Apply` (an outline
 * accent pill; Start stays the page's only filled pill). Applied:
 * `✓ Applied · Push A from now on` + Undo. Out of date: lines in
 * `text.secondary` under `Was suggested:`, Apply hidden, `Dismiss` (CR4).
 */
export function UpdateCard({
  state,
  routineName,
  lines,
  checked,
  applyEnabled,
  busy,
  onToggle,
  onApply,
  onNotNow,
  onUndo,
  onDismiss,
}: {
  state: 'ready' | 'applied' | 'out_of_date';
  routineName: string;
  lines: readonly TemplateLine[];
  checked: ReadonlySet<string>;
  applyEnabled: boolean;
  busy: boolean;
  onToggle: (key: string) => void;
  onApply: () => void;
  onNotNow: () => void;
  onUndo: () => void;
  onDismiss: () => void;
}) {
  const theme = useTheme();
  if (state === 'applied') {
    return (
      <View accessible accessibilityLabel={EDIT_MODE_COPY.applied(routineName).replace('✓ ', '')} style={{ minHeight: 52, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', rowGap: theme.space['2'], borderTopWidth: theme.dividerWidth, borderTopColor: theme.colors['border.divider'] }}>
        <AppText variant="callout">{EDIT_MODE_COPY.applied(routineName)}</AppText>
        <OutlinePill label={EDIT_MODE_COPY.undo} onPress={onUndo} accessibilityLabel={`Undo the update to ${routineName}`} />
      </View>
    );
  }
  const stale = state === 'out_of_date';
  const disabled = busy || !applyEnabled;
  return (
    <View style={{ marginTop: theme.space['2'], borderRadius: theme.radius.md, backgroundColor: theme.colors['bg.surface'], padding: theme.space['3'], gap: theme.space['2'] }}>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: theme.space['2'] }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: theme.colors['bg.raised'], borderRadius: theme.radius.sm, paddingVertical: theme.space['1'], paddingHorizontal: theme.space['2'] }}>
          <Icon name="person" color="text.secondary" size={12} />
          <AppText variant="label" color="text.secondary">
            {EDIT_MODE_COPY.ben}
          </AppText>
        </View>
        <AppText variant="headline" accessibilityRole="header">
          {EDIT_MODE_COPY.updateTitle(routineName)}
        </AppText>
      </View>
      <View style={{ alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: theme.colors['bg.raised'], borderWidth: 1, borderColor: theme.colors['border.control'], borderRadius: theme.radius.sm, paddingVertical: theme.space['1'], paddingHorizontal: theme.space['2'] }}>
        <Icon name="calendar" color="text.primary" size={12} />
        <AppText variant="label">{EDIT_MODE_COPY.scope(routineName)}</AppText>
      </View>
      {stale ? (
        <AppText variant="callout" color="text.secondary">
          {EDIT_MODE_COPY.wasSuggested}
        </AppText>
      ) : null}
      {lines.map((l) => (
        <CheckRow key={l.key} line={l} checked={checked.has(l.key)} stale={stale} onToggle={() => { onToggle(l.key); }} />
      ))}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', gap: theme.space['2'] }}>
        {stale ? (
          <OutlinePill label={EDIT_MODE_COPY.dismiss} onPress={onDismiss} />
        ) : (
          <>
            <OutlinePill label={EDIT_MODE_COPY.notNow} onPress={onNotNow} />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Apply: update ${routineName} from now on`}
              accessibilityState={{ disabled }}
              disabled={disabled}
              onPress={onApply}
              style={({ pressed }) => ({
                minHeight: theme.target.min.height,
                paddingHorizontal: theme.space['4'],
                borderRadius: theme.radius.pill,
                borderWidth: 1,
                borderColor: theme.colors.accent,
                backgroundColor: pressed ? theme.colors['accent.subtle'] : 'transparent',
                justifyContent: 'center',
                opacity: disabled ? 0.35 : 1,
              })}
            >
              <AppText variant="label" color="accent">
                {EDIT_MODE_COPY.apply}
              </AppText>
            </Pressable>
          </>
        )}
      </View>
    </View>
  );
}
